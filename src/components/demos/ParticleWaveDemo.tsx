import { useCallback, useEffect, useId, useRef, useState } from 'react';
import ParticleWave, {
  type ParticleWaveConfig,
  type ParticleWaveInstance,
} from '@npmring/particle-wave';
import { imageToCloud, type PwCloud } from '../../lib/image-to-cloud';
import { API_BASE, convertViaApi } from '../../lib/particle-wave-api';
import { href } from '../../lib/url';
import type { DemoProps } from './registry';

/**
 * ParticleWaveDemo — the engine itself, driveable.
 *
 * This is the real thing rather than a recording: the same published engine
 * that renders the hero, wired to live controls so the parameters can be felt
 * instead of described.
 *
 * ## Two tracers, one contract
 *
 * An upload is sent to the ParticleWave Python service, which runs the real
 * extractor and returns a `.pwcloud`. If that service is unreachable — it is a
 * free-tier host, and this page must not depend on it — the image is traced in
 * the tab instead by a cut-down port of the same idea. The renderer cannot tell
 * the two apart, because they emit the identical format; the readout names
 * whichever ran, since the quality difference is the interesting part.
 *
 * ## Why the instance is rebuilt on a cloud change
 *
 * Particle count is fixed at construction (the SoA buffers are sized to it),
 * so a new cloud means a new `ParticleSystem`. Everything else is hot — the
 * sliders all go through `setConfig` on the running instance.
 */

interface Params {
  restSpin: number;
  spinAxis: 'clock' | 'z';
  spinMaxDegree: number;
  driftAmplitude: number;
  waveStrength: number;
  waveSpeed: number;
  springK: number;
  damping: number;
  particleSize: number;
  particleShape: 'circle' | 'nofill_circle' | 'triangle' | 'square' | 'hexagon' | 'octagon';
  colorMode: 'single' | 'source' | 'gradient' | 'palette';
  colorPalette: 'rainbow' | 'aurora' | 'cyberpunk' | 'sunset' | 'neon' | 'fire' | 'ocean';
  gradientTopLeft: string;
  gradientTopRight: string;
  gradientBottomLeft: string;
  gradientBottomRight: string;
  gradientCenter: string;
  gradientCenterStrength: number;
  trailLength: number;
  trailWidth: number;
  trailDisappearSpeed: number;
  mouseMode: 'repel' | 'attract' | 'orbit' | 'none';
  mouseStrength: number;
  interactionRadius: number;
  leftClickMode: 'outward_wave' | 'inward_wave' | 'attract_burst' | 'repel_burst' | 'none';
  rightClickMode: 'inward_wave' | 'outward_wave' | 'attract_burst' | 'repel_burst' | 'none';
  burstStrength: number;
  burstRadiusScale: number;
}

/**
 * Map the panel's flat parameter set onto engine config keys.
 *
 * Most sliders are named after the engine field they drive, but the burst
 * controls are deliberately not: the panel offers one strength and one radius
 * for both buttons, where the engine keeps a separate value per button.
 */
function toEngineConfig(p: Params): Partial<ParticleWaveConfig> {
  const { burstStrength, ...rest } = p;
  return {
    ...rest,
    leftClickBurstStrength: burstStrength,
    rightClickBurstStrength: burstStrength,
  };
}

const DEFAULT_PARAMS: Params = {
  // Spin off by default. A cloud that is already turning makes every other
  // parameter harder to judge, and it is one click away for anyone who wants it.
  restSpin: 0,
  spinAxis: 'clock',
  spinMaxDegree: 360,
  driftAmplitude: 8,
  waveStrength: 140,
  waveSpeed: 360,
  springK: 2.6,
  damping: 4.2,
  particleSize: 2,
  particleShape: 'circle',
  colorMode: 'single',
  colorPalette: 'rainbow',
  gradientTopLeft: '#ff8a5c',
  gradientTopRight: '#7b93ff',
  gradientBottomLeft: '#ffd166',
  gradientBottomRight: '#3ddad7',
  gradientCenter: '#ffffff',
  gradientCenterStrength: 0.55,
  trailLength: 0,
  trailWidth: 1.0,
  trailDisappearSpeed: 0.65,
  mouseMode: 'repel',
  mouseStrength: 60,
  interactionRadius: 120,
  leftClickMode: 'outward_wave',
  rightClickMode: 'inward_wave',
  burstStrength: 350,
  burstRadiusScale: 2.4,
};

type SliderKey =
  | 'restSpin'
  | 'spinMaxDegree'
  | 'driftAmplitude'
  | 'mouseStrength'
  | 'interactionRadius'
  | 'burstStrength'
  | 'burstRadiusScale'
  | 'waveStrength'
  | 'waveSpeed'
  | 'springK'
  | 'damping'
  | 'particleSize'
  | 'trailLength'
  | 'trailWidth'
  | 'trailDisappearSpeed'
  | 'gradientCenterStrength';

/** Sliders, declared as data so the panel stays structured and maintainable. */
const SLIDERS: ReadonlyArray<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Rendered next to the value; the units are not otherwise guessable. */
  unit?: string;
  hint: string;
}> = [
  {
    key: 'restSpin',
    label: 'Spin',
    min: 0,
    max: 1.5,
    step: 0.01,
    unit: 'rad/s',
    hint: 'Rigid rotation speed of the whole cloud.',
  },
  {
    key: 'spinMaxDegree',
    label: 'Spin Max Degree',
    min: 0,
    max: 360,
    step: 5,
    unit: '°',
    hint: '360°/0° for full continuous circle; <360° (e.g. 180°) bounces back.',
  },
  {
    key: 'driftAmplitude',
    label: 'Drift',
    min: 0,
    max: 50,
    step: 1,
    unit: 'px',
    hint: 'How far each particle wanders from its place.',
  },
  {
    key: 'mouseStrength',
    label: 'Mouse strength',
    min: 0,
    max: 1000,
    step: 10,
    hint: 'Force applied to particles under the cursor.',
  },
  {
    key: 'interactionRadius',
    label: 'Cursor radius',
    min: 20,
    max: 500,
    step: 10,
    unit: 'px',
    hint: 'Radius within which particles respond to the cursor.',
  },
  {
    key: 'burstStrength',
    label: 'Burst strength',
    min: 0,
    max: 1200,
    step: 25,
    hint: 'Force a burst click applies. Unlike a wave, it acts on everything inside its radius at once.',
  },
  {
    key: 'burstRadiusScale',
    label: 'Burst radius',
    min: 1,
    max: 5,
    step: 0.1,
    unit: '× cursor',
    hint: 'Burst reach as a multiple of the cursor radius. Above 1 it grabs particles the cursor is not already holding.',
  },
  {
    key: 'waveStrength',
    label: 'Wave strength',
    min: 0,
    max: 800,
    step: 10,
    hint: 'Displacement carried by a click wave.',
  },
  {
    key: 'waveSpeed',
    label: 'Wave speed',
    min: 60,
    max: 1000,
    step: 10,
    unit: 'px/s',
    hint: 'How fast the wavefront travels.',
  },
  {
    key: 'trailLength',
    label: 'Meteor Tail Length',
    min: 0,
    max: 16,
    step: 1,
    unit: 'steps',
    hint: '0 disables trails; 4-12 draws glowing celestial meteor/star tails.',
  },
  {
    key: 'trailWidth',
    label: 'Trail Thickness',
    min: 0.2,
    max: 3.0,
    step: 0.1,
    hint: 'Thickness multiplier for particle trajectory tails.',
  },
  {
    key: 'trailDisappearSpeed',
    label: 'Trail Fade Speed',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    hint: 'How quickly the meteor tail fades out.',
  },
  {
    key: 'gradientCenterStrength',
    label: 'Gradient center',
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'How far the center color wins in the middle of the cloud. 0 leaves the corners to blend on their own.',
  },
  {
    key: 'springK',
    label: 'Spring',
    min: 0.2,
    max: 16,
    step: 0.1,
    hint: 'Pull back to rest. Attenuates near cursor to allow smooth movement.',
  },
  {
    key: 'damping',
    label: 'Damping',
    min: 0.5,
    max: 25,
    step: 0.1,
    hint: 'Energy bleed. Low overshoots and rings.',
  },
  {
    key: 'particleSize',
    label: 'Particle size',
    min: 0.5,
    max: 8,
    step: 0.1,
    unit: 'px',
    hint: 'Base radius before saliency weighting.',
  },
];

const MOUSE_MODES: ReadonlyArray<Params['mouseMode']> = ['repel', 'attract', 'orbit', 'none'];
const COLOR_MODES: ReadonlyArray<{ value: Params['colorMode']; label: string }> = [
  { value: 'single', label: 'Single color' },
  { value: 'source', label: 'Original image' },
  { value: 'gradient', label: 'Gradient — corners' },
  { value: 'palette', label: 'Palette ramp' },
];

/** The five wells of the four-corner gradient, in the order they are shown. */
const GRADIENT_CORNERS: ReadonlyArray<{
  key: 'gradientTopLeft' | 'gradientTopRight' | 'gradientBottomLeft' | 'gradientBottomRight' | 'gradientCenter';
  label: string;
}> = [
  { key: 'gradientTopLeft', label: 'Top left' },
  { key: 'gradientTopRight', label: 'Top right' },
  { key: 'gradientCenter', label: 'Center' },
  { key: 'gradientBottomLeft', label: 'Bottom left' },
  { key: 'gradientBottomRight', label: 'Bottom right' },
];
const COLOR_PALETTES: ReadonlyArray<{ value: Params['colorPalette']; label: string }> = [
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'neon', label: 'Neon' },
  { value: 'fire', label: 'Fire' },
  { value: 'ocean', label: 'Ocean' },
];
const CLICK_MODES: ReadonlyArray<{ value: Params['leftClickMode']; label: string }> = [
  { value: 'outward_wave', label: 'Outward wave — ring travels out' },
  { value: 'inward_wave', label: 'Inward wave — ring travels in' },
  { value: 'repel_burst', label: 'Repel burst — field pushes, held' },
  { value: 'attract_burst', label: 'Attract burst — field pulls, held' },
  { value: 'none', label: 'None' },
];

/** Shared by both click-mode selects; the wave/burst split is the thing worth saying. */
const CLICK_MODE_HINT =
  'A wave is a travelling front: it leaves the click point, kicks each particle once as it ' +
  'passes, and keeps going. A burst is a standing field: it holds everything inside its ' +
  'radius for as long as the button is down, hardest at the centre.';
const PARTICLE_SHAPES: ReadonlyArray<{ value: Params['particleShape']; label: string }> = [
  { value: 'circle', label: 'Circle (Filled)' },
  { value: 'nofill_circle', label: 'Circle (Ring)' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Octagon' },
];
const SPIN_AXES: ReadonlyArray<{ value: Params['spinAxis']; label: string }> = [
  { value: 'clock', label: '2D Clockwise' },
  { value: 'z', label: '3D Z-Axis' },
];

type Source = { key: string; label: string; src: string | PwCloud };

export default function ParticleWaveDemo({ title }: DemoProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<ParticleWaveInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uid = useId();

  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [source, setSource] = useState<Source>({
    key: 'corona',
    label: 'CoronRing mark',
    src: href('/clouds/corona.pwcloud'),
  });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [readout, setReadout] = useState<{ points: number; fps: number }>({ points: 0, fps: 0 });
  /*
   * The wipe between the source image and the trace of it.
   *
   * Off by default: the demo is about the particles, and an overlay covering
   * half of them is a comparison the visitor should have to ask for. It is
   * only offered at all when the cloud carries its source, which the tool
   * embeds and the in-tab tracer now does too.
   */
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [wipe, setWipe] = useState(50);
  const [imageBox, setImageBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  /** Which tracer produced the current cloud, and what it cost. */
  const [trace, setTrace] = useState<
    { via: 'service'; ms: number } | { via: 'browser'; reason: string } | null
  >(null);

  /*
   * The init effect must not re-run when a slider moves, so it reads the
   * current params through a ref instead of listing them as dependencies.
   */
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // ── Build (and rebuild) the instance ──────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    setStatus('loading');
    setMessage('');

    void (async () => {
      try {
        const instance = await ParticleWave.init(canvas, {
          src: source.src,
          padding: 0.1,
          scaleMode: 'fit',
          particleColor: readToken('--c-particle', '#ffffff'),
          particleOpacity: Number(readToken('--particle-opacity', '0.85')),
          particleSizeWeight: 0.9,
          particleOpacityWeight: 0.8,
          touchEnabled: true,
          waveEnabled: true,
          rippleCount: 2,
          ...waveFrontConfig(),
          ...toEngineConfig(paramsRef.current),
        });

        // A cloud swap that lands after unmount would leak a live rAF loop.
        if (disposed) {
          instance.destroy();
          return;
        }

        instanceRef.current = instance;
        setStatus('ready');
        setReadout({ points: instance.stats.particleCount, fps: 0 });
        setSourceUrl(instance.sourcePreview?.url ?? null);
        setImageBox(instance.drawArea);
      } catch (err) {
        if (disposed) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'The engine failed to start.');
      }
    })();

    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [source]);

  useEffect(() => {
    if (!sourceUrl) setCompare(false);
  }, [sourceUrl]);

  /*
   * Keep the overlay on the same rectangle as the cloud.
   *
   * The engine letterboxes the cloud inside the canvas, so an image stretched
   * to the canvas instead would compare two differently-scaled pictures —
   * worse than showing no comparison at all.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !compare) return;
    const sync = (): void => {
      const area = instanceRef.current?.drawArea;
      if (area) setImageBox(area);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [compare]);

  // ── Push slider changes to the running instance ───────────────────
  useEffect(() => {
    instanceRef.current?.setConfig(toEngineConfig(params));
  }, [params]);

  // ── Pause off-screen; an invisible rAF loop is pure battery cost ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) instanceRef.current?.resume();
        else instanceRef.current?.pause();
      },
      { rootMargin: '80px' },
    );
    io.observe(canvas);
    return () => io.disconnect();
  }, []);

  // ── FPS readout, sampled rather than per-frame ────────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    const id = window.setInterval(() => {
      const s = instanceRef.current?.stats;
      if (s) setReadout({ points: s.particleCount, fps: s.fps });
    }, 500);
    return () => window.clearInterval(id);
  }, [status]);

  // ── Re-theme with the rest of the page ────────────────────────────
  useEffect(() => {
    const retheme = (): void =>
      instanceRef.current?.setConfig({
        particleColor: readToken('--c-particle', '#ffffff'),
        particleOpacity: Number(readToken('--particle-opacity', '0.85')),
        ...waveFrontConfig(),
      });
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', retheme);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', retheme);
    };
  }, []);

  const onUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be chosen twice in a row.
    event.target.value = '';
    if (!file) return;

    setStatus('loading');
    setMessage('Tracing with the Python service…');

    const apply = (cloud: PwCloud): void =>
      setSource({ key: `upload:${file.name}:${Date.now()}`, label: file.name, src: cloud });

    /*
     * Server first, browser second. The service does the better job and is the
     * half of the project worth showing; the local tracer exists so that a
     * sleeping, rate-limited, or simply absent backend degrades the demo
     * instead of breaking it. A failure here is expected often enough that it
     * is reported as provenance rather than as an error.
     */
    try {
      /*
       * Measured on the deployed host, not guessed. The point cap — not the
       * radius — is what a visitor waits on, and after the sampler was given a
       * coarse acceleration grid the curve moved enough to change the answer:
       * 2,500 points went from 2.2 s to 0.5 s, and 3,500 from 5.8 s to 1.2 s.
       * 3,500 is now the denser cloud the canvas can show while still landing
       * inside the couple of seconds a visitor will wait.
       */
      const { cloud, meta } = await convertViaApi(file, {
        target_points: 3500,
        min_radius: 1.8,
      });
      apply(cloud);
      setTrace({ via: 'service', ms: meta.elapsed_ms });
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unreachable';
      setMessage('Service unavailable, tracing in this tab…');
      try {
        apply(await imageToCloud(file, { targetPoints: 6000 }));
        setTrace({ via: 'browser', reason });
      } catch (localErr) {
        setStatus('error');
        setTrace(null);
        setMessage(localErr instanceof Error ? localErr.message : 'Could not read that image.');
      }
    }
  }, []);

  return (
    <div className="space-y-4 p-4">
      {/* Stage */}
      <div className="relative overflow-hidden rounded-lg border border-[var(--c-line)] bg-[var(--c-sunken)]">
        <canvas
          ref={canvasRef}
          aria-label={`${title}, interactive particle canvas`}
          role="img"
          className="block h-[320px] w-full cursor-crosshair touch-none sm:h-[420px]"
        />

        {compare && sourceUrl && imageBox && (
          <>
            <div
              className="pointer-events-none absolute inset-0"
              style={{ clipPath: `inset(0 ${(100 - wipe).toFixed(2)}% 0 0)` }}
            >
              <img
                src={sourceUrl}
                alt="The original image this cloud was traced from"
                className="absolute block"
                style={{
                  left: imageBox.x,
                  top: imageBox.y,
                  width: imageBox.width,
                  height: imageBox.height,
                }}
              />
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-white/70"
              style={{ left: `${wipe.toFixed(2)}%` }}
            />
            <span className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] tracking-[0.1em] text-white/70">
              ORIGINAL
            </span>
            <span className="pointer-events-none absolute right-3 bottom-2 font-mono text-[9px] tracking-[0.1em] text-white/70">
              PARTICLES
            </span>
          </>
        )}

        <div className="pointer-events-none absolute top-2 right-3 font-mono text-[10px] text-[var(--c-text-faint)] tabular-nums">
          {readout.points.toLocaleString()} pts · {readout.fps} fps
        </div>

        {status !== 'ready' && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--c-sunken)]/80 px-6 text-center">
            <p
              className={`font-mono text-xs ${status === 'error' ? 'text-[var(--c-alert)]' : 'text-[var(--c-text-muted)]'}`}
            >
              {message || 'Starting engine…'}
            </p>
          </div>
        )}
      </div>

      {/* Compare */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`flex items-center gap-2 font-mono text-[10px] ${sourceUrl ? 'cursor-pointer text-[var(--c-text-muted)]' : 'cursor-not-allowed text-[var(--c-text-faint)]'}`}
          title={
            sourceUrl
              ? 'Wipe between the image and the cloud traced from it'
              : 'This cloud does not carry its source image'
          }
        >
          <input
            type="checkbox"
            checked={compare}
            disabled={!sourceUrl}
            onChange={(e) => setCompare(e.target.checked)}
            className="accent-[var(--c-accent)]"
          />
          Compare with original
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={wipe}
          disabled={!compare}
          aria-label="Compare wipe position"
          onChange={(e) => setWipe(Number(e.target.value))}
          className="pw-range w-full max-w-[260px] disabled:opacity-30"
        />
      </div>

      {/* Source */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">Source</span>
        <button
          type="button"
          onClick={() => {
            setTrace(null);
            setSource({
              key: 'corona',
              label: 'CoronRing mark',
              src: href('/clouds/corona.pwcloud'),
            });
          }}
          disabled={source.key === 'corona'}
          className="rounded-sm border border-[var(--c-line)] px-2.5 py-1 font-mono text-[10px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] disabled:border-[var(--c-accent)] disabled:text-[var(--c-accent)]"
        >
          CoronRing mark
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-sm border border-[var(--c-line)] px-2.5 py-1 font-mono text-[10px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
        >
          Upload image…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onUpload}
          className="sr-only"
          tabIndex={-1}
        />
        {source.key.startsWith('upload:') && (
          <span className="truncate font-mono text-[10px] text-[var(--c-text-faint)]">
            {source.label}
          </span>
        )}
        {trace !== null && (
          <span
            className="font-mono text-[10px] text-[var(--c-text-faint)]"
            title={
              trace.via === 'service'
                ? `Extracted by the particle_wave Python package at ${API_BASE}`
                : `The service could not be reached (${trace.reason}), so the image was traced in this tab with the cut-down JavaScript extractor.`
            }
          >
            {trace.via === 'service'
              ? `traced by the Python service · ${trace.ms} ms`
              : 'traced in this tab · service unavailable'}
          </span>
        )}
        <button
          type="button"
          onClick={() => setParams(DEFAULT_PARAMS)}
          className="ml-auto rounded-sm border border-transparent px-2 py-1 font-mono text-[10px] text-[var(--c-text-faint)] transition-colors hover:text-[var(--c-text)]"
        >
          Reset parameters
        </button>
      </div>

      {/* Controls */}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SLIDERS.filter(
          (s) => s.key !== 'gradientCenterStrength' || params.colorMode === 'gradient',
        ).map((s) => {
          const id = `${uid}-${s.key}`;
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="eyebrow">
                  {s.label}
                </label>
                <span className="font-mono text-[10px] text-[var(--c-text-faint)] tabular-nums">
                  {params[s.key].toFixed(s.step < 1 ? 2 : 0)}
                  {s.unit ? ` ${s.unit}` : ''}
                </span>
              </div>
              <input
                id={id}
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={params[s.key]}
                title={s.hint}
                onChange={(e) => setParams((p) => ({ ...p, [s.key]: Number(e.target.value) }))}
                className="pw-range mt-1 w-full"
              />
            </div>
          );
        })}

        <div>
          <label htmlFor={`${uid}-mode`} className="eyebrow">
            Cursor
          </label>
          <select
            id={`${uid}-mode`}
            value={params.mouseMode}
            onChange={(e) =>
              setParams((p) => ({ ...p, mouseMode: e.target.value as Params['mouseMode'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {MOUSE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-shape`} className="eyebrow">
            Particle Shape
          </label>
          <select
            id={`${uid}-shape`}
            value={params.particleShape}
            onChange={(e) =>
              setParams((p) => ({ ...p, particleShape: e.target.value as Params['particleShape'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {PARTICLE_SHAPES.map((sh) => (
              <option key={sh.value} value={sh.value}>
                {sh.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-left-click`} className="eyebrow">
            Left Click Action
          </label>
          <select
            id={`${uid}-left-click`}
            title={CLICK_MODE_HINT}
            value={params.leftClickMode}
            onChange={(e) =>
              setParams((p) => ({ ...p, leftClickMode: e.target.value as Params['leftClickMode'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {CLICK_MODES.map((cm) => (
              <option key={cm.value} value={cm.value}>
                {cm.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-right-click`} className="eyebrow">
            Right Click Action
          </label>
          <select
            id={`${uid}-right-click`}
            title={CLICK_MODE_HINT}
            value={params.rightClickMode}
            onChange={(e) =>
              setParams((p) => ({ ...p, rightClickMode: e.target.value as Params['rightClickMode'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {CLICK_MODES.map((cm) => (
              <option key={cm.value} value={cm.value}>
                {cm.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-color-mode`} className="eyebrow">
            Color Mode
          </label>
          <select
            id={`${uid}-color-mode`}
            value={params.colorMode}
            onChange={(e) =>
              setParams((p) => ({ ...p, colorMode: e.target.value as Params['colorMode'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {COLOR_MODES.map((cm) => (
              <option key={cm.value} value={cm.value}>
                {cm.label}
              </option>
            ))}
          </select>
        </div>

        {params.colorMode === 'gradient' && (
          <div className="sm:col-span-2">
            <span className="eyebrow">Corner colors</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {GRADIENT_CORNERS.map((corner) => (
                <label
                  key={corner.key}
                  className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--c-text-faint)]"
                  title={`${corner.label} of the gradient`}
                >
                  <input
                    type="color"
                    value={params[corner.key]}
                    aria-label={`${corner.label} color`}
                    onChange={(e) =>
                      setParams((prev) => ({ ...prev, [corner.key]: e.target.value }))
                    }
                    className="h-6 w-6 cursor-pointer rounded-full border border-[var(--c-line)] bg-transparent p-0"
                  />
                  {corner.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {params.colorMode === 'palette' && (
          <div>
            <label htmlFor={`${uid}-color-palette`} className="eyebrow">
              Palette
            </label>
            <select
              id={`${uid}-color-palette`}
              value={params.colorPalette}
              onChange={(e) =>
                setParams((p) => ({ ...p, colorPalette: e.target.value as Params['colorPalette'] }))
              }
              className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
            >
              {COLOR_PALETTES.map((cp) => (
                <option key={cp.value} value={cp.value}>
                  {cp.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-spin-axis`} className="eyebrow">
            Spin Axis
          </label>
          <select
            id={`${uid}-spin-axis`}
            value={params.spinAxis}
            onChange={(e) =>
              setParams((p) => ({ ...p, spinAxis: e.target.value as Params['spinAxis'] }))
            }
            className="mt-1 w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          >
            {SPIN_AXES.map((sa) => (
              <option key={sa.value} value={sa.value}>
                {sa.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-[var(--c-text-faint)]">
        Move the cursor to push the field, then click to fire the action bound to that button. A{' '}
        <strong className="font-medium text-[var(--c-text-muted)]">wave</strong> is a travelling
        front — it leaves the click point, kicks each particle once on the way past, and keeps
        going, so what you see is a ring crossing the cloud. A{' '}
        <strong className="font-medium text-[var(--c-text-muted)]">burst</strong> does not travel:
        it is a standing radial field that holds everything within its radius for as long as the
        button is down, hardest at the centre, so what you see is the cloud opening or gathering
        and then relaxing on release. An uploaded image goes to the
        ParticleWave service, which extracts the point cloud in Python and sends it back. If that
        service is unreachable, the image is traced in this tab instead, at lower quality. Nothing
        is stored either way. The cloud comes back in the response and the upload is discarded.
      </p>

      <style>{`
        .pw-range {
          -webkit-appearance: none;
          appearance: none;
          height: 2px;
          background: var(--c-line-strong);
          border-radius: 2px;
          cursor: pointer;
        }
        .pw-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--c-accent-fill);
          border: 1px solid var(--c-ground);
          cursor: grab;
        }
        .pw-range::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border: 1px solid var(--c-ground);
          border-radius: 50%;
          background: var(--c-accent-fill);
          cursor: grab;
        }
        .pw-range:focus-visible {
          outline: 2px solid var(--c-accent);
          outline-offset: 4px;
        }
      `}</style>
    </div>
  );
}

/** Current value of a CSS custom property on :root. */
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Whether the page is currently rendering dark, explicit choice or system. */
function isDarkTheme(): boolean {
  if (typeof window === 'undefined') return true;
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark') return true;
  if (chosen === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * How the travelling wave front should be drawn for the current theme.
 *
 * The front's glow is an *additive* band: it brightens whatever it crosses.
 * Over the dark theme's near-black ground that is exactly right and is what
 * makes a click read as a wave. Over the light theme's near-white ground it is
 * very nearly a no-op — adding white to white — so the front all but vanished
 * there. Light therefore gets the ink colour with the glow off, which draws the
 * core line with normal blending and is legible for the opposite reason.
 *
 * `--c-text` is used rather than the particle colour because the front is not a
 * particle: it needs to contrast with the background in either theme, which is
 * precisely what the ink token already guarantees.
 */
function waveFrontConfig(): Partial<ParticleWaveConfig> {
  const dark = isDarkTheme();
  return {
    clickWaveVisualColor: readToken('--c-text', dark ? '#f5f5f5' : '#191919'),
    clickWaveVisualGlow: dark,
  };
}
