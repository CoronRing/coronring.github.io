"""
Gemini client — the only place that knows the provider's wire format.

## Why a direct client rather than Railtracks or LiteLLM

Railtracks was evaluated for this (and remains the intended path for the
visualizer work later). It is the wrong tool for *this* layer today, for three
concrete reasons:

  1. **Per-request key selection.** The rotation picks a key per attempt. A
     provider wrapper that binds its credential at construction turns that into
     building and discarding an LLM object per attempt.
  2. **Cache accounting.** The entire cost strategy rests on
     `usageMetadata.cachedContentTokenCount`, which is exactly the kind of
     provider-specific field a normalising abstraction drops on the floor.
     Without it there is no way to know the strategy is working — and during
     design it *silently did not work* on the first layout tried.
  3. **Failure classification.** Falling back correctly needs 429-with-delay,
     503, and 400-invalid-key kept distinct. Wrappers tend to collapse these
     into one exception type, which is precisely the distinction the router
     needs.

The seam is kept narrow and honest: `generate()` and `stream()` are the whole
surface, and swapping in a Railtracks-backed implementation later means
matching two functions, not unpicking the service.

Reference: https://ai.google.dev/api/generate-content
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("site-chat.gemini")

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
USER_AGENT = "coronring-site-chat/1.0"


class GeminiError(Exception):
    """Base class for a failed call."""

    #: Should the router try a different (key, model) pair?
    retryable = True


class RateLimited(GeminiError):
    """429. The key is out of quota for this model, for now."""

    def __init__(self, message: str, retry_after_s: float | None) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class Unavailable(GeminiError):
    """503/500/timeout. The model is busy or the network wobbled."""


class Rejected(GeminiError):
    """The credential or the model was refused. Retrying this pair is futile."""


class EmptyAnswer(GeminiError):
    """
    A 200 whose text is empty.

    Real, not theoretical: `gemini-3.7-flash` returned exactly this twice
    during the model probe, having spent the entire output budget on thinking
    tokens. Treated as a failure so the router moves on instead of streaming a
    blank bubble to the visitor.
    """


class BadRequest(GeminiError):
    """400 that is not about the key — a malformed request. Do not retry."""

    retryable = False


@dataclass
class Usage:
    """Token accounting for one call."""

    prompt_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    thoughts_tokens: int = 0

    @property
    def cache_hit_ratio(self) -> float:
        """Fraction of the prompt served from cache. The cost metric that matters."""
        return self.cached_tokens / self.prompt_tokens if self.prompt_tokens else 0.0

    @staticmethod
    def from_metadata(meta: dict[str, Any]) -> "Usage":
        def count(name: str) -> int:
            value = meta.get(name)
            return int(value) if isinstance(value, (int, float)) else 0

        return Usage(
            prompt_tokens=count("promptTokenCount"),
            cached_tokens=count("cachedContentTokenCount"),
            output_tokens=count("candidatesTokenCount"),
            thoughts_tokens=count("thoughtsTokenCount"),
        )


#: `finishReason` meaning the response hit `maxOutputTokens`. The answer is
#: real but cut off mid-sentence, so it must never be cached and reserved as
#: the canonical answer to a question.
TRUNCATED = "MAX_TOKENS"


@dataclass
class StreamEnd:
    """Terminal metadata for a stream, delivered after the last delta."""

    usage: Usage
    finish_reason: str = ""

    @property
    def truncated(self) -> bool:
        return self.finish_reason == TRUNCATED


@dataclass
class Turn:
    """One message in the conversation."""

    role: str
    """`user` or `model` — the provider's spelling, not `assistant`."""
    text: str


@dataclass
class Completion:
    """A finished answer."""

    text: str
    usage: Usage = field(default_factory=Usage)
    finish_reason: str = ""

    @property
    def truncated(self) -> bool:
        """Did the response stop because it ran out of budget rather than words?"""
        return self.finish_reason == TRUNCATED


def _retry_delay(payload: dict[str, Any], headers: Any) -> float | None:
    """
    Dig the retry delay out of a 429.

    Google puts it in a `RetryInfo` detail as `retryDelay: "31s"`, and
    sometimes in a `Retry-After` header. Both are checked because neither is
    reliably present.
    """
    header = headers.get("Retry-After") if headers else None
    if header:
        try:
            return float(header)
        except (TypeError, ValueError):
            pass

    details = payload.get("error", {}).get("details", [])
    if isinstance(details, list):
        for detail in details:
            if not isinstance(detail, dict):
                continue
            raw = detail.get("retryDelay")
            if isinstance(raw, str):
                match = re.fullmatch(r"(\d+(?:\.\d+)?)s?", raw.strip())
                if match:
                    return float(match.group(1))
    return None


def _classify(code: int, body: bytes, headers: Any) -> GeminiError:
    """Turn an HTTP failure into the exception the router can act on."""
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}
    message = str(payload.get("error", {}).get("message", ""))[:300] or f"HTTP {code}"
    status = str(payload.get("error", {}).get("status", ""))

    if code == 429:
        return RateLimited(message, _retry_delay(payload, headers))
    if code in (500, 502, 503, 504):
        return Unavailable(message)
    if code in (401, 403):
        return Rejected(message)
    if code == 404:
        # The model name is wrong or not enabled for this project. Another key
        # might have it, so this is retryable — but not on this pair.
        return Rejected(message or "model not found")
    if code == 400:
        # 400 covers both "your key is invalid" and "your request is malformed".
        # Only the former is worth trying another key for.
        if "API_KEY_INVALID" in status or "API key not valid" in message:
            return Rejected(message)
        return BadRequest(message)
    return Unavailable(message)


def _build_body(
    *,
    system: str,
    turns: list[Turn],
    max_output_tokens: int,
    temperature: float,
    thinking_budget: int,
) -> dict[str, Any]:
    """
    Assemble the request payload.

    The stable prefix goes in `systemInstruction` and the variable part in
    `contents`; see `prompt.py` for why that split is load-bearing.
    """
    body: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": t.role, "parts": [{"text": t.text}]} for t in turns],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
            "thinkingConfig": {"thinkingBudget": thinking_budget},
        },
        # The corpus is the site's own text and the visitor's question is
        # already length-capped, so the default safety posture only risks
        # refusing benign questions about the work. Left at the provider's
        # defaults deliberately — this is a public site, not a private tool.
    }
    return body


def _request(url: str, api_key: str, body: dict[str, Any], timeout: float):
    """Build the urllib request. Extracted so `generate` and `stream` agree."""
    return urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )


def generate(
    *,
    api_key: str,
    model: str,
    system: str,
    turns: list[Turn],
    max_output_tokens: int,
    temperature: float,
    thinking_budget: int,
    timeout: float,
) -> Completion:
    """
    Ask for a complete answer in one call.

    :raises GeminiError: Classified so the caller can decide whether to retry.
    """
    body = _build_body(
        system=system,
        turns=turns,
        max_output_tokens=max_output_tokens,
        temperature=temperature,
        thinking_budget=thinking_budget,
    )
    request = _request(f"{API_ROOT}/models/{model}:generateContent", api_key, body, timeout)

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise _classify(exc.code, exc.read(), exc.headers) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise Unavailable(f"{type(exc).__name__}: {exc}") from None

    usage = Usage.from_metadata(payload.get("usageMetadata") or {})
    candidates = payload.get("candidates") or []
    if not candidates:
        raise EmptyAnswer(_blocked_reason(payload) or "no candidates returned")

    candidate = candidates[0]
    text = _candidate_text(candidate)
    if not text.strip():
        raise EmptyAnswer(
            f"empty text (finish={candidate.get('finishReason')}, "
            f"thoughts={usage.thoughts_tokens})"
        )

    return Completion(text=text, usage=usage, finish_reason=str(candidate.get("finishReason") or ""))


def stream(
    *,
    api_key: str,
    model: str,
    system: str,
    turns: list[Turn],
    max_output_tokens: int,
    temperature: float,
    thinking_budget: int,
    timeout: float,
) -> Iterator[tuple[str, StreamEnd | None]]:
    """
    Stream the answer as it is produced.

    Yields ``(text_delta, end)``. `end` is None for every text chunk; the final
    yield carries an empty delta and a `StreamEnd` with the accounting and the
    finish reason.

    Failures raised *before the first delta* are ordinary `GeminiError`s and the
    router may retry them on another pair. Once a delta has been yielded the
    answer is committed — the caller has already sent those bytes to the browser
    — so a later failure ends the stream rather than restarting it.

    :raises GeminiError: On a failure before the first token.
    """
    body = _build_body(
        system=system,
        turns=turns,
        max_output_tokens=max_output_tokens,
        temperature=temperature,
        thinking_budget=thinking_budget,
    )
    url = f"{API_ROOT}/models/{model}:streamGenerateContent?alt=sse"
    request = _request(url, api_key, body, timeout)

    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise _classify(exc.code, exc.read(), exc.headers) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise Unavailable(f"{type(exc).__name__}: {exc}") from None

    produced = False
    usage = Usage()
    finish_reason = ""
    blocked: str | None = None

    with response:
        for raw_line in response:
            line = raw_line.decode("utf-8", "replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue

            if chunk.get("usageMetadata"):
                usage = Usage.from_metadata(chunk["usageMetadata"])

            candidates = chunk.get("candidates") or []
            if not candidates:
                blocked = blocked or _blocked_reason(chunk)
                continue

            # Only the last chunk carries one, but chunks arrive in order, so
            # keeping the most recent non-empty value lands on the right one.
            if candidates[0].get("finishReason"):
                finish_reason = str(candidates[0]["finishReason"])

            delta = _candidate_text(candidates[0])
            if delta:
                produced = True
                yield delta, None

    if not produced:
        raise EmptyAnswer(blocked or "stream produced no text")

    yield "", StreamEnd(usage=usage, finish_reason=finish_reason)


def _candidate_text(candidate: dict[str, Any]) -> str:
    """
    Join a candidate's text parts, skipping the model's private reasoning.

    Thinking parts are flagged `thought: true` and must never reach the
    visitor: they are the model's scratch work, and on a public site they read
    as the assistant talking to itself.
    """
    parts = (candidate.get("content") or {}).get("parts") or []
    return "".join(
        str(part.get("text") or "")
        for part in parts
        if isinstance(part, dict) and not part.get("thought")
    )


def _blocked_reason(payload: dict[str, Any]) -> str | None:
    """Surface a safety block as a readable reason, when one is given."""
    feedback = payload.get("promptFeedback") or {}
    reason = feedback.get("blockReason")
    return f"blocked: {reason}" if reason else None
