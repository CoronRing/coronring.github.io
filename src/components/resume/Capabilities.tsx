import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Capabilities — the "Myself" band.
 *
 * Three things I do, and for each of them the work that is the evidence for it.
 *
 * ## Why one island and not two
 *
 * The panel and the column beside it are the same selection: picking "agent
 * systems" has to change both, or the column is a static list of jobs sitting
 * next to a claim it does not support. Two Astro islands cannot share a state
 * without a store, so this is one.
 *
 * ## Scrolling is the control
 *
 * From `lg` the band is taller than the viewport and pinned, and the panel
 * advances as it passes: one pillar per third of the pinned range. That is the
 * behaviour the deck at the top of the page already established, and it means
 * the section reads itself out to someone who only scrolls.
 *
 * The indicator is still a control, and clicking it *scrolls* rather than
 * setting state directly. Setting state directly would fight the scroll handler
 * on the very next frame; scrolling makes the two agree by construction, and
 * turns the indicator into a scrub bar for the band it belongs to.
 *
 * Below `lg` there is no pin — a long pinned section on a phone is the pattern
 * people complain about most — so the indicator sets the panel and that is all.
 */

export interface Evidence {
  /** e.g. "Applied ML Engineer". */
  role: string;
  organization: string;
  /** Pre-formatted, because the date helpers live on the server side. */
  period: string;
  /** The one line of this role that is evidence for *this* capability. */
  note: string;
}

export interface Pillar {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly evidence: readonly Evidence[];
}

interface Props {
  pillars: readonly Pillar[];
  label: string;
}

export default function Capabilities({ pillars, label }: Props): React.ReactElement | null {
  const [active, setActive] = useState(0);
  const bandRef = useRef<HTMLDivElement>(null);
  const count = pillars.length;

  /*
   * Scroll drives the selection while the band is pinned.
   *
   * Progress is measured from the point the band's top passes the top of the
   * viewport to the point its bottom does, which is exactly the span the sticky
   * child is held for, so the three thirds line up with what is on screen.
   */
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    if (!window.matchMedia('(min-width: 64rem)').matches) return;

    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const rect = band.getBoundingClientRect();
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
  }, [count]);

  /** Click on the indicator: scroll to the band, or just switch on a phone. */
  const go = useCallback(
    (next: number) => {
      const n = pillars.length;
      const i = ((next % n) + n) % n;
      const band = bandRef.current;

      if (!band || !window.matchMedia('(min-width: 64rem)').matches) {
        setActive(i);
        return;
      }

      const rect = band.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const top = window.scrollY + rect.top + span * ((i + 0.5) / n);
      window.scrollTo({ top, behavior: 'smooth' });
    },
    [pillars.length],
  );

  if (count === 0) return null;
  const pillar = pillars[active] ?? pillars[0]!;

  return (
    <div ref={bandRef} className="cap-band">
      <div className="cap-pin grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-20">
        {/* ── The claim ────────────────────────────────────────────── */}
        <div
          role="group"
          aria-roledescription="carousel"
          aria-label={label}
          className="flex min-w-0 flex-col"
        >
          <div key={pillar.id} className="cap-panel min-h-[15rem]">
            <span className="eyebrow text-accent">{pillar.index}</span>
            <h3 className="display mt-4 text-3xl sm:text-4xl">{pillar.title}</h3>
            <p className="text-muted prose-measure mt-5 text-[15px] leading-relaxed">
              {pillar.body}
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {pillar.tags.map((t) => (
                <li
                  key={t}
                  className="border-line text-faint border px-2.5 py-1 font-mono text-[10px] tracking-wide uppercase"
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 flex items-center gap-4">
            <ul className="flex gap-1.5">
              {pillars.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Show ${item.title}`}
                    aria-current={i === active ? 'true' : undefined}
                    className="group block py-2"
                  >
                    <span
                      className={`block h-[3px] w-12 transition-colors ${
                        i === active
                          ? 'bg-accent-fill'
                          : 'bg-line group-hover:bg-[var(--c-text-faint)]'
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
            <span className="text-faint font-mono text-[11px] tabular-nums">
              {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* ── The evidence ─────────────────────────────────────────── */}
        <div className="min-w-0">
          <p className="eyebrow">Where it came from</p>
          <ul key={pillar.id} className="divide-line cap-evidence mt-5 divide-y">
            {pillar.evidence.map((entry, i) => (
              <li key={`${entry.organization}-${i}`} className="py-4">
                <p className="text-faint font-mono text-[11px] tabular-nums">{entry.period}</p>
                <p className="mt-1.5 text-sm">{entry.role}</p>
                <p className="text-accent text-sm">{entry.organization}</p>
                <p className="text-muted mt-2 text-[13px] leading-relaxed">{entry.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
