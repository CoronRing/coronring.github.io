import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildFrames, type DeckFrame, type DeckProject } from './frames';
import Sigil from './Sigil';
import ParticleStage from './stages/ParticleStage';
import AgentStage from './stages/AgentStage';
import PromptStage from './stages/PromptStage';
import ReservedStage from './stages/ReservedStage';

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
 * The handoff is a scroll position, not a switch. `--deck-t` runs 0 to 1 over
 * the first part of the pinned range and every difference between the two
 * states is interpolated off it in CSS, so scrolling back up runs the whole
 * thing in reverse and the name travels between its two homes rather than
 * being two elements that cross-fade. `phase` carries the same value coarsely,
 * for the things CSS cannot interpolate — `visibility`, `display`, and so the
 * tab order.
 *
 * The section is taller than the viewport with the whole of it pinned, so the
 * scroll that buys the handoff does not also scroll the introduction off the
 * top. What is left of the pinned range is dwell: the cloud spins up with the
 * scroll (see `ParticleStage`) before the page releases into the work below.
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
  /** The handful of links that belong on a title card. */
  links: ReadonlyArray<{ label: string; href: string }>;
  /** Where "all projects" goes. */
  indexHref: string;
}

/** Coarse read of `--deck-t`, for the properties that cannot be interpolated. */
type Phase = 'intro' | 'moving' | 'deck';

/** Share of the pinned range the handoff spends itself over; the rest is dwell. */
const HANDOFF_SHARE = 0.55;

/** Unpinned, the handoff is a step. Anything past this and the visitor has scrolled. */
const HANDOFF_PX = 24;

/** Where the deck is pinned and the handoff can be scrubbed. Matches deck.css. */
const PINNED = '(min-width: 64rem)';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

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
  links,
  indexHref,
}: Props): React.ReactElement {
  const frames = useMemo(() => buildFrames(projects), [projects]);
  const uid = useId();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  /** False while the deck is scrolled away — stages pause rather than run blind. */
  const [onScreen, setOnScreen] = useState(true);
  const sectionRef = useRef<HTMLElement | null>(null);
  const tokenRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const frame = frames[index] ?? frames[0]!;
  const total = frames.length;

  const go = useCallback(
    (next: number, focus = false) => {
      const wrapped = ((next % total) + total) % total;
      setIndex(wrapped);
      if (focus) tokenRefs.current[wrapped]?.focus();
    },
    [total],
  );

  /*
   * The handoff.
   *
   * `--deck-t` is written straight to the element rather than held in state:
   * it changes every frame the page is moving, and re-rendering six tokens and
   * a readout at 60Hz to move one number is not a trade worth making. The
   * three-valued `phase` does go through state, and changes at most twice per
   * pass.
   */
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const pinned = window.matchMedia(PINNED);
    let frameId = 0;

    const read = (): void => {
      frameId = 0;
      const travelled = window.scrollY - section.offsetTop;
      let t: number;

      if (pinned.matches) {
        const range = (section.offsetHeight - window.innerHeight) * HANDOFF_SHARE;
        t = range > 0 ? clamp01(travelled / range) : travelled > HANDOFF_PX ? 1 : 0;
      } else {
        t = travelled > HANDOFF_PX ? 1 : 0;
      }

      section.style.setProperty('--deck-t', t.toFixed(4));
      setPhase(t < 0.02 ? 'intro' : t > 0.98 ? 'deck' : 'moving');
    };

    const schedule = (): void => {
      if (!frameId) frameId = requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    pinned.addEventListener('change', schedule);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      pinned.removeEventListener('change', schedule);
    };
  }, []);

  /** The cue does what the scroll it stands in for would do. */
  const advance = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    const range = Math.max(section.offsetHeight - window.innerHeight, window.innerHeight * 0.6);
    window.scrollTo({ top: section.offsetTop + range * HANDOFF_SHARE });
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
    >
      <div className="deck-pin">
        {/* ── The exhibit ─────────────────────────────────────────── */}
        <div className="deck-stage">
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
          >
            {frame.stage === 'particle' && <ParticleStage active={onScreen} />}
            {frame.stage === 'agent' && <AgentStage active={onScreen} />}
            {frame.stage === 'prompt' && <PromptStage active={onScreen} />}
            {frame.stage === 'reserved' && (
              <ReservedStage sigil={frame.sigil} title={frame.title} active={onScreen} />
            )}
            <span aria-hidden="true" className="deck-scan" />
          </div>

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
                {intro}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    tabIndex={landed ? -1 : undefined}
                    className="deck-lede-link text-muted hover:text-accent font-mono text-xs tracking-wide uppercase transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
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
                {frame.blurb}
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
                  className="text-muted hover:text-accent font-mono text-xs transition-colors"
                >
                  All projects
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
