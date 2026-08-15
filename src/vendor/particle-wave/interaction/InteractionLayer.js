/**
 * @file InteractionLayer.js
 * @description Captures mouse and touch events on the canvas and translates them
 * into physics forces (mouse proximity) and wave spawn events (click / tap).
 * Designed to be thin: it writes directly into the ParticleSystem force buffers
 * and calls WaveManager.spawnWave() — no intermediate event queue.
 */

import { dist, easeOutQuad } from '../utils/math.js';

export class InteractionLayer {
  /**
   * @param {HTMLCanvasElement}                            canvas
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {import('./WaveManager.js').WaveManager}       wm
   * @param {Object}                                       config
   * @param {(detail: Object) => void}                     dispatchEvent
   */
  constructor(canvas, ps, wm, config, dispatchEvent) {
    this._canvas = canvas;
    this._ps = ps;
    this._wm = wm;
    this._config = config;
    this._dispatch = dispatchEvent;

    // Mouse state
    this._mouseX = -9999;
    this._mouseY = -9999;
    this._mouseInside = false;

    // Bound handlers (stored for removeEventListener)
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseLeave = this._handleMouseLeave.bind(this);
    this._onMouseEnter = this._handleMouseEnter.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchStart = this._handleTouchStart.bind(this);

    this._attach();
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Apply mouse proximity forces each frame.
   * Called from the main loop before physics integration.
   */
  poll() {
    const cfg = this._config;
    if (!cfg.mouseEnabled || !this._mouseInside) return;

    const ps = this._ps;
    const { mouseX: mx, mouseY: my } = this._canvasCoords(this._mouseX, this._mouseY);
    const r = cfg.interactionRadius;
    const strength = cfg.mouseStrength;
    const mode = cfg.mouseMode;

    if (mode === 'none') return;

    for (let i = 0; i < ps.N; i++) {
      const d = dist(ps.px[i], ps.py[i], mx, my);
      if (d >= r || d < 0.001) continue;

      const t = 1 - d / r;
      const force = strength * easeOutQuad(t);
      const invD = 1 / d;
      const dirX = (ps.px[i] - mx) * invD;
      const dirY = (ps.py[i] - my) * invD;

      switch (mode) {
        case 'repel':
          ps.fx[i] += dirX * force;
          ps.fy[i] += dirY * force;
          break;
        case 'attract':
          ps.fx[i] -= dirX * force;
          ps.fy[i] -= dirY * force;
          break;
        case 'orbit': {
          // Tangent: perpendicular to radial direction (rotated 90° CCW)
          ps.fx[i] += -dirY * force;
          ps.fy[i] += dirX * force;
          break;
        }
        default:
          break;
      }
    }
  }

  /** Programmatically trigger a wave (bypasses the click handler). */
  triggerWave(origin) {
    this._wm.spawnWave(this._canvasCoords(origin.x, origin.y, true));
  }

  /** Change mouse interaction mode at runtime. */
  setMode(mode) {
    this._config.mouseMode = mode;
  }

  /** Detach all event listeners and free resources. */
  destroy() {
    const c = this._canvas;
    c.removeEventListener('mousemove', this._onMouseMove);
    c.removeEventListener('mouseleave', this._onMouseLeave);
    c.removeEventListener('mouseenter', this._onMouseEnter);
    c.removeEventListener('contextmenu', this._onContextMenu);
    c.removeEventListener('mousedown', this._onMouseDown);
    c.removeEventListener('touchmove', this._onTouchMove);
    c.removeEventListener('touchstart', this._onTouchStart);
  }

  /** Hot-update config. */
  updateConfig(partial) {
    Object.assign(this._config, partial);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _attach() {
    const c = this._canvas;
    c.addEventListener('mousemove', this._onMouseMove, { passive: true });
    c.addEventListener('mouseleave', this._onMouseLeave, { passive: true });
    c.addEventListener('mouseenter', this._onMouseEnter, { passive: true });
    c.addEventListener('mousedown', this._onMouseDown);
    c.addEventListener('contextmenu', this._onContextMenu);
    if (this._config.touchEnabled) {
      c.addEventListener('touchmove', this._onTouchMove, { passive: true });
      c.addEventListener('touchstart', this._onTouchStart);
    }
  }

  _handleMouseMove(e) {
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
    this._mouseInside = true;
  }

  _handleMouseEnter() {
    this._mouseInside = true;
  }

  _handleMouseLeave() {
    this._mouseInside = false;
  }

  _handleMouseDown(e) {
    if (!this._config.waveEnabled) return;
    const pos = this._canvasCoords(e.clientX, e.clientY);
    if (e.button === 0) {
      const amp = this._normalizeClickAmplitude(this._config.leftClickWaveAmplitude ?? 1.0);
      this._wm.spawnWave(pos, amp);
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      const amp = this._normalizeClickAmplitude(this._config.rightClickWaveAmplitude ?? 1.35);
      this._wm.spawnWave(pos, -amp);
    }
  }

  _normalizeClickAmplitude(rawAmplitude) {
    const value = Math.max(0, Math.abs(rawAmplitude));
    const scale = Math.max(1, Number(this._config.clickAmplitudeScale ?? 100));
    const maxAmp = Math.max(0.25, Number(this._config.maxClickAmplitude ?? 8));
    return Math.min(maxAmp, value / scale);
  }

  _handleContextMenu(e) {
    // Disable browser menu so right-click interaction works cleanly.
    e.preventDefault();
  }

  _handleTouchMove(e) {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    this._mouseX = t.clientX;
    this._mouseY = t.clientY;
    this._mouseInside = true;
  }

  _handleTouchStart(e) {
    if (!this._config.waveEnabled || e.touches.length === 0) return;
    const t = e.touches[0];
    const pos = this._canvasCoords(t.clientX, t.clientY);
    this._wm.spawnWave(pos);
  }

  /**
   * Convert page (clientX/Y) or already-canvas coordinates to canvas-local px.
   * @param {number}  x
   * @param {number}  y
   * @param {boolean} [alreadyCanvas=false]  — if true, skip DOMRect conversion
   * @returns {{ mouseX: number, mouseY: number } | { x: number, y: number }}
   */
  _canvasCoords(x, y, alreadyCanvas = false) {
    if (alreadyCanvas) return { x, y };
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;
    return {
      x: (x - rect.left) * scaleX,
      y: (y - rect.top) * scaleY,
      mouseX: (x - rect.left) * scaleX,
      mouseY: (y - rect.top) * scaleY,
    };
  }
}
