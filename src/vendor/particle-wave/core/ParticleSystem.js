/**
 * @file ParticleSystem.js
 * @description Owns and manages all per-particle state using Structure-of-Arrays
 * (SoA) TypedArrays. No per-particle heap objects; all operations are typed-array
 * loops for maximum JIT throughput.
 */

import { clamp } from '../utils/math.js';

export class ParticleSystem {
  /**
   * @param {import('./Loader.js').ParsedCloud} cloud
   * @param {Object} config   — merged user + default config
   * @param {number} canvasW  — canvas pixel width
   * @param {number} canvasH  — canvas pixel height
   */
  constructor(cloud, config, canvasW, canvasH) {
    this._config = config;
    this.N = cloud.N;

    // -----------------------------------------------------------------------
    // State buffers  (Structure-of-Arrays)
    // -----------------------------------------------------------------------
    this.px = new Float32Array(this.N); // current position x
    this.py = new Float32Array(this.N); // current position y
    this.ox = new Float32Array(this.N); // rest position x (rotated + drifted)
    this.oy = new Float32Array(this.N); // rest position y
    this.bx = new Float32Array(this.N); // base rest x — the cloud as authored
    this.by = new Float32Array(this.N); // base rest y
    this.vx = new Float32Array(this.N); // velocity x
    this.vy = new Float32Array(this.N); // velocity y
    this.fx = new Float32Array(this.N); // accumulated force x (reset each frame)
    this.fy = new Float32Array(this.N); // accumulated force y
    this.wt = new Float32Array(this.N); // saliency weight [0,1]
    this.sz = new Float32Array(this.N); // render radius (px)
    this.gr = new Int32Array(this.N); // group index
    this.ph = new Float32Array(this.N); // per-particle drift phase
    this.pr = new Float32Array(this.N); // per-particle drift rate multiplier

    // Rotation centre (canvas px) and current rest-frame angle. Both survive
    // resize so the cloud does not snap back to zero when the window changes.
    this.cx = 0;
    this.cy = 0;
    this._theta = 0;
    /** Whether ox/oy currently differ from the base rest frame. */
    this._restDirty = false;

    // Per-particle spin weight, as a small lookup table rather than a value
    // per particle: distinct weights are few (one per group at most), and
    // hoisting cos/sin per distinct weight keeps updateRestFrame at two trig
    // calls per *weight* per frame instead of two per particle.
    this._swVals = [1];
    this._swIdx = new Uint8Array(this.N);
    this._swCos = new Float32Array(1);
    this._swSin = new Float32Array(1);

    this._seedDriftPhases();
    this._initFromCloud(cloud, canvasW, canvasH);
    this.setSpinWeightByGroup(config.spinWeightByGroup);
  }

  /**
   * Scale the rest-frame rotation per cloud group.
   *
   * Lets one cloud hold a legible foreground while its surroundings orbit —
   * a letterform at weight 0 stays upright while dust at weight 1 turns
   * around it. Groups absent from the map default to 1.
   *
   * @param {Record<number, number>|null|undefined} map  — group index → multiplier
   */
  setSpinWeightByGroup(map) {
    const weightFor = (g) => {
      const w = map?.[g];
      return typeof w === 'number' && Number.isFinite(w) ? w : 1;
    };

    const vals = [];
    for (let i = 0; i < this.N; i++) {
      const w = weightFor(this.gr[i]);
      let idx = vals.indexOf(w);
      if (idx === -1) {
        // Uint8Array index: 256 distinct weights is far beyond any real cloud,
        // and silently wrapping would mis-rotate particles.
        if (vals.length >= 256) {
          idx = 0;
        } else {
          idx = vals.length;
          vals.push(w);
        }
      }
      this._swIdx[i] = idx;
    }

    this._swVals = vals.length ? vals : [1];
    this._swCos = new Float32Array(this._swVals.length);
    this._swSin = new Float32Array(this._swVals.length);
  }

  /**
   * Give every particle its own drift phase and rate.
   *
   * Deterministic from the index rather than Math.random(): the phases must be
   * identical across a resize, otherwise every particle jumps to a new point
   * in its wander the moment the window changes.
   */
  _seedDriftPhases() {
    const TAU = Math.PI * 2;
    for (let i = 0; i < this.N; i++) {
      // Cheap integer hash — decorrelates neighbours so the cloud shimmers
      // rather than pulsing in unison.
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      const u = (h >>> 0) / 4294967296;
      this.ph[i] = u * TAU;
      this.pr[i] = 0.6 + u * 0.8; // 0.6×–1.4× the base rate
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Map normalised cloud coordinates to canvas pixels and seed particle state.
   */
  _initFromCloud(cloud, W, H) {
    const { padding, particleSize, particleSizeWeight, scaleMode } = this._config;

    const { drawW, drawH, offX, offY } = this._computeDrawArea(W, H, cloud.meta?.source_size);

    for (let i = 0; i < this.N; i++) {
      const nx = cloud.x[i];
      const ny = cloud.y[i];
      const cx = clamp(offX + nx * drawW, 0, W);
      const cy = clamp(offY + ny * drawH, 0, H);

      this.bx[i] = cx;
      this.by[i] = cy;
      this.ox[i] = cx;
      this.oy[i] = cy;
      // Start particles slightly scattered from rest to add visual interest
      this.px[i] = cx;
      this.py[i] = cy;
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.wt[i] = clamp(cloud.w[i], 0, 1);
      this.gr[i] = cloud.g[i];
      this.sz[i] = particleSize + particleSizeWeight * this.wt[i] * particleSize;
    }

    this._drawArea = { drawW, drawH, offX, offY };

    // Spin about the centre of the authored field, not the centroid of the
    // points: a shape with a long tail (a flare, a descender) has a centroid
    // well off its visual middle, and rotating about that looks like a wobble.
    this.cx = offX + drawW / 2;
    this.cy = offY + drawH / 2;
  }

  /**
   * Recompute rest positions for this frame: rigid rotation of the authored
   * cloud, plus an independent per-particle wander.
   *
   * Both effects move the *rest* target rather than pushing on the particles.
   * Applied as forces they would fight the spring and wash out to a small
   * static offset; applied to the rest frame the spring carries the particles
   * along, so the motion is actually visible and its amplitude is in pixels.
   *
   * @param {number} theta  — rest-frame rotation, radians
   * @param {number} t      — elapsed time, seconds (drives the wander)
   * @param {number} amp    — wander amplitude, px (0 disables)
   * @param {number} speed  — wander rate multiplier
   */
  updateRestFrame(theta, t, amp, speed) {
    this._theta = theta;
    const spinning = theta !== 0;
    const drifting = amp > 0;
    if (!spinning && !drifting) {
      // Nothing to do — but only skip if the rest frame is already the base
      // one, otherwise turning both off would freeze the cloud mid-rotation.
      if (this._restDirty) {
        this.ox.set(this.bx);
        this.oy.set(this.by);
        this._restDirty = false;
      }
      return;
    }
    this._restDirty = true;

    // One cos/sin per distinct spin weight, not per particle.
    for (let k = 0; k < this._swVals.length; k++) {
      const a = theta * this._swVals[k];
      this._swCos[k] = Math.cos(a);
      this._swSin[k] = Math.sin(a);
    }

    const { cx, cy } = this;

    for (let i = 0; i < this.N; i++) {
      const k = this._swIdx[i];
      const cos = this._swCos[k];
      const sin = this._swSin[k];
      const dx = this.bx[i] - cx;
      const dy = this.by[i] - cy;
      let x = cx + dx * cos - dy * sin;
      let y = cy + dx * sin + dy * cos;

      if (drifting) {
        // Two incommensurate frequencies per particle, so each traces its own
        // small Lissajous loop instead of sliding along a shared vector.
        const a = this.ph[i];
        const r = this.pr[i] * speed * t;
        x += amp * Math.sin(r + a);
        y += amp * Math.sin(r * 0.83 + a * 1.31 + 1.7);
      }

      this.ox[i] = x;
      this.oy[i] = y;
    }
  }

  /**
   * Compute draw area (px) to fit the normalised cloud onto the canvas
   * respecting padding and scaleMode.
   */
  _computeDrawArea(W, H, sourceSize) {
    const { padding, scaleMode } = this._config;
    const padX = W * padding;
    const padY = H * padding;
    const availW = W - 2 * padX;
    const availH = H - 2 * padY;

    let drawW, drawH, offX, offY;

    if (scaleMode === 'stretch' || !sourceSize) {
      drawW = availW;
      drawH = availH;
    } else {
      const [srcW, srcH] = sourceSize;
      const aspect = srcW / srcH;
      if (scaleMode === 'fill') {
        if (availW / availH > aspect) {
          drawW = availW;
          drawH = drawW / aspect;
        } else {
          drawH = availH;
          drawW = drawH * aspect;
        }
      } else {
        // 'fit'
        if (availW / availH > aspect) {
          drawH = availH;
          drawW = drawH * aspect;
        } else {
          drawW = availW;
          drawH = drawW / aspect;
        }
      }
    }

    offX = (W - drawW) / 2;
    offY = (H - drawH) / 2;

    return { drawW, drawH, offX, offY };
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  /**
   * Reset accumulated forces to zero. Called at start of each physics step.
   */
  clearForces() {
    this.fx.fill(0);
    this.fy.fill(0);
  }

  /**
   * Recompute rest positions and particle sizes after a canvas resize.
   * @param {number} W
   * @param {number} H
   * @param {import('./Loader.js').ParsedCloud} cloud
   */
  resize(W, H, cloud) {
    this._initFromCloud(cloud, W, H);
  }

  /**
   * Hot-update configuration. Re-derives per-particle sizes from weight.
   * @param {Object} partial
   */
  updateConfig(partial) {
    Object.assign(this._config, partial);
    if ('spinWeightByGroup' in partial) {
      this.setSpinWeightByGroup(this._config.spinWeightByGroup);
    }
    if ('particleSize' in partial || 'particleSizeWeight' in partial) {
      const { particleSize, particleSizeWeight } = this._config;
      for (let i = 0; i < this.N; i++) {
        this.sz[i] = particleSize + particleSizeWeight * this.wt[i] * particleSize;
      }
    }
  }

  /**
   * Return a plain-object snapshot of stats for the public API.
   */
  getStats() {
    return { particleCount: this.N };
  }
}
