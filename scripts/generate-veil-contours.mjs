/**
 * Generate the loading veil's contour-line backdrop.
 *
 * Writes `public/media/veil/contours.svg`: a topographic field of closed,
 * smoothed rings around a few peaks, drawn as black strokes on transparency.
 * The veil uses the file as a CSS *mask* over its own foreground colour, so a
 * single file serves the dark veil and the light one.
 *
 * ## Why a file and not inline SVG
 *
 * The veil's markup is on every page. Inlined, these rings would add tens of
 * kilobytes to every HTML response; as a mask image they are fetched once,
 * cached, and only when the veil is actually shown (a `hidden` element's
 * images are not requested).
 *
 * The field is seeded, so a re-run produces a byte-identical file. Change
 * `SEED` (or the peaks) to draw a different landscape.
 *
 *   node scripts/generate-veil-contours.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1600;
const H = 1000;
const SEED = 0x5eed;
const POINTS = 40;

/** Peaks: centre, ring count, ring spacing, how far the rings wander. */
const PEAKS = [
  { x: 1180, y: 330, rings: 16, step: 34, wobble: 0.16 },
  { x: 260, y: 860, rings: 13, step: 30, wobble: 0.2 },
  { x: 520, y: -180, rings: 9, step: 40, wobble: 0.12 },
];

/** mulberry32: small, seedable, good enough for art. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(SEED);
const f = (n) => n.toFixed(1);

/**
 * One closed ring, smoothed by running quadratic curves through the midpoints
 * of a jittered polygon. Neighbouring rings share the same low-frequency
 * harmonics so they nest like real contours instead of crossing.
 */
function ring(peak, radius, harmonics) {
  const pts = [];
  for (let i = 0; i < POINTS; i += 1) {
    const t = (i / POINTS) * Math.PI * 2;
    let r = radius;
    for (const h of harmonics)
      r += radius * h.amp * Math.sin(h.freq * t + h.phase + radius * h.drift);
    pts.push([peak.x + r * Math.cos(t), peak.y + r * Math.sin(t) * 0.82]);
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[POINTS - 1], pts[0]);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < POINTS; i += 1) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % POINTS]);
    d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

const paths = [];
for (const peak of PEAKS) {
  const harmonics = [2, 3, 5].map((freq) => ({
    freq,
    amp: (peak.wobble * (0.5 + rand())) / freq,
    phase: rand() * Math.PI * 2,
    drift: 0.002 + rand() * 0.004,
  }));
  for (let k = 1; k <= peak.rings; k += 1) {
    /* Every fifth ring is an index contour, drawn heavier, as on a survey map. */
    const index = k % 5 === 0;
    paths.push(
      `<path d="${ring(peak, k * peak.step, harmonics)}" stroke-width="${index ? 1.6 : 0.8}"/>`,
    );
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#000">${paths.join('')}</svg>\n`;

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'media',
  'veil',
  'contours.svg',
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${paths.length} rings)`);
