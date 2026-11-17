"""
End-to-end check against the real database and the real mailbox.

The test suite next door replaces both of them, which is what makes it fast
and what makes it blind in one specific place: a stand-in database has no
opinion about whether a query is well formed, and a stand-in mailer never
logs in, so neither can fail the way the real ones do. Two bugs have already
lived in exactly that gap — a filter that matched nothing and reported
success, and a password that arrived at the provider with a comment attached
— and both were invisible until the service was pointed at the real thing.

So this runs the actual app over HTTP and walks a reader through the whole
journey: signup, confirmation, the welcome digest, a broadcast, an
unsubscribe, and a forged link. Nothing here is mocked unless `--no-mail`
asks for it.

## What it costs

It writes to the live table and, by default, sends real mail. The test
address is the sending mailbox's own `+newsring-e2e` tag, so the messages
land back in the mailbox they came from and no stranger is involved. The row
it adds is deleted again, even when a check fails.

It will not broadcast while anyone else is on the list. A broadcast goes to
every reader whose last digest is not today's, which on a populated list
means real people get mail because someone ran a test; those two steps are
skipped instead, and the rest of the run is unaffected.

## Running it

From this directory, with the service's dependencies plus httpx::

    .venv\\Scripts\\python.exe live_check.py
    .venv\\Scripts\\python.exe live_check.py --no-mail

Credentials come from the environment, or from the operator's `.env` beside
the repository — the same file `infra/configure.py` reads. Nothing secret is
printed: addresses are masked and values are only ever used.
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from email.message import EmailMessage
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

#: The operator's own `.env`, one level above the repository. The deploy
#: script reads the same file; this keeps the two runs configured alike.
LOCAL_ENV = REPO.parent / ".env"

#: NewsRing's published message for the day. The service fetches this in
#: production too, so a run also proves the document is reachable and parses.
DIGEST_URL = "https://coronring.github.io/NewsRing/broadcast_today.json"

#: The tag added to the mailbox's own address. Plus-addressing delivers to
#: the same inbox, so a test subscriber is a real deliverable address that
#: belongs to this project rather than to a person.
TAG = "newsring-e2e"

log = logging.getLogger("live-check")


# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────


def scalar(line: str) -> str:
    """The value on one `.env` line, unwrapped and nothing more.

    A quoted value ends at its closing quote and an unquoted one ends at the
    first ``' #'``, so the note an operator writes beside a password is not
    read as part of it. Inner spaces survive, because an app password is
    printed with them.

    This is the rule `infra/configure.py` applies when it writes the same
    values onto the host; a run configured by a laxer parser would be testing
    something the deployment never sees.
    """
    value = line.split("=", 1)[1].strip()
    if value[:1] in {'"', "'"}:
        closing = value.find(value[0], 1)
        if closing != -1:
            return value[1:closing]
    return value.split(" #", 1)[0].strip()


def operator_env() -> dict[str, str]:
    """Every name in the operator's `.env`, or an empty mapping if absent."""
    if not LOCAL_ENV.is_file():
        return {}
    found: dict[str, str] = {}
    for line in LOCAL_ENV.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        found[stripped.split("=", 1)[0].strip()] = scalar(stripped)
    return found


def pick(env: dict[str, str], *names: str) -> str:
    """First non-empty value among `names`, process environment first."""
    for name in names:
        value = os.environ.get(name, "") or env.get(name, "")
        if value.strip():
            return value.strip()
    return ""


def mask(address: str) -> str:
    """An address recognisable to its owner and useless to anyone else.

    The `+tag` survives, because it is what distinguishes this run's
    subscriber from a real one and it identifies nobody.
    """
    local, _, domain = address.partition("@")
    name, plus, tag = local.partition("+")
    return f"{name[:1]}***{plus}{tag}@{domain}"


def configure(port: int, digest_url: str) -> str:
    """Put the service's settings in the environment and name the subscriber.

    Must run before the service is imported: its settings are read once, at
    import, and a later change would not reach it.

    Returns:
        The address this run will subscribe.

    Raises:
        SystemExit: when something required is missing, naming it.
    """
    env = operator_env()
    mailbox = pick(env, "NEWS_SMTP_USER", "NEWSRING_MAIL_ADDRESS", "EMALIA_ADDRESS")
    values = {
        "NEWS_SMTP_USER": mailbox,
        "NEWS_SMTP_PASSWORD": pick(
            env, "NEWS_SMTP_PASSWORD", "NEWSRING_MAIL_PASSWORD", "GOOGLE_APP_PASSWORD"
        ),
        "NEWS_TOKEN_SECRET": pick(env, "NEWS_TOKEN_SECRET"),
        "NEWS_BROADCAST_TOKEN": pick(env, "NEWS_BROADCAST_TOKEN", "NEWSRING_BROADCAST_TOKEN"),
        "NEWS_SUPABASE_URL": pick(env, "NEWS_SUPABASE_URL", "SUPABASE_URL"),
        "NEWS_SUPABASE_KEY": pick(env, "NEWS_SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise SystemExit(
            f"nothing to check: {', '.join(missing)} is unset.\n"
            f"Add it to {LOCAL_ENV} or the environment."
        )

    values["NEWS_DIGEST_URL"] = digest_url
    # Links in mail are built from this, so a confirmation sent by a run works
    # for as long as the run lasts and is dead afterwards. That is the right
    # outcome: these messages are evidence, not something to click.
    values["NEWS_PUBLIC_BASE"] = f"http://127.0.0.1:{port}"
    values["NEWS_SUPABASE_TABLE"] = pick(env, "NEWS_SUPABASE_TABLE") or "newsring_subscribers"
    values["NEWS_LOG_LEVEL"] = "info"
    os.environ.update(values)

    local, _, domain = mailbox.partition("@")
    return f"{local}+{TAG}@{domain}"


# ──────────────────────────────────────────────────────────────────────────
# The run
# ──────────────────────────────────────────────────────────────────────────


class Report:
    """What passed, what failed, and nothing that would identify a reader."""

    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
        if not ok:
            self.failures.append(label)
        return ok

    def note(self, text: str) -> None:
        print(f"  [SKIP] {text}")


def step(name: str) -> None:
    print(f"\n=== {name} " + "=" * max(2, 62 - len(name)))


class Outbox:
    """Stands in for the mailbox when `--no-mail` is given.

    Messages are still built by the real code and addressed for real readers;
    only the SMTP session is missing. That keeps the database half of this
    runnable at any time, on any machine, without spending the mailbox's
    reputation to find out that a filter is wrong.
    """

    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []

    def send_message(self, message: EmailMessage) -> None:
        self.messages.append(message)


def instrument(mailer: Any, outbox: Outbox | None) -> None:
    """Announce every message, and optionally stop it leaving.

    The real functions still run when `outbox` is None: this only adds the
    log line that makes a send visible, because a successful send is
    otherwise silent and silence is what both past bugs looked like.
    """
    build = mailer.build
    send_one = mailer.send_one

    def announced_build(**kwargs: Any) -> EmailMessage:
        message = build(**kwargs)
        log.info("composed for %s | %s", mask(str(message["To"])), str(message["Subject"])[:58])
        return message

    def announced_send(message: EmailMessage) -> None:
        if outbox is not None:
            outbox.send_message(message)
            log.info("not sent (--no-mail)")
            return
        started = time.monotonic()
        send_one(message)
        log.info("accepted by the provider in %.1fs", time.monotonic() - started)

    mailer.build = announced_build
    mailer.send_one = announced_send

    if outbox is not None:

        @contextmanager
        def offline() -> Iterator[Outbox]:
            yield outbox

        mailer.connection = offline


def serve(app: Any, port: int) -> Any:
    """Run the app on localhost in a background thread."""
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(150):
        if server.started:
            return server
        time.sleep(0.1)
    raise SystemExit("the service did not start")


def run(address: str, port: int, offline: bool) -> int:
    """Walk one reader through the whole journey. Returns an exit code."""
    import httpx

    sys.path.insert(0, str(HERE))
    # Imported here rather than at the top: the service reads its settings
    # once, at import, and `configure` has only just put them in place.
    from service import mailer, postgrest
    from service.main import app
    from service.settings import settings

    instrument(mailer, Outbox() if offline else None)

    table = postgrest.Table(
        base_url=settings.supabase_url,
        api_key=settings.supabase_key,
        table=settings.supabase_table,
        timeout_s=settings.supabase_timeout_s,
    )
    mine = table.eq("email", address)

    def row() -> dict[str, Any] | None:
        found = table.select(filters=mine)
        return found[0] if found else None

    report = Report()
    server = serve(app, port)
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=180) as client:
            _journey(client, table, mine, row, address, offline, report)
    finally:
        server.should_exit = True
        removed = table.delete(filters=mine)
        if removed:
            print(f"\n  cleaned up {removed} leftover row(s) for the test address")

    outcome = "All live checks passed." if not report.failures else f"FAILED: {report.failures}"
    print(f"\n{outcome}")
    return 1 if report.failures else 0


def _journey(
    client: Any,
    table: Any,
    mine: str,
    row: Any,
    address: str,
    offline: bool,
    report: Report,
) -> None:
    """The sequence itself, with the service already listening."""
    shown = mask(address)

    step("health")
    health = client.get("/api/health").json()
    print(f"  store={health['store']} subscribers={health['subscribers']}")
    print(f"  digest={health['digest']}")
    report.check("the Supabase backend answered", health["store"]["backend"] == "supabase")
    report.check("the table is reachable", health["store"]["reachable"] is True)
    report.check("nothing is unconfigured", not health["missing"], str(health["missing"]))

    # A row left by an interrupted run would make every check below pass for
    # the wrong reason, so the run starts from a known-empty state.
    table.delete(filters=mine)
    others = table.count()
    print(f"  {others} other subscriber(s) on the list")

    step(f"subscribe as {shown}")
    reply = client.post("/api/subscribe", json={"email": address})
    report.check("the signup was accepted", reply.status_code == 200, reply.text[:120])
    report.check("nothing was stored yet", table.count() == others, "confirmation is still pending")

    step("confirm")
    # Minted here rather than read out of the inbox, by the same call that
    # puts it in the mail: this checks the service, not an IMAP client.
    token = tokens_issue("confirm", address, ttl_s=172800)
    reply = client.get("/api/confirm", params={"token": token}, follow_redirects=False)
    landing = reply.headers.get("location", "")
    print(f"  -> {landing}")
    report.check("the reader lands on the confirmed page", landing.endswith("state=confirmed"))
    record = row()
    report.check("the row is in Postgres", record is not None)
    report.check(
        "the welcome digest was recorded as sent",
        bool(record and record.get("last_sent_date")),
        str(record and record.get("last_sent_date")),
    )

    auth = {"Authorization": f"Bearer {os.environ['NEWS_BROADCAST_TOKEN']}"}
    if others:
        report.note(
            f"broadcast not attempted: {others} other reader(s) would be mailed by it. "
            "Everything else still ran."
        )
    else:
        step("broadcast, with today's digest already sent")
        body = client.post("/api/broadcast", json={"date": ""}, headers=auth).json()
        print(f"  {body}")
        report.check("nobody is mailed twice", body["sent"] == 0 and body["skipped"] == 1)

        step("broadcast, with the reader due")
        table.update(filters=mine, values={"last_sent_date": None})
        body = client.post("/api/broadcast", json={"date": ""}, headers=auth).json()
        print(f"  {body}")
        report.check("the digest went out", body["sent"] == 1 and body["failed"] == 0)
        record = row()
        report.check(
            "the send was recorded",
            bool(record) and record is not None and record["last_sent_date"] == body["date"],
        )

    step("unsubscribe")
    out = tokens_issue("unsubscribe", address)
    reply = client.get("/api/unsubscribe", params={"token": out}, follow_redirects=False)
    landing = reply.headers.get("location", "")
    print(f"  -> {landing}")
    report.check("the reader is told they are off the list", landing.endswith("state=unsubscribed"))
    report.check("the row is gone", row() is None)

    step("unsubscribe again")
    reply = client.get("/api/unsubscribe", params={"token": out}, follow_redirects=False)
    landing = reply.headers.get("location", "")
    report.check("a second click says the same thing", landing.endswith("state=unsubscribed"))
    report.check("and still leaves no row", row() is None)

    step("a tampered link")
    forged = out[:-2] + ("xy" if not out.endswith("xy") else "ab")
    reply = client.get("/api/unsubscribe", params={"token": forged}, follow_redirects=False)
    landing = reply.headers.get("location", "")
    report.check("a forged token is refused", landing.endswith("state=invalid"), landing)

    step("where the list ended up")
    total = table.count()
    print(f"  {total} subscriber(s), started at {others}")
    report.check("the list is as it was found", total == others)
    if offline:
        report.note("no mail was sent; run without --no-mail to check the mailbox too")


def tokens_issue(purpose: str, email: str, *, ttl_s: int | None = None) -> str:
    """Issue a link token the way the service does when it writes a mail."""
    from service import tokens

    return tokens.issue(purpose, email, ttl_s=ttl_s)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the subscriptions service against the real database and mailbox."
    )
    parser.add_argument(
        "--no-mail",
        action="store_true",
        help="build every message but send none, leaving only the database live",
    )
    parser.add_argument("--port", type=int, default=8099, help="localhost port for the run")
    parser.add_argument("--digest-url", default=DIGEST_URL, help="the published digest to send")
    parser.add_argument(
        "--address",
        default="",
        help=f"subscribe this address instead of the mailbox's own +{TAG} tag",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s"
    )
    # One request per step is already printed as a step; httpx repeating it at
    # INFO doubles the output and buries the checks.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # Logging goes to stderr unbuffered while print goes to a block-buffered
    # stdout, so through a pipe the two arrive in the wrong order. This is a
    # transcript of a sequence; the order is the point.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)
    address = configure(args.port, args.digest_url) or ""
    if args.address:
        address = args.address
    return run(address, args.port, args.no_mail)


if __name__ == "__main__":
    raise SystemExit(main())
