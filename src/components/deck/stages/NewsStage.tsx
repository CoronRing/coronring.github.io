import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NEWSRING, NEWSRING_SOURCES, type NewsFeed } from '../../../data/newsring';
import { isDarkTheme, readToken } from '../../../lib/particle-theme';
import { href } from '../../../lib/url';
import { sampleCanvas, type Snapshot } from '../seed';
import { Segment, StageShell } from '../StageShell';
import { NewsDial, type DialLayout, type DialPalette } from './news-dial';

/**
 * NewsStage: this morning's NewsRing digest, as the selection that made it.
 *
 * The digest itself is a page of text, and a page of text is not an exhibit.
 * What is worth seeing is how it was made: thirty-five sources read in full,
 * a hundred-odd candidates, and a handful chosen for one reader. So the stage
 * draws that (`news-dial.ts`) and puts each chosen story's headline in the
 * middle of the ring as it arrives.
 *
 * The data is live. The feed is fetched when the frame is shown, from the same
 * fixed URL the News Today post reads, so the deck shows today's selection with
 * no rebuild of this site. If it cannot be fetched the dial still runs, and the
 * middle says so rather than showing invented headlines.
 */

interface Props {
  active: boolean;
  onSnapshot?: (snapshot: Snapshot | null) => void;
}

type View = 'digest' | 'top';

const VIEW_OPTIONS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'digest', label: 'My digest' },
  { value: 'top', label: 'Top 3' },
];

/** One story as the middle of the ring shows it. */
interface Pick {
  kicker: string;
  headline: string;
  url: string | null;
  source: number;
}

type Load = { state: 'loading' } | { state: 'ready'; feed: NewsFeed } | { state: 'failed' };

/** Bottom of the stage the deck's control row covers, matched to `--deck-chrome-h`. */
const CHROME_PX = 136;

function readPalette(): DialPalette {
  const dark = isDarkTheme();
  return {
    line: readToken('--c-line', '#303035'),
    lineStrong: readToken('--c-line-strong', '#4a4a51'),
    dot: readToken('--c-text-muted', '#a0a0a6'),
    faint: readToken('--c-text-faint', '#6e6e75'),
    text: readToken('--c-text', '#f5f5f5'),
    ground: readToken('--c-ground', '#0a0a0b'),
    accent: dark ? readToken('--c-accent-fill', '#fffa00') : readToken('--c-accent', '#7a7500'),
    dark,
  };
}

/** Index on the dial of a source, by NewsRing's own name for it. */
function sourceByName(name: string): number {
  const i = NEWSRING_SOURCES.findIndex((s) => s.name === name);
  return i >= 0 ? i : hashIndex(name);
}

/** Index on the dial of the source an article URL most likely came from. */
function sourceByUrl(url: string): number {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return hashIndex(url);
  }
  const i = NEWSRING_SOURCES.findIndex((s) =>
    s.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
  return i >= 0 ? i : hashIndex(host);
}

/** A stable spot on the dial for anything that matches no source. */
function hashIndex(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % NEWSRING_SOURCES.length;
}

function picksFor(feed: NewsFeed, view: View): Pick[] {
  if (view === 'top') {
    return feed.headlines.map((h) => ({
      kicker: h.kicker,
      headline: h.headline,
      url: h.link.url,
      source: sourceByUrl(h.link.url),
    }));
  }
  return feed.stories.map((s) => {
    const source = sourceByName(s.source);
    return {
      kicker: NEWSRING_SOURCES[source]?.short ?? s.source,
      headline: s.headline,
      url: s.links[0]?.url ?? null,
      source,
    };
  });
}

/** `"35 of 35 sources read. 128 candidates, …"` → the two numbers. */
function readStats(stats: string): { sources: number | null; candidates: number | null } {
  const sources = /(\d+) of (\d+) sources/.exec(stats);
  const candidates = /(\d+) candidates/.exec(stats);
  return {
    sources: sources ? Number(sources[2]) : null,
    candidates: candidates ? Number(candidates[1]) : null,
  };
}

/** `2026-10-14` → `Oct 14`, read as a calendar date rather than a UTC instant. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NewsStage({ active, onSnapshot }: Props): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const shapeRef = useRef<HTMLCanvasElement | null>(null);
  const typeRef = useRef<HTMLCanvasElement | null>(null);
  const dialRef = useRef<NewsDial | null>(null);
  const reduced = useRef(false);

  const [view, setView] = useState<View>('digest');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [shown, setShown] = useState(-1);
  const [layout, setLayout] = useState<DialLayout | null>(null);
  const [reading, setReading] = useState<{ read: number; total: number } | null>(null);

  const picks = useMemo(
    () => (load.state === 'ready' ? picksFor(load.feed, view) : []),
    [load, view],
  );
  const stats = useMemo(() => (load.state === 'ready' ? readStats(load.feed.stats) : null), [load]);

  // ── Fetch today's feed ────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    fetch(NEWSRING.feed, { cache: 'no-cache', signal: controller.signal })
      .then((r) =>
        r.ok ? (r.json() as Promise<NewsFeed>) : Promise.reject(new Error(`${r.status}`)),
      )
      .then((feed) => {
        if (feed.version !== 1) throw new Error('unsupported feed version');
        setLoad({ state: 'ready', feed });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'failed' });
      });
    return () => controller.abort();
  }, []);

  // ── Build the dial. Once. ─────────────────────────────────────────
  useEffect(() => {
    const element = boxRef.current;
    const shape = shapeRef.current;
    const type = typeRef.current;
    if (!element || !shape || !type) return;
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let dial: NewsDial;
    try {
      dial = new NewsDial(
        shape,
        type,
        readPalette(),
        NEWSRING_SOURCES.map((s) => s.short),
      );
    } catch {
      return;
    }
    dialRef.current = dial;
    dial.onLand = (story) => setShown(story);
    dial.onCycle = () => setShown(-1);

    const desktop = window.matchMedia('(min-width: 64rem)');
    const fit = (): void => {
      const rect = element.getBoundingClientRect();
      setLayout(
        dial.resize(
          rect.width,
          rect.height,
          Math.min(2, window.devicePixelRatio || 1),
          desktop.matches ? CHROME_PX : 56,
        ),
      );
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(element);
    void document.fonts?.ready.then(() => dial.draw());

    onSnapshot?.(() => sampleCanvas(shape, [shape, type]));

    return () => {
      ro.disconnect();
      dial.stop();
      dialRef.current = null;
      onSnapshot?.(null);
    };
  }, [onSnapshot]);

  // ── Feed the selection in, and replay it when the view changes ────
  useEffect(() => {
    const dial = dialRef.current;
    if (!dial) return;
    // Without a feed the dial still turns over, with nothing picked.
    dial.setSelection(
      picks.map((p) => p.source),
      stats?.candidates ?? 120,
    );
    if (reduced.current) dial.settle();
  }, [picks, stats]);

  useEffect(() => {
    const dial = dialRef.current;
    if (!dial || reduced.current) return;
    if (active) dial.start();
    else dial.stop();
  }, [active]);

  useEffect(() => {
    const retheme = (): void => dialRef.current?.setPalette(readPalette());
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', retheme);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', retheme);
    };
  }, []);

  // ── The reading counter, sampled while the stream is running ──────
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const p = dialRef.current?.progress();
      if (!p) return;
      setReading(p.phase === 'reading' ? { read: p.read, total: p.total } : null);
    }, 120);
    return () => window.clearInterval(id);
  }, [active]);

  const onPointerEnter = useCallback(() => dialRef.current?.setPaused(true), []);
  const onPointerLeave = useCallback(() => dialRef.current?.setPaused(false), []);

  const current = shown >= 0 ? picks[shown] : undefined;
  /** A small ring (a phone) has room for the headline and nothing else. */
  const compact = layout !== null && layout.inner < 120;
  const date = load.state === 'ready' ? shortDate(load.feed.date) : null;

  return (
    <StageShell
      readout={
        <span className="flex items-center gap-3">
          <span>
            <span className="opacity-60">SOURCES </span>
            {stats?.sources ?? NEWSRING_SOURCES.length}
          </span>
          {stats?.candidates != null && (
            <span>
              <span className="opacity-60">CANDIDATES </span>
              {stats.candidates}
            </span>
          )}
          {picks.length > 0 && (
            <span className="text-accent">
              <span className="opacity-70">PICKED </span>
              {picks.length}
            </span>
          )}
        </span>
      }
      hint="Every dot is a story from one of the sources on the ring · most are dropped · the yellow ones made today's digest"
      controls={<Segment label="Feed" value={view} options={VIEW_OPTIONS} onChange={setView} />}
    >
      <div
        ref={boxRef}
        className="relative size-full"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <canvas
          ref={shapeRef}
          role="img"
          aria-label="A ring of news sources, with stories flowing inward. Most are dropped; the ones picked for today's digest reach the inner ring."
          className="absolute inset-0 size-full"
        />
        <canvas ref={typeRef} aria-hidden="true" className="absolute inset-0 size-full" />

        {layout && (
          <div
            className="deck-news-core absolute flex flex-col items-center justify-center text-center"
            style={
              {
                left: layout.cx,
                top: layout.cy,
                '--core': `${layout.inner}px`,
              } as React.CSSProperties
            }
          >
            <p className={`eyebrow text-[9.5px] ${compact ? 'hidden' : ''}`}>
              {date ? `News today · ${date}` : 'News today'}
              {current && picks.length > 1 && (
                <span className="text-faint">
                  {' '}
                  · {String(shown + 1).padStart(2, '0')}/{String(picks.length).padStart(2, '0')}
                </span>
              )}
            </p>

            {load.state === 'failed' ? (
              <p className="text-muted mt-3 text-sm leading-relaxed">
                Today&rsquo;s digest could not be loaded here. It is published every morning at 9:00
                Pacific.
              </p>
            ) : current ? (
              <div key={`${view}-${shown}`} className="deck-news-story">
                <p className="text-accent mt-3 font-mono text-[10px] tracking-[0.14em] uppercase">
                  {current.kicker}
                </p>
                <p className="deck-news-headline display mt-2">{current.headline}</p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="display text-[clamp(1.5rem,calc(var(--core)*0.17),2.5rem)] tabular-nums">
                  {reading ? reading.read : load.state === 'loading' ? '…' : picks.length}
                </p>
                <p className="text-faint mt-1 font-mono text-[10px] tracking-[0.14em] uppercase">
                  {reading
                    ? `candidates read, of ${reading.total}`
                    : load.state === 'loading'
                      ? 'Reading the feed'
                      : 'Selecting'}
                </p>
              </div>
            )}

            <a
              href={href('/blog/news-today')}
              className={`deck-news-link mt-4 ${compact ? 'hidden' : ''}`}
            >
              Read today&rsquo;s digest
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
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
        )}
      </div>
    </StageShell>
  );
}
