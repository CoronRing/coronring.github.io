/**
 * @file Renderer.js
 * @description Canvas 2-D renderer for the Particle Wave system.
 * Draws N particles and dynamic meteor trajectory trails from SoA buffers,
 * supporting solid colors, source image sampling, and rich gradient palettes.
 */

import { hexToRgb, rgbaToCss, clamp } from '../utils/math.js';

const GRADIENT_PALETTES = {
  rainbow: [
    [0.00, [255, 60, 60]],
    [0.17, [255, 160, 40]],
    [0.33, [255, 230, 50]],
    [0.50, [60, 240, 90]],
    [0.67, [40, 220, 255]],
    [0.83, [80, 90, 255]],
    [1.00, [230, 70, 255]],
  ],
  aurora: [
    [0.00, [0, 240, 200]],
    [0.35, [30, 255, 130]],
    [0.70, [150, 60, 255]],
    [1.00, [50, 110, 255]],
  ],
  cyberpunk: [
    [0.00, [255, 30, 130]],
    [0.33, [0, 240, 255]],
    [0.66, [255, 230, 0]],
    [1.00, [150, 20, 255]],
  ],
  sunset: [
    [0.00, [90, 20, 130]],
    [0.35, [230, 40, 70]],
    [0.70, [255, 140, 20]],
    [1.00, [255, 220, 70]],
  ],
  neon: [
    [0.00, [80, 255, 60]],
    [0.50, [0, 255, 240]],
    [1.00, [255, 0, 190]],
  ],
  fire: [
    [0.00, [140, 10, 0]],
    [0.33, [255, 70, 0]],
    [0.66, [255, 210, 30]],
    [1.00, [255, 255, 230]],
  ],
  ocean: [
    [0.00, [10, 30, 80]],
    [0.33, [20, 120, 230]],
    [0.66, [40, 220, 210]],
    [1.00, [190, 255, 240]],
  ],
};

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object}            config
   */
  constructor(canvas, config) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._config = config;
    this._colorCache = null;
    this._resolveColor();
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Render one frame.
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {import('./WaveManager.js').WaveManager}       wm
   * @param {import('./BurstManager.js').BurstManager}     [bm]
   */
  draw(ps, wm, bm) {
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

    // A burst moves particles without sending a front anywhere, so without a
    // ring of its own an outward burst has no visual signature at all.
    if ((cfg.debugWaves || cfg.burstVisual !== false) && bm) {
      this._drawBurstRings(bm);
    }

    // Draw Meteor Trajectory Tails first so heads render cleanly on top
    const trailLen = Math.max(0, Number(cfg.trailLength ?? 0));
    if (trailLen > 0 && cfg.trailEnabled !== false) {
      this._drawTrails(ps, trailLen);
    }

    // Draw particle star heads
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
    if ('particleColor' in partial || 'colorMode' in partial) this._resolveColor();
  }

  destroy() {}

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _resolveColor() {
    const c = this._config.particleColor;
    if (typeof c === 'string' && c.startsWith('#')) {
      this._colorCache = hexToRgb(c);
    } else {
      this._colorCache = null;
    }
  }

  _sampleGradient(paletteName, t) {
    const stops = GRADIENT_PALETTES[paletteName] || GRADIENT_PALETTES.rainbow;
    const clampedT = clamp(t, 0, 1);

    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (clampedT >= t0 && clampedT <= t1) {
        const span = t1 - t0 || 1e-5;
        const factor = (clampedT - t0) / span;
        return {
          r: Math.round(c0[0] + factor * (c1[0] - c0[0])),
          g: Math.round(c0[1] + factor * (c1[1] - c0[1])),
          b: Math.round(c0[2] + factor * (c1[2] - c0[2])),
        };
      }
    }
    const last = stops[stops.length - 1][1];
    return { r: last[0], g: last[1], b: last[2] };
  }

  _getParticleColor(ps, i) {
    const cfg = this._config;
    const mode = cfg.colorMode || 'single';

    if (mode === 'source' && ps.hasSourceColors) {
      return { r: ps.cr[i], g: ps.cg[i], b: ps.cb[i] };
    }

    if (mode === 'gradient') {
      const palette = cfg.colorPalette || 'rainbow';
      const mapping = cfg.colorMapping || 'weight';
      let t = 0.5;

      if (mapping === 'weight') {
        t = ps.wt[i];
      } else if (mapping === 'position_x') {
        t = clamp(ps.px[i] / (this._canvas.width || 1), 0, 1);
      } else if (mapping === 'position_y') {
        t = clamp(ps.py[i] / (this._canvas.height || 1), 0, 1);
      } else if (mapping === 'radial') {
        const dx = ps.px[i] - ps.cx;
        const dy = ps.py[i] - ps.cy;
        const maxR = Math.max(1, Math.min(this._canvas.width, this._canvas.height) * 0.45);
        t = clamp(Math.hypot(dx, dy) / maxR, 0, 1);
      } else if (mapping === 'velocity') {
        const speed = Math.hypot(ps.vx[i], ps.vy[i]);
        t = clamp(speed / 120, 0, 1);
      }
      return this._sampleGradient(palette, t);
    }

    if (this._colorCache !== null) {
      return this._colorCache;
    }
    if (typeof cfg.particleColor === 'function') {
      return hexToRgb(cfg.particleColor(ps.wt[i])) || { r: 255, g: 255, b: 255 };
    }
    return { r: 255, g: 255, b: 255 };
  }

  _drawTrails(ps, trailLen) {
    const ctx = this._ctx;
    const cfg = this._config;
    const N = ps.N;
    const maxT = ps.maxTrail;
    const steps = Math.min(trailLen, maxT - 1);
    const head = ps.trailHead;
    const trailWidth = Math.max(0.2, Number(cfg.trailWidth ?? 1.0));
    const disappearSpeed = Math.max(0.1, Number(cfg.trailDisappearSpeed ?? cfg.trailDecay ?? 0.65));
    const trailOpacity = Math.max(0, Math.min(1, Number(cfg.trailOpacity ?? 0.6)));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < N; i++) {
      const baseIdx = i * maxT;
      const curX = ps.px[i];
      const curY = ps.py[i];
      const prevX = ps.hx[baseIdx + ((head - 1 + maxT) % maxT)];
      const prevY = ps.hy[baseIdx + ((head - 1 + maxT) % maxT)];
      const moveDistSq = (curX - prevX) ** 2 + (curY - prevY) ** 2;

      if (moveDistSq < 0.04 && Math.hypot(ps.vx[i], ps.vy[i]) < 0.5) continue;

      const rgb = this._getParticleColor(ps, i);
      const headRadius = ps.sz[i];

      let lastX = curX;
      let lastY = curY;

      for (let s = 1; s <= steps; s++) {
        const histIdx = baseIdx + ((head - s + maxT) % maxT);
        const hx = ps.hx[histIdx];
        const hy = ps.hy[histIdx];

        const segDistSq = (lastX - hx) ** 2 + (lastY - hy) ** 2;
        if (segDistSq > 1600) {
          break;
        }

        const progress = s / steps;
        const segAlpha = clamp((1 - progress * disappearSpeed) * trailOpacity * cfg.particleOpacity, 0, 1);
        if (segAlpha <= 0.01) break;

        const segWidth = Math.max(0.3, (1 - progress * 0.75) * headRadius * 0.8 * trailWidth);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${segAlpha.toFixed(3)})`;
        ctx.lineWidth = segWidth;
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        lastX = hx;
        lastY = hy;
      }
    }

    ctx.restore();
  }

  _drawParticles(ps) {
    const ctx = this._ctx;
    const cfg = this._config;
    const N = ps.N;
    const baseOpacity = cfg.particleOpacity;
    const opacityWeight = cfg.particleOpacityWeight;
    const shape = cfg.particleShape || 'circle';
    const isNoFill = shape === 'nofill_circle' || shape === 'ring';
    const strokeWidth = Math.max(1, Number(cfg.particleStrokeWidth ?? 1.2));
    const mode = cfg.colorMode || 'single';

    if (isNoFill) {
      ctx.lineWidth = strokeWidth;
    }

    const hasZDepth = ps.pz && ps.pz.some ? ps.pz.some((z) => z !== 0) : false;
    if (mode === 'single' && this._colorCache !== null && opacityWeight === 0 && !hasZDepth) {
      const colorStr = rgbaToCss(this._colorCache, baseOpacity);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        this._drawShape(ctx, shape, ps.px[i], ps.py[i], ps.sz[i]);
      }
      if (isNoFill) {
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      } else {
        ctx.fillStyle = colorStr;
        ctx.fill();
      }
      return;
    }

    for (let i = 0; i < N; i++) {
      const w = ps.wt[i];
      let opacity = clamp(baseOpacity + (opacityWeight - 1) * baseOpacity * (1 - w), 0, 1);

      let r = ps.sz[i];
      if (ps.pz && ps.pz[i] !== 0) {
        const z = ps.pz[i];
        r = Math.max(0.4, r * (1 + z / 400));
        opacity = clamp(opacity * (1 + z / 500), 0.12, 1.0);
      }

      const rgb = this._getParticleColor(ps, i);
      const colorStr = rgbaToCss(rgb, opacity);

      ctx.beginPath();
      this._drawShape(ctx, shape, ps.px[i], ps.py[i], r);
      if (isNoFill) {
        ctx.strokeStyle = colorStr;
        ctx.stroke();
      } else {
        ctx.fillStyle = colorStr;
        ctx.fill();
      }
    }
  }

  _drawShape(ctx, shape, x, y, r) {
    switch (shape) {
      case 'nofill_circle':
      case 'ring':
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
        break;

      case 'triangle':
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.8660254, y + r * 0.5);
        ctx.lineTo(x - r * 0.8660254, y + r * 0.5);
        ctx.closePath();
        break;

      case 'square':
        ctx.rect(x - r, y - r, r * 2, r * 2);
        break;

      case 'hexagon':
      case 'hexacton':
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const px = x + r * Math.cos(a);
          const py = y + r * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;

      case 'octagon':
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4 + Math.PI / 8;
          const px = x + r * Math.cos(a);
          const py = y + r * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;

      case 'circle':
      default:
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
        break;
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
        Math.min(0.65, Math.abs(packet.amplitude) * 0.55) * opacityScale
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

  /**
   * Draw the extent of each live burst: an outward burst sweeps its ring from
   * the guard out to the rim, an inward burst sweeps it the other way, so the
   * two directions are told apart at a glance.
   * @param {import('./BurstManager.js').BurstManager} bm
   */
  _drawBurstRings(bm) {
    if (bm.activeCount === 0) return;

    const ctx = this._ctx;
    const cfg = this._config;
    const opacityScale = Math.max(0, Math.min(1, Number(cfg.clickWaveVisualOpacity ?? 0.45)));

    for (const packet of bm.active) {
      if (!packet.alive) continue;

      const envelope = Math.max(0, Math.min(1, packet.envelope));
      const span = Math.max(0, packet.radius - packet.stopRadius);
      // envelope runs 1 -> 0 over the burst's life, so `progress` runs 0 -> 1.
      // While the button is held the envelope is pinned at 1, so the ring marks
      // the standing extent of the field instead of sweeping.
      const progress = 1 - envelope;
      const ringRadius = packet.sustained
        ? packet.radius
        : packet.sign > 0
          ? packet.stopRadius + span * progress
          : packet.radius - span * progress;

      const alpha = Math.max(0.04, Math.min(0.6, envelope * 0.7) * opacityScale);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = packet.sign > 0 ? 2.4 * envelope + 0.6 : 1.8 * envelope + 0.6;
      ctx.beginPath();
      ctx.arc(packet.cx, packet.cy, Math.max(1, ringRadius), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
