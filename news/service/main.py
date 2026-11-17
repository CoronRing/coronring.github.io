"""
NewsRing subscriptions — the public mailing list for the daily AI digest.

NewsRing itself writes one digest a day and publishes it. This service is the
only part of that system that knows who reads it: it takes signups from the
site, confirms them, holds the list, and sends each morning's digest out when
the NewsRing workflow says a new one is published.

Everyone gets the identical digest. That is what keeps this small: there is no
per-reader rendering, no profile and no model call here. One document is
fetched, one string is substituted per reader (their unsubscribe link), and
the rest is SMTP.

Route map
---------
  GET  /api/health       liveness, configuration, list size, digest date
  GET  /api/status       everything /health has, plus counters
  POST /api/subscribe    an address -> a confirmation mail. Stores nothing.
  GET  /api/confirm      a signed link -> on the list, today's digest sent
  GET  /api/unsubscribe  a signed link -> off the list, address forgotten
  POST /api/unsubscribe  the same, for one-click unsubscribe in mail clients
  POST /api/broadcast    bearer token -> today's digest to the whole list

The service is mounted at `/news` by Caddy, so from outside these are
`https://<host>/news/api/...`.

Why confirmation is not optional
--------------------------------
Anyone can type anyone's address into a form. Without a confirmation step this
service would mail a stranger on a stranger's say-so, daily, and the sending
address would wear it. Confirmation also means nothing is stored until a
person has proved the address is theirs, so an abusive signup leaves no record
at all — see `store.py` and `tokens.py`.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import quote, urlencode

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from . import mailer, messages, security, tokens
from .digest import DigestError, source
from .schemas import (
    BroadcastRequest,
    BroadcastResponse,
    SubscribeRequest,
    SubscribeResponse,
)
from .settings import settings
from .store import StoreError, open_store

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("newsring-subscriptions")

store = open_store(settings)

#: One broadcast at a time. Two overlapping sends would both read the same
#: "not yet sent" list and mail half the readers twice.
_broadcast_lock = asyncio.Lock()

#: Counters, in memory. Enough to answer "is it working" without keeping any
#: record of who did what.
_metrics = {"confirmations_sent": 0, "confirmed": 0, "unsubscribed": 0, "digests_sent": 0}

CONFIRM = "confirm"
UNSUBSCRIBE = "unsubscribe"


# ──────────────────────────────────────────────────────────────────────────
# Links
# ──────────────────────────────────────────────────────────────────────────


def _link(path: str, token: str) -> str:
    """An absolute link back into this service.

    Built from `NEWS_PUBLIC_BASE` rather than from the request, because every
    request arrives through a proxy that has already stripped the prefix this
    service is mounted under: a link built from what the app sees would drop
    `/news` and 404.
    """
    return f"{settings.public_base}/api/{path}?token={quote(token, safe='')}"


def _site(state: str) -> str:
    """Where a reader lands after clicking, in the site's own design."""
    return f"{settings.site_url}?{urlencode({'state': state})}"


def _unsubscribe_url(email: str) -> str:
    return _link(UNSUBSCRIBE, tokens.issue(UNSUBSCRIBE, email, ttl_s=None))


# ──────────────────────────────────────────────────────────────────────────
# Sending
# ──────────────────────────────────────────────────────────────────────────


def _send_confirmation(email: str) -> None:
    """Blocking. Called from a threadpool."""
    token = tokens.issue(CONFIRM, email, ttl_s=settings.confirm_ttl_s)
    url = _link(CONFIRM, token)
    mailer.send_one(
        mailer.build(
            to=email,
            subject=messages.SUBJECT,
            text=messages.confirmation_text(url),
            html=messages.confirmation_html(url),
        )
    )


def _send_digest_now(email: str) -> str | None:
    """Send the newest digest to one reader. Blocking.

    Used by the confirmation step, where getting the digest immediately is the
    whole reward for clicking.

    Returns:
        The digest's date when it was sent, or None if there was nothing to
        send. A failure to send is logged and swallowed: the reader is on the
        list either way, and tomorrow's send will reach them.
    """
    try:
        digest = source.current()
    except DigestError as exc:
        log.warning("No digest to send on confirmation: %s", exc)
        return None
    text, html = digest.for_reader(_unsubscribe_url(email))
    try:
        mailer.send_one(
            mailer.build(
                to=email,
                subject=digest.subject,
                text=text,
                html=html,
                unsubscribe_url=_unsubscribe_url(email),
            )
        )
    except mailer.MailError as exc:
        log.warning("Welcome digest failed: %s", exc)
        return None
    return digest.date


def _broadcast(date_hint: str) -> BroadcastResponse:
    """Send the newest digest to everyone who has not had it. Blocking.

    One SMTP session for the whole list, and each reader is marked as soon as
    their message is accepted, so an interrupted send resumes where it stopped
    rather than starting over.
    """
    digest = source.current(force=True)
    if date_hint and date_hint != digest.date:
        raise DigestError(
            f"the published digest is dated {digest.date}, not {date_hint}; "
            "the site may not have finished deploying"
        )

    due = store.due_for(digest.date)
    if not due:
        return BroadcastResponse(date=digest.date, sent=0, skipped=store.count(), failed=0)

    sent = 0
    failed = 0
    with mailer.connection() as client:
        for email in due:
            unsubscribe = _unsubscribe_url(email)
            text, html = digest.for_reader(unsubscribe)
            message = mailer.build(
                to=email,
                subject=digest.subject,
                text=text,
                html=html,
                unsubscribe_url=unsubscribe,
            )
            try:
                client.send_message(message)
            except Exception as exc:  # noqa: BLE001 - one bad address must not stop the list
                failed += 1
                # The type only: the exception text can contain the address.
                log.warning("One recipient failed: %s", type(exc).__name__)
                continue
            store.mark_sent(email, digest.date)
            sent += 1
    _metrics["digests_sent"] += sent
    return BroadcastResponse(
        date=digest.date, sent=sent, skipped=store.count() - len(due), failed=failed
    )


# ──────────────────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Report the configuration once, loudly enough to be found in the logs."""
    try:
        size = str(store.count())
    except StoreError as exc:
        # Never fatal. A database that is asleep, slow or briefly unreachable
        # must not stop the container booting: every endpoint reports the
        # failure on its own, and the next request may well succeed.
        size = "unknown"
        log.error("The subscriber list could not be read at startup: %s", exc)
    log.info(
        "newsring-subscriptions ready | store=%s | subscribers=%s/%d | digest=%s",
        store.backend,
        size,
        settings.max_subscribers,
        settings.digest_url or "(unset)",
    )
    for note in settings.warnings():
        log.warning("%s", note)
    if not settings.configured:
        log.error("Unset: %s — every endpoint will refuse.", ", ".join(settings.missing()))
    if not settings.public_base:
        log.error("NEWS_PUBLIC_BASE is unset — links in email will be relative and useless.")
    yield
    store.close()


app = FastAPI(
    title="NewsRing subscriptions",
    description="The public mailing list for the NewsRing daily digest.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=3600,
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Baseline hardening. This service serves JSON and redirects, nothing framable."""
    response = await call_next(request)
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    # A link in an email must never be cached by anything in between.
    response.headers.setdefault("Cache-Control", "no-store")
    return response


def _require_configured() -> None:
    if not settings.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Subscriptions are not configured on this deployment.",
        )


def _store_down(exc: StoreError) -> HTTPException:
    """The list is across the network, and the network is not cooperating.

    A 503 rather than a 500: nothing is wrong with the request, and the next
    one may well work. The detail says so in words a visitor can act on,
    because this one does reach the form.
    """
    log.error("The subscriber list is unreachable: %s", exc)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The mailing list is not answering right now. Try again in a few minutes.",
    )


# ──────────────────────────────────────────────────────────────────────────
# Introspection
# ──────────────────────────────────────────────────────────────────────────


@app.get("/api/health")
async def health() -> dict:
    """Liveness, plus enough to tell a misconfiguration from an outage.

    Answers 200 even when the list cannot be read. A health endpoint that
    goes down with its database tells a monitor that everything is broken,
    when in fact the service is up and one dependency is not — which is the
    distinction the endpoint exists to draw.
    """
    count: int | None
    try:
        count = await run_in_threadpool(store.count)
        reachable = True
    except StoreError as exc:
        count = None
        reachable = False
        log.warning("Health could not read the list: %s", exc)

    healthy = settings.configured and reachable
    return {
        "status": "ok" if healthy else "degraded",
        "service": "newsring-subscriptions",
        "version": app.version,
        "ready": settings.configured,
        "missing": settings.missing(),
        "warnings": settings.warnings(),
        "store": {"backend": store.backend, "reachable": reachable},
        "subscribers": count,
        "capacity": settings.max_subscribers,
        "open": count is None or count < settings.max_subscribers,
        "digest": source.snapshot(),
    }


@app.get("/api/status")
async def status_json() -> dict:
    """Everything `/api/health` reports, plus counters."""
    payload = await health()
    payload["metrics"] = dict(_metrics)
    payload["confirmations"] = security.budget.snapshot()
    return payload


# ──────────────────────────────────────────────────────────────────────────
# Joining
# ──────────────────────────────────────────────────────────────────────────

#: One reply for every outcome a stranger is allowed to tell apart.
_PENDING = "Check your inbox. There is a link to confirm, and today's digest follows it."


@app.post(
    "/api/subscribe",
    response_model=SubscribeResponse,
    dependencies=[Depends(security.enforce_rate_limit)],
)
async def subscribe(payload: SubscribeRequest) -> SubscribeResponse:
    """Take a signup and send a confirmation link. Stores nothing.

    The reply is the same whether the address is new, already on the list, in
    its cooldown window, or came from a bot that filled the honeypot. Only two
    things change it: an address that is not an address, and a full list.
    """
    _require_configured()

    if payload.website.strip():
        # A bot. Answered like everyone else so the next one is not smarter.
        return SubscribeResponse(status="pending", message=_PENDING)

    try:
        email = security.normalize_email(payload.email)
    except security.InvalidAddressError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        full = await run_in_threadpool(store.is_full)
    except StoreError as exc:
        raise _store_down(exc) from exc

    if full:
        return SubscribeResponse(
            status="full",
            message=(
                "The list is full for now — it is capped while this runs on one "
                "ordinary mailbox. Today's digest is on the site in the meantime."
            ),
        )

    if security.budget.allows(email):
        security.budget.record(email)
        try:
            await run_in_threadpool(_send_confirmation, email)
            _metrics["confirmations_sent"] += 1
        except mailer.MailError as exc:
            log.error("Confirmation could not be sent: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="The mailbox would not take the message. Try again in a few minutes.",
            ) from exc

    return SubscribeResponse(status="pending", message=_PENDING)


@app.get("/api/confirm")
async def confirm(token: str = "") -> RedirectResponse:
    """Put a reader on the list and send them today's digest.

    A GET that changes state, which is normally wrong, and is right here: this
    is a link in an email and a link in an email is a GET. The token is the
    authorisation, it is single-purpose, and a repeat click is a no-op.
    """
    _require_configured()
    try:
        email = tokens.verify(token, CONFIRM)
    except tokens.TokenError:
        return RedirectResponse(_site("invalid"), status_code=status.HTTP_303_SEE_OTHER)

    try:
        added = await run_in_threadpool(store.add, email)
    except StoreError as exc:
        # The reader did everything right and is not on the list. Say so, and
        # send them back to a page that tells them the link still works —
        # the token is stateless and good for another two days.
        log.error("A confirmation could not be recorded: %s", exc)
        return RedirectResponse(_site("error"), status_code=status.HTTP_303_SEE_OTHER)

    if not added:
        return RedirectResponse(_site("full"), status_code=status.HTTP_303_SEE_OTHER)
    _metrics["confirmed"] += 1

    sent = await run_in_threadpool(_send_digest_now, email)
    if sent:
        try:
            await run_in_threadpool(store.mark_sent, email, sent)
        except StoreError as exc:
            # They have the digest; only the record of it is missing. Left
            # alone: the cost is one duplicate tomorrow, against telling a
            # subscribed reader that something failed.
            log.warning("A welcome digest could not be marked as sent: %s", exc)
        _metrics["digests_sent"] += 1
    return RedirectResponse(
        _site("confirmed" if sent else "confirmed-no-digest"),
        status_code=status.HTTP_303_SEE_OTHER,
    )


# ──────────────────────────────────────────────────────────────────────────
# Leaving
# ──────────────────────────────────────────────────────────────────────────


@app.get("/api/unsubscribe")
async def unsubscribe(token: str = "") -> RedirectResponse:
    """Take a reader off the list, from the link at the foot of a digest."""
    try:
        email = tokens.verify(token, UNSUBSCRIBE)
    except tokens.TokenError:
        return RedirectResponse(_site("invalid"), status_code=status.HTTP_303_SEE_OTHER)

    try:
        gone = await run_in_threadpool(store.remove, email)
    except StoreError as exc:
        # Never report an unsubscribe that did not happen. Someone who is
        # told they are off the list and then gets tomorrow's digest has been
        # lied to, and will report it as spam rather than clicking again.
        log.error("An unsubscribe could not be recorded: %s", exc)
        return RedirectResponse(_site("error"), status_code=status.HTTP_303_SEE_OTHER)

    if gone:
        _metrics["unsubscribed"] += 1
    return RedirectResponse(_site("unsubscribed"), status_code=status.HTTP_303_SEE_OTHER)


@app.post("/api/unsubscribe")
async def unsubscribe_one_click(token: str = "") -> Response:
    """The same, for a mail client acting on `List-Unsubscribe-Post`.

    No redirect and no HTML: nothing is reading this but the mail provider,
    and it wants a 200 and nothing else. A bad token still answers 200,
    because the reader's intent is to be gone and a provider that sees an
    error here will show them a failure they cannot act on.

    A list that cannot be written is the one exception, and answers 503. The
    provider retries that; a 200 would end the attempt with the reader still
    subscribed and believing otherwise.
    """
    try:
        email = tokens.verify(token, UNSUBSCRIBE)
    except tokens.TokenError:
        return PlainTextResponse("ok", status_code=status.HTTP_200_OK)

    try:
        gone = await run_in_threadpool(store.remove, email)
    except StoreError as exc:
        raise _store_down(exc) from exc

    if gone:
        _metrics["unsubscribed"] += 1
    return PlainTextResponse("ok", status_code=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────
# The daily send
# ──────────────────────────────────────────────────────────────────────────


@app.post("/api/broadcast", response_model=BroadcastResponse)
async def broadcast(payload: BroadcastRequest, request: Request) -> BroadcastResponse:
    """Send the newest published digest to everyone who has not had it.

    Called by NewsRing's scheduled workflow after the site is deployed. The
    bearer token is the only authorisation; it is compared in constant time
    and is the one thing standing between a stranger and the list's inboxes.
    """
    _require_configured()
    header = request.headers.get("authorization", "")
    expected = f"Bearer {settings.broadcast_token}"
    if not hmac.compare_digest(header, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authorised.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if _broadcast_lock.locked():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A broadcast is already running."
        )
    async with _broadcast_lock:
        try:
            return await run_in_threadpool(_broadcast, payload.date)
        except DigestError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
        except mailer.MailError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
            ) from exc
        except StoreError as exc:
            # Raised either before a single message went out, or by the
            # `mark_sent` of one that did. The send stops there on purpose:
            # carrying on would mail the rest of the list without being able
            # to record it, and a re-run would then send every one of them
            # the same digest twice.
            raise _store_down(exc) from exc


@app.exception_handler(404)
async def not_found(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse({"detail": "No such route."}, status_code=404)
