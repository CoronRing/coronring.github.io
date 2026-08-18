"""
Service tests.

Weighted towards the hostile-input paths, because that is where the risk is:
the happy path is one call into a library that has its own tests upstream,
while the upload and option handling are this repo's own responsibility.
"""

from __future__ import annotations

import dataclasses
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from service import security
from service.main import app
from service.schemas import ConvertOptions


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def fresh_limiter(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Give every test its own rate-limit bucket.

    The limiter is deliberately process-global in production, which means a
    module's worth of tests otherwise shares one budget and everything after
    the first handful gets a 429 instead of the status it was asserting on.
    Tests that exercise throttling install their own limiter over this one.
    """
    monkeypatch.setattr(
        security, "limiter", security.RateLimiter(per_minute=100_000, burst=1_000)
    )


def make_image(
    fmt: str = "PNG",
    size: tuple[int, int] = (256, 256),
    *,
    subject: bool = True,
) -> bytes:
    """A white field with a ring and a bar — enough structure to trace."""
    from PIL import ImageDraw

    image = Image.new("RGB", size, "white")
    if subject:
        draw = ImageDraw.Draw(image)
        w, h = size
        draw.ellipse((w * 0.2, h * 0.2, w * 0.8, h * 0.8), outline="black", width=max(2, w // 40))
        draw.rectangle((w * 0.47, h * 0.05, w * 0.53, h * 0.95), fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def post_convert(client: TestClient, raw: bytes, options: dict | None = None, **kwargs):
    data = {"options": json.dumps(options)} if options is not None else None
    return client.post(
        "/api/convert",
        files={"image": ("subject.png", raw, "image/png")},
        data=data,
        **kwargs,
    )


# ── Metadata endpoints ────────────────────────────────────────────────


def test_health_reports_the_installed_package(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["package"] == "particle-wave-tool"
    assert body["version"] != "unknown", "the wheel must be installed, not run from source"
    assert "classic" in body["extractors"]


def test_options_schema_is_renderable(client: TestClient) -> None:
    body = client.get("/api/options").json()
    properties = body["schema"]["properties"]

    assert body["defaults"]["target_points"] == 4000
    group_ids = {group["id"] for group in body["groups"]}

    # Every option must be reachable by the UI: a field with no known group
    # would silently never render a control.
    for name, prop in properties.items():
        assert prop.get("x-group") in group_ids, f"{name} has no renderable group"
        assert prop.get("x-label"), f"{name} has no label"


def test_status_page_and_json_agree(client: TestClient) -> None:
    """`/status` renders whatever `/api/status` reports — one source of truth."""
    assert client.get("/status").status_code == 200
    assert client.get("/assets/status.js").status_code == 200

    body = client.get("/api/status").json()
    assert body["status"] == "ok"
    assert body["engine"]["ok"] is True
    assert body["metrics"]["uptime_seconds"] >= 0
    for key in ("conversions_ok", "uploads_rejected", "rate_limited", "in_flight"):
        assert key in body["metrics"]


def test_status_counts_real_work(client: TestClient) -> None:
    """A counter nobody increments is worse than no counter at all."""
    before = client.get("/api/status").json()["metrics"]

    post_convert(client, make_image(), {"target_points": 200})
    client.post("/api/convert", files={"image": ("x.png", b"not an image", "image/png")})
    post_convert(client, make_image(), {"target_points": 10**9})

    after = client.get("/api/status").json()["metrics"]
    assert after["conversions_ok"] == before["conversions_ok"] + 1
    assert after["uploads_rejected"] == before["uploads_rejected"] + 1
    assert after["options_rejected"] == before["options_rejected"] + 1
    assert after["points_produced"] > before["points_produced"]
    assert after["last_conversion_at"] is not None
    assert after["in_flight"] == 0, "in-flight must return to zero"


def test_engine_is_served_from_the_installed_wheel(client: TestClient) -> None:
    response = client.get("/engine/particle-wave.js")
    assert response.status_code == 200
    # The ambient-motion additions must be present, or the page's spin and
    # drift controls would be wired to nothing.
    for symbol in ("restSpin", "driftAmplitude", "spinWeightByGroup"):
        assert symbol in response.text


# ── Happy path ────────────────────────────────────────────────────────


def test_convert_returns_a_loadable_cloud(client: TestClient) -> None:
    response = post_convert(client, make_image(), {"target_points": 800, "rng_seed": 3})
    assert response.status_code == 200, response.text

    body = response.json()
    cloud, meta = body["cloud"], body["meta"]

    assert cloud["version"] == "1.0.0"
    assert cloud["encoding"] == "flat"
    assert cloud["fields"] == ["x", "y", "w", "g"]
    assert len(cloud["data"]) == cloud["meta"]["point_count"] * 4
    assert meta["point_count"] > 0
    assert meta["elapsed_ms"] >= 0

    # Normalised coordinates, or the renderer will place points off-canvas.
    xs = cloud["data"][0::4]
    ys = cloud["data"][1::4]
    assert all(0.0 <= v <= 1.0 for v in xs)
    assert all(0.0 <= v <= 1.0 for v in ys)


def test_convert_uses_defaults_when_options_omitted(client: TestClient) -> None:
    response = client.post("/api/convert", files={"image": ("x.png", make_image(), "image/png")})
    assert response.status_code == 200
    assert response.json()["meta"]["point_count"] > 0


def test_same_seed_gives_the_same_cloud(client: TestClient) -> None:
    options = {"target_points": 600, "rng_seed": 11}
    raw = make_image()
    first = post_convert(client, raw, options).json()["cloud"]["data"]
    second = post_convert(client, raw, options).json()["cloud"]["data"]
    assert first == second


def test_truncation_flag_marks_a_binding_cap(client: TestClient) -> None:
    """A small target on a detailed image must stop at the cap and say so."""
    body = post_convert(
        client, make_image(size=(512, 512)), {"target_points": 300, "min_radius": 0.8}
    ).json()
    assert body["meta"]["truncated_to_cap"] is True
    assert body["meta"]["point_count"] == 300


def test_metadata_is_stripped_from_the_source_name(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files={"image": ("../../etc/passwd.png", make_image(), "image/png")},
        data={"options": json.dumps({"target_points": 200})},
    )
    assert response.status_code == 200
    assert "/" not in response.json()["cloud"]["meta"]["source_image"]
    assert ".." not in response.json()["cloud"]["meta"]["source_image"]


# ── Option validation ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "options",
    [
        {"target_points": 10**9},          # above the cap
        {"target_points": 0},              # below the floor
        {"min_radius": 0.01},              # below the floor that bounds cost
        {"min_radius": 10, "max_radius": 5},  # inverted pair
        {"canny_low": 0.9, "canny_high": 0.2},
        {"feature_mode": "nonsense"},
        {"unknown_option": 1},             # extra="forbid"
    ],
)
def test_bad_options_are_rejected_with_field_detail(client: TestClient, options: dict) -> None:
    response = post_convert(client, make_image(), options)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail, "the page needs per-field errors"
    assert "field" in detail[0] and "message" in detail[0]


def test_malformed_options_json_is_a_400(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files={"image": ("x.png", make_image(), "image/png")},
        data={"options": "{not json"},
    )
    assert response.status_code == 400


def test_options_must_be_an_object(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files={"image": ("x.png", make_image(), "image/png")},
        data={"options": "[1, 2, 3]"},
    )
    assert response.status_code == 400


# ── Upload handling ───────────────────────────────────────────────────


def test_non_image_is_refused(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files={"image": ("payload.png", b"#!/bin/sh\nrm -rf /\n", "image/png")},
    )
    assert response.status_code == 415


def test_empty_upload_is_refused(client: TestClient) -> None:
    response = client.post("/api/convert", files={"image": ("empty.png", b"", "image/png")})
    assert response.status_code == 400


def test_declared_content_type_is_not_trusted(client: TestClient) -> None:
    """A GIF announced as a PNG still converts: the bytes decide, not the header."""
    response = client.post(
        "/api/convert",
        files={"image": ("lie.png", make_image("GIF"), "image/png")},
        data={"options": json.dumps({"target_points": 200})},
    )
    assert response.status_code == 200


def test_oversized_upload_is_refused(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    tiny = dataclasses.replace(security.settings, max_upload_bytes=2048)
    monkeypatch.setattr(security, "settings", tiny)
    response = post_convert(client, make_image(size=(900, 900)))
    assert response.status_code == 413


def test_oversized_dimensions_are_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    narrow = dataclasses.replace(security.settings, max_image_dimension=64)
    monkeypatch.setattr(security, "settings", narrow)
    response = post_convert(client, make_image(size=(256, 256)))
    assert response.status_code == 413


def test_tiny_images_are_refused(client: TestClient) -> None:
    response = post_convert(client, make_image(size=(4, 4), subject=False))
    assert response.status_code == 400


def test_decompression_bomb_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    A small file declaring a huge raster must be rejected from its header,
    before any pixels are allocated.
    """
    budget = dataclasses.replace(security.settings, max_image_pixels=10_000)
    monkeypatch.setattr(security, "settings", budget)
    response = post_convert(client, make_image(size=(1024, 1024)))
    assert response.status_code == 413


def test_unsupported_format_is_refused(client: TestClient) -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), "white").save(buffer, format="TIFF")
    response = client.post(
        "/api/convert",
        files={"image": ("x.tiff", buffer.getvalue(), "image/tiff")},
    )
    assert response.status_code == 415


def test_transparency_becomes_white_not_black() -> None:
    """
    A logo on a transparent ground must arrive as artwork on white.

    `convert("RGB")` alone leaves transparent pixels black, which turns any
    transparent export into a black rectangle and makes the edge detector trace
    the image border instead of the subject.
    """
    from PIL import ImageDraw

    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    ImageDraw.Draw(image).ellipse((16, 16, 48, 48), fill=(0, 0, 0, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    decoded = security.decode_image(buffer.getvalue())
    assert decoded.getpixel((2, 2)) == (255, 255, 255), "transparent ground must be white"
    assert decoded.getpixel((32, 32)) == (0, 0, 0), "the subject must survive"


def test_exif_does_not_survive_decoding() -> None:
    """Uploads must not carry container metadata into anything downstream."""
    buffer = io.BytesIO()
    exif = Image.Exif()
    exif[271] = "SecretCameraMake"
    Image.new("RGB", (64, 64), "white").save(buffer, format="JPEG", exif=exif)

    decoded = security.decode_image(buffer.getvalue())
    assert decoded.mode == "RGB"
    assert not decoded.getexif()


# ── Access control ────────────────────────────────────────────────────


def test_api_key_is_enforced_when_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    keyed = dataclasses.replace(security.settings, api_key="s3cret")
    monkeypatch.setattr(security, "settings", keyed)

    assert post_convert(client, make_image()).status_code == 401
    assert post_convert(
        client, make_image(), headers={"X-API-Key": "wrong"}
    ).status_code == 401

    ok = post_convert(
        client,
        make_image(),
        {"target_points": 200},
        headers={"X-API-Key": "s3cret"},
    )
    assert ok.status_code == 200


def test_health_is_reachable_without_a_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    keyed = dataclasses.replace(security.settings, api_key="s3cret")
    monkeypatch.setattr(security, "settings", keyed)
    assert client.get("/api/health").status_code == 200


# ── Rate limiting ─────────────────────────────────────────────────────


def test_bucket_refills_over_time() -> None:
    limiter = security.RateLimiter(per_minute=60, burst=2)

    assert limiter.check("a")[0] is True
    assert limiter.check("a")[0] is True

    allowed, retry_after = limiter.check("a")
    assert allowed is False
    assert retry_after > 0

    # A different client has its own bucket.
    assert limiter.check("b")[0] is True


def test_bucket_table_does_not_grow_without_bound() -> None:
    """The limiter must not become the memory exhaustion it is preventing."""
    limiter = security.RateLimiter(per_minute=60, burst=1, max_entries=32)
    for i in range(500):
        limiter.check(f"10.0.0.{i}")
    assert len(limiter._buckets) <= 32


def test_rate_limit_returns_retry_after(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "limiter", security.RateLimiter(per_minute=1, burst=1))
    assert post_convert(client, make_image(), {"target_points": 200}).status_code == 200

    throttled = post_convert(client, make_image(), {"target_points": 200})
    assert throttled.status_code == 429
    assert int(throttled.headers["Retry-After"]) >= 1


# ── Response hardening ────────────────────────────────────────────────


def test_security_headers_are_present(client: TestClient) -> None:
    headers = client.get("/").headers
    assert headers["X-Content-Type-Options"] == "nosniff"

    csp = headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    # The demo is meant to be embeddable from the personal site, and from
    # nowhere else — the same single origin the CORS allowlist names.
    assert "frame-ancestors 'self' https://coronring.github.io" in csp


def test_page_and_assets_are_served(client: TestClient) -> None:
    assert "<canvas" in client.get("/").text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/styles.css").status_code == 200


# ── Filename sanitising ───────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("logo.png", "logo.png"),
        ("../../../etc/passwd", "passwd"),
        (r"C:\Windows\System32\x.png", "x.png"),
        # The closing tag contains a slash, so this is treated as a path and
        # only the last segment survives. Angle brackets and parens are dropped
        # either way; the point is that nothing markup-shaped comes back out.
        ("<script>alert(1)</script>.png", "script.png"),
        ("", "upload"),
        (None, "upload"),
    ],
)
def test_source_names_are_sanitised(raw: str | None, expected: str) -> None:
    assert security.safe_source_name(raw) == expected


def test_long_names_are_truncated() -> None:
    assert len(security.safe_source_name("a" * 500 + ".png")) <= 96


# ── Schema-level invariants ───────────────────────────────────────────


def test_defaults_are_valid_against_their_own_bounds() -> None:
    """A default outside its own range would make the reset button fail."""
    defaults = ConvertOptions().model_dump()
    assert ConvertOptions.model_validate(defaults) == ConvertOptions()


# ── Timeout backstop ──────────────────────────────────────────────────


def test_conversion_timeout_is_caught_and_reported(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    A conversion that overruns must surface as 504, not as an unhandled error.

    This is a regression test with history. The handler catches the builtin
    `TimeoutError`, which is only an alias of `asyncio.TimeoutError` from
    Python 3.11 onwards. When the runtime was briefly 3.10 the two were
    unrelated classes, so every overrun escaped the handler entirely and the
    caller got a 500 with a traceback in the log. Nothing failed loudly: the
    happy path was unaffected and the backstop simply stopped existing. Pin
    it here so a base-image change cannot quietly undo it again.
    """
    import time as _time

    from service import converter

    fast = dataclasses.replace(converter.settings, convert_timeout_s=0.05)
    monkeypatch.setattr(converter, "settings", fast)
    monkeypatch.setattr(
        converter, "convert_sync", lambda *args, **kwargs: _time.sleep(0.5) or {}
    )

    response = post_convert(client, make_image())
    assert response.status_code == 504
    assert "too long" in response.json()["detail"]
