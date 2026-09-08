import React, { useCallback, useEffect, useRef, useState } from 'react';
import TokenStage from './stages/TokenStage';
import McpStage from './stages/McpStage';
import StringStage from './stages/StringStage';
import RestStage from './stages/RestStage';
import OtherStage from './stages/OtherStage';

export interface ShowcaseTool {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly href: string;
  readonly offline: boolean;
}

interface Props {
  tools?: readonly ShowcaseTool[];
  indexHref: string;
}

interface CuratedTool {
  id: string;
  index: string;
  name: string;
  tag: string;
  slug: string;
  href: string;
  offline: boolean;
  statusLabel: string;
}

const CURATED_TOOLS: CuratedTool[] = [
  {
    id: 'token-counter',
    index: '01',
    name: 'Token Counter',
    tag: 'Context budget & 2,400 models',
    slug: 'token-counter',
    href: '/tools/token-counter',
    offline: false,
    statusLabel: 'Static Pricing DB',
  },
  {
    id: 'mcp-tester',
    index: '02',
    name: 'MCP Tester',
    tag: 'Protocol handshake & inspector',
    slug: 'mcp-tester',
    href: '/tools/mcp-tester',
    offline: false,
    statusLabel: 'JSON-RPC 2.0 stdio / SSE',
  },
  {
    id: 'string-kit',
    index: '03',
    name: 'String Kit',
    tag: 'HTML to Markdown & 30+ transforms',
    slug: 'string-kit',
    href: '/tools/string-kit',
    offline: true,
    statusLabel: 'Runs 100% Offline',
  },
  {
    id: 'rest-reminder',
    index: '04',
    name: 'Rest Reminder',
    tag: 'Unthrottled ergonomic break clock',
    slug: 'rest-reminder',
    href: '/tools/rest-reminder',
    offline: true,
    statusLabel: 'Web Worker Resilient',
  },
  {
    id: 'other',
    index: '05',
    name: 'Other Instruments',
    tag: 'Diff, Chunking, WASM & 7 more',
    slug: 'all-tools',
    href: '/tools',
    offline: true,
    statusLabel: '11 Live Instruments',
  },
];

export default function ToolShowcase({ indexHref }: Props): React.ReactElement {
  const [active, setActive] = useState(0);
  const bandRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = CURATED_TOOLS.length;

  /*
   * Scroll drives the selection while the band is pinned on desktop.
   * Progress is measured from the point the band's top passes the top of the
   * viewport to the point its bottom does.
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

  /** Click on indicator or item: smooth scroll to frame or switch on mobile */
  const go = useCallback(
    (next: number, focus = false) => {
      const i = ((next % count) + count) % count;
      const band = bandRef.current;

      if (!band || !window.matchMedia('(min-width: 64rem)').matches) {
        setActive(i);
        if (focus) itemRefs.current[i]?.focus();
        return;
      }

      const rect = band.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const top = window.scrollY + rect.top + span * ((i + 0.5) / count);
      window.scrollTo({ top, behavior: 'smooth' });
      if (focus) itemRefs.current[i]?.focus();
    },
    [count],
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
        go(active + delta, true);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        go(0, true);
      }
      if (event.key === 'End') {
        event.preventDefault();
        go(count - 1, true);
      }
    },
    [active, count, go],
  );

  const currentTool = CURATED_TOOLS[active] ?? CURATED_TOOLS[0]!;

  return (
    <div ref={bandRef} className="tools-band">
      <div className="tools-pin w-full">
        <div className="kit shadow-panel border-line grid gap-0 border lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          {/* ── Left Rail / Roster ────────────────────────────────────── */}
          <div
            role="tablist"
            aria-label="Developer Tools"
            aria-orientation="vertical"
            onKeyDown={onKeyDown}
            className="border-line bg-surface/90 flex flex-col justify-between border-b lg:border-r lg:border-b-0"
          >
            <div className="divide-line/60 divide-y">
              {CURATED_TOOLS.map((item, i) => {
                const on = i === active;
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => go(i)}
                    className={`kit-item group relative flex w-full items-start gap-3 p-4 text-left transition-colors sm:p-5 ${
                      on ? 'bg-raised/70' : 'hover:bg-raised/30'
                    }`}
                  >
                    {/* Leading indicator bar */}
                    <span
                      aria-hidden="true"
                      className={`bg-accent-fill absolute inset-y-0 left-0 w-1 transition-transform duration-300 ${
                        on ? 'scale-y-100' : 'scale-y-0'
                      }`}
                    />

                    <span
                      className={`pt-0.5 font-mono text-xs tracking-wider tabular-nums transition-colors ${
                        on ? 'text-accent font-semibold' : 'text-faint group-hover:text-fg'
                      }`}
                    >
                      {item.index}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-mono text-sm font-medium transition-colors sm:text-base ${
                          on ? 'text-fg font-semibold' : 'text-muted group-hover:text-fg'
                        }`}
                      >
                        {item.name}
                      </p>
                      <p className="text-faint mt-0.5 truncate text-xs">{item.tag}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Scrub Indicator & Step Counter */}
            <div className="border-line/80 bg-surface flex items-center justify-between border-t px-4 py-3">
              <div className="flex gap-1.5">
                {CURATED_TOOLS.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Switch to ${item.name}`}
                    className="py-1"
                  >
                    <span
                      className={`block h-1 w-6 rounded-full transition-colors sm:w-7 ${
                        i === active ? 'bg-accent-fill' : 'bg-sunken hover:bg-muted'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <span className="text-faint font-mono text-[11px] tabular-nums">
                {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
              </span>
            </div>
          </div>

          {/* ── Right Stage / Screen ─────────────────────────────────── */}
          <div className="bg-surface relative flex min-w-0 flex-col">
            {/* Screen Top Header */}
            <div className="border-line bg-surface/80 flex items-center justify-between border-b px-4 py-3 backdrop-blur-xs sm:px-6">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="kit-led" />
                <span className="text-fg font-mono text-xs font-semibold tracking-wider uppercase">
                  {currentTool.name}
                </span>
                <span className="text-faint hidden font-mono text-[11px] sm:inline">
                  [{currentTool.slug}]
                </span>
              </div>

              <div className="text-faint flex items-center gap-2 font-mono text-[11px]">
                <span
                  className={`size-1.5 rounded-full ${
                    currentTool.offline ? 'bg-[var(--c-ok)]' : 'bg-accent'
                  }`}
                />
                <span>{currentTool.statusLabel}</span>
              </div>
            </div>

            {/* Dynamic Stage Body */}
            <div key={currentTool.id} className="tool-stage-panel min-w-0 flex-1 p-4 sm:p-6 lg:p-7">
              {active === 0 && <TokenStage href={currentTool.href} />}
              {active === 1 && <McpStage href={currentTool.href} />}
              {active === 2 && <StringStage href={currentTool.href} />}
              {active === 3 && <RestStage href={currentTool.href} />}
              {active === 4 && <OtherStage indexHref={indexHref} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
