"""
Runtime configuration, read once from the environment.

Same shape as the two services next door: every knob is an environment
variable, so the image is identical everywhere and the deployed values live in
`infra/compose.yml` and the `news.env` file `infra/configure.py` writes.

Two values have no safe default and the service refuses to do anything without
them: `NEWS_TOKEN_SECRET`, which is what makes a confirmation link
unforgeable, and `NEWS_BROADCAST_TOKEN`, which is what stops anyone from
mailing the list. A missing mailbox is the third: it leaves the service up and
reporting `degraded`, because a container that will not boot tells an operator
far less than one that says exactly which variable is unset.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Final

#: The port the container listens on; Caddy proxies to it under `/news`.
DEFAULT_PORT: Final[int] = 7880


def _int(name: str, default: int, *, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the environment, built once at import time."""

    # ── Storage ───────────────────────────────────────────────────────
    database_path: Path = Path("/data/news.db")
    """
    The subscriber list. On a named volume, because it is the only state in
    this whole deployment that cannot be rebuilt from the repository: lose it
    and every reader has to subscribe again.
    """

    max_subscribers: int = 50
    """
    Hard ceiling on the list.

    Not a product decision — a sending one. The mailbox behind this is an
    ordinary consumer account with a daily cap in the hundreds and a
    reputation that a daily bulk send to strangers will spend. The cap is low
    enough that the list cannot quietly grow into that wall; raising it is a
    decision to move to a real sending service first.
    """

    # ── Mailbox ───────────────────────────────────────────────────────
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""
    """Envelope and header sender. Defaults to `smtp_user` when unset."""
    mail_from_name: str = "NewsRing"
    mail_reply_to: str = ""

    # ── The message ───────────────────────────────────────────────────
    digest_url: str = ""
    """
    Where the ready-to-send digest is published, written by NewsRing's
    `build_site` as `broadcast_today.json`. Fetched rather than rendered here,
    so there is exactly one renderer for every copy of a digest and this
    service never needs to know what a digest looks like.
    """

    digest_cache_s: int = 300
    """
    How long a fetched digest is reused. A broadcast reads it once; this is
    really for the confirmation sends, which arrive in ones and twos and would
    otherwise refetch the same document each time.
    """

    # ── Links ─────────────────────────────────────────────────────────
    site_url: str = "https://coronring.github.io/newsring"
    """
    The signup page. Confirm and unsubscribe redirect back here with a
    `state` parameter, so every page a reader sees is in the site's own design
    rather than a bare JSON response from a box with an IP address for a name.
    """

    public_base: str = ""
    """
    This service's own public URL, including the path Caddy mounts it at.
    Links in email are built from it. It cannot be inferred from a request,
    because every request arrives through a proxy that has already stripped
    the prefix.
    """

    # ── Secrets ───────────────────────────────────────────────────────
    token_secret: str = ""
    """Signing key for confirmation and unsubscribe links."""

    broadcast_token: str = ""
    """Bearer token `POST /api/broadcast` requires. Held by the NewsRing workflow."""

    confirm_ttl_s: int = 48 * 3600
    """
    How long a confirmation link is good for. Long enough to survive a weekend
    in a spam folder, short enough that a link in an old mailbox is not a
    standing subscription waiting to be clicked.
    """

    # ── Abuse control ─────────────────────────────────────────────────
    rate_limit_per_min: int = 3
    rate_limit_burst: int = 3
    """
    Deliberately tiny. Signing up is a once-ever action, so anything above a
    handful an hour from one address is somebody using this service to send
    mail to a third party.
    """

    address_cooldown_s: int = 900
    """
    How long before the same address can be sent a second confirmation. This
    is the control that stops the endpoint being used to bomb one inbox.
    """

    max_confirm_per_day: int = 100
    """
    Ceiling on confirmation mails in a rolling day, across all callers. A
    backstop for the case where the per-address and per-IP limits are both
    being worked around by volume.
    """

    # ── Server ────────────────────────────────────────────────────────
    allowed_origins: tuple[str, ...] = ()
    port: int = DEFAULT_PORT
    trust_forwarded_for: bool = True
    log_level: str = "info"

    @property
    def sender(self) -> str:
        """The address mail is sent from."""
        return self.mail_from or self.smtp_user

    @property
    def mailbox_ready(self) -> bool:
        return bool(self.smtp_host and self.smtp_user and self.smtp_password and self.sender)

    @property
    def configured(self) -> bool:
        """Whether the service can do its job at all."""
        return bool(
            self.token_secret and self.broadcast_token and self.digest_url and self.mailbox_ready
        )

    def missing(self) -> list[str]:
        """Names of the unset variables, for the health endpoint and the log."""
        names = []
        if not self.token_secret:
            names.append("NEWS_TOKEN_SECRET")
        if not self.broadcast_token:
            names.append("NEWS_BROADCAST_TOKEN")
        if not self.digest_url:
            names.append("NEWS_DIGEST_URL")
        if not self.smtp_user:
            names.append("NEWS_SMTP_USER")
        if not self.smtp_password:
            names.append("NEWS_SMTP_PASSWORD")
        return names


def load() -> Settings:
    """Build the settings snapshot from the current environment."""
    return Settings(
        database_path=Path(_str("NEWS_DATABASE_PATH", "/data/news.db")),
        max_subscribers=_int("NEWS_MAX_SUBSCRIBERS", 50, minimum=0),
        smtp_host=_str("NEWS_SMTP_HOST", "smtp.gmail.com"),
        smtp_port=_int("NEWS_SMTP_PORT", 587, minimum=1),
        smtp_user=_str("NEWS_SMTP_USER"),
        smtp_password=os.environ.get("NEWS_SMTP_PASSWORD", ""),
        mail_from=_str("NEWS_MAIL_FROM"),
        mail_from_name=_str("NEWS_MAIL_FROM_NAME", "NewsRing"),
        mail_reply_to=_str("NEWS_MAIL_REPLY_TO"),
        digest_url=_str("NEWS_DIGEST_URL"),
        digest_cache_s=_int("NEWS_DIGEST_CACHE_S", 300, minimum=0),
        site_url=_str("NEWS_SITE_URL", "https://coronring.github.io/newsring").rstrip("/"),
        public_base=_str("NEWS_PUBLIC_BASE").rstrip("/"),
        token_secret=os.environ.get("NEWS_TOKEN_SECRET", "").strip(),
        broadcast_token=os.environ.get("NEWS_BROADCAST_TOKEN", "").strip(),
        confirm_ttl_s=_int("NEWS_CONFIRM_TTL_S", 48 * 3600, minimum=60),
        rate_limit_per_min=_int("NEWS_RATE_LIMIT_PER_MIN", 3, minimum=1),
        rate_limit_burst=_int("NEWS_RATE_LIMIT_BURST", 3, minimum=1),
        address_cooldown_s=_int("NEWS_ADDRESS_COOLDOWN_S", 900, minimum=0),
        max_confirm_per_day=_int("NEWS_MAX_CONFIRM_PER_DAY", 100, minimum=1),
        allowed_origins=_csv("NEWS_ALLOWED_ORIGINS", ()),
        port=_int("PORT", DEFAULT_PORT, minimum=1),
        trust_forwarded_for=os.environ.get("NEWS_TRUST_FORWARDED_FOR", "1") != "0",
        log_level=_str("NEWS_LOG_LEVEL", "info"),
    )


settings: Final[Settings] = load()
