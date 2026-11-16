"""
The message to send, fetched from the published site.

NewsRing renders each digest once, into `broadcast_today.json`, and publishes
it beside the page it already publishes. This service fetches that and sends
it verbatim. The alternative — rendering the email here from the JSON feed —
would mean two email templates that have to stay identical forever, in two
repositories, in two languages.

The document is public and contains no personal data: it is the same digest
anyone can read on the site. The only thing added per reader is the
unsubscribe link, which is substituted into both bodies at send time.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .settings import settings

#: Generous for a 100 kB document from GitHub Pages, and bounded so a hung
#: fetch cannot hold a request open indefinitely.
FETCH_TIMEOUT_S = 20

#: A digest with an HTML body far larger than this is not a digest.
MAX_BYTES = 4 * 1024 * 1024


class DigestError(Exception):
    """Today's message could not be fetched or did not look like one."""


@dataclass(frozen=True, slots=True)
class Digest:
    """One day's ready-to-send message.

    Attributes:
        date: The digest's own date, as NewsRing dates it (Pacific). Used to
            decide who has already had it.
        subject: Subject line, prefix already applied.
        html: HTML body, containing `placeholder` where a reader's unsubscribe
            link goes.
        text: Plain-text body, same substitution.
        placeholder: The exact string to replace.
    """

    date: str
    subject: str
    html: str
    text: str
    placeholder: str

    def for_reader(self, unsubscribe_url: str) -> tuple[str, str]:
        """Return `(text, html)` with this reader's unsubscribe link in place."""
        return (
            self.text.replace(self.placeholder, unsubscribe_url),
            self.html.replace(self.placeholder, unsubscribe_url),
        )


def _parse(raw: bytes) -> Digest:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DigestError("the published digest is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise DigestError("the published digest is not an object")
    missing = [k for k in ("date", "subject", "html", "text") if not payload.get(k)]
    if missing:
        raise DigestError(f"the published digest is missing {', '.join(missing)}")
    return Digest(
        date=str(payload["date"]),
        subject=str(payload["subject"]),
        html=str(payload["html"]),
        text=str(payload["text"]),
        placeholder=str(payload.get("unsubscribe_placeholder") or "{{UNSUBSCRIBE_URL}}"),
    )


class DigestSource:
    """Fetches the published message and caches it briefly."""

    def __init__(self, url: str, cache_s: int) -> None:
        self._url = url
        self._cache_s = cache_s
        self._lock = threading.Lock()
        self._cached: Digest | None = None
        self._fetched_at = 0.0
        self.last_error: str | None = None

    def current(self, *, force: bool = False) -> Digest:
        """The newest published digest.

        Args:
            force: Ignore the cache. A broadcast does this, because it runs
                moments after the site was deployed and must not send
                yesterday's digest out of a warm cache.

        Returns:
            The digest.

        Raises:
            DigestError: If it could not be fetched or parsed.
        """
        with self._lock:
            age = time.monotonic() - self._fetched_at
            fresh = self._cached is not None and age < self._cache_s
            if fresh and not force:
                assert self._cached is not None
                return self._cached
            digest = self._fetch()
            self._cached = digest
            self._fetched_at = time.monotonic()
            self.last_error = None
            return digest

    def _fetch(self) -> Digest:
        if not self._url:
            raise DigestError("no digest URL is configured")
        request = urllib.request.Request(  # noqa: S310 - the URL is operator-configured
            self._url, headers={"User-Agent": "newsring-subscriptions/1.0"}
        )
        try:
            with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:  # noqa: S310
                raw = response.read(MAX_BYTES + 1)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            self.last_error = f"{type(exc).__name__}"
            raise DigestError(
                f"could not fetch the published digest ({type(exc).__name__})"
            ) from exc
        if len(raw) > MAX_BYTES:
            self.last_error = "too large"
            raise DigestError("the published digest is implausibly large")
        try:
            return _parse(raw)
        except DigestError as exc:
            self.last_error = str(exc)
            raise

    def snapshot(self) -> dict[str, object]:
        """What `/api/health` reports about the message source."""
        with self._lock:
            cached = self._cached
        return {
            "url": self._url,
            "date": cached.date if cached else None,
            "error": self.last_error,
        }


source = DigestSource(settings.digest_url, settings.digest_cache_s)
