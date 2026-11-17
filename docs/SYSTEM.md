# System map

**Version 1.3.0** · 2026-11-17 · Owner: Guan Zheng Huang (`CoronRing`)

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
| [`../chat/README.md`](../chat/README.md)                 | The site-chat assistant                            |
| [`../news/README.md`](../news/README.md)                 | NewsRing subscriptions: the public mailing list    |

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


### Three services share the host

`backend/` was the first and the diagram above is still its shape, but two more
services now run beside it in the same compose stack, behind the same Caddy and
the same certificate. Caddy routes by prefix, stripping it before the service
sees the request:

| Prefix | Service | Source | State |
|---|---|---|---|
| `/chat/*` | site-chat assistant | `chat/` | none; the corpus is refetched from the published site |
| `/news/*` | NewsRing subscriptions | `news/` | **none on the host**; the subscriber list is in Postgres |
| `/*` | particle-wave converter | `backend/` | none |

No service here keeps anything the host would be missed for. That is deliberate and was learned the hard way: the free-tier instance underneath can be reclaimed by its provider without notice, disks and named volumes included, and in November 2026 it was.

The one thing that cannot be rebuilt from a repository is the NewsRing subscriber list, since a confirmed address exists nowhere else and you do not get to ask people to subscribe twice. It therefore lives in Postgres, in the site's own Supabase project, reached over PostgREST from the service. The table is `public.newsring_subscribers` and its migration is at `supabase/migrations/` in this repository. The project is the site's, not NewsRing's: one database for whatever the site comes to keep, with each table named for the project that owns it.

`news_data` remains as a local fallback for a run with no Supabase credentials, and `GET /news/api/health` reports under `store` which backend actually answered, so a deployment that quietly fell back to it is visible rather than discovered later.

### A fourth container that serves nobody

`keepalive`, from `infra/keepalive/`, is in the stack but not in the routing table: it answers no requests and is not reachable from outside. Its job is to stop the provider taking the machine.

Oracle reclaims Always Free compute it judges idle, and publishes the test: over a 7-day window, CPU 95th percentile under 20%, network under 20%, and memory under 20% on A1 shapes. The three conditions are joined by "and", so clearing any one is enough. The container clears CPU on every shape, by burning one core for 90 seconds in every 600 at nice 19 — the 95th percentile crosses 20% as soon as more than 5% of samples do, so the duty cycle is small — and clears memory on A1 by holding a ballast topped up to 30% of RAM. Network is left alone, because 20% of this instance's bandwidth sustained for a week has no honest source.

It gives way rather than competing: nice 19 for the CPU, `oom_score_adj: 1000` for the memory, and a ballast sized as the gap between the target and what everything else is already using, so it shrinks as the real services grow. `KEEPALIVE_ENABLED=0` switches it off on a host with real traffic, or on an account upgraded to Pay As You Go, where idle reclamation stops applying. `infra/README.md` has the numbers and what is still unsolved.

A service is mounted under a prefix it is not told about by the request, since
`handle_path` has already stripped it. That is harmless for the two that only
answer JSON, and not for `news/`, which has to put absolute links into email —
hence `NEWS_PUBLIC_BASE` in `infra/compose.yml`. If the host moves, that value
moves with it or every confirmation link in flight breaks.

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

The same reasoning gives the subscriptions service its own live check,
`news/live_check.py`: it runs the real app against the real table and the real
mailbox, because the two bugs that have actually shipped there — a database
filter that matched nothing and reported success, and a password that reached
the host with its `.env` comment attached — were both invisible to a suite that
replaces the database and the mailer. `--no-mail` keeps the database half and
sends nothing. It refuses to broadcast while anyone else is on the list.

Neither check tells you anything once nobody is looking, which is how the host was lost without being noticed. `.github/workflows/uptime.yml` probes all three prefixes from a GitHub runner every half hour and opens a `backend-down` issue when they stop answering, closing it again on recovery. It needs the repository variable `BACKEND_HOST` and skips itself when that is unset, so there is nothing to clean up between provisions. It checks that the reply is the service's own health JSON rather than merely a 200, because the reclaimed address was reassigned to another tenant who answered.

## 5. Configuration and secrets

| Thing                    | Lives at                      | Notes                                                   |
| ------------------------ | ----------------------------- | ------------------------------------------------------- |
| Operator config          | the toolbox `.env`, one level above this repository | gitignored; read by `infra/configure.py`, `backend/scripts/sync_wheel.py` and `news/live_check.py`. The repository's own `.env` is separate and holds the site's build-time `PUBLIC_*` values |
| OCI API signing key      | `~/.oci/particle-wave.pem`    | outside the repo on purpose                             |
| SSH key for the host     | `~/.ssh/oracle_particle_wave` | outside the repo on purpose                             |
| Provisioning state       | `infra/state.json`            | gitignored                                              |
| Runtime service settings | `infra/compose.yml`           | committed; non-secret variables for all three services  |
| Chat keys on the host    | `~/particle-wave/chat.env`    | written by `configure.py` from `.env`, mode 0600        |
| News secrets on the host | `~/particle-wave/news.env`    | written by `configure.py` from `.env`, mode 0600        |
| Subscriber list          | Supabase, `public.newsring_subscribers` | off the host on purpose; schema is in `supabase/migrations/` |

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
