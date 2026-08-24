/**
 * @file InteractionLayer.js
 * @description Captures mouse and touch events on the canvas and translates them
 * into physics forces (mouse proximity) and click actions. Hover forces are
 * written directly into the ParticleSystem force buffers; click actions are
 * handed to WaveManager (travelling wave fronts) or BurstManager (stationary
 * radial fields) depending on the configured mode.
 */

import { dist, easeOutQuad } from '../utils/math.js';

export class InteractionLayer {
  /**
   * @param {HTMLCanvasElement}                            canvas
   * @param {import('./ParticleSystem.js').ParticleSystem} ps
   * @param {import('./WaveManager.js').WaveManager}       wm
   * @param {Object}                                       config
   * @param {(detail: Object) => void}                     dispatchEvent
   * @param {import('../core/BurstManager.js').BurstManager} bm
   */
  constructor(canvas, ps, wm, config, dispatchEvent, bm) {
    this._canvas = canvas;
    this._ps = ps;
    this._wm = wm;
    this._bm = bm;
    this._config = config;
    this._dispatch = dispatchEvent;

    // Mouse state
    this._mouseX = -9999;
    this._mouseY = -9999;
    this._mouseInside = false;
    this._isMouseDown = false;
    this._mouseDownButton = 0;
    this._lastHeldWaveTime = 0;

    // Bound handlers
    this._onMouseMove  = this._handleMouseMove.bind(this);
    this._onMouseLeave = this._handleMouseLeave.bind(this);
    this._onMouseEnter = this._handleMouseEnter.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onTouchMove  = this._handleTouchMove.bind(this);
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);

    this._attach();
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Apply mouse proximity forces & continuous hold actions each frame.
   * Called from the main loop before physics integration.
   */
  poll() {
    const cfg = this._config;
    const ps = this._ps;

    if (!cfg.mouseEnabled || !this._mouseInside) {
      ps.cursorActive = false;
      return;
    }

    const { mouseX: mx, mouseY: my } = this._canvasCoords(this._mouseX, this._mouseY);
    const r = cfg.interactionRadius;
    const strengthMultiplier = cfg.mouseStrengthMultiplier ?? 3.0;
    /*
     * A burst and the hover field occupy the same patch of canvas, so a repel
     * burst under a repel cursor lands on particles the cursor has already
     * pushed to their limit and reads as nothing happening. Standing the hover
     * field down while a burst is live is what makes the click its own event.
     */
    const hoverScale = this._bm ? this._bm.hoverAttenuation() : 1;
    const strength = cfg.mouseStrength * strengthMultiplier * hoverScale;
    const mode = cfg.mouseMode;

    ps.cursorActive = true;
    ps.cursorX = mx;
    ps.cursorY = my;
    ps.cursorRadius = r;

    // [1] Continuous Hover Force
    if (mode !== 'none' && strength !== 0) {
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
            // Tangent: perpendicular to radial direction
            ps.fx[i] += -dirY * force;
            ps.fy[i] +=  dirX * force;
            break;
          }
          default:
            break;
        }
      }
    }

    // [2] Continuous Mouse Hold Actions (constant pressure effect)
    if (this._isMouseDown && cfg.waveEnabled !== false) {
      this._pollHeldAction({ x: mx, y: my });
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
    c.removeEventListener('mousemove',  this._onMouseMove);
    c.removeEventListener('mouseleave', this._onMouseLeave);
    c.removeEventListener('mouseenter', this._onMouseEnter);
    c.removeEventListener('contextmenu', this._onContextMenu);
    c.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    c.removeEventListener('touchmove',  this._onTouchMove);
    c.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchend', this._onTouchEnd);
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
    c.addEventListener('mousemove',  this._onMouseMove,  { passive: true });
    c.addEventListener('mouseleave', this._onMouseLeave, { passive: true });
    c.addEventListener('mouseenter', this._onMouseEnter, { passive: true });
    c.addEventListener('mousedown', this._onMouseDown);
    c.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('mouseup', this._onMouseUp);

    if (this._config.touchEnabled) {
      c.addEventListener('touchmove',  this._onTouchMove,  { passive: true });
      c.addEventListener('touchstart', this._onTouchStart);
      window.addEventListener('touchend', this._onTouchEnd);
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
    this._isMouseDown = false;
    this._bm?.releaseSustained();
    if (this._ps) this._ps.cursorActive = false;
  }

  _handleMouseDown(e) {
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
    this._mouseInside = true;
    this._isMouseDown = true;
    this._mouseDownButton = e.button;

    if (!this._config.waveEnabled) return;
    const pos = this._canvasCoords(e.clientX, e.clientY);
    const { mode, rawAmp, burstStrength } = this._getButtonConfig(e.button);
    if (e.button === 2 || e.button === 1) e.preventDefault();

    this._lastHeldWaveTime = performance.now();
    this._executeClickAction(mode, pos, rawAmp, burstStrength);
  }

  _handleMouseUp() {
    this._isMouseDown = false;
    this._bm?.releaseSustained();
  }

  _getButtonConfig(button) {
    const cfg = this._config;
    if (button === 0) {
      return {
        mode: cfg.leftClickMode ?? 'outward_wave',
        rawAmp: cfg.leftClickWaveAmplitude ?? 1.35,
        burstStrength: cfg.leftClickBurstStrength ?? 350,
      };
    }
    if (button === 2) {
      return {
        mode: cfg.rightClickMode ?? 'inward_wave',
        rawAmp: cfg.rightClickWaveAmplitude ?? 1.35,
        burstStrength: cfg.rightClickBurstStrength ?? 350,
      };
    }
    if (button === 1) {
      return {
        mode: cfg.middleClickMode ?? 'attract_burst',
        rawAmp: cfg.middleClickWaveAmplitude ?? 1.35,
        burstStrength: cfg.middleClickBurstStrength ?? 350,
      };
    }
    return { mode: 'none', rawAmp: 1.0, burstStrength: 0 };
  }

  /** Radial sign for a burst mode, or 0 if the mode is not a burst. */
  static _burstSign(mode) {
    if (mode === 'repel_burst') return 1;
    if (mode === 'attract_burst') return -1;
    return 0;
  }

  _pollHeldAction(pos) {
    const { mode, rawAmp, burstStrength } = this._getButtonConfig(this._mouseDownButton);
    if (mode === 'none') return;

    const sign = InteractionLayer._burstSign(mode);
    if (sign !== 0) {
      // Holding keeps one burst alive and dragging it with the cursor, rather
      // than stacking a fresh field every frame.
      this._bm?.sustain(pos, sign, burstStrength);
      return;
    }

    const now = performance.now();
    const holdInterval = Math.max(80, Number(this._config.continuousWaveInterval ?? 130));

    if (now - this._lastHeldWaveTime >= holdInterval) {
      this._lastHeldWaveTime = now;
      const amp = this._normalizeClickAmplitude(rawAmp) * 0.85;
      this._wm.spawnWave(pos, mode === 'outward_wave' ? amp : -amp);
    }
  }

  _executeClickAction(mode, pos, rawAmp, burstStrength) {
    const sign = InteractionLayer._burstSign(mode);
    if (sign !== 0) {
      /*
       * Press opens the field and release starts its decay, so a tap and a hold
       * are the same gesture at two durations rather than two code paths.
       */
      this._bm?.sustain(pos, sign, burstStrength);
      this._dispatch({ type: 'pw:click', detail: { mode, pos, burstStrength } });
      return;
    }

    switch (mode) {
      case 'outward_wave': {
        const amp = this._normalizeClickAmplitude(rawAmp);
        this._wm.spawnWave(pos, amp);
        this._dispatch({ type: 'pw:click', detail: { mode, pos, amplitude: amp } });
        break;
      }
      case 'inward_wave': {
        const amp = this._normalizeClickAmplitude(rawAmp);
        this._wm.spawnWave(pos, -amp);
        this._dispatch({ type: 'pw:click', detail: { mode, pos, amplitude: -amp } });
        break;
      }
      case 'none':
      default:
        break;
    }
  }

  _normalizeClickAmplitude(rawAmplitude) {
    const value = Math.max(0.1, Math.abs(Number(rawAmplitude || 1.35)));
    const maxAmp = Math.max(0.5, Number(this._config.maxClickAmplitude ?? 10));
    return Math.min(maxAmp, value);
  }

  _handleContextMenu(e) {
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
    this._mouseX = t.clientX;
    this._mouseY = t.clientY;
    this._mouseInside = true;
    this._isMouseDown = true;
    this._mouseDownButton = 0;

    const pos = this._canvasCoords(t.clientX, t.clientY);
    const mode = this._config.leftClickMode ?? 'outward_wave';
    const rawAmp = this._config.leftClickWaveAmplitude ?? 1.35;
    const burstStr = this._config.leftClickBurstStrength ?? 350;
    this._lastHeldWaveTime = performance.now();
    this._executeClickAction(mode, pos, rawAmp, burstStr);
  }

  _handleTouchEnd() {
    this._isMouseDown = false;
    this._bm?.releaseSustained();
  }

  /**
   * Convert page (clientX/Y) or already-canvas coordinates to canvas-local px.
   * @param {number}  x
   * @param {number}  y
   * @param {boolean} [alreadyCanvas=false]
   * @returns {{ mouseX: number, mouseY: number } | { x: number, y: number }}
   */
  _canvasCoords(x, y, alreadyCanvas = false) {
    if (alreadyCanvas) return { x, y };
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width  / rect.width;
    const scaleY = this._canvas.height / rect.height;
    return {
      x:      (x - rect.left) * scaleX,
      y:      (y - rect.top)  * scaleY,
      mouseX: (x - rect.left) * scaleX,
      mouseY: (y - rect.top)  * scaleY,
    };
  }
}
