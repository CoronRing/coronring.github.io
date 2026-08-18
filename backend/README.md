# particle-wave service

A Python backend for the SenseRing particle-wave toolchain, plus a page that
exercises it. Upload an image, tune the extraction parameters, and the server
returns a `.pwcloud` point cloud that the browser renders with the physics
engine shipped inside the same package.

The split is the point of the demo:

| Half | Runs | Cost of a change |
| --- | --- | --- |
| **Extraction** — preprocessing, edges, importance, Poisson sampling | Python, server-side | one request |
| **Render** — spring physics, drift, spin, cursor forces | JavaScript, in the tab | immediate |

## How the package is consumed

`particle_wave` is used here as an ordinary third-party dependency: installed
from a wheel, imported by name, never reached into by path. The wheel is built
from the SenseRing checkout and vendored under `vendor/` — the manual hand-off
that stands in for PyPI until the package is published.

The frontend engine is served **out of the installed wheel** (`/engine/*`),
not vendored separately into this repo. That is deliberate: the JavaScript in
the browser and the Python that produced the cloud are then guaranteed to be
the same release, and cannot drift apart unnoticed.

To pick up SenseRing changes:

```bash
python scripts/sync_wheel.py     # rebuild, vendor, and re-pin requirements.txt
```

When the package reaches PyPI, replace the vendored line in `requirements.txt`
with `particle-wave-tool==<version>` and delete `vendor/`. Nothing else in the
service changes.

## API

| Route | Purpose |
| --- | --- |
| `GET /` | the demo page |
| `GET /api/health` | version, available extractors, and the limits in force |
| `GET /api/options` | option schema the page builds its controls from |
| `POST /api/convert` | `image` + `options` → `{cloud, meta}` |
| `GET /api/docs` | OpenAPI browser |

```bash
curl -X POST https://129-146-37-132.sslip.io/api/convert \
  -F image=@logo.png \
  -F 'options={"target_points":6000,"min_radius":1.2,"feature_mode":"hybrid"}' \
  -o logo.pwcloud.json
```

`cloud` is byte-identical to what the CLI writes, so it can be saved as a
`.pwcloud` file or handed straight to `ParticleWave.init({ src })`.

### A note on point counts

`target_points` is a ceiling, not a promise. The Poisson-disk radius decides
how many points physically fit: at the default `min_radius` of 2.0 on a 1024px
raster the sampler saturates around 2,200 points, and raising `target_points`
above that changes nothing. **Lower `min_radius` to get a denser cloud.** The
response sets `meta.truncated_to_cap` when the cap was the binding constraint,
and the page says so.

## Configuration

All optional; every one is an environment variable, so the same image runs
locally and on the host unchanged. The deployed values are set in
[`../infra/compose.yml`](../infra/compose.yml).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PW_API_KEY` | *(unset)* | When set, `/api/convert` requires a matching `X-API-Key`. |
| `PW_ALLOWED_ORIGINS` | *(none)* | Comma-separated CORS allowlist. Empty means same-origin only. |
| `PW_MAX_UPLOAD_BYTES` | `8388608` | Hard cap on the request body. |
| `PW_MAX_IMAGE_PIXELS` | `40000000` | Decompression-bomb ceiling. |
| `PW_MAX_IMAGE_DIMENSION` | `12000` | Per-side pixel limit. |
| `PW_MAX_CONCURRENCY` | `2` | Simultaneous conversions. |
| `PW_CONVERT_TIMEOUT_S` | `60` | Wall-clock backstop per conversion. |
| `PW_RATE_LIMIT_PER_MIN` | `20` | Sustained conversions per client. |
| `PW_RATE_LIMIT_BURST` | `6` | Bucket depth. |
| `PW_TRUST_FORWARDED_FOR` | `1` | Set `0` when running with no proxy in front. |

**The convert endpoint is open by default**, and is deployed that way. That is
the right default for a public demo and the wrong one for anything else. Note
that the bundled page sends no key, so setting one turns the demo page into a
viewer for the API rather than a working demo — open demo or closed API, not
both. See `docs/design.md` §5 for what the security layer does and does not
defend against.

## Local development

```bash
uv venv -p 3.11 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe -m uvicorn service.main:app --reload --port 7860
```

Then open <http://localhost:7860>.

Run the test suite with:

```bash
.venv/Scripts/python.exe -m pytest -q
```

## Deploying

The service runs on an Oracle Cloud always-free host, behind Caddy for TLS.
Provisioning and deployment live in [`../infra`](../infra):

```bash
python infra/configure.py --deploy   # rebuild and restart on the host
python infra/configure.py --logs     # tail the running stack
```

Live at <https://129-146-37-132.sslip.io>.

The image honours `$PORT` and holds no host-specific assumptions, so the same
build runs unchanged on Cloud Run, Fly, Render, or `docker run -p 7860:7860`
locally.

### Why not Hugging Face

The first target was a Hugging Face Space, and the trail is worth keeping.
As of 2026 Hugging Face charges for Docker Spaces: `create_repo` answers
`402 Payment Required` on a free account **regardless of visibility** — public
and private are both refused. The one free combination that runs arbitrary
Python is Gradio on ZeroGPU, and that harness terminates any process that
isn't a Gradio app launched through `demo.launch()`; mounting FastAPI beside
Gradio bound the port, completed startup, and was then SIGTERMed within
seconds. `docs/design.md` §10 has the full account.
