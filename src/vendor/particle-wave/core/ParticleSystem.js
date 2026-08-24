/**
 * @file ParticleSystem.js
 * @description Owns and manages all per-particle state using Structure-of-Arrays
 * (SoA) TypedArrays, including trajectory history buffers and color channels.
 */

import { clamp } from '../utils/math.js';

export const MAX_TRAIL_STEPS = 16;

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
    this.px = new Float32Array(this.N);  // current position x
    this.py = new Float32Array(this.N);  // current position y
    this.ox = new Float32Array(this.N);  // rest position x (rotated + drifted)
    this.oy = new Float32Array(this.N);  // rest position y
    this.bx = new Float32Array(this.N);  // base rest x — the cloud as authored
    this.by = new Float32Array(this.N);  // base rest y
    this.vx = new Float32Array(this.N);  // velocity x
    this.vy = new Float32Array(this.N);  // velocity y
    this.fx = new Float32Array(this.N);  // accumulated force x (reset each frame)
    this.fy = new Float32Array(this.N);  // accumulated force y
    this.wt = new Float32Array(this.N);  // saliency weight [0,1]
    this.sz = new Float32Array(this.N);  // render radius (px)
    this.gr = new Int32Array(this.N);    // group index
    this.ph = new Float32Array(this.N);  // per-particle drift phase
    this.pr = new Float32Array(this.N);  // per-particle drift rate multiplier
    this.pz = new Float32Array(this.N);  // pseudo-3d depth z for Z-axis spin

    // Source RGB colors (sampled from original image if available)
    this.cr = new Uint8Array(this.N);
    this.cg = new Uint8Array(this.N);
    this.cb = new Uint8Array(this.N);
    this.hasSourceColors = false;

    // Trajectory history ring buffers for meteor / star trails
    this.maxTrail = MAX_TRAIL_STEPS;
    this.hx = new Float32Array(this.N * this.maxTrail);
    this.hy = new Float32Array(this.N * this.maxTrail);
    this.trailHead = 0;

    // Cursor tracking for spring attenuation
    this.cursorActive = false;
    this.cursorX = -9999;
    this.cursorY = -9999;
    this.cursorRadius = 0;

    // Rotation centre (canvas px) and current rest-frame angle.
    this.cx = 0;
    this.cy = 0;
    this._theta = 0;
    this._restDirty = false;

    this._swVals = [1];
    this._swIdx  = new Uint8Array(this.N);
    this._swCos  = new Float32Array(1);
    this._swSin  = new Float32Array(1);

    this._seedDriftPhases();
    this._initFromCloud(cloud, canvasW, canvasH);
    this.setSpinWeightByGroup(config.spinWeightByGroup);
  }

  /**
   * Set per-particle RGB colors from a flat Uint8Array [r0, g0, b0, r1, g1, b1, ...].
   * @param {Uint8Array|Array<number>} colors
   */
  setSourceColors(colors) {
    if (!colors || colors.length < this.N * 3) return;
    for (let i = 0; i < this.N; i++) {
      this.cr[i] = colors[i * 3];
      this.cg[i] = colors[i * 3 + 1];
      this.cb[i] = colors[i * 3 + 2];
    }
    this.hasSourceColors = true;
  }

  /**
   * Scale the rest-frame rotation per cloud group.
   * @param {Record<number, number>|null|undefined} map
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
    this._swCos  = new Float32Array(this._swVals.length);
    this._swSin  = new Float32Array(this._swVals.length);
  }

  _seedDriftPhases() {
    const TAU = Math.PI * 2;
    for (let i = 0; i < this.N; i++) {
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      const u = (h >>> 0) / 4294967296;
      this.ph[i] = u * TAU;
      this.pr[i] = 0.6 + u * 0.8;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

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
      this.px[i] = cx;
      this.py[i] = cy;
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.wt[i] = clamp(cloud.w[i], 0, 1);
      this.gr[i] = cloud.g[i];
      this.sz[i] = particleSize + particleSizeWeight * this.wt[i] * particleSize;

      // Initialize trail history at initial position
      for (let k = 0; k < this.maxTrail; k++) {
        this.hx[i * this.maxTrail + k] = cx;
        this.hy[i * this.maxTrail + k] = cy;
      }
    }

    if (cloud.colors && cloud.colors.length >= this.N * 3) {
      this.setSourceColors(cloud.colors);
    }

    this._drawArea = { drawW, drawH, offX, offY };
    this.cx = offX + drawW / 2;
    this.cy = offY + drawH / 2;
  }

  /**
   * Advance trajectory trail history ring buffer.
   */
  updateTrails() {
    this.trailHead = (this.trailHead + 1) % this.maxTrail;
    const head = this.trailHead;
    const maxT = this.maxTrail;
    for (let i = 0; i < this.N; i++) {
      this.hx[i * maxT + head] = this.px[i];
      this.hy[i * maxT + head] = this.py[i];
    }
  }

  /**
   * Recompute rest positions for this frame.
   * @param {number} theta
   * @param {number} t
   * @param {number} amp
   * @param {number} speed
   * @param {string} [spinAxis]
   */
  updateRestFrame(theta, t, amp, speed, spinAxis) {
    this._theta = theta;
    const spinning = theta !== 0;
    const drifting = amp > 0;
    const axis = spinAxis || this._config.spinAxis || 'clock';
    const is3dZ = axis === 'z' || axis === '3d_z' || axis === '3d';

    if (!spinning && !drifting) {
      if (this._restDirty) {
        this.ox.set(this.bx);
        this.oy.set(this.by);
        this.pz.fill(0);
        this._restDirty = false;
      }
      return;
    }
    this._restDirty = true;

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

      let x = cx;
      let y = cy;

      if (is3dZ) {
        const rotX = dx * cos;
        const z = dx * sin;
        this.pz[i] = z;
        const persp = 1 + z / 800;
        x = cx + rotX * persp;
        y = cy + dy * persp;
      } else {
        this.pz[i] = 0;
        x = cx + dx * cos - dy * sin;
        y = cy + dx * sin + dy * cos;
      }

      if (drifting) {
        const a = this.ph[i];
        const r = this.pr[i] * speed * t;
        x += amp * Math.sin(r + a);
        y += amp * Math.sin(r * 0.83 + a * 1.31 + 1.7);
      }

      this.ox[i] = x;
      this.oy[i] = y;
    }
  }

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
      } else { // 'fit'
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

  clearForces() {
    this.fx.fill(0);
    this.fy.fill(0);
  }

  resize(W, H, cloud) {
    this._initFromCloud(cloud, W, H);
  }

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

  getStats() {
    return { particleCount: this.N };
  }
}
