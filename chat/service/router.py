"""
The attempt planner: which model, on which key, in what order.

The policy is model-major, key-minor:

    gemini-3.7-flash  × key0, key1
    gemini-3.6-flash  × key0, key1
    gemini-3.5-flash  × key0, key1
    ...
    gemini-3.5-flash-lite × key0, key1     ← the named last resort

Model-major because the models are ordered by *quality*, and quality is the
stated priority: exhausting every key on the best model before demoting is the
whole point. Key-minor because within one model the keys are interchangeable,
so the ring's even rotation decides.

A pair that has just been rate-limited is skipped rather than retried, but only
until its cooldown expires — see `keyring.py`. If every pair is cooling, the
plan still contains them, ordered by which recovers soonest, so a request made
during a quota trough makes one hopeful attempt instead of failing untried.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass

from . import gemini
from .keyring import KeyRing

log = logging.getLogger("site-chat.router")


@dataclass(frozen=True)
class Attempt:
    """One (model, key) pair to try."""

    model: str
    key_index: int
    api_key: str


@dataclass
class Outcome:
    """What it took to produce an answer. Reported to the client for the HUD."""

    model: str = ""
    key_index: int = -1
    attempts: int = 0
    usage: gemini.Usage | None = None
    degraded: bool = False
    """True when the answer came from a fallback model rather than a primary."""


def plan(models: tuple[str, ...], ring: KeyRing) -> Iterator[Attempt]:
    """
    Yield attempts in preference order.

    :param models: The full chain, best first.
    :param ring: Supplies key ordering and health.
    """
    for model in models:
        for index in ring.candidates(model):
            yield Attempt(model=model, key_index=index, api_key=ring.keys[index])


def note_failure(ring: KeyRing, attempt: Attempt, error: gemini.GeminiError) -> None:
    """
    Feed one failure back into the ring so the next request routes around it.

    `EmptyAnswer` deliberately records nothing. It is a property of the request
    (the budget was too tight, or the prompt tripped a filter), not of the key,
    and parking a perfectly healthy key for it would shrink capacity for a
    reason that will recur on every other key too.
    """
    if isinstance(error, gemini.RateLimited):
        ring.record_limit(attempt.key_index, attempt.model, error.retry_after_s)
    elif isinstance(error, gemini.Rejected):
        ring.record_rejected(attempt.key_index, attempt.model)
    elif isinstance(error, gemini.Unavailable):
        ring.record_transient(attempt.key_index, attempt.model)


def is_fallback(model: str, primaries: tuple[str, ...]) -> bool:
    """Did the answer come from below the primary chain?"""
    return model not in primaries
