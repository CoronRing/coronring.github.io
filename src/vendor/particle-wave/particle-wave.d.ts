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

export type ParticleShape =
  | 'circle'
  | 'nofill_circle'
  | 'triangle'
  | 'square'
  | 'hexagon'
  | 'octagon';

export type ClickMode =
  | 'outward_wave'
  | 'inward_wave'
  | 'attract_burst'
  | 'repel_burst'
  | 'none';

export type MouseMode = 'repel' | 'attract' | 'orbit' | 'none';

export type SpinAxis = 'clock' | 'z';

export type ColorMode = 'single' | 'source' | 'gradient';

export type ColorPalette =
  | 'rainbow'
  | 'aurora'
  | 'cyberpunk'
  | 'sunset'
  | 'neon'
  | 'fire'
  | 'ocean';

export type ColorMapping = 'weight' | 'position_x' | 'position_y' | 'radial' | 'velocity';

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
  particleShape?: ParticleShape;
  particleStrokeWidth?: number;

  colorMode?: ColorMode;
  colorPalette?: ColorPalette;
  colorMapping?: ColorMapping;

  trailEnabled?: boolean;
  trailLength?: number;
  trailWidth?: number;
  trailDisappearSpeed?: number;
  trailOpacity?: number;

  springK?: number;
  damping?: number;
  maxForce?: number;
  maxDisplacement?: number;
  mass?: number;
  springAttenuateNearCursor?: boolean;
  springCursorFalloff?: number;

  /** Rigid rotation of the whole cloud, radians/second. Negative reverses. */
  restSpin?: number;
  /** Spin axis: 'clock' (2D in-plane) or 'z' (3D depth rotation). */
  spinAxis?: SpinAxis;
  /** Max rotation degree (360/0 = continuous full circle, <360 = bounce back). */
  spinMaxDegree?: number;
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
  mouseMode?: MouseMode;
  mouseStrength?: number;
  mouseStrengthMultiplier?: number;
  interactionRadius?: number;
  touchEnabled?: boolean;

  leftClickMode?: ClickMode;
  rightClickMode?: ClickMode;
  leftClickWaveAmplitude?: number;
  rightClickWaveAmplitude?: number;
  leftClickBurstStrength?: number;
  rightClickBurstStrength?: number;
  continuousPressEnabled?: boolean;
  continuousWaveInterval?: number;

  /**
   * Burst geometry and feel. A burst is a stationary radial field centred on
   * the click, as opposed to a wave, which is a front that travels outward.
   */
  /** Explicit outer radius in canvas px. 0 derives it from `interactionRadius`. */
  burstRadius?: number;
  /** Multiplier applied to `interactionRadius` when `burstRadius` is 0. */
  burstRadiusScale?: number;
  /** An inward burst never pulls past this radius. 0 derives 16% of the radius. */
  burstStopRadius?: number;
  /** Milliseconds a released burst takes to fade out. */
  burstDuration?: number;
  /**
   * Gain applied to outward bursts only. A converging field concentrates
   * particles and a diverging one dilutes them, so equal force does not read
   * as equal effect without this.
   */
  burstOutwardGain?: number;
  /** 0..1 — how far the cursor hover field stands down while a burst is live. */
  burstHoverSuppression?: number;
  /** Draw a ring marking the burst extent. */
  burstVisual?: boolean;
  maxConcurrentBursts?: number;

  waveEnabled?: boolean;
  waveSpeed?: number;
  waveStrength?: number;
  waveStrengthOut?: number;
  waveStrengthIn?: number;
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
  /** Supply per-particle RGB source colors directly. */
  setColors(colors: Uint8Array | number[]): void;
  /** Register a per-frame force. Composes with spring, mouse, and waves. */
  addForce(force: CustomForce): void;
  removeForce(force: CustomForce): void;
  setMode(mode: NonNullable<ParticleWaveConfig['mouseMode']>): void;
  /** Emit a wave from a point in canvas coordinates. */
  triggerWave(origin: { x: number; y: number }, amplitude?: number): void;
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
    activeBursts: number;
  };
}

declare const ParticleWave: {
  init(canvas: HTMLCanvasElement, config: ParticleWaveConfig): Promise<ParticleWaveInstance>;
};

export default ParticleWave;
