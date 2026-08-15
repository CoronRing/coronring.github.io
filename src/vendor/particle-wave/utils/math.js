/**
 * @file math.js
 * @description Lightweight 2-D vector math and easing utilities for Particle Wave.
 * All functions are pure and operate on plain numbers (no allocation in hot paths).
 */

// ---------------------------------------------------------------------------
// Vector helpers (operate on component pairs, not objects)
// ---------------------------------------------------------------------------

/** Squared Euclidean distance between (ax,ay) and (bx,by). */
export function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Euclidean distance between (ax,ay) and (bx,by). */
export function dist(ax, ay, bx, by) {
  return Math.sqrt(distSq(ax, ay, bx, by));
}

/** Clamp `v` to [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation from a to b at t ∈ [0,1]. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Map a value from [inLo, inHi] to [outLo, outHi], clamped. */
export function remap(v, inLo, inHi, outLo, outHi) {
  const t = clamp((v - inLo) / (inHi - inLo + 1e-10), 0, 1);
  return lerp(outLo, outHi, t);
}

// ---------------------------------------------------------------------------
// Easing functions (all take t ∈ [0,1], return [0,1])
// ---------------------------------------------------------------------------

/** Quadratic ease-in. */
export function easeInQuad(t) {
  return t * t;
}

/** Quadratic ease-out. */
export function easeOutQuad(t) {
  return t * (2 - t);
}

/** Smooth-step (3t² - 2t³). */
export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Bell curve over [0,1] — peaks at t=0.5.
 * Used for the wave-annulus impulse profile.
 * @param {number} t  ∈ [0, 1]
 */
export function bell(t) {
  return Math.sin(Math.PI * t);
}

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex colour string (#rrggbb or #rgb) into { r, g, b } ∈ [0,255].
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  const s = hex.replace('#', '');
  const full =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  const v = parseInt(full, 16);
  return {
    r: (v >> 16) & 255,
    g: (v >> 8) & 255,
    b: v & 255,
  };
}

/**
 * Build an `rgba(...)` CSS string.
 * @param {{ r, g, b }} rgb
 * @param {number} alpha  ∈ [0, 1]
 */
export function rgbaToCss({ r, g, b }, alpha) {
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------

/**
 * A fast, seedable pseudo-random number generator (xoshiro128**).
 * Returns a closure that produces uniform floats in [0, 1).
 * @param {number} seed  — any 32-bit integer
 * @returns {() => number}
 */
export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  let b = (seed ^ 0x6c62272e) >>> 0;
  let c = (seed ^ 0xa7c1e4f3) >>> 0;
  let d = (seed ^ 0x9f8e3b2d) >>> 0;
  return function () {
    const t = (b << 9) >>> 0;
    let r = Math.imul(a, 5);
    r = ((r << 7) | (r >>> 25)) >>> 0;
    r = Math.imul(r, 9) >>> 0;
    c ^= a;
    d ^= b;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    return (r >>> 0) / 0x100000000;
  };
}

/**
 * Cap the magnitude of force vector (fx, fy) to `maxMag` in-place via array.
 * @param {Float32Array} fx
 * @param {Float32Array} fy
 * @param {number} i      — particle index
 * @param {number} maxMag
 */
export function capForce(fx, fy, i, maxMag) {
  const mag2 = fx[i] * fx[i] + fy[i] * fy[i];
  if (mag2 > maxMag * maxMag) {
    const inv = maxMag / Math.sqrt(mag2);
    fx[i] *= inv;
    fy[i] *= inv;
  }
}
