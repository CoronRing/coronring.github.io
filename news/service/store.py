"""
The subscriber list: one row per reader, in one of two places.

## Why there are two

The list is the only state in this whole deployment that cannot be rebuilt
from the repository. Everything else here is a container that gets thrown
away and recreated from git on every deploy. Lose the list and every reader
has to subscribe again, which is not a thing you get to ask people twice.

That matters more than it looks, because the host underneath is a free-tier
box that can be reclaimed by its provider without warning, taking its disks
with it. So in production the list lives in Postgres, off the host, reached
over HTTPS (see `postgrest.py`), and the box stays disposable.

SQLite remains for the tests and for running the service locally, where a
network database would mean every test needed credentials and an internet
connection. `open_store` picks between them, and `/api/health` reports which
one answered, so a deployment that quietly fell back to the local file is
visible rather than discovered later.

## What is not stored

A signup that has not been confirmed. The address rides in the signed link
instead (see `tokens.py`), so an unconfirmed signup leaves no trace here and
this endpoint cannot be used to collect addresses.

An unsubscribe deletes the row outright rather than flagging it. Keeping a
tombstone would mean keeping the address of someone who asked to be
forgotten, to save a database lookup nobody needs.

## Failure

A local file does not fail; a database across the internet does. Every remote
method raises `StoreError` when it cannot answer, and callers in `main.py`
turn that into something the reader can act on. Nothing here retries forever
or pretends a write succeeded.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from .postgrest import PostgrestError, Table
from .settings import Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS subscribers (
    email          TEXT PRIMARY KEY,
    created_at     TEXT NOT NULL,
    last_sent_date TEXT,
    source         TEXT NOT NULL DEFAULT 'site'
);
"""


class StoreError(RuntimeError):
    """The list could not be read or written."""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@runtime_checkable
class SubscriberStore(Protocol):
    """Every read and write of the list, whichever backend holds it."""

    #: Which implementation this is, reported by `/api/health`.
    backend: str

    def count(self) -> int:
        """How many readers are on the list."""
        ...

    def has(self, email: str) -> bool: ...

    def is_full(self) -> bool: ...

    def due_for(self, date: str) -> list[str]:
        """Addresses that have not been sent the digest for `date`."""
        ...

    def add(self, email: str, *, source: str = "site") -> bool:
        """Put a confirmed reader on the list."""
        ...

    def remove(self, email: str) -> bool:
        """Take a reader off the list and forget the address."""
        ...

    def mark_sent(self, email: str, date: str) -> None:
        """Record that this reader has had the digest for `date`."""
        ...

    def close(self) -> None: ...


# ──────────────────────────────────────────────────────────────────────────
# Local
# ──────────────────────────────────────────────────────────────────────────


class SqliteStore:
    """The list in one file on disk.

    ## Concurrency

    One uvicorn worker, so one process, but requests run on an event loop and
    every call here is made from a threadpool. The connection is therefore
    shared with `check_same_thread=False` and guarded by one lock: SQLite will
    serialise writes regardless, and taking the lock here means a `BUSY` error
    is impossible rather than merely unlikely.
    """

    backend = "sqlite"

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
        """This is what makes a re-run harmless.

        A workflow can be dispatched twice, or retried after a half-finished
        send, and nobody gets the same digest twice.
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
        """
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
        """
        Returns:
            True if a row was deleted. A second click returns False and the
            caller still reports success, because the reader's intent is
            satisfied either way.
        """
        with self._write() as conn:
            cursor = conn.execute("DELETE FROM subscribers WHERE email = ?", (email,))
        return cursor.rowcount > 0

    def mark_sent(self, email: str, date: str) -> None:
        with self._write() as conn:
            conn.execute(
                "UPDATE subscribers SET last_sent_date = ? WHERE email = ?", (date, email)
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()


# ──────────────────────────────────────────────────────────────────────────
# Remote
# ──────────────────────────────────────────────────────────────────────────


@contextmanager
def _translated() -> Iterator[None]:
    """Turn a transport failure into the one error callers handle."""
    try:
        yield
    except PostgrestError as exc:
        raise StoreError(str(exc)) from exc


class PostgresStore:
    """The list in a Postgres table, reached over PostgREST.

    The table is shared ground: it lives in one project alongside whatever
    else this site comes to keep, which is why its name carries the project
    it belongs to rather than sitting in a database of its own.

    ## The cap, and the race in it

    `add` counts and then inserts, so two confirmations landing in the same
    instant can both see room and both take it. That overshoots the cap by
    one. It is left as it is: the cap exists to keep the list inside what one
    consumer mailbox can send, a bound that is not sensitive to a single row,
    and the alternative is a trigger that puts the same number in a second
    place where it can drift out of step with the environment.
    """

    backend = "supabase"

    def __init__(
        self,
        *,
        url: str,
        key: str,
        table: str,
        max_subscribers: int,
        timeout_s: float = 10.0,
    ) -> None:
        """
        Args:
            url: The project URL, e.g. `https://abcdefgh.supabase.co`.
            key: The service-role key. Bypasses row-level security, so it
                stays in the container's environment and never reaches a
                browser.
            table: The table holding the list.
            max_subscribers: Ceiling enforced by `add`.
            timeout_s: Per-attempt socket timeout.
        """
        self._table = Table(base_url=url, api_key=key, table=table, timeout_s=timeout_s)
        self._max = max_subscribers

    # ── Reads ─────────────────────────────────────────────────────────

    def count(self) -> int:
        with _translated():
            return self._table.count()

    def has(self, email: str) -> bool:
        with _translated():
            return self._table.exists("email", email)

    def is_full(self) -> bool:
        return self.count() >= self._max

    def due_for(self, date: str) -> list[str]:
        """Addresses that have not been sent the digest for `date`."""
        with _translated():
            rows = self._table.select(
                columns="email",
                filters=f"or=(last_sent_date.is.null,last_sent_date.neq.{date})",
                order="created_at.asc",
            )
        return [str(row["email"]) for row in rows if row.get("email")]

    # ── Writes ────────────────────────────────────────────────────────

    def add(self, email: str, *, source: str = "site") -> bool:
        with _translated():
            if self._table.exists("email", email):
                return True
            if self._table.count() >= self._max:
                return False
            self._table.insert(
                {"email": email, "created_at": _now(), "source": source},
                on_conflict="email",
            )
        return True

    def remove(self, email: str) -> bool:
        with _translated():
            return self._table.delete(filters=Table.eq("email", email)) > 0

    def mark_sent(self, email: str, date: str) -> None:
        with _translated():
            self._table.update(
                filters=Table.eq("email", email), values={"last_sent_date": date}
            )

    def close(self) -> None:
        """Nothing to close: every call is its own HTTPS request."""


# ──────────────────────────────────────────────────────────────────────────
# Choosing
# ──────────────────────────────────────────────────────────────────────────


def open_store(config: Settings) -> SubscriberStore:
    """Build the store this deployment is configured for.

    Postgres when the project URL and key are both set, the local file
    otherwise. Deliberately not the other way round: a deployment missing its
    credentials falls back to something that works, says so at `/api/health`,
    and keeps taking signups, rather than refusing every reader because a
    variable is unset.
    """
    if config.supabase_url and config.supabase_key:
        return PostgresStore(
            url=config.supabase_url,
            key=config.supabase_key,
            table=config.supabase_table,
            max_subscribers=config.max_subscribers,
            timeout_s=config.supabase_timeout_s,
        )
    return SqliteStore(config.database_path, max_subscribers=config.max_subscribers)
