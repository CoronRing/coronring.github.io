"""
What the remote subscriber list must get right.

No database is involved: `urlopen` is replaced and the requests the store
tried to make are inspected. That is the part worth testing — PostgREST is
somebody else's working software, whereas the filters, the encoding and the
decision to stop rather than guess are ours.

The one rule running through all of it: an address must never end up in an
error message, and a key must never end up anywhere at all.
"""

from __future__ import annotations

import io
import json
import urllib.error
from dataclasses import dataclass, field
from typing import Any

import pytest

from service import postgrest
from service.store import PostgresStore, StoreError

URL = "https://project.supabase.co"
KEY = "service-role-key-value"
TABLE = "newsring_subscribers"


@dataclass
class Call:
    """One request the store tried to make."""

    method: str
    url: str
    headers: dict[str, str]
    body: Any


@dataclass
class Fake:
    """A stand-in for `urlopen` that answers from a script."""

    replies: list[Any] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)

    def __call__(self, request: Any, timeout: float = 0) -> Any:
        body = None
        if request.data:
            body = json.loads(request.data)
        self.calls.append(
            Call(
                method=request.get_method(),
                url=request.full_url,
                headers={k.lower(): v for k, v in request.headers.items()},
                body=body,
            )
        )
        reply = self.replies.pop(0) if self.replies else Reply()
        if isinstance(reply, Exception):
            raise reply
        return reply


class Reply:
    """A minimal `http.client.HTTPResponse` lookalike."""

    def __init__(self, body: Any = None, *, content_range: str | None = None) -> None:
        self._raw = b"" if body is None else json.dumps(body).encode()
        self.headers = {"Content-Range": content_range} if content_range else {}

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> Reply:
        return self

    def __exit__(self, *_: object) -> bool:
        return False


def http_error(status: int, payload: dict[str, Any] | None = None) -> urllib.error.HTTPError:
    raw = json.dumps(payload or {}).encode()
    return urllib.error.HTTPError(URL, status, "nope", {}, io.BytesIO(raw))  # type: ignore[arg-type]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Fake:
    """`urlopen` replaced, and the retry backoff removed."""
    stub = Fake()
    monkeypatch.setattr("urllib.request.urlopen", stub)
    monkeypatch.setattr(postgrest.time, "sleep", lambda _: None)
    return stub


def store(max_subscribers: int = 50) -> PostgresStore:
    return PostgresStore(url=URL, key=KEY, table=TABLE, max_subscribers=max_subscribers)


# ── Reading ───────────────────────────────────────────────────────────────


def test_count_reads_the_total_out_of_the_content_range_header(fake: Fake) -> None:
    fake.replies = [Reply(content_range="*/7")]

    assert store().count() == 7

    call = fake.calls[0]
    assert call.method == "HEAD", "a count should not pull the rows down with it"
    assert call.headers["prefer"] == "count=exact"


def test_a_count_with_no_content_range_is_an_error_not_a_zero(fake: Fake) -> None:
    fake.replies = [Reply()]

    with pytest.raises(StoreError):
        store().count()


def test_due_for_asks_for_everyone_whose_last_digest_is_not_todays(fake: Fake) -> None:
    fake.replies = [Reply([{"email": "a@example.test"}, {"email": "b@example.test"}])]

    assert store().due_for("2026-11-16") == ["a@example.test", "b@example.test"]

    url = fake.calls[0].url
    assert "or=(last_sent_date.is.null,last_sent_date.neq.2026-11-16)" in url
    assert "order=created_at.asc" in url


def test_the_credential_never_appears_in_a_url(fake: Fake) -> None:
    fake.replies = [Reply(content_range="*/0")]

    store().count()

    assert KEY not in fake.calls[0].url
    assert fake.calls[0].headers["apikey"] == KEY


# ── Joining ───────────────────────────────────────────────────────────────


def test_add_inserts_a_new_address(fake: Fake) -> None:
    fake.replies = [Reply([]), Reply(content_range="*/2"), Reply()]

    assert store().add("reader@example.test", source="signup-page") is True

    insert = fake.calls[-1]
    assert insert.method == "POST"
    assert insert.body == [
        {
            "email": "reader@example.test",
            "created_at": insert.body[0]["created_at"],
            "source": "signup-page",
        }
    ]
    assert "resolution=ignore-duplicates" in insert.headers["prefer"]


def test_add_is_a_no_op_for_someone_already_on_the_list(fake: Fake) -> None:
    fake.replies = [Reply([{"email": "reader@example.test"}])]

    assert store().add("reader@example.test") is True
    assert len(fake.calls) == 1, "an existing reader should cost one lookup and nothing else"


def test_add_refuses_once_the_list_is_at_capacity(fake: Fake) -> None:
    fake.replies = [Reply([]), Reply(content_range="*/3")]

    assert store(max_subscribers=3).add("late@example.test") is False
    assert [call.method for call in fake.calls] == ["GET", "HEAD"], "nothing was written"


def test_a_plus_address_survives_the_query_string(fake: Fake) -> None:
    fake.replies = [Reply([])]

    store().has("reader+news@example.test")

    url = fake.calls[0].url
    assert "%2B" in url, "a bare + in a query string arrives as a space"
    assert "%40" in url


def test_a_filter_value_is_not_wrapped_in_quotes(fake: Fake) -> None:
    """PostgREST offers double quotes for values containing its separators,
    and they do not round-trip once percent-encoded: the filter then matches
    nothing. Nothing complains, because a filter matching no rows is a valid
    answer — so an unsubscribe would report success and leave the reader on
    the list. This is the shape that bug takes.
    """
    fake.replies = [Reply([])]

    store().has("reader@example.test")

    url = fake.calls[0].url
    assert "%22" not in url
    assert "email=eq.reader%40example.test" in url


# ── Leaving ───────────────────────────────────────────────────────────────


def test_remove_reports_whether_a_row_actually_went(fake: Fake) -> None:
    fake.replies = [Reply([{"email": "gone@example.test"}])]
    assert store().remove("gone@example.test") is True

    fake.replies = [Reply([])]
    assert store().remove("gone@example.test") is False


def test_remove_asks_for_the_deleted_row_so_it_can_tell(fake: Fake) -> None:
    fake.replies = [Reply([{"email": "gone@example.test"}])]

    store().remove("gone@example.test")

    call = fake.calls[0]
    assert call.method == "DELETE"
    assert call.headers["prefer"] == "return=representation"


def test_mark_sent_updates_only_that_reader(fake: Fake) -> None:
    fake.replies = [Reply()]

    store().mark_sent("reader@example.test", "2026-11-16")

    call = fake.calls[0]
    assert call.method == "PATCH"
    assert call.body == {"last_sent_date": "2026-11-16"}
    assert "email=eq." in call.url


# ── When it goes wrong ────────────────────────────────────────────────────


def test_a_refusal_becomes_a_store_error(fake: Fake) -> None:
    fake.replies = [http_error(401, {"code": "42501", "message": "permission denied"})]

    with pytest.raises(StoreError) as caught:
        store().count()

    assert "401" in str(caught.value)


def test_a_refusal_is_not_retried(fake: Fake) -> None:
    fake.replies = [http_error(400, {"code": "22P02"})]

    with pytest.raises(StoreError):
        store().count()

    assert len(fake.calls) == 1, "repeating a rejected request cannot make it valid"


def test_an_error_quotes_neither_the_address_nor_the_key(fake: Fake) -> None:
    fake.replies = [
        http_error(
            409,
            {
                "code": "23505",
                "message": "duplicate key value violates unique constraint",
                "details": "Key (email)=(reader@example.test) already exists.",
                "hint": KEY,
            },
        )
    ]

    with pytest.raises(StoreError) as caught:
        store().add("reader@example.test")

    message = str(caught.value)
    assert "reader@example.test" not in message
    assert KEY not in message
    assert "23505" in message, "the machine-readable code is safe and worth keeping"


def test_an_unreachable_database_is_retried_and_then_reported(fake: Fake) -> None:
    fake.replies = [urllib.error.URLError("no route to host")] * postgrest.ATTEMPTS

    with pytest.raises(StoreError) as caught:
        store().count()

    assert len(fake.calls) == postgrest.ATTEMPTS
    assert "could not be reached" in str(caught.value)


def test_a_transient_failure_is_survived(fake: Fake) -> None:
    fake.replies = [urllib.error.URLError("connection reset"), Reply(content_range="*/4")]

    assert store().count() == 4
    assert len(fake.calls) == 2
