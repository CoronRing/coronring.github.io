/**
 * @file BurstManager.js
 * @description Owns radial burst fields — the non-travelling counterpart to a wave.
 *
 * A wave is a moving annulus: a thin front leaves the click point, kicks each
 * particle once as it passes, and keeps going. A burst is a stationary radial
 * field: everything inside its radius is pushed (or pulled) for as long as the
 * burst lives, hardest at the centre.
 *
 * Two corrections live here that the previous in-InteractionLayer implementation
 * lacked, and which made the two burst directions feel like different features:
 *
 *  1. An inward burst concentrates — particles from the whole disc converge on
 *     one point, so density spikes — while an outward burst dilutes over a
 *     growing area. Equal force therefore does not read as equal effect.
 *     `burstOutwardGain` compensates the diverging direction.
 *  2. An inward burst had no centre guard (waves have `inwardStopRadius`), so
 *     particles accelerated through the origin and out the far side, which is
 *     what turned "pull" into a violent knot. `burstStopRadius` stops the pull
 *     short of the centre and bleeds the radial velocity there.
 */

import { ObjectPool } from '../utils/pool.js';
import { dist, easeOutQuad, clamp } from '../utils/math.js';

/**
 * @typedef {Object} BurstGeometry
 * @property {number} radius      — outer radius of the field, canvas px
 * @property {number} stopRadius  — inward bursts do not pull past this, canvas px
 */

// ---------------------------------------------------------------------------
// BurstPacket value object (pooled — must be fully resettable)
// ---------------------------------------------------------------------------

class BurstPacket {
  constructor() {
    this.alive = false;
    this.cx = 0;
    this.cy = 0;
    /** +1 pushes away from the origin, -1 pulls toward it. @type {1|-1} */
    this.sign = 1;
    this.strength = 0;
    this.radius = 0;
    this.stopRadius = 0;
    /** Milliseconds the envelope takes to fall from 1 to 0. */
    this.duration = 1;
    this.age = 0;
    this.id = 0;
    /** Sustained bursts are refreshed every frame by a held mouse button. */
    this.sustained = false;
  }

  /**
   * @param {{ x: number, y: number }} origin
   * @param {1|-1}                     sign
   * @param {number}                   strength
   * @param {BurstGeometry}            geom
   * @param {number}                   duration   — ms
   * @param {number}                   id
   * @param {boolean}                  sustained
   */
  reset(origin, sign, strength, geom, duration, id, sustained) {
    this.cx = origin.x;
    this.cy = origin.y;
    this.sign = sign >= 0 ? 1 : -1;
    this.strength = Math.abs(strength);
    this.radius = geom.radius;
    this.stopRadius = geom.stopRadius;
    this.duration = Math.max(1, duration);
    this.age = 0;
    this.alive = true;
    this.id = id;
    this.sustained = sustained;
  }

  /**
   * Remaining share of full strength, 1 at spawn falling to 0 at `duration`.
   * A sustained burst is held at full strength while the button is down; its
   * envelope only starts running once the button is released.
   */
  get envelope() {
    if (this.sustained) return 1;
    const t = clamp(this.age / this.duration, 0, 1);
    return (1 - t) * (1 - t);
  }

  onEvict() {
    this.alive = false;
  }
}

// ---------------------------------------------------------------------------
// BurstManager
// ---------------------------------------------------------------------------

export class BurstManager {
  /**
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {Object}                                       config
   * @param {(detail: Object) => void}                     dispatchEvent
   */
  constructor(ps, config, dispatchEvent) {
    this._ps = ps;
    this._config = config;
    this._dispatch = dispatchEvent;
    this._pool = new ObjectPool(() => new BurstPacket(), config.maxConcurrentBursts || 8);
    this._nextId = 0;
    /** The packet currently pinned to a held mouse button, if any. */
    this._sustained = null;
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Fire a one-shot burst that decays over `burstDuration`.
   * @param {{ x: number, y: number }} origin    — canvas px
   * @param {1|-1}                     sign      — +1 repel, -1 attract
   * @param {number}                   strength
   * @returns {BurstPacket}
   */
  spawn(origin, sign, strength) {
    return this._create(origin, sign, strength, false);
  }

  /**
   * Pin a burst to a held mouse button. Safe to call every frame — it refreshes
   * the existing packet rather than spawning a new one, and follows the cursor.
   * @param {{ x: number, y: number }} origin
   * @param {1|-1}                     sign
   * @param {number}                   strength
   */
  sustain(origin, sign, strength) {
    const normalized = sign >= 0 ? 1 : -1;
    const geom = this.geometry();
    const held = this._sustained;

    if (held && held.alive && held.sustained && held.sign === normalized) {
      held.cx = origin.x;
      held.cy = origin.y;
      held.strength = Math.abs(strength);
      held.radius = geom.radius;
      held.stopRadius = geom.stopRadius;
      held.age = 0;
      return;
    }

    this.releaseSustained();
    this._sustained = this._create(origin, normalized, strength, true);
  }

  /**
   * @param {{ x: number, y: number }} origin
   * @param {number}  sign
   * @param {number}  strength
   * @param {boolean} sustained
   * @returns {BurstPacket}
   */
  _create(origin, sign, strength, sustained) {
    const packet = this._pool.acquire();
    // A full pool evicts its oldest packet, which may be the one the held
    // button is pointing at; drop the stale reference before reusing it.
    if (packet === this._sustained) this._sustained = null;
    packet.reset(
      origin,
      sign,
      strength,
      this.geometry(),
      Number(this._config.burstDuration ?? 260),
      this._nextId++,
      sustained
    );
    this._dispatch({
      type: 'pw:burst',
      detail: {
        origin: { ...origin },
        sign: packet.sign,
        strength: packet.strength,
        sustained,
        id: packet.id,
      },
    });
    return packet;
  }

  /** Let the held burst start decaying (mouse up / pointer left the canvas). */
  releaseSustained() {
    if (this._sustained) {
      this._sustained.sustained = false;
      this._sustained.age = 0;
      this._sustained = null;
    }
  }

  /**
   * How much the cursor hover field should be attenuated this frame.
   *
   * A repel burst fired under a repel cursor is invisible: the cursor has
   * already pushed that neighbourhood as far as it goes, so the burst adds a
   * second helping of a force the particles are already saturated by. Standing
   * the hover field down for the life of the burst is what lets the click read
   * as its own event.
   *
   * @returns {number} multiplier in [0, 1] to apply to the hover force
   */
  hoverAttenuation() {
    const suppression = clamp(Number(this._config.burstHoverSuppression ?? 1), 0, 1);
    if (suppression <= 0 || this._pool.activeCount === 0) return 1;

    let strongest = 0;
    for (const packet of this._pool.active) {
      if (!packet.alive) continue;
      const e = packet.envelope;
      if (e > strongest) strongest = e;
    }
    return 1 - strongest * suppression;
  }

  /**
   * Resolved burst geometry for the current config.
   * @returns {BurstGeometry}
   */
  geometry() {
    const cfg = this._config;
    const interaction = Math.max(1, Number(cfg.interactionRadius ?? 120));
    const explicit = Number(cfg.burstRadius);
    const radius = Math.max(
      60,
      explicit > 0 ? explicit : interaction * Number(cfg.burstRadiusScale ?? 2.4)
    );
    const explicitStop = Number(cfg.burstStopRadius);
    const stopRadius = clamp(
      explicitStop > 0 ? explicitStop : radius * 0.16,
      2,
      radius * 0.5
    );
    return { radius, stopRadius };
  }

  /**
   * Advance every live burst by `dt` ms and apply its radial force.
   * @param {number} dt — frame time in ms
   */
  advance(dt) {
    if (this._pool.activeCount === 0) return;

    const cfg = this._config;
    const ps = this._ps;
    const dtS = dt / 1000;
    const outwardGain = Math.max(0, Number(cfg.burstOutwardGain ?? 1.75));
    const toRelease = [];

    for (const packet of this._pool.active) {
      if (!packet.alive) { toRelease.push(packet); continue; }

      if (!packet.sustained) {
        packet.age += dt;
        if (packet.age >= packet.duration) {
          packet.alive = false;
          toRelease.push(packet);
          continue;
        }
      }

      const envelope = packet.envelope;
      if (envelope <= 0.001) {
        packet.alive = false;
        toRelease.push(packet);
        continue;
      }

      const directional = packet.sign > 0 ? outwardGain : 1;
      const magnitude = packet.strength * envelope * directional;
      const guardSpan = Math.max(1e-6, packet.stopRadius);

      for (let i = 0; i < ps.N; i++) {
        const d = dist(ps.px[i], ps.py[i], packet.cx, packet.cy);
        if (d >= packet.radius || d < 0.001) continue;

        // Radial falloff: full strength at the origin, nothing at the rim.
        let profile = easeOutQuad(1 - d / packet.radius);

        if (packet.sign < 0) {
          // Ease the pull off as the particle nears the guard so it settles
          // into the gather instead of being slung through the centre.
          if (d <= packet.stopRadius) continue;
          profile *= clamp((d - packet.stopRadius) / guardSpan, 0, 1);
          if (profile <= 0) continue;
        }

        const force = magnitude * profile * packet.sign;
        const invD = 1 / d;
        const dirX = (ps.px[i] - packet.cx) * invD;
        const dirY = (ps.py[i] - packet.cy) * invD;

        ps.fx[i] += dirX * force;
        ps.fy[i] += dirY * force;
        ps.vx[i] += dirX * force * dtS * 1.8;
        ps.vy[i] += dirY * force * dtS * 1.8;
      }
    }

    for (const p of toRelease) {
      if (p === this._sustained) this._sustained = null;
      this._pool.release(p);
    }
  }

  /**
   * Keep inward bursts from collapsing the cloud into a singularity.
   * Runs after integration, mirroring `WaveManager.enforceInwardGuards()`.
   */
  enforceGuards() {
    if (this._pool.activeCount === 0) return;
    const ps = this._ps;

    for (const packet of this._pool.active) {
      if (!packet.alive || packet.sign > 0 || packet.stopRadius <= 0) continue;

      for (let i = 0; i < ps.N; i++) {
        const dx = ps.px[i] - packet.cx;
        const dy = ps.py[i] - packet.cy;
        const len = Math.hypot(dx, dy);
        if (len > packet.stopRadius || len <= 1e-4) continue;

        const ux = dx / len;
        const uy = dy / len;
        ps.px[i] = packet.cx + ux * packet.stopRadius;
        ps.py[i] = packet.cy + uy * packet.stopRadius;

        // Cancel the inward component only; tangential drift may continue, so
        // the gather swirls rather than freezing into a dead ring.
        const radial = ps.vx[i] * ux + ps.vy[i] * uy;
        if (radial < 0) {
          ps.vx[i] -= radial * ux;
          ps.vy[i] -= radial * uy;
        }
      }
    }
  }

  /** Drop every burst immediately. */
  clear() {
    this._sustained = null;
    for (const packet of this._pool.active) packet.alive = false;
    this._pool.releaseAll();
  }

  /** Live burst packets, for the renderer. */
  get active() {
    return this._pool.active;
  }

  /** Number of live bursts. */
  get activeCount() {
    return this._pool.activeCount;
  }

  /** Hot-update config. */
  updateConfig(partial) {
    Object.assign(this._config, partial);
  }
}
