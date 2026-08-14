# coronring.github.io — Design Document

**Version:** 0.1.0
**Status:** Draft — structural scaffold complete, content pending
**Last updated:** 2026-08-14
**Owner:** Guan Zheng Huang (`CoronRing`)

---

## 0. Open question — the visual reference

The brief named <https://endfield.gryphline.com/en-us> as a directional
reference. **That page could not be read programmatically**: it is a
client-rendered SPA whose served HTML contains only the document shell and the
title string, with no CSS, palette, typography, or navigation markup exposed to
a fetch.

Section 5 therefore designs from the _genre_ that site belongs to — dark
industrial-tactical sci-fi — rather than from its specific execution. Concretely
that means: near-black grounds, one high-chroma accent used sparingly, HUD and
technical-readout motifs, monospace metadata, hairline grid rules, and
deliberate kinetic reveals.

**To close this:** supply screenshots, or specific hex values / font names, and
Section 5 gets retuned. Everything downstream of the token file absorbs that
change without structural edits — which is precisely why the tokens are
centralised (§5.1).

---

## 1. Purpose

A personal site that functions as evidence rather than assertion. The claim
being made is _agentic developer_; the site should demonstrate that claim
through the things on it, not describe it.

Three consequences that drive every decision below:

1. **The demos have to actually run.** A project page embedding a live,
   interactive artifact is worth more than one describing the same artifact. The
   architecture makes interactive islands cheap to add (§4.4).
2. **The tools have to be genuinely useful.** A token counter someone bookmarks
   is a stronger signal than a portfolio blurb. Browser-local execution is a
   hard requirement — it's what makes pasting a real production prompt into a
   stranger's website a reasonable thing to do.
3. **The engineering has to survive inspection.** Recruiters skim; engineers
   open dev tools and read the repo. Both audiences are served: typed
   throughout, accessible, fast, and documented.

### Non-goals

- **No CMS, no database, no backend.** Content is version-controlled files.
- **No analytics or third-party trackers.** Nothing to disclose, nothing to consent to.
- **No client-side routing framework.** The site is documents; documents are what the web serves best.

---

## 2. Tech stack

| Layer         | Choice                                                                                   | Rationale                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | **Astro 5** (static output)                                                              | Ships zero JS by default and hydrates only the components that need it. A resume page has no reason to load a runtime; a token counter does. Astro is the only mainstream framework where that's the default rather than an optimisation. |
| Interactivity | **React 19** islands                                                                     | Per-component hydration via `client:*`. React specifically because the demos are the kind of thing React is good at, and because its ecosystem is the deepest if a demo later needs a specialised library.                                |
| Language      | **TypeScript**, `astro/tsconfigs/strict`                                                 | Plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. `astro check` runs in the build, so a type error fails the deploy.                                                                                                            |
| Styling       | **Tailwind CSS v4** via `@tailwindcss/vite`                                              | v4's CSS-first `@theme` block lets utilities be generated _from_ the design tokens, so `bg-surface` and `var(--c-surface)` cannot drift apart. No JS config file.                                                                         |
| Content       | **Astro Content Collections** + MDX                                                      | Zod-validated frontmatter. A typo in a field fails the build instead of rendering an empty page. MDX lets a write-up embed a component inline.                                                                                            |
| Fonts         | **Inter Variable**, **JetBrains Mono Variable** (self-hosted via `@fontsource-variable`) | No CDN request, no FOUT from a third-party origin, no privacy footnote.                                                                                                                                                                   |
| Hosting       | **GitHub Pages** via Actions                                                             | Free, fast, and the deploy pipeline is itself part of the portfolio.                                                                                                                                                                      |
| Formatting    | Prettier + Astro/Tailwind plugins                                                        | Class ordering is mechanical; it shouldn't be a review topic.                                                                                                                                                                             |

### Rejected alternatives

- **Next.js** — App Router's server-component model buys nothing on a static site with no backend, and costs a heavier client runtime on pages that need none.
- **Plain HTML/CSS** — genuinely viable, and briefly tempting. Rejected because the tools page needs real interactive state, and content collections earn their keep the moment there are more than a handful of projects.
- **A template** — the site's subject is engineering capability. Buying the design undercuts the argument.

---

## 3. Information architecture

Five top-level routes, matching the brief. Each nav entry carries a two-digit
index (`00`–`04`) as an intentional HUD motif and a scanning aid.

```
/                    00  Index      Identity, positioning, featured work
/projects            01  Projects   Demo gallery
/projects/[slug]         Detail: live demo + engineering write-up
/resume              02  Resume     Experience, education, achievements, certs
/resources           03  Resources  Curated references and original notes
/tools               04  Tools      Browser-local LLM utilities
/tools/[slug]            Individual tool
/404                     Not found
```

### 3.1 Index (`/`)

| Section       | Content                                                                                        | Purpose                                                            |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Hero          | Availability indicator, headline, one-paragraph positioning, three CTAs, four-cell HUD readout | Answer "who is this and should I keep reading" within one viewport |
| Capabilities  | Three pillars: agent systems, developer tooling, applied NLP                                   | Make "agentic developer" concrete                                  |
| Featured work | `featured: true` projects from the collection                                                  | Move visitors to the demos fast                                    |
| Contact       | Single closing CTA                                                                             | One clear next action                                              |

Full-viewport hero with a scroll affordance. The HUD readout strip does real
work: it anchors the technical aesthetic while communicating focus, location,
and stack at a glance.

### 3.2 Projects (`/projects`)

Card grid (1 / 2 / 3 columns), driven entirely by the collection and sorted by
an explicit `order` field. Each card carries a status light (live / in-progress
/ archived), an `Interactive` badge where applicable, and up to four tech tags.

**Detail pages lead with the demo.** Where `interactive: true`, the hydrated
island is mounted _above_ the prose, inside a window-chrome frame (§4.4). The
write-up supports the artifact; it does not substitute for it. Layout below the
demo is a two-column split at ≥`lg`: prose at reading measure, sticky metadata
rail (role, period, stack, links) alongside.

### 3.3 Resume (`/resume`)

One `experience` collection, grouped by a `kind` discriminator into four
sections — Experience, Education, Achievements, Certifications — rendered
through a single row component so nothing drifts. Sorted newest-first, with
current roles (no `end` date) floating to the top and rendering as "Present".
Includes a PDF download affordance.

### 3.4 Resources (`/resources`)

Grouped by category (Agents / LLM Ops / Engineering / Reading / Tooling), each
group sorted by `updated`. Entries with a `url` are outbound pointers; entries
without one are original write-ups. Both render identically so the list stays
scannable — the distinction is an arrow glyph, not a different card.

### 3.5 Tools (`/tools`)

Registry-driven from `src/data/tools.ts`. **Planned tools are shown
deliberately**, dimmed and labelled — the roadmap is part of the story, and a
greyed card is more honest than an empty grid.

The page leads with a privacy assertion, because it is the single most important
thing to say to someone about to paste a production prompt into it.

| Tool              | Group              | Status   |
| ----------------- | ------------------ | -------- |
| Token Counter     | Tokens & Cost      | **Live** |
| Context Budgeter  | Tokens & Cost      | Planned  |
| Prompt Diff       | Prompt Engineering | Planned  |
| JSON Schema Forge | Structured Data    | Planned  |
| Chunk Visualizer  | Text Processing    | Planned  |

#### Token Counter — the honesty constraint

Claude's tokenizer is not published as a client-side library; the authoritative
count comes from `POST /v1/messages/count_tokens`, which needs an API key and a
network round trip. This page has neither, by design.

So the counter **estimates**, using a segment-weighted character model: text is
split by character class (prose / digits / symbols / CJK / whitespace) and each
class is charged a different characters-per-token rate. That handles what a flat
`chars / 4` rule gets badly wrong — code, CJK, digit runs, whitespace blocks.
Expect ±10% on prose, ±15% on code.

**The UI states this plainly and points at the real endpoint.** A tool that
quietly presents an estimate as exact is worse than no tool; being visibly
careful about it is the more useful signal anyway.

Cost projection multiplies the estimate by published list rates
(`src/data/models.ts`, single source of truth), with promotional pricing handled
by date comparison so it can't silently go stale. Caching economics are noted
but excluded from the arithmetic.

---

## 4. Component architecture

```
src/
├── components/
│   ├── ui/          Primitives: Panel, Button, Tag, Icon, SectionHeader, Reveal
│   ├── layout/      Header, Footer, ThemeToggle
│   ├── decor/       Backdrop (grid + bloom + grain)
│   ├── demos/       Project demo islands + registry
│   └── tools/       Tool islands (TokenCounter, …)
├── layouts/         BaseLayout → PageLayout, ToolLayout
├── pages/           Routes
├── content/         Schema-validated MDX/Markdown
├── data/            site.ts, tools.ts, models.ts
├── lib/             url, theme, tokens, format
└── styles/          tokens.css, global.css
```

### 4.1 Layout hierarchy

- **`BaseLayout`** — the document shell. `<head>` metadata, Open Graph, canonical URL, font imports, the pre-paint theme script, backdrop, header, `<main>` landmark, footer.
- **`PageLayout`** — `BaseLayout` + the standard interior masthead. Every route except the home page (bespoke hero) and tool pages.
- **`ToolLayout`** — `BaseLayout` + tool chrome, with metadata looked up from the registry by slug. A slug with no registry entry throws at build time.

### 4.2 Primitives — deliberately few

`Panel` is the **only** boxed surface in the system. Anything card-shaped uses
it, so elevation and border treatment cannot diverge across pages. It is
polymorphic (`as`), which is what lets an entire card be a single anchor rather
than a div wrapping a link.

`Button` renders `<a>` when given `href` and `<button>` otherwise — one
component so link-actions and form-actions can't drift.

`Icon` is a central inline-SVG registry. No icon font, no runtime fetch,
`currentColor` throughout.

### 4.3 Progressive enhancement

`Reveal` implements scroll-triggered entrance with three independent fallbacks:
`<html class="no-js">` (cleared by the pre-paint script) shows content if JS
never runs; a missing `IntersectionObserver` reveals everything immediately; and
`prefers-reduced-motion` collapses the transition in CSS. The observer is
registered **once per page**, not once per component.

### 4.4 Demo registry

Project frontmatter names a demo by string (`demo: "placeholder"`);
`src/components/demos/registry.ts` maps that string to a component.

A **static** map rather than a dynamic `import()` of an arbitrary path, so the
bundler sees every demo, tree-shakes correctly, and an unregistered name throws
at build time instead of shipping an empty stage. Demos hydrate `client:visible`
— one below the fold costs nothing until scrolled to.

Adding a demo: build the island, import it, add one registry entry, set two
frontmatter fields.

---

## 5. Visual system

### 5.1 Tokens

Every colour is defined **once**, on bare `:root`, as the light palette
(`src/styles/tokens.css`). The dark palette redeclares only the same token
names — never new ones. Components reference `var(--c-*)` or the Tailwind
utilities generated from them; no component hardcodes a hex value.

Three theme states, and "system" is a real state rather than an alias for light:

| State            | Mechanism                                                     |
| ---------------- | ------------------------------------------------------------- |
| System (default) | No `data-theme` attribute; CSS follows `prefers-color-scheme` |
| Light            | `data-theme="light"` pins the light palette                   |
| Dark             | `data-theme="dark"` pins the dark palette                     |

Because the media-query block is guarded as `:root:not([data-theme='light'])`
and the explicit-dark block is a separate rule, the toggle wins in **both**
directions. A pre-paint inline script in `<head>` applies the stored choice
before first render, so there is no flash.

### 5.2 Palette

Dark is the design intent; light is a well-supported alternate. The accent is
**corona amber** — on-brand for the name, and the right register for the
reference genre. Amber is used sparingly: it marks the active nav item, corner
brackets, focus rings, and exactly one CTA per section. A second **signal cyan**
carries data and live indicators.

| Token            | Light     | Dark      | Role             |
| ---------------- | --------- | --------- | ---------------- |
| `--c-ground`     | `#f4f5f7` | `#070809` | Page floor       |
| `--c-surface`    | `#ffffff` | `#0d0f13` | Panels           |
| `--c-raised`     | `#eceef2` | `#14171d` | Hover / inset    |
| `--c-line`       | `#d5d9e0` | `#21262f` | Hairline         |
| `--c-text`       | `#14171d` | `#e8eaed` | Primary text     |
| `--c-text-muted` | `#565e6c` | `#99a1ad` | Body de-emphasis |
| `--c-text-faint` | `#8a929e` | `#6b7280` | Metadata         |
| `--c-accent`     | `#b96900` | `#ffa62b` | Corona amber     |
| `--c-signal`     | `#0b7285` | `#3ddcff` | Signal cyan      |

Light-mode amber is darkened to `#b96900` so accent-on-surface text clears
WCAG AA; the dark-mode value is brightened for the same reason on near-black.

### 5.3 Typography

Inter Variable for UI and prose; JetBrains Mono Variable for metadata, code,
labels, and numeric readouts. **The mono/sans split carries meaning**: mono
marks machine-adjacent information (indices, timestamps, token counts, model
IDs), sans carries human language. Headings run tight (`-0.022em`) and balanced
(`text-wrap: balance`); prose uses `text-wrap: pretty`.

The `.eyebrow` class — 11px mono, uppercase, `0.16em` tracking — is the recurring
"field label" voice and appears on nearly every section.

### 5.4 Layout

Three nested measures as tokens: `--shell-max` (88rem outer frame),
`--content-max` (72rem standard column), `--prose-max` (42rem reading measure).
Gutters step 1.25rem → 2rem → 3rem across breakpoints. Long-form text is always
constrained to `--prose-max` regardless of container width.

### 5.5 Motion

Two easing curves only: `--ease-out` (decelerating, for entrances) and
`--ease-in-out` (symmetric, for moves). Four durations (120 / 220 / 420 / 700ms).
Reveals stagger siblings by 60–90ms. Everything collapses to ~0ms under
`prefers-reduced-motion`.

### 5.6 The HUD motifs

Four recurring devices carry the reference aesthetic without becoming costume:

1. **Corner brackets** (`.corner-ticks`) — accent-coloured ticks on two opposing panel corners.
2. **Blueprint grid** — a fixed 4rem backdrop grid, radially masked so it never hard-stops, opacity scaled per theme.
3. **Mono index labels** — `00`–`04` on nav, sections, and cards.
4. **Status lights** — small pulsing dots for live/operational states.

Plus a corona bloom and SVG film grain in the fixed backdrop, the latter
specifically to kill gradient banding.

---

## 6. Accessibility

Not a checklist item — several decisions above exist because of it.

- Skip-to-content link, first in the tab order.
- Semantic landmarks; every nav has an `aria-label`.
- Active nav marked with `aria-current="page"` (not colour alone).
- Mobile drawer: `role="dialog"`, `aria-modal`, focus moved in on open and restored on close, Escape closes, scroll locked while open, and a viewport-widening listener that prevents it being stranded open.
- One uniform, always-visible `:focus-visible` treatment site-wide.
- Text contrast targets WCAG AA in both themes; the light-mode accent was darkened specifically to meet it.
- `prefers-reduced-motion` honoured globally.
- Decorative layers are `aria-hidden` and `pointer-events-none`.
- Wide tables scroll inside their own container; the page body never scrolls horizontally.

---

## 7. Performance

| Decision                             | Effect                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Zero JS by default                   | Index, resume, and resources ship no runtime                                              |
| `client:visible` for demos           | Below-fold islands cost nothing until scrolled to                                         |
| `client:load` for the token counter  | The island _is_ the page and sits above the fold — deferring would only add visible delay |
| Self-hosted variable fonts           | No third-party connection; two files cover every weight                                   |
| Inline SVG icons                     | No icon font, no sprite request                                                           |
| Static output, `format: 'directory'` | Plain HTML from CDN edge                                                                  |

Targets: Lighthouse ≥95 across all four categories; LCP < 1.5s on a cold 4G load.

---

## 8. Deployment

`main` → GitHub Actions → GitHub Pages. `npm run build` runs `astro check`
before `astro build`, so **a type error fails the deploy rather than shipping**.
Concurrency group `pages` with `cancel-in-progress: false`, so a partially
uploaded artifact can never win a race against an in-flight deploy.

The footer renders a build timestamp baked at compile time — a cheap, honest
"is the deploy actually live" signal.

`site` is `https://coronring.github.io` with `base: '/'`. All internal links
route through `href()` in `src/lib/url.ts`, which resolves against
`import.meta.env.BASE_URL` — so if this ever moves to a project page, one config
line changes and every link still works.

---

## 9. Content model

| Collection   | Path                                 | Key fields                                                                                         |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `projects`   | `src/content/projects/**.{md,mdx}`   | `title`, `summary`, `order`, `status`, `interactive`, `demo`, `tech`, `links`, `featured`, `draft` |
| `resources`  | `src/content/resources/**.{md,mdx}`  | `title`, `summary`, `category`, `url?`, `tags`, `updated`, `draft`                                 |
| `experience` | `src/content/experience/**.{md,mdx}` | `organization`, `role`, `start`, `end?`, `kind`, `highlights`, `tech`, `links`                     |

All Zod-validated. `draft: true` excludes an entry from production listings.
Omitting `end` on an experience entry means "current" and renders as _Present_.

**Every page renders an explicit empty state** naming the directory to add files
to — the scaffold is navigable and self-documenting before any real content
lands.

---

## 10. Roadmap

### Phase 1 — Structure ✅ (this pass)

Design system, layout shell, five routes, content collections, demo registry,
one working tool, deploy pipeline.

### Phase 2 — Content

Replace every placeholder. Real projects, real resume entries, real resources.
Write the `agent-harness` and `nlp-toolbox` pages properly. Add `public/resume.pdf`.

### Phase 3 — Demos

Replace `PlaceholderDemo` with real interactive artifacts. Each needs to work
offline, degrade gracefully, and be genuinely worth pressing the buttons on.

### Phase 4 — Tools

Ship the four planned tools. Consider a WASM tokenizer to replace the estimator
with an exact count — the single biggest quality upgrade available to the token
counter.

### Phase 5 — Polish

Real OG images (per-page, generated at build). Lighthouse pass. Cross-browser
and screen-reader testing. Optional: RSS for resources, `/uses`, a writing
section.

---

## 11. Decision log

| Decision                                               | Reasoning                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Astro over Next.js                                     | No backend to justify server components; zero-JS-by-default is the right default for a documents-plus-islands site |
| Tailwind v4 CSS-first `@theme`                         | Utilities generated from the token file, so utilities and variables cannot drift                                   |
| Static demo registry over dynamic import               | Build-time failure on a typo; correct tree-shaking                                                                 |
| Three-state theme with "system" as a real state        | A two-state toggle silently overrides an OS preference the visitor already expressed                               |
| Dark-first, light fully supported                      | Dark suits the reference genre; light is what a recruiter on a bright screen actually wants                        |
| Estimator, labelled as such, over silent approximation | An unlabelled estimate presented as exact is worse than no tool                                                    |
| Planned tools shown dimmed                             | The roadmap is part of the story; an empty grid says less than an honest one                                       |
| Pricing centralised in `models.ts` with dated promos   | A rate change is one edit, and promotional pricing expires on its own                                              |
| Single `Panel` primitive                               | The one reliable way to keep card surfaces uniform across five page types                                          |

---

## Appendix — commands

```bash
npm install       # install
npm run dev       # dev server, localhost:4321
npm run build     # astro check && astro build
npm run preview   # serve ./dist locally
npm run format    # Prettier
```
