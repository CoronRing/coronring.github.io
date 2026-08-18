"""
The bridge between the HTTP layer and the `particle_wave` package.

`particle_wave` is consumed here exactly as a third-party dependency would be:
installed from a wheel, imported by name, never reached into by path. The wheel
is built from the SenseRing checkout and vendored into `vendor/` for now; when
it goes to PyPI the only change is a line in `requirements.txt`.

The frontend engine is resolved out of the *installed package* as well, so the
JavaScript the browser runs and the Python that produced the point cloud are
guaranteed to be the same release. Vendoring the JS separately would let the
two drift silently, which is the failure this avoids.
"""

from __future__ import annotations

import asyncio
import logging
import time
from importlib.metadata import PackageNotFoundError, version
from importlib.resources import files
from pathlib import Path
from typing import Any, Final

from fastapi import HTTPException, status
from PIL import Image

from .metrics import metrics
from .schemas import ConvertMeta, ConvertOptions
from .settings import settings

log = logging.getLogger(__name__)

# Bound on simultaneous conversions. Created at import so every request shares
# one semaphore; a per-request semaphore would bound nothing.
_slots: Final[asyncio.Semaphore] = asyncio.Semaphore(settings.max_concurrency)


def package_version() -> str:
    """Installed version of the particle-wave wheel, for the health endpoint."""
    try:
        return version("particle-wave-tool")
    except PackageNotFoundError:  # pragma: no cover — only if run from source
        return "unknown"


def engine_dir() -> Path:
    """
    Filesystem path to the FE engine inside the installed package.

    `files()` returns a traversable; for a plain wheel install that is a real
    directory, which is what StaticFiles needs. A zipimported package would not
    be, hence the explicit check rather than a silent failure at request time.
    """
    traversable = files("particle_wave") / "FE"
    path = Path(str(traversable))
    if not path.is_dir():
        raise RuntimeError(
            f"particle_wave FE assets are not on disk at {path}. "
            "The package must be installed unzipped for the engine to be served."
        )
    return path


def available_extractors() -> list[str]:
    """
    Which extraction backends this deployment can actually run.

    'ml' is only offered when onnxruntime is importable. Advertising it
    otherwise would give the page a control that silently falls back to Canny.
    """
    backends = ["classic"]
    try:
        import onnxruntime  # noqa: F401

        backends.append("ml")
    except ImportError:
        pass
    return backends


def build_pipeline_config(options: ConvertOptions) -> Any:
    """Translate the validated request options into a `PipelineConfig`."""
    from particle_wave.tool.pipeline import PipelineConfig

    cfg = PipelineConfig.from_defaults()

    cfg.preprocess.max_resolution = options.max_resolution
    cfg.preprocess.clahe_clip = options.clahe_clip
    cfg.preprocess.blur_sigma = options.blur_sigma

    cfg.extractor = "classic"
    cfg.extractor_classic.blur_sigma = options.canny_blur_sigma
    cfg.extractor_classic.low_thresh = options.canny_low
    cfg.extractor_classic.high_thresh = options.canny_high

    s = cfg.sampling
    s.feature_mode = options.feature_mode
    s.edge_weight = options.edge_weight
    s.tone_weight = options.tone_weight
    s.tone_sigma = options.tone_sigma
    s.tone_gamma = options.tone_gamma
    s.bw_polarity = options.bw_polarity
    s.bw_gamma = options.bw_gamma
    s.feature_quantile = options.feature_quantile
    s.feature_floor = options.feature_floor
    s.target_points = options.target_points
    s.min_radius = options.min_radius
    s.max_radius = options.max_radius
    s.radius_gamma = options.radius_gamma
    s.k_candidates = options.k_candidates
    s.fill_background = options.fill_background
    s.background_ratio = options.background_ratio
    s.rng_seed = options.rng_seed

    cfg.output.encoding = "flat"
    cfg.output.float_precision = 4

    return cfg


def convert_sync(image: Image.Image, options: ConvertOptions, source_name: str) -> dict:
    """
    The CPU-bound half, synchronous.

    Public so a caller that is already on a worker thread — a batch script,
    another embedding surface — can use the blocking form directly, without
    the semaphore and timeout that only make sense on the HTTP path.
    """
    from particle_wave.tool.pipeline import Pipeline

    return Pipeline(build_pipeline_config(options)).build(image, source_name=source_name)


async def convert(
    image: Image.Image,
    options: ConvertOptions,
    source_name: str,
) -> tuple[dict, ConvertMeta]:
    """
    Convert an image to a `.pwcloud` document.

    Serialised through a semaphore and bounded by a wall-clock timeout. Note
    the honest limitation: a timeout abandons the *result*, but the worker
    thread keeps running to completion, because Python threads cannot be
    cancelled. With the option caps in `schemas.py` the measured worst case is
    a few seconds against a 60 s timeout, so this is a backstop that should
    never fire — if it starts firing, the caps are wrong, not the timeout.
    """
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=settings.convert_timeout_s)
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The converter is busy. Try again in a moment.",
            headers={"Retry-After": "5"},
        ) from None

    started = time.perf_counter()
    metrics.in_flight += 1
    try:
        document = await asyncio.wait_for(
            asyncio.to_thread(convert_sync, image, options, source_name),
            timeout=settings.convert_timeout_s,
        )
    except TimeoutError:
        metrics.record_failure()
        log.warning("conversion exceeded %.0fs and was abandoned", settings.convert_timeout_s)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Conversion took too long. Try fewer points or a larger min radius.",
        ) from None
    except ValueError as exc:
        # Option combinations the pipeline itself rejects.
        metrics.record_failure()
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except MemoryError:
        metrics.record_failure()
        raise HTTPException(
            status_code=413,  # constant renamed across Starlette versions
            detail="That image needed more memory than this service allows.",
        ) from None
    except Exception:
        # Do not leak tracebacks or internal paths to the caller.
        metrics.record_failure()
        log.exception("conversion failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Conversion failed.",
        ) from None
    finally:
        metrics.in_flight -= 1
        _slots.release()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    point_count = int(document["meta"]["point_count"])

    meta = ConvertMeta(
        point_count=point_count,
        elapsed_ms=elapsed_ms,
        source_size=document["meta"].get("source_size"),
        extractor=str(document["meta"].get("extractor", "classic")),
        truncated_to_cap=point_count >= options.target_points,
    )
    metrics.record_success(point_count, elapsed_ms)
    log.info("converted %s -> %d points in %d ms", source_name, point_count, elapsed_ms)
    return document, meta
