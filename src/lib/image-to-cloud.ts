/**
 * Browser-side image → point cloud extraction.
 *
 * A port of the idea behind SenseRing's Python extractor, cut down to what
 * runs comfortably in a tab: luminance, a Sobel gradient, and importance
 * sampling weighted by edge strength. The Python tool does a better job
 * (multi-scale edges, Poisson-disc spacing); this one exists so the demo can
 * take an upload and respond immediately, with no server and no round trip.
 *
 * Output conforms to the `.pwcloud` v1.0.0 flat encoding, so it can be handed
 * straight to `ParticleWave.init({ src })` — the loader accepts a pre-parsed
 * object as readily as a URL.
 */

/** A `.pwcloud` v1.0.0 document in the compact flat encoding. */
export interface PwCloud {
  version: '1.0.0';
  meta: {
    source_image: string | null;
    source_size: [number, number];
    extractor: string;
    point_count: number;
    generator: string;
  };
  encoding: 'flat';
  stride: 4 | 7;
  fields: string[];
  data: number[];
}

export interface ExtractOptions {
  /** How many points to sample. Cost is linear; 6–8k is a good ceiling. */
  targetPoints?: number;
  /** Longest edge of the analysis raster, px. Detail beyond this is wasted. */
  maxDimension?: number;
  /**
   * Contrast applied to edge strength before sampling. Above 1 concentrates
   * points on the strongest edges; below 1 spreads them over weak ones too.
   */
  edgeGamma?: number;
  /**
   * Share of the weight given to filled areas rather than edges, 0..1. At 0
   * the result is a pure outline; at ~0.35 solid regions keep some presence,
   * which stops large flat shapes from vanishing.
   */
  fillRatio?: number;
  /** Seed for the sampler, so the same image yields the same cloud. */
  seed?: number;
}

const DEFAULTS: Required<ExtractOptions> = {
  targetPoints: 6000,
  maxDimension: 420,
  edgeGamma: 0.85,
  fillRatio: 0.35,
  seed: 1,
};

/** mulberry32 — deterministic, so re-extracting an image is reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Decode a file to a bitmap, preferring the codec-backed path when present. */
async function decode(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(source);
  }
  // Safari < 15 and friends: fall back to an <img> and an object URL.
  const url = URL.createObjectURL(source);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode that image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert an image file into a point cloud.
 *
 * @throws if the file cannot be decoded, or the canvas is tainted.
 */
export async function imageToCloud(source: Blob, options: ExtractOptions = {}): Promise<PwCloud> {
  const opts = { ...DEFAULTS, ...options };
  const bitmap = await decode(source);

  const srcW = 'width' in bitmap ? bitmap.width : 0;
  const srcH = 'height' in bitmap ? bitmap.height : 0;
  if (!srcW || !srcH) throw new Error('That image has no dimensions.');

  // Analyse at a reduced size: sampling density, not pixel count, sets quality.
  const scale = Math.min(1, opts.maxDimension / Math.max(srcW, srcH));
  const W = Math.max(2, Math.round(srcW * scale));
  const H = Math.max(2, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, W, H);
  if ('close' in bitmap) bitmap.close();

  const { data: rgba } = ctx.getImageData(0, 0, W, H);

  // ── Luminance, premultiplied against alpha ────────────────────────
  // Transparent pixels must read as background, not as black: a logo on a
  // transparent ground would otherwise come out as a solid filled rectangle.
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < lum.length; i += 1, p += 4) {
    const a = rgba[p + 3]! / 255;
    const l = (0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!) / 255;
    alpha[i] = a;
    lum[i] = l * a + (1 - a) * 1; // composite over white
    histogram[Math.min(255, (lum[i]! * 255) | 0)]! += 1;
  }

  /*
   * Background level, as the median rather than the mean.
   *
   * The mean sits between subject and background, so on a dark logo over
   * white every background pixel still scored a third of full weight — with
   * far more background than subject, roughly half the sampled points landed
   * on empty paper and the trace came out as a filled rectangle. The median
   * of a subject-on-ground image *is* the ground, which drives those to zero.
   */
  let seen = 0;
  let background = 1;
  for (let v = 0; v < 256; v += 1) {
    seen += histogram[v]!;
    if (seen >= lum.length / 2) {
      background = v / 255;
      break;
    }
  }

  // ── Sobel gradient magnitude ──────────────────────────────────────
  const mag = new Float32Array(W * H);
  let maxMag = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const tl = lum[i - W - 1]!;
      const tc = lum[i - W]!;
      const tr = lum[i - W + 1]!;
      const ml = lum[i - 1]!;
      const mr = lum[i + 1]!;
      const bl = lum[i + W - 1]!;
      const bc = lum[i + W]!;
      const br = lum[i + W + 1]!;
      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br);
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag > 0) {
    for (let i = 0; i < mag.length; i += 1) mag[i]! /= maxMag;
  }

  // ── Sampling weights ──────────────────────────────────────────────
  // "Ink" is departure from the background level, so the extractor works on
  // dark-on-light and light-on-dark alike without being told which it is.
  // The deadband discards JPEG mottle and gradient backdrops that would
  // otherwise read as faint subject everywhere.
  const DEADBAND = 0.06;
  const weight = new Float32Array(W * H);
  let total = 0;
  for (let i = 0; i < weight.length; i += 1) {
    const departure = Math.abs(lum[i]! - background);
    const ink = Math.min(1, Math.max(0, departure - DEADBAND) * 2.5) * alpha[i]!;
    const edge = Math.pow(mag[i]!, opts.edgeGamma) * alpha[i]!;
    const w = edge * (1 - opts.fillRatio) + ink * opts.fillRatio;
    weight[i] = w;
    total += w;
  }

  // A blank or uniform image has nothing to trace; spread points evenly so
  // the demo still shows something rather than failing.
  if (total <= 1e-6) {
    weight.fill(1);
    total = weight.length;
  }

  // ── Importance sampling via CDF + binary search ───────────────────
  const cdf = new Float32Array(weight.length);
  let acc = 0;
  for (let i = 0; i < weight.length; i += 1) {
    acc += weight[i]!;
    cdf[i] = acc;
  }

  const rand = makeRandom(opts.seed);
  const data: number[] = [];
  for (let n = 0; n < opts.targetPoints; n += 1) {
    const target = rand() * acc;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const px = lo % W;
    const py = (lo / W) | 0;
    // Jitter inside the pixel, otherwise points land on a visible lattice.
    const x = (px + rand()) / W;
    const y = (py + rand()) / H;
    const w = Math.min(1, Math.max(0.08, mag[lo]! * 0.75 + 0.25));
    const r = rgba[lo * 4] ?? 255;
    const g = rgba[lo * 4 + 1] ?? 255;
    const b = rgba[lo * 4 + 2] ?? 255;
    data.push(
      Number(x.toFixed(4)),
      Number(y.toFixed(4)),
      Number(w.toFixed(2)),
      0,
      r,
      g,
      b
    );
  }

  return {
    version: '1.0.0',
    meta: {
      source_image: source instanceof File ? source.name : null,
      source_size: [W, H],
      extractor: 'browser:sobel-importance',
      point_count: data.length / 7,
      generator: 'coronring-site/1.1.0',
    },
    encoding: 'flat',
    stride: 7,
    fields: ['x', 'y', 'w', 'g', 'r', 'g_col', 'b'],
    data,
  };
}
