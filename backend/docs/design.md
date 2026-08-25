# particle-wave service — design

**Version 1.4.0** · the page became a playground; clouds carry their source

A Python service that exposes the ParticleWave `particle_wave` pipeline over
HTTP, with a page that drives it end to end. It lives in the personal-website
repository as `backend/`, beside the operator tooling in `infra/` that
provisions and deploys it; the GitHub Pages workflow builds neither.

> **1.4.0** — the page was rebuilt as a playground (section 6): the rail is a
> dock of tabs rather than one long scroll, presets set both halves at once,
> and a wipe along the bottom of the stage compares the render against the
> image it was traced from. The engine's parameter schema is now read from
> `/engine` instead of a copy in `static/`, and `.pwcloud` grew an embedded
> source preview (format 1.1.0). The upstream project was renamed SenseRing ->
> ParticleWave and its distribution `particle-wave-tool` -> `particle-wave`.

> **1.3.0** — the Poisson-disc sampler was given a coarse acceleration grid,
> cutting conversion time 4-6x with bit-identical output (section 4.1). The
> demo now asks for 3,500 points rather than 2,500. `particle-wave-tool`
> 1.0.1.
>
> **1.2.0** — the project page on the personal site now posts uploads to this
> service instead of tracing them in the browser, falling back to the local
> tracer when the host is unreachable. Section 4.1 records why the demo asks
> for 2,500 points.
>
> **1.1.0** — the Hugging Face Space was deleted and every trace of it removed
> from the code: the Gradio entry point, the upload script, the Space README
> frontmatter, the `/gradio` CSP exemption, and the `huggingface.co` frame
> ancestor. `requirements.txt` had been pinning the wheel by URL *out of the
> Space* — a workaround for the Gradio builder — so deleting the Space would
> have broken the next rebuild; it now points at `./vendor/`. Section 10 is
> kept as the record of why that host was abandoned.

---

## 1. What this is for

SenseRing's image → point-cloud conversion is Python: OpenCV/SciPy edge
detection, a tone/edge importance map, and Bridson Poisson-disk sampling.
None of that is going to run in a browser at fidelity. The browser half is the
physics engine that renders the result.

Until now the two halves were only ever exercised separately — the CLI wrote a
file, and someone later loaded that file into a page. This service closes the
loop: one page, one upload, both halves running against each other, with every
parameter of the Python side exposed live.

It is also the shape a production integration would take, so it doubles as a
reference for one.

## 2. Structure

```
service/
  main.py        routes, middleware, static mounts
  settings.py    environment -> frozen Settings
  schemas.py     ConvertOptions: the request contract and every bound
  security.py    upload decoding, rate limiting, access control
  converter.py   bridge to the particle_wave package
  metrics.py     in-process counters behind /api/status
static/          the page (no build step, no framework)
vendor/          the locally built particle-wave wheel
scripts/         sync_wheel.py
tests/           pytest, weighted towards hostile input
```

One directory up, `../infra/` holds provisioning and deployment: the OCI
scripts, the compose stack, the Caddyfile, and the host bootstrap.

No frontend build step. The page is three files served as-is; adding a bundler
would mean a second toolchain in the image for a page that has no dependencies
to bundle — every control on it is generated from a schema at runtime.

## 3. How the package is consumed

`particle_wave` is treated as an ordinary third-party dependency: installed
from a wheel, imported by name, never reached into by path. `scripts/sync_wheel.py`
builds it from the SenseRing checkout, drops it in `vendor/`, and re-pins
`requirements.txt`.

Publishing to PyPI later changes one line in `requirements.txt` and deletes
`vendor/`. Nothing in `app/` changes, because nothing in `app/` knows where the
package came from.

### 3.1 The frontend engine ships inside the wheel

`/engine/*` is served from `importlib.resources.files("particle_wave") / "FE"` —
that is, out of site-packages, not out of this repo.

The alternative was to vendor the JavaScript here too. That would let the
renderer and the exporter drift to different versions with nothing to catch it,
and the `.pwcloud` format is the contract between them. Serving both from one
installed artefact makes a mismatch impossible rather than merely unlikely.

`converter.engine_dir()` raises at startup if the package is not on disk as a
real directory, so a broken install is a container that will not boot rather
than a page that 404s its own JavaScript.

### 3.2 Changes made to SenseRing

Two, both needed before the package could be used from a server at all:

**`pyproject.toml` moved to the repository root.** It was in
`src/particle_wave/tool/`, where none of the paths it declares resolve —
`packages = ["src/particle_wave"]`, `testpaths`, and `readme` are all written
relative to the root. `uv build` failed outright on the readme. The file was
written for the root and was simply in the wrong directory. Also excluded a
628 kB Canny debug PNG from the wheel, which had no business being distributed.

**`Pipeline.build()` added.** `Pipeline.run()` only wrote to disk, so a server
would have had to spill every upload to the filesystem and read it back.
`build()` returns the document in memory; `run()` is now `build()` plus
`PwcloudExporter.write()`, which is also new — factored out so there is exactly
one place that decides how the JSON is formatted. Verified byte-identical to
the old path under a fixed seed, and the 23 existing SenseRing tests still pass.

## 4. Cost, and what it implies for the limits

Measured on the development machine, 512×512 subject on a 1024px raster:

| target_points | min_radius | resulting points | seconds |
| ---: | ---: | ---: | ---: |
| 1,000 | 2.0 | 1,000 | 0.31 |
| 4,000 | 2.0 | 2,236 | 2.66 |
| 8,000 | 2.0 | 2,226 | 2.72 |
| 16,000 | 2.0 | 2,243 | 2.79 |
| 16,000 | 0.5 | 16,000 | 5.22 |
| 15,000 | 0.8 | 15,000 | 1.60 *(noise image)* |

Two conclusions, both load-bearing:

**`target_points` is not the cost driver, and it is not even the point driver.**
Above ~2,200 at `min_radius` 2.0 the Poisson radius binds and raising the target
changes nothing at all. This is a genuine usability trap — a user drags "target
points" from 4,000 to 16,000 and sees no difference. The API therefore returns
`meta.truncated_to_cap`, the page explains it next to the control, and the help
text says to lower the radius instead.

**`min_radius` is the real lever, so it is the real DoS lever.** It is floored
at 0.8. With `target_points` capped at 15,000 the worst observed conversion is
~5 s, against a 60 s timeout — the timeout is a backstop that should never
fire. If it starts firing, the caps are wrong, not the timeout.

Counter-intuitively a noise image is *faster*: dense seeds everywhere let
Bridson converge quickly, where a sparse-edge image churns the active list.
The worst case is a mid-density photograph, not an adversarial one.

### 4.1 The sampler was the pipeline

Section 4 measured *how many points come out* and found that `min_radius` binds
the count while `target_points` saturates. Measuring *time* on the deployed ARM
host found something else: the cost was almost entirely one function, and it was
not the one the option documentation pointed at.

Profiling a 700px conversion inside the container:

```
preprocess     6 ms
extract        7 ms
map           46 ms
sample     7,418 ms      <- Poisson-disc sampling
```

OpenCV was present and threaded (4.14.0, 4 threads), so this was not the slow
Pillow/scipy fallback — the extractor genuinely costs ~60 ms.

**The cause.** Bridson sizes the acceleration grid at `r/sqrt(2)` so each cell
holds at most one sample, which is correct when `r` is constant. Here the radius
varies per pixel across `[min_radius, max_radius]`, and the exclusion test reads
the radius *at the candidate* — which in a low-detail region is `max_radius`,
six times `min_radius` at the defaults. A grid sized for `min_radius` therefore
forced a window of roughly 290 cells, nearly all empty, walked one at a time in
Python. The exclusion radius was also re-read from `radius_map` inside that
innermost loop, though it does not vary across it.

**The fix.** Size the cells by `max_radius` and let each hold a list. The window
is then 3x3 for any candidate, so the work is proportional to the points that
could plausibly conflict rather than to the area searched.

| `target_points` | before | after | |
| --- | --- | --- | --- |
| 1,500 | 0.6 s | 0.6 s | already dominated by the other stages |
| 2,500 | 2.2 s | 0.5 s | 4.3x |
| 3,500 | 5.8 s | 1.2 s | 4.9x |
| 6,000 | 11.4 s | 1.9 s | 6.0x |

**Output is unchanged.** Verified bit-identical across 20 configurations — five
image characters (line art, dense grid, text, blobs, noise) at four size and
radius combinations — by running the previous implementation and the new one
side by side under the same seed and comparing SHA-256 over the packed arrays.

That check earned its keep. The first attempt dropped the fine grid entirely, on
the reasoning that two accepted points can never be closer than `min_radius` and
so can never share a cell. Three of the twenty cases diverged. The reasoning had
missed that a candidate is *tested* at fractional coordinates but *stored*
truncated to whole pixels, so an accepted sample can land marginally closer to
its neighbour than the radius that admitted it — close enough to share a fine
cell, at which point the later sample overwrote the earlier one and the earlier
one stopped being visible to the exclusion test while remaining in the output.
That occlusion is load-bearing: it changes which points are admitted from then
on. The fine grid is kept purely to reproduce it.

Whether that occlusion is *desirable* is a separate question — it is an accident
of truncation, not a design decision, and removing it would very slightly
improve spacing. It is left alone here because this change was meant to be free.

Sampling is still the dominant stage, and the remaining cost is Python-level
per-candidate overhead. Vectorising the neighbour test with numpy was tried
first and gave only 1.6x — at these window sizes the per-call overhead of
entering numpy exceeds the arithmetic it saves. Beyond this, the next real step
would be moving the loop out of Python entirely.

## 5. Security

Proportionate to what this is: a public demo that costs CPU per request. Not an
authentication system, not a WAF, and not a defence against a distributed
attacker. Stated plainly so nobody assumes more of it than it does.

### 5.1 Decoding untrusted images — the real attack surface

- The declared `Content-Type` is **ignored**. Format is whatever the decoder
  recognises in the bytes; a header is a claim, not a fact.
- Format allowlist: PNG, JPEG, WebP, BMP, GIF. **TIFF is excluded** — multi-page
  containers and a broad historical CVE surface, for no benefit here.
- Dimensions are checked **from the header, before pixels are decoded**, so a
  bomb costs a few bytes of parsing rather than a full raster allocation.
  `Image.MAX_IMAGE_PIXELS` is set explicitly as a second line.
- Only frame 0 of an animated container is read.
- The decoded frame is **rebuilt from its raw buffer**, which is what actually
  drops EXIF, ICC, and GPS. `convert("RGB")` alone does *not* — Pillow copies
  the `info` dict across it. A test caught this after the docstring already
  claimed otherwise.
- Alpha is composited **over white**, not dropped. `convert("RGB")` leaves
  transparent pixels black, so a logo on a transparent ground would have
  arrived as a black rectangle and the detector would have traced its border.
- Conversion is entirely in memory. No upload ever touches the filesystem, so
  path traversal is not mitigated here — it is absent.

### 5.2 Bounding cost

- Every option has a hard range (§4), enforced by pydantic with
  `extra="forbid"` so a typo is an error rather than a silent no-op.
- Request bodies are counted while reading, not trusted from `Content-Length`.
- A process-wide semaphore caps simultaneous conversions; a wall-clock timeout
  backstops each one.
- Per-client token bucket, evicted LRU so the limiter cannot itself become the
  memory exhaustion it exists to prevent.

**Honest limitation:** a timed-out conversion abandons the *result*, but the
worker thread runs to completion — Python threads cannot be cancelled. Killing
work properly would need a process pool. Given the measured worst case of ~5 s
against a 60 s timeout, that complexity is not yet earned.

**Second honest limitation:** rate limiting keys on `X-Forwarded-For`, which is
forgeable without a trusted proxy in front (`PW_TRUST_FORWARDED_FOR=0` disables
it). Rate limiting is a courtesy control. The controls that actually hold are
the option caps and the semaphore.

### 5.3 Access control

`PW_API_KEY`, compared with `hmac.compare_digest`. **Unset by default**, which
means the convert endpoint is open. That is the right default for a public demo
and the wrong one for anything else; the startup log warns, and the README says
so twice.

### 5.4 Response hardening

CSP with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`. No
inline script anywhere, so `script-src 'self'` needs no escape hatch.

`X-Frame-Options: DENY` is deliberately **absent**: a Space renders inside an
iframe on huggingface.co, and denying framing outright would leave visitors
looking at a blank box. `frame-ancestors` expresses the same intent while
permitting the one embedder that has to work.

CORS is same-origin unless origins are named. A wildcard would hand a
CPU-bound endpoint to any page on the internet.

The container drops to UID 1000 before anything listens.

## 6. The page

Two halves, tagged **Python** and **Browser**, because which half does what is
the thing the demo is meant to show. Extraction options cost a request; render
options apply on the next frame. The split is the rail's top-level control, so
it is structural rather than a label on a panel.

### 6.1 Every control is generated

Extraction controls come from `GET /api/options`, which serves the pydantic
model's JSON Schema plus `x-group` / `x-label` / `x-step` / `x-help` metadata.
A control therefore cannot advertise a range the server will reject, because
both come from one declaration. Adding an option to `schemas.py` makes a
control appear with no page change.

Engine controls come from `engine_fields.json`, fetched from **`/engine`** —
the installed wheel — rather than from a copy in `static/`. The copy that used
to live there went stale the moment the engine gained a parameter, and a
control list that disagrees with the engine is worse than no control list.
Defaults still come from `ParticleWave.DEFAULTS`, so the schema names fields
without restating values.

Both schemas carry **two description tiers**, and the page shows both:
`x-short` / `short` is a few words rendered under the control, and `x-help` /
`help` is the sentence-length version the hint strip shows on hover. One tier
alone fails either way — a label does not say what a parameter does, and a
paragraph under each of eight controls is what turned this rail into a scroll
in the first place.

### 6.2 A dock, not a scroll

Each half is cut into tabs of roughly eight controls, sized so that no tab
scrolls at a normal window height: the whole point is to reach any parameter
without losing sight of the render. Two rules keep it that way.

- Per-control help lives in **one hint strip** at the foot of the rail, fed by
  whatever is under the pointer. Help text under every slider is what made the
  rail a scroll in the first place.
- A control that cannot do anything in the current mode is **hidden**, not
  disabled — the palette picker in gradient mode, the trail sliders with trails
  off. A parameter that does nothing invites the reader to turn it and conclude
  the engine is broken.

Where a schema group is too big for one tab (`interaction` carries fifteen
fields, `importance` nine) the split is written out as key lists in `app.js`.

### 6.3 Presets set both halves

Tracing a photograph and tracing a line drawing want different importance maps
as much as they want different particles, so a preset that set only the render
half would be half an answer. Applying one rewrites the extraction options *and*
the engine config, and marks the cloud stale so the Python half can be re-run.

### 6.4 The wipe

The stage can wipe between the render and the image behind it, dragged from a
grip along the bottom. It is **off by default** — it covers half the render,
which the visitor should have to ask for.

The overlay is laid out on `instance.drawArea` rather than on the canvas: the
engine letterboxes the cloud, and an image stretched to the canvas would
compare two differently-scaled pictures, which is worse than no comparison.

The image is the file in the dropzone when there is one, and otherwise the copy
the cloud carries with it (`.pwcloud` 1.1.0 `preview`). That second path is why
the format grew the field: a downloaded cloud stops being self-describing the
moment it is separated from the image it came from.

### 6.5 Ambient motion starts at rest

`restSpin` and `driftAmplitude` used to be started non-zero on the grounds that
a still cloud looks broken. They now start at the engine's own default of 0: a
cloud that is already turning makes every other parameter harder to judge, and
this page exists to judge parameters. The presets are where a moving cloud is
offered, deliberately.

## 7. Verification

**The container is built and verified**, not just the app: image builds, runs
as UID 1000, resolves the engine from site-packages, imports cv2 4.14 (the
`libgomp1` install pays off), serves `/status`, honours `PW_MAX_CONCURRENCY`,
converts a real image, and starts on both the default 7860 and an injected
`PORT=8080`. The full browser suite passes against the container, not only
against a local uvicorn.

**44 pytest cases**, weighted towards hostile input: bombs, format lies, empty
and oversized bodies, every out-of-range option, path-shaped filenames, EXIF,
transparency, API-key enforcement, and limiter eviction. Bugs it caught:

- EXIF surviving `convert("RGB")` (§5.1)
- transparent PNGs flattening to black (§5.1)

**17 browser assertions** in real Chrome: schema-generated controls render, the
engine loads from the wheel, an upload round-trips to painted pixels, a live
slider changes the render without a re-convert, a bad upload surfaces a readable
error, and there are no CSP violations. Bugs it caught:

- Both overlays stayed painted on top of a finished render. The `hidden`
  attribute is only a UA-stylesheet `display: none`, and the author rule
  `display: grid` outranked it. Fixed globally with `[hidden] { display: none !important }`
  rather than per-rule. **Only visible in a screenshot** — every functional
  assertion passed while the page looked broken.

## 8. Decisions

| Decision | Why | Alternative rejected |
| --- | --- | --- |
| Docker SDK, not Gradio | Needs a custom canvas page running our own engine | Gradio cannot host it |
| Engine served from the wheel | Renderer and exporter cannot drift | Vendoring the JS separately |
| `Pipeline.build()` upstream | A server must not spill uploads to disk | Temp files per request |
| UI generated from JSON Schema | One declaration for bounds, defaults, help | Hand-written controls |
| Private Space by default | Open CPU endpoint is opt-in, not default | Public by default (see §10) |
| Single uvicorn worker | Limiter and semaphore are per-process | Multiple workers |
| `target_points` kept, with a warning | It is a real cap, just not the density lever | Hiding it |
| Threads, not a process pool | Timeout is a backstop at ~5 s worst case | Cancellable processes |

## 9. Known gaps

- **The timeout cannot actually cancel work** (§5.2).
- **`ml` extractor is unavailable.** `onnxruntime` is not installed, so
  `/api/health` advertises only `classic`. Adding it means a model download on
  first use, which does not belong in a request path.
- **No persistence.** Every conversion is recomputed; identical repeat requests
  do the same work. A content-addressed cache keyed on image hash plus options
  would be the obvious next step.
- **Not deployed.** See §10 — no free host is currently configured.
- **Docker Hub anonymous pulls fail on this machine** (stale credentials in the
  Desktop credential store return 401). Worked around with
  `--build-arg BASE_IMAGE=mirror.gcr.io/library/python:3.11-slim` rather than
  by touching the developer's saved logins. Hugging Face and Render build from
  Docker Hub normally.

## 10. Why not Hugging Face (historical)

`create_repo` fails with `402 Payment Required` on a free account. My first
reading was that this was the well-known "private Spaces need PRO" rule, so
the fix looked like `--public`. **That was wrong** — public is refused too.
As of 2026 Hugging Face charges for the Docker SDK itself, regardless of
visibility; only Static and ZeroGPU-Gradio Spaces remain free, and neither can
run a Python backend.

The error text is accurate and I misread it: *"Static Spaces are free for
everyone, but hosting Gradio and Docker Spaces on free cpu-basic requires a
PRO subscription."* Worth recording, because the same 402 also fires for the
visibility rule and the two are easy to conflate.

Consequences:

- The Space has since been deleted, along with the Gradio entry point and the
  upload script that existed only to feed it.
- The image is host-agnostic and stayed that way: the CMD reads `$PORT`, so it
  runs unchanged on Cloud Run, Fly, Render, or locally.

### 10.1 The free Gradio/ZeroGPU route was tried, and does not work

Probing the create API found exactly one free combination that runs Python:

| SDK | Hardware | Result |
| --- | --- | --- |
| static | cpu-basic | created — but cannot run Python |
| gradio | cpu-basic | 402 |
| **gradio** | **zero-a10g** | **created** |
| streamlit | cpu-basic | refused |

So the service was rebuilt for it: `app/` renamed to `service/` to free the
name, `app.py` added as the Gradio entry point, Gradio mounted at `/gradio`
beside the FastAPI app, and the wheel referenced by HTTPS URL. Four deploys
later it still fails, and each failure taught something worth keeping:

1. **The Gradio builder mounts only `requirements.txt`.** A relative
   `./vendor/*.whl` path cannot resolve because nothing else in the repo exists
   during the pip step. Fixed by referencing the wheel over HTTPS.
2. **The builder image is Python 3.10.13.** Two ruff autofixes applied under a
   `py311` target were latent bugs: `datetime.UTC` does not exist in 3.10, and
   a bare `except TimeoutError` there does *not* catch `asyncio.TimeoutError`,
   so every conversion timeout would have gone unhandled. `target-version` is
   now `py310`, which is what the runtime actually is.
3. **Gradio 6 defaults to SSR**, which spawns a Node process that claims 7860
   at import time — before our server starts. `ssr_mode=False` fixed the
   "address already in use" crash.
4. **ZeroGPU terminates the container anyway.** With the port free, uvicorn
   binds, the lifespan completes, `/` and `/status` are live — and the platform
   sends SIGTERM within seconds. Importing the `spaces` SDK does not help. The
   runtime expects a Gradio app launched through `demo.launch()`, which
   registers with the platform; a FastAPI app serving its own page never does.

Making it fit would mean letting Gradio own `/` and moving the demo page,
`/status`, and the API under a subpath — a worse product, on a GPU tier being
used for CPU work. **That is where this stops.** The Space remains, unbuilt
and public, because the moment the account has PRO `--sdk docker` deploys the
verified image with no further changes.

### 10.2 Cloudflare cannot substitute

The account has a valid API token but **no zone**, and no `workers.dev`
subdomain claimed. Even with both, Cloudflare could not host this:

- Workers cap CPU at ~10 ms per request on the free plan; a conversion needs
  1–5 **seconds**. Not a tuning problem, a three-orders-of-magnitude one.
- Python Workers run under Pyodide, which will not carry this SciPy/OpenCV
  stack.
- Containers need a paid Workers plan.
- Without a zone there is no WAF, no DNS, and no named tunnel, so there is not
  even a stable hostname to put in front of another origin.

Cloudflare becomes useful the moment a domain is added to the account: a Worker
in front of whichever host wins would add edge filtering, body-size rejection
before the origin is touched, and a stable `PERSONAL_WEBSITE_BE` that survives
changing hosts. Until then it adds nothing, so nothing was deployed to it.

### 10.3 Where it actually runs: Oracle always-free

Live at **https://129-146-37-132.sslip.io** on an Oracle `VM.Standard.A1.Flex`
(4 ARM cores, 24 GB, free indefinitely) in `us-phoenix-1`. Provisioning and
deployment live in `../infra/`. They are operator tooling, run by hand from a
checkout — the Pages workflow builds only the Astro site.

The ARM shape is famously scarce on the free tier; it was granted on the first
availability domain tried, so the retry machinery was never needed. All Python
dependencies — numpy, scipy, opencv-python-headless, Pillow — had aarch64
wheels, so nothing compiled from source.

Three things this deployment required that the Docker path did not:

- **Opening a port on OCI is two jobs.** Oracle's Ubuntu images ship an
  iptables `INPUT` chain that REJECTs everything but SSH, *in addition to* the
  cloud security list. Open the port in the console alone and it reads as open
  from the API while being dead from a browser.
- **HTTPS is mandatory, so the host needs a name.** The site is HTTPS on
  github.io and browsers block an HTTPS page calling an `http://` backend as
  mixed content. Certificates need a hostname, so the stack uses
  `<ip-with-dashes>.sslip.io` and Caddy issues against it. A real domain later
  changes one variable.
- **The health check must go through the proxy.** The app container only
  `expose`s 7860 to the compose network, so probing `127.0.0.1:7860` on the
  host can never succeed. The first verification run reported a perfectly
  healthy deployment as broken for exactly this reason.

Verified live: 17/17 browser assertions against the public URL, valid
certificate, and CORS granting `https://coronring.github.io` while refusing
unknown origins. Within minutes of going up, internet scanners were probing
`/.git/config` and `/config.json` — which is the ordinary background noise of a
public IP, and the reason the upload and option hardening exists.

## 11. Status endpoint

`/status` renders `/api/status`; both come from one payload, so `curl` and the
page cannot disagree. `/api/health` stays small and stable for uptime polling.

Counters live in `app/metrics.py` — plain ints under the GIL, no persistence.
A free container restarts whenever it wakes from sleep, so durable metrics
would need a store this project does not have. They are counted at the request
boundary in `main.py` rather than at each raise site, so a new rejection path
cannot forget to tally itself.

`status` reports `degraded`, not `ok`, when the engine assets fail to resolve:
the API would still convert, but the page it serves would be broken, and
calling that healthy would be a lie.

The page pauses polling while the tab is hidden — a background tab would
otherwise keep waking a sleeping Space forever for nobody's benefit.
