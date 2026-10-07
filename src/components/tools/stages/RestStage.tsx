import React, { useEffect, useState } from 'react';
import OpenTool from './OpenTool';

/**
 * Rest Reminder on the showcase screen: a working focus/break dial, and the
 * next two hours laid out as a strip of focus and break blocks with a "now"
 * marker, plus the clock times they land on. The full tool's page explains how
 * it keeps time in a background tab; this screen only shows the clock.
 *
 * Clock times exist only after mount: the band is server-rendered, and a time
 * computed on the server would not match the visitor's clock on hydration.
 */

const LENGTH = { work: 25 * 60, break: 5 * 60 } as const;
type Mode = keyof typeof LENGTH;
const CYCLE = LENGTH.work + LENGTH.break;
const CYCLES_SHOWN = 4;

const TICKS = Array.from({ length: 60 }, (_, i) => i);

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  href: string;
}

export default function RestStage({ href }: Props): React.ReactElement {
  const [mode, setMode] = useState<Mode>('work');
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState<number>(LENGTH.work);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const minute = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(minute);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const progress = 1 - seconds / LENGTH[mode];
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  /** Seconds into the current focus+break cycle, so the strip's marker lines up with the dial. */
  const intoCycle =
    mode === 'work' ? LENGTH.work - seconds : LENGTH.work + (LENGTH.break - seconds);
  const toBreak = mode === 'work' ? seconds : 0;
  const toWork = mode === 'work' ? seconds + LENGTH.break : seconds;

  const switchMode = (next: Mode): void => {
    setMode(next);
    setSeconds(LENGTH[next]);
    setRunning(false);
  };

  const r = 54;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid flex-1 items-center gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* ── Dial ──────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-5 lg:px-4">
          <div className="relative size-60">
            <svg className="size-full" viewBox="0 0 128 128" aria-hidden="true">
              {TICKS.map((i) => {
                const major = i % 5 === 0;
                const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
                const r0 = major ? 59 : 60.5;
                return (
                  <line
                    key={i}
                    x1={64 + r0 * Math.cos(a)}
                    y1={64 + r0 * Math.sin(a)}
                    x2={64 + 63 * Math.cos(a)}
                    y2={64 + 63 * Math.sin(a)}
                    className={i / 60 <= progress && progress > 0 ? 'stroke-accent' : 'stroke-line'}
                    strokeWidth={major ? 1.1 : 0.6}
                  />
                );
              })}
              <circle cx="64" cy="64" r={r} className="stroke-sunken" strokeWidth="5" fill="none" />
              <circle
                cx="64"
                cy="64"
                r={r}
                className="stroke-accent-fill transition-[stroke-dashoffset] duration-500"
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
                transform="rotate(-90 64 64)"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
                {mode === 'work' ? 'Focus' : 'Break'}
              </span>
              <span
                className="text-fg mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums"
                aria-live="polite"
              >
                {time}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => setRunning(!running)}
              className={`rounded-sm border px-5 py-1.5 transition-colors ${
                running
                  ? 'border-line text-fg bg-surface hover:border-fg'
                  : 'bg-accent-fill text-accent-on-fill border-transparent font-semibold'
              }`}
            >
              {running ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                setSeconds(LENGTH[mode]);
              }}
              className="text-faint hover:text-fg px-2.5 py-1.5 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── Plan ──────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex gap-1.5">
            {(['work', 'break'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                aria-pressed={mode === m}
                className={`rounded-sm px-3 py-1 font-mono text-xs transition-colors ${
                  mode === m ? 'bg-fg text-ground' : 'bg-raised text-muted hover:text-fg'
                }`}
              >
                {m === 'work' ? '25 min focus' : '5 min break'}
              </button>
            ))}
          </div>

          <div>
            <p className="eyebrow text-[10px]">Next two hours</p>
            <div className="relative mt-3">
              <div className="flex h-9 gap-[2px]">
                {Array.from({ length: CYCLES_SHOWN }, (_, c) => (
                  <React.Fragment key={c}>
                    <span className="bg-raised h-full rounded-l-sm" style={{ flex: LENGTH.work }} />
                    <span
                      className="bg-accent h-full rounded-r-sm"
                      style={{ flex: LENGTH.break }}
                    />
                  </React.Fragment>
                ))}
              </div>
              <span
                className="bg-fg absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full transition-[left] duration-500"
                style={{ left: `${(intoCycle / (CYCLE * CYCLES_SHOWN)) * 100}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="text-faint mt-2 flex justify-between font-mono text-[10px] tabular-nums">
              {Array.from({ length: CYCLES_SHOWN + 1 }, (_, i) => (
                <span key={i}>
                  {now === null ? '--:--' : clock(now + (i * CYCLE - intoCycle) * 1000)}
                </span>
              ))}
            </div>
            <div className="text-muted mt-3 flex gap-4 font-mono text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className="bg-raised inline-block size-2.5 rounded-[2px]" /> focus
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-accent inline-block size-2.5 rounded-[2px]" /> break
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-fg inline-block h-2.5 w-[2px]" /> now
              </span>
            </div>
          </div>

          <dl className="border-line grid grid-cols-2 border-y">
            <div className="border-line border-r py-3 pr-3">
              <dt className="eyebrow text-[10px]">Next break</dt>
              <dd className="text-fg mt-1 font-mono text-xl font-semibold tabular-nums">
                {now === null ? '--:--' : toBreak === 0 ? 'now' : clock(now + toBreak * 1000)}
              </dd>
            </div>
            <div className="py-3 pl-4">
              <dt className="eyebrow text-[10px]">Back to work</dt>
              <dd className="text-fg mt-1 font-mono text-xl font-semibold tabular-nums">
                {now === null ? '--:--' : clock(now + toWork * 1000)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <OpenTool href={href} label="Open Rest Reminder" more="Keeps time in background tabs" />
    </div>
  );
}
