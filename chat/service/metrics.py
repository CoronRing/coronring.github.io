"""
In-process counters behind `/api/status`.

Same posture as the particle-wave service's: plain ints under the GIL, no
Prometheus, nothing durable. One container, and a restart is allowed to reset
the numbers.

The one counter worth watching is `cached_prompt_tokens` against
`prompt_tokens`. That ratio is the cost strategy, reported rather than assumed
— the implicit cache is invisible from the outside and, during design, one
plausible-looking request layout produced a 0% hit rate without any error to
signal it. If this ratio ever sits near zero in production, the prompt prefix
has stopped being stable and something upstream broke.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass
class Metrics:
    """Counters since process start."""

    started_monotonic: float = field(default_factory=time.monotonic)
    started_at: str = field(
        default_factory=lambda: datetime.now(tz=UTC).isoformat(timespec="seconds")
    )

    answers_ok: int = 0
    answers_failed: int = 0
    answer_ms_total: int = 0

    cache_served: int = 0
    """Answers returned from the local answer cache, costing no upstream call."""

    upstream_attempts: int = 0
    """Individual provider calls, including ones that failed and were retried."""

    fallback_answers: int = 0
    """Answers produced by a model below the primary chain."""

    rate_limited: int = 0
    """Visitors refused by our own limiter."""

    upstream_rate_limited: int = 0
    """Provider 429s absorbed by the rotation."""

    prompt_tokens: int = 0
    cached_prompt_tokens: int = 0
    output_tokens: int = 0

    in_flight: int = 0

    last_answer_at: str | None = None
    last_error: str | None = None

    # ── Recording ─────────────────────────────────────────────────────

    def record_success(self, elapsed_ms: int, *, degraded: bool) -> None:
        self.answers_ok += 1
        self.answer_ms_total += elapsed_ms
        if degraded:
            self.fallback_answers += 1
        self.last_answer_at = datetime.now(tz=UTC).isoformat(timespec="seconds")

    def record_failure(self, reason: str) -> None:
        self.answers_failed += 1
        self.last_error = reason[:200]

    def record_usage(self, prompt: int, cached: int, output: int) -> None:
        self.prompt_tokens += prompt
        self.cached_prompt_tokens += cached
        self.output_tokens += output

    # ── Reporting ─────────────────────────────────────────────────────

    @property
    def uptime_seconds(self) -> int:
        return int(time.monotonic() - self.started_monotonic)

    @property
    def mean_answer_ms(self) -> int:
        return self.answer_ms_total // self.answers_ok if self.answers_ok else 0

    @property
    def cache_hit_ratio(self) -> float:
        """Share of prompt tokens served from the provider's implicit cache."""
        return round(self.cached_prompt_tokens / self.prompt_tokens, 3) if self.prompt_tokens else 0.0

    def snapshot(self) -> dict:
        return {
            "started_at": self.started_at,
            "uptime_seconds": self.uptime_seconds,
            "answers_ok": self.answers_ok,
            "answers_failed": self.answers_failed,
            "mean_answer_ms": self.mean_answer_ms,
            "cache_served": self.cache_served,
            "upstream_attempts": self.upstream_attempts,
            "fallback_answers": self.fallback_answers,
            "rate_limited": self.rate_limited,
            "upstream_rate_limited": self.upstream_rate_limited,
            "prompt_tokens": self.prompt_tokens,
            "cached_prompt_tokens": self.cached_prompt_tokens,
            "prompt_cache_hit_ratio": self.cache_hit_ratio,
            "output_tokens": self.output_tokens,
            "in_flight": self.in_flight,
            "last_answer_at": self.last_answer_at,
            "last_error": self.last_error,
        }


metrics = Metrics()
