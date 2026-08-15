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
    this.ox = new Float32Array(this.N); // rest position x
    this.oy = new Float32Array(this.N); // rest position y
    this.vx = new Float32Array(this.N); // velocity x
    this.vy = new Float32Array(this.N); // velocity y
    this.fx = new Float32Array(this.N); // accumulated force x (reset each frame)
    this.fy = new Float32Array(this.N); // accumulated force y
    this.wt = new Float32Array(this.N); // saliency weight [0,1]
    this.sz = new Float32Array(this.N); // render radius (px)
    this.gr = new Int32Array(this.N); // group index

    this._initFromCloud(cloud, canvasW, canvasH);
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
