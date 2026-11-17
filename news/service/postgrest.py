"""
A very small PostgREST client, built on `urllib`.

Supabase puts PostgREST in front of its Postgres, which means a table can be
read and written over ordinary HTTPS with a bearer token. That is the only
reason this service can keep a remote database without taking a dependency:
there is no driver here, no connection pool and no ORM, just JSON over HTTP
from the standard library, the same way `digest.py` fetches the digest.

## What this is not

It is not a Supabase SDK and it does not try to be. It knows five verbs
against one table, which is everything `store.py` asks for. Anything more
belongs in a migration, where the database can enforce it.

## Errors

Every failure becomes `PostgrestError`, and the message carries the HTTP
status and PostgREST's own error `code` and nothing else. The body of a
PostgREST error can quote the row that caused it, and a row here is a
subscriber's address — it must not reach a log that an operator pastes into
an issue.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

#: Attempts per call, including the first. A free-tier database scales to
#: zero and the first request after an idle spell can be the one that wakes
#: it, so a single transient failure must not lose a subscription.
ATTEMPTS = 3

#: Seconds between attempts. Short: a reader is waiting on the other end of
#: every call except the broadcast.
BACKOFF_S = 0.75


class PostgrestError(RuntimeError):
    """A request to the database did not succeed."""


def _value(value: str) -> str:
    """Encode a value for use in a PostgREST filter.

    Percent-encoded with nothing left safe, which is what makes `+` arrive as
    a plus rather than a space and `%` as a literal percent — both legal in
    the local part of an address.

    Not additionally wrapped in double quotes. PostgREST offers that for
    values containing its own separators, but it does not round-trip once the
    quotes are percent-encoded too, and the filter then matches nothing at
    all — silently, since a filter matching no rows is not an error. The
    quoting is unnecessary here regardless: `security.normalize_email` admits
    only letters, digits and `._%+-@`, so none of PostgREST's separators can
    reach this function.
    """
    return urllib.parse.quote(value, safe="")


class Table:
    """One table, reachable over HTTPS."""

    def __init__(self, *, base_url: str, api_key: str, table: str, timeout_s: float = 10.0) -> None:
        """
        Args:
            base_url: The project URL, e.g. `https://abcdefgh.supabase.co`.
            api_key: A key that may read and write the table. In this service
                that is the service-role key, which bypasses row-level
                security — it lives only in the container's environment and
                never reaches a browser.
            table: The table name, in the schema PostgREST exposes.
            timeout_s: Per-attempt socket timeout.
        """
        base = base_url.rstrip("/")
        if not base.startswith("https://"):
            # Every request carries the key in a header. Over plain HTTP that
            # is a credential handed to anything on the path, so this refuses
            # rather than letting a mistyped variable leak it quietly.
            raise ValueError("the database URL must be https")
        self._endpoint = f"{base}/rest/v1/{urllib.parse.quote(table)}"
        self._key = api_key
        self._timeout = timeout_s

    # ── Plumbing ──────────────────────────────────────────────────────

    def _call(
        self,
        method: str,
        *,
        query: str = "",
        body: Any = None,
        prefer: str = "",
    ) -> tuple[list[dict[str, Any]], int | None]:
        """Make one request, with retries.

        Returns:
            The decoded rows (empty when the caller asked for none) and the
            total row count when `count=exact` was requested, else None.
        """
        url = f"{self._endpoint}?{query}" if query else self._endpoint
        payload = json.dumps(body).encode() if body is not None else None

        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer

        last: Exception | None = None
        for attempt in range(ATTEMPTS):
            request = urllib.request.Request(  # noqa: S310 - https enforced in __init__
                url, data=payload, headers=headers, method=method
            )
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
                    raw = response.read()
                    total = _total(response.headers.get("Content-Range"))
                    return _rows(raw), total
            except urllib.error.HTTPError as exc:
                # A 4xx is the database telling us the request was wrong.
                # Repeating it will not make it right.
                raise PostgrestError(_describe(exc)) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = exc
                if attempt + 1 < ATTEMPTS:
                    time.sleep(BACKOFF_S * (attempt + 1))

        raise PostgrestError(
            f"the database could not be reached after {ATTEMPTS} attempts "
            f"({type(last).__name__})"
        )

    # ── Verbs ─────────────────────────────────────────────────────────

    def select(self, *, columns: str = "*", filters: str = "", order: str = "") -> list[dict]:
        """Rows matching `filters`."""
        parts = [f"select={urllib.parse.quote(columns, safe='*,')}"]
        if filters:
            parts.append(filters)
        if order:
            parts.append(f"order={urllib.parse.quote(order, safe='.,')}")
        rows, _ = self._call("GET", query="&".join(parts))
        return rows

    def count(self) -> int:
        """How many rows the table holds.

        A HEAD request: PostgREST answers the count in `Content-Range` and
        sends no body, so this costs one round trip and nothing else.
        """
        _, total = self._call("HEAD", query="select=*", prefer="count=exact")
        if total is None:
            raise PostgrestError("the database did not report a row count")
        return total

    def exists(self, column: str, value: str) -> bool:
        rows = self.select(columns=column, filters=self.eq(column, value))
        return bool(rows)

    def insert(self, row: dict[str, Any], *, on_conflict: str = "") -> None:
        """Add a row, treating an existing one as success.

        `resolution=ignore-duplicates` makes a repeated confirmation click a
        no-op at the database rather than a 409 this code would have to
        unpick.
        """
        query = f"on_conflict={urllib.parse.quote(on_conflict)}" if on_conflict else ""
        prefer = "return=minimal"
        if on_conflict:
            prefer = f"resolution=ignore-duplicates,{prefer}"
        self._call("POST", query=query, body=[row], prefer=prefer)

    def update(self, *, filters: str, values: dict[str, Any]) -> None:
        self._call("PATCH", query=filters, body=values, prefer="return=minimal")

    def delete(self, *, filters: str) -> int:
        """Remove rows and report how many went.

        `return=representation` so the caller can tell a deletion from a
        second click on the same unsubscribe link.
        """
        rows, _ = self._call("DELETE", query=filters, prefer="return=representation")
        return len(rows)

    @staticmethod
    def eq(column: str, value: str) -> str:
        """A filter fragment matching one value exactly."""
        return f"{column}=eq.{_value(value)}"


# ──────────────────────────────────────────────────────────────────────────
# Decoding
# ──────────────────────────────────────────────────────────────────────────


def _rows(raw: bytes) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PostgrestError("the database sent something that was not JSON") from exc
    if isinstance(decoded, list):
        return [row for row in decoded if isinstance(row, dict)]
    if isinstance(decoded, dict):
        return [decoded]
    return []


def _total(content_range: str | None) -> int | None:
    """Read the total out of a `Content-Range: 0-24/137` header."""
    if not content_range or "/" not in content_range:
        return None
    tail = content_range.rsplit("/", 1)[1].strip()
    if not tail.isdigit():
        return None
    return int(tail)


def _describe(exc: urllib.error.HTTPError) -> str:
    """A safe one-line account of a failed request.

    PostgREST's `message`, `details` and `hint` can all quote the offending
    row, so only the status and the machine-readable `code` are kept.
    """
    code = ""
    try:
        body = json.loads(exc.read() or b"{}")
        if isinstance(body, dict) and isinstance(body.get("code"), str):
            code = body["code"]
    except (json.JSONDecodeError, OSError, ValueError):
        code = ""
    suffix = f", code {code}" if code else ""
    return f"the database refused the request: HTTP {exc.code}{suffix}"
