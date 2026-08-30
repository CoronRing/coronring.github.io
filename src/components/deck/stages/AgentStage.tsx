import { useEffect, useMemo, useState } from 'react';
import { Segment, StageShell } from '../StageShell';

/**
 * AgentStage — FeatherRing as a graph that runs, rather than a list that scrolls.
 *
 * ## Why a graph
 *
 * The thing worth showing about a multi-agent system is not the transcript, it
 * is the *shape*: which agents exist, what they hand to each other, and which
 * one is holding the work right now. The surface this replaced showed a
 * timestamped log beside a telemetry table, which is what an operator reads on
 * their fourth day, not what a visitor understands in four seconds.
 *
 * So the stage draws the pipeline as a graph on a field. The run walks it, the
 * held node pulses and rings, and the edges behind the front carry flow. One
 * line of copy under the graph says what the held node is doing.
 *
 * ## Why the motion is CSS
 *
 * The flow along the edges is `stroke-dashoffset` and the node rings are
 * `transform` — both composite off the main thread and neither re-renders
 * React. Only the step pointer is stateful, and it moves every 2.6 s. An
 * earlier version drove a 32-bar visualiser from `requestAnimationFrame`
 * through `setState`, which re-rendered the whole island sixty times a second
 * to animate noise.
 *
 * `prefers-reduced-motion` is handled in `global.css`, which flattens the
 * keyframes; the graph stays readable because the held node is marked by
 * colour and weight, not only by movement.
 */

type PipelineKey = 'music' | 'desktop' | 'memory';

interface Node {
  id: string;
  /** Short agent name, drawn in the node. */
  name: string;
  /** Position in the 0..100 field. */
  x: number;
  y: number;
  /** A side node hangs off the chain — a tool or a store, not a step. */
  side?: boolean;
}

interface Step {
  /** Which node holds the work at this step. */
  node: string;
  action: string;
  detail: string;
}

interface Pipeline {
  label: string;
  title: string;
  nodes: readonly Node[];
  /** Extra edges beyond the chain, as `[from, to]` node ids. */
  links: ReadonlyArray<[string, string]>;
  steps: readonly Step[];
  telemetry: ReadonlyArray<{ label: string; value: string }>;
}

const PIPELINES: Record<PipelineKey, Pipeline> = {
  music: {
    label: 'Music',
    title: 'Abu Dhabi Festival · audio module',
    nodes: [
      { id: 'stem', name: 'STEM', x: 12, y: 62 },
      { id: 'motif', name: 'MOTIF', x: 36, y: 32 },
      { id: 'scale', name: 'MAQAM', x: 34, y: 78, side: true },
      { id: 'synth', name: 'SYNTH', x: 63, y: 52 },
      { id: 'master', name: 'MIX', x: 87, y: 30 },
    ],
    links: [
      ['motif', 'scale'],
      ['scale', 'synth'],
    ],
    steps: [
      {
        node: 'stem',
        action: 'Fourier decomposition',
        detail: 'Four stems separated: oud, percussion, bass synth, ambient drone.',
      },
      {
        node: 'motif',
        action: 'Pattern inference',
        detail: 'Bayati maqam at 108 BPM, 98.6% harmonic alignment across the take.',
      },
      {
        node: 'synth',
        action: 'Context-guided generation',
        detail: 'Counter-melody written against the motif, microtonal intervals preserved.',
      },
      {
        node: 'master',
        action: 'Spatial mix',
        detail: 'Multi-channel render with room impulse simulation.',
      },
    ],
    telemetry: [
      { label: 'Agents', value: '4' },
      { label: 'Working set', value: '8.4k / 128k' },
      { label: 'Compression', value: '91.4%' },
    ],
  },

  desktop: {
    label: 'Desktop',
    title: 'Desktop operator · sandboxed tools',
    nodes: [
      { id: 'vision', name: 'VISION', x: 12, y: 34 },
      { id: 'plan', name: 'PLAN', x: 37, y: 60 },
      { id: 'box', name: 'SANDBOX', x: 64, y: 32 },
      { id: 'tool', name: 'TOOL', x: 62, y: 80, side: true },
      { id: 'audit', name: 'AUDIT', x: 88, y: 58 },
    ],
    links: [
      ['plan', 'tool'],
      ['tool', 'audit'],
    ],
    steps: [
      {
        node: 'vision',
        action: 'Screen OCR and UI grounding',
        detail: 'Target input located at viewport (412, 380) without an accessibility tree.',
      },
      {
        node: 'plan',
        action: 'Task decomposition',
        detail: 'Four calls planned; two need the network, so both go inside the container.',
      },
      {
        node: 'box',
        action: 'Container launch',
        detail: 'Ephemeral alpine-py3.13, network isolated, 512 MB, one core.',
      },
      {
        node: 'audit',
        action: 'Audit and teardown',
        detail: 'No unexpected syscalls. Image destroyed, nothing persisted to the host.',
      },
    ],
    telemetry: [
      { label: 'Agents', value: '3' },
      { label: 'Working set', value: '14.1k / 128k' },
      { label: 'Isolation', value: 'Strict' },
    ],
  },

  memory: {
    label: 'Memory',
    title: 'Context management · trained compressor',
    nodes: [
      { id: 'parse', name: 'PARSE', x: 12, y: 50 },
      { id: 'entity', name: 'ENTITY', x: 36, y: 24 },
      { id: 'store', name: 'GRAPH', x: 38, y: 76, side: true },
      { id: 'prune', name: 'PRUNE', x: 63, y: 48 },
      { id: 'guard', name: 'BUDGET', x: 88, y: 26 },
    ],
    links: [
      ['entity', 'store'],
      ['store', 'prune'],
    ],
    steps: [
      {
        node: 'parse',
        action: 'Walk the dialogue tree',
        detail: '42 code symbols, 18 stated goals and 5 live constraints indexed.',
      },
      {
        node: 'entity',
        action: 'Agentic extraction',
        detail: 'Entities lifted as triples, so the reference survives the summary.',
      },
      {
        node: 'prune',
        action: 'Selective summarisation',
        detail: '128k of history down to 6.2k of dense tuples, references intact.',
      },
      {
        node: 'guard',
        action: 'Budget allocation',
        detail: '85% of the window left for generation, 15% held for the memory prefix.',
      },
    ],
    telemetry: [
      { label: 'Agents', value: '3' },
      { label: 'Working set', value: '6.3k / 128k' },
      { label: 'Compression', value: '94.8%' },
    ],
  },
};

const PIPELINE_OPTIONS = (Object.keys(PIPELINES) as PipelineKey[]).map((key) => ({
  value: key,
  label: PIPELINES[key].label,
}));

const RUN_OPTIONS = [
  { value: 'run', label: 'Run' },
  { value: 'hold', label: 'Hold' },
] as const;

type RunState = (typeof RUN_OPTIONS)[number]['value'];

interface Props {
  active: boolean;
}

export default function AgentStage({ active }: Props): React.ReactElement {
  const [key, setKey] = useState<PipelineKey>('music');
  const [run, setRun] = useState<RunState>('run');
  const [step, setStep] = useState(0);

  const pipeline = PIPELINES[key];
  const current = pipeline.steps[step] ?? pipeline.steps[0]!;

  // Advance the run. Held when paused, and when the frame is off the deck —
  // an interval ticking behind five other frames is pure battery cost.
  useEffect(() => {
    if (run !== 'run' || !active) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % pipeline.steps.length), 2600);
    return () => window.clearInterval(id);
  }, [run, active, pipeline.steps.length]);

  /** Node ids in the order the run visits them, for edge state. */
  const chain = useMemo(() => pipeline.steps.map((s) => s.node), [pipeline]);
  const nodeById = useMemo(
    () => Object.fromEntries(pipeline.nodes.map((n) => [n.id, n])),
    [pipeline],
  );

  /** Every edge drawn, with how far the run has got past it. */
  const edges = useMemo(() => {
    const chainEdges = chain.slice(0, -1).map((from, i) => ({
      from,
      to: chain[i + 1]!,
      /** 'done' behind the front, 'live' at it, 'ahead' in front. */
      state: i < step ? 'done' : i === step ? 'live' : 'ahead',
    }));
    const sideEdges = pipeline.links.map(([from, to]) => ({
      from,
      to,
      state: chain.indexOf(from) < step ? 'done' : 'ahead',
    }));
    return [...chainEdges, ...sideEdges];
  }, [chain, pipeline.links, step]);

  return (
    <StageShell
      readout={
        <span className="flex items-center gap-3">
          {pipeline.telemetry.map((t) => (
            <span key={t.label}>
              <span className="opacity-60">{t.label.toUpperCase()} </span>
              {t.value}
            </span>
          ))}
        </span>
      }
      hint="Pick a pipeline · hold the run to read a step"
      controls={
        <>
          <Segment
            label="Pipeline"
            value={key}
            options={PIPELINE_OPTIONS}
            onChange={(next) => {
              setKey(next);
              setStep(0);
            }}
          />
          <Segment label="Run" value={run} options={RUN_OPTIONS} onChange={setRun} />
        </>
      }
    >
      <div className="relative flex size-full flex-col justify-center overflow-hidden">
        {/* The field the graph sits on. */}
        <div aria-hidden="true" className="grid-backdrop pointer-events-none absolute inset-0" />

        {/*
          The graph is inset rather than laid over the whole stage: nodes on the
          0 and 100 edges would sit against the viewport, and the readout below
          would land on top of the lower ones. Everything inside shares one
          coordinate space, so the SVG edges and the HTML nodes stay registered.
        */}
        <div className="deck-graph">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${pipeline.title}: step ${step + 1} of ${pipeline.steps.length}, ${current.action}`}
            className="absolute inset-0 size-full"
          >
            {/*
            Field brackets. The graph is deliberately sparse — five nodes is
            the honest count — and an unframed sparse area reads as empty page
            rather than as a plot with room in it.
          */}
            <g
              stroke="var(--c-line-strong)"
              strokeWidth="1"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            >
              <path d="M0 6 V0 H6 M94 0 H100 V6 M100 94 V100 H94 M6 100 H0 V94" fill="none" />
            </g>

            {/* Edges, under the nodes. */}
            <g>
              {edges.map((edge) => {
                const a = nodeById[edge.from];
                const b = nodeById[edge.to];
                if (!a || !b) return null;
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    vectorEffect="non-scaling-stroke"
                    className={
                      edge.state === 'live'
                        ? 'deck-edge deck-edge-live'
                        : edge.state === 'done'
                          ? 'deck-edge deck-edge-done'
                          : 'deck-edge'
                    }
                  />
                );
              })}
            </g>
          </svg>

          {/* Nodes are HTML so their labels stay in the page's type, not the SVG's. */}
          <div className="absolute inset-0">
            {pipeline.nodes.map((node) => {
              const held = node.id === current.node;
              const visited = chain.indexOf(node.id) > -1 && chain.indexOf(node.id) < step;
              return (
                <div
                  key={node.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                >
                  {held && (
                    <span
                      aria-hidden="true"
                      className="border-accent deck-ping absolute top-1/2 left-1/2 -mt-8 -ml-8 size-16 rounded-full border"
                    />
                  )}
                  <span
                    className={`relative block border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap transition-colors duration-[var(--dur-base)] ${
                      held
                        ? 'border-accent bg-accent-fill text-accent-on-fill font-semibold'
                        : visited
                          ? 'border-line-strong bg-surface text-fg'
                          : node.side
                            ? 'border-line bg-surface/80 text-muted border-dashed'
                            : 'border-line bg-surface text-muted'
                    }`}
                  >
                    {node.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* What the held node is doing. One line, not a log. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 lg:p-8">
          <div className="border-line/70 bg-ground/75 max-w-xl border p-4 backdrop-blur-md">
            <p className="eyebrow flex items-center gap-2">
              <span className="text-accent tabular">
                {String(step + 1).padStart(2, '0')}/{String(pipeline.steps.length).padStart(2, '0')}
              </span>
              <span aria-hidden="true" className="bg-line-strong h-px w-4" />
              {pipeline.title}
            </p>
            <p className="mt-2.5 font-mono text-sm">{current.action}</p>
            <p className="text-muted mt-1.5 text-[13px] leading-relaxed">{current.detail}</p>
          </div>
        </div>
      </div>
    </StageShell>
  );
}
