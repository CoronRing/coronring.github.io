"""
The site corpus: fetched from the published site, held in memory, refreshed.

`scripts/build-corpus.mjs` emits `corpus.json` into the Astro build, so it is
served from `https://coronring.github.io/corpus.json` alongside the pages it
describes. This module pulls that document and turns it into the block of text
that every request puts in front of the model.

## Why fetch instead of bundling

Bundling the corpus into the image would couple the two deploys: publishing a
new article would require a backend redeploy to make the assistant aware of it,
and forgetting that step would leave the assistant confidently describing a
stale site. Fetching means the site is the single source of truth and the
backend follows it automatically.

The cost is a startup dependency on the site being reachable, which is handled
by keeping the last good copy and never letting a failed refresh clear it.

## Why the rendered text is built once and reused verbatim

`render()` output is the cache-relevant prefix of every request. Gemini's
implicit cache only fires on an exact prefix match, so this is memoized and
handed out as the same string every time. Rebuilding it per request — even
producing identical bytes — would be wasted work; producing *nearly* identical
bytes, by embedding a timestamp or reordering pages, would silently cost every
cache hit the service could have had. Ordering is fixed upstream in the
generator for the same reason.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("site-chat.corpus")

USER_AGENT = "coronring-site-chat/1.0 (+https://coronring.github.io)"


@dataclass(frozen=True)
class Page:
    """One page of the site."""

    route: str
    url: str
    title: str
    description: str
    text: str

    @staticmethod
    def from_json(raw: dict[str, Any]) -> "Page | None":
        """Build a page from one `corpus.json` record, or None if unusable."""
        route = str(raw.get("route") or "").strip()
        text = str(raw.get("text") or "").strip()
        if not route or not text:
            return None
        return Page(
            route=route,
            url=str(raw.get("url") or "").strip(),
            title=str(raw.get("title") or route).strip(),
            description=str(raw.get("description") or "").strip(),
            text=text,
        )


@dataclass(frozen=True)
class Corpus:
    """An immutable snapshot of the site's text."""

    hash: str
    site: str
    pages: tuple[Page, ...]
    fetched_at: float

    @property
    def total_chars(self) -> int:
        return sum(len(page.text) for page in self.pages)

    @property
    def approx_tokens(self) -> int:
        """
        Rough token count for the status page and log lines.

        Deliberately a 4-chars-per-token estimate rather than a real tokenizer:
        nothing here makes a decision on the number, so pulling in a tokenizer
        to sharpen a display value would be all cost and no benefit.
        """
        return self.total_chars // 4

    def render(self) -> str:
        """
        The corpus as one block of text, ready to be a prompt prefix.

        Each page is fenced with its route so the model can cite it, and so a
        page boundary is unambiguous even when the text inside contains
        headings of its own.
        """
        parts = [
            "The following is the complete text of every page on the site, as "
            "published. It is the only source you may answer from.",
            "",
        ]
        for page in self.pages:
            parts.append(f"<page route=\"{page.route}\" title=\"{page.title}\">")
            if page.description:
                parts.append(f"Summary: {page.description}")
                parts.append("")
            parts.append(page.text)
            parts.append("</page>")
            parts.append("")
        return "\n".join(parts).rstrip() + "\n"


def parse(document: dict[str, Any], *, fetched_at: float) -> Corpus:
    """
    Turn a decoded `corpus.json` into a `Corpus`.

    :raises ValueError: If the document carries no usable page.
    """
    raw_pages = document.get("pages")
    if not isinstance(raw_pages, list):
        raise ValueError("corpus.json has no `pages` array")

    pages = tuple(page for page in (Page.from_json(p) for p in raw_pages if isinstance(p, dict)) if page)
    if not pages:
        raise ValueError("corpus.json contained no usable pages")

    return Corpus(
        hash=str(document.get("hash") or "unknown"),
        site=str(document.get("site") or ""),
        pages=pages,
        fetched_at=fetched_at,
    )


class CorpusStore:
    """
    Holds the current corpus and refreshes it in the background.

    A failed refresh is logged and discarded — the previous snapshot stays
    live. The assistant answering from a slightly stale site is a far better
    outcome than the assistant refusing to answer because GitHub Pages was
    briefly slow.
    """

    def __init__(self, url: str, *, max_bytes: int, refresh_s: float) -> None:
        self._url = url
        self._max_bytes = max_bytes
        self._refresh_s = refresh_s
        self._lock = threading.Lock()
        self._corpus: Corpus | None = None
        self._rendered: str = ""
        self._etag: str | None = None
        self._last_attempt: float = 0.0
        self._last_error: str = ""

    @property
    def current(self) -> Corpus | None:
        with self._lock:
            return self._corpus

    @property
    def rendered(self) -> str:
        """The memoized prompt prefix. Empty until the first successful load."""
        with self._lock:
            return self._rendered

    @property
    def last_error(self) -> str:
        with self._lock:
            return self._last_error

    def refresh(self, *, force: bool = False) -> bool:
        """
        Re-fetch if the refresh interval has elapsed.

        Uses `If-None-Match`, so an unchanged corpus costs a 304 and no parsing
        — and, importantly, leaves the rendered prefix object untouched.

        :param force: Ignore the interval and fetch now.
        :returns: True if a *new* corpus was installed.
        """
        now = time.monotonic()
        with self._lock:
            if not force and self._corpus is not None and now - self._last_attempt < self._refresh_s:
                return False
            self._last_attempt = now
            etag = self._etag

        request = urllib.request.Request(self._url, headers={"User-Agent": USER_AGENT})
        if etag:
            request.add_header("If-None-Match", etag)

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status == 304:
                    return False
                payload = response.read(self._max_bytes + 1)
                if len(payload) > self._max_bytes:
                    raise ValueError(f"corpus exceeds {self._max_bytes} bytes")
                new_etag = response.headers.get("ETag")
            document = json.loads(payload.decode("utf-8"))
            corpus = parse(document, fetched_at=time.time())
        except urllib.error.HTTPError as exc:
            if exc.code == 304:
                with self._lock:
                    self._last_error = ""
                return False
            return self._fail(f"HTTP {exc.code} fetching corpus")
        except Exception as exc:  # noqa: BLE001 - any failure keeps the old copy
            return self._fail(f"{type(exc).__name__}: {exc}")

        with self._lock:
            unchanged = self._corpus is not None and self._corpus.hash == corpus.hash
            self._corpus = corpus
            self._etag = new_etag
            self._last_error = ""
            if not unchanged:
                # Render once, here, and hand out the same string thereafter.
                self._rendered = corpus.render()

        if unchanged:
            return False

        log.info(
            "corpus loaded: %d pages, %d chars (~%d tokens), hash %s",
            len(corpus.pages),
            corpus.total_chars,
            corpus.approx_tokens,
            corpus.hash,
        )
        return True

    def _fail(self, message: str) -> bool:
        with self._lock:
            self._last_error = message
            has_corpus = self._corpus is not None
        log.warning("corpus refresh failed (%s)%s", message, "" if has_corpus else " — none loaded")
        return False
