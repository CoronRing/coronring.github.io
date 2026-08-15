/**
 * @file PhysicsEngine.js
 * @description Velocity Verlet integration with Hooke's-law spring, velocity
 * damping, and support for pluggable custom forces. All operations run entirely
 * on the SoA TypedArrays owned by ParticleSystem — zero heap allocation in the
 * hot path.
 */

import { capForce } from '../utils/math.js';

export class PhysicsEngine {
  /**
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {Object} config
   */
  constructor(ps, config) {
    this._ps = ps;
    this._config = config;
    /** @type {Array<{apply(state, dt): void}>} */
    this._customForces = [];
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Register a custom force object.
   * Must implement `apply(state, dt)` where `state` is the ParticleSystem reference.
   * @param {{ apply(state: import('./ParticleSystem.js').ParticleSystem, dt: number): void }} force
   */
  addForce(force) {
    this._customForces.push(force);
  }

  /** Remove a previously added custom force. */
  removeForce(force) {
    const idx = this._customForces.indexOf(force);
    if (idx !== -1) this._customForces.splice(idx, 1);
  }

  /**
   * Advance physics by one frame.
   * @param {number} dt  — frame time in milliseconds (already capped externally)
   */
  integrate(dt) {
    const ps = this._ps;
    const { springK, damping, maxForce, maxDisplacement, mass } = this._config;

    const dtS = dt / 1000; // seconds
    const N = ps.N;
    const dampFactor = Math.max(0, 1 - damping * dtS);
    const invMass = 1 / mass;

    // [1] Spring-to-rest force
    for (let i = 0; i < N; i++) {
      ps.fx[i] += springK * (ps.ox[i] - ps.px[i]);
      ps.fy[i] += springK * (ps.oy[i] - ps.py[i]);
    }

    // [2] Custom forces
    for (const f of this._customForces) {
      f.apply(ps, dt);
    }

    // [3] Clamp total force magnitude
    for (let i = 0; i < N; i++) {
      capForce(ps.fx, ps.fy, i, maxForce);
    }

    // [4] Velocity Verlet integration
    //     v(t+dt) = v(t) + (F/m) * dt
    //     p(t+dt) = p(t) + v(t+dt) * dt
    for (let i = 0; i < N; i++) {
      const ax = ps.fx[i] * invMass;
      const ay = ps.fy[i] * invMass;
      ps.vx[i] = (ps.vx[i] + ax * dtS) * dampFactor;
      ps.vy[i] = (ps.vy[i] + ay * dtS) * dampFactor;
      ps.px[i] += ps.vx[i] * dtS;
      ps.py[i] += ps.vy[i] * dtS;

      if (maxDisplacement > 0) {
        const dx = ps.px[i] - ps.ox[i];
        const dy = ps.py[i] - ps.oy[i];
        const maxDisp2 = maxDisplacement * maxDisplacement;
        const disp2 = dx * dx + dy * dy;
        if (disp2 > maxDisp2) {
          const scale = maxDisplacement / Math.sqrt(disp2);
          ps.px[i] = ps.ox[i] + dx * scale;
          ps.py[i] = ps.oy[i] + dy * scale;
          ps.vx[i] *= 0.35;
          ps.vy[i] *= 0.35;
        }
      }
    }
  }

  /** Hot-update config. */
  updateConfig(partial) {
    Object.assign(this._config, partial);
  }
}
