/**
 * AmbientDrift — a continuous flow-field force for the particle engine.
 *
 * ## Why this exists
 *
 * `particle_wave` moves particles only in response to input: without a mouse
 * or a click there is no force, the springs hold every point at its rest
 * position, and the cloud is a still image. That reads as broken rather than
 * as calm, especially on a hero.
 *
 * This adds low-amplitude, always-on motion so the cloud breathes. It is a
 * custom force in the engine's own terms (`apply(ps, dt)`), so it composes
 * with the spring, the mouse, and click waves rather than fighting them.
 *
 * ## The field
 *
 * Two out-of-phase sinusoid pairs sampled at each particle's *rest* position,
 * with time as the third input. Sampling rest rather than current position
 * keeps the field stationary in space — particles drift through a fixed
 * pattern instead of dragging it along with them, which is what makes it look
 * like a current rather than jitter.
 *
 * Cheap by construction: four `Math.sin`/`cos` per particle per frame, no
 * allocation, no lookup table. At ~6.7k particles that is well inside frame
 * budget, and the whole thing is skipped when the host pauses the engine.
 */

/** Minimal view of the engine's particle state that this force touches. */
export interface ParticleState {
  readonly N: number;
  /** Rest positions. */
  readonly ox: Float32Array;
  readonly oy: Float32Array;
  /** Accumulated force for this frame, which we add into. */
  readonly fx: Float32Array;
  readonly fy: Float32Array;
}

export interface AmbientDriftOptions {
  /** Force magnitude. Keep well under the spring constant. */
  amplitude?: number;
  /** Spatial frequency of the field, in radians per pixel. */
  scale?: number;
  /** How fast the field evolves, in radians per second. */
  speed?: number;
}

export class AmbientDrift {
  private readonly amplitude: number;
  private readonly scale: number;
  private readonly speed: number;
  /** Accumulated seconds; drives the field's evolution. */
  private t = 0;

  constructor({ amplitude = 26, scale = 0.006, speed = 0.35 }: AmbientDriftOptions = {}) {
    this.amplitude = amplitude;
    this.scale = scale;
    this.speed = speed;
  }

  /**
   * Add one frame of drift.
   *
   * @param ps Engine particle state.
   * @param dt Frame time in **milliseconds** (the engine's unit).
   */
  apply(ps: ParticleState, dt: number): void {
    this.t += dt / 1000;

    const { amplitude: a, scale: s, speed: w } = this;
    const t = this.t * w;
    const N = ps.N;

    for (let i = 0; i < N; i += 1) {
      const x = ps.ox[i]! * s;
      const y = ps.oy[i]! * s;

      // Out-of-phase pairs: the x force varies mainly with y and vice versa,
      // which produces curl rather than a uniform translation.
      ps.fx[i]! += a * Math.sin(y + t) * Math.cos(x * 0.6 - t * 0.7);
      ps.fy[i]! += a * Math.cos(x - t * 0.8) * Math.sin(y * 0.6 + t * 0.5);
    }
  }
}
