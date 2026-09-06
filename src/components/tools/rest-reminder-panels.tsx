/**
 * Rest Reminder · the pieces the tool is assembled from.
 *
 * Everything here is presentation: a hook that writes the tab title, the clock
 * face, the alert banner, the notification self-check, and two small pieces of
 * chrome. The tool itself — the timer state, the alarms, the settings — is in
 * `RestReminder.tsx`, which is the only thing that imports this.
 *
 * The split is about the render budget as much as the file length. Only
 * {@link LiveClock} re-renders on a tick, at 4 Hz; putting the countdown in the
 * parent would re-render the settings form, sixty SVG ticks and the delivery
 * panel with it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PHASE_LABEL,
  formatClockTime,
  formatMinutesDisplay,
  formatTimeParts,
  type NotificationDiagnostics,
  type NotificationPermissionState,
  type TimerPhase,
  type TimerState,
} from '../../lib/rest-timer';
import { Button, Panel } from './ui';

/* ── Shared clock primitives ────────────────────────────────────── */

export const BASE_TITLE = 'Rest Reminder · coronring';
export const TEST_DELAY_SECONDS = 10;
/** Display cadence. Four a second reads as live and costs 15x less than rAF. */
export const TICK_MS = 250;

type BreathStep = 'inhale' | 'hold1' | 'exhale' | 'hold2';

export interface PendingAlert {
  /** Phase that just finished. */
  completed: TimerPhase;
  /** Phase the timer moved into. */
  next: TimerPhase;
  /** When the phase ended. */
  at: number;
  /** Whether the next phase started on its own. */
  autoStarted: boolean;
  /** Set when the alert was reconstructed after the fact, not seen live. */
  stale: boolean;
}

/** Milliseconds left right now, taken from the deadline rather than a counter. */
export function liveRemaining(state: TimerState): number {
  if (state.status === 'running' && state.targetEndTime !== null) {
    return Math.max(0, state.targetEndTime - Date.now());
  }
  return state.remainingMs;
}

/* ─────────────────────────────────────────────────────────────────────────
 * useDocumentTitle · the countdown in the tab, without a single re-render
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Drive `document.title` from an interval that owns no React state.
 *
 * The title is the only thing that needs the time while the tab is hidden, and
 * routing it through state would re-render the page once a second for a string
 * nobody is looking at.
 */
export function useDocumentTitle(
  state: TimerState,
  pendingAlert: PendingAlert | null,
  flash: boolean,
): void {
  useEffect(() => {
    let flashOn = true;

    const write = (): void => {
      if (pendingAlert) {
        const message = pendingAlert.completed === 'work' ? 'Time to rest' : 'Break over';
        document.title = !flash || flashOn ? message : BASE_TITLE;
        flashOn = !flashOn;
        return;
      }
      if (state.status === 'idle') {
        document.title = BASE_TITLE;
        return;
      }
      const parts = formatTimeParts(liveRemaining(state));
      const clock = `${parts.minutes}:${parts.seconds}`;
      document.title =
        state.status === 'running'
          ? `${clock} · ${PHASE_LABEL[state.phase]}`
          : `Paused ${clock} · ${PHASE_LABEL[state.phase]}`;
    };

    write();
    const interval = window.setInterval(write, 1000);
    return () => {
      window.clearInterval(interval);
      document.title = BASE_TITLE;
    };
  }, [state, pendingAlert, flash]);
}

/* ─────────────────────────────────────────────────────────────────────────
 * LiveClock · the only subtree that re-renders on a tick
 * ─────────────────────────────────────────────────────────────────────── */

export function LiveClock({
  state,
  phaseColor,
}: {
  state: TimerState;
  phaseColor: string;
}): React.ReactElement {
  const [remainingMs, setRemainingMs] = useState(() => liveRemaining(state));

  useEffect(() => {
    setRemainingMs(liveRemaining(state));
    if (state.status !== 'running' || state.targetEndTime === null) return;

    const target = state.targetEndTime;
    let interval = 0;
    const tick = (): void => setRemainingMs(Math.max(0, target - Date.now()));

    // A hidden tab needs no more than one update a second, and the browser
    // would clamp it there anyway.
    const attach = (): void => {
      window.clearInterval(interval);
      tick();
      interval = window.setInterval(tick, document.visibilityState === 'visible' ? TICK_MS : 1000);
    };

    attach();
    document.addEventListener('visibilitychange', attach);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', attach);
    };
  }, [state]);

  const timeParts = formatTimeParts(remainingMs);
  const elapsedMs = Math.max(0, state.durationMs - remainingMs);
  const progressRatio = Math.min(1, Math.max(0, elapsedMs / (state.durationMs || 1)));

  return (
    <>
      <ClockDial
        remainingMs={remainingMs}
        progressRatio={progressRatio}
        phase={state.phase}
        running={state.status === 'running'}
        phaseColor={phaseColor}
        minutes={timeParts.minutes}
        seconds={timeParts.seconds}
      />

      <div className="mt-6 flex w-full flex-wrap items-center justify-between gap-2 border-t border-[var(--c-line)] pt-3 font-mono text-[11px] text-[var(--c-text-faint)]">
        <span>
          Ends at{' '}
          <strong className="text-[var(--c-text)]">
            {formatClockTime(state.status === 'running' ? state.targetEndTime : null)}
          </strong>
        </span>
        <span>
          Elapsed{' '}
          <strong className="text-[var(--c-text)]">{Math.round(progressRatio * 100)}%</strong>
        </span>
        <span>
          Block length{' '}
          <strong className="text-[var(--c-text)]">
            {formatMinutesDisplay(state.durationMs / 60000)}
          </strong>
        </span>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * AlertBanner · the in-page fallback for a boundary the OS may have swallowed
 * ─────────────────────────────────────────────────────────────────────── */

export function AlertBanner({
  alert,
  onAcknowledge,
  onStartNext,
  running,
}: {
  alert: PendingAlert;
  onAcknowledge: () => void;
  onStartNext: () => void;
  running: boolean;
}): React.ReactElement {
  const restNow = alert.completed === 'work';
  return (
    <div
      role="status"
      aria-live="assertive"
      className={`flex flex-wrap items-center justify-between gap-4 rounded-md border border-l-2 border-[var(--c-line)] p-4 ${
        restNow
          ? 'border-l-[var(--c-accent-fill)] bg-[var(--c-accent-soft)]'
          : 'border-l-[var(--c-ok)] bg-[var(--c-raised)]'
      }`}
    >
      <div>
        <p className="display text-lg text-[var(--c-text)]">
          {restNow ? 'Rest now.' : 'Break over.'}
        </p>
        <p className="mt-1 font-mono text-[11.5px] text-[var(--c-text-muted)]">
          {PHASE_LABEL[alert.completed]} finished at {formatClockTime(alert.at)}
          {alert.stale && ' (caught up after the tab came back)'}
          {alert.autoStarted
            ? ` · ${PHASE_LABEL[alert.next].toLowerCase()} is already running`
            : ` · ${PHASE_LABEL[alert.next].toLowerCase()} is queued`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!running && (
          <Button variant="primary" onClick={onStartNext}>
            Start {PHASE_LABEL[alert.next].toLowerCase()}
          </Button>
        )}
        <Button variant="ghost" onClick={onAcknowledge}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * DeliveryCheck · why an alert did or did not reach the desktop
 * ─────────────────────────────────────────────────────────────────────── */

export function DeliveryCheck({
  diagnostics,
  permission,
  carrierState,
  carrierOn,
  testCountdown,
  onRequestPermission,
  onSendNow,
  onDelayedTest,
  onCancelTest,
}: {
  diagnostics: NotificationDiagnostics | null;
  permission: NotificationPermissionState;
  carrierState: string;
  carrierOn: boolean;
  testCountdown: number | null;
  onRequestPermission: () => void;
  onSendNow: () => void;
  onDelayedTest: () => void;
  onCancelTest: () => void;
}): React.ReactElement {
  const last = diagnostics?.lastDelivery ?? null;

  const rows: Array<{ label: string; value: string; ok: boolean; hint: string }> = [
    {
      label: 'Notifications API',
      value: diagnostics?.supported ? 'available' : 'missing',
      ok: Boolean(diagnostics?.supported),
      hint: 'Absent in some in-app browsers and older iOS Safari',
    },
    {
      label: 'Permission',
      value: permission,
      ok: permission === 'granted',
      hint: 'Denied is sticky. Clear it in the padlock menu for this site',
    },
    {
      label: 'Secure context',
      value: diagnostics?.secureContext ? 'yes' : 'no',
      ok: Boolean(diagnostics?.secureContext),
      hint: 'https and localhost qualify, a LAN IP does not',
    },
    {
      label: 'Service worker',
      value: diagnostics?.serviceWorkerActive ? 'active' : 'not active',
      ok: true,
      hint: 'Required on Android. Elsewhere delivery falls back to the page itself',
    },
    {
      label: 'Silent carrier',
      value: carrierOn ? `holding (${carrierState})` : 'idle',
      ok: carrierOn,
      hint: 'On while a phase runs, if enabled. Keeps the timer off the throttled path',
    },
    {
      label: 'Last attempt',
      value: last ? `${last.path}, ${last.ok ? 'delivered' : 'failed'}` : 'none yet',
      ok: last ? last.ok : true,
      hint: last ? last.detail : 'Send one below to fill this in',
    },
  ];

  return (
    <Panel
      title="ALERT DELIVERY"
      aside={
        <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
          {diagnostics?.visibility === 'hidden' ? 'tab hidden' : 'tab visible'}
        </span>
      }
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-start gap-2.5 rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-2"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.ok ? 'var(--c-ok)' : 'var(--c-warn)' }}
              />
              <div className="min-w-0">
                <p className="font-mono text-[11.5px] text-[var(--c-text)]">
                  {row.label}: <strong>{row.value}</strong>
                </p>
                <p className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-[var(--c-text-faint)]">
                  {row.hint}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--c-line)] pt-4">
          {permission !== 'granted' && (
            <Button variant="primary" onClick={onRequestPermission}>
              Enable OS alerts
            </Button>
          )}
          <Button variant="ghost" onClick={onSendNow}>
            Send one now
          </Button>
          {testCountdown === null ? (
            <Button variant="ghost" onClick={onDelayedTest}>
              Fire in {TEST_DELAY_SECONDS}s, then minimise
            </Button>
          ) : (
            <Button variant="danger" onClick={onCancelTest}>
              Cancel test ({testCountdown}s)
            </Button>
          )}
        </div>

        <p className="font-mono text-[10.5px] leading-relaxed text-[var(--c-text-faint)]">
          If the banner never appears with permission granted, the block is at the OS level: on
          Windows check Settings, System, Notifications for your browser and turn off Do Not
          Disturb; on macOS check System Settings, Notifications and Focus.
        </p>
      </div>
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Collapsible · a Panel that folds, for the sections below the fold
 * ─────────────────────────────────────────────────────────────────────── */

export function Collapsible({
  title,
  defaultOpen,
  aside,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel
      title={title}
      aside={
        <div className="flex items-center gap-3">
          {aside}
          <Button variant="quiet" onClick={() => setOpen((prev) => !prev)}>
            {open ? 'Hide' : 'Show'}
          </Button>
        </div>
      }
    >
      {open ? children : null}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ClockDial · concentric gauge, 60 radial ticks, drifting particle field
 * ─────────────────────────────────────────────────────────────────────── */

interface ClockDialProps {
  remainingMs: number;
  progressRatio: number;
  phase: TimerPhase;
  running: boolean;
  phaseColor: string;
  minutes: string;
  seconds: string;
}

const PARTICLE_COUNT = 22;
/** Roughly 30 fps for the decorative field. Nothing here needs 60. */
const PARTICLE_FRAME_MS = 33;

function ClockDial({
  remainingMs,
  progressRatio,
  phase,
  running,
  phaseColor,
  minutes,
  seconds,
}: ClockDialProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let lastDraw = 0;
    const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      angle: (i / PARTICLE_COUNT) * Math.PI * 2,
      radius: 65 + (i % 5) * 16,
      speed: (0.002 + (i % 3) * 0.001) * (i % 2 === 0 ? 1 : -1),
      size: 1.2 + (i % 4) * 0.5,
      alpha: 0.2 + (i % 5) * 0.15,
    }));

    const draw = (advance: boolean): void => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 75, 0, Math.PI * 2);
      ctx.arc(cx, cy, 115, 0, Math.PI * 2);
      ctx.stroke();

      // One fillStyle for the whole field, opacity per particle: setting a
      // colour string per particle was most of the cost of a frame.
      ctx.fillStyle = phase === 'work' ? 'rgb(255, 250, 0)' : 'rgb(160, 158, 40)';
      particles.forEach((particle) => {
        if (advance) particle.angle += particle.speed * 1.5;
        ctx.globalAlpha = particle.alpha * (phase === 'work' ? 0.9 : 0.4);
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(particle.angle) * particle.radius,
          cy + Math.sin(particle.angle) * particle.radius,
          particle.size,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };

    const loop = (now: number): void => {
      if (now - lastDraw >= PARTICLE_FRAME_MS) {
        lastDraw = now;
        draw(true);
      }
      frame = requestAnimationFrame(loop);
    };

    // The field drifts while a phase runs. Idle or hidden, it is one static
    // frame: an animation nobody is watching is pure battery.
    const attach = (): void => {
      cancelAnimationFrame(frame);
      if (running && document.visibilityState === 'visible') {
        frame = requestAnimationFrame(loop);
      } else {
        draw(false);
      }
    };

    attach();
    document.addEventListener('visibilitychange', attach);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', attach);
    };
  }, [phase, running]);

  const radius = 135;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressRatio);
  const needleAngle = progressRatio * 360 - 90;

  // Keyed on the number of lit ticks rather than the raw ratio, so the 60 line
  // elements rebuild 60 times per phase instead of four times a second.
  const litTicks = Math.round(progressRatio * 60);
  const ticks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        index: i,
        angle: (i / 60) * 360,
        isMajor: i % 5 === 0,
        isQuarter: i % 15 === 0,
        isActive: i <= litTicks,
      })),
    [litTicks],
  );

  return (
    <div className="relative flex size-72 items-center justify-center sm:size-84">
      <canvas
        ref={canvasRef}
        width={340}
        height={340}
        className="pointer-events-none absolute inset-0 size-full"
      />

      <svg
        viewBox="0 0 340 340"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      >
        <g stroke="var(--c-line-strong)" strokeWidth="1.5" fill="none" opacity="0.65">
          <path d="M 245 45 L 265 45 L 265 65" />
          <path d="M 265 275 L 265 295 L 245 295" />
          <path d="M 95 295 L 75 295 L 75 275" />
          <path d="M 75 65 L 75 45 L 95 45" />
        </g>

        <circle
          cx="170"
          cy="170"
          r={radius}
          fill="none"
          stroke="var(--c-line)"
          strokeWidth="3"
          opacity="0.4"
        />

        <circle
          cx="170"
          cy="170"
          r={radius}
          fill="none"
          stroke={phaseColor}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 170 170)"
        />

        <g transform="translate(170, 170)">
          {ticks.map((tick) => {
            const rad = (tick.angle - 90) * (Math.PI / 180);
            const innerR = tick.isQuarter ? 144 : tick.isMajor ? 147 : 150;
            return (
              <line
                key={tick.index}
                x1={Math.cos(rad) * innerR}
                y1={Math.sin(rad) * innerR}
                x2={Math.cos(rad) * 155}
                y2={Math.sin(rad) * 155}
                stroke={
                  tick.isActive
                    ? phaseColor
                    : tick.isQuarter
                      ? 'var(--c-text-faint)'
                      : 'var(--c-line)'
                }
                strokeWidth={tick.isQuarter ? 2 : tick.isMajor ? 1.5 : 1}
                opacity={tick.isActive ? 0.95 : 0.4}
              />
            );
          })}

          {running && (
            <g transform={`rotate(${needleAngle})`}>
              <line
                x1="0"
                y1="0"
                x2="135"
                y2="0"
                stroke={phaseColor}
                strokeWidth="1.5"
                opacity="0.8"
              />
              <circle cx="135" cy="0" r="3" fill={phaseColor} />
            </g>
          )}
        </g>
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center select-none">
        <span className="eyebrow mb-1 tracking-widest text-[var(--c-text-faint)]">
          {PHASE_LABEL[phase]}
        </span>

        <div className="display flex items-baseline font-mono text-5xl tracking-tight sm:text-6xl">
          <span className="text-[var(--c-text)]">{minutes}</span>
          <span className="px-1 text-[var(--c-accent)]">:</span>
          <span className="text-[var(--c-text)]">{seconds}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-[var(--c-text-faint)]">
            {formatMinutesDisplay(remainingMs / 60000)} left
          </span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-[var(--c-sunken)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${progressRatio * 100}%`, backgroundColor: phaseColor }}
            />
          </div>
          <span className="font-mono text-[10px] font-semibold text-[var(--c-text-muted)]">
            {Math.round(progressRatio * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * BoxBreathingPacer · 4-4-4-4, inhale, hold, exhale, hold
 * ─────────────────────────────────────────────────────────────────────── */

export function BoxBreathingPacer(): React.ReactElement {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    // 20 Hz is plenty for a circle that takes four seconds to grow.
    const interval = window.setInterval(() => setElapsed((Date.now() - start) / 1000), 50);
    return () => window.clearInterval(interval);
  }, []);

  const currentMod = elapsed % 16;

  let step: BreathStep = 'inhale';
  let stepProgress = 0;
  let label = 'Inhale';
  let sublabel = 'Breathe in slowly';
  let scale = 1;

  if (currentMod < 4) {
    step = 'inhale';
    stepProgress = currentMod / 4;
    scale = 1 + stepProgress * 0.45;
  } else if (currentMod < 8) {
    step = 'hold1';
    stepProgress = (currentMod - 4) / 4;
    label = 'Hold';
    sublabel = 'Hold it, lungs full';
    scale = 1.45;
  } else if (currentMod < 12) {
    step = 'exhale';
    stepProgress = (currentMod - 8) / 4;
    label = 'Exhale';
    sublabel = 'Release through the mouth';
    scale = 1.45 - stepProgress * 0.45;
  } else {
    step = 'hold2';
    stepProgress = (currentMod - 12) / 4;
    label = 'Hold';
    sublabel = 'Rest, lungs empty';
    scale = 1;
  }

  const warm = step === 'inhale' || step === 'hold1';

  return (
    <div className="flex flex-col items-center justify-center p-4 text-center">
      <div className="relative flex size-52 items-center justify-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${scale * 1.1})`,
            backgroundColor: warm ? 'rgba(255, 250, 0, 0.08)' : 'rgba(74, 222, 128, 0.08)',
          }}
        />
        <div
          className="relative z-10 flex size-36 flex-col items-center justify-center rounded-full border-2 bg-[var(--c-surface)] shadow-lg transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${scale})`,
            borderColor: warm ? 'var(--c-accent)' : 'var(--c-ok)',
          }}
        >
          <span className="font-mono text-base font-bold tracking-wider text-[var(--c-text)]">
            {label}
          </span>
          <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
            {Math.ceil(4 - stepProgress * 4)}s
          </span>
        </div>
      </div>
      <p className="mt-4 font-mono text-xs text-[var(--c-text-muted)]">{sublabel}</p>
    </div>
  );
}
