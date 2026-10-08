import React, { useCallback, useEffect, useRef, useState } from 'react';
import TokenStage from './stages/TokenStage';
import McpStage from './stages/McpStage';
import StringStage from './stages/StringStage';
import RestStage from './stages/RestStage';
import OtherStage from './stages/OtherStage';
import ToolIcon from './ToolIcon';

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
    slug: 'token-counter',
    href: '/tools/token-counter',
    offline: false,
    statusLabel: 'Static Pricing DB',
  },
  {
    id: 'mcp-tester',
    index: '02',
    name: 'MCP Tester',
    slug: 'mcp-tester',
    href: '/tools/mcp-tester',
    offline: false,
    statusLabel: 'JSON-RPC 2.0 stdio / SSE',
  },
  {
    id: 'string-kit',
    index: '03',
    name: 'String Kit',
    slug: 'string-kit',
    href: '/tools/string-kit',
    offline: true,
    statusLabel: 'Runs 100% Offline',
  },
  {
    id: 'rest-reminder',
    index: '04',
    name: 'Rest Reminder',
    slug: 'rest-reminder',
    href: '/tools/rest-reminder',
    offline: true,
    statusLabel: 'Web Worker Resilient',
  },
  {
    id: 'other',
    index: '05',
    name: 'Other Instruments',
    slug: 'all-tools',
    href: '/tools',
    offline: true,
    statusLabel: 'Live instruments',
  },
];

export default function ToolShowcase({ tools = [], indexHref }: Props): React.ReactElement {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /*
   * The scroll range is the page's `.tools-band`, which also holds the section
   * heading so the pinned screen is heading and kit together. Falls back to
   * this island alone when rendered without that wrapper.
   */
  const band = useCallback(
    (): HTMLElement | null =>
      rootRef.current?.closest<HTMLElement>('.tools-band') ?? rootRef.current,
    [],
  );
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = CURATED_TOOLS.length;

  /*
   * Scroll drives the selection while the band is pinned on desktop.
   * Progress is measured from the point the band's top passes the top of the
   * viewport to the point its bottom does.
   */
  useEffect(() => {
    const el = band();
    if (!el) return;
    if (!window.matchMedia('(min-width: 64rem)').matches) return;

    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      if (span <= 0) return;
      // Only drive active frame when scrolling within the pinned band
      if (rect.top > 80 || rect.bottom < window.innerHeight - 80) return;
      const progress = Math.min(0.999, Math.max(0, -rect.top / span));
      setActive(Math.min(count - 1, Math.floor(progress * count)));
    };

    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [band, count]);

  /** Click on indicator or item: switch immediately and smooth scroll if desktop */
  const go = useCallback(
    (next: number, focus = false) => {
      const i = ((next % count) + count) % count;
      setActive(i);

      const el = band();
      if (el && window.matchMedia('(min-width: 64rem)').matches) {
        const rect = el.getBoundingClientRect();
        const span = rect.height - window.innerHeight;
        if (span > 0) {
          const top = window.scrollY + rect.top + span * ((i + 0.1) / count);
          window.scrollTo({ top, behavior: 'smooth' });
        }
      }
      if (focus) itemRefs.current[i]?.focus();
    },
    [band, count],
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
    <div ref={rootRef} className="w-full">
      <div className="w-full">
        <div className="kit shadow-panel border-line grid w-full gap-0 border lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
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
                    className={`kit-item group relative flex w-full items-center gap-3 p-4 text-left transition-colors sm:px-5 lg:py-5 ${
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
                      className={`font-mono text-xs tracking-wider tabular-nums transition-colors ${
                        on ? 'text-accent font-semibold' : 'text-faint group-hover:text-fg'
                      }`}
                    >
                      {item.index}
                    </span>

                    <span
                      className={`flex min-w-0 flex-1 items-center gap-3 transition-colors ${
                        on ? 'text-fg' : 'text-muted group-hover:text-fg'
                      }`}
                    >
                      <ToolIcon
                        slug={item.slug}
                        size={22}
                        className={`shrink-0 transition-colors ${on ? 'text-accent' : ''}`}
                      />
                      <span
                        className={`font-mono text-sm sm:text-base ${on ? 'font-semibold' : 'font-medium'}`}
                      >
                        {item.name}
                      </span>
                    </span>
                  </button>
                );
              })}

              {/*
              The way to the whole kit, in the roster itself. The last stage
              has a link too, but only for someone who scrolls that far.
            */}
              <div className="p-4">
                <a
                  href={indexHref}
                  className="bg-accent-fill text-accent-on-fill group flex h-11 w-full items-center justify-between px-4 text-sm font-semibold transition-opacity hover:opacity-85"
                >
                  <span>{tools.length > 0 ? `All ${tools.length} tools` : 'All tools'}</span>
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
                <ToolIcon slug={currentTool.slug} size={16} className="text-fg" />
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
                    currentTool.offline ? 'bg-[var(--c-ok)]' : 'bg-accent-fill'
                  }`}
                />
                <span>{currentTool.statusLabel}</span>
              </div>
            </div>

            {/* Dynamic Stage Body */}
            <div
              key={currentTool.id}
              className="tool-stage-panel flex min-w-0 flex-col p-4 sm:p-6 lg:h-[clamp(35rem,calc(100dvh-19rem),54rem)] lg:overflow-y-auto lg:p-8"
            >
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
