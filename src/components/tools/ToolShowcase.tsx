import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screenFor, type Tone } from './showcase';

/**
 * ToolShowcase — the tools band, as one instrument instead of ten cards.
 *
 * ## What this replaces
 *
 * A grid of ten boxes, each holding a name, a sentence and an arrow. Ten
 * identical rectangles is not a menu, it is a wall, and nothing in it moves or
 * shows what any of the tools actually do. A visitor scanning it learns that
 * there are ten of something.
 *
 * So: a roster on the left, and on the right a screen that plays the selected
 * tool — its input typed out, then its output arriving row by row. The same
 * shape as the project deck at the top of the page, which is the point: the
 * site has one way of showing you a thing that runs.
 *
 * ## What does not move
 *
 * The selection. The screen animates, and it loops, but nothing advances the
 * roster on its own. A carousel that changes what you are reading while you are
 * reading it is the single most common way this pattern fails, and there is no
 * case for it when every option is already on screen.
 *
 * `prefers-reduced-motion` drops the typing and the stagger and shows the
 * finished screen, which is the same information without the theatre.
 */

export interface ShowcaseTool {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly href: string;
  readonly offline: boolean;
}

interface Props {
  tools: readonly ShowcaseTool[];
  /** Where "all tools" goes. */
  indexHref: string;
}

/** Milliseconds per character while the input types itself in. */
const TYPE_MS = 26;
/** Gap between output rows. */
const ROW_MS = 130;
/** How long the finished screen holds before it plays again. */
const HOLD_MS = 4200;

const TONE: Record<Tone, string> = {
  plain: 'text-fg',
  accent: 'text-accent',
  plus: 'text-[var(--c-ok)]',
  minus: 'text-alert',
  faint: 'text-faint',
};

export default function ToolShowcase({ tools, indexHref }: Props): React.ReactElement | null {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tool = tools[index];
  const screen = useMemo(() => (tool ? screenFor(tool.slug) : undefined), [tool]);

  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** How much of the input has been typed, and how many rows have landed. */
  const [typed, setTyped] = useState(0);
  const [rows, setRows] = useState(0);

  const total = screen?.input.length ?? 0;
  const rowCount = screen?.rows.length ?? 0;

  /*
   * One timer chain per play, restarted whenever the tool changes. Written as a
   * chain of timeouts rather than a rAF loop because it is a sequence of
   * discrete beats, not a continuous curve, and a chain expresses that without
   * a per-frame callback running for the life of the page.
   */
  useEffect(() => {
    if (!screen) return;

    if (reduced) {
      setTyped(total);
      setRows(rowCount);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const after = (ms: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, ms));
    };

    const play = (): void => {
      if (cancelled) return;
      setTyped(0);
      setRows(0);

      for (let i = 1; i <= total; i++) after(i * TYPE_MS, () => setTyped(i));
      const typeEnd = total * TYPE_MS + 220;
      for (let r = 1; r <= rowCount; r++) after(typeEnd + r * ROW_MS, () => setRows(r));

      after(typeEnd + rowCount * ROW_MS + HOLD_MS, play);
    };

    play();
    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, [screen, total, rowCount, reduced]);

  const go = useCallback(
    (next: number, focus = false) => {
      const n = tools.length;
      const wrapped = ((next % n) + n) % n;
      setIndex(wrapped);
      if (focus) itemRefs.current[wrapped]?.focus();
    },
    [tools.length],
  );

  const onKeyDown = useCallback(
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
        go(tools.length - 1, true);
      }
    },
    [go, index, tools.length],
  );

  if (!tool || !screen) return null;

  return (
    <div className="kit grid gap-0 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      {/* ── Roster ───────────────────────────────────────────────── */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Tools"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="border-line kit-list border lg:border-r-0"
      >
        {tools.map((entry, i) => {
          const on = i === index;
          return (
            <button
              key={entry.slug}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => go(i)}
              className="kit-item group"
            >
              <span className="kit-item-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="kit-item-name">{entry.name}</span>
              <span aria-hidden="true" className="kit-item-bar" />
            </button>
          );
        })}
      </div>

      {/* ── Screen ───────────────────────────────────────────────── */}
      <div className="border-line bg-surface relative flex min-w-0 flex-col border">
        <div className="border-line flex items-center gap-3 border-b px-4 py-2.5 lg:px-5">
          <span aria-hidden="true" className="kit-led" />
          <span className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
            {tool.slug}
          </span>
          <span className="text-faint ml-auto font-mono text-[10px] tracking-[0.14em] uppercase">
            {tool.offline ? 'runs offline' : 'sample'}
          </span>
        </div>

        {/*
          The screen replays from the top on every change, so it is keyed on the
          tool: React remounts it, the entrance animation runs again, and the
          cut reads as a channel change rather than as text being swapped.
        */}
        <div key={tool.slug} className="kit-screen min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-7">
          <p className="eyebrow">{screen.inputLabel}</p>
          <p className="text-fg mt-2 font-mono text-[13px] break-words sm:text-sm">
            <span className="text-accent mr-2">›</span>
            {screen.input.slice(0, typed)}
            {typed < total && <span aria-hidden="true" className="kit-caret" />}
          </p>

          <dl className="mt-6 space-y-2.5" aria-live="off">
            {screen.rows.slice(0, rows).map((row, i) => (
              <div
                key={`${row.label}-${i}`}
                className="kit-row flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[12px] sm:text-[13px]"
              >
                <dt className="text-faint w-[9.5rem] shrink-0 tracking-wide">{row.label}</dt>
                <dd className={`min-w-0 break-words ${TONE[row.tone ?? 'plain']}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-line flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t px-4 py-4 lg:px-6">
          <p className="text-muted prose-measure text-sm leading-relaxed">{tool.summary}</p>
          <div className="flex items-center gap-5">
            <a href={tool.href} className="kit-open group">
              Open
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
            <a
              href={indexHref}
              className="text-muted hover:text-accent font-mono text-xs whitespace-nowrap transition-colors"
            >
              All tools
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
