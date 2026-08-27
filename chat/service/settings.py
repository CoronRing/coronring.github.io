"""
Runtime configuration for the site-chat service, read once from the environment.

Same discipline as the particle-wave service next door: every knob is an
environment variable, so one image runs unchanged locally and on the Oracle
host. Deployed values live in `infra/compose.yml`, except the API keys, which
are uploaded separately into `infra/chat.env` and never enter the repo.

The one setting with no safe default is `CHAT_GEMINI_API_KEYS`. With it unset
the service still starts and still serves `/api/health` — it just refuses to
answer, and says so. A backend that exits on a missing key takes the whole
site's chat UI down with no diagnosable signal, which is worse than a running
service that reports `degraded`.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Final

DEFAULT_PORT: Final[int] = 7870

# Model preference order, best first.
#
# Verified against ListModels on 2026-08-18 with the deployed keys; every name
# here answered `generateContent`. Notes on the choices:
#
#   * `gemini-3.7-flash` is the requested quality target. Measured on these
#     keys it is also the slowest and least available by a wide margin — 32-55 s
#     to answer, frequent 503s, and ~40 s to *report* one. It leads the chain as
#     asked, and `request_timeout_s` is what keeps that affordable.
#   * `gemini-3.5-flash` measured 2.7-4.0 s with 5/5 success and the only
#     implicit-cache hits of any model tried (41% of the prompt). If chat
#     latency ever matters more than having the newest model, promoting it is a
#     one-variable change:
#         CHAT_MODELS=gemini-3.5-flash,gemini-3.7-flash,gemini-3.6-flash
#   * The brief asked for "3.1 flash". No such text model exists: the 3.1 line
#     ships only `-lite`, `-image`, and `-tts` variants. `gemini-3-flash-preview`
#     takes that rung as the nearest full-size flash, and `gemini-3.1-flash-lite`
#     is kept at the tail as extra headroom below the named last resort.
DEFAULT_MODELS: Final[tuple[str, ...]] = (
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
)

# Reached only when every model above is rate-limited or unavailable. Cheaper
# and weaker; answering with it beats not answering.
DEFAULT_FALLBACK_MODELS: Final[tuple[str, ...]] = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
)


def _int(name: str, default: int, *, minimum: int = 1) -> int:
    """Read a positive int, falling back to the default on anything unusable."""
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def parse_key_list(raw: str) -> tuple[str, ...]:
    """
    Parse the API-key list, tolerating the three shapes it turns up in.

    The project's own `.env` stores it as a *bracketed but unquoted* list —
    `[AQ.aaa, AQ.bbb]` — which is neither JSON nor CSV, and which a plain
    `split(",")` silently mangles into keys carrying a leading `[` and a
    trailing `]`. Those keys authenticate as far as the transport and then fail
    at the API with `API_KEY_INVALID`, which reads exactly like a revoked
    credential. Handling the shape here is worth more than the four lines it
    costs.

    Accepted:
        ``AQ.aaa,AQ.bbb``          plain CSV
        ``["AQ.aaa", "AQ.bbb"]``   JSON array
        ``[AQ.aaa, AQ.bbb]``       bracketed, unquoted

    :param raw: The raw environment value.
    :returns: Keys in declared order, duplicates and blanks removed.
    """
    text = raw.strip()
    if not text:
        return ()

    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            text = text[1:-1]
        else:
            if isinstance(parsed, list):
                text = ",".join(str(item) for item in parsed)

    seen: dict[str, None] = {}
    for item in text.split(","):
        key = item.strip().strip("\"'").strip()
        if key:
            seen.setdefault(key, None)
    return tuple(seen)


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the environment, built once at import time."""

    # ── Provider ──────────────────────────────────────────────────────
    gemini_api_keys: tuple[str, ...] = ()
    """
    Every key the rotation may use. Order is not significance — the ring hands
    them out evenly. More keys can be added with no code change.
    """

    models: tuple[str, ...] = DEFAULT_MODELS
    """Preference order. Each is tried against every healthy key before the
    next one is considered, so a busy model costs latency, not an answer."""

    fallback_models: tuple[str, ...] = DEFAULT_FALLBACK_MODELS
    """Tried only after `models` is exhausted."""

    request_timeout_s: float = 40.0
    """
    Per-attempt ceiling. The chain may outlast this; a single call may not.

    This is a *socket* timeout, so it applies per read, not to the call as a
    whole — which cuts both ways and is why the value moved.

    It was 20 s, sized around `gemini-3.7-flash` taking roughly forty seconds to
    return a 503 when busy. That reasoning held for the failure case and broke
    the success case: measured inter-frame gaps on a healthy 3.7-flash stream
    reach **12 seconds**, so a tight budget risks expiring in the middle of a
    perfectly good answer. A truncated answer is a worse outcome for a visitor
    than a slow one, so the budget is generous and the escalating cooldowns in
    `keyring.py` are what keep a flapping model out of rotation.
    """

    max_output_tokens: int = 4096
    """
    A ceiling on **thinking plus answer**, not on the answer.

    This is the single most expensive thing to get wrong here, and it fails
    silently in both directions. Thinking tokens are drawn from this same
    budget, so a cap sized for the visible answer gets spent on deliberation
    and the response is cut off — or, if thinking exhausts it entirely, comes
    back as a 200 with empty text. Both were observed in production at 1400:
    `gemini-3.7-flash` returned an answer that stopped mid-list after 38 output
    tokens, having spent the rest on thoughts.

    So this is set far above what any answer needs. It costs nothing to do so —
    output is billed on tokens actually produced, not on the cap — and
    `finish_reason` is checked besides, because a cap this size being hit at
    all means something is wrong.
    """

    thinking_budget: int = 512
    """
    Thinking tokens allowed per answer. Non-zero because grounded, cited
    answers are measurably better with a little deliberation, and quality is
    the stated priority.

    Treated by the API as a hint rather than a guarantee — an observed run
    produced thought tokens with this set to `0` — which is the other half of
    why `max_output_tokens` carries so much headroom.
    """

    temperature: float = 0.2
    """Low: the job is faithful retrieval from a corpus, not invention."""

    # ── Corpus ────────────────────────────────────────────────────────
    corpus_url: str = "https://coronring.github.io/corpus.json"
    """Where the built site publishes its own text. Fetched, not bundled, so
    content changes reach the assistant without a backend redeploy."""

    corpus_refresh_s: float = 900.0
    """How often to re-check, with `ETag`, in the background."""

    corpus_max_bytes: int = 8 * 1024 * 1024
    """Ceiling on the fetched document, so a broken build cannot exhaust memory."""

    # ── Request limits ────────────────────────────────────────────────
    allowed_origins: tuple[str, ...] = ()
    """Cross-origin allowlist. Empty means same-origin only."""

    max_question_chars: int = 2_000
    max_history_turns: int = 12
    """Turns kept from the client's transcript. Older ones are dropped."""

    max_history_chars: int = 12_000
    """Total budget for history after truncation."""

    max_concurrency: int = 6
    """Simultaneous upstream calls. These are IO-bound, so this is about the
    provider's patience rather than the host's CPU."""

    rate_limit_per_min: int = 10
    rate_limit_burst: int = 4

    # ── Answer cache ──────────────────────────────────────────────────
    answer_cache_size: int = 256
    answer_cache_ttl_s: float = 3600.0
    """
    First-turn answers only — see `answers.py`. On a personal site the same
    handful of questions arrive over and over, and the free tier's binding
    constraint is requests per minute, not tokens. Serving a repeat from memory
    is the single largest quota saving available.
    """

    # ── Embeddings ────────────────────────────────────────────────────
    embed_model: str = "gemini-embedding-001"
    """
    Model behind `/api/embed`, used by the semantic comparison in the diff tool.

    Deliberately not in `all_models`: the key ring tracks quota per (key,
    model), the embedding quota is a separate pool from the generation quota,
    and folding it into the chat chain would let a busy diff session demote the
    keys the assistant answers on.
    """

    embed_enabled: bool = True
    """Kill switch. Set CHAT_EMBED_ENABLED=0 to answer 503 without a redeploy."""

    embed_dimensions: int = 768
    """
    Output width. 768 is the knee of the curve: it matches 3072 closely on
    similarity tasks at a quarter of the bytes over the wire, and it is what a
    browser can hold for a few hundred segments without stuttering.
    """

    embed_max_texts: int = 64
    """
    Texts per request. The tool sends two documents plus their segments, and
    this is the ceiling on how finely a document can be split before the client
    has to batch.
    """

    embed_max_chars: int = 8_000
    """Per text. Above the model's own input limit there is no point paying for
    tokens that get truncated anyway."""

    embed_max_total_chars: int = 120_000
    """Across the whole request, so 64 texts at the per-text cap is not a way
    around the size limit."""

    embed_rate_limit_per_min: int = 20
    """
    Its own bucket, more generous than the chat one.

    An embed call is a fraction of the cost of an answer and the tool naturally
    fires several as someone edits, so sharing the chat limiter would make the
    assistant unusable for anyone who had just used the diff tool.
    """

    embed_rate_limit_burst: int = 8

    # ── Server ────────────────────────────────────────────────────────
    port: int = DEFAULT_PORT
    trust_forwarded_for: bool = True
    log_level: str = "info"

    # Not read from the environment; derived so `/api/health` can report it.
    _unused: bool = field(default=False, repr=False)

    @property
    def configured(self) -> bool:
        """Can the service actually answer?"""
        return bool(self.gemini_api_keys)

    @property
    def all_models(self) -> tuple[str, ...]:
        """The full attempt order, primaries then fallbacks."""
        return (*self.models, *self.fallback_models)


def load() -> Settings:
    """
    Build the settings snapshot from the current environment.

    Every fallback below is read off `d`, a default-constructed `Settings`,
    rather than written out again as a literal. That is not tidiness — it is the
    fix for a bug this file shipped twice.

    When the fallbacks were literals, the dataclass field and the loader each
    held their own copy of the same default, and only the loader's copy had any
    effect. Editing the field (with its carefully reasoned docstring) changed
    *nothing at runtime*, silently: `max_output_tokens` was documented as 4096
    while the service ran on 1400, and `request_timeout_s` was documented as 20
    while it ran on 60. Both were found by accident, in production.

    With the defaults sourced from the dataclass there is one copy, and the
    docstring next to it is necessarily the truth.
    """
    d = Settings()
    return Settings(
        gemini_api_keys=parse_key_list(os.environ.get("CHAT_GEMINI_API_KEYS", "")),
        models=_csv("CHAT_MODELS", d.models),
        fallback_models=_csv("CHAT_FALLBACK_MODELS", d.fallback_models),
        request_timeout_s=_float("CHAT_REQUEST_TIMEOUT_S", d.request_timeout_s, minimum=5.0),
        max_output_tokens=_int("CHAT_MAX_OUTPUT_TOKENS", d.max_output_tokens, minimum=512),
        thinking_budget=_int("CHAT_THINKING_BUDGET", d.thinking_budget, minimum=0),
        temperature=_float("CHAT_TEMPERATURE", d.temperature),
        corpus_url=os.environ.get("CHAT_CORPUS_URL", d.corpus_url).strip(),
        corpus_refresh_s=_float("CHAT_CORPUS_REFRESH_S", d.corpus_refresh_s, minimum=30.0),
        corpus_max_bytes=_int("CHAT_CORPUS_MAX_BYTES", d.corpus_max_bytes, minimum=1024),
        allowed_origins=_csv("CHAT_ALLOWED_ORIGINS", d.allowed_origins),
        max_question_chars=_int("CHAT_MAX_QUESTION_CHARS", d.max_question_chars, minimum=16),
        max_history_turns=_int("CHAT_MAX_HISTORY_TURNS", d.max_history_turns, minimum=0),
        max_history_chars=_int("CHAT_MAX_HISTORY_CHARS", d.max_history_chars, minimum=0),
        max_concurrency=_int("CHAT_MAX_CONCURRENCY", d.max_concurrency),
        rate_limit_per_min=_int("CHAT_RATE_LIMIT_PER_MIN", d.rate_limit_per_min),
        rate_limit_burst=_int("CHAT_RATE_LIMIT_BURST", d.rate_limit_burst),
        answer_cache_size=_int("CHAT_ANSWER_CACHE_SIZE", d.answer_cache_size, minimum=0),
        answer_cache_ttl_s=_float("CHAT_ANSWER_CACHE_TTL_S", d.answer_cache_ttl_s, minimum=0.0),
        embed_model=os.environ.get("CHAT_EMBED_MODEL", d.embed_model).strip(),
        embed_enabled=os.environ.get("CHAT_EMBED_ENABLED", "1") != "0",
        embed_dimensions=_int("CHAT_EMBED_DIMENSIONS", d.embed_dimensions, minimum=128),
        embed_max_texts=_int("CHAT_EMBED_MAX_TEXTS", d.embed_max_texts, minimum=2),
        embed_max_chars=_int("CHAT_EMBED_MAX_CHARS", d.embed_max_chars, minimum=64),
        embed_max_total_chars=_int(
            "CHAT_EMBED_MAX_TOTAL_CHARS", d.embed_max_total_chars, minimum=128
        ),
        embed_rate_limit_per_min=_int(
            "CHAT_EMBED_RATE_LIMIT_PER_MIN", d.embed_rate_limit_per_min
        ),
        embed_rate_limit_burst=_int("CHAT_EMBED_RATE_LIMIT_BURST", d.embed_rate_limit_burst),
        port=_int("PORT", d.port),
        trust_forwarded_for=os.environ.get("CHAT_TRUST_FORWARDED_FOR", "1") != "0",
        log_level=os.environ.get("CHAT_LOG_LEVEL", d.log_level),
    )


settings: Final[Settings] = load()
