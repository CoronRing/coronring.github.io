"""
Even rotation across API keys, with per-(key, model) cooldown.

## What this is solving

The keys are free-tier, and the free tier's limits are aggressive: during the
design probe, seven `gemini-3.5-flash` calls inside two minutes on one key was
enough to earn a 429. With one key the service would spend most of its life
rate-limited. With two keys handed out evenly it has twice the headroom, and
adding a third later is a config change.

Quota is tracked per key *and per model* because that is how the provider
tracks it: a key that is out of 3.7-flash quota still has its 3.5-flash quota
intact, and demoting the whole key on one model's 429 would throw away most of
the capacity that is actually left.

## Rotation vs. cache locality — a real trade

Gemini's implicit cache is scoped to the calling project, so alternating keys
means each request lands on a *different* cache. Strict even rotation therefore
costs some cache hits that pinning to one key would keep.

It is still the right default, and not only because it is what was asked for.
The corpus prefix is identical for every key, so with any steady traffic all
keys stay warm concurrently rather than one key being warm and the rest cold;
the loss is confined to the first call or two after an idle period. Set
`prefer_sticky=True` to trade the other way if traffic ever gets thin enough
for that to matter.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

log = logging.getLogger("site-chat.keyring")

# Applied when the provider reports a limit but names no retry delay.
DEFAULT_COOLDOWN_S = 60.0

# Cap on any single cooldown, including provider-supplied ones. A daily-quota
# 429 can carry a delay measured in hours; honouring that literally would park
# a key until the process restarts, long after the minute-window quota it was
# really about has recovered. Re-probing occasionally costs one wasted call.
MAX_COOLDOWN_S = 900.0

# Base cooldown for a transient upstream failure (503, connection reset, or a
# read timeout). Deliberately short, because these clear on their own and the
# preferred model is the one most likely to hit them.
#
# It *doubles* per consecutive failure on the same pair, up to MAX_COOLDOWN_S.
# That distinction matters more than it looks: a fixed short cooldown means a
# model that is broadly overloaded — which `gemini-3.7-flash` measurably is on
# free-tier keys — gets retried on essentially every request, and since a busy
# 503 takes ~40 s to come back, each retry costs a visitor most of a minute for
# nothing. Backing off lets a genuinely transient blip recover in seconds while
# a sustained outage quietly removes itself from rotation.
TRANSIENT_COOLDOWN_S = 20.0


@dataclass
class _Slot:
    """Health of one (key, model) pair."""

    blocked_until: float = 0.0
    failures: int = 0
    successes: int = 0


@dataclass
class KeyRing:
    """
    Hands out API keys in even rotation, skipping ones on cooldown.

    Thread-safe: FastAPI serves requests from a threadpool and the cursor is
    shared mutable state.

    :param keys: The keys to rotate across, in any order.
    :param prefer_sticky: Bias toward the previously used key instead of
        advancing the cursor, trading even distribution for cache locality.
    """

    keys: tuple[str, ...]
    prefer_sticky: bool = False

    _cursor: int = 0
    _slots: dict[tuple[int, str], _Slot] = field(default_factory=dict)
    _issued: list[int] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        if not self._issued:
            self._issued = [0] * len(self.keys)

    # ── Selection ─────────────────────────────────────────────────────

    def candidates(self, model: str, *, now: float | None = None) -> list[int]:
        """
        Key indices to try for ``model``, best first.

        Starts at the rotation cursor so successive requests begin on different
        keys, then walks the ring. Keys on cooldown for this model are pushed to
        the back rather than dropped: if every key is cooling, a request should
        still make one hopeful attempt rather than fail without trying.

        :param model: Model name the keys will be used against.
        :param now: Clock override, for tests.
        :returns: Key indices, ready first, cooling last.
        """
        moment = time.monotonic() if now is None else now
        with self._lock:
            start = self._cursor
            order = [(start + offset) % len(self.keys) for offset in range(len(self.keys))]

        ready: list[int] = []
        cooling: list[tuple[float, int]] = []
        for index in order:
            slot = self._slot(index, model)
            if slot.blocked_until <= moment:
                ready.append(index)
            else:
                cooling.append((slot.blocked_until, index))

        cooling.sort()
        return ready + [index for _, index in cooling]

    def advance(self) -> None:
        """
        Move the cursor one step. Called once per request, not per attempt.

        Per-request rather than per-attempt so that a request which falls
        through several models does not spin the cursor by three or four and
        skew the distribution it exists to keep even.
        """
        if self.prefer_sticky or not self.keys:
            return
        with self._lock:
            self._cursor = (self._cursor + 1) % len(self.keys)

    # ── Feedback ──────────────────────────────────────────────────────

    def record_success(self, index: int, model: str) -> None:
        """Clear any cooldown on this pair and count the win."""
        with self._lock:
            slot = self._slot_locked(index, model)
            slot.blocked_until = 0.0
            slot.failures = 0
            slot.successes += 1
            if 0 <= index < len(self._issued):
                self._issued[index] += 1

    def record_limit(self, index: int, model: str, retry_after_s: float | None) -> None:
        """
        Park this (key, model) pair after a quota rejection.

        :param retry_after_s: Provider-supplied delay, if it gave one. Clamped
            to `MAX_COOLDOWN_S` — see the note there on daily-quota delays.
        """
        delay = DEFAULT_COOLDOWN_S if retry_after_s is None else max(1.0, retry_after_s)
        self._block(index, model, min(delay, MAX_COOLDOWN_S), "rate limit")

    def record_transient(self, index: int, model: str) -> None:
        """
        Park after a 5xx, timeout, or connection failure, backing off on repeats.

        The delay doubles for each consecutive failure on this pair and resets
        on the next success — see the note on `TRANSIENT_COOLDOWN_S`.
        """
        with self._lock:
            consecutive = self._slot_locked(index, model).failures
        delay = TRANSIENT_COOLDOWN_S * (2**min(consecutive, 6))
        self._block(index, model, min(delay, MAX_COOLDOWN_S), "transient")

    def record_rejected(self, index: int, model: str) -> None:
        """
        Park after the provider refused the credential or the model outright.

        Long cooldown: a revoked key or a model this project cannot reach will
        not fix itself inside a minute, and retrying it on every request turns
        one dead key into latency on every answer.
        """
        self._block(index, model, MAX_COOLDOWN_S, "rejected")

    def _block(self, index: int, model: str, seconds: float, reason: str) -> None:
        with self._lock:
            slot = self._slot_locked(index, model)
            slot.blocked_until = time.monotonic() + seconds
            slot.failures += 1
        log.info("key[%d] %s parked %.0fs (%s)", index, model, seconds, reason)

    # ── Introspection ─────────────────────────────────────────────────

    def snapshot(self, models: tuple[str, ...]) -> dict:
        """
        Health summary for `/api/status`. Never includes key material.

        :param models: Models to report per-key readiness for.
        """
        now = time.monotonic()
        with self._lock:
            issued = list(self._issued)
            slots = {pair: (slot.blocked_until, slot.successes, slot.failures)
                     for pair, slot in self._slots.items()}

        keys = []
        for index in range(len(self.keys)):
            cooling = {
                model: round(slots[(index, model)][0] - now, 1)
                for model in models
                if (index, model) in slots and slots[(index, model)][0] > now
            }
            keys.append({
                "index": index,
                "requests": issued[index] if index < len(issued) else 0,
                "cooling": cooling,
                "ready": not cooling.get(models[0]) if models else True,
            })
        return {"count": len(self.keys), "keys": keys}

    def _slot(self, index: int, model: str) -> _Slot:
        with self._lock:
            return self._slot_locked(index, model)

    def _slot_locked(self, index: int, model: str) -> _Slot:
        return self._slots.setdefault((index, model), _Slot())
