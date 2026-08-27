import { useState, useEffect, useRef } from 'react';
import type { DemoProps } from './registry';

type TaskMode = 'music' | 'sandbox' | 'context';

interface Step {
  time: string;
  agent: string;
  action: string;
  detail: string;
  status: 'done' | 'active' | 'pending';
  coord?: { x: number; y: number };
}

const MODES: Record<
  TaskMode,
  {
    title: string;
    description: string;
    steps: Step[];
    telemetry: {
      activeAgents: number;
      compression: string;
      latency: string;
      tokens: string;
      sandbox: string;
    };
  }
> = {
  music: {
    title: 'Abu Dhabi Festival · Audio AI Pipeline',
    description:
      'Autonomous agent chain analyzing polyphonic audio stems, transcribing motifs, and synthesizing responsive melodic harmonies.',
    telemetry: {
      activeAgents: 4,
      compression: '91.4% reduction',
      latency: '14 ms',
      tokens: '8,420 / 128k',
      sandbox: 'audio-dsp-sandboxed',
    },
    steps: [
      {
        time: '00:01.20',
        agent: 'StemExtractor',
        action: 'Fast Fourier Decomposition',
        detail: 'Separated 4 audio stems: Melody (Oud), Percussion, Bass synth, Ambient drone.',
        status: 'done',
        coord: { x: 24, y: 40 },
      },
      {
        time: '00:02.85',
        agent: 'MotifAnalyzer',
        action: 'Pattern & Scale Inference',
        detail: 'Detected Bayati Maqam scale @ 108 BPM with 98.6% harmonic alignment.',
        status: 'done',
        coord: { x: 52, y: 35 },
      },
      {
        time: '00:04.10',
        agent: 'MelodySynth',
        action: 'Context-Guided Generation',
        detail: 'Generated counter-melody with microtonal embellishments.',
        status: 'active',
        coord: { x: 78, y: 60 },
      },
      {
        time: '00:05.40',
        agent: 'MasteringNode',
        action: 'Dynamic Spatial Mix',
        detail: 'Multi-channel spatial audio render with room impulse simulation.',
        status: 'pending',
        coord: { x: 90, y: 80 },
      },
    ],
  },
  sandbox: {
    title: 'Desktop Operator & Containerized Tools',
    description:
      'Agent inspecting desktop environment, reading screen UI coordinates, and executing untrusted code safely in isolated containers.',
    telemetry: {
      activeAgents: 3,
      compression: '84.2% reduction',
      latency: '22 ms',
      tokens: '14,100 / 128k',
      sandbox: 'isolated-container-node-03',
    },
    steps: [
      {
        time: '00:00.90',
        agent: 'VisionNavigator',
        action: 'Screen OCR & UI Grounding',
        detail: 'Located target input prompt at viewport coords (x: 412, y: 380).',
        status: 'done',
        coord: { x: 45, y: 42 },
      },
      {
        time: '00:02.15',
        agent: 'SandboxExecutor',
        action: 'Container Launch',
        detail: 'Spawned ephemeral container alpine-py3.13 (pid: 4892) with network isolation.',
        status: 'done',
        coord: { x: 60, y: 55 },
      },
      {
        time: '00:03.70',
        agent: 'ToolAgent',
        action: 'Execute Tool Script',
        detail: 'Running git clone and dependency vulnerability scan within sandbox.',
        status: 'active',
        coord: { x: 75, y: 70 },
      },
      {
        time: '00:05.00',
        agent: 'SecuritySentinel',
        action: 'Audit Output & Teardown',
        detail: 'Zero suspicious system calls. Destroying temporary container image.',
        status: 'pending',
        coord: { x: 88, y: 85 },
      },
    ],
  },
  context: {
    title: 'Dynamic Context Compression Engine',
    description:
      'Continuous memory optimization engine extracting structured knowledge entities to keep active prompt tokens beneath budget ceilings.',
    telemetry: {
      activeAgents: 3,
      compression: '94.8% reduction',
      latency: '9 ms',
      tokens: '6,280 / 128k',
      sandbox: 'memory-graph-v2',
    },
    steps: [
      {
        time: '00:00.65',
        agent: 'EntityExtractor',
        action: 'Parse Dialogue Tree',
        detail: 'Indexed 42 referenced code symbols, 18 user goals, 5 active constraints.',
        status: 'done',
        coord: { x: 30, y: 30 },
      },
      {
        time: '00:01.90',
        agent: 'MemoryPruner',
        action: 'Selective Summarization',
        detail: 'Compressed 128k raw token conversation history down to 6.2k dense graph tuples.',
        status: 'done',
        coord: { x: 55, y: 50 },
      },
      {
        time: '00:03.40',
        agent: 'KnowledgeRetriever',
        action: 'Vector-Assisted Hydration',
        detail: 'Pre-fetched relevant API documentation chunks on demand without bloat.',
        status: 'active',
        coord: { x: 80, y: 45 },
      },
      {
        time: '00:04.80',
        agent: 'ContextGuard',
        action: 'Token Budget Allocation',
        detail: 'Allocated 85% budget for generation headroom, 15% for memory prefix.',
        status: 'pending',
        coord: { x: 92, y: 65 },
      },
    ],
  },
};

export default function FeatherRingAgentDemo({ title: _title }: DemoProps): React.ReactElement {
  const [mode, setMode] = useState<TaskMode>('music');
  const [activeStep, setActiveStep] = useState<number>(2);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [visualBars, setVisualBars] = useState<number[]>(() =>
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 80 + 20)),
  );

  const currentMode = MODES[mode];

  // Animate audio / execution waveform
  useEffect(() => {
    let frameId: number;
    const update = () => {
      if (isPlaying) {
        setVisualBars((prev) =>
          prev.map((val) => {
            const delta = (Math.random() - 0.5) * 20;
            return Math.min(100, Math.max(15, val + delta));
          }),
        );
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  // Automated step loop
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % currentMode.steps.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [isPlaying, currentMode.steps.length]);

  return (
    <div className="flex flex-col bg-[var(--c-ground)] text-[var(--c-text)]">
      {/* ── Operator Control Bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-[var(--c-accent)] uppercase">
            OPERATOR AGENT RUNNER //
          </span>
          <div className="inline-flex rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-0.5">
            {(Object.keys(MODES) as TaskMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setActiveStep(1);
                }}
                className={`rounded-sm px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  mode === m
                    ? 'bg-[var(--c-accent-fill)] text-[var(--c-accent-on-fill)] shadow-sm'
                    : 'text-[var(--c-text-muted)] hover:text-[var(--c-text)]'
                }`}
              >
                {m === 'music' ? 'Abu Dhabi Festival' : m === 'sandbox' ? 'Desktop Sandbox' : 'Context Engine'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className={`flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[11px] font-semibold transition-colors ${
              isPlaying
                ? 'border-[var(--c-ok)] bg-[var(--c-ok)]/10 text-[var(--c-ok)]'
                : 'border-[var(--c-line)] bg-[var(--c-surface)] text-[var(--c-text-muted)]'
            }`}
          >
            <span className={`size-1.5 rounded-full ${isPlaying ? 'animate-pulse bg-[var(--c-ok)]' : 'bg-[var(--c-text-faint)]'}`} />
            {isPlaying ? 'RUNNING' : 'PAUSED'}
          </button>
          <button
            type="button"
            onClick={() => setActiveStep((prev) => (prev + 1) % currentMode.steps.length)}
            className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 text-[11px] hover:border-[var(--c-text-muted)]"
          >
            Step +1
          </button>
        </div>
      </div>

      {/* ── 80% Visual / Simulation Viewport ──────────────────────────── */}
      <div className="relative grid min-h-[380px] lg:min-h-[460px] lg:grid-cols-[1.6fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--c-line)] border-b border-[var(--c-line)] bg-[var(--c-sunken)]">
        {/* Left: Interactive Operator Canvas & Live Visualizer */}
        <div className="relative flex flex-col justify-between p-5 overflow-hidden">
          {/* Subtle Grid Background */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(var(--c-line) 1px, transparent 1px), linear-gradient(90deg, var(--c-line) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />

          {/* Telemetry Header Badge */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-[var(--c-text-faint)] uppercase">
                ACTIVE PIPELINE //
              </span>
              <h4 className="font-mono text-sm font-semibold text-[var(--c-text)]">
                {currentMode.title}
              </h4>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="flex items-center gap-1 text-[var(--c-ok)]">
                <span className="size-1.5 animate-ping rounded-full bg-[var(--c-ok)]" />
                STREAMING
              </span>
              <span className="text-[var(--c-text-faint)]">{currentMode.telemetry.latency}</span>
            </div>
          </div>

          {/* Central Interactive Visualization Area */}
          <div className="relative z-10 my-6 flex flex-col items-center justify-center">
            {mode === 'music' && (
              <div className="w-full space-y-4">
                <div className="flex items-end justify-between gap-1 h-32 px-4 rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)]/80 backdrop-blur-md">
                  {visualBars.map((height, idx) => (
                    <div
                      key={idx}
                      className="w-full rounded-t-xs transition-all duration-75"
                      style={{
                        height: `${height}%`,
                        backgroundColor:
                          idx % 4 === 0
                            ? 'var(--c-accent)'
                            : idx % 2 === 0
                              ? 'var(--c-text)'
                              : 'var(--c-text-muted)',
                        opacity: idx % 3 === 0 ? 0.9 : 0.6,
                      }}
                    />
                  ))}
                </div>
                <div className="flex justify-between font-mono text-[10px] text-[var(--c-text-faint)] px-1">
                  <span>STEM: BAYATI OUD [POLYPHONIC]</span>
                  <span>SPECTROGRAM // 48kHz 24-BIT</span>
                  <span>HARMONIC DENSITY: 94.2%</span>
                </div>
              </div>
            )}

            {mode === 'sandbox' && (
              <div className="w-full space-y-3">
                <div className="relative h-36 rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)]/90 p-4 font-mono text-xs overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[var(--c-line)] pb-2 text-[10px] text-[var(--c-text-faint)]">
                    <span>CONTAINER RUNTIME: sandbox-node-03</span>
                    <span className="text-[var(--c-ok)]">SYS_ISOLATED: STRICT</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed">
                    <p className="text-[var(--c-accent)]">$ docker run --memory=512m --cpus=1.0 agent_tool_runner</p>
                    <p className="text-[var(--c-text-muted)]">&gt; Initializing virtual screen (1920x1080)...</p>
                    <p className="text-[var(--c-text)]">&gt; Mouse coordinate jump: target (x: 412, y: 380) [OK]</p>
                    <p className="text-[var(--c-ok)]">&gt; Extracted AST nodes &amp; sandbox evaluation clean.</p>
                  </div>
                  <div className="absolute right-4 bottom-3 size-2 animate-ping rounded-full bg-[var(--c-accent)]" />
                </div>
              </div>
            )}

            {mode === 'context' && (
              <div className="w-full space-y-3">
                <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)]/90 p-4">
                  <div className="flex items-center justify-between font-mono text-[11px] mb-2">
                    <span className="text-[var(--c-text-muted)]">Context Memory Compression</span>
                    <span className="text-[var(--c-accent)] font-semibold">{currentMode.telemetry.compression}</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--c-raised)] border border-[var(--c-line)]">
                    <div
                      className="h-full bg-[var(--c-accent)] transition-all duration-500"
                      style={{ width: '88%' }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] text-[var(--c-text-muted)]">
                    <div className="border border-[var(--c-line)] p-2 rounded-xs">
                      <span className="block text-[var(--c-text-faint)]">RAW PROMPT</span>
                      <span className="font-semibold text-[var(--c-text)]">128,000 tok</span>
                    </div>
                    <div className="border border-[var(--c-line)] p-2 rounded-xs">
                      <span className="block text-[var(--c-text-faint)]">EXTRACTED ENTITIES</span>
                      <span className="font-semibold text-[var(--c-text)]">42 Nodes</span>
                    </div>
                    <div className="border border-[var(--c-line)] p-2 rounded-xs">
                      <span className="block text-[var(--c-text-faint)]">ACTIVE WORKING SET</span>
                      <span className="font-semibold text-[var(--c-accent)]">6,280 tok</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Telemetry Quick Strip */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--c-line)] pt-3 font-mono text-[11px]">
            <div className="flex gap-4">
              <span className="text-[var(--c-text-faint)]">
                AGENTS:{' '}
                <strong className="text-[var(--c-text)]">{currentMode.telemetry.activeAgents}</strong>
              </span>
              <span className="text-[var(--c-text-faint)]">
                WORKING SET:{' '}
                <strong className="text-[var(--c-accent)]">{currentMode.telemetry.tokens}</strong>
              </span>
            </div>
            <span className="text-[var(--c-text-faint)]">{currentMode.telemetry.sandbox}</span>
          </div>
        </div>

        {/* Right: Live Agent Action Log & State Inspector */}
        <div className="flex flex-col justify-between bg-[var(--c-surface)] p-4 font-mono text-xs">
          <div>
            <div className="flex items-center justify-between border-b border-[var(--c-line)] pb-2 mb-3">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--c-text-faint)] uppercase">
                AGENT EXECUTION STEPSTREAM
              </span>
              <span className="text-[10px] text-[var(--c-accent)]">
                STEP {activeStep + 1} / {currentMode.steps.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {currentMode.steps.map((step, idx) => {
                const isActive = idx === activeStep;
                const isPassed = idx < activeStep;

                return (
                  <div
                    key={idx}
                    onClick={() => setActiveStep(idx)}
                    className={`cursor-pointer rounded-sm border p-2.5 transition-all ${
                      isActive
                        ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] shadow-sm'
                        : isPassed
                          ? 'border-[var(--c-line)] bg-[var(--c-raised)]/60 text-[var(--c-text-muted)]'
                          : 'border-dashed border-[var(--c-line)] opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-[var(--c-text)]">
                        @{step.agent}
                      </span>
                      <span className="text-[var(--c-text-faint)]">{step.time}</span>
                    </div>
                    <p className={`mt-1 text-[11px] font-medium ${isActive ? 'text-[var(--c-accent)]' : 'text-[var(--c-text)]'}`}>
                      {step.action}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--c-text-muted)]">
                      {step.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 border-t border-[var(--c-line)] pt-3 text-[10px] text-[var(--c-text-faint)]">
            Click any step to inspect state & dispatch telemetry.
          </div>
        </div>
      </div>
    </div>
  );
}
