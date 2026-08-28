/**
 * Rest Reminder engine · background-safe alarm scheduling, OS notifications,
 * and the phase state machine.
 *
 * ## Why the timer survives a minimised window
 * `requestAnimationFrame` stops entirely when a window is minimised or the tab
 * is hidden, so anything that counted down inside a rAF loop simply froze. The
 * engine instead anchors every running phase to an absolute epoch deadline and
 * arms three independent wake-ups against it ({@link armAlarm}):
 *
 * 1. a single long `setTimeout` for the exact remaining time, since background
 *    throttling clamps how *often* timers may run, not when a lone long timer
 *    is due, so this lands within a second under normal throttling;
 * 2. a 1 s reconciliation interval, which still ticks (slowly) while hidden and
 *    catches the case where the OS suspended the machine mid-phase;
 * 3. `visibilitychange` / `focus` / `pageshow` listeners, so returning to the
 *    tab settles the clock immediately rather than on the next tick.
 *
 * Chrome applies *intensive* throttling (one wake-up per minute) to pages
 * hidden for over five minutes, unless the page is playing audio.
 * {@link backgroundCarrier} holds a 30 Hz oscillator at a gain of 0.0015 open
 * for the duration of a run, which is inaudible but still counts as playback,
 * so the page keeps its normal timer budget. It is the only audio node this
 * module creates; there are no alert chimes.
 *
 * ## Why the alert repeats now
 * The Web Notifications API coalesces notifications by `tag`. A fixed tag plus
 * `requireInteraction` meant the second and every later alert silently replaced
 * a banner that was still on screen: visible once, never again. Each alert now
 * carries a unique tag and sets `renotify`, so every phase boundary raises its
 * own banner. Delivery prefers the service worker registration, which is the
 * only path Android Chrome accepts.
 */

/* ── Types & Configuration ───────────────────────────────────────────── */

export type TimerPhase = 'work' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface TimerConfig {
  /** Focus/work phase duration in minutes. Default: 25 */
  workMinutes: number;
  /** Short break duration in minutes. Default: 5 */
  shortBreakMinutes: number;
  /** Long break duration in minutes. Default: 15 */
  longBreakMinutes: number;
  /** Number of work sessions before triggering a long break. Default: 4 */
  cyclesBeforeLongBreak: number;
  /** Target total work sessions to complete (0 for continuous). Default: 4 */
  targetCycles: number;
  /** Automatically transition and start breaks when work completes. */
  autoStartBreaks: boolean;
  /** Automatically start the next work session when a break finishes. */
  autoStartWork: boolean;
  /** Send OS-level notifications via the Web Notifications API. */
  notificationsEnabled: boolean;
  /** Keep the OS banner on screen until it is dismissed by hand. */
  stickyNotifications: boolean;
  /** Extra alerts fired after an unacknowledged phase end (0 disables). */
  alertRepeats: number;
  /** Seconds between repeat alerts. */
  alertRepeatSeconds: number;
  /** Trigger mobile haptic vibration patterns. */
  hapticsEnabled: boolean;
  /**
   * Hold the silent carrier open while running so the browser treats the page
   * as playing audio and exempts it from intensive background throttling.
   */
  keepAwake: boolean;
  /** Flash the document title until an alert is acknowledged. */
  flashTitle: boolean;
  /** Title for the work completion notification. */
  workNotificationTitle: string;
  /** Body for the work completion notification. */
  workNotificationBody: string;
  /** Title for the break completion notification. */
  breakNotificationTitle: string;
  /** Body for the break completion notification. */
  breakNotificationBody: string;
}

export interface TimerState {
  status: TimerStatus;
  phase: TimerPhase;
  /** Total duration of current phase in milliseconds. */
  durationMs: number;
  /** Remaining time in current phase in milliseconds. */
  remainingMs: number;
  /** Absolute epoch timestamp when the current phase will end if running. */
  targetEndTime: number | null;
  /** Timestamp when timer was paused (if paused). */
  pausedAt: number | null;
  /** Epoch timestamp the current phase started at, for session logging. */
  phaseStartedAt: number;
  /** Number of completed work cycles in current session. */
  completedCycles: number;
  /** Total focus time accumulated today in milliseconds. */
  totalFocusMsToday: number;
  /** Total break time taken today in milliseconds. */
  totalBreakMsToday: number;
}

export interface SessionLogEntry {
  id: string;
  phase: TimerPhase;
  startedAt: number;
  completedAt: number;
  durationMinutes: number;
  completedNaturally: boolean;
}

export interface PresetProfile {
  id: string;
  name: string;
  label: string;
  description: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  targetCycles: number;
}

/** Human label for a phase, used in badges, titles, and notification copy. */
export const PHASE_LABEL: Readonly<Record<TimerPhase, string>> = {
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

/* ── Default Presets ─────────────────────────────────────────────────── */

export const PRESETS: readonly PresetProfile[] = [
  {
    id: 'eye_care_20',
    name: '20-20-20 Eye Care',
    label: '20m Eye Care',
    description:
      'Every 20 min look at an object 20 feet away for 20-30 seconds to prevent digital eye strain.',
    workMinutes: 20,
    shortBreakMinutes: 1,
    longBreakMinutes: 5,
    cyclesBeforeLongBreak: 4,
    targetCycles: 6,
  },
  {
    id: 'pomodoro_25',
    name: 'Classic Pomodoro',
    label: '25m Pomodoro',
    description: 'Standard 25 min high-focus block followed by a 5 min restorative break.',
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    targetCycles: 4,
  },
  {
    id: 'deep_work_50',
    name: '50/10 Deep Work',
    label: '50m Deep Work',
    description: 'Extended 50 min flow state block with a 10 min cognitive reset.',
    workMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 25,
    cyclesBeforeLongBreak: 2,
    targetCycles: 4,
  },
  {
    id: 'ultradian_90',
    name: '90m Ultradian Rhythm',
    label: '90m Ultradian',
    description: 'Full 90 min biological focus cycle aligned with natural brainwave alertness.',
    workMinutes: 90,
    shortBreakMinutes: 20,
    longBreakMinutes: 30,
    cyclesBeforeLongBreak: 2,
    targetCycles: 3,
  },
  {
    id: 'quick_reset_5',
    name: '5m Quick Reset',
    label: '5m Quick Rest',
    description: 'Immediate 5 min eye rest, box breathing, and posture realignment.',
    workMinutes: 5,
    shortBreakMinutes: 2,
    longBreakMinutes: 5,
    cyclesBeforeLongBreak: 1,
    targetCycles: 1,
  },
] as const;

export const DEFAULT_CONFIG: TimerConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  targetCycles: 4,
  autoStartBreaks: true,
  autoStartWork: false,
  notificationsEnabled: true,
  stickyNotifications: true,
  alertRepeats: 2,
  alertRepeatSeconds: 30,
  hapticsEnabled: true,
  keepAwake: true,
  flashTitle: true,
  workNotificationTitle: 'Rest now, focus block complete',
  workNotificationBody: 'Look 20 feet away, stand up, drink water. Step away from the screen.',
  breakNotificationTitle: 'Break over, back to focus',
  breakNotificationBody: 'Rest interval finished. Pick the next task and start the block.',
};

/** Shortest settable phase, six seconds. Below this the alarm is a stopwatch. */
export const MIN_PHASE_MINUTES = 0.1;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Clamp a duration in minutes, keeping two decimal places.
 *
 * Durations are deliberately not integers: 1.1 minutes is a legitimate cadence
 * and the only sane way to set a sub-minute interval for testing. Two decimals
 * is 0.6 s of resolution, which is finer than anything a break clock needs and
 * keeps the number readable when it is written back into the input.
 */
function clampMinutes(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

/**
 * Rebuild a config from a persisted one.
 *
 * Only keys the current shape declares survive, so settings written by an older
 * version (the alert cues, for one) are dropped rather than lingering in local
 * storage forever. A key of the wrong type, or missing, falls back to default.
 */
export function normalizeConfig(raw: Partial<TimerConfig> | null | undefined): TimerConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };

  const merged = {} as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
    const candidate = (raw as Record<string, unknown>)[key];
    merged[key] = typeof candidate === typeof fallback ? candidate : fallback;
  }
  const config = merged as unknown as TimerConfig;

  return {
    ...config,
    workMinutes: clampMinutes(
      config.workMinutes,
      MIN_PHASE_MINUTES,
      600,
      DEFAULT_CONFIG.workMinutes,
    ),
    shortBreakMinutes: clampMinutes(
      config.shortBreakMinutes,
      MIN_PHASE_MINUTES,
      240,
      DEFAULT_CONFIG.shortBreakMinutes,
    ),
    longBreakMinutes: clampMinutes(
      config.longBreakMinutes,
      MIN_PHASE_MINUTES,
      240,
      DEFAULT_CONFIG.longBreakMinutes,
    ),
    cyclesBeforeLongBreak: clampInt(config.cyclesBeforeLongBreak, 1, 24, 4),
    targetCycles: clampInt(config.targetCycles, 0, 48, 4),
    alertRepeats: clampInt(config.alertRepeats, 0, 10, 2),
    alertRepeatSeconds: clampInt(config.alertRepeatSeconds, 5, 600, 30),
  };
}

/* ── Time Calculations & Formatting ──────────────────────────────────── */

export function minutesToMs(minutes: number): number {
  return Math.max(1000, Math.round(minutes * 60 * 1000));
}

export function phaseDurationMs(phase: TimerPhase, config: TimerConfig): number {
  if (phase === 'work') return minutesToMs(config.workMinutes);
  if (phase === 'short_break') return minutesToMs(config.shortBreakMinutes);
  return minutesToMs(config.longBreakMinutes);
}

export function formatTimeParts(totalMs: number): {
  minutes: string;
  seconds: string;
  hundredths: string;
  totalSeconds: number;
} {
  const safeMs = Math.max(0, Math.ceil(totalMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((safeMs % 1000) / 10);

  return {
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
    hundredths: String(hundredths).padStart(2, '0'),
    totalSeconds,
  };
}

/**
 * Compact duration label: seconds under a minute, otherwise minutes with at
 * most one decimal, so a 1.1 minute block does not read as "1m".
 */
export function formatMinutesDisplay(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${Math.round(minutes * 10) / 10}m`;
}

/** Wall-clock time for a deadline, e.g. "14:35". */
export function formatClockTime(epochMs: number | null): string {
  if (epochMs === null) return '--:--';
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ── Timer State Engine ──────────────────────────────────────────────── */

export function createInitialState(config: TimerConfig = DEFAULT_CONFIG): TimerState {
  const durationMs = minutesToMs(config.workMinutes);
  return {
    status: 'idle',
    phase: 'work',
    durationMs,
    remainingMs: durationMs,
    targetEndTime: null,
    pausedAt: null,
    phaseStartedAt: Date.now(),
    completedCycles: 0,
    totalFocusMsToday: 0,
    totalBreakMsToday: 0,
  };
}

export function startTimerState(state: TimerState, now = Date.now()): TimerState {
  if (state.status === 'running') return state;
  return {
    ...state,
    status: 'running',
    targetEndTime: now + state.remainingMs,
    pausedAt: null,
    phaseStartedAt: state.remainingMs === state.durationMs ? now : state.phaseStartedAt,
  };
}

export function pauseTimerState(state: TimerState, now = Date.now()): TimerState {
  if (state.status !== 'running') return state;
  const remaining =
    state.targetEndTime !== null ? Math.max(0, state.targetEndTime - now) : state.remainingMs;
  return {
    ...state,
    status: 'paused',
    remainingMs: remaining,
    targetEndTime: null,
    pausedAt: now,
  };
}

export function resetTimerState(
  state: TimerState,
  config: TimerConfig,
  now = Date.now(),
): TimerState {
  const durationMs = phaseDurationMs(state.phase, config);
  return {
    ...state,
    status: 'idle',
    durationMs,
    remainingMs: durationMs,
    targetEndTime: null,
    pausedAt: null,
    phaseStartedAt: now,
  };
}

export function adjustTimerDuration(
  state: TimerState,
  deltaMinutes: number,
  now = Date.now(),
): TimerState {
  const deltaMs = deltaMinutes * 60 * 1000;
  const live =
    state.status === 'running' && state.targetEndTime !== null
      ? Math.max(0, state.targetEndTime - now)
      : state.remainingMs;
  const newRemaining = Math.max(1000, live + deltaMs);
  const newDuration = Math.max(newRemaining, state.durationMs + deltaMs);

  return {
    ...state,
    durationMs: newDuration,
    remainingMs: newRemaining,
    targetEndTime: state.status === 'running' ? now + newRemaining : null,
  };
}

export function switchPhaseState(
  state: TimerState,
  targetPhase: TimerPhase,
  config: TimerConfig,
  autoStart = false,
  now = Date.now(),
): TimerState {
  const durationMs = phaseDurationMs(targetPhase, config);
  return {
    ...state,
    status: autoStart ? 'running' : 'idle',
    phase: targetPhase,
    durationMs,
    remainingMs: durationMs,
    targetEndTime: autoStart ? now + durationMs : null,
    pausedAt: null,
    phaseStartedAt: now,
  };
}

export function computeNextPhase(
  currentPhase: TimerPhase,
  completedCycles: number,
  config: TimerConfig,
): { nextPhase: TimerPhase; nextCycleCount: number; isLongBreak: boolean } {
  if (currentPhase === 'work') {
    const nextCycleCount = completedCycles + 1;
    const isLongBreak =
      config.cyclesBeforeLongBreak > 0 && nextCycleCount % config.cyclesBeforeLongBreak === 0;
    return { nextPhase: isLongBreak ? 'long_break' : 'short_break', nextCycleCount, isLongBreak };
  }
  return { nextPhase: 'work', nextCycleCount: completedCycles, isLongBreak: false };
}

export interface PhaseTransition {
  /** Phase that just finished. */
  from: TimerPhase;
  /** Phase the timer moved into. */
  to: TimerPhase;
  /** Epoch timestamp the finished phase started at. */
  startedAt: number;
  /** Epoch timestamp the finished phase ended at. */
  endedAt: number;
  /** Length of the finished phase in milliseconds. */
  durationMs: number;
}

/** Guard against an unbounded roll-forward after a very long machine sleep. */
const MAX_ROLL_FORWARD_PHASES = 64;

/**
 * Advance the state machine past every phase whose deadline has already passed.
 *
 * One lapsed phase is the normal case. Several lapse at once when the machine
 * slept, the tab was throttled hard, or auto-start chained through short phases
 * while the window was minimised. Each is still returned, so the session log
 * stays truthful about what actually elapsed.
 *
 * @param state Current timer state; a non-running state is returned untouched.
 * @param config Cadence configuration in force.
 * @param now Reference timestamp, injectable for tests.
 * @returns The settled state plus every transition that fired, oldest first.
 */
export function rollForwardElapsedPhases(
  state: TimerState,
  config: TimerConfig,
  now = Date.now(),
): { state: TimerState; transitions: PhaseTransition[] } {
  const transitions: PhaseTransition[] = [];
  let current = state;

  for (let i = 0; i < MAX_ROLL_FORWARD_PHASES; i += 1) {
    if (current.status !== 'running' || current.targetEndTime === null) break;
    if (current.targetEndTime > now) break;

    const endedAt = current.targetEndTime;
    const from = current.phase;
    const { nextPhase, nextCycleCount } = computeNextPhase(from, current.completedCycles, config);
    const autoStart = from === 'work' ? config.autoStartBreaks : config.autoStartWork;
    const nextDuration = phaseDurationMs(nextPhase, config);

    transitions.push({
      from,
      to: nextPhase,
      startedAt: current.phaseStartedAt,
      endedAt,
      durationMs: current.durationMs,
    });

    current = {
      ...current,
      status: autoStart ? 'running' : 'idle',
      phase: nextPhase,
      completedCycles: nextCycleCount,
      durationMs: nextDuration,
      remainingMs: nextDuration,
      // A chained phase is anchored to the moment the previous one ended, not
      // to `now`, or a late wake-up would silently stretch the cadence.
      targetEndTime: autoStart ? endedAt + nextDuration : null,
      pausedAt: null,
      phaseStartedAt: endedAt,
      totalFocusMsToday:
        from === 'work'
          ? current.totalFocusMsToday + current.durationMs
          : current.totalFocusMsToday,
      totalBreakMsToday:
        from === 'work'
          ? current.totalBreakMsToday
          : current.totalBreakMsToday + current.durationMs,
    };
  }

  // A chained phase that is still overdue when the iteration cap is hit gets a
  // fresh deadline rather than being left in the past, which would spin.
  if (
    current.status === 'running' &&
    current.targetEndTime !== null &&
    current.targetEndTime <= now
  ) {
    current = { ...current, targetEndTime: now + current.durationMs, phaseStartedAt: now };
  }

  return { state: current, transitions };
}

/**
 * Rebuild a persisted state after a reload, discarding anything incoherent.
 *
 * The deadline is absolute, so a run survives a refresh: whatever elapsed while
 * the page was gone is settled afterwards by {@link rollForwardElapsedPhases}.
 */
export function rehydrateState(raw: unknown, config: TimerConfig): TimerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<TimerState>;
  if (typeof candidate.phase !== 'string' || typeof candidate.status !== 'string') return null;
  if (!['work', 'short_break', 'long_break'].includes(candidate.phase)) return null;

  const base = createInitialState(config);
  const merged: TimerState = {
    ...base,
    ...candidate,
    phase: candidate.phase as TimerPhase,
    status: candidate.status === 'running' ? 'running' : 'idle',
    durationMs: Number.isFinite(candidate.durationMs)
      ? (candidate.durationMs as number)
      : base.durationMs,
    remainingMs: Number.isFinite(candidate.remainingMs)
      ? (candidate.remainingMs as number)
      : base.remainingMs,
    targetEndTime:
      typeof candidate.targetEndTime === 'number' && Number.isFinite(candidate.targetEndTime)
        ? candidate.targetEndTime
        : null,
    phaseStartedAt:
      typeof candidate.phaseStartedAt === 'number' && Number.isFinite(candidate.phaseStartedAt)
        ? candidate.phaseStartedAt
        : Date.now(),
  };

  if (merged.status === 'running' && merged.targetEndTime === null) {
    return { ...merged, status: 'idle' };
  }
  return merged;
}

/* ── Background-safe alarm scheduling ────────────────────────────────── */

export interface AlarmHandle {
  /** Stop every wake-up bound to this deadline. Safe to call twice. */
  cancel(): void;
}

/** `setTimeout` saturates past this delay, so long waits are re-armed. */
const MAX_TIMEOUT_MS = 2_000_000_000;

/**
 * Fire `onDue` when the wall clock reaches `targetEpochMs`, including while the
 * window is minimised, the tab is hidden, or the machine has just woken.
 *
 * @param targetEpochMs Absolute deadline in epoch milliseconds.
 * @param onDue Called exactly once, on or after the deadline.
 * @returns Handle that cancels every pending wake-up.
 */
export function armAlarm(targetEpochMs: number, onDue: () => void): AlarmHandle {
  if (typeof window === 'undefined') return { cancel: () => undefined };

  let fired = false;
  let timeoutId: number | undefined;
  let intervalId: number | undefined;

  const cleanup = (): void => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    if (intervalId !== undefined) window.clearInterval(intervalId);
    timeoutId = undefined;
    intervalId = undefined;
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
  };

  function check(): void {
    if (fired) return;
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) {
      fired = true;
      cleanup();
      onDue();
      return;
    }
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
  }

  intervalId = window.setInterval(check, 1000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  check();

  return {
    cancel: () => {
      fired = true;
      cleanup();
    },
  };
}

/* ── Web Notifications API & OS Integration ──────────────────────────── */

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return 'denied';
  }
}

let workerRegistration: ServiceWorkerRegistration | null = null;
let workerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register the notification service worker.
 *
 * It is the only delivery path Android Chrome accepts (`new Notification()`
 * throws there) and the only one where clicking the banner focuses this tab
 * instead of opening a duplicate. The worker handles clicks only, and registers
 * no `fetch` listener, so it never sits in front of the site's own requests.
 *
 * Failure is not fatal: delivery falls back to the `Notification` constructor.
 *
 * @param scriptUrl Path to the worker, already resolved against the site base.
 */
export function registerNotificationWorker(
  scriptUrl: string,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (workerRegistrationPromise) return workerRegistrationPromise;

  workerRegistrationPromise = navigator.serviceWorker
    .register(scriptUrl, { scope: scriptUrl.replace(/[^/]+$/, '') })
    .then(async (registration) => {
      await navigator.serviceWorker.ready.catch(() => undefined);
      workerRegistration = registration;
      return registration;
    })
    .catch(() => null);

  return workerRegistrationPromise;
}

let notificationSequence = 0;

export interface OSNotificationRequest {
  title: string;
  body: string;
  /** Keep the banner up until dismissed. Ignored by some platforms. */
  requireInteraction?: boolean;
  icon?: string;
  /** Vibration pattern; honoured only on the service worker path. */
  vibrate?: number[];
  /** Close the banner after this many ms when it is not sticky. */
  autoCloseMs?: number;
}

/** What happened to the most recent delivery attempt. */
export interface DeliveryReport {
  /** When the attempt was made. */
  at: number;
  /** Which path was tried last. */
  path: 'worker' | 'constructor' | 'blocked';
  ok: boolean;
  /** Human-readable outcome, including the thrown message on a failure. */
  detail: string;
}

let lastDelivery: DeliveryReport | null = null;

function record(path: DeliveryReport['path'], ok: boolean, detail: string): void {
  lastDelivery = { at: Date.now(), path, ok, detail };
}

/** The most recent delivery attempt, so a silent failure stays visible. */
export function readLastDelivery(): DeliveryReport | null {
  return lastDelivery;
}

function showViaConstructor(
  title: string,
  options: NotificationOptions,
  requireInteraction: boolean,
  autoCloseMs: number | undefined,
): boolean {
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    notification.onerror = () => record('constructor', false, 'the platform rejected the banner');
    if (!requireInteraction && autoCloseMs) {
      window.setTimeout(() => notification.close(), autoCloseMs);
    }
    record('constructor', true, 'handed to the browser');
    return true;
  } catch (error) {
    record('constructor', false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Raise one OS notification.
 *
 * Two things make this less obvious than it looks.
 *
 * Every call gets a fresh `tag` and sets `renotify`, because the API coalesces
 * by tag: a fixed tag means the second alert silently replaces a banner that is
 * still on screen, which is why a cycle used to alert exactly once.
 *
 * `ServiceWorkerRegistration.showNotification` returns a promise and rejects
 * *asynchronously* when the registration has no active worker, so a synchronous
 * try/catch around it reports success for a banner that never appeared. The
 * worker path is therefore gated on an active worker and its rejection falls
 * back to the constructor.
 *
 * @returns `true` when a path accepted the notification. The final outcome of
 * the worker path lands in {@link readLastDelivery}.
 */
export function sendOSNotification(request: OSNotificationRequest): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    record('blocked', false, 'this browser has no Notifications API');
    return false;
  }
  if (Notification.permission !== 'granted') {
    record('blocked', false, `permission is "${Notification.permission}"`);
    return false;
  }

  notificationSequence += 1;
  const requireInteraction = request.requireInteraction ?? true;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: request.body,
    tag: `coronring-rest-${Date.now()}-${notificationSequence}`,
    renotify: true,
    icon: request.icon,
    badge: request.icon,
    requireInteraction,
    silent: false,
    vibrate: request.vibrate,
    data: { url: window.location.href },
  };

  const registration = workerRegistration;
  if (registration && registration.active) {
    registration
      .showNotification(request.title, options)
      .then(() => record('worker', true, 'shown by the service worker'))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!showViaConstructor(request.title, options, requireInteraction, request.autoCloseMs)) {
          record('worker', false, message);
        }
      });
    return true;
  }

  return showViaConstructor(request.title, options, requireInteraction, request.autoCloseMs);
}

export interface NotificationDiagnostics {
  /** The Notifications API exists in this browser. */
  supported: boolean;
  permission: NotificationPermissionState;
  /** Notifications are refused outright on an insecure origin. */
  secureContext: boolean;
  /** A worker is registered *and* active, which is what delivery requires. */
  serviceWorkerActive: boolean;
  /** `'visible' | 'hidden'`, the state that decides background throttling. */
  visibility: string;
  /** Outcome of the last attempt, or null when nothing has been sent yet. */
  lastDelivery: DeliveryReport | null;
}

/** Snapshot of everything that decides whether an alert can actually appear. */
export function readNotificationDiagnostics(): NotificationDiagnostics {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      secureContext: false,
      serviceWorkerActive: false,
      visibility: 'unknown',
      lastDelivery: null,
    };
  }
  return {
    supported: 'Notification' in window,
    permission: getNotificationPermission(),
    secureContext: window.isSecureContext,
    serviceWorkerActive: workerRegistration?.active != null,
    visibility: document.visibilityState,
    lastDelivery,
  };
}

export function triggerHapticFeedback(
  pattern: number | number[] = [200, 100, 200, 100, 400],
): void {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore haptic restrictions */
    }
  }
}

/* ── Silent background carrier ────────────────────────────────────────── */

/**
 * A single inaudible oscillator, held open while a phase runs.
 *
 * Chrome and Edge drop a page hidden for more than five minutes to one timer
 * wake-up per minute, which is enough to make a break alarm land a minute late.
 * A page that is playing audio is exempt. This holds a 30 Hz sine at a gain of
 * 0.0015, far below anything a speaker will reproduce as sound but still real
 * output as far as the audibility check is concerned, so the timers keep their
 * normal budget. The tab shows a speaker icon while it is running.
 *
 * This is the only audio in the tool. There are no alert chimes.
 */
class BackgroundCarrier {
  private ctx: AudioContext | null = null;
  private nodes: { osc: OscillatorNode; gain: GainNode } | null = null;

  private static getConstructor(): typeof AudioContext | undefined {
    if (typeof window === 'undefined') return undefined;
    return (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
  }

  private getContext(): AudioContext | null {
    const AudioCtor = BackgroundCarrier.getConstructor();
    if (!AudioCtor) return null;
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioCtor();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** `'unsupported' | 'idle' | AudioContextState`, for the diagnostics panel. */
  get state(): string {
    if (!BackgroundCarrier.getConstructor()) return 'unsupported';
    return this.ctx ? this.ctx.state : 'idle';
  }

  get active(): boolean {
    return this.nodes !== null;
  }

  /**
   * Open the audio context from inside a user gesture.
   *
   * Autoplay policy refuses a context first created inside a timer callback, so
   * every control that can start a run calls this first.
   */
  unlock(): void {
    const ctx = this.getContext();
    if (ctx) void ctx.resume();
  }

  setActive(on: boolean): void {
    if (on) {
      if (this.nodes) return;
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(30, ctx.currentTime);
      gain.gain.setValueAtTime(0.0015, ctx.currentTime);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this.nodes = { osc, gain };
      return;
    }

    if (!this.nodes) return;
    try {
      this.nodes.osc.stop();
      this.nodes.osc.disconnect();
      this.nodes.gain.disconnect();
    } catch {
      /* already torn down */
    }
    this.nodes = null;
  }
}

export const backgroundCarrier = new BackgroundCarrier();
