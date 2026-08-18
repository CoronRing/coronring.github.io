"""
Runtime configuration, read once from the environment.

Every knob is an environment variable so the same image runs unchanged
locally, on the Oracle host, and on any other container platform. The
deployed values live in `infra/compose.yml`.

Nothing here has a secret default. If `PW_API_KEY` is unset the convert
endpoint is open, which is the right default for a public demo and the
wrong one for anything else — see `docs/design.md` §5.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Final

# The port the container listens on; Caddy proxies to it. Hosts that inject
# their own port (Render, Cloud Run, Fly) override it with $PORT.
DEFAULT_PORT: Final[int] = 7860


def _int(name: str, default: int, *, minimum: int = 1) -> int:
    """Read a positive int, falling back to the default on anything unusable."""
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the environment, built once at import time."""

    # ── Access control ────────────────────────────────────────────────
    api_key: str | None = None
    """When set, `/api/convert` requires a matching `X-API-Key` header."""

    allowed_origins: tuple[str, ...] = ()
    """
    Cross-origin allowlist. Empty means same-origin only: the built-in page
    works, other sites are refused. Never widened to `*`, because a wildcard
    turns a rate-limited CPU endpoint into anyone's free compute.
    """

    # ── Upload limits ─────────────────────────────────────────────────
    max_upload_bytes: int = 8 * 1024 * 1024
    """Hard cap on the request body, enforced while reading rather than by
    trusting the `Content-Length` header."""

    max_image_pixels: int = 40_000_000
    """Decompression-bomb ceiling. A 6 KB PNG can declare 30000x30000."""

    max_image_dimension: int = 12_000
    """Reject absurd aspect ratios that slip under the pixel budget."""

    # ── Cost control ──────────────────────────────────────────────────
    max_concurrency: int = 2
    """Simultaneous conversions. The sampler is pure-Python and CPU-bound, so
    this is what stops one visitor from saturating a 2-vCPU Space."""

    convert_timeout_s: float = 60.0
    """Backstop, not a routine path: measured worst case under the option
    caps is ~5 s. See `docs/design.md` §4 for the measurements."""

    rate_limit_per_min: int = 20
    """Sustained conversions per client per minute."""

    rate_limit_burst: int = 6
    """Bucket depth, so a visitor moving a slider quickly is not punished."""

    # ── Server ────────────────────────────────────────────────────────
    port: int = DEFAULT_PORT

    trust_forwarded_for: bool = True
    """
    The service sits behind Caddy, so the peer address is always the proxy and
    `X-Forwarded-For` carries the visitor. Set false when running with no proxy
    in front, where the header would be attacker-controlled.
    """

    log_level: str = "info"

    @property
    def auth_required(self) -> bool:
        return bool(self.api_key)


def load() -> Settings:
    """Build the settings snapshot from the current environment."""
    key = os.environ.get("PW_API_KEY", "").strip()
    return Settings(
        api_key=key or None,
        allowed_origins=_csv("PW_ALLOWED_ORIGINS", ()),
        max_upload_bytes=_int("PW_MAX_UPLOAD_BYTES", 8 * 1024 * 1024, minimum=1024),
        max_image_pixels=_int("PW_MAX_IMAGE_PIXELS", 40_000_000, minimum=10_000),
        max_image_dimension=_int("PW_MAX_IMAGE_DIMENSION", 12_000, minimum=64),
        max_concurrency=_int("PW_MAX_CONCURRENCY", 2),
        convert_timeout_s=_float("PW_CONVERT_TIMEOUT_S", 60.0, minimum=1.0),
        rate_limit_per_min=_int("PW_RATE_LIMIT_PER_MIN", 20),
        rate_limit_burst=_int("PW_RATE_LIMIT_BURST", 6),
        port=_int("PORT", DEFAULT_PORT),
        trust_forwarded_for=os.environ.get("PW_TRUST_FORWARDED_FOR", "1") != "0",
        log_level=os.environ.get("PW_LOG_LEVEL", "info"),
    )


settings: Final[Settings] = load()
