import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildFrames, type DeckFrame, type DeckProject } from './frames';
import Sigil from './Sigil';
import { Morph } from './morph';
import type { SeedCloud, Snapshot } from './seed';
import RailtracksStage from './stages/RailtracksStage';
import ParticleStage from './stages/ParticleStage';
import NewsStage from './stages/NewsStage';
import AgentStage from './stages/AgentStage';
import PromptStage from './stages/PromptStage';
import ReservedStage from './stages/ReservedStage';
import Icon from '../ui/Icon';
import Emph from '../ui/Emph';
import type { IconName } from '../ui/icons';

/**
 * ProjectDeck — the landing page.
 *
 * ## Two states on one continuum
 *
 * **Landing.** A name, what the name does, one line, and the exhibit running
 * beside all of it. Nothing else: no rail, no controls, no counter. A visitor
 * who has been here for one second is not choosing between six projects, they
 * are deciding whether to stay.
 *
 * **Deck.** The introduction folds up into two lines at the top, the roster
 * slides in from the left, and the controls rise from the bottom. Same canvas,
 * same instance, no reload.
 *
 * The handoff is **latched, not scrubbed**. One deliberate scroll trips it and
 * CSS runs the whole transition on its own timing; scrolling back up trips it
 * the other way and CSS runs it in reverse. The scroll picks the direction, it
 * does not meter the animation — metering it against the scroll made a visitor
 * pay for the animation a wheel notch at a time, and the name arrived in
 * pieces.
 *
 * Every difference between the two states is interpolated in CSS off the one
 * number `--deck-t`, which is why the name travels between its two homes
 * rather than being two elements that cross-fade. `phase` carries where the
 * run has got to, for the things CSS cannot interpolate: `visibility`,
 * `display`, and so the tab order.
 *
 * ## The scroll walks the deck
 *
 * From `lg` the section is several screens tall with the frame pinned, and
 * the scroll position past the handoff picks the frame: each one holds for a
 * fixed share of the section, the way the Myself and Tools bands step through
 * their entries. A click, an arrow key or the rail's own arrows *scroll* to the
 * frame rather than setting it, so the two can never disagree; the jump is
 * instant, which inside a pinned screen is invisible except as the cut. Below
 * `lg` nothing is pinned and the controls set the frame directly.
 *
 * ## Cutting between drawn exhibits
 *
 * Railtracks, Particle Wave and NewsRing each register a snapshot function
 * that reads their picture back as points. On a cut between two of them the
 * deck reads the outgoing picture before unmounting it, mounts the incoming
 * exhibit hidden and held still, reads its first frame the same way, and runs
 * a morph from one to the other on a canvas over the stage (`morph.ts`). When
 * the particles land, the exhibit underneath is revealed at the picture they
 * just drew, and starts running. A cut that arrives mid-morph starts the next
 * morph from wherever the particles are.
 *
 * ## The exhibit sits beside the copy, not under it
 *
 * The canvas is inset to the right of the copy column and overlaps it by
 * `--deck-art-cover` (see deck.css), so the two read as one composition and
 * nothing legible is ever behind type.
 *
 * ## Semantics
 *
 * The rail is a tab list and the stage its panel, so arrow keys,
 * `aria-selected` and focus management all come from the pattern rather than
 * from bespoke handlers. The site's statement is the `h1` — drawn as the ghost
 * type behind the exhibit, which is styling, not a trick: it is real text at a
 * real size and reads perfectly well. Each frame's title is the `h2`.
 */

interface Props {
  projects: DeckProject[];
  /** The site's one statement, set as the ghost type behind the stage. */
  statement: string;
  /** The name, top left. */
  name: string;
  /** One line under it. */
  role: string;
  /** One sentence, shown on the landing card only. */
  intro: string;
  /** Phrases of the intro to pick out. */
  introEmphasis?: readonly string[];
  /**
   * The handful of links that belong on a title card. They are the only way
   * off the landing card, so each one carries its mark: a row of plain words
   * in the body colour reads as a sentence, not as three buttons.
   */
  links: ReadonlyArray<{ label: string; href: string; icon?: IconName }>;
  /** Where "all projects" goes. */
  indexHref: string;
}

/** Where the handoff is in its own run. Drives what CSS cannot interpolate. */
type Phase = 'intro' | 'moving' | 'deck';

/**
 * The two thresholds the handoff latches on, in pixels into the section.
 *
 * `ENTER` is about one wheel notch: enough that a stray touchpad tremor or a
 * restored scroll position does not fire it, little enough that one deliberate
 * scroll does. Scrubbing the transition against the scroll instead made a
 * visitor pay for the whole animation a notch at a time.
 *
 * `EXIT` is lower than `ENTER` on purpose. Equal thresholds put a visitor
 * resting exactly on the line into a loop, the transition restarting in the
 * opposite direction on every small correction; the gap between them is what
 * makes the latch stable.
 */
const ENTER_PX = 90;
const EXIT_PX = 36;

/** Where the deck is pinned and scroll-driven. Below this it stacks and only clicks drive it. */
const PINNED = '(min-width: 64rem)';

/**
 * Scroll before the first frame starts counting, as a share of the viewport.
 * Leaves room for the handoff to land on frame one before the next can take
 * over. The section's height in `deck.css` is built from the same two numbers.
 */
const LEAD_VH = 0.12;

/** Stages that draw their own picture and can be morphed into one another. */
const DRAWN: ReadonlySet<string> = new Set(['railtracks', 'particle', 'news']);

/** How long the deck waits for the incoming exhibit's first frame before cutting without a morph. */
const MORPH_WAIT_MS = 2500;

/**
 * Display size for a frame title, stepped by length.
 *
 * The measure is fixed and the display face is wide, so one size cannot hold
 * both `Evaluation` and `gs_prompt_manager`. Setting long names smaller is the
 * ordinary typographic answer; the alternative is a hyphenless mid-word break.
 */
function titleSize(title: string): string {
  if (title.length > 15) return 'text-[clamp(1.25rem,1.6vw,1.6rem)]';
  if (title.length > 12) return 'text-[clamp(1.45rem,1.9vw,1.95rem)]';
  return 'text-[clamp(1.7rem,2.3vw,2.35rem)]';
}

/** The reference's black-label / light-value metadata pair. */
function MetaPair({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 items-stretch">
      <span className="bg-fg text-ground px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap uppercase">
        {label}
      </span>
      <span className="border-line bg-surface text-muted min-w-0 border border-l-0 px-2.5 py-1 font-mono text-[11px] tracking-wide">
        {value}
      </span>
    </span>
  );
}

export default function ProjectDeck({
  projects,
  statement,
  name,
  role,
  intro,
  introEmphasis,
  links,
  indexHref,
}: Props): React.ReactElement {
  const frames = useMemo(() => buildFrames(projects), [projects]);
  const uid = useId();
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  /** The outgoing picture, while a cut between two drawn exhibits is being morphed. */
  const [seed, setSeed] = useState<SeedCloud | null>(null);
  /** True while the incoming exhibit is mounted but hidden under the morph. */
  const [entering, setEntering] = useState(false);
  const morphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const morphRef = useRef<Morph | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  /** Where a stage may put copy of its own, in the copy column. */
  const [newsHost, setNewsHost] = useState<HTMLDivElement | null>(null);
  const registerSnapshot = useCallback((snapshot: Snapshot | null) => {
    snapshotRef.current = snapshot;
  }, []);
  const [phase, setPhase] = useState<Phase>('intro');
  /** False while the deck is scrolled away — stages pause rather than run blind. */
  const [onScreen, setOnScreen] = useState(true);
  const sectionRef = useRef<HTMLElement | null>(null);
  const tokenRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const frame = frames[index] ?? frames[0]!;
  const total = frames.length;

  /**
   * Make a frame the held one. The only place the index changes, so the
   * handover to Particle Wave is decided in one place whatever drove the cut.
   */
  const select = useCallback(
    (next: number) => {
      const current = indexRef.current;
      if (next === current) return;
      const from = frames[current];
      const to = frames[next];
      const morph =
        from !== undefined &&
        to !== undefined &&
        DRAWN.has(from.stage) &&
        DRAWN.has(to.stage) &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Mid-morph, the next one starts from wherever the particles are.
      const outgoing = morph
        ? (morphRef.current?.current() ?? snapshotRef.current?.() ?? null)
        : null;
      morphRef.current?.stop();
      morphRef.current = null;
      snapshotRef.current = null;
      setSeed(outgoing);
      setEntering(outgoing !== null);
      indexRef.current = next;
      setIndex(next);
    },
    [frames],
  );

  /**
   * Where on the page a frame is held, while the deck is pinned: the middle
   * of its share of the section's scroll.
   */
  const frameTop = useCallback(
    (i: number): number | null => {
      const section = sectionRef.current;
      if (!section || !window.matchMedia(PINNED).matches) return null;
      const lead = window.innerHeight * LEAD_VH;
      const span = section.offsetHeight - window.innerHeight - lead;
      if (span <= 0) return null;
      return section.offsetTop + lead + (span / total) * (i + 0.5);
    },
    [total],
  );

  const go = useCallback(
    (next: number, focus = false) => {
      const wrapped = ((next % total) + total) % total;
      const top = frameTop(wrapped);
      // Pinned: move the scroll and let it pick the frame, so they always agree.
      if (top !== null) window.scrollTo({ top, behavior: 'instant' });
      else select(wrapped);
      if (focus) tokenRefs.current[wrapped]?.focus({ preventScroll: true });
    },
    [total, frameTop, select],
  );

  /*
   * The morph. Runs whenever a cut hands over a picture: holds the outgoing
   * picture as particles until the incoming exhibit has drawn its first frame,
   * then morphs one into the other and reveals the exhibit underneath.
   */
  useEffect(() => {
    const canvas = morphCanvasRef.current;
    const stage = stageRef.current;
    if (!seed || !canvas || !stage) return;

    const box = stage.getBoundingClientRect();
    let morph: Morph;
    try {
      morph = new Morph(canvas, seed, box);
    } catch {
      setEntering(false);
      return;
    }
    morphRef.current = morph;
    canvas.removeAttribute('data-leaving');

    let raf = 0;
    let leaveId = 0;
    const asked = performance.now();

    const finish = (): void => {
      if (morphRef.current === morph) morphRef.current = null;
      setEntering(false);
      canvas.setAttribute('data-leaving', '');
      leaveId = window.setTimeout(() => setSeed((s) => (s === seed ? null : s)), 450);
    };

    const wait = (): void => {
      const target = snapshotRef.current?.() ?? null;
      if (target) {
        morph.run(target, finish);
        return;
      }
      if (performance.now() - asked > MORPH_WAIT_MS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(wait);
    };
    raf = requestAnimationFrame(wait);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(leaveId);
      morph.stop();
    };
  }, [seed]);

  /*
   * The handoff.
   *
   * Scrolling past `ENTER_PX` sets `--deck-t` to 1 and CSS runs the whole
   * transition on its own timing; scrolling back above `EXIT_PX` sets it to 0
   * and CSS runs it backwards. The scroll position picks the direction, it does
   * not meter the animation.
   *
   * `--deck-t` is written straight to the element rather than held in state,
   * because `phase` has to lag it: the layers that leave are only taken out of
   * the tab order once they have finished fading, and driving both from one
   * state update would pop them out at the first frame instead.
   */
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    /*
     * How long to wait before taking the outgoing layer out of the tab order.
     *
     * Read from the *resolved* transition, not from a custom property holding
     * the number: the build minifies `620ms` to `.62s`, so parsing the declared
     * value gave 0.62 and the layers popped instead of fading. A computed
     * `transition-duration` is always in seconds by spec, and this picks up
     * `prefers-reduced-motion` for free, since that flattens it globally.
     */
    const swapMs = (): number => {
      const declared = getComputedStyle(section).transitionDuration;
      const times = declared
        .split(',')
        .map((part) => parseFloat(part) * 1000)
        .filter((ms) => Number.isFinite(ms));
      return Math.max(0, ...times);
    };

    let open = false;
    let frameId = 0;
    let settleId = 0;

    const apply = (next: boolean): void => {
      if (next === open) return;
      open = next;
      section.style.setProperty('--deck-t', next ? '1' : '0');
      setPhase('moving');
      window.clearTimeout(settleId);
      settleId = window.setTimeout(() => setPhase(next ? 'deck' : 'intro'), swapMs());
    };

    const pinned = window.matchMedia(PINNED);

    const read = (): void => {
      frameId = 0;
      const travelled = window.scrollY - section.offsetTop;
      // Between the two thresholds nothing changes, which is the whole point.
      if (travelled >= ENTER_PX) apply(true);
      else if (travelled <= EXIT_PX) apply(false);

      if (!pinned.matches) return;
      const lead = window.innerHeight * LEAD_VH;
      const span = section.offsetHeight - window.innerHeight - lead;
      if (span <= 0) return;
      const progress = Math.min(1, Math.max(0, (travelled - lead) / span));
      section.style.setProperty('--deck-p', progress.toFixed(4));
      select(Math.min(total - 1, Math.floor(progress * total)));
    };

    const schedule = (): void => {
      if (!frameId) frameId = requestAnimationFrame(read);
    };

    /* A reload part-way down the page starts where the visitor left off, with
       no transition to play. */
    if (window.scrollY - section.offsetTop >= ENTER_PX) {
      open = true;
      section.style.setProperty('--deck-t', '1');
      setPhase('deck');
    }
    read();

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.clearTimeout(settleId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [select, total]);

  /** The cue does what the scroll it stands in for would do: trip the latch. */
  const advance = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    window.scrollTo({ top: section.offsetTop + ENTER_PX * 2 });
  }, []);

  // Pause every stage while the deck is off screen or the tab is hidden.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !('IntersectionObserver' in window)) return;

    let visible = true;
    const sync = (): void => setOnScreen(visible && !document.hidden);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        sync();
      },
      { rootMargin: '120px' },
    );
    io.observe(section);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  /**
   * Tab-list keyboard handling.
   *
   * Both axes are bound because the rail is vertical on desktop and
   * horizontal on mobile, and a visitor should not have to know which one
   * they are looking at to drive it.
   */
  const onRailKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const moves: Record<string, number> = {
        ArrowDown: 1,
        ArrowRight: 1,
        ArrowUp: -1,
        ArrowLeft: -1,
      };
      const delta = moves[event.key];
      if (delta) {
        event.preventDefault();
        go(index + delta, true);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        go(0, true);
      }
      if (event.key === 'End') {
        event.preventDefault();
        go(total - 1, true);
      }
    },
    [go, index, total],
  );

  const landed = phase === 'deck';

  return (
    <section
      ref={sectionRef}
      id="top"
      aria-label="Introduction and selected work"
      data-phase={phase}
      className="deck border-line relative border-b"
      style={{ '--deck-frames': total } as React.CSSProperties}
    >
      <div className="deck-pin">
        {/* ── The exhibit ─────────────────────────────────────────── */}
        <div ref={stageRef} className="deck-stage">
          {/*
            The site's statement, set behind the exhibit. The stages draw on a
            transparent canvas, so this reads through them as texture.

            It sits outside the tab panel deliberately: it is the document's
            `h1` and belongs to the page, not to whichever frame happens to be
            held.
          */}
          <h1 className="deck-ghost">{statement}</h1>

          <div
            key={frame.id}
            id={`${uid}-panel`}
            role="tabpanel"
            aria-labelledby={`${uid}-tab-${frame.id}`}
            tabIndex={-1}
            className="deck-stage-inner"
            data-entering={entering ? '' : undefined}
          >
            {frame.stage === 'railtracks' && (
              <RailtracksStage active={onScreen && !entering} onSnapshot={registerSnapshot} />
            )}
            {frame.stage === 'particle' && (
              <ParticleStage
                active={onScreen && !entering}
                entering={entering}
                onSnapshot={registerSnapshot}
              />
            )}
            {frame.stage === 'news' && (
              <NewsStage
                active={onScreen && !entering}
                onSnapshot={registerSnapshot}
                listHost={newsHost}
              />
            )}
            {frame.stage === 'agent' && <AgentStage active={onScreen} />}
            {frame.stage === 'prompt' && <PromptStage active={onScreen} />}
            {frame.stage === 'reserved' && (
              <ReservedStage sigil={frame.sigil} title={frame.title} active={onScreen} />
            )}
            <span aria-hidden="true" className="deck-scan" />
          </div>

          {seed && <canvas ref={morphCanvasRef} aria-hidden="true" className="deck-morph" />}

          <span aria-hidden="true" className="deck-vignette" />
        </div>

        {/* Holds the type legible where it crosses the exhibit. */}
        <span aria-hidden="true" className="deck-scrim" />

        {/* ── The masthead, in both states ────────────────────────── */}
        <div className="deck-mast">
          <p className="deck-mast-name display">{name}</p>
          <div className="deck-mast-under">
            <p className="eyebrow eyebrow-marked mt-3">{role}</p>
            <div className="deck-lede" aria-hidden={landed}>
              <p className="text-muted prose-measure mt-6 text-base leading-relaxed sm:text-lg">
                <Emph text={intro} phrases={introEmphasis} />
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {links.map((link) => {
                  const external = /^https?:/.test(link.href);
                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      tabIndex={landed ? -1 : undefined}
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noopener noreferrer' : undefined}
                      className="deck-lede-link font-mono text-xs tracking-wide uppercase"
                    >
                      {link.icon ? <Icon name={link.icon} size={14} /> : null}
                      {link.label}
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── The roster ──────────────────────────────────────────── */}
        <div className="deck-rail" aria-hidden={phase === 'intro'}>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous project"
            className="deck-arrow"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
              <path
                d="M3 10 L8 5 L13 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            role="tablist"
            aria-label="Projects"
            aria-orientation="vertical"
            onKeyDown={onRailKeyDown}
            className="deck-tokens"
          >
            {frames.map((item, i) => {
              const on = i === index;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    tokenRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${item.id}`}
                  aria-selected={on}
                  aria-controls={`${uid}-panel`}
                  tabIndex={on ? 0 : -1}
                  data-deck-token={item.id}
                  data-reserved={item.status === 'reserved' ? '' : undefined}
                  onClick={() => go(i)}
                  className="deck-token group"
                  style={{ '--deck-token-i': i } as React.CSSProperties}
                >
                  <span className="deck-token-disc">
                    <Sigil name={item.sigil} className="deck-token-art" />
                  </span>
                  <span className="deck-token-name">{item.railName}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next project"
            className="deck-arrow"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
              <path
                d="M3 6 L8 11 L13 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* ── The readout ─────────────────────────────────────────── */}
        <div className="deck-copy" aria-hidden={phase === 'intro'}>
          {/*
            The empty top of the copy column, lent to the held exhibit. Only
            NewsRing uses it, for the list of today's picks; see NewsStage.
          */}
          <div ref={setNewsHost} className="deck-aside" />
          <div className="mt-auto">
            <div className="border-line flex items-baseline gap-4 border-t pt-4">
              <span className="eyebrow">Building</span>
              <span aria-hidden="true" className="bg-line h-px flex-1" />
              <span className="text-faint font-mono text-[11px] tabular-nums">
                {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
              </span>
            </div>

            {/*
              Keyed on the frame, so the whole readout re-enters on a cut. The
              stagger is CSS (`.deck-enter > *`), not five delayed states.
            */}
            <div key={frame.id} className="deck-enter mt-5">
              <h2 className={`deck-title display break-words ${titleSize(frame.title)}`}>
                <span aria-hidden="true" className="deck-bracket">
                  [
                </span>
                {frame.title}
                <span aria-hidden="true" className="deck-bracket">
                  ]
                </span>
              </h2>

              <div aria-hidden="true" className="deck-rule mt-4" />

              <div className="mt-4">
                <MetaPair label={frame.meta.label} value={frame.meta.value} />
              </div>

              <p className="text-muted prose-measure mt-4 text-[15px] leading-relaxed">
                <Emph text={frame.blurb} phrases={frame.emphasis} />
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                {frame.href ? (
                  <a href={frame.href} className="deck-cta group">
                    Open blueprint
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
                      <path
                        d="M3 8 H13 M9 4 L13 8 L9 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                ) : (
                  <span className="border-line text-faint inline-flex h-11 items-center border border-dashed px-5 font-mono text-xs">
                    Write-up in progress
                  </span>
                )}
                <a
                  href={indexHref}
                  className="group text-muted hover:text-fg inline-flex h-11 items-center gap-2 text-sm font-medium transition-colors"
                >
                  All projects
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="size-3.5 transition-transform duration-[var(--dur-base)] group-hover:translate-x-[3px]"
                  >
                    <path
                      d="M3 8 H13 M9 4 L13 8 L9 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="deck-cue"
          aria-label="Show the projects"
          tabIndex={landed ? -1 : undefined}
          onClick={advance}
        >
          <span className="eyebrow">Scroll</span>
          <span aria-hidden="true" className="deck-cue-line" />
        </button>
      </div>
    </section>
  );
}

/** Re-exported so Astro pages can type the prop without reaching into `frames`. */
export type { DeckFrame, DeckProject };
