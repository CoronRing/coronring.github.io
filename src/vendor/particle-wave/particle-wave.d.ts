/**
 * Type declarations for the vendored SenseRing `particle_wave` frontend.
 *
 * The upstream module is plain JavaScript with JSDoc. Its inferred types are
 * too narrow to be useful at the call site — `DEFAULTS.src` is `null`, so
 * TypeScript infers the config's `src` as `null | undefined` and rejects the
 * URL string the engine actually requires.
 *
 * Declaring the surface here fixes that and gives consumers real completion,
 * without editing vendored code (which would be lost on the next sync from
 * upstream). Only the members this site uses are declared; extend as needed.
 *
 * Upstream: SenseRing — `src/particle_wave/FE/`.
 */

export interface ParticleWaveConfig {
  /** URL of the `.pwcloud` asset, or a pre-parsed cloud object. */
  src: string | object;

  /** Fraction of the canvas kept clear around the cloud. */
  padding?: number;
  scaleMode?: 'fit' | 'fill' | 'stretch';

  particleSize?: number;
  particleSizeWeight?: number;
  particleColor?: string;
  particleOpacity?: number;
  particleOpacityWeight?: number;

  springK?: number;
  damping?: number;
  maxForce?: number;
  maxDisplacement?: number;
  mass?: number;

  /** Rigid rotation of the whole cloud, radians/second. Negative reverses. */
  restSpin?: number;
  /** Per-particle wander amplitude, px. 0 disables. */
  driftAmplitude?: number;
  /** Wander rate multiplier. */
  driftSpeed?: number;
  /**
   * Per-group rotation multiplier, keyed by the cloud's group index. Groups
   * not listed rotate at the full `restSpin` rate.
   */
  spinWeightByGroup?: Record<number, number> | null;

  mouseEnabled?: boolean;
  mouseMode?: 'repel' | 'attract' | 'orbit' | 'none';
  mouseStrength?: number;
  interactionRadius?: number;
  touchEnabled?: boolean;

  waveEnabled?: boolean;
  waveSpeed?: number;
  waveStrength?: number;
  waveDecay?: number;
  waveWidth?: number;
  rippleCount?: number;
  rippleInterval?: number;
  rippleDecay?: number;

  targetFPS?: number;
}

/**
 * A pluggable per-frame force. The engine calls `apply` once per frame with
 * its particle state and the frame time in milliseconds; implementations add
 * into the `fx`/`fy` accumulators.
 */
export interface CustomForce {
  apply(state: ParticleStateView, dt: number): void;
}

/** The subset of engine particle state exposed to custom forces. */
export interface ParticleStateView {
  readonly N: number;
  /** Rest positions. */
  readonly ox: Float32Array;
  readonly oy: Float32Array;
  /** Current positions. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** Force accumulators for this frame. */
  readonly fx: Float32Array;
  readonly fy: Float32Array;
}

export interface ParticleWaveInstance {
  /** Merge a partial config into the running instance. */
  setConfig(partial: Partial<ParticleWaveConfig>): void;
  /** Register a per-frame force. Composes with spring, mouse, and waves. */
  addForce(force: CustomForce): void;
  removeForce(force: CustomForce): void;
  setMode(mode: NonNullable<ParticleWaveConfig['mouseMode']>): void;
  /** Emit a wave from a point in canvas coordinates. */
  triggerWave(origin: { x: number; y: number }): void;
  /** Stop the animation loop. Safe to call when already paused. */
  pause(): void;
  resume(): void;
  /** Tear down listeners and observers. */
  destroy(): void;
  /** Live counters, sampled per frame. */
  readonly stats: {
    fps: number;
    particleCount: number;
    activeWaves: number;
  };
}

declare const ParticleWave: {
  init(canvas: HTMLCanvasElement, config: ParticleWaveConfig): Promise<ParticleWaveInstance>;
};

export default ParticleWave;
