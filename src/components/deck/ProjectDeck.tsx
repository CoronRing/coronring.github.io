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
 * ## Two states, one screen
 *
 * **Intro.** A name, what the name does, one line, and the exhibit running
 * edge to edge behind all of it. Nothing else: no rail, no controls, no
 * counter. A visitor who has been here for one second is not choosing between
 * six projects, they are deciding whether to stay.
 *
 * **Deck.** The moment they scroll — any amount — the introduction folds up
 * into two lines at the top, the roster slides in from the left, and the
 * controls rise from the bottom. Same canvas, same instance, no reload: the
 * page turns from a title card into an instrument while the exhibit carries on
 * running through both.
 *
 * The section is taller than the viewport with the whole of it pinned, so the
 * first scroll buys the transition rather than scrolling the introduction off
 * the top. What is left of the pinned range is dwell: the cloud spins up with
 * the scroll (see `ParticleStage`), so the extra distance pays for itself
 * before the page releases into the work below.
 *
 * ## The exhibit is the page
 *
 * The canvas is full-bleed in both states and never resized between them —
 * everything else floats over it, held legible by a scrim rather than by being
 * given a column of its own. That is the largest the exhibit can be, and it
 * means the transition costs the engine nothing.
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

/** Anything past this and the visitor has decided to look at the page. */
const HANDOFF_PX = 24;

/**
 * Display size for a frame title, stepped by length.
 *
 * The measure is fixed and the display face is wide, so one size cannot hold
 * both `Evaluation` and `gs_prompt_manager`. Setting long names smaller is the
 * ordinary typographic answer and what the reference does with its own longer
 * operator names; the alternative is a hyphenless mid-word break, which is
 * what `GS_PROMPT_M / ANAGER` looked like.
 */
function titleSize(title: string): string {
  if (title.length > 15) return 'text-[clamp(1.35rem,1.9vw,1.9rem)]';
  if (title.length > 12) return 'text-[clamp(1.6rem,2.2vw,2.3rem)]';
  return 'text-[clamp(1.85rem,2.6vw,2.75rem)]';
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
  const [phase, setPhase] = useState<'intro' | 'deck'>('intro');
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
   * Any scroll at all, and a wheel or a swipe that has not moved the page yet,
   * because the section is pinned and the first notch of a trackpad gesture
   * should be answered by something. Once made, it does not go back: a page
   * that returns to its title card when the visitor scrolls up is a page that
   * has lost their place.
   */
  useEffect(() => {
    if (phase === 'deck') return;

    const advance = (): void => setPhase('deck');
    const onScroll = (): void => {
      if (window.scrollY > HANDOFF_PX) advance();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (['ArrowDown', 'PageDown', 'End', ' ', 'Tab'].includes(event.key)) advance();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', advance, { passive: true, once: true });
    window.addEventListener('touchmove', advance, { passive: true, once: true });
    window.addEventListener('keydown', onKey);
    // A reload part-way down the page starts where the visitor left off.
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', advance);
      window.removeEventListener('touchmove', advance);
      window.removeEventListener('keydown', onKey);
    };
  }, [phase]);

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

  const deck = phase === 'deck';

  /*
   * The layer that is not in play is hidden with `visibility`, set in CSS off
   * `data-phase`. That is what takes it out of the tab order and the
   * accessibility tree; `aria-hidden` alone would leave it focusable, and
   * `display: none` would kill the transition it is supposed to animate out of.
   */

  return (
    <section
      ref={sectionRef}
      id="top"
      aria-label="Introduction and selected work"
      data-phase={phase}
      className="deck border-line relative border-b"
    >
      <div className="deck-pin">
        {/* ── The exhibit, full bleed, in both states ─────────────── */}
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
            key={deck ? frame.id : frames[0]!.id}
            id={`${uid}-panel`}
            role="tabpanel"
            aria-labelledby={`${uid}-tab-${frame.id}`}
            tabIndex={-1}
            className="deck-stage-inner"
          >
            {(!deck || frame.stage === 'particle') && (
              <ParticleStage active={onScreen} chrome={deck} />
            )}
            {deck && frame.stage === 'agent' && <AgentStage active={onScreen} />}
            {deck && frame.stage === 'prompt' && <PromptStage active={onScreen} />}
            {deck && frame.stage === 'reserved' && (
              <ReservedStage sigil={frame.sigil} title={frame.title} active={onScreen} />
            )}
            <span aria-hidden="true" className="deck-scan" />
          </div>

          <span aria-hidden="true" className="deck-vignette" />
        </div>

        {/* Holds the type legible over the canvas, in whichever direction the
            copy sits from it at this width. */}
        <span aria-hidden="true" className="deck-scrim" />

        {/* ── The landing card ────────────────────────────────────── */}
        <div className="deck-intro" aria-hidden={deck}>
          <p className="deck-intro-name display">{name}</p>
          <p className="eyebrow eyebrow-marked mt-4">{role}</p>
          <p className="text-muted prose-measure mt-6 text-base leading-relaxed sm:text-lg">
            {intro}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="deck-intro-link text-muted hover:text-accent font-mono text-xs tracking-wide uppercase transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* ── The roster ──────────────────────────────────────────── */}
        <div className="deck-rail" aria-hidden={!deck}>
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
        <div className="deck-copy" aria-hidden={!deck}>
          {/*
            The masthead, folded to two lines. Everything the landing card said
            at full size is either here in miniature or gone: what a visitor
            needs at this point is which project they are looking at.
          */}
          <div className="deck-fold">
            <p className="deck-name display">{name}</p>
            <p className="eyebrow mt-1.5">{role}</p>
          </div>

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

        {/*
          A button rather than a link. In the intro state there is nowhere to
          go: what the visitor wants is the deck, and that is a state change on
          this section, not a destination.
        */}
        <button
          type="button"
          className="deck-cue"
          aria-label="Show the projects"
          onClick={() => setPhase('deck')}
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
