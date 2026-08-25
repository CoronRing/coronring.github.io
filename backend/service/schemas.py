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

# `short` is shown beside the heading; `help` is the tier the page surfaces on
# hover. Same split as the fields themselves - see `_f`.
GROUPS: list[dict[str, str]] = [
    {
        "id": "preprocess",
        "label": "Preprocess",
        "short": "before anything is measured",
        "help": "What the image looks like before anything is measured.",
    },
    {
        "id": "edges",
        "label": "Edge detection",
        "short": "where the contours are",
        "help": "Canny thresholds. Lower values keep fainter contours.",
    },
    {
        "id": "importance",
        "label": "Importance map",
        "short": "where points are worth spending",
        "help": "How the pixels are scored for where points are worth spending.",
    },
    {
        "id": "sampling",
        "label": "Point sampling",
        "short": "how many points, and how far apart",
        "help": "Poisson-disk placement. min radius is the real density lever.",
    },
]


def _f(
    default: Any,
    *,
    group: str,
    label: str,
    short: str | None = None,
    step: float | None = None,
    help: str | None = None,
    **kwargs: Any,
) -> Any:
    """
    Field with the extra metadata the page needs to render a control.

    Descriptions come in two tiers. `short` is a few words shown under the
    control, so a panel can be read at a glance; `help` is the full explanation,
    surfaced on hover. Either tier alone fails one way or the other: a label
    does not say what a parameter does, and a paragraph under every control
    turns the panel into a scroll.
    """
    extra: dict[str, Any] = {"x-group": group, "x-label": label}
    if short is not None:
        extra["x-short"] = short
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
        short="longest edge before anything is measured",
        step=64,
        help="Longest edge is capped to this before processing, in pixels.",
    )
    clahe_clip: Annotated[float, Field(ge=0.0, le=8.0)] = _f(
        2.0,
        group="preprocess",
        label="CLAHE clip",
        short="local contrast boost; 0 is off",
        step=0.1,
        help="Contrast Limited Adaptive Histogram Equalization. Divides image into contextual "
             "tiles, clips histogram peaks, and enhances subtle gradients in dark/shadow regions "
             "without noise blowup. 0 disables it.",
    )
    blur_sigma: Annotated[float, Field(ge=0.0, le=5.0)] = _f(
        0.0,
        group="preprocess",
        label="Pre-blur sigma",
        short="smoothing before contrast equalisation",
        step=0.1,
        help="Gaussian pre-blur before contrast equalization. Suppresses high-frequency sensor "
             "noise.",
    )

    # ── Edges ─────────────────────────────────────────────────────────
    canny_blur_sigma: Annotated[float, Field(ge=0.0, le=6.0)] = _f(
        1.4,
        group="edges",
        label="Canny blur",
        short="smoothing before the gradient",
        step=0.1,
        help="Gaussian blur applied inside the edge detector to smooth gradient differentiation.",
    )
    canny_low: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.05,
        group="edges",
        label="Low threshold",
        short="faint edges kept above this",
        step=0.01,
        help="Hysteresis lower floor. Continuous edges extending from strong contours are "
             "preserved above this.",
    )
    canny_high: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.15,
        group="edges",
        label="High threshold",
        short="strong edges seeded above this",
        step=0.01,
        help="Hysteresis upper ceiling. Pixels with gradient magnitude above this unconditionally "
             "seed edge contours.",
    )

    # ── Importance ────────────────────────────────────────────────────
    feature_mode: Literal["hybrid", "edge", "tone", "bw_intensity"] = _f(
        "hybrid",
        group="importance",
        label="Feature mode",
        short="what the trace scores pixels on",
        help="Saliency algorithm: 'hybrid' blends edge silhouettes with local tonal contrast; "
             "'edge' isolates geometric contours; 'tone' tracks shading; 'bw_intensity' maps raw "
             "pixel luminance to point density.",
    )
    edge_weight: Annotated[float, Field(ge=0.0, le=2.0)] = _f(
        0.8,
        group="importance",
        label="Edge weight",
        short="how much contours count",
        step=0.05,
        help="Edge gradient contribution multiplier in hybrid mode.",
    )
    tone_weight: Annotated[float, Field(ge=0.0, le=2.0)] = _f(
        0.65,
        group="importance",
        label="Tone weight",
        short="how much shading counts",
        step=0.05,
        help="Local-contrast tone contribution multiplier in hybrid mode.",
    )
    tone_sigma: Annotated[float, Field(ge=1.0, le=40.0)] = _f(
        10.0,
        group="importance",
        label="Tone sigma",
        short="size of the shading detail kept",
        step=0.5,
        help="Neighbourhood radius for local contrast calculation, in pixels.",
    )
    tone_gamma: Annotated[float, Field(ge=0.1, le=3.0)] = _f(
        0.85,
        group="importance",
        label="Tone gamma",
        short="contrast curve on the shading",
        step=0.05,
        help="Gamma curve exponent for tone saliency. Values below 1.0 lift subtle mid-tones into "
             "the feature map.",
    )
    bw_polarity: Literal["white_more", "black_more"] = _f(
        "white_more",
        group="importance",
        label="BW polarity",
        short="trace the light or the dark side",
        help="Density target in bw_intensity mode: 'black_more' concentrates dense particles on "
             "dark/black regions (great for logos, text, silhouettes); 'white_more' concentrates "
             "on bright highlights.",
    )
    bw_gamma: Annotated[float, Field(ge=0.1, le=4.0)] = _f(
        1.0,
        group="importance",
        label="BW gamma",
        short="contrast curve on brightness",
        step=0.05,
        help="Nonlinear contrast curve exponent for bw_intensity mode.",
    )
    feature_quantile: Annotated[float, Field(ge=0.0, le=0.99)] = _f(
        0.62,
        group="importance",
        label="Feature quantile",
        short="share of the image left untraced",
        step=0.01,
        help="Keeps the top slice of the importance map. Higher is more "
        "selective.",
    )
    feature_floor: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.08,
        group="importance",
        label="Feature floor",
        short="lowest score still worth a point",
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
        short="how many points to aim for",
        step=100,
        help="Upper bound on point count. The min radius below usually binds "
        "first — if raising this does nothing, lower the radius.",
    )
    min_radius: Annotated[float, Field(ge=0.8, le=24.0)] = _f(
        2.0,
        group="sampling",
        label="Min radius",
        short="closest two points may sit",
        step=0.1,
        help="Closest two points may sit, in pixels. The real density lever.",
    )
    max_radius: Annotated[float, Field(ge=1.0, le=60.0)] = _f(
        12.0,
        group="sampling",
        label="Max radius",
        short="furthest apart in empty areas",
        step=0.5,
        help="Spacing in the flattest regions of the image.",
    )
    radius_gamma: Annotated[float, Field(ge=0.1, le=3.0)] = _f(
        0.5,
        group="sampling",
        label="Radius gamma",
        short="how sharply density follows detail",
        step=0.05,
        help="Below 1 concentrates points harder onto detail.",
    )
    k_candidates: Annotated[int, Field(ge=4, le=60)] = _f(
        30,
        group="sampling",
        label="Candidates (k)",
        short="placement attempts per point",
        step=1,
        help="Bridson trial count per active point. Higher packs tighter and "
        "costs more.",
    )
    fill_background: bool = _f(
        False,
        group="sampling",
        label="Fill background",
        short="scatter points over empty areas",
        help="Scatter sparse points across empty regions so the whole canvas "
        "reacts to the cursor.",
    )
    background_ratio: Annotated[float, Field(ge=0.0, le=1.0)] = _f(
        0.15,
        group="sampling",
        label="Background ratio",
        short="how many of those to add",
        step=0.01,
        help="Background points as a fraction of the traced points.",
    )
    rng_seed: Annotated[int, Field(ge=0, le=2**31 - 1)] | None = _f(
        7,
        group="sampling",
        label="Seed",
        short="fix it to reproduce a cloud",
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
