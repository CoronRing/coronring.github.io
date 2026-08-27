# coronring.github.io

Personal site of Guan Zheng Huang. Systems, agents, and the tooling around them.

Live at **<https://coronring.github.io>**.

## Stack

Astro 5 (static) · React 19 islands · TypeScript (strict) · Tailwind CSS v4 ·
MDX content collections · GitHub Pages via Actions.

Zero JavaScript ships by default. Only components that need interactivity
hydrate, and most wait until they scroll into view.

The hero runs an interactive particle corona on `<canvas>`, powered by the
[SenseRing](../SenseRing) `particle_wave` engine (vendored in `src/vendor/`).
Dual theme throughout. Dark is the instrument panel, light the printed spec
sheet, and each opens through a loading veil in the _opposite_ tone.

## Three deployables, one repository

The site is static, but the Particle Wave demo talks to a Python service. They
ship separately and neither can break the other's deploy.

| Directory  | What it is                                   | How it ships                           |
| ---------- | -------------------------------------------- | -------------------------------------- |
| `src/`     | The Astro site                               | Push to `main`; GitHub Actions → Pages |
| `backend/` | FastAPI service wrapping `particle_wave`     | `python infra/configure.py --deploy`   |
| `infra/`   | Oracle Cloud provisioning and deploy tooling | Run by hand from a checkout            |

`infra/package_zip.py` packages the two services as upload-ready Docker build
contexts, for trying a different host without touching the live one. See
[`infra/README.md`](./infra/README.md).

The Pages workflow builds `src/` only. It never touches `backend/` or `infra/`,
so a broken service cannot block a content change.

Read [`docs/SYSTEM.md`](./docs/SYSTEM.md) before changing anything that crosses
the boundary between them.

## Getting started

```bash
npm install
npm run dev        # http://localhost:4321
```

| Script               | Does                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `npm run dev`        | Dev server with HMR                                               |
| `npm run build`      | `astro check` then `astro build`, so a type error fails the build |
| `npm run build:fast` | Skip the type check                                               |
| `npm run preview`    | Serve `./dist` locally                                            |
| `npm run format`     | Prettier across the repo                                          |

## Layout

```
docs/            Design docs (start with docs/SYSTEM.md)
public/          Static assets served from the root
src/
├── components/  ui/ · layout/ · decor/ · demos/ · tools/
├── content/     Schema-validated projects, resources, experience
├── data/        site.ts · tools.ts · models.ts
├── layouts/     BaseLayout · PageLayout · ToolLayout
├── lib/         url · theme · tokens · format · image-to-cloud · particle-wave-api
├── pages/       Routes
├── styles/      tokens.css · global.css
└── vendor/      particle-wave (from SenseRing) + local .d.ts
scripts/         generate-cloud.mjs → public/clouds/corona.pwcloud
backend/         FastAPI service (own README, own tests, own design doc)
infra/           Oracle provisioning and deploy scripts (own README)
```

## Adding things

**A project.** Drop an MDX file in `src/content/projects/`. Frontmatter is
Zod-validated in `src/content.config.ts`, so a bad field fails the build.

**An interactive demo.** Build the island in `src/components/demos/`, register
it in `registry.ts`, then set `interactive: true` and `demo: "<key>"` in the
project's frontmatter.

**A tool.** Build the island in `src/components/tools/`, add a route under
`src/pages/tools/` using `ToolLayout`, and add one entry to `src/data/tools.ts`.

**A resume entry.** A Markdown file in `src/content/experience/` with `kind`
set to `work`, `education`, `award`, or `certification`. Omit `end` for a
current role.

**A particle shape.** Edit `scripts/generate-cloud.mjs` and re-run it. The seed
is fixed so rebuilds are byte-identical; change it only to reshape the art.

## Design system

All colour, spacing, and motion live as CSS custom properties in
`src/styles/tokens.css` and are bridged into Tailwind utilities via the
`@theme` block in `global.css`. Components never hardcode a hex value, so
retheming is one file.

Three theme states, system (default), light, and dark, all applied before first
paint so there is no flash.

## Deployment

Push to `main`. The workflow in `.github/workflows/deploy.yml` type-checks,
builds, and publishes to GitHub Pages. Set **Settings → Pages → Source** to
**GitHub Actions** once, on first setup.

The Python service deploys on its own schedule; see
[`infra/README.md`](./infra/README.md).
