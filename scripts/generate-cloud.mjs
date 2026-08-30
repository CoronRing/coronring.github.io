/**
 * Generate the site's parametric point clouds.
 *
 *   node scripts/generate-cloud.mjs
 *   → public/clouds/corona.pwcloud    the CoronRing mark (hero + deck frame 01)
 *   → public/clouds/orbit.pwcloud     an orrery
 *   → public/clouds/wave.pwcloud      a two-source interference field
 *
 * ## Why three
 *
 * The deck's particle stage is the site's one genuinely interactive exhibit,
 * and a single subject makes it read as a logo that wobbles. Three parametric
 * subjects let the stage *cut* between shapes, which is what makes the engine
 * legible as an engine: the same physics, the same controls, different
 * material. They are also the cheapest possible way to do it — a shape is a
 * function here, not a bitmap and not an offline extraction step.
 *
 * ## Group convention, shared by every shape
 *
 * The renderer spins the cloud, and a spinning letterform is upside down half
 * the time. Groups let `spinWeightByGroup` hold the structure still while the
 * loose material orbits, so the numbering is load-bearing and identical
 * across shapes:
 *
 *   0,1,2  structure — held upright (weight 0)
 *   3      orbiting material — full spin (weight 1)
 *   4      ambient dust — partial spin (weight ~0.55)
 *
 * Consumers: `ParticleField.astro` and `components/deck/stages/ParticleStage`.
 *
 * ## Why generate rather than trace an image
 *
 * SenseRing's Python tool derives a cloud from a source image via edge
 * extraction. That is the right path for artwork, but these shapes are
 * *parametric*, so describing them directly avoids shipping source bitmaps,
 * avoids a Python step in CI, and lets density be tuned by editing a number.
 *
 * The output conforms to the `.pwcloud` v1.0.0 contract the tool emits (flat
 * encoding, stride 4, fields x/y/w/g, coordinates normalized 0..1), so the
 * published frontend loads it unmodified.
 *
 * ## Determinism
 *
 * Each shape owns a seeded PRNG. An unseeded generator would emit different
 * assets on every run, so each rebuild would show a spurious diff and bust the
 * CDN cache for no reason. Editing a shape does change its asset, which is the
 * point; regenerate all three together and commit them in one change.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/clouds');

/** mulberry32 — small, fast, seeded. Identical output across Node versions. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller: normal deviates, for soft-edged bands rather than hard rings. */
function gaussian(rand, mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Shared group numbering. See the note at the top of the file: these values
 * are read by `spinWeightByGroup` on the consumer side.
 */
const GROUP = { GLYPH_RING: 0, GLYPH_BAR: 1, GLYPH_CORE: 2, FLARE: 3, DUST: 4 };

/** Human-readable group names, emitted in the cloud's metadata. */
const GROUP_NAMES = Object.fromEntries(
  Object.entries(GROUP).map(([name, id]) => [id, name.toLowerCase()]),
);

/** Collects points and clamps them to the unit square. */
function makeSink() {
  const points = [];
  /**
   * Push a point; out-of-range values are dropped.
   *
   * Coordinates are rounded to 3 decimals and weight to 2. On a ~1000px canvas
   * that is sub-pixel for position and imperceptible for size/opacity, while
   * cutting roughly a fifth off the transferred asset.
   */
  const push = (x, y, w, g) => {
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    points.push(
      Number(x.toFixed(3)),
      Number(y.toFixed(3)),
      Number(Math.min(1, Math.max(0.05, w)).toFixed(2)),
      g,
    );
  };
  return { points, push };
}

// The clouds are authored in a square field; the renderer handles aspect fit.
const CX = 0.5;
const CY = 0.5;

/**
 * Ambient dust, on a disc with a soft rim.
 *
 * These points carry the mouse interaction in the empty regions, so the canvas
 * responds to the cursor everywhere rather than only on the subject.
 *
 * They used to be sampled over the unit square, which is wrong for a cloud the
 * renderer *rotates*: a square has corners, the corners sweep, and what the eye
 * reads is a rotating rectangle of noise rather than a field of stars. A disc
 * has no corners, and its own rim is hidden by tapering the point weight to
 * zero across the outer band — so the field has no boundary to see, and a
 * rotationally symmetric field looks identical at every angle. What is left
 * moving is the individual particles, which is the whole of what should move.
 *
 * @param {() => number} rand
 * @param {(x: number, y: number, w: number, g: number) => void} push
 * @param {Object} opts
 * @param {number} opts.count   how many to attempt
 * @param {number} opts.wMin    weight floor, before the rim taper
 * @param {number} opts.wRange  weight range above the floor
 * @param {number} [opts.maxR]  outer radius, as a fraction of the field
 * @param {number} [opts.edge]  width of the taper band, in the same units
 * @param {number} [opts.hole]  radius kept clear
 * @param {number} [opts.holeKeep] chance a point inside `hole` survives anyway
 */
function dust(
  rand,
  push,
  { count, wMin, wRange, maxR = 0.5, edge = 0.17, hole = 0, holeKeep = 0 },
) {
  for (let i = 0; i < count; i += 1) {
    // sqrt for uniform density by area rather than by radius.
    const r = maxR * Math.sqrt(rand());
    const theta = rand() * TAU;

    if (r < hole && rand() > holeKeep) continue;

    const t = Math.min(1, Math.max(0, (maxR - r) / edge));
    const fade = t * t * (3 - 2 * t);
    if (fade < 0.05) continue;

    push(
      CX + Math.cos(theta) * r,
      CY + Math.sin(theta) * r,
      (wMin + rand() * wRange) * fade,
      GROUP.DUST,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · corona — the CoronRing mark
 *
 * The same glyph as `src/components/ui/Mark.astro`: a ring broken on the
 * right with a bar running from the core out through the gap, so it reads as
 * a **G**, surrounded by an orbiting corona of flares and dust.
 *
 * The proportions are lifted from the SVG (32-unit box, R=11, core=3, an 18°
 * half-gap) and re-expressed as fractions of the glyph radius, so the two stay
 * recognisably the same shape without the cloud having to adopt the SVG's
 * absolute units.
 *
 * The corona starts *outside* the ring rather than growing from it. Streamers
 * rooted in a stationary ring but rotating themselves would visibly shear away
 * from their own base.
 * ══════════════════════════════════════════════════════════════════════ */
function corona() {
  const rand = makeRandom(20260814);
  const { points, push } = makeSink();

  /*
   * Glyph geometry, as fractions of the field.
   *
   * The mark is drawn at R=11 in a 32-unit box (0.344 of the box), which would
   * leave no room for a corona here. R is therefore set to 0.27 and every other
   * dimension derived from it at the SVG's ratios, so the letterform keeps its
   * proportions while the field gains an outer margin to orbit in.
   */
  const R = 0.27;
  const CORE_R = R * (3 / 11);
  const BAR_START = R * (0.8 / 11); // where the bar leaves the core
  const BAR_END = R; // out through the gap, flush with the ring
  const GAP = 18 * DEG; // half-angle of the opening, matching Mark.astro
  const STROKE = 0.0105; // band half-width; ~2σ reads as a crisp line

  /**
   * Density modulation so the glyph looks lit from one side rather than flat.
   * The floor is high (0.7) because this shape has to stay *legible* — the
   * previous corona could afford to fade almost to nothing on its dark side.
   */
  const lightAt = (theta) => 0.7 + 0.3 * Math.cos(theta - Math.PI * 1.15);

  // ── 1. The ring, broken on the right ────────────────────────────────
  // Swept from +GAP round to −GAP the long way, leaving the opening that makes
  // the glyph a G rather than an O.
  const RING_N = 3600;
  for (let i = 0; i < RING_N; i += 1) {
    const theta = GAP + rand() * (TAU - 2 * GAP);
    const lit = lightAt(theta);
    if (rand() > lit) continue;

    const r = gaussian(rand, R, STROKE);
    push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, 0.55 + lit * 0.45, GROUP.GLYPH_RING);
  }

  // ── 2. The bar ──────────────────────────────────────────────────────
  // Core → out through the gap. This is the stroke that makes it a G, so it is
  // slightly denser than the ring: a thin bar reads as a stray flare.
  const BAR_N = 620;
  for (let i = 0; i < BAR_N; i += 1) {
    const t = rand();
    const x = CX + BAR_START + t * (BAR_END - BAR_START);
    const y = CY + gaussian(rand, 0, STROKE);
    push(x, y, 0.7 + rand() * 0.3, GROUP.GLYPH_BAR);
  }

  // ── 3. Inner core ───────────────────────────────────────────────────
  // The dense centre the ring orbits. The bar starts inside it so the two merge
  // into a single stem rather than reading as a dot beside a dash.
  const CORE_N = 520;
  for (let i = 0; i < CORE_N; i += 1) {
    const theta = rand() * TAU;
    const r = Math.abs(gaussian(rand, 0, CORE_R * 0.42));
    push(
      CX + Math.cos(theta) * r,
      CY + Math.sin(theta) * r,
      0.85 + rand() * 0.15,
      GROUP.GLYPH_CORE,
    );
  }

  // ── 4. Corona flares ────────────────────────────────────────────────
  // Streamers in an outer annulus, clearly detached from the ring so they can
  // rotate independently without shearing off their own base. Density falls
  // with distance, so the cloud dissolves outward instead of ending at an edge.
  const FLARES = 30;
  const FLARE_INNER = R * 1.22;
  for (let f = 0; f < FLARES; f += 1) {
    const baseTheta = (f / FLARES) * TAU + gaussian(rand, 0, 0.05);
    const lit = lightAt(baseTheta);
    const reach = (0.06 + rand() * 0.14) * (0.55 + lit * 0.45);
    const count = Math.floor(24 + rand() * 40);

    for (let i = 0; i < count; i += 1) {
      // t^1.7 biases points toward the base of the flare.
      const t = Math.pow(rand(), 1.7);
      const r = FLARE_INNER + t * reach;
      // Streamers splay as they extend.
      const theta = baseTheta + gaussian(rand, 0, 0.014 + t * 0.05);
      const w = (1 - t) * 0.7 * (0.5 + lit * 0.5);
      push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, w, GROUP.FLARE);
    }
  }

  // ── 5. Ambient dust ─────────────────────────────────────────────────
  // Kept mostly out of the ring's interior, which should stay dark for
  // contrast against the stroke.
  dust(rand, push, { count: 1500, wMin: 0.1, wRange: 0.22, hole: R * 0.8, holeKeep: 0.25 });

  return { points, extractor: 'parametric:coronring-g' };
}

/* ══════════════════════════════════════════════════════════════════════
 * 2 · orbit — an orrery
 *
 * Three tilted elliptical tracks around a dense primary, each carrying one
 * body with a short trailing arc. The tracks are *structure* (group 0) and the
 * bodies are *material* (group 3), so under spin the bodies sweep along tracks
 * that stay put — which is the whole point of an orrery and is impossible if
 * everything rotates together.
 * ══════════════════════════════════════════════════════════════════════ */
function orbit() {
  const rand = makeRandom(20260828);
  const { points, push } = makeSink();

  /** A point on an ellipse of semi-axes (a, b) rotated by `tilt`. */
  const onTrack = (a, b, tilt, t) => {
    const px = Math.cos(t) * a;
    const py = Math.sin(t) * b;
    return [
      CX + px * Math.cos(tilt) - py * Math.sin(tilt),
      CY + px * Math.sin(tilt) + py * Math.cos(tilt),
    ];
  };

  /*
   * Tracks. `phase` is where the body sits, so the three are deliberately
   * spread rather than lined up — three bodies at the same clock angle read
   * as one thick spoke.
   */
  const TRACKS = [
    { a: 0.19, b: 0.075, tilt: -22 * DEG, phase: 0.35 * TAU, body: 0.03 },
    { a: 0.3, b: 0.125, tilt: 14 * DEG, phase: 0.82 * TAU, body: 0.023 },
    { a: 0.42, b: 0.185, tilt: 46 * DEG, phase: 0.12 * TAU, body: 0.017 },
  ];

  // ── 1. Primary ──────────────────────────────────────────────────────
  const PRIMARY_R = 0.048;
  const PRIMARY_N = 1400;
  for (let i = 0; i < PRIMARY_N; i += 1) {
    const theta = rand() * TAU;
    // sqrt keeps the disc evenly filled instead of piling up at the centre.
    const r = Math.sqrt(rand()) * PRIMARY_R;
    const w = 0.55 + (1 - r / PRIMARY_R) * 0.45;
    push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, w, GROUP.GLYPH_CORE);
  }

  // ── 2. Tracks ───────────────────────────────────────────────────────
  // Thin, faint, and unbroken: they are the ruled lines of the instrument, and
  // any density here competes with the bodies riding on them.
  for (const track of TRACKS) {
    const n = Math.round(1100 * (track.a / 0.42));
    for (let i = 0; i < n; i += 1) {
      const t = rand() * TAU;
      const [x, y] = onTrack(track.a, track.b, track.tilt, t);
      // Jitter across the track, not along it, so the line keeps its width.
      const j = gaussian(rand, 0, 0.0045);
      push(x + j, y + j * 0.35, 0.12 + rand() * 0.16, GROUP.GLYPH_RING);
    }
  }

  // ── 3. Bodies and their trailing arcs ───────────────────────────────
  for (const track of TRACKS) {
    const n = Math.round(520 * (track.body / 0.03) + 180);
    for (let i = 0; i < n; i += 1) {
      const theta = rand() * TAU;
      const r = Math.sqrt(rand()) * track.body;
      const [x, y] = onTrack(track.a, track.b, track.tilt, track.phase);
      push(x + Math.cos(theta) * r, y + Math.sin(theta) * r, 0.6 + rand() * 0.4, GROUP.FLARE);
    }

    // The trail: 40° of track behind the body, thinning as it goes.
    const TRAIL_N = 260;
    for (let i = 0; i < TRAIL_N; i += 1) {
      const t = Math.pow(rand(), 1.6);
      const [x, y] = onTrack(track.a, track.b, track.tilt, track.phase - t * 40 * DEG);
      push(x + gaussian(rand, 0, 0.004), y + gaussian(rand, 0, 0.004), (1 - t) * 0.5, GROUP.FLARE);
    }
  }

  // ── 4. Ambient dust ─────────────────────────────────────────────────
  // The plane of the system is carried by the tracks. The dust is the sky
  // behind them, and a sky has no orientation.
  dust(rand, push, { count: 1700, wMin: 0.08, wRange: 0.2, hole: PRIMARY_R * 1.6 });

  return { points, extractor: 'parametric:orrery' };
}

/* ══════════════════════════════════════════════════════════════════════
 * 3 · wave — a two-source interference field
 *
 * The literal picture of what the engine is named after. Two emitters, and a
 * point survives sampling in proportion to the constructive part of
 * `cos(k·d₁) + cos(k·d₂)`, so the fringes are drawn in *density* rather than
 * in brightness. That matters: the renderer varies point size and alpha by
 * weight, and a field whose structure lives only in alpha washes out on the
 * light theme.
 * ══════════════════════════════════════════════════════════════════════ */
function wave() {
  const rand = makeRandom(20260829);
  const { points, push } = makeSink();

  const SEP = 0.17; // half the distance between emitters
  const K = 118; // spatial frequency; sets the fringe count
  const S1 = [CX - SEP, CY];
  const S2 = [CX + SEP, CY];

  /** Constructive amplitude at (x, y), normalised to 0..1. */
  const amp = (x, y) => {
    const d1 = Math.hypot(x - S1[0], y - S1[1]);
    const d2 = Math.hypot(x - S2[0], y - S2[1]);
    // Fall off with distance so the field dissolves at the edges of the frame
    // rather than being cut off by the unit square.
    const falloff = Math.exp(-Math.pow(Math.hypot(x - CX, y - CY) / 0.42, 2.2));
    return Math.max(0, (Math.cos(K * d1) + Math.cos(K * d2)) / 2) * falloff;
  };

  // ── 1. The fringe field ─────────────────────────────────────────────
  // Rejection sampling: draw uniformly, keep in proportion to amplitude.
  const TRIES = 34000;
  for (let i = 0; i < TRIES; i += 1) {
    const x = rand();
    const y = rand();
    const a = amp(x, y);
    if (a < 0.12 || rand() > a) continue;
    push(x, y, 0.28 + a * 0.6, GROUP.GLYPH_RING);
  }

  // ── 2. The emitters ─────────────────────────────────────────────────
  // Bright, tight, and unmistakably the cause of the pattern.
  for (const [sx, sy] of [S1, S2]) {
    const N = 420;
    for (let i = 0; i < N; i += 1) {
      const theta = rand() * TAU;
      const r = Math.abs(gaussian(rand, 0, 0.012));
      push(
        sx + Math.cos(theta) * r,
        sy + Math.sin(theta) * r,
        0.85 + rand() * 0.15,
        GROUP.GLYPH_CORE,
      );
    }
  }

  // ── 3. Wavefronts ───────────────────────────────────────────────────
  // A few full rings around each emitter, in the orbiting group, so a spin
  // reads as the fronts turning through the standing pattern.
  for (const [sx, sy] of [S1, S2]) {
    for (let ring = 1; ring <= 4; ring += 1) {
      const r0 = ring * 0.085;
      const N = Math.round(120 * ring);
      for (let i = 0; i < N; i += 1) {
        const theta = rand() * TAU;
        const r = gaussian(rand, r0, 0.0035);
        push(
          sx + Math.cos(theta) * r,
          sy + Math.sin(theta) * r,
          0.16 + (1 - ring / 5) * 0.24,
          GROUP.FLARE,
        );
      }
    }
  }

  // ── 4. Ambient dust ─────────────────────────────────────────────────
  dust(rand, push, { count: 1400, wMin: 0.07, wRange: 0.16 });

  return { points, extractor: 'parametric:interference' };
}

/* ══════════════════════════════════════════════════════════════════════
 * Emit
 * ══════════════════════════════════════════════════════════════════════ */

const SHAPES = [
  { name: 'corona', build: corona },
  { name: 'orbit', build: orbit },
  { name: 'wave', build: wave },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const shape of SHAPES) {
  const { points, extractor } = shape.build();
  const cloud = {
    $schema: 'https://sensering.dev/schemas/pwcloud/1.0.0',
    version: '1.0.0',
    meta: {
      source_image: null,
      source_size: [1024, 1024],
      extractor,
      point_count: points.length / 4,
      generated_by: 'scripts/generate-cloud.mjs',
      generator: 'coronring-site/1.2.0',
      groups: GROUP_NAMES,
    },
    encoding: 'flat',
    stride: 4,
    fields: ['x', 'y', 'w', 'g'],
    data: points,
  };

  const out = resolve(OUT_DIR, `${shape.name}.pwcloud`);
  const json = JSON.stringify(cloud);
  writeFileSync(out, json);

  const counts = {};
  for (let i = 3; i < points.length; i += 4) {
    const name = GROUP_NAMES[points[i]];
    counts[name] = (counts[name] ?? 0) + 1;
  }
  console.log(
    `${shape.name}.pwcloud — ${cloud.meta.point_count} points, ${(json.length / 1024).toFixed(1)} kB`,
  );
  console.log('  by group:', counts);
  console.log(`  → ${out}`);
}
