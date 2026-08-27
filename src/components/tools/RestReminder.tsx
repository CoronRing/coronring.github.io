/**
 * Rest Reminder — Tactical HUD Clock & Cross-Platform Recovery Cadence.
 *
 * References the Endfield interior HUD design language in `.agent_temp/reference`:
 * - Concentric rotating dials and 60-tick radial progress gauges with hazard-yellow fills
 * - Diagonal heavy bezel brackets, coordinate ticks, and telemetry readout rails
 * - Sweep scanline needle and ambient micro-particle constellation in canvas
 * - Procedural Web Audio alerts and cross-platform OS notifications
 * - Interactive box-breathing pacer for restorative eye and posture breaks
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  PRESETS,
  adjustTimerDuration,
  computeNextPhase,
  createInitialState,
  formatMinutesDisplay,
  formatTimeParts,
  getNotificationPermission,
  minutesToMs,
  pauseTimerState,
  requestNotificationPermission,
  resetTimerState,
  sendOSNotification,
  soundSynth,
  startTimerState,
  switchPhaseState,
  triggerHapticFeedback,
  type NotificationPermissionState,
  type PresetProfile,
  type SessionLogEntry,
  type SoundType,
  type TimerConfig,
  type TimerPhase,
  type TimerState,
} from '../../lib/rest-timer';
import {
  Badge,
  Button,
  Field,
  NumberField,
  OutputBox,
  Panel,
  Select,
  Slider,
  StatRow,
  Tabs,
  Toggle,
  usePersisted,
} from './ui';

/* ── Sound Options ───────────────────────────────────────────────────── */

const SOUND_OPTIONS: ReadonlyArray<{ value: SoundType; label: string }> = [
  { value: 'aurora_chime', label: '✦ Aurora Chime (Harmonic)' },
  { value: 'tactical_ping', label: '◈ Tactical Ping (Dual-Chirp)' },
  { value: 'digital_beep', label: '▲ Digital Radar Beep' },
  { value: 'zen_gong', label: '◉ Zen Singing Bowl' },
];

/* ── Breathing Phase for Break Pacer ─────────────────────────────────── */

type BreathStep = 'inhale' | 'hold1' | 'exhale' | 'hold2';

export default function RestReminder(): React.ReactElement {
  /* ── Persisted Config & History ────────────────────────────────────── */
  const [config, setConfig] = usePersisted<TimerConfig>('rest-reminder.config', DEFAULT_CONFIG);
  const [history, setHistory] = usePersisted<SessionLogEntry[]>('rest-reminder.history', []);
  const [selectedPreset, setSelectedPreset] = useState<string>('pomodoro_25');
  const [activeTab, setActiveTab] = useState<'timer' | 'pacer' | 'settings' | 'history'>('timer');

  /* ── Timer Runtime State ───────────────────────────────────────────── */
  const [state, setState] = useState<TimerState>(() => createInitialState(config));
  const [displayRemainingMs, setDisplayRemainingMs] = useState<number>(state.remainingMs);
  const [notificationPerm, setNotificationPerm] = useState<NotificationPermissionState>('default');

  const animationFrameRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  // Check notification permission on mount
  useEffect(() => {
    setNotificationPerm(getNotificationPermission());
  }, []);

  /* ── High-Precision Drift-Free Animation Loop ──────────────────────── */
  useEffect(() => {
    if (state.status !== 'running' || state.targetEndTime === null) {
      setDisplayRemainingMs(state.remainingMs);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const loop = (): void => {
      const now = Date.now();
      const diff = state.targetEndTime! - now;

      if (diff <= 0) {
        // Phase naturally completed!
        handlePhaseCompletion();
        return;
      }

      setDisplayRemainingMs(diff);
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [state.status, state.targetEndTime]);

  /* ── Update Document Title with Live Time & Phase ──────────────────── */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const parts = formatTimeParts(displayRemainingMs);
    const phaseLabel =
      state.phase === 'work' ? 'FOCUS' : state.phase === 'short_break' ? 'REST' : 'LONG BREAK';

    if (state.status === 'running') {
      document.title = `[${parts.minutes}:${parts.seconds}] ${phaseLabel} // Rest Reminder`;
    } else if (state.status === 'paused') {
      document.title = `[PAUSED ${parts.minutes}:${parts.seconds}] Rest Reminder`;
    } else {
      document.title = 'Rest Reminder · Tactical HUD Clock';
    }

    return () => {
      document.title = 'Rest Reminder · Tactical HUD Clock';
    };
  }, [displayRemainingMs, state.phase, state.status]);

  /* ── Phase Completion Handler ──────────────────────────────────────── */
  const handlePhaseCompletion = useCallback(() => {
    const prevPhase = state.phase;
    const now = Date.now();
    const durationMins = Math.round(state.durationMs / (60 * 1000));

    // 1. Record session log entry
    const newEntry: SessionLogEntry = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      phase: prevPhase,
      startedAt: sessionStartRef.current,
      completedAt: now,
      durationMinutes: durationMins,
      completedNaturally: true,
    };
    setHistory([newEntry, ...history.slice(0, 99)]);

    // 2. Compute next phase and cycles
    const { nextPhase, nextCycleCount } = computeNextPhase(
      prevPhase,
      state.completedCycles,
      config,
    );

    // 3. Audio & Haptics & Notification Cues
    if (prevPhase === 'work') {
      if (config.soundEnabled) soundSynth.play(config.workCompleteSound, config.soundVolume);
      if (config.hapticsEnabled) triggerHapticFeedback([200, 100, 200, 100, 400]);
      if (config.notificationsEnabled) {
        sendOSNotification({
          title: config.workNotificationTitle,
          body: config.workNotificationBody,
        });
      }
    } else {
      if (config.soundEnabled) soundSynth.play(config.breakCompleteSound, config.soundVolume);
      if (config.hapticsEnabled) triggerHapticFeedback([150, 80, 150]);
      if (config.notificationsEnabled) {
        sendOSNotification({
          title: config.breakNotificationTitle,
          body: config.breakNotificationBody,
        });
      }
    }

    // 4. Update state to next phase
    const shouldAutoStart =
      prevPhase === 'work' ? config.autoStartBreaks : config.autoStartWork;

    setState((prev) => {
      const nextDuration =
        nextPhase === 'work'
          ? minutesToMs(config.workMinutes)
          : nextPhase === 'short_break'
            ? minutesToMs(config.shortBreakMinutes)
            : minutesToMs(config.longBreakMinutes);

      sessionStartRef.current = now;
      return {
        ...prev,
        status: shouldAutoStart ? 'running' : 'idle',
        phase: nextPhase,
        completedCycles: nextCycleCount,
        durationMs: nextDuration,
        remainingMs: nextDuration,
        targetEndTime: shouldAutoStart ? now + nextDuration : null,
        totalFocusMsToday:
          prevPhase === 'work' ? prev.totalFocusMsToday + prev.durationMs : prev.totalFocusMsToday,
        totalBreakMsToday:
          prevPhase !== 'work' ? prev.totalBreakMsToday + prev.durationMs : prev.totalBreakMsToday,
      };
    });
  }, [config, setHistory, state.completedCycles, state.durationMs, state.phase]);

  /* ── Interactive Timer Actions ─────────────────────────────────────── */
  const handleStart = (): void => {
    sessionStartRef.current = Date.now();
    setState((prev) => startTimerState(prev));
  };

  const handlePause = (): void => {
    setState((prev) => pauseTimerState(prev));
  };

  const handleReset = (): void => {
    setState((prev) => resetTimerState(prev, config));
    setDisplayRemainingMs(
      state.phase === 'work'
        ? minutesToMs(config.workMinutes)
        : state.phase === 'short_break'
          ? minutesToMs(config.shortBreakMinutes)
          : minutesToMs(config.longBreakMinutes),
    );
  };

  const handleSkip = (): void => {
    const { nextPhase, nextCycleCount } = computeNextPhase(
      state.phase,
      state.completedCycles,
      config,
    );
    sessionStartRef.current = Date.now();
    setState((prev) =>
      switchPhaseState(
        { ...prev, completedCycles: nextCycleCount },
        nextPhase,
        config,
        state.status === 'running',
      ),
    );
  };

  const handleAdjust = (deltaMinutes: number): void => {
    setState((prev) => adjustTimerDuration(prev, deltaMinutes));
  };

  const handleSelectPreset = (preset: PresetProfile): void => {
    setSelectedPreset(preset.id);
    const newConfig: TimerConfig = {
      ...config,
      workMinutes: preset.workMinutes,
      shortBreakMinutes: preset.shortBreakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
      cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
      targetCycles: preset.targetCycles,
    };
    setConfig(newConfig);
    setState(createInitialState(newConfig));
    setDisplayRemainingMs(minutesToMs(preset.workMinutes));
  };

  const handleRequestPermission = async (): Promise<void> => {
    const perm = await requestNotificationPermission();
    setNotificationPerm(perm);
    if (perm === 'granted') {
      sendOSNotification({
        title: 'TACTICAL NOTIFICATIONS // ARMED',
        body: 'Cross-platform rest reminder notifications are active and verified.',
      });
    }
  };

  /* ── Calculations for Display ──────────────────────────────────────── */
  const timeParts = formatTimeParts(displayRemainingMs);
  const elapsedMs = Math.max(0, state.durationMs - displayRemainingMs);
  const progressRatio = Math.min(1, Math.max(0, elapsedMs / (state.durationMs || 1)));
  const progressPercent = Math.round(progressRatio * 100);

  const phaseColor =
    state.phase === 'work'
      ? 'var(--c-accent-fill)'
      : state.phase === 'short_break'
        ? 'var(--c-ok)'
        : 'var(--c-warn)';

  const phaseTone = state.phase === 'work' ? 'accent' : state.phase === 'short_break' ? 'ok' : 'warn';

  const stats = useMemo(() => {
    const focusMins = Math.round(state.totalFocusMsToday / (60 * 1000));
    const breakMins = Math.round(state.totalBreakMsToday / (60 * 1000));
    const target = config.targetCycles > 0 ? config.targetCycles : '∞';
    const cycleTone: 'ok' | 'accent' =
      state.completedCycles >= config.targetCycles && config.targetCycles > 0 ? 'ok' : 'accent';
    const notifTone: 'ok' | 'warn' = notificationPerm === 'granted' ? 'ok' : 'warn';

    return [
      {
        label: 'Cycle Progress',
        value: `${state.completedCycles} / ${target}`,
        hint: `Long break every ${config.cyclesBeforeLongBreak} cycles`,
        tone: cycleTone,
      },
      {
        label: 'Focus Time Today',
        value: `${focusMins}m`,
        hint: `${(focusMins / 60).toFixed(1)} hours active flow`,
      },
      {
        label: 'Rest Time Taken',
        value: `${breakMins}m`,
        hint: `${history.filter((h) => h.phase !== 'work').length} break sessions`,
        tone: 'ok' as const,
      },
      {
        label: 'OS Alert Channel',
        value: notificationPerm === 'granted' ? 'ARMED' : notificationPerm.toUpperCase(),
        hint: notificationPerm === 'granted' ? 'Native Push active' : 'Click to authorize',
        tone: notifTone,
      },
    ];
  }, [
    state.completedCycles,
    config.targetCycles,
    config.cyclesBeforeLongBreak,
    state.totalFocusMsToday,
    state.totalBreakMsToday,
    history,
    notificationPerm,
  ]);

  return (
    <div className="space-y-6">
      {/* ── Top Workspace Mode Tabs ───────────────────────────────────── */}
      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'timer', label: 'Tactical Clock' },
          { id: 'pacer', label: '20-20-20 & Breath Pacer' },
          { id: 'settings', label: 'Cadence Settings' },
          {
            id: 'history',
            label: 'Session Logs',
            badge: history.length > 0 ? history.length : undefined,
          },
        ]}
      />

      {/* ── Preset Selector Bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--c-line)] bg-[var(--c-sunken)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1 text-[var(--c-text-muted)]">Presets:</span>
          {PRESETS.map((preset) => {
            const isSelected = selectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                title={preset.description}
                className={`rounded-[2px] px-2.5 py-1 font-mono text-[11px] font-medium transition-all ${
                  isSelected
                    ? 'bg-[var(--c-accent-fill)] font-bold text-[var(--c-accent-on-fill)] shadow-xs'
                    : 'border border-[var(--c-line)] bg-[var(--c-surface)] text-[var(--c-text-muted)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {notificationPerm !== 'granted' && (
            <Button
              variant="primary"
              onClick={handleRequestPermission}
              title="Enable OS system notifications for rest alerts"
            >
              🔔 Enable OS Alerts
            </Button>
          )}
        </div>
      </div>

      {/* ── TAB 1: Tactical HUD Clock ─────────────────────────────────── */}
      {activeTab === 'timer' && (
        <div className="space-y-6">
          <Panel
            title="SYS.CLK // REST_CADENCE_ORBIT"
            cornerTicks
            aside={
              <div className="flex items-center gap-2">
                <Badge tone={phaseTone}>
                  {state.phase === 'work'
                    ? '✦ FOCUS SESSION'
                    : state.phase === 'short_break'
                      ? '☕ SHORT REST'
                      : '◈ RECOVERY ORBIT'}
                </Badge>
                <Badge tone={state.status === 'running' ? 'busy' : 'idle'}>
                  {state.status === 'running'
                    ? 'ARMED · TICKING'
                    : state.status === 'paused'
                      ? 'PAUSED'
                      : 'STANDBY'}
                </Badge>
              </div>
            }
          >
            <div className="relative overflow-hidden p-6 sm:p-10">
              {/* Tactical background grid & sector markings */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-15"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at center, var(--c-accent-fill) 0, transparent 70%)',
                }}
              />

              <div className="relative mx-auto flex max-w-xl flex-col items-center justify-center">
                {/* ── Main Concentric HUD Dial ──────────────────────── */}
                <TacticalClockDial
                  remainingMs={displayRemainingMs}
                  progressRatio={progressRatio}
                  phase={state.phase}
                  status={state.status}
                  phaseColor={phaseColor}
                  timeParts={timeParts}
                />

                {/* ── Primary Action Controls ───────────────────────── */}
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  {state.status === 'running' ? (
                    <Button
                      variant="primary"
                      onClick={handlePause}
                      title="Pause countdown (Space)"
                    >
                      <span className="text-sm">❚❚</span> PAUSE TIMER
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={handleStart}
                      title="Start recovery timer (Space)"
                    >
                      <span className="text-sm">▶</span> START {state.phase.toUpperCase()}
                    </Button>
                  )}

                  <Button variant="ghost" onClick={handleReset} title="Reset current phase">
                    ↺ RESET
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={handleSkip}
                    title="Skip to next work or break phase"
                  >
                    ⏭ SKIP PHASE
                  </Button>
                </div>

                {/* ── Quick Duration Adjustments (+1m, +5m, -1m, +10m) ─ */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 border-t border-[var(--c-line)] pt-4">
                  <span className="eyebrow mr-1 text-[var(--c-text-faint)]">Quick Adjust:</span>
                  <Button variant="quiet" onClick={() => handleAdjust(-1)}>
                    -1m
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

                {/* Tactical Telemetry Readout Footnote */}
                <div className="mt-6 flex w-full flex-wrap items-center justify-between border-t border-[var(--c-line)] pt-3 font-mono text-[11px] text-[var(--c-text-faint)]">
                  <span>
                    LAT 38.2° // SEC.{state.phase === 'work' ? '01' : '02'}
                  </span>
                  <span>
                    COMPLETION: <strong className="text-[var(--c-text)]">{progressPercent}%</strong>
                  </span>
                  <span>
                    TARGET: {formatMinutesDisplay(state.durationMs / 60000)}
                  </span>
                </div>
              </div>
            </div>

            <StatRow stats={stats} />
          </Panel>

          {/* ── Ergonomic Guidance Banner ─────────────────────────────── */}
          <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="eyebrow text-[var(--c-accent)]">Ergonomic Protocol</h4>
                <p className="mt-1 text-xs text-[var(--c-text-muted)]">
                  {state.phase === 'work'
                    ? 'Maintain upright posture, 50-70cm screen distance, and natural blink frequency.'
                    : 'Rest active: Shift gaze 20+ feet away, hydrate, and release neck tension.'}
                </p>
              </div>
              <Button onClick={() => setActiveTab('pacer')} variant="ghost">
                ✦ Launch Eye & Breath Pacer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: 20-20-20 & Breath Pacer ────────────────────────────── */}
      {activeTab === 'pacer' && (
        <Panel title="Ergonomic Recovery // 20-20-20 & Tactical Box Breathing" cornerTicks>
          <div className="p-6 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Box Breathing Guided Animation Canvas */}
              <div className="flex flex-col items-center justify-center rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-6">
                <h4 className="eyebrow text-[var(--c-accent)] mb-4">Tactical Box Breathing Pacer (4-4-4-4)</h4>
                <BoxBreathingPacer />
              </div>

              {/* 20-20-20 Rule Interactive Checklist */}
              <div className="space-y-4">
                <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-5">
                  <h4 className="eyebrow text-[var(--c-accent)] mb-2">01 · The 20-20-20 Rule</h4>
                  <p className="text-xs leading-relaxed text-[var(--c-text-muted)]">
                    Every <strong>20 minutes</strong>, focus your eyes on an object at least{' '}
                    <strong>20 feet (6 meters) away</strong> for a full <strong>20 seconds</strong>.
                    This completely relaxes the ciliary eye muscles that stay locked during monitor work.
                  </p>
                </div>

                <div className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-5">
                  <h4 className="eyebrow text-[var(--c-accent)] mb-2">02 · Micro-Movement Checklist</h4>
                  <ul className="grid gap-2.5 font-mono text-[12px] text-[var(--c-text)]">
                    <li className="flex items-center gap-2">
                      <span className="text-[var(--c-ok)]">✓</span> Neck Rolls: 5 clockwise, 5 counter-clockwise
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[var(--c-ok)]">✓</span> Shoulder Shrugs: Release trapezius tension
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[var(--c-ok)]">✓</span> Hydration: Drink 150-200ml water
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[var(--c-ok)]">✓</span> Wrist Extensions: Flex and shake out forearm muscles
                    </li>
                  </ul>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button variant="primary" onClick={() => soundSynth.play('zen_gong', config.soundVolume)}>
                    ◉ Sound Rest Gong
                  </Button>
                  <Button variant="ghost" onClick={() => setActiveTab('timer')}>
                    Return to Clock Dial
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── TAB 3: Settings ───────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <Panel title="Cadence Configuration" cornerTicks>
          <div className="space-y-6 p-6">
            {/* Timing Durations */}
            <div>
              <h4 className="eyebrow text-[var(--c-accent)] mb-3">Time Parameters</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Work Duration (Minutes)" htmlFor="cfg-work">
                  <NumberField
                    id="cfg-work"
                    value={config.workMinutes}
                    min={1}
                    max={180}
                    onChange={(val) => {
                      const next = { ...config, workMinutes: Math.max(1, Math.round(val)) };
                      setConfig(next);
                      if (state.phase === 'work' && state.status === 'idle') {
                        setState(createInitialState(next));
                      }
                    }}
                  />
                </Field>

                <Field label="Short Break (Minutes)" htmlFor="cfg-short">
                  <NumberField
                    id="cfg-short"
                    value={config.shortBreakMinutes}
                    min={1}
                    max={60}
                    onChange={(val) =>
                      setConfig({ ...config, shortBreakMinutes: Math.max(1, Math.round(val)) })
                    }
                  />
                </Field>

                <Field label="Long Break (Minutes)" htmlFor="cfg-long">
                  <NumberField
                    id="cfg-long"
                    value={config.longBreakMinutes}
                    min={1}
                    max={90}
                    onChange={(val) =>
                      setConfig({ ...config, longBreakMinutes: Math.max(1, Math.round(val)) })
                    }
                  />
                </Field>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Cycles Before Long Break"
                  htmlFor="cfg-cycle-interval"
                  hint="Number of work blocks before a long recovery break (e.g. 4)"
                >
                  <NumberField
                    id="cfg-cycle-interval"
                    value={config.cyclesBeforeLongBreak}
                    min={1}
                    max={12}
                    onChange={(val) =>
                      setConfig({
                        ...config,
                        cyclesBeforeLongBreak: Math.max(1, Math.round(val)),
                      })
                    }
                  />
                </Field>

                <Field
                  label="Target Total Cycles"
                  htmlFor="cfg-target-cycles"
                  hint="Set to 0 for infinite / continuous mode"
                >
                  <NumberField
                    id="cfg-target-cycles"
                    value={config.targetCycles}
                    min={0}
                    max={24}
                    onChange={(val) =>
                      setConfig({ ...config, targetCycles: Math.max(0, Math.round(val)) })
                    }
                  />
                </Field>
              </div>
            </div>

            {/* Audio Synthesis Settings */}
            <div className="border-t border-[var(--c-line)] pt-5">
              <h4 className="eyebrow text-[var(--c-accent)] mb-3">Procedural Web Audio Synth</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Work Complete Sound" htmlFor="cfg-snd-work">
                  <Select
                    id="cfg-snd-work"
                    value={config.workCompleteSound}
                    options={SOUND_OPTIONS}
                    onChange={(val) => setConfig({ ...config, workCompleteSound: val as SoundType })}
                  />
                </Field>

                <Field label="Break Complete Sound" htmlFor="cfg-snd-break">
                  <Select
                    id="cfg-snd-break"
                    value={config.breakCompleteSound}
                    options={SOUND_OPTIONS}
                    onChange={(val) =>
                      setConfig({ ...config, breakCompleteSound: val as SoundType })
                    }
                  />
                </Field>

                <div className="flex flex-col justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => soundSynth.play(config.workCompleteSound, config.soundVolume)}
                  >
                    🔊 Test Work Sound
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Slider
                  id="cfg-vol"
                  label="Master Volume"
                  value={Math.round(config.soundVolume * 100)}
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(val) => setConfig({ ...config, soundVolume: val / 100 })}
                />

                <div className="flex items-center gap-6 pt-5">
                  <Toggle
                    id="cfg-snd-en"
                    label="Enable Audio Chimes"
                    checked={config.soundEnabled}
                    onChange={(val) => setConfig({ ...config, soundEnabled: val })}
                  />
                  <Toggle
                    id="cfg-hap-en"
                    label="Mobile Haptics"
                    checked={config.hapticsEnabled}
                    onChange={(val) => setConfig({ ...config, hapticsEnabled: val })}
                  />
                </div>
              </div>
            </div>

            {/* OS Notification Settings */}
            <div className="border-t border-[var(--c-line)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h4 className="eyebrow text-[var(--c-accent)]">Cross-Platform OS Notifications</h4>
                <Badge tone={notificationPerm === 'granted' ? 'ok' : 'warn'}>
                  Status: {notificationPerm.toUpperCase()}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Toggle
                  id="cfg-notif-en"
                  label="Send OS System Notifications"
                  checked={config.notificationsEnabled}
                  onChange={(val) => setConfig({ ...config, notificationsEnabled: val })}
                />
                <Button variant="ghost" onClick={handleRequestPermission}>
                  🔔 Request / Test OS Permission
                </Button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Work Complete Notification Title" htmlFor="cfg-notif-title">
                  <input
                    id="cfg-notif-title"
                    type="text"
                    value={config.workNotificationTitle}
                    onChange={(e) => setConfig({ ...config, workNotificationTitle: e.target.value })}
                    className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                  />
                </Field>
                <Field label="Work Complete Notification Message" htmlFor="cfg-notif-body">
                  <input
                    id="cfg-notif-body"
                    type="text"
                    value={config.workNotificationBody}
                    onChange={(e) => setConfig({ ...config, workNotificationBody: e.target.value })}
                    className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                  />
                </Field>
              </div>
            </div>

            {/* Automation Toggles */}
            <div className="border-t border-[var(--c-line)] pt-5">
              <h4 className="eyebrow text-[var(--c-accent)] mb-3">Flow Automation</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <Toggle
                  id="cfg-auto-brk"
                  label="Auto-start Breaks (No manual click required)"
                  checked={config.autoStartBreaks}
                  onChange={(val) => setConfig({ ...config, autoStartBreaks: val })}
                />
                <Toggle
                  id="cfg-auto-wrk"
                  label="Auto-start Work Session after Break"
                  checked={config.autoStartWork}
                  onChange={(val) => setConfig({ ...config, autoStartWork: val })}
                />
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── TAB 4: Session History & Telemetry ─────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <OutputBox
            title="Completed Session History"
            filename="rest-reminder-history.json"
            mime="application/json"
            empty="No completed sessions yet today. Start the clock to begin recording cadence telemetry."
            text={
              history.length > 0
                ? JSON.stringify(
                    history.map((h) => ({
                      phase: h.phase,
                      durationMinutes: h.durationMinutes,
                      started: new Date(h.startedAt).toLocaleTimeString(),
                      completed: new Date(h.completedAt).toLocaleTimeString(),
                      naturalCompletion: h.completedNaturally,
                    })),
                    null,
                    2,
                  )
                : ''
            }
            aside={
              history.length > 0 ? (
                <Button variant="quiet" onClick={() => setHistory([])}>
                  Clear History
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * TacticalClockDial — Canvas and SVG Composite Dial
 * Inspired by Endfield HUD reference: Concentric rings, radial 60-ticks,
 * sweep scanline needle, particle dust field, and Archivo display typography.
 * ─────────────────────────────────────────────────────────────────────── */

interface TacticalClockDialProps {
  remainingMs: number;
  progressRatio: number;
  phase: TimerPhase;
  status: string;
  phaseColor: string;
  timeParts: {
    minutes: string;
    seconds: string;
    hundredths: string;
    totalSeconds: number;
  };
}

function TacticalClockDial({
  remainingMs,
  progressRatio,
  phase,
  status,
  phaseColor,
  timeParts,
}: TacticalClockDialProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /* Ambient Canvas Micro-Particle Constellation Effect */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const count = 38;
    const particles = Array.from({ length: count }, (_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 65 + (i % 5) * 16,
      speed: (0.002 + (i % 3) * 0.001) * (i % 2 === 0 ? 1 : -1),
      size: 1.2 + (i % 4) * 0.5,
      alpha: 0.2 + (i % 5) * 0.15,
    }));

    const render = (): void => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // Draw subtle orbital guide tracks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 75, 0, Math.PI * 2);
      ctx.arc(cx, cy, 115, 0, Math.PI * 2);
      ctx.stroke();

      // Render drifting particles
      particles.forEach((p) => {
        p.angle += p.speed * (status === 'running' ? 1.5 : 0.6);
        const px = cx + Math.cos(p.angle) * p.radius;
        const py = cy + Math.sin(p.angle) * p.radius;

        ctx.fillStyle = `rgba(255, 250, 0, ${p.alpha * (phase === 'work' ? 0.9 : 0.4)})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [phase, status]);

  // Circumference for outer progress circle: Radius = 135
  const radius = 135;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressRatio);

  // Angle for the sweeping needle
  const needleAngle = progressRatio * 360 - 90;

  // Generate 60 radial ticks around 360 degrees
  const ticks = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const tickAngle = (i / 60) * 360;
      const isMajor = i % 5 === 0;
      const isQuarter = i % 15 === 0;
      const tickProgress = i / 60;
      const isActive = tickProgress <= progressRatio;
      return {
        index: i,
        angle: tickAngle,
        isMajor,
        isQuarter,
        isActive,
      };
    });
  }, [progressRatio]);

  return (
    <div className="relative flex size-72 items-center justify-center sm:size-84">
      {/* ── Background Particle Canvas ──────────────────────────────── */}
      <canvas
        ref={canvasRef}
        width={340}
        height={340}
        className="pointer-events-none absolute inset-0 size-full"
      />

      {/* ── Concentric SVG Dial Gauge ────────────────────────────────── */}
      <svg
        viewBox="0 0 340 340"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      >
        {/* Outer tactical bezel quadrant brackets */}
        <g stroke="var(--c-line-strong)" strokeWidth="1.5" fill="none" opacity="0.65">
          {/* 45 deg bracket */}
          <path d="M 245 45 L 265 45 L 265 65" />
          {/* 135 deg bracket */}
          <path d="M 265 275 L 265 295 L 245 295" />
          {/* 225 deg bracket */}
          <path d="M 95 295 L 75 295 L 75 275" />
          {/* 315 deg bracket */}
          <path d="M 75 65 L 75 45 L 95 45" />
        </g>

        {/* Outer Static Track */}
        <circle
          cx="170"
          cy="170"
          r={radius}
          fill="none"
          stroke="var(--c-line)"
          strokeWidth="3"
          opacity="0.4"
        />

        {/* Outer Segmented Progress Track */}
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
          className="transition-all duration-150"
        />

        {/* 60 Radial Ticks Gauge */}
        <g transform="translate(170, 170)">
          {ticks.map((t) => {
            const rad = (t.angle - 90) * (Math.PI / 180);
            const innerR = t.isQuarter ? 144 : t.isMajor ? 147 : 150;
            const outerR = 155;
            const x1 = Math.cos(rad) * innerR;
            const y1 = Math.sin(rad) * innerR;
            const x2 = Math.cos(rad) * outerR;
            const y2 = Math.sin(rad) * outerR;

            return (
              <line
                key={t.index}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={
                  t.isActive
                    ? phaseColor
                    : t.isQuarter
                      ? 'var(--c-text-faint)'
                      : 'var(--c-line)'
                }
                strokeWidth={t.isQuarter ? 2 : t.isMajor ? 1.5 : 1}
                opacity={t.isActive ? 0.95 : 0.4}
              />
            );
          })}

          {/* Sweeping Radar Needle Line */}
          {status === 'running' && (
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

      {/* ── Central Time Display & Telemetry Readout ─────────────────── */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center select-none">
        {/* Eyebrow Status Marker */}
        <span className="eyebrow mb-1 tracking-widest text-[var(--c-text-faint)]">
          {phase === 'work' ? 'FOCUS_INTERVAL' : 'RECOVERY_INTERVAL'}
        </span>

        {/* Primary Giant Time Digits */}
        <div className="display flex items-baseline font-mono text-4xl tracking-tight sm:text-5xl">
          <span className="text-[var(--c-text)]">{timeParts.minutes}</span>
          <span className="animate-pulse px-1 text-[var(--c-accent)]">:</span>
          <span className="text-[var(--c-text)]">{timeParts.seconds}</span>
          <span className="ml-1 text-sm font-normal text-[var(--c-text-faint)]">
            .{timeParts.hundredths}
          </span>
        </div>

        {/* Dynamic Micro-Progress Meter */}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-[var(--c-text-faint)]">
            {formatMinutesDisplay(remainingMs / 60000)} LEFT
          </span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-[var(--c-sunken)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressRatio * 100}%`,
                backgroundColor: phaseColor,
              }}
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
 * BoxBreathingPacer — 4-4-4-4 Tactical Breathing Guide Component
 * Inhale 4s -> Hold 4s -> Exhale 4s -> Hold 4s
 * ─────────────────────────────────────────────────────────────────────── */

function BoxBreathingPacer(): React.ReactElement {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let anim: number;
    let start = Date.now();

    const loop = (): void => {
      const now = Date.now();
      setElapsed((now - start) / 1000);
      anim = requestAnimationFrame(loop);
    };

    anim = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(anim);
  }, []);

  // 16-second total cycle (4s per stage)
  const cycleSeconds = 16;
  const currentMod = elapsed % cycleSeconds;

  let step: BreathStep = 'inhale';
  let stepProgress = 0;
  let label = 'INHALE';
  let sublabel = 'Deep breath through nose';
  let scale = 1;

  if (currentMod < 4) {
    step = 'inhale';
    stepProgress = currentMod / 4;
    label = 'INHALE';
    sublabel = 'Breathe in slowly (4s)';
    scale = 1.0 + stepProgress * 0.45; // 1.0 -> 1.45
  } else if (currentMod < 8) {
    step = 'hold1';
    stepProgress = (currentMod - 4) / 4;
    label = 'HOLD';
    sublabel = 'Hold breath calmly (4s)';
    scale = 1.45;
  } else if (currentMod < 12) {
    step = 'exhale';
    stepProgress = (currentMod - 8) / 4;
    label = 'EXHALE';
    sublabel = 'Release through mouth (4s)';
    scale = 1.45 - stepProgress * 0.45; // 1.45 -> 1.0
  } else {
    step = 'hold2';
    stepProgress = (currentMod - 12) / 4;
    label = 'HOLD';
    sublabel = 'Rest empty lungs (4s)';
    scale = 1.0;
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      {/* Animated Expanding/Contracting Breathing Ring */}
      <div className="relative flex size-52 items-center justify-center">
        {/* Glow halo */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${scale * 1.1})`,
            backgroundColor:
              step === 'inhale' || step === 'hold1'
                ? 'rgba(255, 250, 0, 0.08)'
                : 'rgba(74, 222, 128, 0.08)',
          }}
        />

        {/* Main pulsing circle */}
        <div
          className="relative z-10 flex size-36 flex-col items-center justify-center rounded-full border-2 border-[var(--c-accent)] bg-[var(--c-surface)] shadow-lg transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${scale})`,
            borderColor:
              step === 'inhale' || step === 'hold1' ? 'var(--c-accent)' : 'var(--c-ok)',
          }}
        >
          <span className="font-mono text-base font-bold tracking-wider text-[var(--c-text)]">
            {label}
          </span>
          <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
            {Math.ceil(4 - (stepProgress * 4))}s
          </span>
        </div>
      </div>

      <p className="mt-4 font-mono text-xs text-[var(--c-text-muted)]">{sublabel}</p>
    </div>
  );
}
