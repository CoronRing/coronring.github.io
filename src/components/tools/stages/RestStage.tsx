import React, { useState, useEffect } from 'react';

interface Props {
  href: string;
}

export default function RestStage({ href }: Props): React.ReactElement {
  const [mode, setMode] = useState<'work' | 'break'>('work');
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(25 * 60);

  // Simulation timer when running
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const total = mode === 'work' ? 25 * 60 : 5 * 60;
  const progress = 1 - seconds / total;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const switchMode = (next: 'work' | 'break') => {
    setMode(next);
    setSeconds(next === 'work' ? 25 * 60 : 5 * 60);
    setRunning(false);
  };

  // SVG circular dial parameters
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Mode Switcher & Web Worker Status ─────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-faint mr-2 font-mono text-[11px] tracking-wider uppercase">
            Interval:
          </span>
          <button
            type="button"
            onClick={() => switchMode('work')}
            className={`rounded px-3 py-1 font-mono text-xs transition-colors ${
              mode === 'work'
                ? 'bg-accent-fill text-accent-on-fill font-medium'
                : 'bg-raised text-muted hover:text-fg'
            }`}
          >
            25m Deep Work
          </button>
          <button
            type="button"
            onClick={() => switchMode('break')}
            className={`rounded px-3 py-1 font-mono text-xs transition-colors ${
              mode === 'break'
                ? 'bg-accent-fill text-accent-on-fill font-medium'
                : 'bg-raised text-muted hover:text-fg'
            }`}
          >
            5m Ergonomic Break
          </button>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-[var(--c-ok)]">
          <span className="size-2 animate-pulse rounded-full bg-[var(--c-ok)]" />
          <span>Web Worker Active (Throttling Proof)</span>
        </div>
      </div>

      {/* ── Centerpiece: Circular Clock & Ergonomics Panel ────────────── */}
      <div className="grid items-center gap-6 sm:grid-cols-[14rem_minmax(0,1fr)]">
        {/* Radial Animated Clock */}
        <div className="border-line bg-surface/60 flex flex-col items-center justify-center rounded-sm border p-4">
          <div className="relative flex size-36 items-center justify-center">
            <svg className="size-full -rotate-90" viewBox="0 0 128 128">
              {/* Track background */}
              <circle
                cx="64"
                cy="64"
                r={radius}
                className="stroke-sunken"
                strokeWidth="7"
                fill="none"
              />
              {/* Animated Progress Arc */}
              <circle
                cx="64"
                cy="64"
                r={radius}
                className="stroke-accent-fill transition-[stroke-dashoffset] duration-500"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
              />
            </svg>

            {/* Centered Digital Countdown */}
            <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
              <span className="text-fg text-2xl font-bold tracking-tight">{timeStr}</span>
              <span className="text-faint mt-0.5 text-[10px] tracking-wider uppercase">
                {mode === 'work' ? 'Sprint' : 'Rest'}
              </span>
            </div>
          </div>

          {/* Interactive Play/Pause/Reset Controls */}
          <div className="mt-4 flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => setRunning(!running)}
              className="bg-surface border-line hover:border-fg text-fg rounded-sm border px-3 py-1 transition-colors"
            >
              {running ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                setSeconds(mode === 'work' ? 25 * 60 : 5 * 60);
              }}
              className="text-faint hover:text-fg px-2.5 py-1 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Ergonomics & Web Worker Resilience Card */}
        <div className="space-y-3 font-mono text-xs">
          <div className="border-line bg-surface/80 rounded-sm border p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-accent font-semibold">⚡ Unthrottled Precision</span>
              <span className="text-faint text-[10px]">· Tab Minimised</span>
            </div>
            <p className="text-muted text-[12px] leading-relaxed">
              Browsers put background tabs to sleep and throttle timers to 1 Hz or zero. Rest
              Reminder uses an isolated Web Worker heartbeat, keeping deadline precision down to the
              exact millisecond regardless of window state.
            </p>
          </div>

          <div className="border-line bg-surface/80 rounded-sm border p-3.5">
            <span className="text-faint mb-2 block text-[10px] uppercase">Rest Checklist</span>
            <ul className="text-muted space-y-1.5 text-[12px]">
              <li className="flex items-center gap-2">
                <span className="text-[var(--c-ok)]">✓</span>
                <span>
                  <strong>20-20-20 Rule:</strong> Look 20 feet away for 20 seconds
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[var(--c-ok)]">✓</span>
                <span>
                  <strong>Shoulder & Neck:</strong> Release trapped trapezius tension
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[var(--c-ok)]">✓</span>
                <span>
                  <strong>Hydration:</strong> Stand and sip water
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="text-muted font-mono text-xs">
          Customizable intervals, 6 acoustic chime presets, desktop notifications, and zero
          tracking.
        </p>

        <a
          href={href}
          className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
        >
          <span>Open Rest Reminder</span>
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
      </div>
    </div>
  );
}
