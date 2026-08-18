"""
The request contract for `/api/convert`.

Every option the client may set is declared here with a hard range. That is a
correctness feature and a security feature at once: the sampler underneath is
a pure-Python Bridson loop whose cost is driven by `min_radius` and
`target_points`, so an unbounded request body is a CPU denial-of-service with
extra steps. The bounds below were chosen against measured timings — see
`docs/design.md` §4.

The UI is generated from this model's JSON Schema rather than hand-written, so
a control cannot drift from the validation behind it. `x-group` and `x-step`
ride along in `json_schema_extra` purely to tell the page how to lay a field
out; the server ignores them.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ──────────────────────────────────────────────────────────────────────────
# Field groups, in the order the page should render them.
# ──────────────────────────────────────────────────────────────────────────

GROUPS: list[dict[str, str]] = [
    {
        "id": "preprocess",
        "label": "Preprocess",
        "help": "What the image looks like before anything is measured.",
    },
    {
        "id": "edges",
        "label": "Edge detection",
        "help": "Canny thresholds. Lower values keep fainter contours.",
    },
    {
        "id": "importance",
        "label": "Importance map",
        "help": "How the pixels are scored for where points are worth spending.",
    },
    {
        "id": "sampling",
        "label": "Point sampling",
        "help": "Poisson-disk placement. min radius is the real density lever.",
    },
]


def _f(
    default: Any,
    *,
    group: str,
    label: str,
    step: float | None = None,
    help: str | None = None,
    **kwargs: Any,
) -> Any:
    """Field with the extra metadata the page needs to render a control."""
    extra: dict[str, Any] = {"x-group": group, "x-label": label}
    if step is not None:
        extra["x-step"] = step
    if help is not None:
        extra["x-help"] = help
    return Field(default, json_schema_extra=extra, **kwargs)


class ConvertOptions(BaseModel):
    """Tunable subset of `PipelineConfig`, with every range pinned."""

    # `forbid` rather than `ignore`: a typo'd option name should be an error the
    # caller sees, not a setting that silently did nothing.
    model_config = ConfigDict(extra="forbid")

    # ── Preprocess ────────────────────────────────────────────────────
    max_resolution: Annotated[int, Field(ge=128, le=2048)] = _f(
        1024,
        group="preprocess",
        label="Max resolution",
        step=64,
        help="Longest edge is capped to this before processing, in pixels.",
    )
    clahe_clip: Annotated[float, Field(ge=0.0, le=8.0)] = _f(
        2.0,
        group="preprocess",
        label="CLAHE clip",
        step=0.1,
        help="Local contrast boost. 0 disables it.",
    )
    blur_sigma: Annotated[float, Field(ge=0.0, le=5.0)] = _f(
        0.0,
        group="preprocess",
        label="Pre-blur sigma",
        step=0.1,
        help="Gaussian blur before extraction. Suppresses sensor noise.",
    )

    # ── Edges ─────────────────────────────────────────────────────────
    canny_blur_sigma: Annotated[float, Field(ge=0.0, le=6.0)] = _f(
        1.4,
        group="edges",
        label="Canny blur",
        step=0.1,
        help="Blur applied inside the edge detector.",
    )
    canny_low: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.05,
        group="edges",
        label="Low threshold",
        step=0.01,
        help="Hysteresis floor. Must be below the high threshold.",
    )
    canny_high: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.15,
        group="edges",
        label="High threshold",
        step=0.01,
        help="Hysteresis ceiling. Only edges above this seed a contour.",
    )

    # ── Importance ────────────────────────────────────────────────────
    feature_mode: Literal["hybrid", "edge", "tone", "bw_intensity"] = _f(
        "hybrid",
        group="importance",
        label="Feature mode",
        help="hybrid blends edges with local contrast; bw_intensity ignores "
        "edges and follows brightness.",
    )
    edge_weight: Annotated[float, Field(ge=0.0, le=2.0)] = _f(
        0.8,
        group="importance",
        label="Edge weight",
        step=0.05,
        help="Edge contribution in hybrid mode.",
    )
    tone_weight: Annotated[float, Field(ge=0.0, le=2.0)] = _f(
        0.65,
        group="importance",
        label="Tone weight",
        step=0.05,
        help="Local-contrast contribution in hybrid mode.",
    )
    tone_sigma: Annotated[float, Field(ge=1.0, le=40.0)] = _f(
        10.0,
        group="importance",
        label="Tone sigma",
        step=0.5,
        help="Neighbourhood size for local contrast, in pixels.",
    )
    tone_gamma: Annotated[float, Field(ge=0.1, le=3.0)] = _f(
        0.85,
        group="importance",
        label="Tone gamma",
        step=0.05,
        help="Below 1 lifts mid-tones into the map.",
    )
    bw_polarity: Literal["white_more", "black_more"] = _f(
        "white_more",
        group="importance",
        label="BW polarity",
        help="Which end of the brightness range attracts points "
        "(bw_intensity mode only).",
    )
    bw_gamma: Annotated[float, Field(ge=0.1, le=4.0)] = _f(
        1.0,
        group="importance",
        label="BW gamma",
        step=0.05,
        help="Contrast curve for bw_intensity mode.",
    )
    feature_quantile: Annotated[float, Field(ge=0.0, le=0.99)] = _f(
        0.62,
        group="importance",
        label="Feature quantile",
        step=0.01,
        help="Keeps the top slice of the importance map. Higher is more "
        "selective.",
    )
    feature_floor: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.08,
        group="importance",
        label="Feature floor",
        step=0.01,
        help="Absolute minimum importance for a pixel to be eligible.",
    )

    # ── Sampling ──────────────────────────────────────────────────────
    #
    # `target_points` is a ceiling, not a promise. The Poisson radius decides
    # how many points physically fit; above ~2200 at the default min_radius of
    # 2.0 on a 1024px raster, raising this changes nothing. Lower min_radius to
    # actually get more points. The page says so next to the control.
    target_points: Annotated[int, Field(ge=100, le=15_000)] = _f(
        4000,
        group="sampling",
        label="Target points",
        step=100,
        help="Upper bound on point count. The min radius below usually binds "
        "first — if raising this does nothing, lower the radius.",
    )
    min_radius: Annotated[float, Field(ge=0.8, le=24.0)] = _f(
        2.0,
        group="sampling",
        label="Min radius",
        step=0.1,
        help="Closest two points may sit, in pixels. The real density lever.",
    )
    max_radius: Annotated[float, Field(ge=1.0, le=60.0)] = _f(
        12.0,
        group="sampling",
        label="Max radius",
        step=0.5,
        help="Spacing in the flattest regions of the image.",
    )
    radius_gamma: Annotated[float, Field(ge=0.1, le=3.0)] = _f(
        0.5,
        group="sampling",
        label="Radius gamma",
        step=0.05,
        help="Below 1 concentrates points harder onto detail.",
    )
    k_candidates: Annotated[int, Field(ge=4, le=60)] = _f(
        30,
        group="sampling",
        label="Candidates (k)",
        step=1,
        help="Bridson trial count per active point. Higher packs tighter and "
        "costs more.",
    )
    fill_background: bool = _f(
        False,
        group="sampling",
        label="Fill background",
        help="Scatter sparse points across empty regions so the whole canvas "
        "reacts to the cursor.",
    )
    background_ratio: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.15,
        group="sampling",
        label="Background ratio",
        step=0.01,
        help="Background points as a fraction of the traced points.",
    )
    rng_seed: Annotated[int, Field(ge=0, le=2**31 - 1)] | None = _f(
        7,
        group="sampling",
        label="Seed",
        step=1,
        help="Fixed seed makes a conversion reproducible. Clear it for a new "
        "arrangement each run.",
    )

    # ── Cross-field rules ─────────────────────────────────────────────

    @model_validator(mode="after")
    def _check_ordering(self) -> ConvertOptions:
        """
        Ranges that only make sense relative to each other.

        Caught here rather than deep in the sampler, where an inverted radius
        pair produces a confusing empty result instead of an error.
        """
        if self.canny_low >= self.canny_high:
            raise ValueError(
                f"canny_low ({self.canny_low}) must be below canny_high "
                f"({self.canny_high})."
            )
        if self.min_radius >= self.max_radius:
            raise ValueError(
                f"min_radius ({self.min_radius}) must be below max_radius "
                f"({self.max_radius})."
            )
        return self


class ConvertMeta(BaseModel):
    """Server-side timing and provenance attached to a successful response."""

    point_count: int
    elapsed_ms: int
    source_size: list[int] | None
    extractor: str
    truncated_to_cap: bool = False
    """True when the sampler stopped at `target_points` rather than because
    the image ran out of room — a hint that lowering min_radius would help."""


def ui_schema() -> dict[str, Any]:
    """
    The option schema plus group ordering, for the page to build controls from.

    Returned by `GET /api/options` so the UI has exactly one source of truth
    for defaults, ranges, and help text: this module.
    """
    return {
        "groups": GROUPS,
        "schema": ConvertOptions.model_json_schema(),
        "defaults": ConvertOptions().model_dump(),
    }
