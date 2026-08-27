/**
 * Rest Reminder engine — drift-free timer state machine, cross-platform OS
 * notifications, Web Audio procedural synthesizer, and session telemetry.
 *
 * ## Drift-free timestamp architecture
 * Browsers throttle `setInterval` and `setTimeout` down to 1000ms+ in background
 * tabs or inactive windows. Rather than counting elapsed ticks on a timer, the
 * engine anchors each active phase to an absolute target epoch timestamp
 * (`targetEndTime = Date.now() + remainingMs`). When the tab wakes or updates,
 * elapsed time is computed as `targetEndTime - Date.now()`, ensuring millisecond
 * accuracy regardless of tab throttling or OS sleep cycles.
 *
 * ## Zero-network Web Audio synthesis
 * All audio cues (Tactical Ping, Aurora Chime, Digital Radar Beep, Zen Gong) are
 * procedurally synthesized using the Web Audio API with oscillators, biquad
 * filters, and exponential gain ramps. No audio assets or external network
 * downloads are required.
 */

/* ── Types & Configuration ───────────────────────────────────────────── */

export type TimerPhase = 'work' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';
export type SoundType = 'tactical_ping' | 'aurora_chime' | 'digital_beep' | 'zen_gong';

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
  /** Play procedural Web Audio chime on phase changes. */
  soundEnabled: boolean;
  /** Master volume (0.0 to 1.0). */
  soundVolume: number;
  /** Sound type for work completion (start of break). */
  workCompleteSound: SoundType;
  /** Sound type for break completion (start of work). */
  breakCompleteSound: SoundType;
  /** Send OS-level push notifications via Web Notifications API. */
  notificationsEnabled: boolean;
  /** Trigger mobile haptic vibration patterns. */
  hapticsEnabled: boolean;
  /** Title template for work completion notification. */
  workNotificationTitle: string;
  /** Body message for work completion notification. */
  workNotificationBody: string;
  /** Title template for break completion notification. */
  breakNotificationTitle: string;
  /** Body message for break completion notification. */
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

/* ── Default Presets ─────────────────────────────────────────────────── */

export const PRESETS: readonly PresetProfile[] = [
  {
    id: 'eye_care_20',
    name: '20-20-20 Eye Care',
    label: '20m Eye Care',
    description: 'Every 20 min look at an object 20 feet away for 20-30 seconds to prevent digital eye strain.',
    workMinutes: 20,
    shortBreakMinutes: 1, // 1 min (can do 20-30s eye rest)
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
  autoStartBreaks: false,
  autoStartWork: false,
  soundEnabled: true,
  soundVolume: 0.8,
  workCompleteSound: 'aurora_chime',
  breakCompleteSound: 'tactical_ping',
  notificationsEnabled: true,
  hapticsEnabled: true,
  workNotificationTitle: 'REST REQUIRED // Cadence Complete',
  workNotificationBody: 'Time to rest your eyes, stretch, and hydrate. Step away from the screen.',
  breakNotificationTitle: 'FOCUS ARMED // Break Complete',
  breakNotificationBody: 'Rest interval finished. Return to tactical workstation.',
};

/* ── Time Calculations & Formatting ──────────────────────────────────── */

export function minutesToMs(minutes: number): number {
  return Math.max(1, Math.round(minutes * 60 * 1000));
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

export function formatMinutesDisplay(minutes: number): string {
  if (minutes < 1) {
    return `${Math.round(minutes * 60)}s`;
  }
  return `${minutes}m`;
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
    completedCycles: 0,
    totalFocusMsToday: 0,
    totalBreakMsToday: 0,
  };
}

export function startTimerState(state: TimerState): TimerState {
  if (state.status === 'running') return state;
  const now = Date.now();
  return {
    ...state,
    status: 'running',
    targetEndTime: now + state.remainingMs,
    pausedAt: null,
  };
}

export function pauseTimerState(state: TimerState): TimerState {
  if (state.status !== 'running') return state;
  const now = Date.now();
  const remaining = state.targetEndTime !== null ? Math.max(0, state.targetEndTime - now) : state.remainingMs;
  return {
    ...state,
    status: 'paused',
    remainingMs: remaining,
    targetEndTime: null,
    pausedAt: now,
  };
}

export function resetTimerState(state: TimerState, config: TimerConfig): TimerState {
  const durationMs =
    state.phase === 'work'
      ? minutesToMs(config.workMinutes)
      : state.phase === 'short_break'
        ? minutesToMs(config.shortBreakMinutes)
        : minutesToMs(config.longBreakMinutes);

  return {
    ...state,
    status: 'idle',
    durationMs,
    remainingMs: durationMs,
    targetEndTime: null,
    pausedAt: null,
  };
}

export function adjustTimerDuration(state: TimerState, deltaMinutes: number): TimerState {
  const deltaMs = deltaMinutes * 60 * 1000;
  const newRemaining = Math.max(1000, state.remainingMs + deltaMs);
  const newDuration = Math.max(newRemaining, state.durationMs + deltaMs);
  const now = Date.now();

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
): TimerState {
  const durationMs =
    targetPhase === 'work'
      ? minutesToMs(config.workMinutes)
      : targetPhase === 'short_break'
        ? minutesToMs(config.shortBreakMinutes)
        : minutesToMs(config.longBreakMinutes);

  const now = Date.now();
  return {
    ...state,
    status: autoStart ? 'running' : 'idle',
    phase: targetPhase,
    durationMs,
    remainingMs: durationMs,
    targetEndTime: autoStart ? now + durationMs : null,
    pausedAt: null,
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
    return {
      nextPhase: isLongBreak ? 'long_break' : 'short_break',
      nextCycleCount,
      isLongBreak,
    };
  }

  // Completing a break returns to work
  return {
    nextPhase: 'work',
    nextCycleCount: completedCycles,
    isLongBreak: false,
  };
}

/* ── Web Notifications API & OS Integration ──────────────────────────── */

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermissionState;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return 'denied';
  }
}

export function sendOSNotification({
  title,
  body,
  tag = 'coronring-rest-reminder',
  icon,
}: {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
}): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: icon ?? '/favicon.ico',
      requireInteraction: true,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    return true;
  } catch {
    return false;
  }
}

export function triggerHapticFeedback(pattern: number | number[] = [200, 100, 200, 100, 400]): void {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore haptic restrictions */
    }
  }
}

/* ── Web Audio Procedural Synthesizer ─────────────────────────────────── */

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Tactical Ping: High-tech dual-pitch chirp (880 Hz -> 1760 Hz)
   * with crisp envelope attack and exponential damping.
   */
  playTacticalPing(volume = 0.8): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, volume)) * 0.35, now);
    masterGain.connect(ctx.destination);

    // Primary osc
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.08);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(1.0, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.38);

    // Secondary sub-harmonic harmonic chirp
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1320, now + 0.05);
    osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.12);

    gain2.gain.setValueAtTime(0.001, now + 0.05);
    gain2.gain.linearRampToValueAtTime(0.6, now + 0.065);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.48);
  }

  /**
   * Aurora Chime: Ethereal harmonic triad chord (C5, E5, G5, B5 Solfeggio feel)
   * with warm ambient resonance and smooth multi-stage decay.
   */
  playAuroraChime(volume = 0.8): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, volume)) * 0.28, now);
    masterGain.connect(ctx.destination);

    // 528 Hz (Solfeggio Transformation) + C5 (523Hz), E5 (659Hz), G5 (784Hz), B5 (987Hz)
    const frequencies = [528, 659.25, 783.99, 987.77];
    const delays = [0, 0.06, 0.12, 0.18];

    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const startTime = now + (delays[idx] ?? 0);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, startTime);
      filter.frequency.exponentialRampToValueAtTime(800, startTime + 1.2);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.8 / (idx + 1), startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.6);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(startTime);
      osc.stop(startTime + 1.65);
    });
  }

  /**
   * Digital Radar Beep: Triple square/saw alert pattern for sharp tactical focus.
   */
  playDigitalBeep(volume = 0.8): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, volume)) * 0.22, now);
    masterGain.connect(ctx.destination);

    const beeps = [0, 0.12, 0.24];
    beeps.forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + offset;

      osc.type = 'square';
      osc.frequency.setValueAtTime(1046.5, t); // C6

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.9, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.08);
    });
  }

  /**
   * Zen Gong / Singing Bowl: Deep acoustic singing bowl with low harmonic
   * resonance (130Hz fundamental) and sustained calming fade-out.
   */
  playZenGong(volume = 0.8): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, volume)) * 0.45, now);
    masterGain.connect(ctx.destination);

    // Fundamental + overtone ratios (1.0, 2.76, 5.4, 8.93)
    const fundamental = 146.83; // D3
    const overtones = [
      { freq: fundamental * 1.0, gain: 0.9, decay: 2.8 },
      { freq: fundamental * 2.76, gain: 0.4, decay: 2.2 },
      { freq: fundamental * 5.4, gain: 0.2, decay: 1.5 },
      { freq: fundamental * 8.93, gain: 0.1, decay: 1.0 },
    ];

    overtones.forEach(({ freq, gain, decay }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(gain, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);

      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    });
  }

  play(sound: SoundType, volume = 0.8): void {
    switch (sound) {
      case 'tactical_ping':
        this.playTacticalPing(volume);
        break;
      case 'aurora_chime':
        this.playAuroraChime(volume);
        break;
      case 'digital_beep':
        this.playDigitalBeep(volume);
        break;
      case 'zen_gong':
        this.playZenGong(volume);
        break;
    }
  }
}

export const soundSynth = new SoundSynthesizer();
