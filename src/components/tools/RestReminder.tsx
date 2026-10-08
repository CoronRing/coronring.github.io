/**
 * Rest Reminder · a break clock that keeps firing while the window is minimised.
 *
 * The engine in `src/lib/rest-timer.ts` owns the hard parts: an absolute epoch
 * deadline armed against three independent wake-ups, a silent carrier that
 * keeps the page off Chrome's throttled-background path, and uniquely-tagged
 * notifications so every cycle raises its own banner.
 *
 * This file owns the timer state, the alarms and the settings. Everything that
 * only draws is in `rest-reminder-panels.tsx`.
 *
 * ## Render budget
 *
 * Only `LiveClock` re-renders on a tick, at 4 Hz, and the tab title is written
 * from an interval that holds no state at all. Advancing the countdown in this
 * component instead would re-render the settings form, sixty SVG ticks and the
 * delivery panel with it, several times a second.
 *
 * Layout is one column, no tabs: alert, clock, then settings directly beneath
 * the thing they configure, then the delivery self-check, guide, and log.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  PHASE_LABEL,
  PRESETS,
  adjustTimerDuration,
  armAlarm,
  backgroundCarrier,
  computeNextPhase,
  createInitialState,
  getNotificationPermission,
  MIN_PHASE_MINUTES,
  normalizeConfig,
  pauseTimerState,
  phaseDurationMs,
  readNotificationDiagnostics,
  registerNotificationWorker,
  rehydrateState,
  requestNotificationPermission,
  resetTimerState,
  rollForwardElapsedPhases,
  sendOSNotification,
  startTimerState,
  switchPhaseState,
  triggerHapticFeedback,
  type NotificationDiagnostics,
  type NotificationPermissionState,
  type PresetProfile,
  type SessionLogEntry,
  type TimerConfig,
  type TimerPhase,
  type TimerState,
} from '../../lib/rest-timer';
import { href } from '../../lib/url';
import {
  AlertBanner,
  BoxBreathingPacer,
  Collapsible,
  DeliveryCheck,
  LiveClock,
  TEST_DELAY_SECONDS,
  useDocumentTitle,
  type PendingAlert,
} from './rest-reminder-panels';
import {
  Badge,
  Button,
  Field,
  Kbd,
  NumberField,
  OutputBox,
  Panel,
  StatRow,
  TextField,
  Toggle,
} from './ui';

/* ── Storage ──────────────────────────────────────────────────────────── */

const KEY_CONFIG = 'coronring.tools.rest-reminder.config';
const KEY_STATE = 'coronring.tools.rest-reminder.state';
const KEY_HISTORY = 'coronring.tools.rest-reminder.history';

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

/* ── Constants ───────────────────────────────────────────────── */

/** A phase that ended longer ago than this settles silently on catch-up. */
const STALE_ALERT_MS = 5 * 60 * 1000;

/* ── Component ────────────────────────────────────────────────────────── */

export default function RestReminder(): React.ReactElement {
  const [config, setConfig] = useState<TimerConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<TimerState>(() => createInitialState(DEFAULT_CONFIG));
  const [history, setHistory] = useState<SessionLogEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [pendingAlert, setPendingAlert] = useState<PendingAlert | null>(null);
  const [notificationPerm, setNotificationPerm] = useState<NotificationPermissionState>('default');
  const [diagnostics, setDiagnostics] = useState<NotificationDiagnostics | null>(null);
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  /** Bumped to re-arm a deadline whose wake-up found nothing to settle. */
  const [armToken, setArmToken] = useState(0);

  const configRef = useRef(config);
  const stateRef = useRef(state);
  const dueRef = useRef<() => void>(() => undefined);
  const repeatTimerRef = useRef<number | undefined>(undefined);
  const testAlarmRef = useRef<{ cancel: () => void } | null>(null);

  configRef.current = config;
  stateRef.current = state;

  /* ── Hydration ─────────────────────────────────────────────────────── */
  // localStorage cannot be read during the first render without breaking
  // Astro's hydration match, so the saved cadence lands one tick later.
  useEffect(() => {
    const storedConfig = normalizeConfig(readJson<Partial<TimerConfig>>(KEY_CONFIG));
    const storedState = rehydrateState(readJson<unknown>(KEY_STATE), storedConfig);
    setConfig(storedConfig);
    setState(storedState ?? createInitialState(storedConfig));
    setHistory(readJson<SessionLogEntry[]>(KEY_HISTORY) ?? []);
    setNotificationPerm(getNotificationPermission());
    setDiagnostics(readNotificationDiagnostics());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(KEY_CONFIG, config);
  }, [config, hydrated]);

  useEffect(() => {
    if (hydrated) writeJson(KEY_STATE, state);
  }, [state, hydrated]);

  useEffect(() => {
    if (hydrated) writeJson(KEY_HISTORY, history);
  }, [history, hydrated]);

  /* ── Notification channel ──────────────────────────────────────────── */
  useEffect(() => {
    if (getNotificationPermission() !== 'granted') return;
    void registerNotificationWorker(href('/rest-reminder-sw.js')).then(() => {
      setDiagnostics(readNotificationDiagnostics());
    });
  }, [notificationPerm]);

  /* ── Alerting ──────────────────────────────────────────────────────── */

  const fireAlert = useCallback((completedPhase: TimerPhase, cfg: TimerConfig): void => {
    if (cfg.hapticsEnabled) {
      triggerHapticFeedback(completedPhase === 'work' ? [200, 100, 200, 100, 400] : [150, 80, 150]);
    }
    if (cfg.notificationsEnabled) {
      const isWork = completedPhase === 'work';
      sendOSNotification({
        title: isWork ? cfg.workNotificationTitle : cfg.breakNotificationTitle,
        body: isWork ? cfg.workNotificationBody : cfg.breakNotificationBody,
        requireInteraction: cfg.stickyNotifications,
        icon: href('/favicon.svg'),
        vibrate: cfg.hapticsEnabled ? [200, 100, 200] : undefined,
        autoCloseMs: 30_000,
      });
    }
    // The worker path resolves a tick later, so read the outcome after it.
    window.setTimeout(() => setDiagnostics(readNotificationDiagnostics()), 400);
  }, []);

  const stopRepeatAlerts = useCallback((): void => {
    if (repeatTimerRef.current !== undefined) {
      window.clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = undefined;
    }
  }, []);

  /** Re-alert on an interval until the break is acknowledged, up to N times. */
  const startRepeatAlerts = useCallback(
    (completedPhase: TimerPhase, cfg: TimerConfig): void => {
      stopRepeatAlerts();
      if (cfg.alertRepeats <= 0) return;
      let sent = 0;
      repeatTimerRef.current = window.setInterval(
        () => {
          sent += 1;
          if (sent > cfg.alertRepeats) {
            stopRepeatAlerts();
            return;
          }
          fireAlert(completedPhase, configRef.current);
        },
        Math.max(5, cfg.alertRepeatSeconds) * 1000,
      );
    },
    [fireAlert, stopRepeatAlerts],
  );

  const acknowledgeAlert = useCallback((): void => {
    stopRepeatAlerts();
    setPendingAlert(null);
  }, [stopRepeatAlerts]);

  /* ── Deadline reached ──────────────────────────────────────────────── */

  const handleDue = useCallback((): void => {
    const cfg = configRef.current;
    const now = Date.now();
    const { state: settled, transitions } = rollForwardElapsedPhases(stateRef.current, cfg, now);
    if (transitions.length === 0) {
      // The wake-up beat the state it was armed against. Re-arm rather than
      // leaving the deadline with nothing watching it.
      setArmToken((token) => token + 1);
      return;
    }

    // Newest first, matching the log order. Reversed here rather than inside
    // the updater, which React may invoke more than once.
    const entries: SessionLogEntry[] = transitions
      .map((transition, index) => ({
        id: `${transition.endedAt}-${index}`,
        phase: transition.from,
        startedAt: transition.startedAt,
        completedAt: transition.endedAt,
        // Two decimals, so a 1.1 minute block does not log as 1.
        durationMinutes: Math.round(transition.durationMs / 600) / 100,
        completedNaturally: true,
      }))
      .reverse();
    setHistory((prev) => [...entries, ...prev].slice(0, 200));

    const last = transitions[transitions.length - 1]!;
    const stale = now - last.endedAt > STALE_ALERT_MS;

    setState(settled);
    setPendingAlert({
      completed: last.from,
      next: last.to,
      at: last.endedAt,
      autoStarted: settled.status === 'running',
      stale,
    });

    if (stale) return;
    fireAlert(last.from, cfg);
    startRepeatAlerts(last.from, cfg);
  }, [fireAlert, startRepeatAlerts]);

  dueRef.current = handleDue;

  /* ── Keep the page out of intensive background throttling ──────────── */
  useEffect(() => {
    backgroundCarrier.setActive(config.keepAwake && state.status === 'running');
  }, [config.keepAwake, state.status]);

  /* ── Arm the deadline ──────────────────────────────────────────────── */
  useEffect(() => {
    if (state.status !== 'running' || state.targetEndTime === null) return;
    const handle = armAlarm(state.targetEndTime, () => dueRef.current());
    return () => handle.cancel();
  }, [state.status, state.targetEndTime, armToken]);

  useEffect(
    () => () => {
      backgroundCarrier.setActive(false);
      if (repeatTimerRef.current !== undefined) window.clearInterval(repeatTimerRef.current);
      if (testAlarmRef.current) testAlarmRef.current.cancel();
    },
    [],
  );

  useDocumentTitle(state, pendingAlert, config.flashTitle);

  /* ── Diagnostics refresh ───────────────────────────────────────────── */
  useEffect(() => {
    const refresh = (): void => setDiagnostics(readNotificationDiagnostics());
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(interval);
    };
  }, []);

  /* ── Controls ──────────────────────────────────────────────────────── */

  const handleStart = useCallback((): void => {
    backgroundCarrier.unlock();
    acknowledgeAlert();
    setState((prev) => startTimerState(prev));
  }, [acknowledgeAlert]);

  const handlePause = useCallback((): void => {
    setState((prev) => pauseTimerState(prev));
  }, []);

  const handleReset = useCallback((): void => {
    acknowledgeAlert();
    setState((prev) => resetTimerState(prev, configRef.current));
  }, [acknowledgeAlert]);

  const handleSkip = useCallback((): void => {
    backgroundCarrier.unlock();
    acknowledgeAlert();
    setState((prev) => {
      const cfg = configRef.current;
      const { nextPhase, nextCycleCount } = computeNextPhase(prev.phase, prev.completedCycles, cfg);
      return switchPhaseState(
        { ...prev, completedCycles: nextCycleCount },
        nextPhase,
        cfg,
        prev.status === 'running',
      );
    });
  }, [acknowledgeAlert]);

  const handleAdjust = useCallback((deltaMinutes: number): void => {
    setState((prev) => adjustTimerDuration(prev, deltaMinutes));
  }, []);

  /**
   * Write a config change through, and re-length the current phase with it when
   * the clock is not running. A running phase keeps its deadline: silently
   * moving a deadline someone is already counting down against is worse than
   * waiting for the next phase to pick the new length up.
   */
  const patchConfig = useCallback((patch: Partial<TimerConfig>): void => {
    const next = normalizeConfig({ ...configRef.current, ...patch });
    configRef.current = next;
    setConfig(next);
    setState((prev) => {
      if (prev.status === 'running') return prev;
      const duration = phaseDurationMs(prev.phase, next);
      return { ...prev, durationMs: duration, remainingMs: duration };
    });
  }, []);

  const handleSelectPreset = useCallback(
    (preset: PresetProfile): void => {
      patchConfig({
        workMinutes: preset.workMinutes,
        shortBreakMinutes: preset.shortBreakMinutes,
        longBreakMinutes: preset.longBreakMinutes,
        cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
        targetCycles: preset.targetCycles,
      });
      setState((prev) =>
        prev.status === 'running'
          ? prev
          : {
              ...createInitialState(configRef.current),
              completedCycles: prev.completedCycles,
              totalFocusMsToday: prev.totalFocusMsToday,
              totalBreakMsToday: prev.totalBreakMsToday,
            },
      );
    },
    [patchConfig],
  );

  const handleRequestPermission = useCallback(async (): Promise<void> => {
    const permission = await requestNotificationPermission();
    setNotificationPerm(permission);
    if (permission === 'granted') {
      await registerNotificationWorker(href('/rest-reminder-sw.js'));
      sendOSNotification({
        title: 'Notifications are on',
        body: 'This is what a break alert will look like.',
        requireInteraction: false,
        icon: href('/favicon.svg'),
        autoCloseMs: 12_000,
      });
    }
    window.setTimeout(() => setDiagnostics(readNotificationDiagnostics()), 400);
  }, []);

  /**
   * Schedule a one-off alert so the browser can be minimised and the delivery
   * path checked end to end without waiting out a whole focus block.
   */
  const handleDelayedTest = useCallback((): void => {
    if (testAlarmRef.current) testAlarmRef.current.cancel();

    const target = Date.now() + TEST_DELAY_SECONDS * 1000;
    setTestCountdown(TEST_DELAY_SECONDS);

    const countdown = window.setInterval(() => {
      const left = Math.ceil((target - Date.now()) / 1000);
      setTestCountdown(left > 0 ? left : null);
      if (left <= 0) window.clearInterval(countdown);
    }, 500);

    const handle = armAlarm(target, () => {
      window.clearInterval(countdown);
      setTestCountdown(null);
      testAlarmRef.current = null;
      sendOSNotification({
        title: 'Delivery test',
        body: `Fired ${TEST_DELAY_SECONDS}s after the button, with the window wherever you left it.`,
        requireInteraction: configRef.current.stickyNotifications,
        icon: href('/favicon.svg'),
        autoCloseMs: 20_000,
      });
      window.setTimeout(() => setDiagnostics(readNotificationDiagnostics()), 400);
    });

    testAlarmRef.current = {
      cancel: () => {
        handle.cancel();
        window.clearInterval(countdown);
        setTestCountdown(null);
      },
    };
  }, []);

  /* ── Keyboard shortcuts ────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === 'Space') {
        event.preventDefault();
        if (stateRef.current.status === 'running') handlePause();
        else handleStart();
      } else if (event.key.toLowerCase() === 'r') {
        handleReset();
      } else if (event.key.toLowerCase() === 's') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleStart, handlePause, handleReset, handleSkip]);

  /* ── Derived display values ────────────────────────────────────────── */

  const phaseColor =
    state.phase === 'work'
      ? 'var(--c-accent-fill)'
      : state.phase === 'short_break'
        ? 'var(--c-ok)'
        : 'var(--c-warn)';
  const phaseTone =
    state.phase === 'work' ? 'accent' : state.phase === 'short_break' ? 'ok' : 'warn';

  /** Highlighted purely by what the config says, so it survives a reload. */
  const selectedPreset = useMemo(
    () =>
      PRESETS.find(
        (preset) =>
          preset.workMinutes === config.workMinutes &&
          preset.shortBreakMinutes === config.shortBreakMinutes &&
          preset.longBreakMinutes === config.longBreakMinutes &&
          preset.cyclesBeforeLongBreak === config.cyclesBeforeLongBreak,
      )?.id ?? '',
    [
      config.workMinutes,
      config.shortBreakMinutes,
      config.longBreakMinutes,
      config.cyclesBeforeLongBreak,
    ],
  );

  const stats = useMemo(() => {
    const focusMins = Math.round(state.totalFocusMsToday / 60000);
    const breakMins = Math.round(state.totalBreakMsToday / 60000);
    const target = config.targetCycles > 0 ? String(config.targetCycles) : '∞';
    const alertsReady =
      notificationPerm === 'granted' && config.notificationsEnabled
        ? 'Ready'
        : notificationPerm === 'granted'
          ? 'Off'
          : notificationPerm;

    return [
      {
        label: 'Cycles done',
        value: `${state.completedCycles} / ${target}`,
        hint: `Long break every ${config.cyclesBeforeLongBreak}`,
        tone:
          config.targetCycles > 0 && state.completedCycles >= config.targetCycles
            ? ('ok' as const)
            : ('accent' as const),
      },
      {
        label: 'Focus today',
        value: `${focusMins}m`,
        hint: `${(focusMins / 60).toFixed(1)} h at the desk`,
      },
      {
        label: 'Rest today',
        value: `${breakMins}m`,
        hint: `${history.filter((entry) => entry.phase !== 'work').length} breaks logged`,
        tone: 'ok' as const,
      },
      {
        label: 'Alerts',
        value: alertsReady,
        hint:
          config.keepAwake && state.status === 'running'
            ? 'Silent carrier holding'
            : 'Carrier idle',
        tone: alertsReady === 'Ready' ? ('ok' as const) : ('warn' as const),
      },
    ];
  }, [
    state.completedCycles,
    state.status,
    state.totalFocusMsToday,
    state.totalBreakMsToday,
    config.targetCycles,
    config.cyclesBeforeLongBreak,
    config.notificationsEnabled,
    config.keepAwake,
    history,
    notificationPerm,
  ]);

  return (
    <div className="space-y-5">
      {pendingAlert && (
        <AlertBanner
          alert={pendingAlert}
          onAcknowledge={acknowledgeAlert}
          onStartNext={handleStart}
          running={state.status === 'running'}
        />
      )}

      {/* ── Preset rail ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--c-line)] bg-[var(--c-sunken)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1 text-[var(--c-text-muted)]">Cadence</span>
          {PRESETS.map((preset) => {
            const selected = selectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                title={preset.description}
                className={`rounded-[2px] px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  selected
                    ? 'bg-[var(--c-accent-fill)] font-bold text-[var(--c-accent-on-fill)] shadow-xs'
                    : 'border border-[var(--c-line)] bg-[var(--c-surface)] text-[var(--c-text-muted)] hover:border-[var(--c-accent-fill)] hover:text-[var(--c-text)]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {notificationPerm !== 'granted' && (
          <Button variant="primary" onClick={() => void handleRequestPermission()}>
            Enable OS alerts
          </Button>
        )}
      </div>

      {/* ── Clock ───────────────────────────────────────────────────── */}
      <Panel
        title="CLOCK"
        cornerTicks
        aside={
          <div className="flex items-center gap-2">
            <Badge tone={phaseTone}>{PHASE_LABEL[state.phase]}</Badge>
            <Badge tone={state.status === 'running' ? 'busy' : 'idle'}>
              {state.status === 'running'
                ? 'Running'
                : state.status === 'paused'
                  ? 'Paused'
                  : 'Standby'}
            </Badge>
          </div>
        }
      >
        <div className="relative overflow-hidden p-6 sm:p-9">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                'radial-gradient(circle at center, var(--c-accent-fill) 0, transparent 70%)',
            }}
          />

          <div className="relative mx-auto flex max-w-xl flex-col items-center justify-center">
            <LiveClock state={state} phaseColor={phaseColor} />

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {state.status === 'running' ? (
                <Button variant="primary" onClick={handlePause} title="Pause (Space)">
                  ❚❚ Pause
                </Button>
              ) : (
                <Button variant="primary" onClick={handleStart} title="Start (Space)">
                  ▶ Start {PHASE_LABEL[state.phase].toLowerCase()}
                </Button>
              )}
              <Button variant="ghost" onClick={handleReset} title="Reset this phase (R)">
                ↺ Reset
              </Button>
              <Button variant="ghost" onClick={handleSkip} title="Jump to the next phase (S)">
                ⏭ Skip
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 border-t border-[var(--c-line)] pt-4">
              <span className="eyebrow mr-1 text-[var(--c-text-faint)]">Adjust</span>
              <Button variant="quiet" onClick={() => handleAdjust(-5)}>
                −5m
              </Button>
              <Button variant="quiet" onClick={() => handleAdjust(-1)}>
                −1m
              </Button>
              <Button variant="quiet" onClick={() => handleAdjust(1)}>
                +1m
              </Button>
              <Button variant="quiet" onClick={() => handleAdjust(5)}>
                +5m
              </Button>
              <Button variant="quiet" onClick={() => handleAdjust(10)}>
                +10m
              </Button>
            </div>

            <p className="mt-4 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-[var(--c-text-faint)]">
              <Kbd>Space</Kbd> start or pause
              <span className="px-1">·</span>
              <Kbd>R</Kbd> reset
              <span className="px-1">·</span>
              <Kbd>S</Kbd> skip
            </p>
          </div>
        </div>

        <StatRow stats={stats} />
      </Panel>

      {/* ── Settings, directly below the clock ──────────────────────── */}
      <Panel
        title="SETTINGS"
        aside={
          <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
            Saved in this browser
          </span>
        }
      >
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <h4 className="eyebrow mb-3 text-[var(--c-accent)]">Intervals</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Focus (minutes)" htmlFor="cfg-work" hint="Decimals work: 1.1 is 66s">
                <NumberField
                  id="cfg-work"
                  value={config.workMinutes}
                  min={MIN_PHASE_MINUTES}
                  max={600}
                  step={0.1}
                  onChange={(value) => patchConfig({ workMinutes: value })}
                />
              </Field>
              <Field label="Short break (minutes)" htmlFor="cfg-short" hint="Down to 0.1">
                <NumberField
                  id="cfg-short"
                  value={config.shortBreakMinutes}
                  min={MIN_PHASE_MINUTES}
                  max={240}
                  step={0.1}
                  onChange={(value) => patchConfig({ shortBreakMinutes: value })}
                />
              </Field>
              <Field label="Long break (minutes)" htmlFor="cfg-long" hint="Down to 0.1">
                <NumberField
                  id="cfg-long"
                  value={config.longBreakMinutes}
                  min={MIN_PHASE_MINUTES}
                  max={240}
                  step={0.1}
                  onChange={(value) => patchConfig({ longBreakMinutes: value })}
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Focus blocks before a long break"
                htmlFor="cfg-cycle-interval"
                hint="Every nth break becomes the long one"
              >
                <NumberField
                  id="cfg-cycle-interval"
                  value={config.cyclesBeforeLongBreak}
                  min={1}
                  max={24}
                  onChange={(value) => patchConfig({ cyclesBeforeLongBreak: value })}
                />
              </Field>
              <Field
                label="Target blocks for the day"
                htmlFor="cfg-target-cycles"
                hint="0 runs without a target"
              >
                <NumberField
                  id="cfg-target-cycles"
                  value={config.targetCycles}
                  min={0}
                  max={48}
                  onChange={(value) => patchConfig({ targetCycles: value })}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <Toggle
                id="cfg-auto-brk"
                label="Start breaks automatically"
                checked={config.autoStartBreaks}
                onChange={(value) => patchConfig({ autoStartBreaks: value })}
              />
              <Toggle
                id="cfg-auto-wrk"
                label="Start the next focus block automatically"
                checked={config.autoStartWork}
                onChange={(value) => patchConfig({ autoStartWork: value })}
              />
            </div>
          </div>

          <div className="border-t border-[var(--c-line)] pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h4 className="eyebrow text-[var(--c-accent)]">Alerts</h4>
              <Badge tone={notificationPerm === 'granted' ? 'ok' : 'warn'}>
                Permission: {notificationPerm}
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Toggle
                  id="cfg-notif-en"
                  label="Send an OS notification"
                  checked={config.notificationsEnabled}
                  onChange={(value) => patchConfig({ notificationsEnabled: value })}
                />
                <Toggle
                  id="cfg-notif-sticky"
                  label="Keep the banner up until dismissed"
                  checked={config.stickyNotifications}
                  onChange={(value) => patchConfig({ stickyNotifications: value })}
                  title="Windows and some Linux desktops ignore this and auto-dismiss anyway"
                />
                <Toggle
                  id="cfg-flash"
                  label="Flash the tab title until acknowledged"
                  checked={config.flashTitle}
                  onChange={(value) => patchConfig({ flashTitle: value })}
                />
                <Toggle
                  id="cfg-hap-en"
                  label="Vibrate on mobile"
                  checked={config.hapticsEnabled}
                  onChange={(value) => patchConfig({ hapticsEnabled: value })}
                />
                <Toggle
                  id="cfg-keepawake"
                  label="Hold the silent carrier while running"
                  checked={config.keepAwake}
                  onChange={(value) => patchConfig({ keepAwake: value })}
                  title="An inaudible 30 Hz tone that marks the tab as playing audio, so the browser does not throttle the timer in the background. The tab shows a speaker icon."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Repeat alerts"
                  htmlFor="cfg-repeats"
                  hint="Extra nudges if you miss the first"
                >
                  <NumberField
                    id="cfg-repeats"
                    value={config.alertRepeats}
                    min={0}
                    max={10}
                    onChange={(value) => patchConfig({ alertRepeats: value })}
                  />
                </Field>
                <Field label="Repeat gap (seconds)" htmlFor="cfg-repeat-gap">
                  <NumberField
                    id="cfg-repeat-gap"
                    value={config.alertRepeatSeconds}
                    min={5}
                    max={600}
                    onChange={(value) => patchConfig({ alertRepeatSeconds: value })}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="End of focus title" htmlFor="cfg-notif-title">
                <TextField
                  id="cfg-notif-title"
                  value={config.workNotificationTitle}
                  onChange={(value) => patchConfig({ workNotificationTitle: value })}
                />
              </Field>
              <Field label="End of focus message" htmlFor="cfg-notif-body">
                <TextField
                  id="cfg-notif-body"
                  value={config.workNotificationBody}
                  onChange={(value) => patchConfig({ workNotificationBody: value })}
                />
              </Field>
              <Field label="End of break title" htmlFor="cfg-notif-btitle">
                <TextField
                  id="cfg-notif-btitle"
                  value={config.breakNotificationTitle}
                  onChange={(value) => patchConfig({ breakNotificationTitle: value })}
                />
              </Field>
              <Field label="End of break message" htmlFor="cfg-notif-bbody">
                <TextField
                  id="cfg-notif-bbody"
                  value={config.breakNotificationBody}
                  onChange={(value) => patchConfig({ breakNotificationBody: value })}
                />
              </Field>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Delivery check ──────────────────────────────────────────── */}
      <DeliveryCheck
        diagnostics={diagnostics}
        permission={notificationPerm}
        carrierState={backgroundCarrier.state}
        carrierOn={config.keepAwake && state.status === 'running'}
        testCountdown={testCountdown}
        onRequestPermission={() => void handleRequestPermission()}
        onSendNow={() => fireAlert(state.phase === 'work' ? 'work' : 'short_break', config)}
        onDelayedTest={handleDelayedTest}
        onCancelTest={() => testAlarmRef.current?.cancel()}
      />

      {/* ── Break guidance ──────────────────────────────────────────── */}
      <Collapsible title="BREAK GUIDE" defaultOpen={false}>
        <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-2">
          <div className="flex flex-col items-center justify-center rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-4">
            <h4 className="eyebrow mb-2 text-[var(--c-accent)]">Box breathing · 4-4-4-4</h4>
            <BoxBreathingPacer />
          </div>

          <div className="space-y-4">
            <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-4">
              <h4 className="eyebrow mb-2 text-[var(--c-accent)]">The 20-20-20 rule</h4>
              <p className="text-xs leading-relaxed text-[var(--c-text-muted)]">
                Every <strong>20 minutes</strong>, look at something at least{' '}
                <strong>20 feet</strong> away for <strong>20 seconds</strong>. That is long enough
                for the ciliary muscles to let go of the focal distance they have been holding.
              </p>
            </div>

            <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-4">
              <h4 className="eyebrow mb-2 text-[var(--c-accent)]">While you are up</h4>
              <ul className="grid gap-2 font-mono text-[12px] text-[var(--c-text)]">
                <li className="flex items-center gap-2">
                  <span className="text-[var(--c-ok)]">·</span> Neck rolls, five each way
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[var(--c-ok)]">·</span> Shoulder shrugs to unload the traps
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[var(--c-ok)]">·</span> 150-200 ml of water
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[var(--c-ok)]">·</span> Wrist extensions, shake out the
                  forearms
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Collapsible>

      {/* ── Session log ─────────────────────────────────────────────── */}
      <Collapsible
        title="SESSION LOG"
        defaultOpen={false}
        aside={
          <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
            {history.length} completed
          </span>
        }
      >
        <div className="p-4">
          <OutputBox
            title="Completed phases"
            filename="rest-reminder-history.json"
            mime="application/json"
            empty="Nothing logged yet. Every phase that runs to its deadline lands here."
            text={
              history.length > 0
                ? JSON.stringify(
                    history.map((entry) => ({
                      phase: entry.phase,
                      durationMinutes: entry.durationMinutes,
                      started: new Date(entry.startedAt).toLocaleTimeString(),
                      completed: new Date(entry.completedAt).toLocaleTimeString(),
                    })),
                    null,
                    2,
                  )
                : ''
            }
            aside={
              history.length > 0 ? (
                <Button variant="quiet" onClick={() => setHistory([])}>
                  Clear
                </Button>
              ) : undefined
            }
          />
        </div>
      </Collapsible>
    </div>
  );
}
