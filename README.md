# coronring.github.io

Personal site of Guan Zheng Huang — systems, agents, and the tooling around them.

Live at **<https://coronring.github.io>**.

## Stack

Astro 5 (static) · React 19 islands · TypeScript (strict) · Tailwind CSS v4 ·
MDX content collections · GitHub Pages via Actions.

Zero JavaScript ships by default. Only components that need interactivity
hydrate, and most of them wait until they scroll into view.

## Getting started

```bash
npm install
npm run dev        # http://localhost:4321
```

| Script               | Does                                                            |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Dev server with HMR                                             |
| `npm run build`      | `astro check` then `astro build` — a type error fails the build |
| `npm run build:fast` | Skip the type check                                             |
| `npm run preview`    | Serve `./dist` locally                                          |
| `npm run format`     | Prettier across the repo                                        |

## Layout

```
docs/            Design docs (start with docs/.temp/DESIGN.md)
public/          Static assets served from the root
src/
├── components/  ui/ · layout/ · decor/ · demos/ · tools/
├── content/     Schema-validated projects, resources, experience
├── data/        site.ts · tools.ts · models.ts
├── layouts/     BaseLayout · PageLayout · ToolLayout
├── lib/         url · theme · tokens · format
├── pages/       Routes
└── styles/      tokens.css · global.css
```

## Adding things

**A project** — drop an MDX file in `src/content/projects/`. Frontmatter is
Zod-validated in `src/content.config.ts`; a bad field fails the build.

**An interactive demo** — build the island in `src/components/demos/`, register
it in `registry.ts`, then set `interactive: true` and `demo: "<key>"` in the
project's frontmatter.

**A tool** — build the island in `src/components/tools/`, add a route under
`src/pages/tools/` using `ToolLayout`, and add one entry to `src/data/tools.ts`.

**A resume entry** — a Markdown file in `src/content/experience/` with `kind`
set to `work`, `education`, `award`, or `certification`. Omit `end` for a
current role.

## Design system

All colour, spacing, and motion live as CSS custom properties in
`src/styles/tokens.css` and are bridged into Tailwind utilities via the
`@theme` block in `global.css`. Components never hardcode a hex value, so
retheming is one file.

Three theme states — system (default), light, dark — applied before first paint
so there's no flash.

## Deployment

Push to `main`. The workflow in `.github/workflows/deploy.yml` type-checks,
builds, and publishes to GitHub Pages. Set **Settings → Pages → Source** to
**GitHub Actions** once, on first setup.
