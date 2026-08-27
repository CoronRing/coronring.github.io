"""
Tests for `/api/embed` and the module behind it.

Same principle as `test_chat.py`: the provider call is not mocked, because a
mock of a wire format mostly tests the mock. What is covered here is the part
that fails *silently* — a vector that is not unit length, a batch whose order no
longer matches its input, and the request caps that stop one visitor spending
the whole free-tier quota.

The normalisation test is the important one. `gemini-embedding-001` returns
unit-length vectors only at 3072 dimensions, so below that a dot product and a
cosine disagree by up to 20% with nothing to indicate it. If the boundary stops
normalising, every score downstream shifts and no test that only checks shapes
would notice.
"""

from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from service import embed as embed_mod
from service import gemini
from service.main import embed_texts
from service.schemas import EmbedRequest
from service.settings import settings


def call(texts: list[str]) -> tuple[int, str]:
    """
    Drive the handler directly and report ``(status, detail)``.

    Starlette's `TestClient` needs an HTTP transport this service does not
    depend on, and the existing suite next door imports modules rather than
    standing up a client. Same approach here: validate through the real Pydantic
    model, await the real handler, and read the `HTTPException` it raises. It
    exercises everything except the routing table, which FastAPI owns.
    """
    try:
        request = EmbedRequest(texts=texts)
    except ValidationError as error:
        return 422, str(error)
    try:
        asyncio.run(embed_texts(request))
    except HTTPException as error:
        return error.status_code, str(error.detail)
    return 200, ""


# ──────────────────────────────────────────────────────────────────────────
# Normalisation
# ──────────────────────────────────────────────────────────────────────────


class TestNormalise:
    def test_scales_to_unit_length(self) -> None:
        assert embed_mod._l2_normalise([3.0, 4.0]) == (0.6, 0.8)

    def test_already_unit_is_unchanged(self) -> None:
        values = embed_mod._l2_normalise([1.0, 0.0, 0.0])
        assert values == (1.0, 0.0, 0.0)

    def test_zero_vector_does_not_produce_nan(self) -> None:
        """A vector of zeros is noticeable; a vector of NaN poisons every score."""
        values = embed_mod._l2_normalise([0.0, 0.0])
        assert values == (0.0, 0.0)
        assert not any(math.isnan(v) for v in values)

    def test_negative_components_survive(self) -> None:
        values = embed_mod._l2_normalise([-3.0, 4.0])
        assert values[0] < 0
        assert abs(math.sqrt(sum(v * v for v in values)) - 1.0) < 1e-12

    @pytest.mark.parametrize(
        "raw",
        [
            [1.0, 2.0, 3.0],
            [-5.0, 0.5, 100.0, -0.001],
            [0.1] * 768,
        ],
    )
    def test_result_is_always_unit_length(self, raw: list[float]) -> None:
        values = embed_mod._l2_normalise(raw)
        assert abs(math.sqrt(sum(v * v for v in values)) - 1.0) < 1e-9


# ──────────────────────────────────────────────────────────────────────────
# Response parsing
# ──────────────────────────────────────────────────────────────────────────


class TestExtract:
    def test_batch_shape(self) -> None:
        payload = {"embeddings": [{"values": [1, 2]}, {"values": [3, 4]}]}
        assert embed_mod._extract(payload) == [[1.0, 2.0], [3.0, 4.0]]

    def test_single_shape(self) -> None:
        """`:embedContent` answers with `embedding`, not `embeddings`."""
        assert embed_mod._extract({"embedding": {"values": [1, 2]}}) == [[1.0, 2.0]]

    def test_empty_payload(self) -> None:
        assert embed_mod._extract({}) == []

    def test_order_is_preserved(self) -> None:
        """The caller matches vectors to inputs by index, so order is a contract."""
        payload = {"embeddings": [{"values": [i]} for i in range(10)]}
        assert embed_mod._extract(payload) == [[float(i)] for i in range(10)]

    def test_non_dict_entries_are_skipped(self) -> None:
        payload = {"embeddings": [{"values": [1]}, "junk", {"values": [2]}]}
        assert embed_mod._extract(payload) == [[1.0], [2.0]]


class TestCosine:
    def test_identical(self) -> None:
        assert embed_mod.cosine((0.6, 0.8), (0.6, 0.8)) == pytest.approx(1.0)

    def test_orthogonal(self) -> None:
        assert embed_mod.cosine((1.0, 0.0), (0.0, 1.0)) == pytest.approx(0.0)

    def test_opposite(self) -> None:
        assert embed_mod.cosine((1.0, 0.0), (-1.0, 0.0)) == pytest.approx(-1.0)

    def test_zero_vector_is_zero_not_nan(self) -> None:
        assert embed_mod.cosine((0.0, 0.0), (1.0, 0.0)) == 0.0

    def test_mismatched_widths_use_the_shorter(self) -> None:
        assert embed_mod.cosine((1.0, 0.0, 0.0), (1.0, 0.0)) == pytest.approx(1.0)


# ──────────────────────────────────────────────────────────────────────────
# Empty batch
# ──────────────────────────────────────────────────────────────────────────


class TestEmptyBatch:
    def test_no_texts_makes_no_call(self) -> None:
        """Guarded before the request, so an empty list is not a 400 upstream."""
        result = embed_mod.embed(api_key="unused", model="m", texts=[])
        assert result.embeddings == ()
        assert result.model == "m"


# ──────────────────────────────────────────────────────────────────────────
# Endpoint contract
# ──────────────────────────────────────────────────────────────────────────


class TestEndpoint:
    def test_rejects_empty_text_list(self) -> None:
        status, _ = call([])
        assert status == 422

    def test_rejects_too_many_texts(self) -> None:
        status, _ = call(["x"] * (settings.embed_max_texts + 1))
        assert status == 422

    def test_rejects_whitespace_only_text(self) -> None:
        """Cleaning turns this into an empty string, which embeds to nothing useful."""
        status, detail = call(["hello", "   \n  "])
        assert status == 422
        assert "empty" in detail.lower()

    def test_rejects_oversized_batch(self) -> None:
        """Per-text caps must not be a way around the total budget."""
        each = "a" * settings.embed_max_chars
        needed = settings.embed_max_total_chars // settings.embed_max_chars + 2
        count = min(needed, settings.embed_max_texts)
        status, detail = call([each] * count)
        assert status == 413, detail

    def test_unconfigured_deployment_refuses_rather_than_crashing(self) -> None:
        """With no keys the endpoint must answer 503, not 500."""
        if settings.configured:
            pytest.skip("this deployment has keys configured")
        status, _ = call(["hello"])
        assert status == 503

    def test_request_model_rejects_a_non_list(self) -> None:
        with pytest.raises(ValidationError):
            EmbedRequest(texts="not a list")  # type: ignore[arg-type]

    def test_request_model_defaults_dimensions(self) -> None:
        """A client may omit it, and the server decides."""
        assert EmbedRequest(texts=["a"]).dimensions == settings.embed_dimensions

    def test_health_advertises_the_capability(self) -> None:
        """The frontend probes this to decide whether to offer the remote engine."""
        from service.main import health

        body = asyncio.run(health())
        assert "embed" in body
        for key in ("enabled", "model", "dimensions", "max_texts", "max_chars"):
            assert key in body["embed"], key
        assert isinstance(body["embed"]["enabled"], bool)


# ──────────────────────────────────────────────────────────────────────────
# Shared failure classification
# ──────────────────────────────────────────────────────────────────────────


class TestSharedClassifier:
    def test_embed_uses_the_public_alias(self) -> None:
        """
        `embed.py` deliberately shares `gemini.classify` rather than deriving its
        own status-code rules. Two copies would mean two places to update when a
        provider changes a code, and the second one would be missed.
        """
        assert gemini.classify is gemini._classify

    def test_retryable_flags_are_distinguished(self) -> None:
        assert gemini.classify(429, b"{}", None).retryable
        assert gemini.classify(503, b"{}", None).retryable
        assert not gemini.classify(400, b'{"error":{"message":"bad body"}}', None).retryable
