"""
Text embeddings, for the semantic comparison in the site's diff tool.

## Why this lives in the chat service

It needs exactly what the chat service already has and nothing the chat service
does not: Gemini credentials, an even rotation across them, per-(key, model)
cooldowns, and a rate limiter. Standing up a second service to reuse all four
would mean maintaining two copies of the interesting parts.

The seam is narrow on purpose. `embed()` is the only entry point, it shares
`keyring.KeyRing` and the failure classification in `gemini.py`, and it shares
no state with the chat path.

## The normalisation trap

`gemini-embedding-001` returns unit-length vectors **only at its native 3072
dimensions**. Ask for 768 and you get a truncated slice of that vector, which is
no longer unit length. Cosine still works because cosine divides out the
magnitude, but a dot product does not, and the two silently disagree by up to
20% at the low dimensions.

So vectors are L2-normalised here, once, at the boundary. Every consumer then
gets the property it assumes it already had. This is documented in Google's own
API reference and is the single most common way this model is misused.

Reference: https://ai.google.dev/gemini-api/docs/embeddings
"""

from __future__ import annotations

import json
import logging
import math
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Final, Literal

from .gemini import API_ROOT, USER_AGENT, GeminiError, Unavailable, classify

log = logging.getLogger("site-chat.embed")

#: Task types the API accepts. `SEMANTIC_SIMILARITY` is the one this tool wants:
#: it optimises the space for symmetric "how alike are these two" comparison,
#: where `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT` are an asymmetric pair meant
#: for search and are actively wrong for comparing two documents to each other.
TaskType = Literal[
    "SEMANTIC_SIMILARITY",
    "CLASSIFICATION",
    "CLUSTERING",
    "RETRIEVAL_DOCUMENT",
    "RETRIEVAL_QUERY",
    "CODE_RETRIEVAL_QUERY",
    "QUESTION_ANSWERING",
    "FACT_VERIFICATION",
]

#: Dimensions the model supports truncating to. Smaller is cheaper to move over
#: the wire and measurably less discriminating below 768, which is why 768 is
#: the default rather than the minimum.
SUPPORTED_DIMENSIONS: Final[tuple[int, ...]] = (128, 256, 512, 768, 1536, 3072)


@dataclass(frozen=True)
class Embedding:
    """One embedded text."""

    values: tuple[float, ...]
    """L2-normalised, always. See the module docstring."""

    tokens: int = 0
    """Billed tokens, when the response reports them."""


@dataclass(frozen=True)
class EmbedResult:
    """A batch of embeddings, plus what produced them."""

    embeddings: tuple[Embedding, ...]
    model: str
    dimensions: int
    task_type: str


def _l2_normalise(values: list[float]) -> tuple[float, ...]:
    """
    Scale a vector to unit length.

    A zero vector is returned unchanged rather than producing NaN. It should not
    happen, and if it does, a vector of zeros is a value a caller can notice
    while a vector of NaN poisons every score downstream.
    """
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude == 0.0:
        return tuple(values)
    return tuple(value / magnitude for value in values)


def _extract(payload: dict[str, Any]) -> list[list[float]]:
    """
    Pull vectors out of a response, accepting either shape the API returns.

    `:embedContent` answers with `embedding`, `:batchEmbedContents` with
    `embeddings`. Handled together because the batch call is used for one item
    as readily as for ten, and branching at the parse site rather than the call
    site keeps one code path.
    """
    if isinstance(payload.get("embeddings"), list):
        return [
            [float(v) for v in item.get("values", [])]
            for item in payload["embeddings"]
            if isinstance(item, dict)
        ]
    single = payload.get("embedding")
    if isinstance(single, dict):
        return [[float(v) for v in single.get("values", [])]]
    return []


def embed(
    *,
    api_key: str,
    model: str,
    texts: list[str],
    task_type: TaskType = "SEMANTIC_SIMILARITY",
    dimensions: int = 768,
    timeout: float = 20.0,
) -> EmbedResult:
    """
    Embed a batch of texts in one call.

    :param api_key: Credential for this attempt. Selected by the caller's ring.
    :param model: Embedding model name, without the ``models/`` prefix.
    :param texts: Texts to embed, in order. The result matches this order.
    :param task_type: What the vectors are for. See `TaskType`.
    :param dimensions: Output width. Clamped to `SUPPORTED_DIMENSIONS`.
    :param timeout: Socket timeout in seconds.
    :returns: One embedding per input text, unit-normalised.
    :raises GeminiError: Classified so the caller can retry on another key.
    """
    if not texts:
        return EmbedResult(embeddings=(), model=model, dimensions=dimensions, task_type=task_type)

    width = dimensions if dimensions in SUPPORTED_DIMENSIONS else 768

    body = {
        "requests": [
            {
                # Fully qualified per request. The batch endpoint requires it on
                # every entry even though the URL already names the model, and
                # omitting it is a 400 rather than a default.
                "model": f"models/{model}",
                "content": {"parts": [{"text": text}]},
                "taskType": task_type,
                "outputDimensionality": width,
            }
            for text in texts
        ]
    }

    request = urllib.request.Request(
        f"{API_ROOT}/models/{model}:batchEmbedContents",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise classify(exc.code, exc.read(), exc.headers) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise Unavailable(f"{type(exc).__name__}: {exc}") from None

    vectors = _extract(payload)
    if len(vectors) != len(texts):
        # A partial batch cannot be matched back to its inputs, and guessing the
        # alignment would silently compare the wrong pair of texts.
        raise Unavailable(
            f"expected {len(texts)} embeddings, got {len(vectors)}"
        )

    return EmbedResult(
        embeddings=tuple(Embedding(values=_l2_normalise(vector)) for vector in vectors),
        model=model,
        dimensions=width,
        task_type=task_type,
    )


def cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    """
    Cosine similarity between two vectors.

    Provided so the service can report a score alongside the vectors, for a
    client that only wants the number. Both inputs are already unit length, so
    this is a dot product, but the division is kept: it costs nothing and it
    keeps the function correct if it is ever handed a raw vector.
    """
    width = min(len(a), len(b))
    if width == 0:
        return 0.0
    dot = sum(a[i] * b[i] for i in range(width))
    norm_a = math.sqrt(sum(value * value for value in a[:width]))
    norm_b = math.sqrt(sum(value * value for value in b[:width]))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


__all__ = [
    "SUPPORTED_DIMENSIONS",
    "Embedding",
    "EmbedResult",
    "GeminiError",
    "TaskType",
    "cosine",
    "embed",
]
