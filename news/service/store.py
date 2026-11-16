"""
The subscriber list: one SQLite file, one table, one row per reader.

## Why SQLite and not the repository

The rest of this deployment is stateless and rebuilt from git on every deploy.
This is the exception, and it has to be: a subscriber's address is personal
data, the NewsRing repository is public, and its CI logs are public too. So
the list lives on a named volume on the host and nothing ever copies it into
a build.

## What is not stored

A signup that has not been confirmed. The address rides in the signed link
instead (see `tokens.py`), so an unconfirmed signup leaves no trace here and
this endpoint cannot be used to collect addresses.

An unsubscribe deletes the row outright rather than flagging it. Keeping a
tombstone would mean keeping the address of someone who asked to be forgotten,
to save a database lookup nobody needs.

## Concurrency

One uvicorn worker, so one process, but requests run on an event loop and
every call here is made from a threadpool. The connection is therefore shared
with `check_same_thread=False` and guarded by one lock: SQLite will serialise
writes regardless, and taking the lock here means a `BUSY` error is impossible
rather than merely unlikely.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS subscribers (
    email          TEXT PRIMARY KEY,
    created_at     TEXT NOT NULL,
    last_sent_date TEXT,
    source         TEXT NOT NULL DEFAULT 'site'
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class SubscriberStore:
    """Every read and write of the list."""

    def __init__(self, path: Path, *, max_subscribers: int) -> None:
        """
        Args:
            path: The database file. Parent directories are created.
            max_subscribers: Ceiling enforced by `add`.
        """
        self._path = path
        self._max = max_subscribers
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        # WAL so a long broadcast's writes never block a signup mid-send.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            with self._conn:
                yield self._conn

    # ── Reads ─────────────────────────────────────────────────────────

    def count(self) -> int:
        """How many readers are on the list."""
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) AS n FROM subscribers").fetchone()
        return int(row["n"])

    def has(self, email: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM subscribers WHERE email = ?", (email,)
            ).fetchone()
        return row is not None

    def is_full(self) -> bool:
        return self.count() >= self._max

    def due_for(self, date: str) -> list[str]:
        """Addresses that have not been sent the digest for `date`.

        This is what makes a re-run harmless. A workflow can be dispatched
        twice, or retried after a half-finished send, and nobody gets the same
        digest twice.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT email FROM subscribers "
                "WHERE last_sent_date IS NULL OR last_sent_date <> ? "
                "ORDER BY created_at",
                (date,),
            ).fetchall()
        return [row["email"] for row in rows]

    # ── Writes ────────────────────────────────────────────────────────

    def add(self, email: str, *, source: str = "site") -> bool:
        """Put a confirmed reader on the list.

        Returns:
            True if they were added or were already there, False if the list
            is full. Already-there counts as success: someone who clicks an
            old confirmation link should see the same page as everyone else,
            not an error about a state they cannot observe.
        """
        with self._write() as conn:
            existing = conn.execute(
                "SELECT 1 FROM subscribers WHERE email = ?", (email,)
            ).fetchone()
            if existing is not None:
                return True
            total = conn.execute("SELECT COUNT(*) AS n FROM subscribers").fetchone()["n"]
            if total >= self._max:
                return False
            conn.execute(
                "INSERT INTO subscribers (email, created_at, source) VALUES (?, ?, ?)",
                (email, _now(), source),
            )
        return True

    def remove(self, email: str) -> bool:
        """Take a reader off the list and forget the address.

        Returns:
            True if a row was deleted. A second click returns False and the
            caller still reports success, because the reader's intent is
            satisfied either way.
        """
        with self._write() as conn:
            cursor = conn.execute("DELETE FROM subscribers WHERE email = ?", (email,))
        return cursor.rowcount > 0

    def mark_sent(self, email: str, date: str) -> None:
        """Record that this reader has had the digest for `date`."""
        with self._write() as conn:
            conn.execute(
                "UPDATE subscribers SET last_sent_date = ? WHERE email = ?", (date, email)
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()
