/**
 * Handing one exhibit's picture to the particle engine.
 *
 * When the deck cuts from a drawn exhibit (the Railtracks flow, the NewsRing
 * ring) to Particle Wave, the outgoing picture should not vanish: it comes
 * apart into particles and those particles are pulled into the corona. The
 * engine can already do the second half (`morphTo`), so all this module does
 * is the first: read the outgoing canvas back as a point cloud the engine can
 * be started on.
 *
 * Only the *shape* layer is sampled, never the type. A drawn exhibit keeps its
 * labels on a canvas of its own for exactly this reason: text sampled into
 * particles reads as noise, while nodes and lines read as the thing they were.
 * The labels still travel, as part of `overlay`, which is faded out over the
 * particles so the cut has no gap in it.
 */

/** A picture read back as points, in the coordinate space of the exhibit box. */
export interface SeedCloud {
  /** `x, y, weight` triplets, `x` and `y` normalised to the box (0..1). */
  readonly points: Float32Array;
  /** CSS pixel size of the box the points were read from. */
  readonly width: number;
  readonly height: number;
  /** The outgoing picture, labels included, to cross-fade over the particles. */
  readonly overlay: HTMLCanvasElement;
}

/**
 * What a drawn stage hands the deck: a function that reads its picture back.
 *
 * Returns `null` when there is nothing worth handing over yet (not started,
 * not sized), in which case the engine starts on its own cloud as usual.
 */
export type Snapshot = () => SeedCloud | null;

interface SampleOptions {
  /** Upper bound on points. The engine is built for 8,200 slots. */
  maxPoints?: number;
  /** Grid step in CSS pixels. Smaller reads finer lines and costs more points. */
  step?: number;
  /** Alpha (0..255) below which a pixel counts as empty. */
  threshold?: number;
}

/**
 * Read a canvas back as a point cloud.
 *
 * A pixel grid at `step` CSS pixels, keeping cells whose alpha clears
 * `threshold`, each jittered inside its cell so the result does not read as a
 * lattice once the engine draws it. When the picture is denser than
 * `maxPoints`, a uniform subsample keeps its proportions.
 *
 * @param shape   The shape layer only: lines and nodes, no text.
 * @param layers  Every layer, painted bottom first into the cross-fade overlay.
 */
export function sampleCanvas(
  shape: HTMLCanvasElement,
  layers: readonly HTMLCanvasElement[],
  { maxPoints = 5200, step = 2.5, threshold = 46 }: SampleOptions = {},
): SeedCloud | null {
  const width = shape.clientWidth;
  const height = shape.clientHeight;
  if (!width || !height || !shape.width || !shape.height) return null;

  const ctx = shape.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const scale = shape.width / width;
  const cell = Math.max(1, Math.round(step * scale));
  const { data } = ctx.getImageData(0, 0, shape.width, shape.height);

  const found: number[] = [];
  for (let py = 0; py < shape.height; py += cell) {
    for (let px = 0; px < shape.width; px += cell) {
      const alpha = data[(py * shape.width + px) * 4 + 3] ?? 0;
      if (alpha < threshold) continue;
      const jx = px + Math.random() * cell;
      const jy = py + Math.random() * cell;
      found.push(jx / shape.width, jy / shape.height, 0.45 + (alpha / 255) * 0.55);
    }
  }

  const count = found.length / 3;
  if (count < 40) return null;

  const keep = Math.min(count, maxPoints);
  const points = new Float32Array(keep * 3);
  // Uniform subsample by stride with a random phase, so dense regions stay dense.
  const stride = count / keep;
  let phase = Math.random() * stride;
  for (let i = 0; i < keep; i += 1) {
    const src = Math.min(count - 1, Math.floor(phase)) * 3;
    points[i * 3] = found[src] ?? 0;
    points[i * 3 + 1] = found[src + 1] ?? 0;
    points[i * 3 + 2] = found[src + 2] ?? 1;
    phase += stride;
  }

  const overlay = document.createElement('canvas');
  overlay.width = shape.width;
  overlay.height = shape.height;
  const octx = overlay.getContext('2d');
  if (octx) for (const layer of layers) octx.drawImage(layer, 0, 0, overlay.width, overlay.height);

  return { points, width, height, overlay };
}

/**
 * The seed as a `.pwcloud` object the engine can be started on.
 *
 * The engine fits a cloud into its canvas with `padding` on every side, so the
 * normalised coordinates are pushed out by that padding first: started on this
 * cloud, every particle lands on the pixel it was read from. `source_size` is
 * the box itself, so `fit` neither letterboxes nor stretches it.
 *
 * Group 0 throughout, which the deck's spin table holds still: the picture
 * should come apart, not start turning first.
 */
export function seedToCloud(seed: SeedCloud, padding: number): object {
  const span = 1 - 2 * padding;
  const n = seed.points.length / 3;
  const data: number[] = new Array<number>(n * 4);
  for (let i = 0; i < n; i += 1) {
    const x = seed.points[i * 3] ?? 0;
    const y = seed.points[i * 3 + 1] ?? 0;
    data[i * 4] = (x - padding) / span;
    data[i * 4 + 1] = (y - padding) / span;
    data[i * 4 + 2] = seed.points[i * 3 + 2] ?? 1;
    data[i * 4 + 3] = 0;
  }
  return {
    version: '1.0.0',
    meta: {
      source_image: null,
      source_size: [Math.round(seed.width), Math.round(seed.height)],
      extractor: 'deck:snapshot',
      point_count: n,
      generator: 'coronring-site',
    },
    encoding: 'flat',
    stride: 4,
    fields: ['x', 'y', 'w', 'g'],
    data,
  };
}
