"""
The parts of this service that assume the caller is hostile.

The threat here is not expense, as it is for the chat service next door. It is
**sending mail to somebody who did not ask for it**. A signup endpoint that
mails whatever address it is handed is, from the outside, a free mailer: point
it at a stranger's inbox in a loop and the sending address wears the
consequences.

So the controls are, in order of how much they matter:

1. **Confirmed opt-in.** Nothing is stored and no digest is ever sent until
   somebody has clicked a link in the address they typed. Handled in
   `tokens.py` and `main.py`, not here.
2. **A per-address cooldown.** One confirmation per address per window,
   whoever asks and from wherever. This is the control that stops the same
   inbox being hit over and over.
3. **A per-caller rate limit**, and a global daily ceiling on confirmation
   mail as a backstop for both.

Three and the IP bucketing behind it are courtesy controls: `X-Real-IP` is
only trustworthy because Caddy sets it. One and two hold regardless of what
the caller claims to be.
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from .settings import settings

# ──────────────────────────────────────────────────────────────────────────
# Addresses
# ──────────────────────────────────────────────────────────────────────────

#: Local part, `@`, domain with at least one dot. Deliberately conservative:
#: this is a filter for obvious nonsense and injection attempts, not an
#: implementation of RFC 5322. Whether an address exists is decided by the
#: confirmation mail arriving, which is the only check that ever really works.
_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,189}\.[A-Za-z]{2,24}$")

#: Longer than any address anyone has, short enough to bound a header.
MAX_EMAIL_CHARS = 254


class InvalidAddressError(ValueError):
    """The submitted address could not be used."""


def normalize_email(raw: str) -> str:
    """Clean and validate one submitted address.

    NFKC first, because a full-width or lookalike character would otherwise
    produce a second, visually identical row for the same reader. The local
    part keeps its case (some servers care), the domain is lower-cased (none
    do), and the pair is what the list is keyed on.

    Args:
        raw: Untrusted input.

    Returns:
        The address to store.

    Raises:
        InvalidAddressError: If it is empty, too long, or not plausibly an address.
    """
    text = unicodedata.normalize("NFKC", raw or "").strip()
    # A newline in an address is how header injection starts; there is no
    # legitimate control character in one, so all of them go.
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    if not text or len(text) > MAX_EMAIL_CHARS:
        raise InvalidAddressError("that does not look like an email address")
    local, _, domain = text.rpartition("@")
    candidate = f"{local}@{domain.lower()}"
    if not _EMAIL.match(candidate) or ".." in candidate:
        raise InvalidAddressError("that does not look like an email address")
    return candidate


# ──────────────────────────────────────────────────────────────────────────
# Client identity
# ──────────────────────────────────────────────────────────────────────────


def client_ip(request: Request) -> str:
    """Best-effort client address, same reasoning as the chat service.

    `X-Real-IP` first because Caddy *sets* it from the real peer, replacing
    whatever the caller sent. `X-Forwarded-For` is only ever appended to, so
    its first hop is caller-controlled; the last hop is the one the nearest
    proxy added.
    """
    if settings.trust_forwarded_for:
        real = (request.headers.get("x-real-ip") or "").strip()
        if real:
            return real
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if hops:
                return hops[-1]
    return request.client.host if request.client else "unknown"


# ──────────────────────────────────────────────────────────────────────────
# Rate limiting
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """Per-client token bucket, in process memory. As next door."""

    def __init__(self, per_minute: int, burst: int, *, max_entries: int = 4096) -> None:
        self._rate = per_minute / 60.0
        self._burst = float(burst)
        self._max_entries = max_entries
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def check(self, key: str) -> tuple[bool, float]:
        """Consume one token.

        :returns: ``(allowed, retry_after_seconds)``.
        """
        now = time.monotonic()
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = _Bucket(tokens=self._burst, updated=now)
            self._buckets[key] = bucket
            while len(self._buckets) > self._max_entries:
                self._buckets.popitem(last=False)
        else:
            self._buckets.move_to_end(key)
            elapsed = now - bucket.updated
            bucket.tokens = min(self._burst, bucket.tokens + elapsed * self._rate)
            bucket.updated = now
        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True, 0.0
        deficit = 1.0 - bucket.tokens
        return False, deficit / self._rate if self._rate > 0 else 60.0


limiter = RateLimiter(settings.rate_limit_per_min, settings.rate_limit_burst)


def enforce_rate_limit(request: Request) -> None:
    """Raise 429 with a `Retry-After` header when the caller is over budget."""
    allowed, retry_after = limiter.check(client_ip(request))
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="That is a lot of signups from one place. Give it a minute.",
            headers={"Retry-After": str(max(1, int(retry_after) + 1))},
        )


# ──────────────────────────────────────────────────────────────────────────
# Per-address cooldown and the daily ceiling
# ──────────────────────────────────────────────────────────────────────────


class ConfirmBudget:
    """How often a confirmation may be sent, per address and in total.

    The per-address window is what makes this endpoint useless as a way to
    bother somebody: a stranger's inbox gets at most one message from it per
    window no matter how many times, or from how many places, it is asked.

    Both are in memory, so a restart forgives everything. That is the right
    trade for a list this size: the cost of a forgiven window is one extra
    mail, and the cost of persisting it is a table of addresses that nobody
    consented to having stored.
    """

    def __init__(self, cooldown_s: int, daily_cap: int, *, max_entries: int = 8192) -> None:
        self._cooldown = cooldown_s
        self._daily_cap = daily_cap
        self._recent: OrderedDict[str, float] = OrderedDict()
        self._max_entries = max_entries
        self._day_started = time.monotonic()
        self._today = 0

    def _roll(self, now: float) -> None:
        if now - self._day_started >= 86400:
            self._day_started = now
            self._today = 0

    def allows(self, email: str) -> bool:
        """Whether a confirmation may be sent to this address right now."""
        now = time.monotonic()
        self._roll(now)
        if self._today >= self._daily_cap:
            return False
        last = self._recent.get(email)
        return last is None or (now - last) >= self._cooldown

    def record(self, email: str) -> None:
        """Note that one was sent."""
        now = time.monotonic()
        self._roll(now)
        self._today += 1
        self._recent[email] = now
        self._recent.move_to_end(email)
        while len(self._recent) > self._max_entries:
            self._recent.popitem(last=False)

    def snapshot(self) -> dict[str, int]:
        self._roll(time.monotonic())
        return {"sent_today": self._today, "daily_cap": self._daily_cap}


budget = ConfirmBudget(settings.address_cooldown_s, settings.max_confirm_per_day)
