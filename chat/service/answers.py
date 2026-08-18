"""
A small cache of first-turn answers.

## Why this exists

The free tier's binding constraint is requests per minute, not tokens — a
handful of calls in quick succession is enough to earn a 429. On a personal
site the question distribution is extremely top-heavy: "who is this", "what
does he work on", "what is Particle Wave", asked by visitor after visitor. Not
answering those from memory means spending the scarcest resource on the most
predictable requests.

## Why only the first turn

A cache key that ignored history would serve one visitor's follow-up to
another. Including history in the key would make hits vanishingly rare, since
transcripts diverge immediately. So the cache is deliberately restricted to
messages sent into an *empty* transcript, where there is no context to leak and
the hit rate is highest.

That restriction also settles the privacy question. First messages are opening
questions about a public site, and the cache is keyed on the normalized text of
one — never on anything identifying the visitor, and never held across a
restart.
"""

from __future__ import annotations

import re
import threading
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass

# Anything longer is a one-off, not a common question. Capping the key length
# keeps a single long paste from evicting the entries that are earning hits.
MAX_CACHEABLE_CHARS = 320


@dataclass(frozen=True)
class CachedAnswer:
    """A stored answer and what produced it."""

    text: str
    model: str
    stored_at: float


def normalize(question: str) -> str:
    """
    Reduce a question to a cache key.

    Case, surrounding punctuation, and whitespace are all noise — "What is
    Particle Wave?" and "what is particle wave" should share an answer. NFKC
    first so typographic variants (curly quotes, full-width characters) fold
    onto their plain equivalents instead of missing.

    :param question: Raw visitor text.
    :returns: Normalized key, empty if the question is not worth caching.
    """
    text = unicodedata.normalize("NFKC", question).strip().lower()
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" \t\r\n.?!,;:\"'")
    return text


class AnswerCache:
    """A TTL-bounded LRU. Thread-safe; per-process, and empty after a restart."""

    def __init__(self, *, max_entries: int, ttl_s: float) -> None:
        self._max = max_entries
        self._ttl = ttl_s
        self._lock = threading.Lock()
        self._entries: OrderedDict[tuple[str, str], CachedAnswer] = OrderedDict()
        self.hits = 0
        self.misses = 0

    @property
    def enabled(self) -> bool:
        return self._max > 0 and self._ttl > 0

    def key(self, corpus_hash: str, question: str) -> tuple[str, str] | None:
        """
        Build a cache key, or None if this question must not be cached.

        The corpus hash is part of the key so that publishing new content
        invalidates every stored answer at once — an answer grounded in text
        that no longer exists is worse than no cache at all.
        """
        if not self.enabled:
            return None
        normalized = normalize(question)
        if not normalized or len(normalized) > MAX_CACHEABLE_CHARS:
            return None
        return (corpus_hash, normalized)

    def get(self, key: tuple[str, str] | None) -> CachedAnswer | None:
        """Look up an entry, honouring the TTL and refreshing its LRU position."""
        if key is None:
            return None
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                self.misses += 1
                return None
            if now - entry.stored_at > self._ttl:
                del self._entries[key]
                self.misses += 1
                return None
            self._entries.move_to_end(key)
            self.hits += 1
            return entry

    def put(self, key: tuple[str, str] | None, text: str, model: str) -> None:
        """Store an answer, evicting the least recently used if full."""
        if key is None or not text.strip():
            return
        with self._lock:
            self._entries[key] = CachedAnswer(text=text, model=model, stored_at=time.monotonic())
            self._entries.move_to_end(key)
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def snapshot(self) -> dict:
        with self._lock:
            size = len(self._entries)
        total = self.hits + self.misses
        return {
            "enabled": self.enabled,
            "entries": size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }
