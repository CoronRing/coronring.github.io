"""
SenseRing particle-wave service.

A small FastAPI app that does one thing: take an uploaded image plus a set of
extraction options, run it through the `particle_wave` Python pipeline, and
return a `.pwcloud` point cloud. The bundled page renders the result with the
frontend engine shipped inside the same wheel, so a change to either half is
visible immediately against the other.

Route map
---------
  GET  /                  the demo page
  GET  /api/health        liveness, versions, and the active limits
  GET  /api/options       option schema the page builds its controls from
  POST /api/convert       image + options -> .pwcloud
  GET  /engine/*          FE engine, served out of the installed package
  GET  /assets/*          page CSS and JS
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import converter, security
from .metrics import metrics
from .schemas import ConvertOptions, ui_schema
from .settings import settings

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("particle-wave-service")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """
    Fail fast on a broken deployment.

    Resolving the engine directory at startup turns "the wheel was installed
    wrong" into a container that refuses to start, rather than a page that
    loads and then 404s on its own JavaScript.
    """
    engine = converter.engine_dir()
    log.info(
        "particle-wave %s ready | engine=%s | auth=%s | concurrency=%d",
        converter.package_version(),
        engine,
        "on" if settings.auth_required else "off",
        settings.max_concurrency,
    )
    if not settings.auth_required:
        log.warning(
            "PW_API_KEY is unset: /api/convert is open to anyone who can reach it."
        )
    yield


app = FastAPI(
    title="SenseRing particle-wave service",
    description="Image to .pwcloud conversion, backed by the particle_wave package.",
    version=converter.package_version(),
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

# Same-origin by default. A wildcard would hand a CPU-bound endpoint to any
# page on the internet, so origins must be named explicitly to be allowed.
if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key"],
        max_age=3600,
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    """
    Baseline response hardening.

    Note the absence of `X-Frame-Options: DENY`. The demo page is meant to be
    embeddable from the personal site, and that header cannot express "one
    specific origin" — it is all-or-nothing. `frame-ancestors` below says the
    same thing precisely, and names the same origin the CORS allowlist does.
    """
    response = await call_next(request)

    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'self' https://coronring.github.io",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

    # Six months, and deliberately neither `includeSubDomains` nor `preload`.
    # The host is addressed as `<ip-with-dashes>.sslip.io`, so subdomains are
    # other people's addresses and preloading would outlive the IP lease.
    # Browsers ignore this over plain http, so it costs nothing there.
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=15768000"
    )
    return response


@app.middleware("http")
async def cache_control(request: Request, call_next):  # type: ignore[no-untyped-def]
    """
    Say something explicit about freshness, because the default is a guess.

    Starlette's `StaticFiles` sends `ETag` and `Last-Modified` but no
    `Cache-Control`. With no directive a browser applies *heuristic* freshness —
    roughly a tenth of the document's age — and serves from cache without
    revalidating. So after a redeploy a returning visitor could hold a stale
    `app.js` while fetching the new `index.html`, and the page then crashed on
    the mismatch. That is exactly what happened at 1.4.0.

    `no-cache` does not mean "do not store"; it means "revalidate before use".
    Paired with the ETag that already exists, an unchanged asset costs a 304 with
    no body, so correctness here is close to free.

    API responses are `no-store`: `/api/status` carries live counters, and a
    cached copy of those is worse than no copy.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    else:
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# ──────────────────────────────────────────────────────────────────────────
# Static assets
# ──────────────────────────────────────────────────────────────────────────

# The engine comes out of the installed wheel, not out of this repo — see the
# module docstring in converter.py for why that matters.
app.mount("/engine", StaticFiles(directory=converter.engine_dir()), name="engine")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


# Asset URLs carry the package version as a query string. `Cache-Control` above
# stops a *future* redeploy from serving a stale script, but it cannot help a
# browser that already holds one under the old no-directive heuristic: that copy
# is reused until its guessed lifetime runs out. Changing the URL is what
# evicts it now. The token is substituted at request time because the version
# comes from the installed wheel and is not known when this file is written.
ASSET_VERSION_PLACEHOLDER = "__ASSET_V__"


@lru_cache(maxsize=8)
def _page(name: str) -> str:
    """A static page with its asset URLs stamped with the package version."""
    html = (STATIC_DIR / name).read_text(encoding="utf-8")
    return html.replace(ASSET_VERSION_PLACEHOLDER, converter.package_version())


@app.get("/", include_in_schema=False)
async def index() -> HTMLResponse:
    return HTMLResponse(_page("index.html"))


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "assets" / "favicon.svg", media_type="image/svg+xml")


@app.get("/status", include_in_schema=False)
async def status_page() -> HTMLResponse:
    """Human-readable service status. `/api/status` is the same data as JSON."""
    return HTMLResponse(_page("status.html"))


# ──────────────────────────────────────────────────────────────────────────
# API
# ──────────────────────────────────────────────────────────────────────────


@app.get("/api/health")
async def health() -> dict:
    """Liveness plus the limits in force, so a client can adapt to them."""
    return {
        "status": "ok",
        "package": converter.package_name(),
        "version": converter.package_version(),
        "extractors": converter.available_extractors(),
        "auth_required": settings.auth_required,
        "limits": {
            "max_upload_bytes": settings.max_upload_bytes,
            "max_image_pixels": settings.max_image_pixels,
            "max_image_dimension": settings.max_image_dimension,
            "max_concurrency": settings.max_concurrency,
            "convert_timeout_s": settings.convert_timeout_s,
            "rate_limit_per_min": settings.rate_limit_per_min,
            "allowed_formats": sorted(security.ALLOWED_FORMATS),
        },
    }


@app.get("/api/status")
async def status_json() -> dict:
    """
    Everything `/status` renders, as JSON.

    Kept separate from `/api/health` so an uptime monitor can poll a small,
    cheap, stable payload while this one is free to grow.

    `degraded` is reported when the engine assets cannot be resolved: the API
    would still convert, but the page it serves would be broken, and a status
    endpoint that called that "ok" would be lying.
    """
    engine_ok = True
    engine_detail = ""
    try:
        engine_detail = str(converter.engine_dir())
    except RuntimeError as exc:
        engine_ok = False
        engine_detail = str(exc)

    return {
        "status": "ok" if engine_ok else "degraded",
        "service": "particle-wave",
        "version": converter.package_version(),
        "engine": {"ok": engine_ok, "detail": engine_detail},
        "extractors": converter.available_extractors(),
        "auth_required": settings.auth_required,
        "metrics": metrics.snapshot(),
        "limits": {
            "max_upload_bytes": settings.max_upload_bytes,
            "max_image_pixels": settings.max_image_pixels,
            "max_image_dimension": settings.max_image_dimension,
            "max_concurrency": settings.max_concurrency,
            "convert_timeout_s": settings.convert_timeout_s,
            "rate_limit_per_min": settings.rate_limit_per_min,
            "rate_limit_burst": settings.rate_limit_burst,
            "allowed_formats": sorted(security.ALLOWED_FORMATS),
        },
    }


@app.get("/api/options")
async def options() -> dict:
    """Schema, defaults, and grouping for every option `/api/convert` accepts."""
    return ui_schema()


@app.post(
    "/api/convert",
    dependencies=[Depends(security.require_api_key), Depends(security.enforce_rate_limit)],
)
async def convert(
    image: Annotated[UploadFile, File(description="Source image (PNG, JPEG, WebP, BMP, GIF).")],
    options_json: Annotated[
        str | None,
        Form(alias="options", description="ConvertOptions as a JSON object. Omit for defaults."),
    ] = None,
) -> JSONResponse:
    """
    Convert an uploaded image into a `.pwcloud` point cloud.

    The response is `{"cloud": <pwcloud document>, "meta": {...}}`. The cloud
    half is exactly what the CLI writes to disk, so it can be saved as a
    `.pwcloud` file or handed straight to `ParticleWave.init({ src })`.
    """
    # Counted at the boundary rather than at each raise site, so `security` stays
    # free of metrics coupling and no future rejection path can forget to tally.
    try:
        parsed = _parse_options(options_json)
    except HTTPException:
        metrics.options_rejected += 1
        raise

    try:
        raw = await security.read_upload(image)
        decoded = security.decode_image(raw)
    except HTTPException:
        metrics.uploads_rejected += 1
        raise

    source_name = security.safe_source_name(image.filename)

    document, meta = await converter.convert(decoded, parsed, source_name)

    return JSONResponse({"cloud": document, "meta": meta.model_dump()})


def _parse_options(options_json: str | None) -> ConvertOptions:
    """
    Validate the options form field.

    Returned errors keep pydantic's per-field detail — the page surfaces them
    next to the offending control, and a bare "invalid options" would make that
    impossible.
    """
    if not options_json or not options_json.strip():
        return ConvertOptions()

    try:
        payload = json.loads(options_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"options is not valid JSON: {exc.msg}",
        ) from None

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="options must be a JSON object.",
        )

    try:
        return ConvertOptions.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(
            # Literal rather than the constant: Starlette renamed
            # HTTP_422_UNPROCESSABLE_ENTITY to ..._CONTENT, so either spelling
            # breaks on some supported version. The number never moves.
            status_code=422,
            detail=[
                {"field": ".".join(str(p) for p in err["loc"]), "message": err["msg"]}
                for err in exc.errors()
            ],
        ) from None
