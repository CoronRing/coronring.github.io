"""
The parts of the chat service that assume the caller is hostile.

The threat model is narrower than the particle-wave service's — there is no
file upload and no decoder to attack — but the failure mode is more expensive.
Every accepted request spends from a shared, non-replenishable free-tier quota,
so an unbounded endpoint here does not merely burn CPU: it takes the assistant
off the air for every other visitor until the quota window rolls over.

So the controls are, in order of how much they matter:

1. **Bounding request volume.** The token bucket below, plus a concurrency
   semaphore in `main.py`. This is the control that actually protects the
   service.
2. **Bounding request size.** A question and a transcript are both trivially
   made enormous, and prompt tokens are the thing being conserved.
3. **Bounding what the model will do with the input.** Handled in `prompt.py`,
   not here — instructions cannot be enforced by a validator. What this module
   contributes is keeping the input small enough that it cannot bury those
   instructions under a wall of text.

The rate limiter is a courtesy control, not a boundary: `X-Forwarded-For` is
forgeable without a proxy in front. What holds regardless is the size caps and
the semaphore.
"""

from __future__ import annotations

import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from .metrics import metrics
from .settings import settings


# ──────────────────────────────────────────────────────────────────────────
# Client identity
# ──────────────────────────────────────────────────────────────────────────


def client_ip(request: Request) -> str:
    """
    Best-effort client address for rate-limit bucketing.

    Behind Caddy the peer is always the proxy, so the visitor is the first hop
    of `X-Forwarded-For`. Trivially forged with no proxy in front, hence the
    `trust_forwarded_for` switch.
    """
    if settings.trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


# ──────────────────────────────────────────────────────────────────────────
# Rate limiting
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """
    Per-client token bucket, in process memory.

    Same shape as the particle-wave limiter next door, and same reasoning: one
    container, so no shared store to coordinate with, and LRU eviction so a
    stream of distinct source addresses cannot grow the map without bound.

    The numbers are tighter here. Ten requests a minute is generous for a human
    reading answers and stingy for anything automated, which is the intent.
    """

    def __init__(self, per_minute: int, burst: int, *, max_entries: int = 4096) -> None:
        self._rate = per_minute / 60.0
        self._burst = float(burst)
        self._max_entries = max_entries
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def check(self, key: str) -> tuple[bool, float]:
        """
        Consume one token.

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
        metrics.rate_limited += 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You are sending questions faster than this free service can answer them. Give it a moment.",
            headers={"Retry-After": str(max(1, int(retry_after) + 1))},
        )


# ──────────────────────────────────────────────────────────────────────────
# Input sanitation
# ──────────────────────────────────────────────────────────────────────────

# Control characters serve no purpose in a typed question and are a cheap way
# to try to confuse a text protocol. Tab and newline are kept; the rest go.
_ALLOWED_CONTROLS = {"\n", "\t"}


def clean_text(raw: str, *, limit: int) -> str:
    """
    Normalize and bound one piece of visitor text.

    NFKC folds the lookalike-character tricks that are otherwise used to smuggle
    keywords past a naive filter, and collapses the full-width and combining
    forms that make otherwise-identical questions miss the answer cache.

    :param raw: Untrusted input.
    :param limit: Maximum characters to keep.
    :returns: Cleaned text, truncated to `limit`.
    """
    text = unicodedata.normalize("NFKC", raw)
    text = "".join(
        ch for ch in text if ch in _ALLOWED_CONTROLS or unicodedata.category(ch)[0] != "C"
    )
    # Collapse runs of blank lines — a long vertical gap is the simplest way to
    # push earlier instructions out of a model's effective attention.
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()[:limit]
