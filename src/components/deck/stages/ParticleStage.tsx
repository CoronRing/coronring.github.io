import { useCallback, useEffect, useRef, useState } from 'react';
import ParticleWave, {
  type ParticleWaveConfig,
  type ParticleWaveInstance,
  type MouseMode,
} from '@npmring/particle-wave';
import { imageToCloud, type PwCloud } from '../../../lib/image-to-cloud';
import { API_BASE, convertViaApi } from '../../../lib/particle-wave-api';
import { href } from '../../../lib/url';
import { Chips, Segment, StageShell } from '../StageShell';

/**
 * ParticleStage — the published engine, running edge to edge, with three knobs.
 *
 * ## What changed, and why
 *
 * This replaces a 420px canvas under twenty sliders. The canvas is now the
 * frame: it fills the deck's stage column and bleeds off three sides, because
 * the engine's whole claim is that it holds up at size and under a cursor.
 * The parameter sheet moved to the project page, where a reader who wants it
 * has already asked for it.
 *
 * What is left is the three decisions that change the picture in under a
 * second:
 *
 *   SUBJECT  which cloud is on the table — and the upload path, which is the
 *            half of the project that is not JavaScript
 *   FIELD    what the cursor does to it
 *   LOOK     a preset, not a parameter: colour and trails move together,
 *            because "aurora with no trails" is a distinction nobody standing
 *            in front of it for four seconds cares about
 *
 * ## Why a subject change is a morph rather than a rebuild
 *
 * Switching subject used to tear the instance down and build another one, so
 * one picture was replaced by a different picture and the interesting part —
 * that this is a physical system holding a shape — went past unstated. The
 * engine now pairs the live particles with the points of the new cloud and
 * moves them there, so the corona comes apart and reassembles as the orrery.
 *
 * That needs the buffers sized for the largest cloud up front, which is what
 * `capacity` is for: the biggest of the three is 7,815 points, so 8,200 covers
 * them and leaves room for an upload. Everything else is hot and goes through
 * `setConfig` on the running instance.
 *
 * ## The cloud answers the scroll
 *
 * `restSpin` tracks how fast the page is moving. Scrolling spins the field up
 * and it settles back on its own, so the exhibit is doing something even for a
 * visitor who never touches it — which is most of them. Suppressed under
 * `prefers-reduced-motion`, where a canvas that reacts to scrolling is exactly
 * what the setting is asking us not to do.
 *
 * ## Two tracers, one contract
 *
 * An upload is sent to the ParticleWave Python service, which runs the real
 * extractor and returns a `.pwcloud`. If that service is unreachable — it is a
 * free-tier host, and this page must not depend on it — the image is traced in
 * the tab instead by a cut-down port of the same idea. The renderer cannot
 * tell the two apart, because they emit the identical format; the readout
 * names whichever ran, since the quality difference is the interesting part.
 */

type SubjectKey = 'corona' | 'orbit' | 'wave' | 'upload';
type LookKey = 'ink' | 'aurora' | 'fire' | 'charge';

interface Subject {
  key: SubjectKey;
  label: string;
  /** Absent for `upload`, which has no asset until the visitor supplies one. */
  file?: string;
}

const SUBJECTS: readonly Subject[] = [
  { key: 'corona', label: 'Corona', file: '/clouds/corona.pwcloud' },
  { key: 'orbit', label: 'Orrery', file: '/clouds/orbit.pwcloud' },
  { key: 'wave', label: 'Waves', file: '/clouds/wave.pwcloud' },
  { key: 'upload', label: 'Upload' },
];

const FIELDS: ReadonlyArray<{ value: MouseMode; label: string }> = [
  { value: 'repel', label: 'Push' },
  { value: 'attract', label: 'Pull' },
  { value: 'orbit', label: 'Swirl' },
];

/**
 * The looks.
 *
 * ## Why none of them use trails
 *
 * The engine's meteor trails submit `particleCount x trailLength` antialiased
 * line segments every frame — 29,000 of them for this cloud at `trailLength:
 * 5` — and rasterising those dominates the frame: measured at 133 ms against
 * 24 ms for the same cloud with trails off. Almost none of that geometry is
 * visible, because a cloud turning at rest moves each particle a fraction of a
 * pixel per frame, so the "tail" is shorter than the particle is wide.
 *
 * That is fixed in the engine (see ParticleWave's changelog: trail draws are
 * batched, and gated on real movement), but the fix has not been published
 * yet, and the deck is the first screen of the site. So the presets here are
 * built out of things that are free at this cloud size: the colour ramp, what
 * it is mapped to, and the particle radius.
 *
 * `ink` follows the page's own particle token, so it is the look the hero and
 * the deck agree on and the default. `charge` maps the ramp to *speed*, which
 * makes the cloud change colour under the cursor rather than only move — the
 * cheapest interactive thing the engine can do.
 */
const LOOKS: ReadonlyArray<{
  value: LookKey;
  label: string;
  swatch: string;
  config: Partial<ParticleWaveConfig>;
}> = [
  {
    value: 'ink',
    label: 'Ink',
    swatch: 'var(--c-particle)',
    config: { colorMode: 'single', trailLength: 0, particleSize: 2 },
  },
  {
    value: 'aurora',
    label: 'Aurora',
    swatch: 'linear-gradient(135deg,#3ddad7,#7b93ff)',
    config: {
      colorMode: 'palette',
      colorPalette: 'aurora',
      colorMapping: 'radial',
      trailLength: 0,
      particleSize: 2.2,
    },
  },
  {
    value: 'fire',
    label: 'Fire',
    swatch: 'linear-gradient(135deg,#ffd166,#be1414)',
    config: {
      colorMode: 'palette',
      colorPalette: 'fire',
      colorMapping: 'radial',
      trailLength: 0,
      particleSize: 2.2,
    },
  },
  {
    value: 'charge',
    label: 'Charge',
    swatch: 'linear-gradient(135deg,#ff1e82,#00f0ff)',
    config: {
      colorMode: 'palette',
      colorPalette: 'cyberpunk',
      colorMapping: 'velocity',
      trailLength: 0,
      particleSize: 2.2,
    },
  },
];

/**
 * Held constant across every look and subject.
 *
 * The cloud turns slowly at rest, with structure groups pinned upright by
 * `spinWeightByGroup` — see the group convention in
 * `scripts/generate-cloud.mjs`. Without the pinning the G in the corona spends
 * half of each revolution upside down.
 */
/** Radians per second the cloud turns when nothing is happening. */
const REST_SPIN = 0.05;
/** How much faster it can be driven, on top of `REST_SPIN`. */
const SPIN_RANGE = 1.1;
/** Pixels of scroll in one frame that count as full speed. */
const SPIN_FULL_PX = 90;
/** Per-frame decay of the accumulator, i.e. how long the coast-down lasts. */
const SPIN_DECAY = 0.9;

const BASE: Partial<ParticleWaveConfig> = {
  /*
   * Nearly none. The stage is the whole first screen, so the cloud should reach
   * the top and bottom of it; the vignette and the copy scrim are what keep the
   * edges from feeling cut, not empty canvas.
   */
  padding: 0.015,
  scaleMode: 'fit',
  /* The largest of the three clouds is 7,815 points. See the note above. */
  capacity: 8200,
  particleSizeWeight: 0.9,
  particleOpacityWeight: 0.8,
  springK: 1.9,
  damping: 3.4,
  restSpin: REST_SPIN,
  driftAmplitude: 7,
  driftSpeed: 0.5,
  spinWeightByGroup: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0.55 },
  mouseEnabled: true,
  mouseStrength: 62,
  interactionRadius: 165,
  touchEnabled: true,
  waveEnabled: true,
  waveSpeed: 360,
  waveStrength: 150,
  rippleCount: 2,
  leftClickMode: 'outward_wave',
  rightClickMode: 'inward_wave',
};

interface Props {
  /** True while this frame is the one on the deck. Drives pause/resume. */
  active: boolean;
  /**
   * Whether to show the control row. False on the landing card, where the
   * canvas is the only thing on screen and a panel of settings under a name is
   * the opposite of an introduction.
   */
  chrome?: boolean;
}

interface Source {
  /** Changes on every load, including re-picking the same file. */
  key: string;
  src: string | PwCloud;
  label: string;
}

/**
 * The cloud the instance is constructed on.
 *
 * `src` is empty because the initial load is done by the init effect, which
 * names the file itself; this exists so the morph effect knows what the engine
 * is already holding.
 */
const INITIAL_SOURCE: Source = { key: 'corona', src: '', label: 'Corona' };

export default function ParticleStage({ active, chrome = true }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<ParticleWaveInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [subject, setSubject] = useState<SubjectKey>('corona');
  const [field, setField] = useState<MouseMode>('repel');
  const [look, setLook] = useState<LookKey>('ink');
  const [source, setSource] = useState<Source>(INITIAL_SOURCE);
  const [status, setStatus] = useState<'loading' | 'ready' | 'morphing' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [readout, setReadout] = useState({ points: 0, fps: 0 });
  /** Which tracer produced the current cloud. Only set after an upload. */
  const [trace, setTrace] = useState<
    { via: 'service'; ms: number } | { via: 'browser'; reason: string } | null
  >(null);

  // Read through refs inside the init effect so a control change never rebuilds.
  const liveRef = useRef({ field, look });
  liveRef.current = { field, look };

  /*
   * Which cloud the engine is actually holding.
   *
   * Comparing against the *initial key* instead would make every return to the
   * corona a no-op, because that is the key the instance was built on. This has
   * to track what is loaded now, not what was loaded first — and it gets a
   * repeat click on the held subject ignored for free.
   */
  const loadedRef = useRef<string>(INITIAL_SOURCE.key);

  /** Fires a wave from the middle of the canvas, to announce a new cloud. */
  const announce = useCallback(() => {
    const canvas = canvasRef.current;
    const instance = instanceRef.current;
    if (!canvas || !instance) return;
    const rect = canvas.getBoundingClientRect();
    instance.triggerWave({ x: rect.width / 2, y: rect.height / 2 });
  }, []);

  // ── Build the instance. Once. ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;

    void (async () => {
      try {
        const { field: f, look: l } = liveRef.current;
        const instance = await ParticleWave.init(canvas, {
          ...BASE,
          src: href('/clouds/corona.pwcloud'),
          particleColor: readToken('--c-particle', '#ffffff'),
          particleOpacity: Number(readToken('--particle-opacity', '0.85')),
          mouseMode: f,
          ...lookConfig(l),
          ...waveFrontConfig(),
        });

        // A load that lands after unmount would leak a live rAF loop.
        if (disposed) {
          instance.destroy();
          return;
        }

        instanceRef.current = instance;
        setStatus('ready');
        setReadout({ points: instance.stats.particleCount, fps: 0 });

        /*
         * Announce the cloud with a wave from the centre.
         *
         * The engine's most interesting behaviour is the one nobody discovers
         * by looking: a click sends a front through the field. Firing one on
         * arrival shows what the canvas does before the visitor has decided
         * whether to touch it, which is the entire reason this exhibit is
         * above the fold.
         */
        window.setTimeout(announce, 420);
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
  }, [announce]);

  // ── Subject changes are a morph, not a rebuild ────────────────────
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || source.key === loadedRef.current) return;
    loadedRef.current = source.key;

    let stale = false;
    setStatus('morphing');
    setMessage('');

    void instance
      .morphTo(source.src, { duration: 1500, stagger: 0.42 })
      .then(() => {
        if (stale) return;
        setStatus('ready');
        setReadout({ points: instance.stats.particleCount, fps: instance.stats.fps });
        announce();
      })
      .catch((err: unknown) => {
        if (stale) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'That cloud could not be loaded.');
      });

    return () => {
      stale = true;
    };
  }, [source, announce]);

  // ── Hot parameters ────────────────────────────────────────────────
  useEffect(() => {
    instanceRef.current?.setConfig({ mouseMode: field });
  }, [field]);

  useEffect(() => {
    instanceRef.current?.setConfig(lookConfig(look));
  }, [look]);

  // ── Only run while this frame is on the deck ──────────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    if (active) instanceRef.current?.resume();
    else instanceRef.current?.pause();
  }, [active, status]);

  // ── The cloud answers the scroll ──────────────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let last = window.scrollY;
    let boost = 0;
    let applied = REST_SPIN;
    let raf = 0;

    /*
     * A decaying accumulator rather than a raw delta: reading `scrollY` once a
     * frame gives a value that stutters with the wheel, and the decay turns
     * that into a spin-up and a coast-down. The loop only runs while there is
     * something left to decay, so a page nobody is scrolling costs nothing.
     */
    const tick = (): void => {
      const y = window.scrollY;
      boost = Math.max(boost * SPIN_DECAY, Math.min(1, Math.abs(y - last) / SPIN_FULL_PX));
      last = y;

      const spin = REST_SPIN + boost * SPIN_RANGE;
      if (Math.abs(spin - applied) > 0.01) {
        instanceRef.current?.setConfig({ restSpin: spin });
        applied = spin;
      }

      if (boost > 0.004) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        if (applied !== REST_SPIN) {
          instanceRef.current?.setConfig({ restSpin: REST_SPIN });
          applied = REST_SPIN;
        }
      }
    };

    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      instanceRef.current?.setConfig({ restSpin: REST_SPIN });
    };
  }, [status, active]);

  // ── FPS readout, sampled rather than per-frame ────────────────────
  useEffect(() => {
    if (status !== 'ready' || !active) return;
    const id = window.setInterval(() => {
      const s = instanceRef.current?.stats;
      if (s) setReadout({ points: s.particleCount, fps: s.fps });
    }, 600);
    return () => window.clearInterval(id);
  }, [status, active]);

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

  const pickSubject = useCallback((key: SubjectKey) => {
    if (key === 'upload') {
      fileInputRef.current?.click();
      return;
    }
    const next = SUBJECTS.find((s) => s.key === key);
    if (!next?.file) return;
    setSubject(key);
    setTrace(null);
    setSource({ key, src: href(next.file), label: next.label });
  }, []);

  const onUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be chosen twice in a row.
    event.target.value = '';
    if (!file) return;

    setSubject('upload');
    setStatus('loading');
    setMessage('Tracing with the Python service…');

    const apply = (cloud: PwCloud): void =>
      setSource({ key: `upload:${file.name}:${Date.now()}`, src: cloud, label: file.name });

    /*
     * Server first, browser second. The service does the better job and is the
     * half of the project worth showing; the local tracer exists so that a
     * sleeping, rate-limited, or simply absent backend degrades the exhibit
     * instead of breaking it. A failure here is expected often enough that it
     * is reported as provenance rather than as an error.
     *
     * The point cap, not the radius, is what a visitor waits on. 3,500 is the
     * densest cloud the canvas can show while still landing inside the couple
     * of seconds anyone will wait; measured on the deployed host.
     */
    try {
      const { cloud, meta } = await convertViaApi(file, { target_points: 3500, min_radius: 1.8 });
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
    <StageShell
      readout={
        <span className="flex items-center gap-3">
          <span>
            {readout.points.toLocaleString()} pts · {readout.fps} fps
          </span>
          {trace && (
            <span
              className="text-accent"
              title={
                trace.via === 'service'
                  ? `Extracted by the particle_wave Python package at ${API_BASE}`
                  : `The service could not be reached (${trace.reason}), so the image was traced in this tab with the cut-down JavaScript extractor.`
              }
            >
              {trace.via === 'service' ? `PY ${trace.ms} MS` : 'IN-TAB TRACE'}
            </span>
          )}
        </span>
      }
      hint={
        chrome
          ? 'Cursor pushes the field · click sends a wave · right-click pulls it in'
          : undefined
      }
      controls={
        chrome ? (
          <>
            <Chips
              label="Subject"
              value={subject}
              options={SUBJECTS.map((s) => ({ value: s.key, label: s.label }))}
              onChange={pickSubject}
              disabled={status !== 'ready'}
            />
            <Segment label="Field" value={field} options={FIELDS} onChange={setField} />
            <Chips
              label="Look"
              value={look}
              options={LOOKS.map((l) => ({ value: l.value, label: l.label, swatch: l.swatch }))}
              onChange={setLook}
            />
          </>
        ) : undefined
      }
    >
      <canvas
        ref={canvasRef}
        aria-label="Particle Wave, an interactive point cloud"
        role="img"
        className="block size-full cursor-crosshair touch-none"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onUpload}
        className="sr-only"
        tabIndex={-1}
      />

      {(status === 'loading' || status === 'error') && (
        <div className="bg-ground/70 absolute inset-0 z-10 grid place-items-center px-6 text-center backdrop-blur-[2px]">
          <p className={`font-mono text-xs ${status === 'error' ? 'text-alert' : 'text-muted'}`}>
            {message || 'Starting engine…'}
          </p>
        </div>
      )}
    </StageShell>
  );
}

/** Config for a look preset, resolved against the current theme. */
function lookConfig(look: LookKey): Partial<ParticleWaveConfig> {
  const preset = LOOKS.find((l) => l.value === look) ?? LOOKS[0]!;
  if (look !== 'ink') return preset.config;
  // Ink follows the page's own particle token rather than a fixed hex.
  return {
    ...preset.config,
    particleColor: readToken('--c-particle', '#ffffff'),
    particleOpacity: Number(readToken('--particle-opacity', '0.85')),
  };
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
 * very nearly a no-op — adding white to white — so light gets the ink colour
 * with the glow off, which draws the core line with normal blending and is
 * legible for the opposite reason.
 */
function waveFrontConfig(): Partial<ParticleWaveConfig> {
  const dark = isDarkTheme();
  return {
    clickWaveVisualColor: readToken('--c-text', dark ? '#f5f5f5' : '#191919'),
    clickWaveVisualGlow: dark,
  };
}
