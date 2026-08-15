/**
 * Generate the corona point cloud consumed by the hero particle canvas.
 *
 *   node scripts/generate-cloud.mjs
 *   → public/clouds/corona.pwcloud
 *
 * ## Why generate rather than trace an image
 *
 * SenseRing's Python tool derives a cloud from a source image via edge
 * extraction. That is the right path for artwork, but the hero shape here is
 * *parametric* — a ring with radial flares — so describing it directly avoids
 * shipping a source bitmap, avoids a Python step in CI, and lets the density
 * be tuned by editing a number instead of re-rendering art.
 *
 * The output conforms to the same `.pwcloud` v1.0.0 contract the tool emits
 * (flat encoding, stride 4, fields x/y/w/g, coordinates normalized to 0..1),
 * so the vendored frontend loads it unmodified.
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

/** Groups let the frontend (and future effects) address bands separately. */
const GROUP = { RING: 0, FLARE: 1, CORE: 2, DUST: 3 };

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
const R = 0.3;

// ── 1. The ring itself ──────────────────────────────────────────────
// A soft annulus. Density is modulated by angle so the ring reads as lit
// from one side rather than as a flat circle.
const RING_N = 4200;
for (let i = 0; i < RING_N; i += 1) {
  const theta = rand() * TAU;

  // Brighter along the upper-left arc, thinner opposite.
  const lit = 0.55 + 0.45 * Math.cos(theta - Math.PI * 1.15);
  if (rand() > lit * 0.95 + 0.05) continue;

  const r = gaussian(R, 0.011);
  push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, 0.55 + lit * 0.45, GROUP.RING);
}

// ── 2. Corona flares ────────────────────────────────────────────────
// Radial streamers escaping the ring. Density falls off with distance, so
// the cloud dissolves outward instead of ending at a hard edge.
const FLARES = 34;
for (let f = 0; f < FLARES; f += 1) {
  const baseTheta = (f / FLARES) * TAU + gaussian(0, 0.05);
  const lit = 0.55 + 0.45 * Math.cos(baseTheta - Math.PI * 1.15);
  const reach = (0.1 + rand() * 0.26) * (0.45 + lit);
  const count = Math.floor(46 + rand() * 90);

  for (let i = 0; i < count; i += 1) {
    // t^1.7 biases points toward the base of the flare.
    const t = Math.pow(rand(), 1.7);
    const r = R + t * reach;
    // Streamers splay as they extend.
    const theta = baseTheta + gaussian(0, 0.012 + t * 0.05);
    const w = (1 - t) * 0.8 * (0.5 + lit * 0.5);
    push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, w, GROUP.FLARE);
  }
}

// ── 3. Inner core ───────────────────────────────────────────────────
// A small dense centre — the "ring" of CoronRing needs something to orbit.
const CORE_N = 520;
for (let i = 0; i < CORE_N; i += 1) {
  const theta = rand() * TAU;
  const r = Math.abs(gaussian(0, 0.022));
  push(CX + Math.cos(theta) * r, CY + Math.sin(theta) * r, 0.85 + rand() * 0.15, GROUP.CORE);
}

// ── 4. Ambient dust ─────────────────────────────────────────────────
// Sparse field points. These carry the mouse interaction in the empty
// regions, so the canvas responds to the cursor everywhere, not just on the
// ring.
const DUST_N = 900;
for (let i = 0; i < DUST_N; i += 1) {
  push(rand(), rand(), 0.1 + rand() * 0.22, GROUP.DUST);
}

const cloud = {
  $schema: 'https://sensering.dev/schemas/pwcloud/1.0.0',
  version: '1.0.0',
  meta: {
    source_image: null,
    source_size: [1024, 1024],
    extractor: 'parametric:corona',
    point_count: points.length / 4,
    generated_by: 'scripts/generate-cloud.mjs',
    generator: 'coronring-site/1.0.0',
  },
  encoding: 'flat',
  stride: 4,
  fields: ['x', 'y', 'w', 'g'],
  data: points,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(cloud));

const kb = (JSON.stringify(cloud).length / 1024).toFixed(1);
console.log(`corona.pwcloud — ${cloud.meta.point_count} points, ${kb} kB → ${OUT}`);
