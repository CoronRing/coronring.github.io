"""
In-process counters behind `/status`.

Deliberately not a metrics system. There is no Prometheus endpoint, no
histogram, and no persistence — a free Space is a single container that
restarts whenever it wakes from sleep, so anything durable would need a store
this project does not have and does not need.

What it is for: answering "is the thing alive, and has it been doing work?"
without opening a shell. Counters are plain ints mutated under the GIL, which
is accurate enough for a status page and costs nothing on the request path.
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

    conversions_ok: int = 0
    conversions_failed: int = 0
    points_produced: int = 0
    convert_ms_total: int = 0

    uploads_rejected: int = 0
    """Files refused before conversion: not an image, too large, bomb, bad format."""

    options_rejected: int = 0
    """Requests refused for out-of-range or unknown options."""

    rate_limited: int = 0

    in_flight: int = 0

    last_conversion_at: str | None = None

    # ── Recording ─────────────────────────────────────────────────────

    def record_success(self, points: int, elapsed_ms: int) -> None:
        self.conversions_ok += 1
        self.points_produced += points
        self.convert_ms_total += elapsed_ms
        self.last_conversion_at = datetime.now(tz=UTC).isoformat(timespec="seconds")

    def record_failure(self) -> None:
        self.conversions_failed += 1

    # ── Reporting ─────────────────────────────────────────────────────

    @property
    def uptime_seconds(self) -> int:
        return int(time.monotonic() - self.started_monotonic)

    @property
    def mean_convert_ms(self) -> int:
        return self.convert_ms_total // self.conversions_ok if self.conversions_ok else 0

    def snapshot(self) -> dict:
        return {
            "started_at": self.started_at,
            "uptime_seconds": self.uptime_seconds,
            "conversions_ok": self.conversions_ok,
            "conversions_failed": self.conversions_failed,
            "points_produced": self.points_produced,
            "mean_convert_ms": self.mean_convert_ms,
            "uploads_rejected": self.uploads_rejected,
            "options_rejected": self.options_rejected,
            "rate_limited": self.rate_limited,
            "in_flight": self.in_flight,
            "last_conversion_at": self.last_conversion_at,
        }


metrics = Metrics()
