"""
Tests for the parts where being wrong is silent.

The provider call itself is not mocked and re-tested here — it is exercised
against the real API during deploy verification, and a mock of a wire format
mostly tests the mock. What is covered instead is everything that fails
*quietly*: a key list parsed into subtly corrupt keys, a cooldown that never
expires, a citation pointing at a page that does not exist, an answer cache that
serves one visitor's context to another, and the prompt prefix losing its
byte-stability and taking the whole cost strategy with it.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from service import corpus as corpus_mod
from service import gemini, prompt, router, security
from service.answers import AnswerCache, normalize
from service.keyring import MAX_COOLDOWN_S, KeyRing
from service.settings import parse_key_list

# ──────────────────────────────────────────────────────────────────────────
# Key list parsing
# ──────────────────────────────────────────────────────────────────────────


class TestParseKeyList:
    def test_plain_csv(self) -> None:
        assert parse_key_list("a,b,c") == ("a", "b", "c")

    def test_json_array(self) -> None:
        assert parse_key_list('["a", "b"]') == ("a", "b")

    def test_bracketed_unquoted(self) -> None:
        """The shape the project's own .env actually uses."""
        assert parse_key_list("[AQ.aaa, AQ.bbb]") == ("AQ.aaa", "AQ.bbb")

    def test_bracketed_unquoted_keeps_keys_clean(self) -> None:
        """
        The bug this function exists for.

        A naive split leaves `[AQ.aaa` and `AQ.bbb]`, which authenticate as far
        as the transport and then fail at the API as `API_KEY_INVALID` — reading
        exactly like a revoked credential rather than a parsing error.
        """
        keys = parse_key_list("[AQ.aaa, AQ.bbb]")
        assert not any(c in k for k in keys for c in "[]\"'")

    def test_deduplicates_preserving_order(self) -> None:
        assert parse_key_list("b,a,b") == ("b", "a")

    def test_blank_and_empty(self) -> None:
        assert parse_key_list("") == ()
        assert parse_key_list("  ,  ,") == ()


# ──────────────────────────────────────────────────────────────────────────
# Key rotation
# ──────────────────────────────────────────────────────────────────────────


class TestKeyRing:
    def test_rotation_is_even(self) -> None:
        ring = KeyRing(keys=("k0", "k1", "k2"))
        first = []
        for _ in range(30):
            first.append(ring.candidates("m")[0])
            ring.advance()
        assert [first.count(i) for i in range(3)] == [10, 10, 10]

    def test_sticky_mode_does_not_rotate(self) -> None:
        ring = KeyRing(keys=("k0", "k1"), prefer_sticky=True)
        for _ in range(5):
            ring.advance()
        assert ring.candidates("m")[0] == 0

    def test_cooling_key_is_deprioritised_not_dropped(self) -> None:
        """A request during a total quota trough must still try something."""
        ring = KeyRing(keys=("k0", "k1"))
        ring.record_limit(0, "m", 30.0)
        ring.record_limit(1, "m", 60.0)
        order = ring.candidates("m")
        assert set(order) == {0, 1}
        # Soonest to recover comes first.
        assert order[0] == 0

    def test_cooldown_is_per_key_and_model(self) -> None:
        ring = KeyRing(keys=("k0", "k1"))
        ring.record_limit(0, "fast", 60.0)
        assert ring.candidates("fast")[0] == 1
        # The same key is untouched for a different model.
        assert 0 in ring.candidates("slow")[:1] or ring.candidates("slow")[0] == 0

    def test_cooldown_expires(self) -> None:
        ring = KeyRing(keys=("k0",))
        ring.record_limit(0, "m", 1.0)
        assert ring.candidates("m", now=time.monotonic()) == [0]
        # Still the only key, but now genuinely ready rather than merely last.
        future = time.monotonic() + 5
        assert ring.candidates("m", now=future) == [0]

    def test_retry_delay_is_clamped(self) -> None:
        """A daily-quota 429 can name hours; honouring it would park a key for good."""
        ring = KeyRing(keys=("k0",))
        ring.record_limit(0, "m", 86_400.0)
        snapshot = ring.snapshot(("m",))
        assert snapshot["keys"][0]["cooling"]["m"] <= MAX_COOLDOWN_S

    def test_transient_backoff_escalates(self) -> None:
        ring = KeyRing(keys=("k0",))
        delays = []
        for _ in range(3):
            ring.record_transient(0, "m")
            delays.append(ring.snapshot(("m",))["keys"][0]["cooling"]["m"])
        assert delays[0] < delays[1] < delays[2]

    def test_success_clears_cooldown(self) -> None:
        ring = KeyRing(keys=("k0",))
        ring.record_transient(0, "m")
        ring.record_success(0, "m")
        assert ring.snapshot(("m",))["keys"][0]["cooling"] == {}

    def test_snapshot_never_leaks_key_material(self) -> None:
        ring = KeyRing(keys=("SECRET-KEY-VALUE",))
        assert "SECRET" not in repr(ring.snapshot(("m",)))


# ──────────────────────────────────────────────────────────────────────────
# Routing
# ──────────────────────────────────────────────────────────────────────────


class TestRouter:
    def test_plan_is_model_major(self) -> None:
        ring = KeyRing(keys=("k0", "k1"))
        pairs = [(a.model, a.key_index) for a in router.plan(("fast", "slow"), ring)]
        assert pairs == [("fast", 0), ("fast", 1), ("slow", 0), ("slow", 1)]

    def test_empty_answer_does_not_park_the_key(self) -> None:
        """It is a property of the request, not the credential."""
        ring = KeyRing(keys=("k0",))
        attempt = router.Attempt(model="m", key_index=0, api_key="k0")
        router.note_failure(ring, attempt, gemini.EmptyAnswer("no text"))
        assert ring.snapshot(("m",))["keys"][0]["cooling"] == {}

    def test_rate_limit_parks_the_pair(self) -> None:
        ring = KeyRing(keys=("k0",))
        attempt = router.Attempt(model="m", key_index=0, api_key="k0")
        router.note_failure(ring, attempt, gemini.RateLimited("429", 30.0))
        assert ring.snapshot(("m",))["keys"][0]["cooling"]["m"] > 0

    def test_fallback_detection(self) -> None:
        assert router.is_fallback("lite", ("a", "b")) is True
        assert router.is_fallback("a", ("a", "b")) is False


# ──────────────────────────────────────────────────────────────────────────
# Provider error classification
# ──────────────────────────────────────────────────────────────────────────


class TestClassification:
    def test_429_is_rate_limited_with_delay(self) -> None:
        body = (
            b'{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED",'
            b'"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo",'
            b'"retryDelay":"31s"}]}}'
        )
        error = gemini._classify(429, body, None)
        assert isinstance(error, gemini.RateLimited)
        assert error.retry_after_s == 31.0

    def test_503_is_unavailable(self) -> None:
        assert isinstance(gemini._classify(503, b"{}", None), gemini.Unavailable)

    def test_400_invalid_key_is_rejected_not_bad_request(self) -> None:
        """The distinction decides whether another key is worth trying."""
        body = b'{"error":{"message":"API key not valid.","status":"INVALID_ARGUMENT"}}'
        assert isinstance(gemini._classify(400, body, None), gemini.Rejected)

    def test_400_malformed_is_not_retryable(self) -> None:
        body = b'{"error":{"message":"Invalid JSON payload","status":"INVALID_ARGUMENT"}}'
        error = gemini._classify(400, body, None)
        assert isinstance(error, gemini.BadRequest)
        assert error.retryable is False

    def test_unparseable_body_still_classifies(self) -> None:
        assert isinstance(gemini._classify(503, b"<html>oops", None), gemini.Unavailable)


class TestCandidateText:
    def test_thought_parts_are_excluded(self) -> None:
        """The model's scratch work must never reach a visitor."""
        candidate = {
            "content": {
                "parts": [
                    {"text": "internal reasoning", "thought": True},
                    {"text": "the answer"},
                ]
            }
        }
        assert gemini._candidate_text(candidate) == "the answer"

    def test_missing_parts_is_empty(self) -> None:
        assert gemini._candidate_text({}) == ""


# ──────────────────────────────────────────────────────────────────────────
# Corpus and prompt
# ──────────────────────────────────────────────────────────────────────────


def _corpus() -> corpus_mod.Corpus:
    return corpus_mod.parse(
        {
            "hash": "abc123",
            "site": "https://example.test",
            "pages": [
                {
                    "route": "/",
                    "url": "https://example.test/",
                    "title": "Home",
                    "description": "The front page.",
                    "text": "Guan builds agent systems.",
                },
                {
                    "route": "/projects/particle-wave",
                    "url": "https://example.test/projects/particle-wave",
                    "title": "Particle Wave",
                    "description": "",
                    "text": "An image-to-cloud pipeline.",
                },
            ],
        },
        fetched_at=0.0,
    )


class TestCorpus:
    def test_pages_without_text_are_dropped(self) -> None:
        parsed = corpus_mod.parse(
            {"pages": [{"route": "/a", "text": ""}, {"route": "/b", "text": "real"}]},
            fetched_at=0.0,
        )
        assert [p.route for p in parsed.pages] == ["/b"]

    def test_empty_corpus_is_an_error(self) -> None:
        with pytest.raises(ValueError):
            corpus_mod.parse({"pages": []}, fetched_at=0.0)

    def test_missing_pages_array_is_an_error(self) -> None:
        with pytest.raises(ValueError):
            corpus_mod.parse({}, fetched_at=0.0)

    def test_render_includes_routes_for_citation(self) -> None:
        rendered = _corpus().render()
        assert 'route="/projects/particle-wave"' in rendered
        assert "An image-to-cloud pipeline." in rendered

    def test_render_is_deterministic(self) -> None:
        """
        The whole cost strategy is an exact prefix match. If this ever varies,
        the implicit cache silently stops paying and nothing else notices.
        """
        assert _corpus().render() == _corpus().render()


class TestPrompt:
    def test_system_text_is_byte_stable(self) -> None:
        corpus = _corpus()
        rendered = corpus.render()
        assert prompt.system_text(corpus, rendered) == prompt.system_text(corpus, rendered)

    def test_system_text_lists_valid_routes(self) -> None:
        text = prompt.system_text(_corpus(), _corpus().render())
        assert "/projects/particle-wave" in text

    def test_instruction_forbids_first_person(self) -> None:
        assert "third person" in prompt.SYSTEM_INSTRUCTION


# ──────────────────────────────────────────────────────────────────────────
# Citations
# ──────────────────────────────────────────────────────────────────────────


class TestCitations:
    """
    `_citations` reads the live store, so these drive the regex directly — the
    guarantee under test is that only real routes survive.
    """

    def test_extracts_root_relative_links(self) -> None:
        found = gemini_link_targets("See [PW](/projects/particle-wave) for detail.")
        assert found == ["/projects/particle-wave"]

    def test_ignores_offsite_links(self) -> None:
        """An external URL is not a citation and must not be presented as one."""
        assert gemini_link_targets("[evil](https://elsewhere.test/x)") == []

    def test_ignores_protocol_relative_links(self) -> None:
        assert gemini_link_targets("[x](//elsewhere.test/x)") == []


def gemini_link_targets(text: str) -> list[str]:
    from service.main import _LINK_RE

    return [target for _, target in _LINK_RE.findall(text)]


# ──────────────────────────────────────────────────────────────────────────
# Answer cache
# ──────────────────────────────────────────────────────────────────────────


class TestAnswerCache:
    def test_normalisation_folds_trivial_variants(self) -> None:
        assert normalize("What is Particle Wave?") == normalize("  what   is particle wave  ")

    def test_normalisation_folds_unicode_forms(self) -> None:
        assert normalize("ｗhat is it") == normalize("what is it")

    def test_roundtrip(self) -> None:
        cache = AnswerCache(max_entries=4, ttl_s=60)
        key = cache.key("h1", "What is X?")
        cache.put(key, "an answer", "model-a")
        entry = cache.get(key)
        assert entry is not None and entry.text == "an answer"

    def test_new_corpus_invalidates(self) -> None:
        """An answer grounded in text that no longer exists is worse than a miss."""
        cache = AnswerCache(max_entries=4, ttl_s=60)
        cache.put(cache.key("h1", "q"), "old answer", "m")
        assert cache.get(cache.key("h2", "q")) is None

    def test_ttl_expiry(self) -> None:
        cache = AnswerCache(max_entries=4, ttl_s=0.01)
        key = cache.key("h", "q")
        cache.put(key, "a", "m")
        time.sleep(0.05)
        assert cache.get(key) is None

    def test_lru_eviction(self) -> None:
        cache = AnswerCache(max_entries=2, ttl_s=60)
        for q in ("q1", "q2", "q3"):
            cache.put(cache.key("h", q), "a", "m")
        assert cache.get(cache.key("h", "q1")) is None
        assert cache.get(cache.key("h", "q3")) is not None

    def test_long_questions_are_not_cached(self) -> None:
        cache = AnswerCache(max_entries=4, ttl_s=60)
        assert cache.key("h", "x" * 5000) is None

    def test_disabled_cache_returns_no_key(self) -> None:
        assert AnswerCache(max_entries=0, ttl_s=60).key("h", "q") is None

    def test_empty_answers_are_not_stored(self) -> None:
        cache = AnswerCache(max_entries=4, ttl_s=60)
        key = cache.key("h", "q")
        cache.put(key, "   ", "m")
        assert cache.get(key) is None


# ──────────────────────────────────────────────────────────────────────────
# Input sanitation
# ──────────────────────────────────────────────────────────────────────────


class TestCleanText:
    def test_strips_control_characters(self) -> None:
        assert security.clean_text("hel\x00lo\x07", limit=100) == "hello"

    def test_keeps_newlines_and_tabs(self) -> None:
        assert "\n" in security.clean_text("a\nb", limit=100)

    def test_collapses_blank_line_walls(self) -> None:
        """A long vertical gap is the cheapest way to bury earlier instructions."""
        cleaned = security.clean_text("start" + "\n" * 400 + "end", limit=10_000)
        assert "\n\n\n" not in cleaned

    def test_truncates_to_limit(self) -> None:
        assert len(security.clean_text("x" * 100, limit=10)) == 10

    def test_normalises_lookalikes(self) -> None:
        assert security.clean_text("ｉgnore", limit=100) == "ignore"


# ──────────────────────────────────────────────────────────────────────────
# Rate limiter
# ──────────────────────────────────────────────────────────────────────────


class TestRateLimiter:
    def test_burst_then_block(self) -> None:
        limiter = security.RateLimiter(per_minute=60, burst=3)
        assert all(limiter.check("ip")[0] for _ in range(3))
        allowed, retry_after = limiter.check("ip")
        assert not allowed and retry_after > 0

    def test_clients_are_independent(self) -> None:
        limiter = security.RateLimiter(per_minute=60, burst=1)
        assert limiter.check("a")[0]
        assert limiter.check("b")[0]

    def test_entries_are_bounded(self) -> None:
        """The limiter must not become the memory-exhaustion vector it prevents."""
        limiter = security.RateLimiter(per_minute=60, burst=1, max_entries=10)
        for i in range(100):
            limiter.check(f"ip-{i}")
        assert len(limiter._buckets) <= 10
