import { useCallback, useEffect, useRef, useState } from 'react';
import { isDarkTheme, readToken } from '../../../lib/particle-theme';
import { sampleCanvas, type Snapshot } from '../seed';
import { Segment, StageShell } from '../StageShell';
import {
  AgentFlow,
  type FlowKind,
  type FlowPalette,
  type FlowStats,
  type HoverInfo,
} from './agent-flow';

/**
 * RailtracksStage: an agent run that never ends, traced as it happens.
 *
 * Railtracks is a framework, and a framework has no screen of its own to show.
 * What it does have is a shape: an agent loop that calls tools, hands work to
 * subagents, and gets their results back. So the exhibit draws that shape live
 * (see `agent-flow.ts` for the picture and why it is drawn the way it is), in
 * the colours the deck uses for nothing else, and lets the visitor stop it and
 * read any part of it.
 *
 * ## Two canvases
 *
 * Lines and nodes on one, type on the other. The deck reads the first back as
 * particles when it cuts to Particle Wave (`../seed.ts`), and type turned into
 * particles reads as noise.
 *
 * ## The cursor slows it
 *
 * The paper slows as the cursor nears the drawing and stops on an item, which
 * gets a card; across the box from the drawing it barely slows at all. "Hold"
 * stops it outright, for a visitor without a cursor.
 */

interface Props {
  /** True while this frame is the one on the deck. Drives pause/resume. */
  active: boolean;
  /** Registers how to read the picture back, for the cut to Particle Wave. */
  onSnapshot?: (snapshot: Snapshot | null) => void;
}

const RUN_OPTIONS = [
  { value: 'live', label: 'Live' },
  { value: 'hold', label: 'Hold' },
] as const;

type RunState = (typeof RUN_OPTIONS)[number]['value'];

/** What each kind of item is called on its hover card. */
const KIND_LABEL: Record<FlowKind, string> = {
  flow: 'Flow',
  llm: 'Model call',
  tool: 'Tool call',
  agent: 'Subagent',
  merge: 'Result',
  done: 'Run complete',
};

/** The legend: one swatch per thing the picture distinguishes. */
const LEGEND: ReadonlyArray<{ label: string; token: string; shape: 'line' | 'square' }> = [
  { label: 'Agent', token: '--c-flow-main', shape: 'line' },
  { label: 'Subagent', token: '--c-flow-sub', shape: 'line' },
  { label: 'Nested', token: '--c-flow-sub2', shape: 'line' },
  { label: 'Tool', token: '--c-flow-tool', shape: 'square' },
];

function readPalette(): FlowPalette {
  const dark = isDarkTheme();
  return {
    depth: [
      readToken('--c-flow-main', '#fffa00'),
      readToken('--c-flow-sub', '#3ddad7'),
      readToken('--c-flow-sub2', '#a78bfa'),
    ],
    tool: readToken('--c-flow-tool', '#a0a0a6'),
    ground: readToken('--c-ground', '#0a0a0b'),
    text: readToken('--c-text', '#f5f5f5'),
    faint: readToken('--c-text-faint', '#6e6e75'),
    // Yellow is a light source on dark; on paper the olive carries it.
    accent: dark ? readToken('--c-accent-fill', '#fffa00') : readToken('--c-accent', '#7a7500'),
    dark,
  };
}

/** Tell the loading veil the exhibit is drawn. See `components/layout/Veil.astro`. */
function settle(): void {
  window.dispatchEvent(new Event('coronring:exhibit-ready'));
}

export default function RailtracksStage({ active, onSnapshot }: Props): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const shapeRef = useRef<HTMLCanvasElement | null>(null);
  const typeRef = useRef<HTMLCanvasElement | null>(null);
  const flowRef = useRef<AgentFlow | null>(null);

  const [run, setRun] = useState<RunState>('live');
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [stats, setStats] = useState<FlowStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const reduced = useRef(false);

  // ── Build the engine. Once. ───────────────────────────────────────
  useEffect(() => {
    const element = boxRef.current;
    const shape = shapeRef.current;
    const type = typeRef.current;
    if (!element || !shape || !type) return;

    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let flow: AgentFlow;
    try {
      flow = new AgentFlow(shape, type, readPalette(), Math.random);
    } catch {
      setFailed(true);
      settle();
      return;
    }
    flowRef.current = flow;
    flow.onHover = (info) => setHover(info);

    const fit = (): void => {
      const rect = element.getBoundingClientRect();
      flow.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
      setBox({ width: rect.width, height: rect.height });
    };
    fit();
    // Open on a history, not an empty sheet.
    flow.preroll(element.clientHeight * 0.95);
    flow.draw();
    settle();

    const ro = new ResizeObserver(fit);
    ro.observe(element);

    // Labels are drawn in the site's mono face; redraw once it has arrived.
    void document.fonts?.ready.then(() => flow.draw());

    onSnapshot?.(() => sampleCanvas(shape, [shape, type], { step: 1.6, threshold: 70 }));

    return () => {
      ro.disconnect();
      flow.stop();
      flowRef.current = null;
      onSnapshot?.(null);
    };
  }, [onSnapshot]);

  // ── Only run while this frame is on the deck ──────────────────────
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || reduced.current) return;
    if (active) flow.start();
    else flow.stop();
  }, [active]);

  useEffect(() => {
    flowRef.current?.setHeld(run === 'hold');
  }, [run]);

  // ── Readout, sampled rather than per frame ────────────────────────
  useEffect(() => {
    if (!active) return;
    const tick = (): void => {
      const s = flowRef.current?.stats();
      if (s) setStats(s);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [active]);

  // ── Re-theme with the rest of the page ────────────────────────────
  useEffect(() => {
    const retheme = (): void => flowRef.current?.setPalette(readPalette());
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', retheme);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', retheme);
    };
  }, []);

  // ── The cursor: the engine slows near it and reports what is under it ──
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = boxRef.current;
    if (!element || event.pointerType === 'touch') return;
    const rect = element.getBoundingClientRect();
    flowRef.current?.setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, []);

  const onPointerLeave = useCallback(() => {
    flowRef.current?.setPointer(null);
  }, []);

  const paused = stats?.paused ?? false;

  return (
    <StageShell
      readout={
        stats && (
          <span className="flex items-center gap-3">
            <span>
              <span className="opacity-60">RUN </span>
              {String(stats.run).padStart(2, '0')}
            </span>
            {/* Counts without their names on a phone, where the ghost type shares the top. */}
            <span>
              <span className="hidden opacity-60 sm:inline">AGENTS </span>
              {stats.agents}
            </span>
            <span>
              <span className="hidden opacity-60 sm:inline">TOOL CALLS </span>
              {stats.tools}
            </span>
            <span className={paused ? 'text-accent' : undefined}>
              {paused ? 'PAUSED' : `${stats.speed.toFixed(1)}×`}
            </span>
          </span>
        )
      }
      hint="Bring the cursor near to slow it, onto an item to stop and read · tools branch straight out · subagents fork on a diagonal and merge back"
      controls={
        <>
          <Segment label="Run" value={run} options={RUN_OPTIONS} onChange={setRun} />
          <div className="deck-ctl">
            <p className="eyebrow deck-ctl-label text-[9.5px]">Legend</p>
            <ul className="flex items-center gap-4 py-1.5 font-mono text-[11px] tracking-wide">
              {LEGEND.map((entry) => (
                <li
                  key={entry.label}
                  className="text-muted inline-flex items-center gap-2 whitespace-nowrap"
                >
                  {entry.shape === 'line' ? (
                    <span
                      aria-hidden="true"
                      className="h-[2px] w-4"
                      style={{ background: `var(${entry.token})` }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-2 border-[1.5px]"
                      style={{ borderColor: `var(${entry.token})` }}
                    />
                  )}
                  {entry.label}
                </li>
              ))}
            </ul>
          </div>
        </>
      }
    >
      <div
        ref={boxRef}
        className="relative size-full touch-pan-y"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        role="img"
        aria-label="An agent run traced live: a main agent calls tools, forks subagents that do their own work, and merges their results back."
      >
        <canvas ref={shapeRef} aria-hidden="true" className="absolute inset-0 size-full" />
        <canvas ref={typeRef} aria-hidden="true" className="absolute inset-0 size-full" />

        {hover && box.width > 0 && <HoverCard info={hover} box={box} />}

        {failed && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <p className="text-muted font-mono text-xs">This browser cannot draw the flow.</p>
          </div>
        )}
      </div>
    </StageShell>
  );
}

/** The card for whatever is under the cursor, kept inside the box. */
function HoverCard({
  info,
  box,
}: {
  info: HoverInfo;
  box: { width: number; height: number };
}): React.ReactElement {
  const { item } = info;
  const right = info.x < box.width * 0.58;
  const top = Math.max(12, Math.min(box.height - 150, info.y - 24));
  const token =
    item.kind === 'tool'
      ? '--c-flow-tool'
      : (['--c-flow-main', '--c-flow-sub', '--c-flow-sub2'][item.depth] ?? '--c-flow-main');
  return (
    <div
      role="status"
      className="deck-flow-card pointer-events-none absolute z-20 w-[17rem]"
      style={{
        top,
        ...(right ? { left: info.x + 22 } : { right: box.width - info.x + 22 }),
      }}
    >
      <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase">
        <span aria-hidden="true" className="size-2" style={{ background: `var(${token})` }} />
        <span className="text-faint">{KIND_LABEL[item.kind]}</span>
        {item.depth > 0 && item.kind !== 'tool' && (
          <span className="text-faint">· depth {item.depth}</span>
        )}
      </p>
      <p className="mt-2 font-mono text-[13px] font-semibold">{item.title}</p>
      <p className="text-muted mt-1.5 text-[13px] leading-relaxed">{item.detail}</p>
    </div>
  );
}
