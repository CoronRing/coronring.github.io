/**
 * Generate the hero point cloud: the CoronRing mark as particles.
 *
 *   node scripts/generate-cloud.mjs
 *   → public/clouds/corona.pwcloud
 *
 * ## What it draws
 *
 * The same glyph as `src/components/ui/Mark.astro` — a ring broken on the
 * right with a bar running from the core out through the gap, so it reads as
 * a **G** — surrounded by an orbiting corona of flares and dust.
 *
 * The proportions are lifted from the SVG (32-unit box, R=11, core=3, an 18°
 * half-gap) and re-expressed as fractions of the glyph radius, so the two
 * stay recognisably the same shape without the cloud having to adopt the
 * SVG's absolute units.
 *
 * ## Why the glyph and the corona are separate groups
 *
 * The renderer spins the cloud, and a spinning letter is upside down half the
 * time. Groups let the engine hold the glyph upright (`spinWeightByGroup`
 * weight 0) while the corona orbits around it, which is the effect actually
 * wanted: a still shape made of moving material. See ParticleField.astro.
 *
 * The corona therefore starts *outside* the ring rather than growing from it.
 * Streamers rooted in a stationary ring but rotating themselves would visibly
 * shear away from their own base.
 *
 * ## Why generate rather than trace an image
 *
 * SenseRing's Python tool derives a cloud from a source image via edge
 * extraction. That is the right path for artwork, but this shape is
 * *parametric*, so describing it directly avoids shipping a source bitmap,
 * avoids a Python step in CI, and lets density be tuned by editing a number.
 *
 * The output conforms to the `.pwcloud` v1.0.0 contract the tool emits (flat
 * encoding, stride 4, fields x/y/w/g, coordinates normalized 0..1), so the
 * vendored frontend loads it unmodified.
 *
 * ## Determinism
 *
 * Uses a seeded PRNG. An unseeded generator would emit a different asset on
 * every run, so each rebuild would show a spurious diff and bust the CDN
 * cache for no reason.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/clouds/corona.pwcloud');

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

/** Fixed seed: the asset must be byte-identical on every rebuild. */
const rand = makeRandom(20260814);

/** Box–Muller: normal deviates, for soft-edged bands rather than hard rings. */
function gaussian(mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Groups. The first three are the glyph and must stay upright; the last two
 * are the corona and orbit. `ParticleField.astro` maps these to spin weights,
 * so the numbering here is load-bearing — keep them in sync.
 */
const GROUP = { GLYPH_RING: 0, GLYPH_BAR: 1, GLYPH_CORE: 2, FLARE: 3, DUST: 4 };

const points = [];

/**
 * Push a point, clamped to the unit square; out-of-range values are dropped.
 *
 * Coordinates are rounded to 3 decimals and weight to 2. On a ~1000px canvas
 * that is sub-pixel for position and imperceptible for size/opacity, while
 * cutting roughly a fifth off the transferred asset.
 */
function push(x, y, w, g) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  points.push(
    Number(x.toFixed(3)),
    Number(y.toFixed(3)),
    Number(Math.min(1, Math.max(0.05, w)).toFixed(2)),
    g,
  );
}

// The cloud is authored in a square field; the renderer handles aspect fit.
const CX = 0.5;
const CY = 0.5;

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
 * The floor is high (0.7) because this shape now has to stay *legible* — the
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

  const r = gaussian(R, STROKE);
  push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, 0.55 + lit * 0.45, GROUP.GLYPH_RING);
}

// ── 2. The bar ──────────────────────────────────────────────────────
// Core → out through the gap. This is the stroke that makes it a G, so it is
// slightly denser than the ring: a thin bar reads as a stray flare.
const BAR_N = 620;
for (let i = 0; i < BAR_N; i += 1) {
  const t = rand();
  const x = CX + BAR_START + t * (BAR_END - BAR_START);
  const y = CY + gaussian(0, STROKE);
  push(x, y, 0.7 + rand() * 0.3, GROUP.GLYPH_BAR);
}

// ── 3. Inner core ───────────────────────────────────────────────────
// The dense centre the ring orbits. The bar starts inside it so the two merge
// into a single stem rather than reading as a dot beside a dash.
const CORE_N = 520;
for (let i = 0; i < CORE_N; i += 1) {
  const theta = rand() * TAU;
  const r = Math.abs(gaussian(0, CORE_R * 0.42));
  push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, 0.85 + rand() * 0.15, GROUP.GLYPH_CORE);
}

// ── 4. Corona flares ────────────────────────────────────────────────
// Streamers in an outer annulus, clearly detached from the ring so they can
// rotate independently without shearing off their own base. Density falls
// with distance, so the cloud dissolves outward instead of ending at an edge.
const FLARES = 30;
const FLARE_INNER = R * 1.22;
for (let f = 0; f < FLARES; f += 1) {
  const baseTheta = (f / FLARES) * TAU + gaussian(0, 0.05);
  const lit = lightAt(baseTheta);
  const reach = (0.06 + rand() * 0.14) * (0.55 + lit * 0.45);
  const count = Math.floor(24 + rand() * 40);

  for (let i = 0; i < count; i += 1) {
    // t^1.7 biases points toward the base of the flare.
    const t = Math.pow(rand(), 1.7);
    const r = FLARE_INNER + t * reach;
    // Streamers splay as they extend.
    const theta = baseTheta + gaussian(0, 0.014 + t * 0.05);
    const w = (1 - t) * 0.7 * (0.5 + lit * 0.5);
    push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, w, GROUP.FLARE);
  }
}

// ── 5. Ambient dust ─────────────────────────────────────────────────
// Sparse field points. These carry the mouse interaction in the empty
// regions, so the canvas responds to the cursor everywhere, not just on the
// glyph. Kept out of the ring's interior, which should stay dark for
// contrast against the stroke.
const DUST_N = 900;
for (let i = 0; i < DUST_N; i += 1) {
  const x = rand();
  const y = rand();
  const d = Math.hypot(x - CX, y - CY);
  if (d < R * 0.8 && rand() < 0.75) continue;
  push(x, y, 0.1 + rand() * 0.22, GROUP.DUST);
}

const cloud = {
  $schema: 'https://sensering.dev/schemas/pwcloud/1.0.0',
  version: '1.0.0',
  meta: {
    source_image: null,
    source_size: [1024, 1024],
    extractor: 'parametric:coronring-g',
    point_count: points.length / 4,
    generated_by: 'scripts/generate-cloud.mjs',
    generator: 'coronring-site/1.1.0',
    groups: Object.fromEntries(Object.entries(GROUP).map(([k, v]) => [v, k.toLowerCase()])),
  },
  encoding: 'flat',
  stride: 4,
  fields: ['x', 'y', 'w', 'g'],
  data: points,
};

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(cloud);
writeFileSync(OUT, json);

const counts = {};
for (let i = 3; i < points.length; i += 4) {
  const name = cloud.meta.groups[points[i]];
  counts[name] = (counts[name] ?? 0) + 1;
}
console.log(
  `corona.pwcloud — ${cloud.meta.point_count} points, ${(json.length / 1024).toFixed(1)} kB`,
);
console.log('  by group:', counts);
console.log(`  → ${OUT}`);
