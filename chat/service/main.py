"""
Site-chat service — ask questions about coronring.github.io.

The whole site is roughly four thousand tokens, so there is no retrieval step
and no vector store: every request puts the *complete* site text in front of
the model. That is the highest-quality option available and, because the text
is identical on every request, also the cheapest one — the provider's implicit
cache absorbs the repeated prefix. `docs/design.md` §2 has the measurements.

Route map
---------
  GET  /api/health       liveness, model chain, key count, corpus identity
  GET  /api/status       everything /health has, plus counters
  GET  /api/suggestions  opening prompts for an empty transcript
  POST /api/chat         a question -> an answer (SSE by default)

The service is mounted at `/chat` by Caddy, so from the browser these are
`https://<host>/chat/api/...`.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import embed as embedding
from . import gemini, prompt, router, security
from .answers import AnswerCache
from .corpus import CorpusStore
from .keyring import KeyRing
from .metrics import metrics
from .schemas import (
    ChatRequest,
    ChatResponse,
    Citation,
    EmbedRequest,
    EmbedResponse,
    EmbedVector,
)
from .settings import settings

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("site-chat")

ring = KeyRing(keys=settings.gemini_api_keys)
store = CorpusStore(
    settings.corpus_url,
    max_bytes=settings.corpus_max_bytes,
    refresh_s=settings.corpus_refresh_s,
)
answer_cache = AnswerCache(
    max_entries=settings.answer_cache_size,
    ttl_s=settings.answer_cache_ttl_s,
)

# Bounds simultaneous upstream calls. A plain threading primitive because the
# provider client is blocking and Starlette runs these handlers in a threadpool.
_slots = threading.Semaphore(settings.max_concurrency)

_stop_refresh = threading.Event()


def _refresh_loop() -> None:
    """Keep the corpus current in the background, off the request path."""
    while not _stop_refresh.is_set():
        try:
            store.refresh()
        except Exception as exc:  # noqa: BLE001 - a refresh must never kill the thread
            log.warning("corpus refresh thread: %s", exc)
        _stop_refresh.wait(min(settings.corpus_refresh_s, 300.0))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """
    Load the corpus once at startup, then keep it fresh in a daemon thread.

    A failed first load is logged, not fatal. The site being briefly
    unreachable should leave a service that reports `degraded` and recovers on
    its own, not a container in a restart loop.
    """
    if not store.refresh(force=True):
        log.warning("no corpus at startup (%s) — /api/chat will refuse until one loads",
                    store.last_error or "unknown")

    thread = threading.Thread(target=_refresh_loop, name="corpus-refresh", daemon=True)
    thread.start()

    log.info(
        "site-chat ready | keys=%d | models=%s | fallback=%s | answer_cache=%s",
        len(settings.gemini_api_keys),
        ",".join(settings.models),
        ",".join(settings.fallback_models),
        "on" if answer_cache.enabled else "off",
    )
    if not settings.configured:
        log.error("CHAT_GEMINI_API_KEYS is unset: /api/chat will refuse every request.")

    yield

    _stop_refresh.set()


app = FastAPI(
    title="coronring site-chat",
    description="Answers questions about coronring.github.io from the site's own text.",
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
    """Baseline hardening. This service serves JSON only — nothing to frame."""
    response = await call_next(request)
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


# ──────────────────────────────────────────────────────────────────────────
# Introspection
# ──────────────────────────────────────────────────────────────────────────


def _corpus_summary() -> dict:
    corpus = store.current
    if corpus is None:
        return {"loaded": False, "error": store.last_error}
    return {
        "loaded": True,
        "hash": corpus.hash,
        "pages": len(corpus.pages),
        "chars": corpus.total_chars,
        "approx_tokens": corpus.approx_tokens,
        "source": settings.corpus_url,
    }


@app.get("/api/health")
async def health() -> dict:
    """Liveness, plus enough to tell a misconfiguration from an outage."""
    corpus = store.current
    ready = settings.configured and corpus is not None
    return {
        "status": "ok" if ready else "degraded",
        "service": "site-chat",
        "version": app.version,
        "ready": ready,
        "keys": len(settings.gemini_api_keys),
        "models": list(settings.models),
        "fallback_models": list(settings.fallback_models),
        "corpus": _corpus_summary(),
        "embed": {
            "enabled": settings.embed_enabled and settings.configured,
            "model": settings.embed_model,
            "dimensions": settings.embed_dimensions,
            "max_texts": settings.embed_max_texts,
            "max_chars": settings.embed_max_chars,
            "max_total_chars": settings.embed_max_total_chars,
        },
        "limits": {
            "max_question_chars": settings.max_question_chars,
            "max_history_turns": settings.max_history_turns,
            "rate_limit_per_min": settings.rate_limit_per_min,
            "rate_limit_burst": settings.rate_limit_burst,
        },
    }


@app.get("/api/status")
async def status_json() -> dict:
    """Everything `/api/health` reports, plus counters and key health."""
    payload = await health()
    payload["metrics"] = metrics.snapshot()
    payload["answer_cache"] = answer_cache.snapshot()
    payload["key_ring"] = ring.snapshot(settings.all_models)
    return payload


@app.get("/api/suggestions")
async def suggestions() -> dict:
    """Opening prompts, so an empty transcript is not a blank box."""
    corpus = store.current
    return {"suggestions": prompt.suggestions(corpus) if corpus else []}


# ──────────────────────────────────────────────────────────────────────────
# Chat
# ──────────────────────────────────────────────────────────────────────────

# Matches the Markdown links the model is told to cite with. Restricted to
# root-relative targets: an off-site link is not a citation, and matching one
# would let a hallucinated URL be presented with the authority of a source.
#
# The `(?!/)` is load-bearing. `//evil.test/x` is a *protocol-relative* URL —
# it starts with a slash but resolves off-site — so a plain `/...` pattern
# accepts it as a local route. The corpus membership check below would reject
# it anyway, but a citation regex that has to be saved by a later check is one
# refactor away from not being.
_LINK_RE = re.compile(r"\[([^\]]{1,120})\]\((/(?!/)[A-Za-z0-9._~\-/]*)\)")

# The same citation, written the way models actually write it when they drift
# off the instructed format: a bare route in brackets or parentheses, with no
# label. Observed from `gemini-3.6-flash` in production, emitting `[/resume]`.
#
# Worth matching rather than treating as the model's mistake to fix. The source
# chips are the trust signal in the UI, and losing them because a fallback model
# was fractionally less obedient is a worse outcome than accepting both spellings.
_BARE_LINK_RE = re.compile(r"[\[(](/(?!/)[A-Za-z0-9._~\-/]*)[\])]")


def _citations(answer: str) -> list[Citation]:
    """
    Collect the pages an answer cited, in order of first appearance.

    Only routes that exist in the corpus are returned. The model is instructed
    not to invent one, but a citation list is a trust signal in the UI and must
    not be capable of pointing at a page that does not exist.
    """
    corpus = store.current
    if corpus is None:
        return []
    by_route = {page.route: page for page in corpus.pages}

    found: list[Citation] = []
    seen: set[str] = set()

    targets = [target for _, target in _LINK_RE.findall(answer)]
    targets.extend(_BARE_LINK_RE.findall(answer))

    for target in targets:
        route = target.rstrip("/") or "/"
        page = by_route.get(route)
        if page is not None and route not in seen:
            seen.add(route)
            found.append(Citation(route=page.route, title=page.title, url=page.url))
    return found


def _build_turns(payload: ChatRequest) -> list[gemini.Turn]:
    """
    Turn the client's transcript into provider turns, trimmed to budget.

    History is taken from the *end* — recent context is what a follow-up needs
    — and the client's copy is never trusted to already be small.
    """
    history = payload.history[-settings.max_history_turns :] if settings.max_history_turns else []

    turns: list[gemini.Turn] = []
    budget = settings.max_history_chars
    kept: list[gemini.Turn] = []
    for message in reversed(history):
        text = security.clean_text(message.content, limit=4_000)
        if not text:
            continue
        if len(text) > budget:
            break
        budget -= len(text)
        kept.append(gemini.Turn(role="model" if message.role == "assistant" else "user", text=text))
    turns.extend(reversed(kept))

    question = security.clean_text(payload.message, limit=settings.max_question_chars)
    if not question:
        raise HTTPException(status_code=400, detail="Ask a question.")
    turns.append(gemini.Turn(role="user", text=question))
    return turns


def _require_ready() -> tuple[str, str]:
    """
    Check the service can answer, and return ``(system_text, corpus_hash)``.

    :raises HTTPException: 503 when unconfigured or the corpus never loaded.
    """
    if not settings.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The assistant is not configured on this deployment.",
        )
    corpus = store.current
    rendered = store.rendered
    if corpus is None or not rendered:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The assistant is still loading the site content. Try again shortly.",
        )
    return prompt.system_text(corpus, rendered), corpus.hash


def _call_kwargs(system: str, turns: list[gemini.Turn]) -> dict:
    return {
        "system": system,
        "turns": turns,
        "max_output_tokens": settings.max_output_tokens,
        "temperature": settings.temperature,
        "thinking_budget": settings.thinking_budget,
        "timeout": settings.request_timeout_s,
    }


def _record(outcome: router.Outcome, usage: gemini.Usage | None) -> None:
    if usage is not None:
        outcome.usage = usage
        metrics.record_usage(usage.prompt_tokens, usage.cached_tokens, usage.output_tokens)


@app.post("/api/chat", dependencies=[Depends(security.enforce_rate_limit)])
async def chat(payload: ChatRequest, request: Request):  # type: ignore[no-untyped-def]
    """
    Answer a question about the site.

    Streams server-sent events by default. Each event is a JSON object with a
    `type`:

      ``meta``   once, before any text — the model and corpus in use
      ``delta``  a chunk of answer text
      ``done``   citations, timing, and token accounting
      ``error``  a failure; the stream ends after it

    Set ``stream: false`` for a single JSON body instead.
    """
    system, corpus_hash = _require_ready()
    turns = _build_turns(payload)

    # Only a question asked into an empty transcript is cacheable — see
    # `answers.py` for why that restriction is what makes the cache safe.
    cache_key = answer_cache.key(corpus_hash, turns[-1].text) if len(turns) == 1 else None
    hit = answer_cache.get(cache_key)

    ring.advance()

    if payload.stream:
        return StreamingResponse(
            _sse(system, turns, corpus_hash, cache_key, hit),
            media_type="text/event-stream",
            headers={
                # Caddy is configured to flush immediately, but a transparent
                # proxy in front of a visitor is not. Both headers are the
                # conventional way to ask one not to buffer a stream.
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    return _json_answer(system, turns, corpus_hash, cache_key, hit)


def _json_answer(system, turns, corpus_hash, cache_key, hit) -> JSONResponse:  # type: ignore[no-untyped-def]
    """Non-streaming path. Same routing, one body."""
    started = time.monotonic()

    if hit is not None:
        metrics.cache_served += 1
        body = ChatResponse(
            answer=hit.text,
            citations=_citations(hit.text),
            model=hit.model,
            cached=True,
            corpus_hash=corpus_hash,
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )
        return JSONResponse(body.model_dump())

    outcome = router.Outcome()
    last_error: gemini.GeminiError | None = None
    skipped_model: str | None = None

    with _slots:
        metrics.in_flight += 1
        try:
            for attempt in router.plan(settings.all_models, ring):
                if attempt.model == skipped_model:
                    continue
                outcome.attempts += 1
                metrics.upstream_attempts += 1
                try:
                    completion = gemini.generate(
                        api_key=attempt.api_key,
                        model=attempt.model,
                        **_call_kwargs(system, turns),
                    )
                except gemini.BadRequest as exc:
                    metrics.record_failure(str(exc))
                    raise HTTPException(status_code=400, detail=str(exc)) from None
                except gemini.GeminiError as exc:
                    last_error = exc
                    if isinstance(exc, gemini.RateLimited):
                        metrics.upstream_rate_limited += 1
                    elif isinstance(exc, gemini.Unavailable):
                        # If a model times out (e.g. 30s) or returns 503, swap to the next model
                        skipped_model = attempt.model
                    router.note_failure(ring, attempt, exc)
                    log.info("attempt %d failed (%s on %s/key%d): %s",
                             outcome.attempts, type(exc).__name__, attempt.model,
                             attempt.key_index, exc)
                    continue

                ring.record_success(attempt.key_index, attempt.model)
                outcome.model = attempt.model
                outcome.key_index = attempt.key_index
                outcome.degraded = router.is_fallback(attempt.model, settings.models)
                _record(outcome, completion.usage)

                # See the streaming path: a cut-off answer is shown but never
                # stored as the canonical one.
                if completion.truncated:
                    metrics.truncated_answers += 1
                    log.warning(
                        "truncated answer from %s (out=%d thoughts=%d) — not cached",
                        attempt.model,
                        completion.usage.output_tokens,
                        completion.usage.thoughts_tokens,
                    )
                else:
                    answer_cache.put(cache_key, completion.text, attempt.model)

                elapsed = int((time.monotonic() - started) * 1000)
                metrics.record_success(elapsed, degraded=outcome.degraded)
                log.info(
                    "answered via %s/key%d in %dms (prompt=%d cached=%d out=%d)",
                    attempt.model, attempt.key_index, elapsed,
                    completion.usage.prompt_tokens, completion.usage.cached_tokens,
                    completion.usage.output_tokens,
                )
                body = ChatResponse(
                    answer=completion.text,
                    citations=_citations(completion.text),
                    model=attempt.model,
                    cached=False,
                    degraded=outcome.degraded,
                    corpus_hash=corpus_hash,
                    elapsed_ms=elapsed,
                )
                return JSONResponse(body.model_dump())
        finally:
            metrics.in_flight -= 1

    raise _exhausted(last_error)


def _exhausted(last_error: gemini.GeminiError | None) -> HTTPException:
    """Every model on every key failed. Say which kind of failure it was."""
    metrics.record_failure(str(last_error) if last_error else "no attempts")
    if isinstance(last_error, gemini.RateLimited):
        detail = (
            "Every model is rate-limited right now. This runs on free API quota — "
            "give it a minute."
        )
        code = status.HTTP_429_TOO_MANY_REQUESTS
    else:
        detail = "The assistant could not reach a model. Try again shortly."
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HTTPException(status_code=code, detail=detail)


# ──────────────────────────────────────────────────────────────────────────
# Embeddings
# ──────────────────────────────────────────────────────────────────────────


@app.post(
    "/api/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(security.enforce_embed_rate_limit)],
)
async def embed_texts(payload: EmbedRequest) -> EmbedResponse:
    """
    Embed a batch of texts for semantic comparison.

    Backs the semantic panel in the site's text-diff tool. The vectors come back
    unit length, so a client can use a dot product and a cosine interchangeably.

    Nothing is stored. The texts are held for the duration of the upstream call
    and are not logged, which is what lets the tool say so on the page.
    """
    if not settings.embed_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings are switched off on this deployment.",
        )

    # Request validation runs before the credential check, deliberately. A
    # malformed request is malformed whatever this deployment is configured
    # with, and answering 503 to it would blame the server for the client's
    # bug. It also means the size caps are exercised by the test suite on a
    # machine with no keys.
    texts = [
        security.clean_text(text, limit=settings.embed_max_chars) for text in payload.texts
    ]
    # An empty text embeds to a vector that is not meaningfully comparable to
    # anything, so it is a client bug worth naming rather than absorbing.
    if any(text == "" for text in texts):
        raise HTTPException(
            status_code=422,  # Starlette renamed its constant for this; the literal outlives both spellings
            detail="One of the texts is empty after cleaning.",
        )

    total = sum(len(text) for text in texts)
    if total > settings.embed_max_total_chars:
        raise HTTPException(
            status_code=413,  # likewise renamed; see the note above
            detail=(
                f"{total:,} characters across {len(texts)} texts exceeds the "
                f"{settings.embed_max_total_chars:,} character budget for one request."
            ),
        )

    if not settings.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This deployment has no credentials configured.",
        )

    started = time.monotonic()
    ring.advance()
    last_error: gemini.GeminiError | None = None

    # One model, so the plan is a walk over the keys. Same ring and the same
    # cooldown bookkeeping as the chat path, which is the point of sharing it.
    for attempt in router.plan((settings.embed_model,), ring):
        if not _slots.acquire(timeout=settings.request_timeout_s):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The service is at capacity. Try again in a moment.",
            )
        try:
            result = await run_in_threadpool(
                embedding.embed,
                api_key=attempt.api_key,
                model=attempt.model,
                texts=texts,
                dimensions=payload.dimensions,
                timeout=settings.request_timeout_s,
            )
        except gemini.GeminiError as error:
            last_error = error
            router.note_failure(ring, attempt, error)
            log.info("embed attempt failed on key[%d]: %s", attempt.key_index, error)
            if not error.retryable:
                break
            continue
        finally:
            _slots.release()

        ring.record_success(attempt.key_index, attempt.model)
        return EmbedResponse(
            embeddings=[EmbedVector(values=list(item.values)) for item in result.embeddings],
            model=result.model,
            dimensions=result.dimensions,
            task_type=result.task_type,
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )

    raise _exhausted(last_error)


def _event(kind: str, **fields) -> str:  # type: ignore[no-untyped-def]
    """Encode one SSE frame."""
    return f"data: {json.dumps({'type': kind, **fields}, ensure_ascii=False)}\n\n"


def _sse(system, turns, corpus_hash, cache_key, hit) -> Iterator[str]:  # type: ignore[no-untyped-def]
    """
    The streaming path.

    Fallback is only possible *before the first token reaches the browser*.
    After that the answer is committed: retrying on another model would splice
    two different answers together mid-sentence, which is worse than ending the
    stream with an error. `gemini.stream` is built around the same boundary.
    """
    started = time.monotonic()

    if hit is not None:
        metrics.cache_served += 1
        yield _event("meta", model=hit.model, cached=True, corpus_hash=corpus_hash)
        yield _event("delta", text=hit.text)
        yield _event(
            "done",
            citations=[c.model_dump() for c in _citations(hit.text)],
            elapsed_ms=int((time.monotonic() - started) * 1000),
            cached=True,
            model=hit.model,
        )
        return

    last_error: gemini.GeminiError | None = None
    attempts = 0
    skipped_model: str | None = None

    with _slots:
        metrics.in_flight += 1
        try:
            for attempt in router.plan(settings.all_models, ring):
                if attempt.model == skipped_model:
                    continue
                attempts += 1
                metrics.upstream_attempts += 1
                pieces: list[str] = []
                end: gemini.StreamEnd | None = None
                opened = False

                try:
                    for delta, chunk_end in gemini.stream(
                        api_key=attempt.api_key,
                        model=attempt.model,
                        **_call_kwargs(system, turns),
                    ):
                        if chunk_end is not None:
                            end = chunk_end
                            continue
                        if not opened:
                            opened = True
                            degraded = router.is_fallback(attempt.model, settings.models)
                            yield _event(
                                "meta",
                                model=attempt.model,
                                cached=False,
                                degraded=degraded,
                                corpus_hash=corpus_hash,
                            )
                        pieces.append(delta)
                        yield _event("delta", text=delta)
                except gemini.BadRequest as exc:
                    metrics.record_failure(str(exc))
                    yield _event("error", message=str(exc))
                    return
                except gemini.GeminiError as exc:
                    last_error = exc
                    if isinstance(exc, gemini.RateLimited):
                        metrics.upstream_rate_limited += 1
                    elif isinstance(exc, gemini.Unavailable):
                        # If a model times out (e.g. 30s) or returns 503, swap to the next model
                        skipped_model = attempt.model
                    router.note_failure(ring, attempt, exc)
                    log.info("stream attempt %d failed (%s on %s/key%d): %s",
                             attempts, type(exc).__name__, attempt.model,
                             attempt.key_index, exc)
                    if opened:
                        # Committed. Do not restart on another model.
                        metrics.record_failure(str(exc))
                        yield _event("error", message="The answer was cut short.")
                        return
                    continue

                answer = "".join(pieces)
                usage = end.usage if end else None
                ring.record_success(attempt.key_index, attempt.model)
                degraded = router.is_fallback(attempt.model, settings.models)
                if usage is not None:
                    metrics.record_usage(
                        usage.prompt_tokens, usage.cached_tokens, usage.output_tokens
                    )

                # A truncated answer is a real answer and is shown, but it must
                # not be stored: caching one pins a mid-sentence reply as the
                # canonical response to that question for the next hour.
                if end is not None and end.truncated:
                    metrics.truncated_answers += 1
                    log.warning(
                        "truncated answer from %s (out=%d thoughts=%d) — not cached",
                        attempt.model,
                        usage.output_tokens if usage else 0,
                        usage.thoughts_tokens if usage else 0,
                    )
                else:
                    answer_cache.put(cache_key, answer, attempt.model)

                elapsed = int((time.monotonic() - started) * 1000)
                metrics.record_success(elapsed, degraded=degraded)
                log.info(
                    "streamed via %s/key%d in %dms (prompt=%d cached=%d out=%d)",
                    attempt.model, attempt.key_index, elapsed,
                    usage.prompt_tokens if usage else 0,
                    usage.cached_tokens if usage else 0,
                    usage.output_tokens if usage else 0,
                )
                yield _event(
                    "done",
                    citations=[c.model_dump() for c in _citations(answer)],
                    elapsed_ms=elapsed,
                    model=attempt.model,
                    degraded=degraded,
                    cached=False,
                    truncated=bool(end and end.truncated),
                    usage={
                        "prompt_tokens": usage.prompt_tokens if usage else 0,
                        "cached_tokens": usage.cached_tokens if usage else 0,
                        "output_tokens": usage.output_tokens if usage else 0,
                    },
                )
                return
        finally:
            metrics.in_flight -= 1

    error = _exhausted(last_error)
    yield _event("error", message=error.detail, status=error.status_code)
