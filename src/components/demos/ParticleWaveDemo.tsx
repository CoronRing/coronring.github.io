import { useCallback, useEffect, useId, useRef, useState } from 'react';
import ParticleWave from '../../vendor/particle-wave/particle-wave.js';
import type { ParticleWaveInstance } from '../../vendor/particle-wave/particle-wave';
import { imageToCloud, type PwCloud } from '../../lib/image-to-cloud';
import { href } from '../../lib/url';
import type { DemoProps } from './registry';

/**
 * ParticleWaveDemo — the engine itself, driveable.
 *
 * This is the real thing rather than a recording: the same vendored engine
 * that renders the hero, wired to live controls so the parameters can be felt
 * instead of described. Upload an image and it is traced to a point cloud in
 * the browser — no upload leaves the tab.
 *
 * ## Why the instance is rebuilt on a cloud change
 *
 * Particle count is fixed at construction (the SoA buffers are sized to it),
 * so a new cloud means a new `ParticleSystem`. Everything else is hot — the
 * sliders all go through `setConfig` on the running instance.
 */

interface Params {
  restSpin: number;
  driftAmplitude: number;
  waveStrength: number;
  waveSpeed: number;
  springK: number;
  damping: number;
  particleSize: number;
  mouseMode: 'repel' | 'attract' | 'orbit' | 'none';
}

const DEFAULT_PARAMS: Params = {
  restSpin: 0.12,
  driftAmplitude: 8,
  waveStrength: 140,
  waveSpeed: 360,
  springK: 2.6,
  damping: 4.2,
  particleSize: 2,
  mouseMode: 'repel',
};

/** Sliders, declared as data so the panel stays one map rather than eight blocks. */
const SLIDERS: ReadonlyArray<{
  key: keyof Omit<Params, 'mouseMode'>;
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
    max: 0.8,
    step: 0.01,
    unit: 'rad/s',
    hint: 'Rigid rotation of the whole cloud.',
  },
  {
    key: 'driftAmplitude',
    label: 'Drift',
    min: 0,
    max: 40,
    step: 1,
    unit: 'px',
    hint: 'How far each particle wanders from its place.',
  },
  {
    key: 'waveStrength',
    label: 'Wave strength',
    min: 0,
    max: 400,
    step: 5,
    hint: 'Displacement carried by a click wave.',
  },
  {
    key: 'waveSpeed',
    label: 'Wave speed',
    min: 60,
    max: 900,
    step: 10,
    unit: 'px/s',
    hint: 'How fast the wavefront travels.',
  },
  {
    key: 'springK',
    label: 'Spring',
    min: 0.2,
    max: 12,
    step: 0.1,
    hint: 'Pull back to rest. High is rigid, low is fluid.',
  },
  {
    key: 'damping',
    label: 'Damping',
    min: 0.5,
    max: 20,
    step: 0.1,
    hint: 'Energy bleed. Low overshoots and rings.',
  },
  {
    key: 'particleSize',
    label: 'Particle size',
    min: 0.5,
    max: 6,
    step: 0.1,
    unit: 'px',
    hint: 'Base radius before saliency weighting.',
  },
];

const MOUSE_MODES: ReadonlyArray<Params['mouseMode']> = ['repel', 'attract', 'orbit', 'none'];

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
          ...paramsRef.current,
        });

        // A cloud swap that lands after unmount would leak a live rAF loop.
        if (disposed) {
          instance.destroy();
          return;
        }

        instanceRef.current = instance;
        setStatus('ready');
        setReadout({ points: instance.stats.particleCount, fps: 0 });
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

  // ── Push slider changes to the running instance ───────────────────
  useEffect(() => {
    instanceRef.current?.setConfig(params);
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
    setMessage('Tracing image…');
    try {
      const cloud = await imageToCloud(file, { targetPoints: 6000 });
      setSource({ key: `upload:${file.name}:${Date.now()}`, label: file.name, src: cloud });
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Could not read that image.');
    }
  }, []);

  return (
    <div className="space-y-4 p-4">
      {/* Stage */}
      <div className="relative overflow-hidden rounded-lg border border-[var(--c-line)] bg-[var(--c-sunken)]">
        <canvas
          ref={canvasRef}
          aria-label={`${title} — interactive particle canvas`}
          role="img"
          className="block h-[320px] w-full cursor-crosshair touch-none sm:h-[420px]"
        />

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

      {/* Source */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">Source</span>
        <button
          type="button"
          onClick={() =>
            setSource({
              key: 'corona',
              label: 'CoronRing mark',
              src: href('/clouds/corona.pwcloud'),
            })
          }
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
        {SLIDERS.map((s) => {
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
      </div>

      <p className="text-xs leading-relaxed text-[var(--c-text-faint)]">
        Move the cursor to push the field; click to send a wave. Uploaded images are traced to a
        point cloud in your browser — nothing is sent anywhere.
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
