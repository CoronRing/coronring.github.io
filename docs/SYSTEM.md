# System map

**Version 1.0.0** · 2026-08-18 · Owner: Guan Zheng Huang (`CoronRing`)

Read this first if you are changing anything that crosses a component
boundary. It covers what the other documents assume you already know: which
pieces exist, where they physically live, what contracts hold them together,
and which of them are outside version control.

Component-level detail lives elsewhere and is not repeated here:

| Document                                                 | Scope                                              |
| -------------------------------------------------------- | -------------------------------------------------- |
| [`.temp/DESIGN.md`](./.temp/DESIGN.md)                   | The Astro site: IA, visual system, particle engine |
| [`../backend/docs/design.md`](../backend/docs/design.md) | The Python service: API, security, cost, history   |
| [`../backend/README.md`](../backend/README.md)           | Running and configuring the service                |
| [`../infra/README.md`](../infra/README.md)               | Provisioning and deploying the host                |

---

## 1. The four pieces

```
SenseRing/                     the particle_wave source (NOT IN ANY REPO)
   |  uv build
   v
backend/vendor/*.whl           a pinned artifact, committed
   |  pip install
   v
backend/                       FastAPI service, Docker, on an Oracle host
   |  HTTPS  POST /api/convert
   v
src/                           Astro site on GitHub Pages
```

| Piece            | Path                                | Repository                                 |
| ---------------- | ----------------------------------- | ------------------------------------------ |
| Site             | `coronring.github.io/src`           | `CoronRing/coronring.github.io`            |
| Service          | `coronring.github.io/backend`       | same repo, not built by the Pages workflow |
| Operator tooling | `coronring.github.io/infra`         | same repo, run by hand only                |
| Engine source    | `nlp_application_toolbox/SenseRing` | **none** (see section 6)                   |

The website repository is nested inside the `nlp_application_toolbox`
repository, which does not track it. Do not `git add coronring.github.io` from
the outer repo, because that records a gitlink rather than the files. The
containing path has a space in it, so quote it in every shell command.

## 2. What depends on what

The engine exists in three forms, and they must stay in step.

| Form                | Where                                     | Who consumes it                           |
| ------------------- | ----------------------------------------- | ----------------------------------------- |
| Python source       | `SenseRing/src/particle_wave/`            | the CLI, and the wheel build              |
| Built wheel         | `backend/vendor/particle_wave_tool-*.whl` | the service, pinned in `requirements.txt` |
| JavaScript renderer | `src/vendor/particle-wave/`               | the hero and the demo island              |

Two things follow, and both have already caught someone out.

**The JavaScript in `src/vendor/` is a copy, not a link.** A change made in
SenseRing does not reach the site until it is copied across. Types are declared
beside the vendored JavaScript in `particle-wave.d.ts` rather than inside it,
so a re-sync does not discard them.

**The service serves its own copy of the renderer out of the installed wheel**
(`/engine/*`), not from `src/vendor/`. That is deliberate: the browser code and
the Python that produced the cloud are then provably the same release. The site
and the service can therefore sit on different engine versions, which is fine,
because they only ever exchange `.pwcloud` documents.

To move a SenseRing change into the service:

```bash
python backend/scripts/sync_wheel.py   # rebuild, vendor, re-pin requirements.txt
python infra/configure.py --deploy     # rebuild the image on the host
```

`sync_wheel.py` finds the checkout through `SENSERING_DIR` in `.env`, because
the two live in different repositories and there is no reliable relative path
between them.

## 3. The contracts

Everything the components exchange is one of these two shapes. Change either
one and both sides need changing together.

### 3.1 `.pwcloud` v1.0.0, flat encoding

```jsonc
{
  "version": "1.0.0",
  "encoding": "flat",
  "stride": 4,
  "fields": ["x", "y", "w", "g"], // normalised x/y, weight, group index
  "data": [/* stride-packed floats */],
}
```

Three producers emit this, and one consumer reads it:

| Producer                                  | Runs    | Quality                                        |
| ----------------------------------------- | ------- | ---------------------------------------------- |
| `particle_wave` sampler (via the service) | Python  | full: multi-scale edges, CLAHE, Poisson-disc   |
| `src/lib/image-to-cloud.ts`               | Browser | cut-down Sobel port, answers in under a second |
| `scripts/generate-cloud.mjs`              | Node    | parametric, no image involved                  |

`Loader.load` accepts a URL or an object and cannot tell the three apart. That
interchangeability is the point of the project, and it is what lets the demo
fall back to the browser tracer without the renderer noticing.

The format version is independent of the package version. `PWCLOUD_VERSION` is
`"1.0.0"`, while the `generator` string reads the installed package version
through `importlib.metadata`, so it cannot drift.

### 3.2 The HTTP API

| Route               | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `GET /api/health`   | version, available extractors, limits in force      |
| `GET /api/options`  | option schema the bundled page builds controls from |
| `POST /api/convert` | `image` + `options` returns `{cloud, meta}`         |
| `GET /status`       | human-readable status page                          |
| `GET /api/docs`     | OpenAPI browser                                     |

The site calls exactly one of these, `POST /api/convert`, through
`src/lib/particle-wave-api.ts`. Everything about that call is in that one file:
base URL, 20 s timeout, error shape, and the flat-encoding sanity check.

Two settings must agree for the demo to work at all, and they live on opposite
sides of the boundary:

- `PW_ALLOWED_ORIGINS` in `infra/compose.yml` must list
  `https://coronring.github.io`, or the browser discards the response.
- `frame-ancestors` in `backend/service/main.py` must allow the same origin.

## 4. Deploying, and how to tell it worked

Two independent paths. Neither can break the other.

**The site.** Push to `main`. `.github/workflows/deploy.yml` runs `astro check`,
builds, and publishes. A type error fails the deploy before anything ships.

**The service.** Run `python infra/configure.py --deploy` from a checkout. It
rebuilds the image on the host and restarts the stack. Nothing in CI does this,
so a service change is not live until someone runs that command.

Verify the pair end to end rather than separately. The failure that actually
happened was neither component being broken: the site was fine, the service was
fine, and the site had simply never been wired to call it. A useful check is to
load `https://coronring.github.io/projects/particle-wave/`, scroll the demo into
view (the island is `client:visible`, so it does not hydrate before that),
upload an image, and confirm the readout says `traced by the Python service`
rather than `traced in this tab`.

## 5. Configuration and secrets

| Thing                    | Lives at                      | Notes                                                   |
| ------------------------ | ----------------------------- | ------------------------------------------------------- |
| Operator config          | `coronring.github.io/.env`    | gitignored; needed only by `infra/` and `sync_wheel.py` |
| OCI API signing key      | `~/.oci/particle-wave.pem`    | outside the repo on purpose                             |
| SSH key for the host     | `~/.ssh/oracle_particle_wave` | outside the repo on purpose                             |
| Provisioning state       | `infra/state.json`            | gitignored                                              |
| Runtime service settings | `infra/compose.yml`           | committed; `PW_*` variables only                        |

The service reads nothing from `.env`. Its configuration is entirely `PW_*`
environment variables set on the host, which is why the same image runs
unchanged locally, on the Oracle host, or on Cloud Run.

`PUBLIC_PARTICLE_WAVE_API` is the one exception to "no defaults in source". Its
value is also hardcoded as the fallback in `src/lib/particle-wave-api.ts`,
because the GitHub Pages build has no `.env`, and an unset variable there would
silently disable the Python path on the only deployment that matters. The URL
is public information printed on the service's own status page, not a
credential.

## 6. The gap worth knowing about

**`SenseRing/` is in no repository.** It sits inside the
`nlp_application_toolbox` working tree, is not gitignored, and has never been
added: `git ls-files SenseRing` returns nothing across 41 source files. The
built wheel is committed here and is therefore versioned, but the source that
produced it is not. A disk failure loses the engine and keeps the artifact.

This matters immediately to anyone optimising or fixing the sampler, because
the change will exist only on that disk. Either commit SenseRing somewhere
before starting, or expect to re-derive the work.

## 7. Traps that have already cost time

**Never commit with a path glob.** Stage files by name and read the list back.
This working tree has held, at various times, `.env`, `.pem` files,
`state.json`, `known_hosts`, and two `.venv` directories. `.gitignore` covers
all of them belt and braces, but the habit is the actual defence.

**Opening a port on Oracle is two jobs.** The cloud security list and the
instance's own iptables `INPUT` chain both have to allow it. Open only the first
and the port reads as open from the API while being dead from a browser.

**HTTPS is not optional.** A page served from github.io cannot call an `http://`
backend, because browsers block it as mixed content. Certificates need a
hostname rather than a bare IP, so the host answers on
`<ip-with-dashes>.sslip.io` with Caddy handling renewal. Pointing a real domain
at it later changes only `SITE_ADDRESS`.

**Match the ruff target to the runtime.** `backend/pyproject.toml` targets
`py311` because the Dockerfile base is `python:3.11-slim`. When those disagreed,
ruff rewrote code into spellings the runtime could not parse, and the failure
surfaced at request time rather than at lint time.

**Look up HTTP headers case-insensitively.** A CORS check once reported a
failure that did not exist, because `dict(response.headers)` is case-sensitive
and the real header was spelled differently.

**Sampler output is a fixed point, not an implementation detail.** Under a
given `rng_seed` the sampler must produce byte-identical clouds across a
rewrite. Verify with SHA-256 over the packed arrays for a spread of images and
configurations, not a handful. A subtle one: candidates are tested at
fractional coordinates but stored truncated to whole pixels, so two accepted
points can share a fine grid cell, and the overwrite that follows hides one of
them from later exclusion tests. That occlusion changes which points are
admitted, so it is load-bearing and must be preserved.

**Quote the repository path.** It contains a space.

**Bash heredocs eat backslashes unless the delimiter is quoted.** Use `<<'PY'`,
not `<<PY`, or a `\n` inside a Python snippet arrives as a real newline and the
edit silently does nothing while reporting success.

## 8. Which document to update

| Change                                      | Update                                     |
| ------------------------------------------- | ------------------------------------------ |
| Site structure, visuals, engine integration | `docs/.temp/DESIGN.md`, bump the version   |
| Service API, limits, security, performance  | `backend/docs/design.md`, bump the version |
| Host resources or the deploy procedure      | `infra/README.md`                          |
| Anything crossing a component boundary      | this file, bump the version                |

If the code and a document disagree, the document is wrong. Fix it in the same
change.
