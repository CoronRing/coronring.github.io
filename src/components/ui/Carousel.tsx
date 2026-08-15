import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Carousel — one panel at a time, with the reference's segmented indicator.
 *
 * Exists to solve a density problem: three capability cards side by side is
 * three blocks of prose competing for the same glance. Paging them shows one,
 * which is the amount a visitor will actually read.
 *
 * Accessibility notes, since a carousel is easy to get wrong:
 *  - The viewport is a labelled group with `aria-roledescription="carousel"`.
 *  - Inactive panels are `hidden`, so they leave the tab order and are not
 *    announced — a screen reader never walks through invisible content.
 *  - Arrow keys page when focus is inside; buttons carry real labels.
 *  - Nothing auto-advances. Motion the reader didn't ask for is the single
 *    most common carousel failure, and there is no case for it here.
 */

export interface CarouselItem {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
}

interface Props {
  items: readonly CarouselItem[];
  label: string;
}

export default function Carousel({ items, label }: Props): React.ReactElement | null {
  const [active, setActive] = useState<number>(0);
  const regionRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const go = useCallback((delta: number) => setActive((i) => (i + delta + count) % count), [count]);

  useEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [go]);

  if (count === 0) return null;

  return (
    <div
      ref={regionRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className="relative"
    >
      {/* Panels */}
      <div className="min-h-[16rem]">
        {items.map((item, i) => (
          <article
            key={item.id}
            hidden={i !== active}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}: ${item.title}`}
          >
            <span className="eyebrow text-[var(--c-accent)]">{item.index}</span>

            <h3 className="display mt-4 text-3xl sm:text-4xl">{item.title}</h3>

            <p className="prose-measure mt-5 text-[15px] leading-relaxed text-[var(--c-text-muted)]">
              {item.body}
            </p>

            <ul className="mt-6 flex flex-wrap gap-2">
              {item.tags.map((t) => (
                <li
                  key={t}
                  className="border border-[var(--c-line)] px-2.5 py-1 font-mono text-[10px] tracking-wide text-[var(--c-text-faint)] uppercase"
                >
                  {t}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {/* Controls: segmented indicator + paging buttons */}
      <div className="mt-10 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {/* Each segment is a real button — the indicator doubles as nav. */}
          <ul className="flex gap-1.5">
            {items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Show ${item.title}`}
                  aria-current={i === active ? 'true' : undefined}
                  className="group block py-2"
                >
                  <span
                    className={`block h-[3px] w-10 transition-colors ${
                      i === active
                        ? 'bg-[var(--c-accent-fill)]'
                        : 'bg-[var(--c-line)] group-hover:bg-[var(--c-text-faint)]'
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>

          <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
            {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </span>
        </div>

        <div className="flex gap-2">
          <PageButton dir="prev" onClick={() => go(-1)} />
          <PageButton dir="next" onClick={() => go(1)} />
        </div>
      </div>
    </div>
  );
}

/** Circular hatched paging button, matching the reference's control style. */
function PageButton({
  dir,
  onClick,
}: {
  dir: 'prev' | 'next';
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === 'prev' ? 'Previous' : 'Next'}
      className="hatch grid size-11 place-items-center rounded-full border border-[var(--c-line)] text-[var(--c-text)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={dir === 'prev' ? 'rotate-180' : ''}
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
