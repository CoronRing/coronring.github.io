# coronring.github.io — Design Document

**Version:** 0.27.0
**Status:** Complete. Every rail entry opens its full page from a FULL tab on its row
**Last updated:** 2026-10-15
**Owner:** Guan Zheng Huang (`CoronRing`)

> This document covers the Astro site only. The site is now one of three
> deployables in this repository, and anything crossing the boundary between
> them belongs in [`../SYSTEM.md`](../SYSTEM.md).
>
> **v0.27.0**: the home page designed for a phone, not fitted to one. Below `lg` every band is one composition on one screen, and the scroll drives it the way it does on a desktop.
>
> - **The deck is pinned at every width.** On a phone it is one column with fixed shares of the screen (`--m-top`, `--m-stage`, `--m-copy`, `--m-rail` in the phone section of `deck.css`): the landing card is the name, its sentence and links over the exhibit; one small scroll folds the name to a line, slides the exhibit up under it, and brings in the frame's title, stack and a three-line blurb, with the roster as a strip of tokens along the foot that keeps the held one centred and shows the walk's progress on its top edge. The scroll then walks the frames, 30svh each. Only transforms and opacity move during the handoff, so the exhibit's canvases are never resized mid-transition; when the landing text wraps taller than its space on a small phone the exhibit starts below it (`--m-intro`, measured by `ProjectDeck`). Short screens (under 44rem tall) drop the stack line and clamp the blurb to two lines. The ghost statement is not drawn below `lg`.
> - **Read the blueprints** is a pinned stack of the first three cards, the second and third dealt onto the first as the band scrolls (`--deal` and `--cover`, from `WorkStack`); the cards are compact there (two lines of summary, no stack line).
> - **Myself** is pinned too: the three capabilities are a row of tabs, the held one's sentence and tags sit under them, and its proof is a compact list, all on one screen; the scroll steps through them as on desktop.
> - **Tools** shows its roster as one strip of icons over the tool, so the tool is on the band's first screen rather than under five rows of names.
> - **Every band's "see all" link is at its foot on a phone** (`ui/BandMore.astro`); from `lg` it stays in the heading. Nobody scrolls back up to find the way on.
> - **CoronChat stays off the deck on a phone**, where it would sit on the links and the roster strip.
> - The paste button no longer breaks hydration: whether the clipboard can be read is decided after hydration, so server and browser render the same tree.
>
> **v0.26.2**: hover and phones. NewsRing holds its cycle only while the cursor is inside the inner ring, where the headline is read, or on a row of the picks list; anywhere else over the dial it keeps running. On a phone (below 40rem) the ghost statement is not drawn (it stays the page's `h1`), the stage readout is hidden, Railtracks' head sits 84% down its short box, and the mobile top bar is 95% opaque so the stage does not read through it. CoronChat below `lg` never opens itself: the one-time nudge flashes the collapsed button three times instead (`.ask-hail-beckon`). On a phone the button is only the mark, and on the home page it waits off screen until the visitor scrolls past the first screen, where it would sit on the name's links; the nudge waits with it (§6.2.1).
>
> **v0.26.1**: the deck's drawn marks are yellow in the light theme too. A new token, `--c-mark`, is the yellow a canvas draws with: `#fffa00` on dark, and on light a few steps deeper, `#ecc300`, because the page yellow nearly vanishes as a 2px line on the pale ground. Railtracks' main lane (`--c-flow-main` now points at it), its pulses and hover ring, and NewsRing's threads, picked ticks and highlights all use it, where light mode previously drew them in ink or olive. On paper the main lane is also drawn heavier (2.8px, its waiting dashes and sleepers stronger) and glows are kept faint, since a halo on a light ground is pigment, not light.
>
> **v0.26.0**: the first three exhibits, reworked from a review of v0.24.0.
>
> - **Railtracks reads top-down** and only ever speeds up. The head sits low in the box and the trace climbs away above it; a run's speed doubles every 2.6 s of running toward a soft ceiling, and a finished run keeps accelerating up and off the screen while the next one starts slow at the head. Lanes now fan out: up to four subagents leave one point at once, and parallel tool calls fan two to four leaves from one point (§6.1, "The frames").
> - **The cursor slows Railtracks by distance** instead of stopping it anywhere over the box: on a line or an item it stops, and the effect falls off over 170 px, multiplying the run's own speed.
> - **Every cut between Railtracks, Particle Wave and NewsRing is a morph**, in both directions, run by the deck on its own canvas (`deck/morph.ts`). Particles keep the outgoing picture's colours and fade to the incoming one's, start slow and finish fast (§6.1, "Morphing between drawn exhibits").
> - **NewsRing lists its picks** in the empty top of the copy column. Rows light up as their stories land, about a second apart; hovering one picks out its thread and source on the dial. The ring is larger and runs under the control row.
> - **The ghost statement belongs to the landing card** and leaves with the lede; the set name steps back a shade toward the ground once the deck is out.
> - **Key phrases are picked out** in project summaries, the deck blurbs, the intro and Myself (`lib/emphasis.ts`, §12.1).
> - **Every project has a hero**: Particle Wave, FeatherRing, EvalRing and gs_prompt_manager now show a drawing traced by the Particle Wave package and rendered by its engine (§8). Railtracks' hero is recaptured from the top-down engine.
> - **Project pages read wider and calmer.** The write-up uses the blog's `.post-prose` styles at 16px in a 46rem column, the hero is held to that column instead of the whole shell, and the text-plus-sidebar grid is capped at 66rem. Highlighted code follows the site theme: the block sits on `--c-sunken` and switches to Shiki's dark colours (`--shiki-dark`) wherever the page is dark, in `global.css`, so posts benefit too. Before this a block was white in dark mode with a dark band behind every line, because the page's inline-code background also hit code inside blocks.
>
> **v0.25.0**: the FULL tab from the tools roster (v0.22.0) is now site-wide. Rail entries jump to their home band, so the dedicated pages (`/projects`, `/resume`, `/tools`, `/blog`, `/chat`, `/resources`) were reachable only from a link inside each band. Every entry except Index now ends in the same zig-zag FULL tab, in the desktop rail (shown while the rail is open) and the phone drawer. The tab is one component, `ui/FullTab.tsx`, styled once as `.full-tab` in `global.css`; the roster's copy moved there too. The rail's `00`–`06` index is gone, and with it `NavItem.index` (§4.1).
>
> **v0.24.0**: the deck and the work band, rebuilt around three new projects.
>
> - **Three projects joined the collection**: Railtracks (`order: 5`), NewsRing (15) and EvalRing (40), each with a page. Railtracks' cover is a still of its own deck exhibit; NewsRing's is the live `today.png` NewsRing redraws every morning, so the card changes daily with no rebuild.
> - **The deck is seven frames**: Railtracks, Particle Wave, NewsRing, gs_prompt_manager, FeatherRing, then the Systems and Research reserved slots. The Evaluation slot is gone, since EvalRing now covers that area in the gallery. Railtracks is frame one, so it is also the landing exhibit (§6.1, "The frames").
> - **The scroll walks the deck** from `lg`: past the handoff, each frame holds for 42vh of scroll, and clicks, keys and the rail arrows scroll to a frame rather than set it (§6.1, "Switching").
> - **Railtracks** draws an endless agent run (`deck/stages/agent-flow.ts`): tools branch straight off a lane, subagents fork on a diagonal in their own colour and merge back, each run accelerates, and hover pauses it and names what is under the cursor. **NewsRing** draws the morning's selection on a dial of its 35 sources with today's headlines in the middle, fetched live (`deck/stages/news-dial.ts`).
> - **Cutting to Particle Wave from either of them is a morph**: the outgoing picture is read back as points and the engine starts on them, then pulls them into the corona (`deck/seed.ts`). Superseded in v0.26.0 by a morph between any two of the three.
> - **The work band shows six cards**, pinned, and deals the second three onto the first as it scrolls (`ui/WorkStack.astro`, §3).
>
> **v0.23.0**: the Token Counter reads LiteLLM's price list from its source on every visit (GitHub, then jsDelivr's mirror, then the curated shortlist), instead of a snapshot committed to `public/data/`. Prices change daily upstream, and the snapshot was seven weeks old. The generator script, the snapshot and `npm run pricing:refresh` are gone; the trimming they did now happens in the tab (§12.2, §12.3 rule 2).
>
> **v0.22.0**: the tools roster links each tool's full page from its own row. Reaching a tool's page meant selecting it in the roster and then finding the button at the foot of its stage. Each row now ends in a small FULL tab whose slanted edge alternates by row, so the tabs draw a zig-zag down the roster; hovering or focusing one widens it over the name to "Visit the full page". The per-row `01`–`05` index is gone, since the counter under the roster already shows it (§12.2).
>
> **v0.21.0** — a twelfth tool, the **Run Viewer** (`/tools/run-viewer`, §12.6). It opens a Railtracks run log and draws it with Railtracks' own visualizer, which is not bundled: it is fetched from npm through esm.sh on every visit, at a version the visitor picks, so a visualizer release appears here with no rebuild. Picking a Railtracks version selects the visualizer that release would have downloaded (by date). Both log formats open: session files as written, and event streams (`events/*.jsonl`, the current default) rebuilt into runs by `lib/railtracks/runs.ts`. A whole folder can be opened and, in Chromium, watched with `FileSystemObserver`, so new runs appear and a run in progress redraws as it grows. The visualizer runs in a sandboxed, opaque-origin frame (`public/frames/railtracks-visualizer.html`), and a **Site** style recolours it from the page's own tokens. The Railtracks post links to it.
>
> **v0.20.0** — the posts band scales, and every post has a colour. The band featured the newest post and put every other one in a strip below, so each new post made it taller or the strip longer. It is now two halves: the **presented** post on the left (category, date, title and summary over its cover, all links to the post, with a yellow corner chip on the cover) and the **wheel** on the right, a column of the newest eight covers on the rim of a wheel that bulges toward the presented side. The presented post has been taken out of the wheel at the **seam**, marked by a yellow pointer: as the wheel turns, the cover reaching the seam slides out toward the presented side and fades, its neighbours close over the gap, and the presented side swaps to it. The wheel is virtual, not a scrolling box: one unbounded position in posts, every cover placed by its distance around a ring of repeated sets, so it has no ends. Mouse wheel and trackpad (a notch per post, settling on the nearest), drag with a short glide, arrows, arrow keys and clicks all move it; it takes the scroll while the pointer is over it. "All N posts" moved into the heading like every other band's onward link, and the "Read post" button is gone. Below `md` it is a scroll-snap row with titles under the covers.
>
> **Post tints** (`lib/post-tint.ts`). Each post's hue is hashed from its title, in OKLCH at one lightness and chroma so no post is brighter than another, with orange through yellow-green left out so a tint never competes with the hazard yellow. A hue too close to one of the three posts published before it steps around by the golden angle; posts are assigned oldest first, so a new post never recolours an old one. `PostCover` screens three soft pools of the hue and its neighbours over the cover's dark ground, the way the backdrop draws its aurora, so each cover reads as a dim light on a dark wall. The same hue is the supporting colour around the cover: the category line, the presented cover's edge and glow, and the wheel card's number tab.
>
> A second post, introducing Railtracks, joined the collection with its own 1200×630 cover in the first post's template.
>
> **v0.19.0** — a second polish pass, from review feedback.
>
> - **One yellow for marks.** Light mode used the olive `--c-accent` for bars, borders and strokes as well as text, so the rail's marker was bright yellow while the Myself bar beside it was brown. Every non-text use (fills, bars, borders, strokes, rings) now uses `--c-accent-fill`; olive stays for **text** (legibility) and for **focus** borders and rings, because a yellow focus indicator on white fails visibility (§5.2).
> - **Myself.** Agent systems now leads with 20 agents in production, Railtracks as the first agentic framework in Canada, and 5+ years. "Systems and hardware" became **Background**: the UofT MScAC (AI) and UBC Computer Engineering, with each school's mark, and the top-1% standing. A proof row leads with a figure _or_ a logo; logos are single-colour SVGs in `public/media/logos/`, drawn through a CSS mask in the text colour, with their aspect ratio read from the file's `viewBox` at build time. The credit line is optional.
> - **Dark surfaces.** `--c-surface` #131315 → #1b1b1e, `--c-raised` #1c1c1f → #242428, `--c-line` #2a2a2e → #303035, so panels (the tools kit, the chat) read as objects on the floor rather than holes in it. The floor grid's `--grid-alpha` dropped from 1 to 0.5.
> - **The veil** (§4.2) has a contour-line field, a percentage counter driven by real milestones, a 0.88s floor and a 720ms fade. It was never blocked: measured live, a cold first visit showed it for about 0.8s, and only once per session. A reload now counts as a new arrival and shows it again.
> - **Tools band.** The heading moved into the pinned screen (as Myself's did), the stage height follows the viewport (`clamp(35rem, 100dvh - 19rem, 54rem)`), the roster dropped its subtitles for a per-tool icon (`components/tools/ToolIcon.tsx`, also on `/tools`), and a yellow "All N tools" button sits under the roster. `--shell-max` went from 88rem to 100rem so the kit uses a large monitor; every band widens together so headings stay aligned.
> - **Rail links land on the band.** `html { scroll-padding-top: 5rem }` applied on desktop, where there is no top bar, and sections stacked their own margin on it, so a rail click stopped 80px short. Padding is now 3.5rem (the phone bar) and 0 from lg, and same-page section links re-check their landing after the smooth scroll ends, correcting once if a hydrating island moved the target (`Sidebar.astro`, `initSectionLinks`).
> - **Posts are a band** (§3), after Tools, with a rail entry; they left the notes list. See `components/posts/PostsBand.astro`.
>
> **v0.18.0** — Myself is a glance, and onward links look like controls. The Myself band carried two and three resume bullets per capability, each four lines long, with the role and company repeated row after row. Each capability is now one sentence, and its evidence is two or three proof rows: a figure in the display face (`90%`, `0.85`, `93%`), one line, and a mono credit built from the collection (`role · shortName · years`). The capabilities became an accordion with all three names on screen, replacing the unlabelled bars, and the heading moved inside the pinned screen so the band is centred as one composition instead of opening on a 180px gap (§6.3). Experience entries gained an optional `shortName`.
>
> Onward links ("All projects", "Full resume", "All tools") were 12px mono in the muted colour, and project cards signalled "open me" only with a faint 15px corner arrow. Section links are now `.cta-outline`, the deck's "Open blueprint" shape in the text colour; cards end in a labelled "Open blueprint" row; the deck's "All projects" and the notes list got real-size arrows. The primary `Button` referenced two tokens that never existed (`--c-accent-contrast`, `accent-hover`), so the 404 page's main button was white on yellow; it now uses the accent-fill pair.
>
> **v0.17.0** — the tools band runs the tools. Three of the five stages were
> canned screens with invented numbers, a stale model list and paragraphs
> nobody reads, and MCP claimed a stdio transport a browser cannot open. Each
> stage is now an input or a sample on the left and a readout on the right:
>
> - **Token Counter** runs `lib/tokens` live: the estimate as a hero figure,
>   where the tokens come from (the estimator's own per-class charges, now
>   exported as `tokenBreakdown`), and the share of 32K, 200K and 1M windows.
> - **String Kit** runs `lib/string-kit` live: text stats under the input, and
>   Case and Encode groups with a copy button per row.
> - **Rest Reminder** keeps its dial, adds a two-hour strip of focus and break
>   blocks with a now marker, and the clock times of the next break and return.
>   Times exist only after mount, so hydration never sees a server clock.
> - **MCP Tester** shows one labelled sample run as the tool reports it: its
>   own check names with pass/warn icons, and the selected check's request or
>   response in the 2026-07-28 shape (`server/discover`, `_meta`, Streamable
>   HTTP).
>
> Every stage has one height from lg (`lg:h-[35rem]` on the panel), so switching
> tools never resizes the panel; it must be a utility on the element, because
> the panel is a flex item and `flex-1` overrode a `height` set in the
> components layer. The kit also stretches to the band's width: the pinned band
> is a column flexbox, and `align-items: start` had shrunk it to its content,
> which left the right side empty and let typing change its width. Stage ids
> use React's `useId`, and `OpenTool` is the one shared footer.
> `components/tools/showcase.ts` is no longer imported by anything.
>
> Display-face spacing moved to two tokens, `--display-tracking` (-0.03em) and
> `--display-word-gap` (0.14em), used by `.display`, post `h2`s and the deck's
> ghost type. At the old -0.005em the 118%-wide letters drifted apart and word
> gaps read as one more letter.
>
> **v0.16.0** — charts in posts. A post written as MDX imports figure
> components from `src/components/posts/`. `Figure` is the frame (a sentence
> title, the chart, a legend row, a caption and a collapsed data table, which
> is the chart's accessible twin); `LegendKey` and `StatRow` are shared parts.
> A post can name a full-width `header` graphic, resolved by explicit branch
> in `PostHeader.astro`. Charts follow the emphasis form: the one series that
> matters in `--c-accent`, context in the new `--c-viz-context` token. That
> token exists because `--c-text-faint` sits too close to the olive accent on
> light ground (OKLab ΔE 14.9, under the normal-vision floor of 15); `#9c9c9c`
> clears it (ΔE 18.6) and dark keeps `#6e6e75` (ΔE 47). It is under 3:1 on the
> light ground, so every chart that uses it carries direct labels and a data
> table. Charts are HTML and CSS rather than one scaled SVG, so text stays at
> real sizes on a phone; the header draws its lines in a stretched SVG with
> HTML labels over it. No chart ships JavaScript: hover detail is a native
> `title` on each mark, and the data table carries every value.
>
> **v0.15.0** — a blog. Posts are a fourth content collection (`posts`,
> plain Markdown) rendered at `/blog/[slug]` with the project page's grammar: a
> back link, a marked eyebrow carrying the date and reading time, a display
> title and a one-sentence lede, then `.post-prose` at the reading measure with
> a sticky rail (published, length, tags, and a contents list built from the
> post's `##` headings). Tables carry most of a results post, so
> `scripts/rehype-table-scroll.mjs` wraps each one in a scroller and keeps
> short cells on one line. Posts lead `/resources` and join the notes band on
> the home page, newest first, so the rail stays at six entries (§3). Article
> pages emit `og:type=article` with their dates and tags.
>
> **v0.14.0** — one nav entry has one destination, and the contact links on
> the title card read as controls.
>
> **The rail points at the home bands, from every page.** A nav entry used to
> resolve to `#tools` on the home page and to `/tools` anywhere else, so the
> same word in the same place went to two different designs depending on where
> it was clicked. Every entry that has a matching band now links to
> `/#band` (§3, §4.1). The dedicated pages keep their routes and are reached
> from each band's own "all tools" / "full resume" link.
>
> That link only works if the page lands where it points, and two things on
> this site stopped it: the veil holds `overflow: hidden` on the root for up to
> seven seconds, which clamps a fragment scroll to the top, and
> `scroll-behavior: smooth` turns the landing into a full-page animation that
> every `client:visible` island it passes re-targets underneath it.
> `HashLanding` lands instantly instead, re-lands while the page is still
> settling, and stands down the moment the visitor scrolls for themselves. The
> veil now fires `coronring:veil-lifted` so it knows when the scrollport is
> free.
>
> **The title card's three contact links are chips**, in the accent colour with
> their marks, inverting to the accent fill on hover the way the contact band at
> the foot of the page does (§6.1). Set in the body colour as plain words they
> read as the tail of the sentence above them, which is a poor showing for the
> only route to a person on the first screen. `ui/Icon.tsx` is a React renderer
> over the same path registry as `Icon.astro`, since the deck is an island and
> cannot mount the Astro one.
>
> **v0.13.0** — the handoff latches instead of scrubbing, and the deploy
> workflow moves off Node 20.
>
> Metering the transition against the scroll meant paying for it a wheel notch
> at a time: the name arrived in pieces and it took three or four scrolls to
> finish. It is now a **latch**. Crossing 90px into the section flips `--deck-t`
> to 1 and a CSS `transition` runs the whole thing on its own 620ms; coming back
> above 36px flips it to 0 and CSS runs it backwards. The gap between the two
> thresholds is deliberate: equal ones put a visitor resting on the line into a
> loop. The pin drops from 168vh to 133vh, because the dwell no longer has a
> transition to pay for and the rest was scroll that did nothing.
>
> Every action in `deploy.yml` moves to a major that runs on Node 24, and the
> build itself to Node 22. Two breaking changes in those majors were checked
> and do not apply here (§14).
>
> **v0.12.0** — the landing page's two states become one interpolation, and the
> exhibit stops being hidden by the type on top of it.
>
> **One number drives the handoff.** Every difference between the two states is
> interpolated off `--deck-t` in CSS. There is one masthead rather than two: it
> is laid out where it ends up and the landing position is a transform, so the
> name travels and shrinks into place instead of one copy fading out while
> another fades in. Scrolling past the deck no longer strands a visitor in a
> state they cannot leave.
>
> **The exhibit is inset beside the copy column** rather than running full bleed
> underneath it (§6.1). It was centred in the viewport with the copy lying
> across its left 40%; it is now held to the right and overlaps the copy column
> by 7 to 9% of the drawn cloud at every width from 1024 to 2560, which is
> enough that the two read as one composition and little enough that nothing
> legible is behind type. On a phone the masthead takes a band of its own under
> the exhibit rather than sitting on it.
>
> **The loading veil covers the load again.** It lifted on `load`, which fires
> before the deck island has hydrated, fetched its point cloud and started the
> engine, so a visitor was handed from a designed loading screen to a bare
> "Starting engine…" line — on a throttled profile, 1.4 seconds of it. A page
> that owns something heavy now passes `holdVeil`, and the veil additionally
> waits for a `coronring:exhibit-ready` event that `ParticleStage` fires on
> success **and** on failure. Ceiling raised from 2.5s to 7s while holding.
> `?veil` on the URL replays it past the once-per-session flag.
>
> Two long files are split — `RestReminder.tsx` sheds its presentational pieces
> to `rest-reminder-panels.tsx`, `ParticleWaveDemo.tsx` its parameter tables to
> `particle-wave-params.ts` — and the theme helpers the two particle surfaces
> had each copied move to `lib/particle-theme.ts`. Both canvases take
> `touch-action: pan-y` rather than `none`, which is what stopped a phone
> scrolling past them.
>
> **v0.11.0** — the landing page becomes two states, and three things that
> only looked like they worked stop pretending.
>
> The deck opens as a **title card**: a name, a job, one line, three links, and
> the exhibit edge to edge behind all of it. The first scroll of any size folds
> the introduction into two lines, slides the roster in from the left and raises
> the control strip from the bottom (§6.1). The canvas is full-bleed in both
> states and is never resized between them, so the handoff costs the engine
> nothing and the exhibit is as large as the screen allows.
>
> Changing subject is now a **morph**: the particles are paired with the points
> of the new cloud and travel there, rather than one picture being replaced by
> another. That needed new engine work, shipped as ParticleWave 1.5.0 (§7).
> `restSpin` also tracks scroll speed, so the cloud answers a visitor who never
> touches it.
>
> Three bugs, all of which the old code hid rather than fixed. **Every section
> title on the site was invisible to its own scroll observer** — `clip-path:
inset(0 100% 0 0)` collapses an element's intersection rect to zero width, and
> the 2-second "reveal everything" safety net was covering for it while also
> cancelling every below-fold entrance on the page. The **ambient dust** in all
> three clouds was sampled over a square, and the renderer spins the cloud, so
> what a visitor saw was a rotating rectangle of noise; it is a soft-edged disc
> now, which has no orientation. And the deck's copy column, lying on the
> canvas, was **swallowing every click** aimed at the controls underneath it.
>
> The tools band stops being ten identical cards and becomes an instrument with
> a roster and a screen that plays the selected tool (§12.2). "What I actually
> do" becomes **Myself**: three capabilities that advance as the band scrolls
> past, each showing the roles that are the evidence for it. And the corner
> assistant becomes **CoronChat** — the site's own mark, animated, with a line
> under it naming the band the visitor is reading and a question to match
> (§6.2).
>
> **v0.10.0** — a text cut and a performance fix. The deck's readout loses
> everything that was not a name, a project or a link. Rail tokens gain the
> project's name, because a sigil orients but does not identify. The Look
> presets drop trails (§6.1), which is what made the Fire preset lag: the
> engine submits `particles x trailLength` antialiased segments per frame and
> rasterising them dominated. The assistant becomes a band on the home page
> rather than only a page of its own, and nudges once per session. Resources
> moves last. `Read the blueprints` goes back to cards.
>
> **v0.9.0** — the home page becomes **the deck**: one full-height instrument
> that cuts between six frames, replacing both the hero and the "Selected work"
> band. The three demo islands are rewritten as _stages_ with at most three
> controls each, the twenty-slider Particle Wave panel moves to the project
> page, and the deck's roster is extended to six with three reserved slots. Two
> new parametric point clouds ship so the particle stage has something to cut
> to. §6.1 is new and covers the whole surface; §3, §6 and §7.2 are rewritten;
> `OperatorShowcase` is deleted.
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
/                    00  Index      The deck, then four quieter bands
/projects            01  Projects   Card gallery with generated cover art
/projects/[slug]         Detail: live demo above the write-up
/resume              02  Resume     One timeline, four sections
/resources           03  Resources  Categorised link list, posts first
/blog                    Blog       Every post, newest first (reached from Resources and the notes band)
/blog/[slug]             Post: masthead, prose, sticky rail with contents
/tools               04  Tools      Instruments for language-model work
/tools/[slug]            Individual tool: instrument above, write-up below
/404                     Not found
```

The home page flow, as of v0.11.0:

```
#top        The deck — a title card, then seven frames, walked by the scroll  (§6.1)
#work       Selected work — six cards, the second three dealt onto the first
#resume     Myself — three capabilities, scroll-advanced, with proof
#tools      The dev kit — a roster and a screen that plays one tool    (§12.2)
#posts      Writing — a presented post and a wheel of the newest eight
            Contact, over a decorative instance of the corona
#ask        The assistant                                             (§6.2)
#resources  Notes and references, last
```

`#top` is both the introduction and the work. The band that used to sit between
them is gone.

`#work` shows the first six projects by `order`, in two rows of three
(`components/ui/WorkStack.astro`). From `lg`, with motion allowed, the band is
230vh with its screen pinned and both rows in one grid cell: scrolling deals
the second row up from below the screen, one column after another (staggered
by 16% of the band's scroll), each card tipped back as it rises and flat when
it lands on the card in its column. The card beneath lifts 1.75rem, shrinks 6%
and darkens, so its top edge shows behind the new one like the print under a
print. A card in flight is not clickable, so a click goes to the visible one;
tabbing onto a covered card scrolls the band back until it is on top. Below
`lg` or under reduced motion the rows dissolve into one ordinary grid.

Every nav entry with a band of its own points at `/#band`, from every page, so
one entry has one destination. The routes above still exist and hold the full
lists; they are reached from the band, not from the rail.

`#ask` exists because the one part of the site that answers questions was the
one part a visitor had to navigate away to reach. `/chat` still exists for
direct links and renders the same component.

---

## 4. Shell architecture

### 4.1 The rail

A fixed left sidebar (`--rail-w`, 4.5rem of icons, widening over the page to `--rail-w-open`, 16rem, on hover or keyboard focus) replaces the horizontal header. It
buys three things a top bar could not: navigation stays visible through a
full-height hero, the content column gets an asymmetric left edge to sit
against, and the active item can take a left border rather than an underline.

Content is offset by `.rail-offset` — a CSS padding, not a flex sibling — so
page markup stays independent of the shell. Below `lg` the rail collapses to a
top bar plus a focus-trapped drawer, rendered from the same `SITE.nav` source.

The rail also holds the site's **single persistent call to action**, which is
why the home page needs only one button and the footer needs none.

**Its destinations are the home page's bands**, not the dedicated pages: an
entry resolving to `#tools` on the home page and to `/tools` elsewhere meant
the same word in the same place led to two different designs. On the home page
the rail still scroll-spies those ids, so a `/#tools` entry that is already
home behaves as an in-page anchor.

**The dedicated page is the row's FULL tab** (`components/ui/FullTab.tsx`, styled as `.full-tab` in `global.css`), the same tab the tools roster uses (§12.2). Every entry with a band and a page of its own gets one at the trailing end of its row, in the rail and in the phone drawer. Index has no page beyond the home page, so it has no tab, and the slants count tabbed rows only so the zig-zag stays unbroken. In the collapsed rail a tab would cover the icon, so the rail's tabs fade in with the labels and take no clicks until the rail is open. Each host sizes its tabs through `--full-tab-w`, `--full-tab-slant` and `--full-tab-open-from`; the rail and drawer pick a slant short enough that the open tab covers the label without fading it. The rail rows no longer show a `00`–`06` index, and `NavItem` has no `index` field (the 404 page numbers its list by position).

A fragment that is present at load needs help on this site, which is
`HashLanding.astro`, mounted last in the body by `BaseLayout` so every section
is parsed before it runs:

- The veil holds `overflow: hidden` on the root while it is up, and on the home
  page it holds it until the exhibit reports in. A locked scrollport clamps the
  fragment scroll to zero, so the visitor lands at the top having asked for a
  band halfway down. `Veil.astro` fires `coronring:veil-lifted` on its way out.
- `scroll-behavior: smooth` turns the landing into an animation that starts at
  the top and travels the whole page, tripping every `client:visible` island and
  `Reveal` observer on the way; each one that settles at a different height
  re-targets the animation underneath it.

So it lands instantly rather than smoothly, keeps re-landing for 1.2s after the
scrollport is free (12s hard ceiling), and stands down on the first wheel, touch
or key from the visitor. Input arriving while the veil is still up is not that
signal, since nothing can move behind the curtain. An in-page anchor click is
untouched and still scrolls smoothly.

### 4.2 The contrast veil

A loading screen in the _opposite_ tone to the active theme: dark theme opens
through a light veil, light theme through a dark one (`--veil-bg` / `--veil-fg`
flip with the palette). The reveal is a deliberate curtain rather than a fade-in
from the page's own background.

What is on it: a dim survey-map field of contour lines (`public/media/veil/contours.svg`, drawn by `scripts/generate-veil-contours.mjs` and used as a CSS mask, so one file serves both tones and is fetched only while the veil shows); a percentage counter top-left beside a yellow bar; the mark and wordmark right of centre over a long hairline that fills with the same percentage, and a slogan under it. The counter's numerals are `--veil-accent`: yellow on the dark veil, ink on the light one.

The percentage is real progress, not a timer. It eases toward a target that moves at each milestone (HTML parsed 45, `load` 78 or 100, exhibit ready 100), creeps slowly while it waits, and never passes 92 until everything has reported in.

Four behaviours stop it becoming an annoyance:

1. **Fails open.** `hidden` in markup; only unhidden by the pre-paint script.
2. **Once per arrival.** This is an MPA, and veiling every navigation would be intolerable. A `sessionStorage` flag limits it to the first view of a visit; a **reload** counts as a new arrival (read from the Navigation Timing entry's `type`) and shows it again. `?veil` on the URL forces it.
3. **Floor and ceiling.** A 0.88 s floor lets the counter run visibly instead of strobing on a warm cache (with the 720 ms fade, a warm load is on screen about 1.7 s); a ceiling (2.5 s, or 7 s while waiting on an exhibit) guarantees it lifts even if nothing ever reports in.
4. **Reduced motion skips it entirely.**

#### What it waits for

`load` alone is not enough. It fires when the document's subresources are done,
which on the home page is well before the deck island has hydrated, fetched its
point cloud and started the engine — so the veil lifted onto a bare "Starting
engine…" line, which is the opposite of what a loading screen is for. Measured
at 4x CPU on a 1.6 Mbps line: veil gone at 3.9 s, engine ready at 5.3 s.

A page that owns something heavy passes `holdVeil` to `BaseLayout`, and the veil
then also waits for a `coronring:exhibit-ready` event on `window`.
`ParticleStage` fires it on failure as well as on success: a veil that outlives
a broken engine is worse than no veil, and the message underneath says what went
wrong. Holding raises the ceiling from 2.5 s to 7 s.

The hold is a **prop, not something the script looks for in the document**. The
decision has to be made synchronously, when the inline script runs, and a slow
load is exactly the case this exists for — on one, nothing below the veil in the
body has been parsed yet. A version that queried the page for a marker hit its
own 2.5 s ceiling before it ever discovered it should have been waiting, which
is a bug that only appears on the connections that need the fix.

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

**The accent splits into two tokens, by job.** Raw `#fffa00` as text on white is illegible, so light mode sets **text** in a darkened olive (`--c-accent`). Everything that is a **mark** rather than a word (fills, bars, active borders, strokes, progress) uses the pure hue (`--c-accent-fill`) in both themes, with ink on top where it carries text: the hazard-tape pairing the reference uses. Consistency of the mark across the page outranks its contrast on white. The one exception is **focus**: focus borders and rings stay on `--c-accent`, because a yellow focus indicator on a light ground is not visible enough to do its job. Dark mode uses the pure hue for all three.

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

| Surface           | Budget                                                           |
| ----------------- | ---------------------------------------------------------------- |
| Deck masthead     | A name and a job title. Nothing else                             |
| Deck readout      | Per frame: title, **one** metadata pair, one paragraph, one link |
| Deck stage        | At most **three** control groups (§6.1)                          |
| Project index     | One row per project: number, name, one line, stack, arrow        |
| Capabilities      | All names visible, **one** expanded; one sentence and ≤3 proofs  |
| Proof row         | A figure, one line, one credit. Full bullets live on `/resume`   |
| Interior masthead | Eyebrow, title, one sentence                                     |
| Footer            | A build stamp. The rail already carries sitemap, socials, CTA.   |

Long-form measure is `--prose-max: 36rem`, deliberately narrow.

The carousel is paged rather than stacked because three side-by-side prose
cards is three blocks competing for one glance. It does not auto-advance;
inactive panels are `hidden`, so they leave the tab order entirely.

---

## 6.1 The deck

`src/components/deck/`, and it is the home page.

### Two states on one continuum

**Landing.** A name, what the name does, one line, three contact chips, and the
exhibit running beside them. No roster, no controls, no counter. Someone who has been
here for one second is not choosing between six projects; they are deciding
whether to stay.

**Deck.** The introduction folds into two lines, the roster slides in from the
left, and the control strip rises from the bottom.

The handoff between them is **latched, not scrubbed**. `ProjectDeck` flips
`--deck-t` between 0 and 1 when the scroll crosses a threshold, and a
`transition` on `.deck` runs every difference between the two states off that
one number: the masthead's travel and scale, the rail's fade and slide, the
readout's opacity, the control strip's rise, the lede's fade. The scroll picks
the direction; it does not meter the animation.

Two thresholds, not one:

|       | px into the section | why                                                                                                                                                                                 |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter | 90                  | About one wheel notch. Enough that a touchpad tremor or a restored scroll position does not fire it, little enough that one deliberate scroll does.                                 |
| Exit  | 36                  | Lower than Enter on purpose. Equal thresholds put a visitor resting exactly on the line into a loop, the transition restarting in the opposite direction on every small correction. |

`--deck-t` is written straight to the element rather than held in React state,
because `data-phase` has to lag it. The layers that leave are only taken out of
the tab order once they have finished fading, so `phase` moves `intro` →
`moving` → `deck` with the middle step held for the length of the transition;
driving both from one state update would pop them out on the first frame.

The duration is written once, in the CSS `transition`, and read back in JS as
the element's resolved `transition-duration`. Reading a custom property holding
the number instead does not survive the build: it minifies `620ms` to `.62s`,
`parseFloat` returns 0.62, and the layers pop. The resolved value is always in
seconds by spec, and it picks up `prefers-reduced-motion` for free, since that
flattens every transition globally.

There is **one masthead**, not two. It is laid out where it ends up, at the top
of the copy column, and the landing position is a transform off `--deck-t`, so
the name travels and shrinks into place rather than one copy fading out as
another fades in. From `lg` the name is scaled by a transform, which composites,
and the lines under it are pushed down by exactly the height a scaled box does
not gain. Below `lg` the size itself is interpolated so the name wraps like any
heading, which costs a layout pass per frame and is affordable because the
handoff there is one transition rather than a scroll position.

The three links under the sentence are **chips, not words in a row**: accent
text on an accent tint, hairline border, each with its mark, inverting to the
solid accent fill on hover. They are the only route to a person on the first
screen, and set in the body colour they read as the tail of the sentence above
them. The tint sits over a 72% hold of the page ground with a 2px blur, because
they cross the exhibit. Hover matches the contact band at the foot of the page
(§3), so the two read as one control rather than two conventions.

From `lg` the section is several screens tall with the frame sticky. The
handoff is latched rather than metered, so the first 12vh past it buys no
animation; the rest is the scroll that walks the frames (see "Switching").

### Where the exhibit sits

The exhibit has a box of its own (`.deck-stage-art`) inset to the right of the
copy column, rather than running full bleed underneath it. The chrome — control
row, readout, ghost type — stays full bleed.

The clouds are square and drawn `fit`, so what the engine draws is the shorter
side of that box centred in it. Capping the box's width at its height keeps it
square or narrower, which pins the drawn square to the box's left edge and makes
the overlap with the copy column `--deck-art-cover` minus the engine's own
padding: **7 to 9% of the drawn cloud at every width from 1024 to 2560**. That
is the number this layout is tuned to. Enough overlap that the two read as one
composition, little enough that nothing legible is behind type.

Two consequences that had to be handled rather than admired:

- **The type is transparent to the cursor.** A caption lying beside an exhibit
  that answers the cursor cannot swallow it in the overlap, and a full-height
  copy column parked over the control row catches every click aimed at it.
  `pointer-events` is off on the copy, the masthead and the rail; only real
  controls take it back.
- **The scrim stops short of the control row.** It paints over the stage, and
  the controls live inside the stage's own stacking context, so a scrim that
  reaches them washes them out however the two are ordered.

Below `lg` there is no pin — a long pinned section on a phone is the pattern
people complain about most. Four rows stack: exhibit, masthead, roster, readout.
Nothing is set over the cloud, because a phone has no room to do that and keep
either legible. The control row becomes one thumb-height strip that scrolls
sideways (three stacked groups was four hundred pixels of panel over the middle
of the cloud), and the hint is dropped because it is about a cursor and a
right-click.

Every one of those rows names its **column** as well as its row. An item with a
definite row and an automatic column is placed by grid auto-placement, which
will not stack two of them in one cell: it opens an implicit second column and
cuts the frame in half.

### The shape

```
lg and up:   [ rail 8rem ][ copy 21–28rem ][ art: inset right, overlapping by 5vw ]
below lg:    exhibit / masthead / roster / readout
```

The art box is sized in viewport units rather than rems, so it grows with the
screen instead of sitting in a box in the middle of one.
`grid-template-columns: minmax(0, 1fr)` on the stacked layout, not `1fr`: a grid
track's default minimum is its widest child, so the control row would otherwise
set the column width and push the deck past a phone's viewport.

A stage gets at most **three** control groups. Someone who has never seen the
engine cannot tell which of twenty numbers is the interesting one, so they move
none of them; the full parameter set lives on the project page, for a reader who
has asked for it.

### The frames

Five come from the projects collection, merged with a small presentation
table in `frames.ts` that adds the two things frontmatter has no business
carrying: a stage key and a two-letter code. In order: **Railtracks**,
**Particle Wave**, **NewsRing**, gs_prompt_manager and FeatherRing. EvalRing is
in the collection and the gallery but not on the deck. Two are **reserved
slots**, Systems and Research: areas of real work with no write-up yet, marked
`reserved` on the token, on the stage and in the metadata, linking nowhere.

Adding a project to the deck is still an MDX file plus one line in the table.

**Railtracks** (`stages/RailtracksStage.tsx`, engine in `stages/agent-flow.ts`) is the landing exhibit, so the first thing on the site is an agent system working. The run reads from the top down, like a trace: a plotter head sits 74% down the box and prints what the run does next, and the paper runs upward under it, so what the run has done climbs away and fades out over the top 30%. One lane per agent, coloured by depth (`--c-flow-main`, `-sub`, `-sub2`; tools stay neutral in `--c-flow-tool`):

- a **tool call** branches straight out at a right angle to a square leaf, and a pulse runs out and back. **Parallel calls** fan two to four leaves from one point, 18 px of paper apart, and split to both sides of the main lane when both are open;
- a **subagent** forks on a diagonal into a lane of its own, runs its own tools and possibly a subagent of its own, then merges back on a diagonal; the parent waits on it, drawn dashed. The main lane hands out **one to four** at once, dealt to both sides in turn; every fork in a fan takes the same paper, so they leave from one point at 45° to the next lane and flatter to the one beyond. A fork only passes over free slots, and a lane further out waits to merge until the lanes between it and its parent have closed, so no diagonal crosses a running lane;
- the main lane carries **sleepers**, so it reads as track and the paper's movement is visible even on a quiet stretch.

**Speed only ever rises.** A run (a named flow, ending in DONE) starts at 36 px/s and doubles every 2.6 s of running, under a soft ceiling near 320 px/s. When it finishes it does not slow down: the finished run keeps its pace and pulls away upward, doubling its own speed every 0.9 s, while the next run starts slow at the head after a short stretch of quiet lane. The only thing that decelerates is the paper under the cursor.

**The cursor slows it by distance.** The distance from the cursor to the nearest line, node or label sets how freely the paper runs: none on top of anything drawn, rising smoothly to full speed 170 px away, so the far side of the box does not slow it at all. The factor multiplies the run's own speed, and the run only gathers pace while it moves. Within 16 px of an item the paper is stopped, the item's lane is lit, the others dim, and a card names the item, its kind and one line on what it did. Hold stops it outright for a visitor without a cursor.

Positions live in paper coordinates (lane slot, paper run, plus how far a finished run has pulled away) and are projected every frame, so a resize re-lays out the whole history. Two siblings finishing together would land on one spot, so the later one holds its lane until there is 20 px clear. A subagent's label drops its SUBAGENT tag where a lane runs beside it or where the full label would not fit. Labels keep out of the left 12% of the box, which lies under the copy column. Below 640px of box width it keeps to one lane either side, centred, and a label that would run off an edge goes the other way.

**NewsRing** (`stages/NewsStage.tsx`, engine in `stages/news-dial.ts`) is a dial
of the 35 sources the author's NewsRing reads (`data/newsring.ts`). It fetches
the live feed (`news_today.json`) when shown and replays that morning in the
two phases NewsRing runs: **reading**, every candidate streaming in from a
random source and most giving out on the way, with a counter in the middle;
then **selecting**, each picked story travelling in from the tick of the source it really came from (by name for the digest, by host for the top three) and leaving a yellow thread. Reading takes 2.4 s and a pick lands every 0.85 s, so a nine-story digest is in within ten seconds of the frame arriving; the full selection is then held for 12 s before the cycle starts over.

The picks arrive too fast to read one at a time in the middle of the ring, so they are also **listed in the empty top of the copy column**, between the masthead and the frame copy (`.deck-aside`, which `ProjectDeck` lends to the held stage; NewsStage portals into it). A row is a dashed placeholder carrying its source until its story lands, then flashes in. Hovering or focusing a row picks that story out: its thread and source tick are drawn strong and labelled, the rest step back, the headline is set in the middle, and the cycle holds so the list does not reset under the cursor. Without a pick in hand the middle shows the latest story to land, then, once all have, the count picked of the candidates read. The list is desktop only; on a phone the middle carries it.

The ring is sized to read as large as the other exhibits: it takes 45% of the box width and runs under the translucent control row rather than stopping above it. "My digest" and "Top 3" switch between the personal stories and the card's. If the feed cannot be fetched the dial still runs and the middle says so; it never invents a headline.

### Morphing between drawn exhibits

Any cut between two of Railtracks, Particle Wave and NewsRing is a morph, in either direction: the outgoing picture comes apart into particles and they reform as the incoming one. The deck runs it itself (`morph.ts`) on a canvas laid over the stage, rather than asking the particle engine to, because the engine's own morph has no curve that starts slow and finishes fast and cannot carry the outgoing picture's colours.

Each drawn stage registers a **snapshot** with the deck that reads its shape canvas back as points with their colours (`seed.ts`: a 1.6–2.5 px grid, alpha over a threshold, jittered inside each cell, a few thousand points). Particle Wave reads its engine canvas the same way. On the cut the deck reads the outgoing picture before the stage unmounts, mounts the incoming stage hidden (`data-entering`) and inactive, and polls its snapshot until it has drawn a first frame (Particle Wave runs a further 240 ms before holding, so the engine has a frame on its canvas). Then:

- **Pairing.** Both clouds are ranked along a Hilbert curve and paired by rank, as the engine's own morph does, so neighbours stay neighbours. Where counts differ, particles share a start (a line splits) or an end (several converge); none appears or vanishes mid-flight. At most 7,000 particles.
- **Motion.** Each particle leaves at its own moment within the first 34% of 2.6 s, then follows a smoothstep of `p^1.6`: it eases out of the old picture, is fastest late in its journey and settles without a long tail. Paths bow slightly across their direction, so the field reads as currents.
- **Colour** runs behind the position: a particle keeps the colour it was read with (a yellow lane stays yellow) into its flight and fades to the incoming picture's colour as it arrives, on light and dark alike.
- **Hand-off.** The outgoing picture, labels included, is drawn over the particles and fades in the first 380 ms. When the last particle lands, the stage fades up underneath at the picture they just drew and starts running, and the morph canvas fades off it over 420 ms.

A cut that arrives mid-morph starts the next morph from wherever the particles are. If the incoming exhibit has not drawn within 2.5 s the deck cuts without a morph. Reduced motion cuts without one. Type is never sampled: text turned into particles reads as noise.

### Switching

**The scroll walks the deck** from `lg`. The section is `100vh + 12vh +
frames × 42vh` tall with the frame pinned: the first 12vh is the handoff, and
after it each frame holds for an equal share of what is left, the way the
Myself and Tools bands step through their entries. A click, an arrow key or a
rail arrow *scrolls* to the middle of that frame's share rather than setting
the frame, with an instant jump, so the scroll position and the held frame can
never disagree; inside a pinned screen the jump is invisible except as the cut.
A 2px accent line down the rail's right edge fills with the progress
(`--deck-p`). Below `lg` nothing is pinned and the controls set the frame
directly. Seven tokens and two arrows fit the rail down to a 768px-tall screen
because the token disc and the gap between tokens are sized in `dvh`.

Seven tokens are on screen at all times, each carrying a hand-set stroke sigil
rather than a number, so a visitor aims rather than reads. The rail is a
`tablist` and the stage its `tabpanel`, which is where the arrow keys, the
roving `tabindex` and `aria-selected` come from. Prev/next arrows and the
chevron strip do the same job for a pointer.

Only the active stage is mounted. Seven live exhibits stacked behind one another
is seven animation loops for one visible picture; a re-mount costs one cached
fetch. Every stage takes an `active` prop and pauses when the deck scrolls
away or the tab is hidden.

The cut is covered by `.deck-scan`, a bright band that crosses the stage once,
and the readout re-enters on a staggered wipe. Both replay because the elements
are keyed on the frame id.

### What the readout says, and what it stopped saying

v0.9.0's readout carried a byline with a location, a sentence of positioning, a
status block naming the deck's own mechanics (`LIVE · SIX FRAMES · ONE EXHIBIT
EACH`), a kicker, a title, two metadata pairs, a paragraph and two links. All of
it sat in front of the one thing on the screen worth looking at.

What is left:

```
GUAN HUANG
Applied ML Engineer

Building ───────────────── 01 / 06
[ PARTICLE WAVE ]
▬▬▬
[STACK] TypeScript · Canvas · Python
one sentence
→ Open blueprint   All projects
```

The status pair went because "In progress · 2026 – present" is already on the
card in `#work` and on the project page, and neither of those is competing with
a live canvas for attention.

### Names on the rail

The reference identifies each operator by a portrait, and a portrait is
self-explanatory in a way a project mark is not: nobody reads a stroke glyph and
thinks "prompt templating library". So the token carries the sigil _and_ the
name, and the rail is wide enough (`8rem`) to hold both. The hover tooltip that
used to carry the name is gone — a label you have to hover for is a label most
visitors never see.

### Three controls, maximum

Enforced by convention, argued for in `StageShell.tsx`. Two shapes only —
`Segment` for a setting, `Chips` for a choice of material — so every exhibit
reads the same way although no two do the same thing.

| Stage    | Controls                                   |
| -------- | ------------------------------------------ |
| Particle | Subject (3 clouds + upload) · Field · Look |
| Agent    | Pipeline · Run                             |
| Prompt   | Template · View                            |
| Reserved | None. It is a bench with nothing on it.    |

`Look` is a **preset**, not a parameter: colour mode, palette and trail length
move together, because "aurora with no trails" is not a distinction anyone
standing in front of the page for four seconds cares about.

The full Particle Wave parameter panel is unchanged and still lives on
`/projects/particle-wave` (§7.5). This is the trailer; that is the manual.

### Why no preset uses trails

Reported as "when I switch to fire, it lags a lot", and it did: 133 ms per frame
against 24 ms for the same cloud on the plain preset, measured in a real browser
with the conditions interleaved so drift cancelled.

The cause is not the palette. The engine's trail pass submits
`particleCount x trailLength` antialiased line segments every frame — 29,155 of
them for the 5,831-point corona at `trailLength: 5` — and rasterising them is
the frame. A CPU profile puts 82% of the time outside JavaScript, and
instrumenting the canvas confirms the segment count tracks the frame time across
presets.

Almost none of that geometry is visible. A cloud turning at rest moves each
particle a fraction of a pixel per frame, so its "tail" is shorter than the
particle is wide.

Both halves are fixed in ParticleWave 1.5.0 — the draw calls are batched, and
trails are gated on real movement and held to a budget — and 1.5.0 also batches
the _head_ pass the same way, which is where a palette cloud spent 6,000 string
allocations and 6,000 fills a frame. The presets here stay built from what is
free at this cloud size regardless: the ramp, what it is mapped to, and the
radius. `charge` maps the ramp to _speed_, so the cloud changes colour under the
cursor. All four presets run at 60 fps in both themes.

### Changing subject is a morph

As of ParticleWave 1.5.0 the stage no longer tears the instance down and builds
another one. `morphTo` pairs the live particles with the points of the new cloud
along a shared Hilbert curve and interpolates their rest positions across; the
spring they are already under chases the result, and the lag of that chase is
what makes the corona look like it is being pulled into the orrery rather than
crossfaded into it.

The instance is built with `capacity: 8200`, which covers the largest of the
three clouds (7,815) and leaves room for an upload. Spare slots are real
particles at zero alpha parked inside the cloud, so growing into a denser subject
has them emerging from the visible material instead of flying in from a corner;
shrinking lets the surplus dissolve in flight. Verified by walking the full cycle
and reading the point count back: 6,191 → 7,815 → 7,093 → 6,191.

One trap worth recording. The effect that fires the morph originally skipped
whenever the new subject matched the _initial_ key, which quietly made every
return to the corona a no-op. It has to compare against what the engine is
holding **now**, not what it was built on.

### The cloud answers the scroll

`restSpin` tracks how fast the page is moving: a decaying accumulator read once
a frame, so a wheel notch spins the cloud up and it coasts back down. The loop
only runs while there is something left to decay, so a page nobody is scrolling
costs nothing, and `prefers-reduced-motion` suppresses it entirely.

### The dust is a disc, not a square

All three clouds sampled their ambient dust over the unit square. The renderer
spins the cloud, a square has corners, and the corners sweep — so what a visitor
actually saw was a rotating rectangle of noise with a logo inside it.

`scripts/generate-cloud.mjs` now has one `dust()` helper for all three shapes:
uniform by area over a disc, with the point weight tapered to zero across the
outer band so the disc's own rim is invisible too. A rotationally symmetric field
looks identical at every angle, which leaves the individual particles as the only
thing moving — which is the only thing that should be. `padding` also drops from
0.08 to 0.015, so the cloud reaches the top and bottom of the frame.

### The ghost type

The site's statement is the `h1`, set behind the exhibit at `clamp(2.25rem,
7vw, 8.5rem)` with a hatched fill clipped to the glyphs and a faint outline
stroke. It is real text at a real size, not a decorative image — it just is not competing with the frame title for the same slot. `--deck-ghost-alpha` differs per theme: hatched ink on paper carries more weight than hatched paper on ink.

It belongs to the landing card: it fades out with the lede as the deck opens (`--deck-t`) and is hidden once the deck has landed, so no exhibit is drawn over it. For the same reason of hierarchy, the set name in the deck state steps 26% toward the ground colour, so it reads as the page's signature rather than as a second heading above the frame title.

### Motion

`opacity`, `transform`, `clip-path` and `stroke-dashoffset` only, so nothing
touches layout. The agent graph's flow is `stroke-dashoffset` and its node
rings are `transform`; the only stateful thing in that stage is the step
pointer, which moves every 2.6 s. The version this replaced drove a 32-bar
visualiser from `requestAnimationFrame` through `setState`, re-rendering the
island sixty times a second to animate noise.

Nothing is communicated by motion alone: the held frame is marked by colour,
weight and the counter as well, so `prefers-reduced-motion` costs nothing.

---

## 6.2 The assistant, in the page

The assistant was only ever a corner dock and a page at `/chat`. That put the
one surface on the site that answers questions behind a navigation, and left the
dock — a small button labelled "Ask" — as the only invitation.

Two changes.

**A band on the home page.** `#ask` renders the same `ChatPage` component as
`/chat`, so there is one assistant with two mounts rather than two variants.
`client:visible`, so it costs nothing until it is scrolled to.

**The dock nudges, once.** After 14 s the dock opens itself and puts a real
question on screen — not "how can I help", an actual question about this site,
one click from being sent. Three rules keep that from being the thing everyone
hates:

1. **Once a session.** A `sessionStorage` flag, set the moment it fires, so it
   does not reappear on the next page of an MPA.
2. **It leaves on its own.** Fifteen seconds with no interaction and it
   withdraws. Only when it opened itself; a panel the visitor opened stays open.
3. **Never over the real thing.** While `#ask` is on screen the dock hides
   entirely rather than floating a second copy of itself over the first.

`prefers-reduced-motion` suppresses the nudge altogether: an interface that
moves on its own is exactly what that setting is asking us not to do.

The page's own prose was cut with it. Two paragraphs explaining that the corpus
is small enough to answer without retrieval were true, interesting to the person
who built it, and in front of the box the visitor came to type in.

---

## 6.2.1 CoronChat

The corner dock is `src/components/chat/ChatDock.tsx`, and as of v0.11.0 it has
a name, a mark and a subject.

A round icon in the corner reads as "contact us", and nobody presses it. This
one is a panel carrying the site's own logo, the name **CoronChat**, and a line
saying what it is currently looking at — which changes as the visitor scrolls,
because the assistant answers from the pages and therefore knows which one is on
screen. The question it offers when it nudges changes with it, so pressing it at
the tools band asks about tools. That is the difference between a widget and a
guide, and it is the half of this site that is about the work rather than a
record of it.

`components/chat/mood.ts` holds the mapping, keyed by the same section ids the
rail scroll-spies; a page with none of them falls back. One
`IntersectionObserver` over all of them picks the section nearest the middle of
the viewport, so a short band between two long ones still gets its turn.

`components/chat/Crown.tsx` draws the mark: the ring broken on the right with
the bar through the gap (§5), plus three rays that make the corona a corona
rather than a letter. Everything moves off one custom property, `--crown-energy`,
which the dock sets from the current band, so the change is interpolated rather
than switched.

**The mark has to be a mark on every frame.** The first pass scaled the rays and
drew the bar on a dash offset, which meant that at most moments a third of the
logo was missing and what was left read as a squiggle — and `transform-box:
fill-box` on a straight path is degenerate, because a vertical line has a
zero-width fill box. So the ring and the bar are always fully drawn, the rays
vary in opacity but never below half, and the only thing that actually moves is
the core.

The nudge itself is unchanged from v0.10.0 and still verified end to end: no
panel at 3 s, opens itself at 16 s with the band's own question, withdrawn by
33 s, no second nudge after a reload in the same session, and stood down
entirely while `#ask` is on screen.

---

## 6.3 Myself

`src/components/resume/Capabilities.tsx`. Three things I do, and for each of them the proof. It is the glance, not the resume: `/resume` carries every bullet in full, so nothing here runs past a line or two.

**One sentence per capability, two or three proofs each.** A proof is a figure set in the display face (`90%`, `1st`, `0.85`), one line saying what it measures, and a mono credit (`Applied ML Engineer · Railtown AI · 2023–2025`). The figure and line are written in the page, condensed from an experience highlight; the credit is built from the entry the proof names, using the entry's optional `shortName` so it fits on one line. Feedback on the previous version was that the band was too much text: it showed full resume bullets, four lines each, with the role and company repeated on every row.

**All three names stay on screen.** The capabilities are an accordion: every title is visible, the active one is in the text colour with its sentence and tags expanded under it and the olive/yellow left bar the rail and the tools roster use, and the others are faint and clickable. A row of unlabelled bars used to stand in for the names, which asked a visitor to guess what was behind them. Height animates through `grid-template-rows`, so nothing has a fixed size.

It is one island rather than two because the list and the proof column are the same selection: picking "agent systems" has to change both.

From `lg` the section is the band (`.cap-band`, 235vh) and its screen (`.cap-pin`) is sticky and centred, **heading included**: with the heading outside the pin, the band opened on a centred block 180px below its own title. The island finds the band with `closest('.cap-band')`, so the heading can be static Astro markup inside the pin without crossing the island boundary. The selection advances one capability per third of the pinned range. Clicking a name **scrolls** rather than setting state: setting state directly would be undone by the scroll handler on the next frame. Below `lg` there is no pin and a click sets the selection.

The heading is "Myself".

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

### 7.2 The clouds

`scripts/generate-cloud.mjs` emits three shapes as of v0.9.0. One subject makes
the deck's particle stage read as a logo that wobbles; three let it _cut_
between shapes, which is what makes the engine legible as an engine — same
physics, same controls, different material.

| File             | Shape                                        | Points | Raw    |
| ---------------- | -------------------------------------------- | ------ | ------ |
| `corona.pwcloud` | The CoronRing mark                           | 5,831  | 106 kB |
| `orbit.pwcloud`  | An orrery: three tilted tracks, three bodies | 7,353  | 135 kB |
| `wave.pwcloud`   | A two-source interference field              | 6,624  | 121 kB |

Each shape owns its own seed, so adding one cannot perturb another; `corona`'s
sequence of draws is unchanged from the single-shape version of the script and
its geometry is byte-identical to what shipped before.

Group numbering is shared across all three and is load-bearing — `0,1,2` is
structure (held upright by `spinWeightByGroup`), `3` is orbiting material, `4`
is ambient dust at 0.55. Both consumers (`ParticleField.astro` and the deck's
`ParticleStage`) rely on it.

`wave` draws its fringes in _density_ rather than in brightness: a point
survives rejection sampling in proportion to the constructive part of
`cos(k·d₁) + cos(k·d₂)`. That matters because the renderer varies point size and
alpha by weight, and a field whose structure lives only in alpha washes out on
the light theme.

`orbit` puts the tracks in the structure group and the bodies in the orbiting
one, so under spin the bodies sweep along tracks that stay put. That is the
whole point of an orrery and is impossible if everything rotates together.

#### corona, in detail

**The
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
across runs and across the v0.9.0 refactor.

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

Real screenshots are better, and this yields the moment a project supplies a `cover`. Until then it beats both alternatives: an empty grey box says nothing, and a stock photo says something untrue. Same slug always draws the same panel — stable across rebuilds, distinct from its neighbours in a grid.

Since v0.26.0 every project supplies one. Railtracks' is a still of its deck exhibit and NewsRing's is the live `today.png`. The others are drawings made for the purpose (a feather in a ring for FeatherRing, a dial of scores for EvalRing, braces round a template with its slots for gs_prompt_manager), traced into point clouds by the Particle Wave package's `convert` in `hybrid` mode and rendered by the published engine at 1600×900 in one of its palettes; Particle Wave's is the corona itself in the Aurora look. The captions say how each was made.

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
| `posts`      | `src/content/posts/`      | `title`, `summary` (≤220), `published`, `updated?`, `tags`, `header?`, `draft`                            |
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

This applies to `src/content/`, `src/data/`, page `lede` and `description` props, demo captions, and `README.md`. Code comments and these design documents are held to a lower bar.

**Key phrases are picked out** so a skimming reader lands on the words that carry a paragraph. Copy stays a plain string, because the same string is also a meta description or structured data; a caller names the phrases to emphasise, and `lib/emphasis.ts` splits the text around them for `ui/Emph.tsx`, which sets them in the full text colour at a heavier weight against the muted body. A project's `emphasis` frontmatter applies wherever its summary is copy (the deck blurb, the cards, the project page), and the schema rejects a phrase that is not in the summary, so rewording one fails the build instead of silently losing the emphasis. The intro, the reserved frames and Myself carry their own lists.

---

## 12.2 The tools

### On the home page: one instrument, not ten cards

`src/components/tools/ToolShowcase.tsx`. The band used to be a grid of ten
boxes, each holding a name, a sentence and an arrow. Ten identical rectangles is
not a menu, it is a wall, and nothing in it moved or showed what any of the tools
actually did — a visitor scanning it learned that there were ten of something.

It is now the same shape as the deck at the top of the page: a roster on the
left, and on the right a screen for the selected tool. Where the tool is small
enough (Token Counter, String Kit) the screen is a live mini version over the
real engine, prefilled and pasteable, with no settings; Rest Reminder shows its
working dial; the others show a sample. A stage carries controls, results and
one link, never a paragraph: the tool's own page is where it explains itself.

Each roster row also ends in a **full-page tab**, so a visitor can open a tool without first selecting it and reading to the foot of its stage. At rest it is a narrow strip reading FULL, tinted on the held row. Its leading edge is a diagonal that alternates by row, and because every tab is the same width the diagonals meet end to end and draw one zig-zag down the roster. On hover or keyboard focus the tab grows leftward over the name, stopping just past the tool's icon, and reads "Visit the full page". Only the held row's tab is in the tab order (arrow to a tool, then Tab to open it). The rows no longer carry a `01`–`05` index; the counter under the roster already numbers the held tool. The tab is the shared `components/ui/FullTab.tsx` (styles `.full-tab` in `global.css`, sizes on `.kit` in `showcase.css`), which the site rail uses too (§4.1).

The screens are data (`components/tools/showcase.ts`), kept out of the registry
for the reason `deck/frames.ts` is kept out of the projects collection: the
registry describes the tool, this describes one way of drawing it. They are
samples and are labelled as samples — where the output is arithmetic the numbers
are the right arithmetic for the input shown, and where it is structure the rows
name the fields the tool reports rather than a measurement it did not take.

The selection does **not** advance on its own. The screen animates and loops, but
a carousel that changes what you are reading while you are reading it is the
commonest way this pattern fails, and there is no case for it when every option
is already on screen. `prefers-reduced-motion` shows the finished screen.

The heading is "AI dev kit, on the web" — what the collection is, rather than
where it happens to execute.

### The registry

Twelve live, registered in `src/data/tools.ts`. The index and `ToolLayout` both
render from that registry, so a tool cannot disagree with the index about its
own name, summary or network behaviour.

| Tool             | Island                             | Engine                                   | Network                  |
| ---------------- | ---------------------------------- | ---------------------------------------- | ------------------------ |
| Token Counter    | `components/tools/TokenCounter`    | `lib/tokens`, `lib/model-pricing`        | LiteLLM price list, live |
| Text Diff        | `components/tools/TextDiff`        | `lib/diff`, `lib/semantic`               | opt-in embedding call    |
| Chunk Visualizer | `components/tools/ChunkVisualizer` | `lib/chunking`                           | none                     |
| MCP Tester       | `components/tools/McpTester`       | `lib/mcp`                                | the endpoint you name    |
| Run Viewer       | `components/tools/RunViewer`       | `lib/railtracks/*`, `public/frames/`     | visualizer from npm      |
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

**The price table** is LiteLLM's published price list, read from its source each time the Token Counter opens (`src/lib/model-pricing.ts`). Until v0.23.0 it was a trimmed snapshot committed to `public/data/` and refreshed by hand; prices change daily upstream, so a snapshot was stale by the next change and keeping it fresh meant a site deploy for every one. The page now fetches `raw.githubusercontent.com` (cross-origin reads allowed, five-minute cache, 2.8 MB sent as about 145 kB gzipped), falls back to jsDelivr's mirror of the same file when GitHub's raw host is blocked (up to 12 hours behind, and the page says so), and trims the list in the tab to the token-priced modes and the fields the tool shows. `src/data/models.ts` survives as the pinned shortlist and the last fallback; the list supplies the numbers where it has them.

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
2. **A tool may fetch public reference data it needs, from this origin or from that data's source.** The Token Counter reads LiteLLM's price list from GitHub (or jsDelivr's mirror of it) on each visit. The request carries nothing but its own URL: no cookies, no referrer, never the visitor's text.
3. **A tool whose whole purpose is a network call may make it, to an endpoint
   the visitor named, direct from the tab.** The MCP tester.
4. **A tool may download its own runtime from a public CDN.** The Python
   Runner, which fetches Pyodide from jsDelivr and wheels from PyPI. The code
   typed into it is executed locally and never transmitted. Self-hosting was
   rejected: the distribution is hundreds of megabytes, and even the core would
   be the largest thing in a repository that deploys through GitHub Pages.
5. **A tool may load third-party code at a version the visitor picks, only inside a sandbox.** The Run Viewer fetches the Railtracks visualizer from npm (through esm.sh) unpinned, by design: the point is that it is always the current build, or the build that matched a given Railtracks release. That code never runs in the page. It runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so its origin is opaque and it cannot read this site's storage, cookies or DOM; run files reach it only by `postMessage`. The version lists are read from the npm and PyPI JSON APIs, which send `Access-Control-Allow-Origin: *`.

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

## 12.6 The Run Viewer

`/tools/run-viewer`. A Railtracks run is a tree of calls, and Railtracks ships a visualizer for it (`railtracks viz`). This page draws a run with that visualizer without installing anything and without this site carrying a copy of it.

### Where the visualizer comes from

The visualizer is published to npm as `@railtownai/railtracks-visualizer`, a React component library. `railtracks viz` serves a separate prebuilt app from Azure blob storage, which sends no CORS headers and needs the Python server's API, so it cannot be used from a browser. The npm build is loaded at visit time:

- **The version** comes from `lib/railtracks/versions.ts`, which reads the npm and PyPI JSON documents (about 27 kB each) on every visit. Versions below 2 are the V1 line (draws a session's runs); 2 and up is V2, the event-stream visualizer behind `railtracks viz --beta`, which is not on npm yet and appears in the picker on its own when it is. Picking a Railtracks version selects the newest stable visualizer published on or before that release, because `railtracks viz` downloads whatever is current rather than a pinned build. Yanked Railtracks releases are left out of the list.
- **The bundle** is `esm.sh/<package>@<version>?bundle&deps=react@<major>,react-dom@<major>`, with React's major read from that version's own peer range. The site runs React 19 and the visualizer wants 18, which is one reason it cannot share the page. Stylesheets its graph library ships as files are pinned from the version's dependency list.
- **The frame** (`public/frames/railtracks-visualizer.html`) is static and generic. It fetches the bundle as text, gives it a production `import.meta.env` (the published bundle reads Vite's env unguarded and throws anywhere else; filed upstream as railtracks-visualizer#281), points its root-relative imports back at esm.sh, and imports it from a blob URL. It takes React and the DOM client from the bundle's own imports, so there is never a second React.

**Integration contract for future builds.** A build that exports `mountRailtracksSession(element, { session, runIndex, theme, tone })` is handed the whole session, raw events included, and owns the drawing; only then does the page send raw events, which can run to megabytes. A build without it gets the V1 path, `<Visualizer flowData={run}>`. This is the one place a V2 release could need a site change, and only if it ships under a different export.

### Two log formats, one map

`lib/railtracks/runs.ts`. Session files (`sessions/*.json`) already hold runs in the shape V1 draws. Event streams (`events/*.jsonl`), what Railtracks writes by default now that `save_state` is deprecated, are rebuilt: a run per top-level node call, a node per `node.creation`, an edge from the `spatial_parent_node_id` of each `node.invocation`, model calls attached to the node that made them with provider and model from `llm.creation`, and steps numbered the way the session file numbers them. A node whose `node.invocation` line is missing is treated as called when it answers.

Measured against a working `.railtracks` folder holding 305 sessions in both formats: of the 210 whose event streams are complete, 199 rebuild identically (runs, nodes, edges, statuses, inputs, outputs, model calls, steps). The other 11 differ in step order when two calls share a timestamp, or in an error message's wording. The 95 that differ more have streams missing events (a node with no `node.invocation`, three model calls and two responses), which looks like a writer issue in Railtracks under concurrent sessions rather than a reader one; they draw what survived.

### Folders, watched

`lib/railtracks/folder.ts`. Any folder works as the starting point (project root, `.railtracks`, `data`, `sessions` or `events`): a walk of depth 4 that skips `node_modules`, `.git`, virtual envs and build output finds both kinds of file and pairs them by the session id in their names. Status and name come from a peek at the first and last 16 kB of an event stream, so listing 400 sessions does not read 400 files.

- **Chromium** gets a directory handle (`showDirectoryPicker`, or a folder dropped on the panel) and watches it with `FileSystemObserver` (shipped in Chrome 133), observing the run folders found plus the picked folder. Without the observer it re-lists every 2 seconds. A change is detected by size as well as modified time: an append in the browser's private file system grows the file without moving its `lastModified`. The handle is kept in IndexedDB so the next visit can offer to reopen the folder; that is not access, and the browser asks again.
- **Other browsers** read a folder once, through `<input webkitdirectory>`, and say that watching needs Chrome or Edge.

### The Site style

The frame recolours the visualizer rather than only overriding CSS. Its exported `lightTheme` and `darkTheme` are the objects it reads while rendering, inline styles included, so the frame rewrites their colour slots in place from the site palette and restores them for the Original style. Both palettes are read from the page's own `:root` and `:root[data-theme='dark']` rules by `lib/railtracks/palette.ts`, so a token change reaches the frame. A CSS layer covers what the theme does not reach, using React Flow's and Ant Design's public class names only: the faces (the site's fontsource packages, from esm.sh), 3px corners, the agent's indigo glow replaced by the hazard-yellow bar, the selected state, and the drawer. Tone follows the page (Auto) or is pinned.

The V1 visualizer lays a tree out on a canvas at least 1200px wide and does not fit it to the view, so the frame measures where the nodes landed and redraws once with a starting view that centres them, zoomed out to React Flow's floor of 0.5 when the graph is wider than the frame. The frame stays hidden until then.

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

### Action versions

Every action is on a major that runs on Node 24 (`checkout@v7`,
`setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`,
`deploy-pages@v5`), and the build runs on Node 22. The runners were forcing
Node-20 actions onto 24 and warning about it, and that shim will not last.

Two breaking changes in those majors were checked against this repo and do not
apply:

- `checkout` v5+ tightened `pull_request_target` defaults. Nothing here
  triggers on that event.
- `upload-pages-artifact` v4+ stopped including dotfiles. `dist/` contains
  none. If the build ever starts emitting one, pass `include-hidden-files: true`
  rather than reverting the major.

`setup-node` v5 added automatic caching driven by a `packageManager` field in
`package.json`. There is no such field and `cache: npm` is passed explicitly,
so the behaviour is unchanged.

---

## 14. Roadmap

- **Phase 2 — Content.** Replace every placeholder. Real projects, resume, resources. Add `public/resume.pdf`.
- **Phase 3 — Demos.** Replace `PlaceholderDemo` with real artifacts.
- **Phase 4 — Tools.** Nine shipped as of v0.6.0 (§12.2); Context Budgeter and JSON Schema Forge remain. Still open: a WASM tokenizer to replace the token counter's estimator with an exact count; per-tool state in the URL so a configuration can be linked; `pyPreset` on the remaining project pages once those packages are published; and revisiting the `railtracks` preset when its transitive wheels reach WebAssembly (§12.4).
- **Phase 5 — Polish.** Per-page OG images, Lighthouse pass, screen-reader testing.
- **Phase 6 — Fill the deck.** The three reserved slots (§6.1) need write-ups and real stages. Until they do, they carry the idle-bench instrument and say so.

---

## 15. Decision log

| Decision                                                                | Reasoning                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pyodide in a worker, and terminate as the only stop                     | Synchronous WebAssembly cannot be interrupted in-page; on the main thread a visitor's infinite loop takes the tab and the stop button with it         |
| Keep the `railtracks` preset even though it cannot install              | The blockers are missing wheels, not broken code; a hardcoded refusal would outlive the reason for it, and the attempt reports the real cause         |
| Hand-written editor rather than CodeMirror                              | ~250 kB to type Python into a box on a page whose argument is that it loads fast; a gutter, colour and indent-aware keys is the whole ask             |
| `/api/embed` on the chat service, not a new service                     | It needs Gemini keys, even rotation, per-model cooldowns and a rate limiter, all of which already exist there; a second copy is a second bug          |
| L2-normalise embeddings at the service boundary                         | `gemini-embedding-001` is unit length only at 3072 dimensions; below that cosine and dot product silently disagree by up to 20%                       |
| Semantic comparison opt-in per click, local engine as default           | The tool is fully useful without a request, so uploading pasted text on page load would buy nothing and cost the promise in §12.3                     |
| Warn on catastrophic regex shapes rather than trying to abort           | Nothing in the page runs once the engine is inside a backtrack; a static check before running is the only defence that exists                         |
| Random Kit names its source in the UI                                   | Reproducible and unpredictable are opposite requirements and `Math.random()` satisfies neither; hiding the choice hides the only two questions        |
| Measure speech rate from `boundary` events, then extrapolate            | Speaking rate varies over 2x by voice, so estimating is wrong; speaking the whole text is right and takes minutes. Two seconds either way             |
| `pyPreset` as a second project slot, not a new `demo:` key              | A demo is one island per project; a console is orthogonal, and `particle-wave` wants both                                                             |
| Escalate to a headless browser before declaring a site unreadable       | v0.1.0's central error; the CSS was one `curl` away                                                                                                   |
| Generate and commit the price table rather than fetching LiteLLM live   | Hermetic builds, a reviewable diff on every price change, and no third-party request from a visitor's browser                                         |
| No server-side proxy for the MCP tester                                 | An open request forwarder is an SSRF pivot; direct-from-tab also makes `localhost` endpoints testable                                                 |
| Tool engines in `src/lib/`, never in the island                         | Each was tested standalone before any UI existed; keeps the components short enough to read                                                           |
| Marks in the pure yellow in both themes, olive only for text and focus  | Asked for: the same element was yellow in one place and brown in the next. Focus stays olive because it must be seen                                  |
| Posts as a band of their own, after Tools                               | Writing is work; as rows in the notes list it read as a link dump. Takes a seventh rail entry                                                         |
| Onward links as outlined buttons, not mono text                         | At 12px mono in the muted colour, "Full resume" and "All tools" read as captions; the way deeper is the one control every band has                    |
| Vertical rail over horizontal header                                    | Nav persists through a full-height hero; gives the asymmetric edge the reference relies on                                                            |
| Contrast veil rather than a matching one                                | A same-tone loader is a blank screen; the opposite tone makes the reveal an event                                                                     |
| Veil once per session                                                   | An MPA that veils every navigation is unusable                                                                                                        |
| Veil waits for the exhibit, not for `load`                              | `load` fires before the island hydrates and the engine starts, so the veil lifted onto "Starting engine…" — a loading screen that missed the load     |
| `holdVeil` a prop rather than a marker in the page                      | The decision is synchronous; on a slow load nothing below the veil is parsed yet, so a queried marker is found only after the ceiling has fired       |
| Two accent tokens (text vs fill)                                        | `#fffa00` is illegible as text on white but correct as a fill with ink on top                                                                         |
| Per-theme particle size and opacity                                     | Equal alpha does not mean equal perceived weight across grounds                                                                                       |
| No canvas fade-in                                                       | Bought nothing; froze at ~35% contrast wherever the animation clock stalls                                                                            |
| Parametric cloud with a fixed seed                                      | No source bitmap, no Python in CI, byte-identical rebuilds                                                                                            |
| Vendor SenseRing rather than reimplement                                | The engine already exists, is better than a rewrite, and is the user's own work                                                                       |
| Types declared beside vendored JS, not inside it                        | Upstream edits are lost on the next sync                                                                                                              |
| Carousel over three stacked cards                                       | Three prose blocks compete for one glance                                                                                                             |
| Generated cover art over grey boxes                                     | Says something true while real screenshots are pending                                                                                                |
| Verify by sampling pixels                                               | Both particle bugs were invisible to inspection                                                                                                       |
| Ambient motion on the rest frame, not as a force                        | As a force it fights the spring and washes out to a static offset                                                                                     |
| Glyph at spin weight 0, corona at 1                                     | A spinning letter is upside down half the time                                                                                                        |
| Median, not mean, as the extractor's background level                   | The mean leaves background pixels at a third weight; the trace fills the frame                                                                        |
| Real driveable demo over a recording                                    | Claims about a physics engine are cheap; a spring-constant slider is not                                                                              |
| Upload goes to the Python service, browser tracer as fallback           | The server half is the project; the fallback keeps a free-tier outage from breaking the page                                                          |
| Provenance labelled in the UI rather than hidden                        | The quality gap between the two tracers is the demonstration, not an implementation detail                                                            |
| Backend and infra excluded from the Pages workflow                      | A service that cannot build must not be able to block a content deploy                                                                                |
| No em dashes in visitor-facing copy                                     | The strongest single tell of machine-written prose on a page employers read                                                                           |
| Hero and "Selected work" merged into one deck                           | They showed the same engine twice, the second time inside three nested frames; one full-height surface is both the introduction and the work          |
| The deck handoff latched off scroll rather than scrubbed against it     | Scrubbing charges a visitor for the animation a wheel notch at a time and the name arrives in pieces; a latch reverses just as well, on its own clock |
| Two latch thresholds rather than one                                    | One threshold puts a visitor resting on the line into a loop, the transition restarting in the opposite direction on every small correction           |
| Transition duration read back off the element, not stored in a variable | The build minifies `620ms` to `.62s`, so parsing the declared value gave 0.62 and the outgoing layers popped instead of fading                        |
| Every deploy action on a Node-24 major                                  | The runners were forcing Node-20 actions onto 24 and warning; the shim is temporary and a dead deploy pipeline is not a portfolio piece               |
| `--deck-t` written to the DOM rather than held in React state           | It changes every frame the page moves; re-rendering six tokens and a readout at 60 Hz to move one number buys nothing                                 |
| Exhibit inset beside the copy, overlapping 7 to 9%                      | Full bleed put the copy across the cloud's left 40%; a clean split leaves a visible seam, and a few percent of overlap reads as one composition       |
| `touch-action: pan-y` on both canvases                                  | With `none` the canvas owns most of a phone's first screen and there is nothing left to swipe on                                                      |
| At most three controls per stage                                        | Twenty-two controls under a small canvas is a parameter sheet; a visitor cannot tell which number is the interesting one, so they move none           |
| `Look` as a preset rather than three parameters                         | Colour mode, palette and trail length only make sense together at this altitude; the separable version lives on the project page                      |
| Only the active stage mounted                                           | Six live exhibits behind one another is six animation loops for one visible picture; a re-mount costs one cached fetch                                |
| Three reserved frames rather than a roster of three                     | A deck of three implies that is all the work there is; the slots are marked reserved and link nowhere, which is honest and fills the rail             |
| The site statement as ghost type behind the exhibit                     | It stays the loudest thing on the first screen without competing with the frame title for the heading slot; it is real text, not an image             |
| Hand-set sigils rather than hash-generated ones                         | A hash-driven mark is noise at 56px; six drawn glyphs let a visitor aim at a frame instead of reading a list                                          |
| Rail as a `tablist`, stage as its `tabpanel`                            | Arrow keys, roving `tabindex` and `aria-selected` come from the pattern rather than from bespoke handlers                                             |
| Agent pipeline drawn as a graph, not a log                              | The shape is what a visitor understands in four seconds; the timestamped transcript is what an operator reads on their fourth day                     |
| `minmax(0, 1fr)` on the stacked deck grid                               | A track's default minimum is its widest child, so the control row sized the column and pushed the whole deck off a phone                              |
| Deck presets carry no trails                                            | `particles x trailLength` antialiased segments per frame is the frame: 133 ms against 24 ms, and almost none of the geometry is visible               |
| A `charge` preset mapping colour to speed                               | The cheapest interactive thing the engine can do — the cloud changes colour under the cursor without drawing anything extra                           |
| Project names on the rail, not just sigils                              | A portrait identifies an operator; a stroke glyph does not identify a library. The mark orients, the name identifies                                  |
| Masthead cut to a name and a job title                                  | Location, a positioning sentence and a status block naming the deck's own mechanics were all text in front of the exhibit                             |
| The assistant as a band on the home page                                | The one surface that answers questions should not be the one you have to navigate away to reach                                                       |
| The dock nudges once, then withdraws                                    | Nobody clicks a button labelled "Ask". Once a session, gone in 15 s if ignored, and never over the in-page assistant                                  |
| Run Viewer loads the visualizer from npm, unpinned, at visit time       | A visualizer release should reach the site with no rebuild; a picked version lets an old log be drawn by the build that matched it                    |
| The visualizer runs in an opaque-origin sandbox, fed by `postMessage`   | It is third-party code fetched live; the sandbox also keeps its React 18, Ant Design globals and emotion styles away from the page                    |
| Rebuild runs from event streams on the site rather than wait for V2     | New Railtracks runs only write JSONL; without the rebuild, folder mode would show almost nothing until V2 reaches npm                                 |
| Read model prices from LiteLLM live, not from a committed snapshot      | Prices change daily; a snapshot is stale by the next change and freshness would cost a deploy each time. GitHub raw first, jsDelivr if blocked        |
| Posts as a fixed-size wheel, not a growing list                         | A band that grows with every post punishes writing more; a wheel that never ends says "there is more" without the page getting longer                 |
| Cards restored for `#work`                                              | The manifest was faster to skim and duller to look at; the cover art is generated, so an entry is a picture from the day it is added                  |

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
