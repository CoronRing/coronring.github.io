# coronring.github.io — Design Document

**Version:** 0.2.0
**Status:** Draft — structure and visual system built, content pending
**Last updated:** 2026-08-14
**Owner:** Guan Zheng Huang (`CoronRing`)

> **v0.2.0** replaces the speculative visual system in v0.1.0 with one derived
> from the actual reference. See §0.

---

## 0. The reference, and how it was actually obtained

v0.1.0 recorded that <https://endfield.gryphline.com/en-us> "could not be read
programmatically" and designed from the _genre_ instead. **That was wrong**, and
the resulting palette, layout, and typography were all off.

What was true: `WebFetch` performs a server-side fetch with no JS execution, so
a client-rendered SPA returns only its shell. What did not follow: that the
design was unobtainable. Three routes worked:

| Route                                                   | Yield                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl` the `<link rel=stylesheet>` hrefs from the shell | 375 kB of real CSS — every colour and font name. The shell _did_ list all nine stylesheets; WebFetch's markdown conversion had stripped the tags before they were ever seen. |
| `chrome --headless --screenshot --virtual-time-budget`  | Rendered ground truth in one command                                                                                                                                         |
| SingleFile CLI                                          | Same, packaged as a single inlined HTML file                                                                                                                                 |

**Lesson recorded deliberately:** a limitation of one tool was reported as a
property of the target. When a fetch returns a shell, escalate to a real
browser before concluding anything about a design.

### What the reference actually is

The marketing hero and the interior pages are two different design languages.
The interior ("Lore") page is the one this site draws from:

- Near-black ground with a soft off-axis aurora bloom
- **Fixed left sidebar** — icon + label rows, active item marked by a left border
- A **particle point-cloud** as the visual centrepiece
- A **technical dial** around it: radial ticks, heavy bezel arcs at the diagonals
- **Extremely sparse content** — eyebrow, one display title, one paragraph, a paged indicator, two buttons
- Hazard yellow used exactly once, on a ~40 px carousel segment

### Measured values

|              | v0.1.0 guessed  | Measured                                            |
| ------------ | --------------- | --------------------------------------------------- |
| Ink          | `#070809`       | **`#191919`** (84 uses)                             |
| Accent       | Amber `#ffa62b` | **Hazard yellow `#fffa00`** (56 uses)               |
| Alert        | —               | **Crimson `#be1414`**                               |
| Display type | Inter           | **Novecentosanswide**, Gilroy — wide geometric caps |
| Navigation   | Horizontal bar  | **Vertical rail**                                   |

Novecentosanswide and Gilroy are commercial and are not bundled. **Archivo
Variable** supplies the wide caps via its `wdth` axis (SIL OFL, self-hosted);
Space Grotesk — which is in the reference's own stack — is the alternative.

---

## 1. Purpose

A personal site that functions as evidence rather than assertion. The claim is
_agentic developer_; the site should demonstrate it through the things on it.

Three consequences:

1. **The demos have to run.** A live artifact beats a description of one.
2. **The tools have to be useful.** Browser-local execution is a hard
   requirement — it is what makes pasting a real prompt into a stranger's site
   reasonable.
3. **The engineering has to survive inspection.** Recruiters skim; engineers
   open dev tools.

Added in v0.2.0, from direct feedback: **artistic impact is a first-class
requirement, not decoration.** Density is budgeted (§6), and the hero carries a
real interactive artifact rather than a text block.

### Non-goals

No CMS, no backend, no analytics, no client-side routing framework.

---

## 2. Tech stack

| Layer         | Choice                                                    | Rationale                                                                                                                                                |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | **Astro 5** (static)                                      | Zero JS by default; hydrate only what needs it. A resume page has no reason to load a runtime; a token counter does.                                     |
| Interactivity | **React 19** islands                                      | Per-component hydration. Used for the carousel and the token counter.                                                                                    |
| Particles     | **SenseRing `particle_wave`**, vendored                   | Existing in-house engine: Verlet physics, pointer repulsion, click ripples, compact `.pwcloud` format. Reimplementing it would have been strictly worse. |
| Language      | **TypeScript**, `astro/tsconfigs/strict`                  | Plus `noUncheckedIndexedAccess`. `astro check` gates the build.                                                                                          |
| Styling       | **Tailwind CSS v4** via `@tailwindcss/vite`               | `@theme` generates utilities _from_ the tokens, so `bg-surface` and `var(--c-surface)` cannot drift.                                                     |
| Content       | **Content Collections** + MDX                             | Zod-validated frontmatter; a bad field fails the build.                                                                                                  |
| Fonts         | Inter, JetBrains Mono, **Archivo** (`wdth`) — self-hosted | No CDN, no third-party origin, no privacy footnote.                                                                                                      |
| Hosting       | **GitHub Pages** via Actions                              | The deploy pipeline is itself part of the portfolio.                                                                                                     |

### Rejected

- **Next.js** — App Router buys nothing on a static site with no backend.
- **Plain HTML/CSS** — viable until the tools page needed real state.
- **A template** — the subject is engineering capability; buying the design undercuts the argument.

---

## 3. Information architecture

Five routes. Each nav entry carries a two-digit index as a HUD motif.

```
/                    00  Index      Hero instrument, capabilities, selected work
/projects            01  Projects   Card gallery with generated cover art
/projects/[slug]         Detail: live demo above the write-up
/resume              02  Resume     One timeline, four sections
/resources           03  Resources  Categorised link list
/tools               04  Tools      Browser-local utilities
/tools/[slug]            Individual tool
/404                     Not found
```

---

## 4. Shell architecture

### 4.1 The rail

A fixed left sidebar (`--rail-w`, 16.25rem) replaces the horizontal header. It
buys three things a top bar could not: navigation stays visible through a
full-height hero, the content column gets an asymmetric left edge to sit
against, and the active item can take a left border rather than an underline.

Content is offset by `.rail-offset` — a CSS padding, not a flex sibling — so
page markup stays independent of the shell. Below `lg` the rail collapses to a
top bar plus a focus-trapped drawer, rendered from the same `SITE.nav` source.

The rail also holds the site's **single persistent call to action**, which is
why the home page needs only one button and the footer needs none.

### 4.2 The contrast veil

A loading screen in the _opposite_ tone to the active theme: dark theme opens
through a light veil, light theme through a dark one (`--veil-bg` / `--veil-fg`
flip with the palette). The reveal is a deliberate curtain rather than a fade-in
from the page's own background.

Three behaviours stop it becoming an annoyance:

1. **Fails open.** `hidden` in markup; only unhidden by the pre-paint script.
2. **Once per session.** This is an MPA — veiling every navigation would be intolerable. A `sessionStorage` flag limits it to the first view.
3. **Floor and ceiling.** ~500 ms floor stops it strobing on a warm cache; 2.5 s ceiling guarantees it lifts even if `load` never fires.

`prefers-reduced-motion` skips it entirely.

### 4.3 Layers

`Backdrop` renders once, fixed, `aria-hidden`, `pointer-events-none`: blueprint
grid → aurora bloom → horizon hairline → SVG film grain (which exists to kill
banding across the bloom).

---

## 5. Visual system

### 5.1 Dual theme, equally weighted

Neither theme is the design with the other bolted on. **Dark is the instrument
panel; light is the printed spec sheet.** Both are authored and both are
verified by screenshot.

Every colour is defined once on bare `:root` (light). The dark palette
redeclares only the same token names. Three theme states, with "system" a real
state rather than an alias for light:

| State            | Mechanism                                           |
| ---------------- | --------------------------------------------------- |
| System (default) | No `data-theme`; CSS follows `prefers-color-scheme` |
| Light            | `data-theme="light"`                                |
| Dark             | `data-theme="dark"`                                 |

The media block is guarded `:root:not([data-theme='light'])` and the explicit
dark block is separate, so the toggle wins in both directions. A pre-paint
inline script applies the stored choice before first render.

### 5.2 Palette

| Token                      | Light     | Dark      |
| -------------------------- | --------- | --------- |
| `--c-ground`               | `#f2f2f2` | `#0a0a0b` |
| `--c-surface`              | `#ffffff` | `#131315` |
| `--c-text`                 | `#191919` | `#f5f5f5` |
| `--c-accent` (text/stroke) | `#7a7500` | `#fffa00` |
| `--c-accent-fill`          | `#fffa00` | `#fffa00` |
| `--c-alert`                | `#be1414` | `#ff3b3b` |

**The accent splits into two tokens.** Raw `#fffa00` as text on white is
illegible, so light mode uses a darkened olive for text and strokes while
_fills_ keep the pure hue with ink on top — the hazard-tape pairing the
reference uses. Dark mode uses the pure hue for both.

Yellow is rationed: the active nav border, the eyebrow marker, one CTA, the
carousel's active segment.

### 5.3 Typography

Three faces, split semantically rather than decoratively:

- **Archivo Variable** at `font-stretch: 118%`, uppercase — page titles only, never body copy (`.display`)
- **JetBrains Mono** — machine-adjacent metadata: indices, timestamps, token counts, model IDs
- **Inter** — human language

`.eyebrow` (11 px mono, `0.18em` tracking, uppercase) is the recurring field
label; `.eyebrow-marked` adds the reference's small leading square.

### 5.4 Motion

Two easing curves, four durations. Reveals stagger siblings by 40–90 ms.
Everything collapses under `prefers-reduced-motion`.

---

## 6. Density budget

Direct feedback on v0.1.0: _"right now it's packed with text and button."_ It
was — the old home page carried three buttons, a four-cell readout, three prose
cards, and a contact panel.

Rules now:

| Surface           | Budget                                                         |
| ----------------- | -------------------------------------------------------------- |
| Hero              | Eyebrow, one display title, one sentence, **one** button       |
| Capabilities      | A **carousel** — one pillar visible at a time                  |
| Selected work     | **Two** cards; the projects page holds the rest                |
| Interior masthead | Eyebrow, title, one sentence                                   |
| Footer            | A build stamp. The rail already carries sitemap, socials, CTA. |
| Contact section   | **Removed** — the rail's CTA is always on screen               |

Long-form measure is `--prose-max: 36rem`, deliberately narrow.

The carousel is paged rather than stacked because three side-by-side prose
cards is three blocks competing for one glance. It does not auto-advance;
inactive panels are `hidden`, so they leave the tab order entirely.

---

## 7. The particle instrument

### 7.1 Engine

`src/vendor/particle-wave/` is vendored from SenseRing's `particle_wave` FE.
Public surface: `ParticleWave.init(canvas, config) → instance` with
`setConfig` / `pause` / `resume` / `triggerWave` / `destroy`.

Upstream is plain JS with JSDoc, whose inferred types are too narrow to use
(`DEFAULTS.src` is `null`, so `src` infers as `null | undefined` and rejects the
URL the engine requires). `particle-wave.d.ts` declares the surface separately
rather than editing vendored code, which would be lost on the next sync.

### 7.2 The cloud

`scripts/generate-cloud.mjs` emits `public/clouds/corona.pwcloud` — a corona:
dense ring, 34 radial flares, a small core, and ambient dust (the dust exists so
the cursor gets a response in the empty regions, not just on the ring).

Parametric rather than traced from an image: no source bitmap to ship, no Python
step in CI, and density is one number. **Seeded PRNG** — an unseeded generator
would emit a different asset every run, showing a spurious diff and busting the
CDN cache. 6,675 points, 121 kB raw / **32.8 kB gzipped**, verified
byte-identical across runs.

### 7.3 Integration

The component owns theming, cost control, and graceful absence. Loading is
gated on an IntersectionObserver, and the simulation pauses when off-screen or
backgrounded.

**Particle appearance is theme-dependent, and the two themes need different
numbers to carry equal weight.** A small antialiased dark dot on light ground
loses most of its ink to partial pixel coverage; a white dot on near-black reads
as a light source and looks stronger than its alpha suggests. Hence
`--particle-size` 1.9 (light) vs 1.8 (dark) and `--particle-opacity` 0.92 vs
0.85, all re-pushed via `setConfig` on theme change.

### 7.4 Two bugs found by measuring pixels

Both were invisible to inspection and only surfaced by sampling the rendered
PNG with PIL.

**A canvas fade-in that never finished.** The canvas carried
`transition-opacity duration-1000`. Any renderer that freezes the animation
clock — headless capture, some low-power modes — samples it mid-fade and leaves
the cloud permanently at ~35% of intended contrast (measured: darkest particle
luminance 167 against a 241 background, where 19 was expected). The fade bought
nothing, because the canvas is transparent until the first frame paints and
there is no wrong state to hide. **Removed**, and rendering is now deterministic
across runs.

**Reduced motion rendered nothing at all.** The reduced-motion path called
`instance.pause()` immediately, which cancelled the rAF the engine had scheduled
in its constructor — so the canvas stayed blank rather than showing a static
composition. Now it waits two frames before pausing.

A third, related hardening: `[data-reveal]` starts at `opacity: 0`, so any
element the observer fails to reach would stay invisible **forever**. A 2 s
safety timeout now reveals anything still pending. A hidden-content bug is worse
than a missed animation.

---

## 8. Generated cover art

`CoverArt.astro` draws a deterministic SVG panel seeded from the project slug
(FNV-1a → PRNG): orbit arcs, an accent core, nodes, scanlines, frame ticks.

Real screenshots are better, and this yields the moment a project supplies a
`cover`. Until then it beats both alternatives: an empty grey box says nothing,
and a stock photo says something untrue. Same slug always draws the same panel —
stable across rebuilds, distinct from its neighbours in a grid.

---

## 9. Accessibility

- Skip link first in tab order; semantic landmarks; `aria-label` on every nav
- Active nav marked `aria-current="page"`, not colour alone
- Drawer: `role="dialog"`, `aria-modal`, focus moved in and restored, Escape closes, scroll locked, viewport-widening listener prevents it stranding open
- Carousel: labelled group, `aria-roledescription`, inactive panels `hidden`, arrow-key paging, no auto-advance
- One uniform `:focus-visible` treatment site-wide
- AA text contrast in both themes — the light accent was darkened specifically to meet it
- Decorative layers `aria-hidden` + `pointer-events-none`
- `prefers-reduced-motion` honoured globally, and the particle field still renders its composition

---

## 10. Performance

| Decision                   | Effect                                            |
| -------------------------- | ------------------------------------------------- |
| Zero JS by default         | Resume and resources ship no runtime              |
| IO-gated particle init     | 33 kB cloud + engine load only near the viewport  |
| Pause when hidden          | No rAF loop off-screen or in a background tab     |
| `client:visible` carousel  | Below-fold island costs nothing until scrolled to |
| Self-hosted variable fonts | No third-party connection                         |
| Inline SVG                 | No icon font, no sprite request                   |

---

## 11. Verification method

Visual work is verified by measurement, not by eye:

1. `npm run build` (type-check gated) → `npm run preview`
2. `chrome --headless --screenshot` per theme (`--blink-settings=preferredColorScheme` toggles it; note the flag's values behaved inversely in testing — confirm against the rendered background before trusting a label)
3. Sample the PNG with PIL: background luminance, darkest/brightest particle, delta

This is how both §7.4 bugs were found. Screenshots alone would have shown "a bit
faint" and been dismissed as a style preference.

---

## 12. Content model

| Collection   | Path                      | Key fields                                                                                                |
| ------------ | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `projects`   | `src/content/projects/`   | `title`, `summary` (≤180), `order`, `status`, `interactive`, `demo`, `tech`, `links`, `featured`, `draft` |
| `resources`  | `src/content/resources/`  | `title`, `summary`, `category`, `url?`, `tags`, `updated`, `draft`                                        |
| `experience` | `src/content/experience/` | `organization`, `role`, `start`, `end?`, `kind`, `highlights`, `tech`                                     |

All Zod-validated. Omitting `end` means "current" and renders as _Present_.
Every page renders an explicit empty state naming the directory to add files to.

**Demo registry:** project frontmatter names a demo by string, and
`DemoFrame.astro` maps it with explicit per-demo branches. Not a lookup table —
Astro generates hydration scripts from _statically analysable_ imports, so a
runtime-resolved component fails the build with `NoMatchingImport`.

---

## 13. Deployment

`main` → Actions → Pages. `npm run build` runs `astro check` first, so a type
error fails the deploy. Concurrency group `pages`, `cancel-in-progress: false`.

All internal links route through `href()`, which resolves against
`import.meta.env.BASE_URL` — moving to a project page is one config line.

---

## 14. Roadmap

- **Phase 2 — Content.** Replace every placeholder. Real projects, resume, resources. Add `public/resume.pdf`.
- **Phase 3 — Demos.** Replace `PlaceholderDemo` with real artifacts.
- **Phase 4 — Tools.** Ship the four planned tools; consider a WASM tokenizer to replace the token counter's estimator with an exact count.
- **Phase 5 — Polish.** Per-page OG images, Lighthouse pass, screen-reader testing, more `.pwcloud` shapes per section.

---

## 15. Decision log

| Decision                                                          | Reasoning                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Escalate to a headless browser before declaring a site unreadable | v0.1.0's central error; the CSS was one `curl` away                                        |
| Vertical rail over horizontal header                              | Nav persists through a full-height hero; gives the asymmetric edge the reference relies on |
| Contrast veil rather than a matching one                          | A same-tone loader is a blank screen; the opposite tone makes the reveal an event          |
| Veil once per session                                             | An MPA that veils every navigation is unusable                                             |
| Two accent tokens (text vs fill)                                  | `#fffa00` is illegible as text on white but correct as a fill with ink on top              |
| Per-theme particle size and opacity                               | Equal alpha does not mean equal perceived weight across grounds                            |
| No canvas fade-in                                                 | Bought nothing; froze at ~35% contrast wherever the animation clock stalls                 |
| Parametric cloud with a fixed seed                                | No source bitmap, no Python in CI, byte-identical rebuilds                                 |
| Vendor SenseRing rather than reimplement                          | The engine already exists, is better than a rewrite, and is the user's own work            |
| Types declared beside vendored JS, not inside it                  | Upstream edits are lost on the next sync                                                   |
| Carousel over three stacked cards                                 | Three prose blocks compete for one glance                                                  |
| Generated cover art over grey boxes                               | Says something true while real screenshots are pending                                     |
| Verify by sampling pixels                                         | Both particle bugs were invisible to inspection                                            |

---

## Appendix — commands

```bash
npm install
npm run dev                      # localhost:4321
npm run build                    # astro check && astro build
npm run preview
npm run format
node scripts/generate-cloud.mjs  # regenerate public/clouds/corona.pwcloud
```
