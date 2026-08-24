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

import { Loader }           from './core/Loader.js';
import { ParticleSystem }   from './core/ParticleSystem.js';
import { PhysicsEngine }    from './core/PhysicsEngine.js';
import { WaveManager }      from './core/WaveManager.js';
import { BurstManager }     from './core/BurstManager.js';
import { Renderer }         from './core/Renderer.js';
import { InteractionLayer } from './interaction/InteractionLayer.js';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Data
  src: null,

  // Layout
  padding:    0.05,
  scaleMode: 'fit',   // 'fit' | 'fill' | 'stretch'

  // Particle appearance & color
  particleSize:          2.0,
  particleSizeWeight:    0.8,
  particleColor:        '#ffffff',
  particleOpacity:       0.85,
  particleOpacityWeight: 0.6,
  particleShape:        'circle',   // 'circle' | 'nofill_circle' | 'triangle' | 'square' | 'hexagon' | 'octagon'
  particleStrokeWidth:   1.2,
  colorMode:            'single',   // 'single' | 'source' | 'gradient'
  colorPalette:         'rainbow',  // 'rainbow' | 'aurora' | 'cyberpunk' | 'sunset' | 'neon' | 'fire' | 'ocean'
  colorMapping:         'weight',   // 'weight' | 'position_x' | 'position_y' | 'radial' | 'velocity'

  // Trajectory Trails (Meteor & Star Effect)
  trailEnabled:          true,
  trailLength:           0,         // 0 = off, 1-16 = active meteor tail steps
  trailWidth:            1.0,       // tail width scale multiplier
  trailDisappearSpeed:   0.65,      // tail decay / fade-out rate
  trailOpacity:          0.60,      // overall tail opacity multiplier

  // Physics
  springK:   3.2,
  damping:   7.5,
  maxForce:  1800,
  maxDisplacement: 160,
  mass:      1.0,
  springAttenuateNearCursor: true,
  springCursorFalloff: 0.12,

  // Ambient motion
  restSpin:        0,     // rigid rotation of the whole cloud, rad/s
  spinAxis:       'clock', // 'clock' | 'z'
  spinMaxDegree:   360,   // 360/0 = continuous full circle; <360 = oscillate & bounce back
  driftAmplitude:  0,     // per-particle wander amplitude, px (0 disables)
  driftSpeed:      0.35,  // wander rate multiplier
  spinWeightByGroup: null,

  // Mouse interaction
  mouseEnabled:      true,
  mouseMode:        'repel',   // 'repel' | 'attract' | 'orbit' | 'none'
  mouseStrength:     60,
  mouseStrengthMultiplier: 3.0,
  interactionRadius: 120,
  leftClickMode:     'outward_wave',  // 'outward_wave' | 'inward_wave' | 'attract_burst' | 'repel_burst' | 'none'
  rightClickMode:    'inward_wave',   // 'inward_wave' | 'outward_wave' | 'attract_burst' | 'repel_burst' | 'none'
  middleClickMode:   'attract_burst',
  leftClickWaveAmplitude: 1.35,
  rightClickWaveAmplitude: 1.35,
  middleClickWaveAmplitude: 1.35,
  leftClickBurstStrength: 350,
  rightClickBurstStrength: 350,
  middleClickBurstStrength: 350,

  // Burst (a stationary radial field, as opposed to a travelling wave front)
  burstRadius:        0,      // 0 = derive from interactionRadius * burstRadiusScale
  burstRadiusScale:   2.4,    // burst reaches beyond the hover halo so it is its own event
  burstStopRadius:    0,      // 0 = 16% of the burst radius; an inward burst gathers, never collapses
  burstDuration:      260,    // ms for a released burst to fade out
  burstOutwardGain:   1.75,   // an outward burst dilutes where an inward one concentrates
  burstHoverSuppression: 1.0, // 0..1 — how far the hover field stands down during a burst
  burstVisual:        true,
  maxConcurrentBursts: 8,

  continuousPressEnabled: true,
  continuousWaveInterval: 130,      // ms between continuous waves when holding mouse
  maxClickAmplitude: 10,
  inwardPullRadius: 280,
  inwardStopRadius: 16,
  inwardDistanceBoost: 1.0,
  inwardDistanceExponent: 1.2,
  inwardCenterGuardRadius: 16,
  touchEnabled:      true,

  // Wave
  waveEnabled:        true,
  waveSpeed:          380,
  waveStrength:       140,
  waveStrengthOut:    140,
  waveStrengthIn:     180,
  waveDecay:          1.8,
  waveWidth:          36,
  waveMinAmplitude:   0.01,
  rippleCount:        2,
  rippleInterval:     80,
  rippleDecay:        0.55,
  maxConcurrentWaves: 24,

  // Renderer
  renderer:        'canvas2d',
  backgroundColor: 'transparent',
  targetFPS:        60,
  clickWaveVisual:   true,
  clickWaveVisualMaxRadius: 180,
  clickWaveVisualOpacity: 0.45,
  clickWaveVisualShowRipples: false,
  debugWaves:        false,

  // Internal
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
    this._canvas  = canvas;
    this._config  = config;
    this._cloud   = cloud;
    this._rafId   = null;
    this._paused  = false;
    this._lastTs  = null;
    this._frameMs = 1000 / config.targetFPS;
    this._accMs   = 0;
    this._theta   = 0;
    this._driftT  = 0;
    this._spinDir = 1;

    config._canvasW = canvas.width;
    config._canvasH = canvas.height;

    // Sub-systems
    this._ps   = new ParticleSystem(cloud, config, canvas.width, canvas.height);
    this._pe   = new PhysicsEngine(this._ps, config);
    this._wm   = new WaveManager(this._ps, config, (e) => this._emitEvent(e));
    this._bm   = new BurstManager(this._ps, config, (e) => this._emitEvent(e));
    const RendererClass = typeof config.renderer === 'function'
      ? config.renderer
      : Renderer;
    this._rend = new RendererClass(canvas, config);
    this._il   = new InteractionLayer(
      canvas, this._ps, this._wm, config, (e) => this._emitEvent(e), this._bm
    );

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
    this._bm.updateConfig(partial);
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
   * @param {number} [amplitude]
   */
  triggerWave(origin, amplitude = 1.0) {
    this._wm.spawnWave(origin, amplitude);
  }

  /**
   * Supply per-particle RGB source colors directly (e.g. sampled from an HTMLImageElement).
   * @param {Uint8Array|Array<number>} colors — length N*3 (RGB)
   */
  setColors(colors) {
    this._ps.setSourceColors(colors);
  }

  /** Register a custom force. */
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
    return this._canvas.getContext('2d').getImageData(0, 0, this._canvas.width, this._canvas.height);
  }

  /** Fully tear down the instance. */
  destroy() {
    this.pause();
    this._il.destroy();
    this._wm.clear();
    this._bm.clear();
    this._rend.destroy();
    this._ro.disconnect();
  }

  /** Runtime statistics. */
  get stats() {
    return {
      fps:          this._lastFps ?? 0,
      particleCount: this._ps.N,
      activeWaves:  this._wm.activeWaves,
      activeBursts: this._bm.activeCount,
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

    this._lastFps = dt > 0 ? Math.round(1000 / dt) : 0;
    dt = Math.min(dt, 50);

    this._accMs += dt;
    if (this._accMs >= this._frameMs) {
      const stepDt = this._accMs;
      this._accMs = 0;

      const stepS = stepDt / 1000;
      const { restSpin, driftAmplitude, driftSpeed, spinAxis, spinMaxDegree } = this._config;
      if (restSpin !== 0 || driftAmplitude > 0) {
        const maxDeg = Number(spinMaxDegree ?? 360);
        const isBounded = maxDeg > 0 && maxDeg < 360;
        const maxRad = (maxDeg * Math.PI) / 180;

        if (isBounded && restSpin !== 0) {
          this._theta += (this._spinDir || 1) * Math.abs(restSpin) * stepS;
          if (this._theta >= maxRad) {
            this._theta = maxRad;
            this._spinDir = -1;
          } else if (this._theta <= -maxRad) {
            this._theta = -maxRad;
            this._spinDir = 1;
          }
        } else {
          this._theta += restSpin * stepS;
          if (this._theta > Math.PI * 2 || this._theta < -Math.PI * 2) {
            this._theta %= Math.PI * 2;
          }
        }
        this._driftT += stepS;
      }
      this._ps.updateRestFrame(this._theta, this._driftT, driftAmplitude, driftSpeed, spinAxis);

      this._ps.clearForces();
      this._il.poll();
      this._wm.advance(stepDt);
      this._bm.advance(stepDt);
      this._pe.integrate(stepDt);
      this._wm.enforceInwardGuards();
      this._bm.enforceGuards();
      this._ps.updateTrails();
      this._rend.draw(this._ps, this._wm, this._bm);
    }

    this._scheduleFrame();
  }

  _handleResize() {
    const { width, height } = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width  * dpr);
    const h = Math.round(height * dpr);

    if (w === this._canvas.width && h === this._canvas.height) return;

    this._canvas.width  = w;
    this._canvas.height = h;
    this._config._canvasW = w;
    this._config._canvasH = h;
    this._ps.resize(w, h, this._cloud);
    this._rend.resize(w, h);
  }

  _emitEvent(event) {
    this._canvas.dispatchEvent(
      new CustomEvent(event.type, {
        bubbles: true,
        detail:  event.detail,
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const ParticleWave = {
  /**
   * Initialise the Particle Wave runtime on a <canvas> element.
   * @param {HTMLCanvasElement} canvas
   * @param {Partial<typeof DEFAULTS>} [userConfig]
   * @returns {Promise<ParticleWaveInstance>}
   */
  async init(canvas, userConfig = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('[ParticleWave.init] First argument must be an HTMLCanvasElement');
    }

    const config = { ...DEFAULTS, ...userConfig };

    if (!config.src) {
      throw new Error('[ParticleWave.init] config.src is required');
    }

    const cloud = await Loader.load(config.src);
    return new ParticleWaveInstance(canvas, config, cloud);
  },

  DEFAULTS,
  Loader,
  ParticleSystem,
  PhysicsEngine,
  WaveManager,
  Renderer,
  InteractionLayer,
};

export default ParticleWave;
export {
  ParticleWave,
  Loader,
  ParticleSystem,
  PhysicsEngine,
  WaveManager,
  Renderer,
  InteractionLayer,
  DEFAULTS,
};
