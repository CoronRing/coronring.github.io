/**
 * @file particle-wave.js
 * @module ParticleWave
 * @description Public entry point for the Particle Wave module.
 *
 * Usage (ESM):
 *   import ParticleWave from './particle-wave.js';
 *   const pw = await ParticleWave.init(canvas, { src: './logo.pwcloud' });
 *
 * Usage (script tag):
 *   <script type="module">
 *     import ParticleWave from '/particle-wave.js';
 *     ParticleWave.init(document.getElementById('pw'), { src: '/logo.pwcloud' });
 *   </script>
 */

import { Loader } from './core/Loader.js';
import { ParticleSystem } from './core/ParticleSystem.js';
import { PhysicsEngine } from './core/PhysicsEngine.js';
import { WaveManager } from './core/WaveManager.js';
import { Renderer } from './core/Renderer.js';
import { InteractionLayer } from './interaction/InteractionLayer.js';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Data
  src: null,

  // Layout
  padding: 0.05,
  scaleMode: 'fit', // 'fit' | 'fill' | 'stretch'

  // Particle appearance
  particleSize: 2.0,
  particleSizeWeight: 0.8,
  particleColor: '#ffffff',
  particleOpacity: 0.85,
  particleOpacityWeight: 0.6,

  // Physics
  springK: 3.2,
  damping: 7.5,
  maxForce: 1800,
  maxDisplacement: 160,
  mass: 1.0,

  // Mouse interaction
  mouseEnabled: true,
  mouseMode: 'repel', // 'repel' | 'attract' | 'orbit' | 'none'
  mouseStrength: 60,
  interactionRadius: 120,
  leftClickWaveAmplitude: 1.35,
  rightClickWaveAmplitude: 1.35,
  clickAmplitudeScale: 100,
  maxClickAmplitude: 8,
  inwardPullRadius: 220,
  inwardStopRadius: 20,
  inwardDistanceBoost: 1.0,
  inwardDistanceExponent: 1.2,
  inwardCenterGuardRadius: 20,
  touchEnabled: false,

  // Wave
  waveEnabled: true,
  waveSpeed: 350,
  waveStrength: 120,
  waveStrengthOut: 120,
  waveStrengthIn: 180,
  waveDecay: 1.8,
  waveWidth: 30,
  waveMinAmplitude: 0.01,
  rippleCount: 2,
  rippleInterval: 80,
  rippleDecay: 0.55,
  maxConcurrentWaves: 16,

  // Renderer
  renderer: 'canvas2d',
  backgroundColor: 'transparent',
  targetFPS: 60,
  clickWaveVisual: true,
  clickWaveVisualMaxRadius: 160,
  clickWaveVisualOpacity: 0.45,
  clickWaveVisualShowRipples: false,
  debugWaves: false,

  // Internal (set by the Instance after canvas is known)
  _canvasW: 0,
  _canvasH: 0,
};

// ---------------------------------------------------------------------------
// ParticleWaveInstance
// ---------------------------------------------------------------------------

class ParticleWaveInstance {
  /**
   * Do not construct directly — use ParticleWave.init().
   * @param {HTMLCanvasElement}                            canvas
   * @param {Object}                                       config
   * @param {import('./core/Loader.js').ParsedCloud}       cloud
   */
  constructor(canvas, config, cloud) {
    this._canvas = canvas;
    this._config = config;
    this._cloud = cloud;
    this._rafId = null;
    this._paused = false;
    this._lastTs = null;
    this._frameMs = 1000 / config.targetFPS;
    this._accMs = 0;

    config._canvasW = canvas.width;
    config._canvasH = canvas.height;

    // Sub-systems
    this._ps = new ParticleSystem(cloud, config, canvas.width, canvas.height);
    this._pe = new PhysicsEngine(this._ps, config);
    this._wm = new WaveManager(this._ps, config, (e) => this._emitEvent(e));
    const RendererClass = typeof config.renderer === 'function' ? config.renderer : Renderer;
    this._rend = new RendererClass(canvas, config);
    this._il = new InteractionLayer(canvas, this._ps, this._wm, config, (e) => this._emitEvent(e));

    // Resize observer
    this._ro = new ResizeObserver(() => this._handleResize());
    this._ro.observe(canvas);

    this._emitEvent({ type: 'pw:ready', detail: { count: cloud.N } });
    this._scheduleFrame();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Hot-update any configuration value.
   * @param {Partial<typeof DEFAULTS>} partial
   */
  setConfig(partial) {
    Object.assign(this._config, partial);
    this._ps.updateConfig(partial);
    this._pe.updateConfig(partial);
    this._wm.updateConfig(partial);
    this._rend.updateConfig(partial);
    this._il.updateConfig(partial);
    if ('targetFPS' in partial) {
      this._frameMs = 1000 / this._config.targetFPS;
    }
  }

  /**
   * Change the mouse interaction mode.
   * @param {'repel'|'attract'|'orbit'|'none'} mode
   */
  setMode(mode) {
    this._config.mouseMode = mode;
    this._il.setMode(mode);
  }

  /**
   * Programmatically emit a wave from a canvas-coordinate origin.
   * @param {{ x: number, y: number }} origin  — canvas pixels
   */
  triggerWave(origin) {
    this._wm.spawnWave(origin);
  }

  /**
   * Register a custom force.
   * @param {{ apply(ps, dt): void }} force
   */
  addForce(force) {
    this._pe.addForce(force);
  }

  /** Remove a custom force. */
  removeForce(force) {
    this._pe.removeForce(force);
  }

  /** Pause the render loop. */
  pause() {
    this._paused = true;
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Resume the render loop. */
  resume() {
    if (!this._paused) return;
    this._paused = false;
    this._lastTs = null;
    this._scheduleFrame();
  }

  /** Capture the current canvas content. */
  snapshot() {
    return this._canvas
      .getContext('2d')
      .getImageData(0, 0, this._canvas.width, this._canvas.height);
  }

  /** Fully tear down the instance — removes listeners, cancels animation. */
  destroy() {
    this.pause();
    this._il.destroy();
    this._wm.clear();
    this._rend.destroy();
    this._ro.disconnect();
  }

  /** Runtime statistics. */
  get stats() {
    return {
      fps: this._lastFps ?? 0,
      particleCount: this._ps.N,
      activeWaves: this._wm.activeWaves,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _scheduleFrame() {
    if (this._paused) return;
    this._rafId = requestAnimationFrame((ts) => this._tick(ts));
  }

  _tick(ts) {
    if (this._lastTs == null) this._lastTs = ts;
    let dt = ts - this._lastTs;
    this._lastTs = ts;

    // FPS tracking
    this._lastFps = dt > 0 ? Math.round(1000 / dt) : 0;

    // Cap dt to prevent spiral-of-death on tab focus restore
    dt = Math.min(dt, 50);

    // FPS throttle: accumulate and only step when enough time has passed
    this._accMs += dt;
    if (this._accMs >= this._frameMs) {
      const stepDt = this._accMs;
      this._accMs = 0;

      this._ps.clearForces();
      this._il.poll();
      this._wm.advance(stepDt);
      this._pe.integrate(stepDt);
      this._wm.enforceInwardGuards();
      this._rend.draw(this._ps, this._wm);
    }

    this._scheduleFrame();
  }

  _handleResize() {
    const { width, height } = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    if (w === this._canvas.width && h === this._canvas.height) return;

    this._canvas.width = w;
    this._canvas.height = h;
    this._config._canvasW = w;
    this._config._canvasH = h;
    this._ps.resize(w, h, this._cloud);
    this._rend.resize(w, h);
  }

  _emitEvent({ type, detail }) {
    const event = new CustomEvent(type, { detail, bubbles: false });
    this._canvas.dispatchEvent(event);
  }
}

// ---------------------------------------------------------------------------
// ParticleWave — static factory
// ---------------------------------------------------------------------------

const ParticleWave = {
  /**
   * Initialise a new Particle Wave instance.
   * @param {HTMLCanvasElement}                canvas
   * @param {Partial<typeof DEFAULTS>}         userConfig
   * @returns {Promise<ParticleWaveInstance>}
   */
  async init(canvas, userConfig = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('[ParticleWave] First argument must be an HTMLCanvasElement');
    }
    const config = Object.assign({}, DEFAULTS, userConfig);

    const src = config.src ?? userConfig.src;
    if (!src) throw new Error('[ParticleWave] config.src is required');

    // Size canvas to match CSS layout (once) before building the system
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width === 0) canvas.width = Math.round(rect.width * dpr);
    if (canvas.height === 0) canvas.height = Math.round(rect.height * dpr);

    const cloud = await Loader.load(src);
    return new ParticleWaveInstance(canvas, config, cloud);
  },

  /** Expose default config so host apps can inspect and extend it. */
  DEFAULTS,
};

export default ParticleWave;

// Named export for convenience
export { ParticleWaveInstance };
