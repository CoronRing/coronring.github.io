/**
 * @file WaveManager.js
 * @description Manages the lifecycle of circular expanding and contracting wave packets.
 * Uses an ObjectPool to prevent GC pressure, and advances wave fronts each
 * frame, delivering smooth impulses to particles inside the active annulus.
 */

import { ObjectPool } from '../utils/pool.js';
import { dist, bell } from '../utils/math.js';

// ---------------------------------------------------------------------------
// WavePacket value object (reused from pool — must be resettable)
// ---------------------------------------------------------------------------

class WavePacket {
  constructor() {
    this.alive = false;
    this.cx = 0;
    this.cy = 0;
    this.radius = 0;
    this.amplitude = 0;
    this.age = 0;
    this.id = 0;
    this.direction = 1;
    this.isPrimary = true;
    this.baseAmplitude = 1;
  }

  /**
   * @param {{ x: number, y: number }} origin
   * @param {number} initialAmplitude
   * @param {number} id
   * @param {boolean} [isPrimary=true]
   */
  reset(origin, initialAmplitude, id, isPrimary = true) {
    this.cx = origin.x;
    this.cy = origin.y;
    this.radius = 0;
    this.direction = initialAmplitude >= 0 ? 1 : -1;
    this.baseAmplitude = Math.max(0.01, Math.abs(initialAmplitude));
    this.amplitude = this.direction * this.baseAmplitude;
    this.age = 0;
    this.alive = true;
    this.id = id;
    this.isPrimary = isPrimary;
  }

  onEvict() {
    this.alive = false;
  }
}

// ---------------------------------------------------------------------------
// WaveManager
// ---------------------------------------------------------------------------

export class WaveManager {
  /**
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {Object} config
   * @param {(detail: Object) => void} dispatchEvent
   */
  constructor(ps, config, dispatchEvent) {
    this._ps = ps;
    this._config = config;
    this._dispatch = dispatchEvent;
    this._pool = new ObjectPool(() => new WavePacket(), config.maxConcurrentWaves || 24);
    this._nextId = 0;
    this._pendingRipples = [];
    this._elapsed = 0;
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Spawn a primary wave and optional trailing ripples.
   * @param {{ x: number, y: number }} origin
   * @param {number} [amplitudeOverride=1.0]
   */
  spawnWave(origin, amplitudeOverride = 1.0) {
    const cfg = this._config;
    if (!cfg.waveEnabled) return;

    const id = this._nextId++;
    const packet = this._pool.acquire();
    packet.reset(origin, amplitudeOverride, id, true);
    this._dispatch({
      type: 'pw:wave',
      detail: {
        origin: { ...origin },
        amplitude: amplitudeOverride,
        direction: amplitudeOverride >= 0 ? 1 : -1,
        id,
      },
    });

    // Schedule trailing ripples
    for (let k = 1; k <= cfg.rippleCount; k++) {
      const rippleAmp = amplitudeOverride * Math.pow(cfg.rippleDecay, k);
      if (Math.abs(rippleAmp) < cfg.waveMinAmplitude) break;
      this._pendingRipples.push({
        origin: { ...origin },
        amplitude: rippleAmp,
        isPrimary: false,
        delay: k * cfg.rippleInterval,   // ms
        scheduled: this._elapsed,
      });
    }
  }

  /** Clear all live and pending waves. */
  clear() {
    this._pendingRipples.length = 0;
    for (const packet of this._pool.active) packet.alive = false;
    this._pool.releaseAll();
  }

  /**
   * Advance all active waves by `dt` milliseconds and apply radial impulses.
   * @param {number} dt  — frame time in ms
   */
  advance(dt) {
    const cfg = this._config;
    this._elapsed += dt;

    // Emit pending ripples whose delay has elapsed
    for (let i = this._pendingRipples.length - 1; i >= 0; i--) {
      const r = this._pendingRipples[i];
      if (this._elapsed - r.scheduled >= r.delay) {
        const packet = this._pool.acquire();
        packet.reset(r.origin, r.amplitude, this._nextId++, r.isPrimary ?? false);
        this._pendingRipples.splice(i, 1);
      }
    }

    if (this._pool.activeCount === 0) return;

    const ps = this._ps;
    const dtS = dt / 1000;
    const canvasDiag = Math.sqrt((ps._config._canvasW || 800) ** 2 + (ps._config._canvasH || 600) ** 2);
    const inwardPullRadius = Math.max(0, Number(cfg.inwardPullRadius ?? 280));
    const inwardStopRadius = Math.max(
      0,
      Number(cfg.inwardStopRadius ?? cfg.inwardCenterGuardRadius ?? 16)
    );
    const waveWidth = Math.max(10, Number(cfg.waveWidth ?? 36));

    const toRelease = [];

    for (const packet of this._pool.active) {
      if (!packet.alive) { toRelease.push(packet); continue; }

      if (packet.direction < 0 && packet.age === 0) {
        packet.radius = inwardPullRadius > 0 ? inwardPullRadius : Math.min(canvasDiag * 0.6, 360);
      }

      // Advance wave front
      if (packet.direction < 0) {
        packet.radius -= cfg.waveSpeed * dtS;
      } else {
        packet.radius += cfg.waveSpeed * dtS;
      }
      packet.age += dt;

      // Exponential amplitude decay
      const ampMagnitude = packet.baseAmplitude * Math.exp(-cfg.waveDecay * (packet.age / 1000));
      packet.amplitude = packet.direction * ampMagnitude;

      if (packet.direction < 0 && packet.radius <= inwardStopRadius) {
        packet.alive = false;
        toRelease.push(packet);
        continue;
      }

      if (ampMagnitude < cfg.waveMinAmplitude || packet.radius > canvasDiag) {
        packet.alive = false;
        toRelease.push(packet);
        continue;
      }

      // Apply impulse to particles inside the wave annulus
      for (let i = 0; i < ps.N; i++) {
        const d = dist(ps.px[i], ps.py[i], packet.cx, packet.cy);
        if (d < 0.001) continue;

        let phi;
        if (packet.direction < 0) {
          const outerBound = packet.radius + waveWidth * 0.5;
          const innerBound = Math.max(inwardStopRadius, packet.radius - waveWidth * 0.5);
          if (d < innerBound || d > outerBound) continue;

          const span = Math.max(1e-6, outerBound - innerBound);
          const t = (d - innerBound) / span;
          phi = bell(t);
        } else {
          const inner = Math.max(0, packet.radius - waveWidth * 0.5);
          const outer = packet.radius + waveWidth * 0.5;
          if (d < inner || d > outer) continue;

          const span = Math.max(1e-6, outer - inner);
          const t = (d - inner) / span;
          phi = bell(t);
        }

        // Direction: radially outward from origin
        const invD = 1 / d;
        const dirX = (ps.px[i] - packet.cx) * invD;
        const dirY = (ps.py[i] - packet.cy) * invD;

        const outStrength = Number(cfg.waveStrengthOut ?? cfg.waveStrength ?? 140);
        const inStrength = Number(cfg.waveStrengthIn ?? cfg.waveStrength ?? 180);
        const directionalStrength = packet.direction < 0 ? inStrength : outStrength;
        const weightFactor = 0.4 + 0.6 * ps.wt[i];

        const impulse = packet.amplitude * directionalStrength * weightFactor * phi;
        ps.fx[i] += dirX * impulse * 1.6;
        ps.fy[i] += dirY * impulse * 1.6;
        ps.vx[i] += dirX * impulse * (dtS * 2.2);
        ps.vy[i] += dirY * impulse * (dtS * 2.2);
      }
    }

    for (const p of toRelease) this._pool.release(p);
  }

  /** Number of currently live wave packets. */
  get activeWaves() {
    return this._pool.activeCount;
  }

  /**
   * Enforce inward center-guard constraints after physics integration.
   * Prevents inward-pulled particles from crashing past the click center.
   */
  enforceInwardGuards() {
    const cfg = this._config;
    const ps = this._ps;
    const guardRadius = Math.max(
      0,
      Number(cfg.inwardStopRadius ?? cfg.inwardCenterGuardRadius ?? 16)
    );
    if (guardRadius <= 0 || this._pool.activeCount === 0) return;

    for (const packet of this._pool.active) {
      if (!packet.alive || packet.direction >= 0) continue;

      for (let i = 0; i < ps.N; i++) {
        const curDx = ps.px[i] - packet.cx;
        const curDy = ps.py[i] - packet.cy;
        const curLen = Math.hypot(curDx, curDy);

        if (curLen <= guardRadius && curLen > 1e-4) {
          const ux = curDx / curLen;
          const uy = curDy / curLen;
          ps.px[i] = packet.cx + ux * guardRadius;
          ps.py[i] = packet.cy + uy * guardRadius;
          ps.vx[i] *= 0.2;
          ps.vy[i] *= 0.2;
        }
      }
    }
  }
}
