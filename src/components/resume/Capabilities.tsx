import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Capabilities — the "Myself" band.
 *
 * Three things I do, and for each of them the proof: a figure, one line, and
 * the role it came from. The full bullets live on `/resume`; this band is the
 * glance, so nothing in it runs past a line or two.
 *
 * ## Why one island and not two
 *
 * The list and the proof column are the same selection: picking "agent
 * systems" has to change both, or the column is a static list of jobs sitting
 * next to a claim it does not support. Two Astro islands cannot share a state
 * without a store, so this is one.
 *
 * ## All three names stay on screen
 *
 * The capabilities are an accordion rather than a paged carousel: every name is
 * visible, the active one is expanded, and the others are the controls. A row
 * of unlabelled bars asked the visitor to guess what was behind them.
 *
 * ## Scrolling is the control
 *
 * From `lg` the band (`.cap-band`, in the page) is taller than the viewport and
 * its screen is pinned, and the selection advances as it passes: one capability
 * per third of the pinned range. The band is found with `closest()` so the
 * section heading can sit inside the pinned screen without crossing the island
 * boundary.
 *
 * Clicking a name *scrolls* rather than setting state directly. Setting state
 * would fight the scroll handler on the very next frame; scrolling makes the
 * two agree by construction.
 *
 * Below `lg` there is no pin, since a long pinned section on a phone is the
 * pattern people complain about most, so a click sets the selection and that
 * is all.
 */

/**
 * A single-colour mark drawn in the text colour.
 *
 * Rendered as a CSS mask over `currentColor`, so one file serves both themes
 * and the mark sits in the same ink as the figures beside it.
 */
export interface ProofLogo {
  /** URL of a single-colour SVG under `public/`. */
  src: string;
  /** Accessible name, e.g. `"University of Toronto"`. */
  alt: string;
  /** Width over height of the artwork, so the slot keeps its shape. */
  ratio: number;
}

/** What leads the row: a figure in the display face, or a logo. */
export type ProofMark = { kind: 'figure'; text: string } | ({ kind: 'logo' } & ProofLogo);

export interface Proof {
  /** The headline: a short figure such as `"90%"`, or a logo. */
  mark: ProofMark;
  /** One line saying what the mark stands for. */
  claim: string;
  /** Pre-formatted credit, e.g. `"Applied ML Engineer · Railtown AI · 2023–2025"`. */
  source?: string;
}

export interface Pillar {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  /** One sentence. */
  readonly body: string;
  readonly tags: readonly string[];
  readonly proof: readonly Proof[];
}

interface Props {
  pillars: readonly Pillar[];
  label: string;
}

const PINNED = '(min-width: 64rem)';

export default function Capabilities({ pillars, label }: Props): React.ReactElement | null {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = pillars.length;

  /** The scroll range: the page's `.cap-band` wrapper, or this island alone. */
  const band = useCallback(
    (): HTMLElement | null => rootRef.current?.closest<HTMLElement>('.cap-band') ?? rootRef.current,
    [],
  );

  /*
   * Scroll drives the selection while the band is pinned.
   *
   * Progress runs from the band's top reaching the top of the viewport to its
   * bottom reaching the bottom, which is exactly the span the sticky screen is
   * held for, so the thirds line up with what is on screen.
   */
  useEffect(() => {
    const el = band();
    if (!el) return;
    if (!window.matchMedia(PINNED).matches) return;

    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      if (span <= 0) return;
      const progress = Math.min(0.999, Math.max(0, -rect.top / span));
      setActive(Math.min(count - 1, Math.floor(progress * count)));
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [band, count]);

  /** Select a capability: scroll to its third of the band, or just switch on a phone. */
  const go = useCallback(
    (i: number) => {
      const el = band();
      if (!el || !window.matchMedia(PINNED).matches) {
        setActive(i);
        return;
      }
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const top = window.scrollY + rect.top + span * ((i + 0.5) / count);
      window.scrollTo({ top, behavior: 'smooth' });
    },
    [band, count],
  );

  if (count === 0) return null;
  const pillar = pillars[active] ?? pillars[0]!;
  const proofId = 'cap-proof';

  return (
    <div
      ref={rootRef}
      className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-20"
    >
      {/* ── The capabilities ─────────────────────────────────────── */}
      <ul aria-label={label} className="cap-list">
        {pillars.map((item, i) => {
          const on = i === active;
          const bodyId = `cap-body-${item.id}`;
          return (
            <li key={item.id} className="cap-item" data-active={on || undefined}>
              <h3>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-expanded={on}
                  aria-controls={`${bodyId} ${proofId}`}
                  className="cap-trigger group"
                >
                  <span className="cap-index font-mono text-[11px] tabular-nums">{item.index}</span>
                  <span className="cap-title display text-2xl sm:text-3xl xl:text-4xl">
                    {item.title}
                  </span>
                </button>
              </h3>
              <div id={bodyId} className="cap-body" aria-hidden={!on}>
                <div className="min-h-0">
                  <p className="text-muted prose-measure pt-3 text-[15px] leading-relaxed">
                    {item.body}
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-2 pb-1">
                    {item.tags.map((t) => (
                      <li
                        key={t}
                        className="border-line text-muted border px-2.5 py-1 font-mono text-[10px] tracking-wide uppercase"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* ── The proof ────────────────────────────────────────────── */}
      <div id={proofId} className="min-w-0" aria-live="polite">
        <p className="eyebrow">Proof</p>
        <ul key={pillar.id} className="divide-line cap-proof mt-4 divide-y">
          {pillar.proof.map((p) => (
            <li
              key={p.claim}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-5 py-5"
            >
              {p.mark.kind === 'figure' ? (
                <span className="display text-3xl leading-none normal-case">{p.mark.text}</span>
              ) : (
                <span
                  role="img"
                  aria-label={p.mark.alt}
                  className="cap-logo"
                  style={
                    {
                      '--logo': `url("${p.mark.src}")`,
                      aspectRatio: String(p.mark.ratio),
                    } as React.CSSProperties
                  }
                />
              )}
              <span className="min-w-0">
                <span className="block text-[15px] leading-snug">{p.claim}</span>
                {p.source && (
                  <span className="text-faint mt-2 block font-mono text-[10px] tracking-wide uppercase">
                    {p.source}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
