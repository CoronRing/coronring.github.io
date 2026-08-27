# coronring.github.io — Design Document

**Version:** 0.8.0
**Status:** Complete — Rest Reminder tool with tactical HUD clock dial, OS notifications, Web Audio synth, and box-breathing pacer
**Last updated:** 2026-08-27
**Owner:** Guan Zheng Huang (`CoronRing`)

> This document covers the Astro site only. The site is now one of three
> deployables in this repository, and anything crossing the boundary between
> them belongs in [`../SYSTEM.md`](../SYSTEM.md).
>
> **v0.8.0** — adds the **Rest Reminder** tool (`/tools/rest-reminder`). Introduces
> a drift-free epoch timestamp engine (`Date.now() + remainingMs`), cross-platform
> Web Notification API integration (macOS, Windows, mobile), zero-network procedural
> Web Audio API synthesizer (four high-contrast cues), and an interactive Endfield-inspired
> tactical HUD clock with 60-radial tick gauges, sweeping scanlines, ambient canvas
> micro-particle constellation, and a 4-4-4-4 box-breathing recovery pacer.
>
> **v0.7.0** — UI/UX overhaul across all nine tools and page layouts. Solves
> button sprawl and dense prose fatigue. Text Diff introduces primary workspace
> modes (`[ ≡ Word & Line Diff ]` vs `[ ✦ Semantic Analysis ]`) with synchronized
> split views and immediate diff inspection. Shared `ui.tsx` primitives gain tactical
> HUD aesthetics (hazard yellow primary fills, sleek secondary ghost buttons, corner
> tick accents, and first-class `Tabs`). Dense markdown prose across all tool
> pages converted into scannable HUD technical specification cards.
>
> **v0.6.0** — five more tools (Python Runner, String Kit, Regex Lab, Random
> Kit, Read Time) and a semantic axis added to Text Diff. Three consequences
> worth recording. The site now executes visitor-supplied code, in a worker,
> under §12.4. The chat service gains a second endpoint, `/api/embed`, which is
> the first backend work driven by a tool rather than by the assistant. And the
> runner is mountable on a project page through a new `pyPreset` frontmatter
> field, which is how an interfaceless Python package gets a demo. §12.2 is
> rewritten, §12.4 and §12.5 are new.
>
> **v0.5.0** — the tools section goes from one tool to four: Token Counter
> (rebuilt on LiteLLM's price list), Text Diff, Chunk Visualizer and MCP
> Tester. Two of them make network requests, which amends the browser-local
> rule in §1; §12.2 is the new section covering the tools, and §12.3 records
> the amended rule. Tool pages gain an `about` slot carrying the same prose
> treatment as a project page.
>
> **v0.4.0** — the Particle Wave demo now posts uploads to the Python service
> in `backend/` and falls back to the in-tab tracer only when that service is
> unreachable. See §7.5 and §13. Visitor-facing copy was rewritten to drop the
> em-dash-and-triad register; §12.1 records the rule.
>
> **v0.3.0** — the particle engine gains ambient motion (rotation and
> per-particle drift) and per-group spin weights; the hero cloud becomes the
> G mark; the Particle Wave project gets a real driveable demo with in-browser
> image tracing. Repo relocated under `nlp_application_toolbox/`. See §7 and §16.
>
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
2. **The tools have to be useful.** Browser-local execution is the default,
   and what makes pasting a real prompt into a stranger's site reasonable.
   v0.5.0 amends it from an absolute to a two-tier rule; see §12.3.
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
/tools               04  Tools      Instruments for language-model work
/tools/[slug]            Individual tool: instrument above, write-up below
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

#### Ambient motion (v0.3.0)

The engine as vendored was **purely input-driven**: with no cursor on the
canvas the cloud was a still image, which next to a rotating HUD ring read as
broken. Three config keys were added, and ported back to SenseRing:

| Key                             | Meaning                            |
| ------------------------------- | ---------------------------------- |
| `restSpin`                      | Rigid rotation of the cloud, rad/s |
| `driftAmplitude` / `driftSpeed` | Per-particle wander, px            |
| `spinWeightByGroup`             | Per-group rotation multiplier      |

Both effects move the **rest frame**, not the particles. This is the load-bearing
decision: applied as forces they fight the spring and wash out to a small static
offset, which is exactly how the first attempt (a curl-noise `AmbientDrift`
force) failed — it moved neighbouring points together and read as breathing.
Applied to the rest frame the spring carries the particles along, the motion is
visible, and the amplitude is expressible in pixels.

Drift phases are seeded from a hash of the particle index, not `Math.random()`,
so a resize does not teleport every particle to a new point in its wander.

`spinWeightByGroup` exists because **a spinning letter is upside down half the
time**. The glyph groups sit at weight 0 and the corona at 1, so the mark holds
still while its surroundings orbit — a still shape made of moving material.
Weights are stored as a small lookup table (distinct weights are few), so the
per-frame cost is two trig calls per _weight_, not per particle.

Upstream had already diverged from the vendored copy by Prettier formatting
only — no semantic drift — so the port applied the semantic hunks alone rather
than imposing this repo's formatting on SenseRing.

### 7.2 The cloud

`scripts/generate-cloud.mjs` emits `public/clouds/corona.pwcloud` — **the
CoronRing mark as particles**: a ring broken 18° either side of centre-right, a
bar from the core out through the gap, a dense core, plus an orbiting corona of
30 flares and ambient dust (the dust exists so the cursor gets a response in the
empty regions, not just on the glyph).

Proportions are lifted from `Mark.astro` (32-unit box, R=11, core=3) and
re-expressed as fractions of the glyph radius, so the SVG and the cloud stay the
same shape. The glyph radius is 0.27 of the field rather than the SVG's 0.344,
to leave an outer margin for the corona to orbit in.

The corona starts _outside_ the ring rather than growing from it: streamers
rooted in a stationary ring but rotating themselves would visibly shear away
from their own base.

Parametric rather than traced from an image: no source bitmap to ship, no Python
step in CI, and density is one number. **Seeded PRNG** — an unseeded generator
would emit a different asset every run, showing a spurious diff and busting the
CDN cache. 5,831 points across five groups, 106 kB raw, verified byte-identical
across runs.

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

### 7.5 The live demo (v0.3.0)

`ParticleWaveDemo.tsx` is the Particle Wave project's demo: the same engine,
driveable. Seven sliders (spin, drift, wave strength, wave speed, spring,
damping, particle size) and a cursor-mode select, all going through `setConfig`
on the running instance. Claims about a physics engine are cheap; letting the
reader move the spring constant is not.

The instance is **rebuilt only on a cloud change** — particle count is fixed at
construction because the SoA buffers are sized to it. Everything else is hot.
The init effect reads parameters through a ref so a slider does not tear down
the engine.

**Image upload, server first (v0.4.0).** An uploaded image is posted to the
Python service in `backend/` through `src/lib/particle-wave-api.ts`, which runs
the real extractor and returns a `.pwcloud`. That is the half of the project
worth showing: the page renders exactly what the CLI would produce.

`src/lib/image-to-cloud.ts` remains as the fallback and traces in the tab:
luminance → Sobel → importance sampling, emitted as a `.pwcloud` object, which
`Loader.load` accepts as readily as a URL. It is a cut-down port of SenseRing's
Python extractor. That one does multi-scale edges and Poisson-disc spacing;
this one has to answer in under a second.

The two are interchangeable because they emit the identical format, so the
renderer cannot tell them apart. The readout names whichever ran, because the
quality difference is the interesting part and a silent substitution would be a
worse demo than a labelled one. The service is free-tier hardware, so a failure
is expected often enough to be reported as provenance rather than as an error.

The demo asks for 3,500 points at `min_radius` 1.8. That number is measured on
the deployed host rather than guessed: the point cap, not the radius, is what a
visitor waits on, and after the sampler was given a coarse acceleration grid
3,500 points fell from 5.8 s to 1.2 s. See `backend/docs/design.md` §4.1.

> **Background estimation is the whole trick.** The first version weighted
> pixels by distance from the _mean_ luminance. On a dark logo over white the
> mean sits between the two, so every background pixel still scored a third of
> full weight — and with far more background than subject, roughly half the
> points landed on empty paper and the trace came out as a filled rectangle.
> Using the **median** (which, for a subject on a ground, _is_ the ground) plus
> a 0.06 deadband drives those to zero. Measured after the fix: 0.0% of the
> bounding-box corners lit, against 98.1% in the subject band.

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

## 12.1 Copy register

The site is a hiring surface, so copy that reads as machine-generated is a
material cost. Visitor-facing prose carries no em dashes at all. Sentences are
restructured rather than repunctuated, an en dash is used only for date ranges,
and `·` carries the separators the design already relies on.

The constructions avoided by rule: the em-dashed appositive holding a
three-item list, "not just X but Y", "worth noting", and the vocabulary
cluster around "delve", "leverage", "seamless" and "robust". Existing lines
that are already direct are left alone; the aim is to remove the machine
register, not the voice.

This applies to `src/content/`, `src/data/`, page `lede` and `description`
props, demo captions, and `README.md`. Code comments and these design documents
are held to a lower bar.

---

## 12.2 The tools

Ten live, registered in `src/data/tools.ts`. The index and `ToolLayout` both
render from that registry, so a tool cannot disagree with the index about its
own name, summary or network behaviour.

| Tool             | Island                             | Engine                                   | Network                  |
| ---------------- | ---------------------------------- | ---------------------------------------- | ------------------------ |
| Token Counter    | `components/tools/TokenCounter`    | `lib/tokens`, `lib/model-pricing`        | static price table       |
| Text Diff        | `components/tools/TextDiff`        | `lib/diff`, `lib/semantic`               | opt-in embedding call    |
| Chunk Visualizer | `components/tools/ChunkVisualizer` | `lib/chunking`                           | none                     |
| MCP Tester       | `components/tools/McpTester`       | `lib/mcp`                                | the endpoint you name    |
| Python Runner    | `components/tools/PyRunner`        | `lib/py-runtime`, `public/py-worker.js`  | Pyodide CDN, PyPI wheels |
| String Kit       | `components/tools/StringKit`       | `lib/html-to-markdown`, `lib/string-kit` | none                     |
| Regex Lab        | `components/tools/RegexLab`        | `lib/regex-lab`                          | none                     |
| Random Kit       | `components/tools/RandomKit`       | `lib/rng`                                | none                     |
| Read Time        | `components/tools/ReadTime`        | `lib/speech-time`                        | none                     |
| Rest Reminder    | `components/tools/RestReminder`    | `lib/rest-timer`                         | none                     |

**The engine is never in the island.** Every tool is a thin React presentation
layer over a dependency-free module in `src/lib/`. That split is what let each
engine be tested in isolation with a throwaway node harness before any UI
existed, and it is why the components are short enough to read. The v0.6.0
harness carries 279 assertions across seven engines; the two that need a DOM
(`html-to-markdown`) or a browser API (`speech-time` measurement) are covered
as far as jsdom allows and no further.

**Shared controls** live in `components/tools/ui.tsx`. v0.6.0 adds
`DownloadButton`, `PasteButton`, `OutputBox`, `Field`, `TextField`,
`NumberField`, `Select`, `Toggle`, `Toolbar`, `Kbd` and `usePersisted`. Two of
those encode a rule rather than a widget:

- **`OutputBox` is the standard result surface,** with copy and download in its
  header. Every converter ends in one, so "can I get this out of the page" has
  the same answer everywhere. A 4,000-line Markdown document is not usefully
  delivered through a clipboard button alone.
- **`usePersisted` keeps input across a reload,** guarded on every read and
  write. `localStorage` throws outright in a browser configured to block site
  data, and a tool that fails to boot because of a privacy setting is worse
  than one that forgets.

**The price table** (`public/data/model-pricing.json`, ~290 kB) is generated
from LiteLLM's published price list by `scripts/fetch-model-pricing.mjs` and
committed. Reasons, in order: builds stay hermetic, a price change is a
reviewable diff, and the browser never talks to a third party. Refresh with
`npm run pricing:refresh`. It is fetched at runtime rather than bundled, so the
tools that quote no prices do not carry it. `src/data/models.ts` survives as the
pinned shortlist and the offline fallback; the catalogue supplies the numbers
where it has them.

**The MCP client** speaks both protocol eras. Revision `2026-07-28` removed the
`initialize` handshake, protocol-level sessions and the standalone GET stream,
and moved protocol version and client capabilities into per-request `_meta`
plus mirrored HTTP headers. Plenty of deployed servers still speak the older
shape, so `lib/mcp.ts` follows the specification's own detection ladder: modern
`server/discover` first, then a body check on a 400 before falling back. There
is deliberately no proxy — see §12.3.

**The chunkers work over source offsets**, never detached strings. It is what
makes the painted view possible: chunk boundaries land on the visitor's own
document, and a region two chunks both claim is shaded differently from one
only a single chunk covers.

**HTML to Markdown is a content extractor with a serialiser attached**, and the
serialiser is the small half. Raw HTML off a real page is mostly navigation,
banners and scripts, and a faithful converter renders all of it faithfully. So
`lib/html-to-markdown.ts` prunes, then scores candidate containers in the
spirit of Readability (text outside links counts, link text does not, a
container over 50% links is a menu), then walks the surviving tree. It works
against `DOMParser` rather than a regex on purpose: the browser's parser is the
thing that decides what the markup means, it handles malformed tables and the
full entity table for free, and its tree is inert so scripts never run. What is
discarded is listed under the output, because a converter that silently drops
half a page is worse than one that keeps too much.

**Regex Lab cannot prevent a hang, and says so.** JavaScript's engine
backtracks and offers no timeout, so once it is inside a catastrophic match
nothing in the page runs. Three defences in descending order of value: input
and match caps, which bound the linear cost; a deadline checked between
matches; and a static check for nested unbounded quantifiers, which is the only
one that helps in the case that matters. A pattern shaped that way is held and
running it is a deliberate click. Two smaller correctness details are worth
recording because every hand-written match loop gets them wrong: a zero-length
match leaves `lastIndex` alone, so `\b` loops forever without an explicit step,
and that step must be by code point or it splits a surrogate pair.

**Random Kit puts the source first.** Reproducible (xoshiro128\*\* over a hashed
seed) or unpredictable (`crypto.getRandomValues`), stated in the UI, because
those are the only two questions anyone has and `Math.random()` answers
neither. Unique integer draws switch from rejection sampling to a partial
Fisher-Yates once the request wants more than a third of the range, since
rejection sampling on a nearly-full range spends almost all its time rejecting.

**Read Time measures rather than estimating, in about two seconds.** Speaking
rate varies by more than 2x across the voices on one machine, so a word count
cannot answer the spoken-duration question. `SpeechSynthesisUtterance` fires
`boundary` events carrying a character index and an elapsed time, so the tool
speaks the opening at an elevated rate with volume at zero, fits a
characters-per-second rate from the events, and cancels. Cost is independent of
document length. One trap worth recording: `elapsedTime` is specified in
seconds and Chrome has shipped it in milliseconds for years, so wall-clock time
arbitrates. The word-count estimator alongside it uses Brysbaert (2019) rather
than the sourceless 200 wpm everyone repeats.

---

## 12.3 The network rule, amended

v0.1.0 through v0.4.0 held that every tool runs entirely in the browser. Two of
the four now make requests, so the rule is restated rather than quietly broken:

1. **What the visitor types never leaves the tab without an explicit act.** The
   only exception is the diff tool's semantic panel, and it is opt-in per
   click: the button says what leaves the page, and the local engine is the
   default so the tool is fully useful without ever pressing it.
2. **A tool may fetch its own static data from this origin.** The token
   counter's price table. The request carries nothing but its own URL.
3. **A tool whose whole purpose is a network call may make it, to an endpoint
   the visitor named, direct from the tab.** The MCP tester.
4. **A tool may download its own runtime from a public CDN.** The Python
   Runner, which fetches Pyodide from jsDelivr and wheels from PyPI. The code
   typed into it is executed locally and never transmitted. Self-hosting was
   rejected: the distribution is hundreds of megabytes, and even the core would
   be the largest thing in a repository that deploys through GitHub Pages.

`ToolEntry.offline` carries this into the UI: the index badges each live tool,
and `ToolLayout` prints either the blanket privacy line or the tool's own
`network` sentence. A page that promised otherwise would be lying, and the
registry makes the promise impossible to get out of step with the code.

**No proxy, deliberately.** A hosted forwarder that would POST to any URL a
stranger types is an SSRF pivot pointed at internal ranges and cloud metadata
endpoints. The cost of refusing it is that a server without CORS headers is
unreachable from a browser; the tool says so precisely and hands over a `curl`.
The benefit, besides not running an open forwarder, is that `localhost`
endpoints work during development, which a hosted proxy could never do.

---

## 12.4 Running visitor code

The Python Runner executes code a visitor typed. That is a different class of
feature from everything above it, and the design follows from one requirement:
**`while True: pass` must not kill the tab.**

Pyodide is synchronous WebAssembly. On the main thread a runaway loop blocks
rendering, input, and the stop button itself, so there is no in-page recovery.
The only mechanism the platform offers is `Worker.terminate()`. Everything else
falls out of that:

- **The interpreter lives in a worker** (`public/py-worker.js`, served static
  because a worker needs a stable URL and Pyodide's loader calls
  `importScripts`, which a module worker does not have).
- **`stop()` terminates and `start()` rebuilds.** State in the worker is
  expected to be lost, including installed packages, and the UI says so rather
  than letting a cleared namespace look like a bug.
- **A 60 second ceiling** terminates the same way, for the same reason.
- **Nothing is hydrated until asked.** A 12 MB runtime download on page load,
  for a demo most visitors scroll past, is not a trade worth making.

**Environments are a registry** (`src/data/py-presets.ts`), not a hardcoded
list, which is what makes the runner mountable per project — see §12.5.

**The boundary is published wheels, and it is stated per preset.** Pure-Python
wheels install from PyPI unchanged. A compiled extension needs a wheel built
for WebAssembly, which exists only if Pyodide prebuilt it or the maintainer
published one; nothing can be compiled in a tab. A preset that is known not to
install carries `blockers`, shown before the attempt rather than after, because
the attempt takes most of a minute and ends in a traceback that reads like a
framework bug.

`railtracks` is that case, and all three blockers were reproduced against
Pyodide 0.28.3 rather than inferred. It requires `pydantic>=2.11`; Pyodide
bundles 2.10.6, and newer `pydantic-core` publishes WebAssembly wheels only for
CPython 3.14 where Pyodide is on 3.13. Past that, LiteLLM pulls `tokenizers` and
`fastuuid`, both Rust extensions with no wasm wheel at any version. There is a
second, independent obstacle past the install: a Railtracks agent calls a model,
and no major provider sends CORS headers, so a browser cannot reach one whatever
is installed. A working browser demo would need a proxy holding a key. The
preset stays in the registry, attempts the install for real, reports what
stopped it, and hands over the local command; it starts working with no code
change the day those wheels appear.

`particle-wave` is the case that works. The published wheel installs and the
real four-stage pipeline runs in about 2.5 seconds on a synthetic image.
It installs with dependency resolution off and its dependencies named
explicitly, which is a workaround for a metadata detail rather than a
shortcut: the wheel declares `typer[all]`, an extra Typer stopped publishing,
and micropip treats an unknown extra as a hard error where pip only warns.
**That is worth fixing upstream in `ParticleWave/pyproject.toml`.**

**The editor is hand-written** (`components/tools/CodeEditor.tsx`): a
transparent `textarea` over a highlighted `pre`, with the shared metrics
declared once so the caret cannot drift from the text. CodeMirror 6 is the right
answer for an IDE and ~250 kB to type Python into a box on a page whose design
argument is that it loads fast. Edits go through `setRangeText` so the browser's
own undo stack records them; the obvious alternative destroys undo on every Tab.

---

## 12.5 A runnable console per project

Most of the work this site presents is a Python package with no interface. A
README describes one and a code block shows the call; neither answers what
happens when you run it.

So `pyPreset` is an optional field on project frontmatter, validated at render
time against the preset registry so a typo fails the build with a message that
names the registry. Set it and the project page grows a "Run it here" section
mounting the same `PyRunner` island with that package selected and plain Python
as the fallback. It is `client:visible`, since it sits well below the fold and
the interpreter should not start downloading on page load.

This is deliberately not the `demo:` mechanism. A demo is one island per
project chosen from `components/demos/registry.ts` and branched explicitly in
`DemoFrame.astro`; the console is a second, independent slot, so a project can
have both. `particle-wave` does.

---

## 13. Deployment

`main` → Actions → Pages. `npm run build` runs `astro check` first, so a type
error fails the deploy. Concurrency group `pages`, `cancel-in-progress: false`.

All internal links route through `href()`, which resolves against
`import.meta.env.BASE_URL`, so moving to a project page is one config line.

**The workflow builds `src/` only.** `backend/` and `infra/` are in the same
repository but are never built or published by CI, so a broken service cannot
block a content change. The service is deployed by hand with
`python infra/configure.py --deploy`, which means the site and the service can
be out of step and nothing will say so. Verify the pair against the public URL
after either one changes; `../SYSTEM.md` §4 has the check.

---

## 14. Roadmap

- **Phase 2 — Content.** Replace every placeholder. Real projects, resume, resources. Add `public/resume.pdf`.
- **Phase 3 — Demos.** Replace `PlaceholderDemo` with real artifacts.
- **Phase 4 — Tools.** Nine shipped as of v0.6.0 (§12.2); Context Budgeter and JSON Schema Forge remain. Still open: a WASM tokenizer to replace the token counter's estimator with an exact count; per-tool state in the URL so a configuration can be linked; `pyPreset` on the remaining project pages once those packages are published; and revisiting the `railtracks` preset when its transitive wheels reach WebAssembly (§12.4).
- **Phase 5 — Polish.** Per-page OG images, Lighthouse pass, screen-reader testing, more `.pwcloud` shapes per section.

---

## 15. Decision log

| Decision                                                              | Reasoning                                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pyodide in a worker, and terminate as the only stop                   | Synchronous WebAssembly cannot be interrupted in-page; on the main thread a visitor's infinite loop takes the tab and the stop button with it  |
| Keep the `railtracks` preset even though it cannot install            | The blockers are missing wheels, not broken code; a hardcoded refusal would outlive the reason for it, and the attempt reports the real cause  |
| Hand-written editor rather than CodeMirror                            | ~250 kB to type Python into a box on a page whose argument is that it loads fast; a gutter, colour and indent-aware keys is the whole ask      |
| `/api/embed` on the chat service, not a new service                   | It needs Gemini keys, even rotation, per-model cooldowns and a rate limiter, all of which already exist there; a second copy is a second bug   |
| L2-normalise embeddings at the service boundary                       | `gemini-embedding-001` is unit length only at 3072 dimensions; below that cosine and dot product silently disagree by up to 20%                |
| Semantic comparison opt-in per click, local engine as default         | The tool is fully useful without a request, so uploading pasted text on page load would buy nothing and cost the promise in §12.3              |
| Warn on catastrophic regex shapes rather than trying to abort         | Nothing in the page runs once the engine is inside a backtrack; a static check before running is the only defence that exists                  |
| Random Kit names its source in the UI                                 | Reproducible and unpredictable are opposite requirements and `Math.random()` satisfies neither; hiding the choice hides the only two questions |
| Measure speech rate from `boundary` events, then extrapolate          | Speaking rate varies over 2x by voice, so estimating is wrong; speaking the whole text is right and takes minutes. Two seconds either way      |
| `pyPreset` as a second project slot, not a new `demo:` key            | A demo is one island per project; a console is orthogonal, and `particle-wave` wants both                                                      |
| Escalate to a headless browser before declaring a site unreadable     | v0.1.0's central error; the CSS was one `curl` away                                                                                            |
| Generate and commit the price table rather than fetching LiteLLM live | Hermetic builds, a reviewable diff on every price change, and no third-party request from a visitor's browser                                  |
| No server-side proxy for the MCP tester                               | An open request forwarder is an SSRF pivot; direct-from-tab also makes `localhost` endpoints testable                                          |
| Tool engines in `src/lib/`, never in the island                       | Each was tested standalone before any UI existed; keeps the components short enough to read                                                    |
| Vertical rail over horizontal header                                  | Nav persists through a full-height hero; gives the asymmetric edge the reference relies on                                                     |
| Contrast veil rather than a matching one                              | A same-tone loader is a blank screen; the opposite tone makes the reveal an event                                                              |
| Veil once per session                                                 | An MPA that veils every navigation is unusable                                                                                                 |
| Two accent tokens (text vs fill)                                      | `#fffa00` is illegible as text on white but correct as a fill with ink on top                                                                  |
| Per-theme particle size and opacity                                   | Equal alpha does not mean equal perceived weight across grounds                                                                                |
| No canvas fade-in                                                     | Bought nothing; froze at ~35% contrast wherever the animation clock stalls                                                                     |
| Parametric cloud with a fixed seed                                    | No source bitmap, no Python in CI, byte-identical rebuilds                                                                                     |
| Vendor SenseRing rather than reimplement                              | The engine already exists, is better than a rewrite, and is the user's own work                                                                |
| Types declared beside vendored JS, not inside it                      | Upstream edits are lost on the next sync                                                                                                       |
| Carousel over three stacked cards                                     | Three prose blocks compete for one glance                                                                                                      |
| Generated cover art over grey boxes                                   | Says something true while real screenshots are pending                                                                                         |
| Verify by sampling pixels                                             | Both particle bugs were invisible to inspection                                                                                                |
| Ambient motion on the rest frame, not as a force                      | As a force it fights the spring and washes out to a static offset                                                                              |
| Glyph at spin weight 0, corona at 1                                   | A spinning letter is upside down half the time                                                                                                 |
| Median, not mean, as the extractor's background level                 | The mean leaves background pixels at a third weight; the trace fills the frame                                                                 |
| Real driveable demo over a recording                                  | Claims about a physics engine are cheap; a spring-constant slider is not                                                                       |
| Upload goes to the Python service, browser tracer as fallback         | The server half is the project; the fallback keeps a free-tier outage from breaking the page                                                   |
| Provenance labelled in the UI rather than hidden                      | The quality gap between the two tracers is the demonstration, not an implementation detail                                                     |
| Backend and infra excluded from the Pages workflow                    | A service that cannot build must not be able to block a content deploy                                                                         |
| No em dashes in visitor-facing copy                                   | The strongest single tell of machine-written prose on a page employers read                                                                    |

---

## 16. Repository location

The working copy lives at:

```
C:\Users\guanz\Desktop\project-py-NLP toolbox\nlp_application_toolbox\coronring.github.io
```

Moved there in v0.3.0 to sit alongside the other projects, **SenseRing**
included — which matters, because the particle engine is vendored from it and
changes now get ported between two directories a few paths apart.

Two consequences worth knowing:

- It is a git repo nested inside another git repo. The outer toolbox sees it as
  an untracked directory, same as the sibling projects. Do not `git add` it from
  the outer repo — that would record a gitlink rather than the files.
- The path contains a space. Quote it in shell commands.

The move was done as copy → verify → remove rather than a rename: an editor
holding the folder open blocks an atomic rename on Windows, and `node_modules`,
`dist` and `.astro` are all reproducible, so only 506 real files were copied.

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
