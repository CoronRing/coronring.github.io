/**
 * @file Renderer.js
 * @description Canvas 2-D renderer for the Particle Wave system.
 * Draws N particles from SoA buffers in a single batched pass,
 * with optional per-weight colour and opacity modulation.
 * Designed to be replaceable via the `config.renderer` extension point.
 */

import { hexToRgb, rgbaToCss, clamp } from '../utils/math.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object}            config
   */
  constructor(canvas, config) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._config = config;
    this._colorCache = null; // resolved {r,g,b} or null if functional
    this._resolveColor();
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Render one frame.
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {import('./WaveManager.js').WaveManager}       wm
   */
  draw(ps, wm) {
    const ctx = this._ctx;
    const cfg = this._config;
    const W = this._canvas.width;
    const H = this._canvas.height;

    // Clear
    if (cfg.backgroundColor === 'transparent' || cfg.backgroundColor == null) {
      ctx.clearRect(0, 0, W, H);
    } else {
      ctx.fillStyle = cfg.backgroundColor;
      ctx.fillRect(0, 0, W, H);
    }

    // Optional: draw wave rings (debug / stylistic)
    if ((cfg.debugWaves || cfg.clickWaveVisual) && wm) {
      this._drawWaveRings(wm);
    }

    // Draw particles
    this._drawParticles(ps);
  }

  /**
   * Handle canvas resize.
   * @param {number} w
   * @param {number} h
   */
  resize(w, h) {
    this._canvas.width = w;
    this._canvas.height = h;
  }

  /** Hot-update config. */
  updateConfig(partial) {
    Object.assign(this._config, partial);
    if ('particleColor' in partial) this._resolveColor();
  }

  destroy() {
    // Nothing to teardown for 2-D canvas renderer
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _resolveColor() {
    const c = this._config.particleColor;
    if (typeof c === 'string' && c.startsWith('#')) {
      this._colorCache = hexToRgb(c);
    } else {
      this._colorCache = null; // functional colour — computed per-draw
    }
  }

  _drawParticles(ps) {
    const ctx = this._ctx;
    const cfg = this._config;
    const N = ps.N;
    const baseOpacity = cfg.particleOpacity;
    const opacityWeight = cfg.particleOpacityWeight;

    // If all particles are the same colour and simple opacity, batch with a
    // single fillStyle assignment using Path2D for performance.
    if (this._colorCache !== null && opacityWeight === 0) {
      ctx.fillStyle = rgbaToCss(this._colorCache, baseOpacity);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const r = ps.sz[i];
        ctx.moveTo(ps.px[i] + r, ps.py[i]);
        ctx.arc(ps.px[i], ps.py[i], r, 0, Math.PI * 2);
      }
      ctx.fill();
      return;
    }

    // Per-particle draw (colour or opacity depends on weight)
    for (let i = 0; i < N; i++) {
      const w = ps.wt[i];
      const opacity = clamp(baseOpacity + (opacityWeight - 1) * baseOpacity * (1 - w), 0, 1);

      let rgb;
      if (this._colorCache !== null) {
        rgb = this._colorCache;
      } else if (typeof cfg.particleColor === 'function') {
        const cssColor = cfg.particleColor(w);
        rgb = hexToRgb(cssColor);
      } else {
        rgb = { r: 255, g: 255, b: 255 };
      }

      ctx.fillStyle = rgbaToCss(rgb, opacity);
      ctx.beginPath();
      ctx.arc(ps.px[i], ps.py[i], ps.sz[i], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawWaveRings(wm) {
    const ctx = this._ctx;
    const cfg = this._config;
    const maxRadius = Math.max(0, Number(cfg.clickWaveVisualMaxRadius ?? 0));
    const opacityScale = Math.max(0, Math.min(1, Number(cfg.clickWaveVisualOpacity ?? 0.45)));
    const showRipples = Boolean(cfg.clickWaveVisualShowRipples);

    for (const packet of wm._pool.active) {
      if (!packet.alive) continue;
      if (!cfg.debugWaves && !showRipples && !packet.isPrimary) continue;
      if (!cfg.debugWaves && maxRadius > 0 && packet.radius > maxRadius) continue;

      const alpha = Math.max(
        0.06,
        Math.min(0.65, Math.abs(packet.amplitude) * 0.55) * opacityScale,
      );
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;

      let lineWidth = packet.direction >= 0 ? 2.2 : 1.6;
      if (!cfg.debugWaves && maxRadius > 0) {
        const radiusFactor = Math.max(0.2, 1 - packet.radius / maxRadius);
        lineWidth *= radiusFactor;
      }
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(packet.cx, packet.cy, packet.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
