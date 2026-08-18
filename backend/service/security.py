"""
The parts of the service that assume the caller is hostile.

Three separate concerns live here, in rough order of how much they matter:

1. **Decoding untrusted images.** The largest attack surface by far. A tiny
   file can declare enormous dimensions, carry a hundred frames, or simply not
   be an image at all. Handled by `decode_image`.
2. **Bounding cost.** Conversion is CPU-bound pure Python. The option ranges in
   `schemas.py` bound a single request; the semaphore and rate limiter here
   bound the aggregate.
3. **Access control.** Optional shared key, off by default so the public demo
   page works — see `docs/design.md` §5.

What this deliberately is *not*: an authentication system, a WAF, or a defence
against a determined distributed attacker. It is proportionate to a public
demo that costs CPU to run.
"""

from __future__ import annotations

import hmac
import io
import time
from collections import OrderedDict
from dataclasses import dataclass

from fastapi import HTTPException, Request, UploadFile, status
from PIL import Image, UnidentifiedImageError

from .metrics import metrics
from .settings import settings

# Formats we are willing to decode. TIFF is excluded on purpose: multi-page
# containers and a broad historical CVE surface, for no benefit to this demo.
ALLOWED_FORMATS: frozenset[str] = frozenset({"PNG", "JPEG", "WEBP", "BMP", "GIF"})

# Pillow's own bomb guard. It warns past this and raises past twice this.
Image.MAX_IMAGE_PIXELS = settings.max_image_pixels


# ──────────────────────────────────────────────────────────────────────────
# Client identity
# ──────────────────────────────────────────────────────────────────────────


def client_ip(request: Request) -> str:
    """
    Best-effort client address for rate-limit bucketing.

    Behind the Caddy reverse proxy the peer is always the proxy, so the visitor
    is the first hop of `X-Forwarded-For`. That header is trivially forged when
    no proxy is in front, which is why `trust_forwarded_for` exists — and why
    rate limiting is treated as a courtesy control here rather than a boundary.
    The controls that actually hold are the option caps and the semaphore.
    """
    if settings.trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


# ──────────────────────────────────────────────────────────────────────────
# Rate limiting
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """
    Per-client token bucket, in process memory.

    In-process is the right scope here: a Space is a single container, so there
    is no second replica to share state with. If this ever runs replicated the
    limiter needs to move to Redis, and until then a shared store would be
    complexity with no payoff.

    Bucket entries are evicted LRU so a stream of distinct source addresses
    cannot grow the map without bound — the limiter must not become the
    memory-exhaustion vector it is meant to prevent.
    """

    def __init__(self, per_minute: int, burst: int, *, max_entries: int = 4096) -> None:
        self._rate = per_minute / 60.0
        self._burst = float(burst)
        self._max_entries = max_entries
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def check(self, key: str) -> tuple[bool, float]:
        """
        Consume one token.

        Returns
        -------
        (allowed, retry_after_seconds)
        """
        now = time.monotonic()
        bucket = self._buckets.get(key)

        if bucket is None:
            bucket = _Bucket(tokens=self._burst, updated=now)
            self._buckets[key] = bucket
            while len(self._buckets) > self._max_entries:
                self._buckets.popitem(last=False)
        else:
            self._buckets.move_to_end(key)
            elapsed = now - bucket.updated
            bucket.tokens = min(self._burst, bucket.tokens + elapsed * self._rate)
            bucket.updated = now

        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True, 0.0

        deficit = 1.0 - bucket.tokens
        return False, deficit / self._rate if self._rate > 0 else 60.0


limiter = RateLimiter(settings.rate_limit_per_min, settings.rate_limit_burst)


def enforce_rate_limit(request: Request) -> None:
    """Raise 429 with a `Retry-After` header when the caller is over budget."""
    allowed, retry_after = limiter.check(client_ip(request))
    if not allowed:
        metrics.rate_limited += 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Slow down and try again shortly.",
            headers={"Retry-After": str(max(1, int(retry_after) + 1))},
        )


# ──────────────────────────────────────────────────────────────────────────
# Access control
# ──────────────────────────────────────────────────────────────────────────


def require_api_key(request: Request) -> None:
    """
    Enforce `X-API-Key` when `PW_API_KEY` is configured; no-op otherwise.

    Compared with `hmac.compare_digest` so a wrong key cannot be recovered a
    byte at a time from response timing.
    """
    expected = settings.api_key
    if not expected:
        return

    presented = request.headers.get("x-api-key", "")
    if not presented or not hmac.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid X-API-Key header is required.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


# ──────────────────────────────────────────────────────────────────────────
# Upload handling
# ──────────────────────────────────────────────────────────────────────────


async def read_upload(upload: UploadFile) -> bytes:
    """
    Read the upload into memory, refusing to exceed the byte cap.

    Read in chunks and counted as we go rather than trusting `Content-Length`,
    which is a claim by the client and not a fact about the stream.
    """
    cap = settings.max_upload_bytes
    chunks: list[bytes] = []
    total = 0

    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > cap:
            raise HTTPException(
                status_code=413,  # constant renamed across Starlette versions
                detail=f"Image exceeds the {cap // (1024 * 1024)} MB upload limit.",
            )
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty.",
        )

    return b"".join(chunks)


def decode_image(raw: bytes) -> Image.Image:
    """
    Turn untrusted bytes into a plain RGB image, or fail cleanly.

    The declared content type is ignored entirely — the format is whatever the
    decoder recognises in the bytes, which is the only claim that matters.

    Dimensions are checked from the header *before* the pixels are decoded, so
    a bomb is rejected for the cost of parsing a few bytes rather than the cost
    of allocating its full raster.

    The returned image is a fresh RGB copy of frame 0. That is what drops EXIF,
    ICC profiles, GPS tags, and any trailing frames: nothing from the container
    survives except the pixels, so nothing downstream has to be careful with it.
    """
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = (probe.format or "").upper()
            width, height = probe.size
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="That file is not an image in a format this service reads.",
        ) from None
    except Image.DecompressionBombError:
        raise HTTPException(
            status_code=413,  # constant renamed across Starlette versions
            detail="That image declares an implausible pixel count.",
        ) from None
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That image could not be read.",
        ) from None

    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"{fmt or 'Unknown'} is not supported. Use "
            f"{', '.join(sorted(ALLOWED_FORMATS))}.",
        )

    if width < 8 or height < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That image is too small to trace.",
        )

    limit = settings.max_image_dimension
    if width > limit or height > limit:
        raise HTTPException(
            status_code=413,  # constant renamed across Starlette versions
            detail=f"Image dimensions exceed {limit}px on a side.",
        )

    if width * height > settings.max_image_pixels:
        raise HTTPException(
            status_code=413,  # constant renamed across Starlette versions
            detail="Image exceeds the total pixel budget.",
        )

    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.seek(0)  # animated containers: first frame only
            return _flatten(img)
    except Image.DecompressionBombError:
        raise HTTPException(
            status_code=413,  # constant renamed across Starlette versions
            detail="That image expands beyond the pixel budget.",
        ) from None
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That image could not be decoded.",
        ) from None


def _flatten(img: Image.Image) -> Image.Image:
    """
    Reduce a decoded frame to bare RGB pixels with nothing else attached.

    Two things happen here, both of which caught me out and are worth stating:

    **Transparency is composited over white, not dropped.** `convert("RGB")` on
    an image with an alpha channel leaves transparent pixels *black*, so a logo
    exported on a transparent ground would arrive as a black rectangle and the
    edge detector would trace its border instead of the artwork. White matches
    what the browser-side extractor assumes and what anyone uploading a logo
    expects.

    **Metadata is dropped by rebuilding, not by converting.** Pillow copies the
    `info` dict across `convert()`, so EXIF — including GPS — survives it. Only
    constructing a fresh image from the raw buffer leaves it behind.
    """
    has_alpha = img.mode in ("RGBA", "LA") or (
        img.mode == "P" and "transparency" in img.info
    )

    if has_alpha:
        rgba = img.convert("RGBA")
        ground = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(ground, rgba).convert("RGB")
    else:
        rgb = img.convert("RGB")

    return Image.frombytes("RGB", rgb.size, rgb.tobytes())


def safe_source_name(name: str | None) -> str:
    """
    Reduce an uploaded filename to something safe to echo back in metadata.

    The name is never used to touch the filesystem — conversion is entirely in
    memory — so this is about not reflecting attacker-controlled text into a
    JSON document a browser will render, and about keeping path fragments out
    of output that someone may later save to disk.
    """
    if not name:
        return "upload"
    stem = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(c for c in stem if c.isalnum() or c in "._- ").strip()
    return (cleaned[:96] or "upload")
