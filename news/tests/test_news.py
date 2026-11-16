"""
What this service must get right, and what it must refuse.

No SMTP server is involved: the mailer is replaced and the messages it was
handed are inspected. That is the interesting part anyway — what matters is
*who* gets mail and *what headers it carries*, not that `smtplib` works.

The settings are set before `service.main` is imported, because the service
reads its environment once at import time, exactly as it does in production.
"""

from __future__ import annotations

import importlib
import json
import os
from collections.abc import Iterator
from email.message import EmailMessage
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

DIGEST = {
    "version": 1,
    "date": "2026-11-16",
    "subject": "NewsRing: A quiet Sunday in AI",
    "unsubscribe_placeholder": "{{UNSUBSCRIBE_URL}}",
    "html": "<p>today</p><a href='{{UNSUBSCRIBE_URL}}'>Unsubscribe</a>",
    "text": "today\n\nUnsubscribe: {{UNSUBSCRIBE_URL}}",
}

BROADCAST_TOKEN = "broadcast-token"
PUBLIC_BASE = "https://host.test/news"
SITE = "https://site.test/newsring"


@pytest.fixture
def service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple]:
    """A fresh service, its own database, and the messages it tried to send."""
    env = {
        "NEWS_DATABASE_PATH": str(tmp_path / "news.db"),
        "NEWS_TOKEN_SECRET": "signing-secret",
        "NEWS_BROADCAST_TOKEN": BROADCAST_TOKEN,
        "NEWS_DIGEST_URL": "https://site.test/NewsRing/broadcast_today.json",
        "NEWS_SMTP_USER": "sender@example.test",
        "NEWS_SMTP_PASSWORD": "app-password",
        "NEWS_PUBLIC_BASE": PUBLIC_BASE,
        "NEWS_SITE_URL": SITE,
        "NEWS_MAX_SUBSCRIBERS": "3",
        "NEWS_RATE_LIMIT_PER_MIN": "60",
        "NEWS_RATE_LIMIT_BURST": "60",
        "NEWS_ADDRESS_COOLDOWN_S": "900",
        "NEWS_DIGEST_CACHE_S": "0",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    from service import digest as digest_module
    from service import mailer, security
    from service import settings as settings_module

    importlib.reload(settings_module)
    importlib.reload(security)
    importlib.reload(mailer)
    importlib.reload(digest_module)
    import service.main as main

    importlib.reload(main)

    sent: list[EmailMessage] = []

    def fake_send_one(message: EmailMessage) -> None:
        sent.append(message)

    class FakeSession:
        def send_message(self, message: EmailMessage) -> None:
            sent.append(message)

    class FakeConnection:
        def __enter__(self) -> FakeSession:
            return FakeSession()

        def __exit__(self, *exc: object) -> bool:
            return False

    monkeypatch.setattr(main.mailer, "send_one", fake_send_one)
    monkeypatch.setattr(main.mailer, "connection", lambda: FakeConnection())
    monkeypatch.setattr(
        main.source, "_fetch", lambda: digest_module._parse(json.dumps(DIGEST).encode())
    )

    with TestClient(main.app) as client:
        yield client, sent, main


def link_in(message: EmailMessage, marker: str) -> str:
    """Pull the first URL containing `marker` out of a message body."""
    body = message.get_body(preferencelist=("plain",))
    assert body is not None
    text = body.get_content()
    for word in text.replace("<", " ").replace(">", " ").split():
        if marker in word:
            return word.rstrip(".,")
    raise AssertionError(f"no {marker} link in {text!r}")


# ── Joining ───────────────────────────────────────────────────────────────


def test_a_signup_stores_nothing_and_mails_a_confirmation(service: tuple) -> None:
    client, sent, main = service

    response = client.post("/api/subscribe", json={"email": "Reader@Example.TEST"})

    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    # The whole point: an unconfirmed signup leaves no record of the address.
    assert main.store.count() == 0
    assert len(sent) == 1
    assert sent[0]["To"] == "Reader@example.test"


def test_confirming_joins_the_list_and_sends_today(service: tuple) -> None:
    client, sent, main = service
    client.post("/api/subscribe", json={"email": "reader@example.test"})
    confirm_url = link_in(sent[0], "/api/confirm")

    response = client.get(confirm_url.removeprefix(PUBLIC_BASE), follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == f"{SITE}?state=confirmed"
    assert main.store.count() == 1
    digest = sent[1]
    assert digest["Subject"] == DIGEST["subject"]
    assert "List-Unsubscribe-Post" in digest
    assert "{{UNSUBSCRIBE_URL}}" not in digest.get_body(preferencelist=("plain",)).get_content()


def test_the_honeypot_is_answered_like_a_real_signup(service: tuple) -> None:
    client, sent, main = service

    response = client.post(
        "/api/subscribe", json={"email": "bot@example.test", "website": "https://spam.test"}
    )

    assert response.json()["status"] == "pending"
    assert sent == []
    assert main.store.count() == 0


def test_the_same_address_is_not_mailed_twice_in_its_window(service: tuple) -> None:
    client, sent, _ = service

    for _ in range(4):
        client.post("/api/subscribe", json={"email": "reader@example.test"})

    assert len(sent) == 1


@pytest.mark.parametrize(
    "bad", ["", "   ", "not-an-address", "a@b", "a b@example.test", "a@example.test\nBcc: x@y.z"]
)
def test_an_address_that_is_not_one_is_refused(service: tuple, bad: str) -> None:
    client, sent, _ = service
    assert client.post("/api/subscribe", json={"email": bad}).status_code == 400
    assert sent == []


def test_the_list_closes_at_its_cap(service: tuple) -> None:
    client, sent, main = service
    for n in range(3):
        main.store.add(f"r{n}@example.test")

    response = client.post("/api/subscribe", json={"email": "late@example.test"})

    assert response.json()["status"] == "full"
    assert sent == []


# ── Leaving ───────────────────────────────────────────────────────────────


def test_unsubscribing_forgets_the_address(service: tuple) -> None:
    client, sent, main = service
    client.post("/api/subscribe", json={"email": "reader@example.test"})
    client.get(link_in(sent[0], "/api/confirm").removeprefix(PUBLIC_BASE), follow_redirects=False)
    unsubscribe_url = link_in(sent[1], "/api/unsubscribe").removeprefix(PUBLIC_BASE)

    response = client.get(unsubscribe_url, follow_redirects=False)

    assert response.headers["location"] == f"{SITE}?state=unsubscribed"
    assert main.store.count() == 0


def test_one_click_unsubscribe_answers_plainly(service: tuple) -> None:
    client, sent, main = service
    client.post("/api/subscribe", json={"email": "reader@example.test"})
    client.get(link_in(sent[0], "/api/confirm").removeprefix(PUBLIC_BASE), follow_redirects=False)
    unsubscribe_url = link_in(sent[1], "/api/unsubscribe").removeprefix(PUBLIC_BASE)

    response = client.post(unsubscribe_url)

    assert response.status_code == 200
    assert main.store.count() == 0
    # A mail provider acting on a stale token must still see success.
    assert client.post("/api/unsubscribe?token=rubbish").status_code == 200


def test_a_confirmation_token_cannot_unsubscribe(service: tuple) -> None:
    """Purposes are separate, or a signup form becomes a removal form."""
    client, sent, main = service
    client.post("/api/subscribe", json={"email": "reader@example.test"})
    client.get(link_in(sent[0], "/api/confirm").removeprefix(PUBLIC_BASE), follow_redirects=False)
    confirm_token = link_in(sent[0], "/api/confirm").split("token=")[1]

    response = client.get(f"/api/unsubscribe?token={confirm_token}", follow_redirects=False)

    assert response.headers["location"] == f"{SITE}?state=invalid"
    assert main.store.count() == 1


def test_a_tampered_token_is_refused(service: tuple) -> None:
    client, sent, main = service
    client.post("/api/subscribe", json={"email": "reader@example.test"})
    token = link_in(sent[0], "/api/confirm").split("token=")[1]
    forged = token[:-4] + ("aaaa" if not token.endswith("aaaa") else "bbbb")

    response = client.get(f"/api/confirm?token={forged}", follow_redirects=False)

    assert response.headers["location"] == f"{SITE}?state=invalid"
    assert main.store.count() == 0


# ── The daily send ────────────────────────────────────────────────────────


def test_broadcast_needs_the_bearer_token(service: tuple) -> None:
    client, _, _ = service

    assert client.post("/api/broadcast", json={}).status_code == 401
    assert (
        client.post(
            "/api/broadcast", json={}, headers={"Authorization": "Bearer wrong"}
        ).status_code
        == 401
    )


def test_broadcast_sends_once_per_reader_per_digest(service: tuple) -> None:
    client, sent, main = service
    for n in range(3):
        main.store.add(f"r{n}@example.test")
    auth = {"Authorization": f"Bearer {BROADCAST_TOKEN}"}

    first = client.post("/api/broadcast", json={"date": DIGEST["date"]}, headers=auth)
    second = client.post("/api/broadcast", json={"date": DIGEST["date"]}, headers=auth)

    assert first.json() == {"date": DIGEST["date"], "sent": 3, "skipped": 0, "failed": 0}
    # A re-run of the workflow must not mail anyone a second time.
    assert second.json()["sent"] == 0
    assert len(sent) == 3


def test_each_reader_gets_their_own_unsubscribe_link(service: tuple) -> None:
    client, sent, main = service
    main.store.add("one@example.test")
    main.store.add("two@example.test")

    client.post(
        "/api/broadcast",
        json={"date": DIGEST["date"]},
        headers={"Authorization": f"Bearer {BROADCAST_TOKEN}"},
    )

    links = {link_in(message, "/api/unsubscribe") for message in sent}
    assert len(links) == 2
    # One message per reader, so nobody sees anyone else's address.
    assert [message["To"] for message in sent] == ["one@example.test", "two@example.test"]


def test_a_stale_site_is_refused_rather_than_mailed(service: tuple) -> None:
    """The workflow says what it published; a mismatch means the deploy lagged."""
    client, sent, main = service
    main.store.add("reader@example.test")

    response = client.post(
        "/api/broadcast",
        json={"date": "2026-11-17"},
        headers={"Authorization": f"Bearer {BROADCAST_TOKEN}"},
    )

    assert response.status_code == 503
    assert sent == []


# ── Introspection ─────────────────────────────────────────────────────────


def test_health_reports_capacity_without_naming_anyone(service: tuple) -> None:
    client, _, main = service
    main.store.add("reader@example.test")

    payload = client.get("/api/health").json()

    assert payload["status"] == "ok"
    assert payload["subscribers"] == 1
    assert payload["capacity"] == 3
    assert payload["open"] is True
    assert "reader@example.test" not in json.dumps(payload)


def test_an_unconfigured_deployment_refuses_rather_than_pretending(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("NEWS_TOKEN_SECRET", "NEWS_BROADCAST_TOKEN", "NEWS_DIGEST_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("NEWS_DATABASE_PATH", str(tmp_path / "news.db"))

    from service import settings as settings_module

    importlib.reload(settings_module)
    import service.main as main

    importlib.reload(main)

    with TestClient(main.app) as client:
        assert client.get("/api/health").json()["status"] == "degraded"
        assert client.post("/api/subscribe", json={"email": "a@example.test"}).status_code == 503


def test_os_environ_is_restored() -> None:
    """A guard: these tests reload modules, so a leaked variable would be invisible."""
    assert "NEWS_TOKEN_SECRET" not in os.environ
