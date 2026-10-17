/**
 * Reading an exhibit's picture back as points.
 *
 * When the deck cuts between two drawn exhibits (the Railtracks flow, the
 * Particle Wave cloud, the NewsRing dial), the outgoing picture does not
 * vanish: it comes apart into particles and they reform as the incoming one
 * (see `morph.ts`). This module does the reading, for both ends: the picture
 * leaving, and the first frame of the one arriving.
 *
 * Only the *shape* layer is sampled, never the type. A drawn exhibit keeps its
 * labels on a canvas of its own for exactly this reason: text sampled into
 * particles reads as noise, while nodes and lines read as the thing they were.
 * The labels still travel, as part of `overlay`, which is faded out over the
 * particles so the cut has no gap in it.
 */

/** A picture read back as points. */
export interface SeedCloud {
  /** `x, y` pairs, normalised to the box (0..1). */
  readonly points: Float32Array;
  /** `r, g, b` per point: the colour the picture had there. */
  readonly colors: Uint8Array;
  /** Where the box was on screen when it was read, CSS pixels. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The picture, labels included, to cross-fade over the particles. */
  readonly overlay: HTMLCanvasElement;
}

/**
 * What a drawn stage hands the deck: a function that reads its picture back.
 *
 * Returns `null` when there is nothing worth handing over yet (not started,
 * not sized, nothing drawn), in which case the caller tries again next frame
 * or cuts without a morph.
 */
export type Snapshot = () => SeedCloud | null;

interface SampleOptions {
  /** Upper bound on points. */
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
 * lattice once it moves. When the picture is denser than `maxPoints`, a
 * uniform subsample keeps its proportions.
 *
 * @param shape   The shape layer only: lines and nodes, no text.
 * @param layers  Every layer, painted bottom first into the cross-fade overlay.
 */
export function sampleCanvas(
  shape: HTMLCanvasElement,
  layers: readonly HTMLCanvasElement[],
  { maxPoints = 5200, step = 2.5, threshold = 46 }: SampleOptions = {},
): SeedCloud | null {
  const rect = shape.getBoundingClientRect();
  const { width, height } = rect;
  if (!width || !height || !shape.width || !shape.height) return null;

  const ctx = shape.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const scale = shape.width / width;
  const cell = Math.max(1, Math.round(step * scale));
  const { data } = ctx.getImageData(0, 0, shape.width, shape.height);

  const found: number[] = [];
  const tints: number[] = [];
  for (let py = 0; py < shape.height; py += cell) {
    for (let px = 0; px < shape.width; px += cell) {
      const at = (py * shape.width + px) * 4;
      const alpha = data[at + 3] ?? 0;
      if (alpha < threshold) continue;
      const jx = px + Math.random() * cell;
      const jy = py + Math.random() * cell;
      found.push(jx / shape.width, jy / shape.height);
      tints.push(data[at] ?? 255, data[at + 1] ?? 255, data[at + 2] ?? 255);
    }
  }

  const count = found.length / 2;
  if (count < 40) return null;

  const keep = Math.min(count, maxPoints);
  const points = new Float32Array(keep * 2);
  const colors = new Uint8Array(keep * 3);
  // Uniform subsample by stride with a random phase, so dense regions stay dense.
  const stride = count / keep;
  let phase = Math.random() * stride;
  for (let i = 0; i < keep; i += 1) {
    const src = Math.min(count - 1, Math.floor(phase));
    points[i * 2] = found[src * 2] ?? 0;
    points[i * 2 + 1] = found[src * 2 + 1] ?? 0;
    colors[i * 3] = tints[src * 3] ?? 255;
    colors[i * 3 + 1] = tints[src * 3 + 1] ?? 255;
    colors[i * 3 + 2] = tints[src * 3 + 2] ?? 255;
    phase += stride;
  }

  const overlay = document.createElement('canvas');
  overlay.width = shape.width;
  overlay.height = shape.height;
  const octx = overlay.getContext('2d');
  if (octx) for (const layer of layers) octx.drawImage(layer, 0, 0, overlay.width, overlay.height);

  return { points, colors, left: rect.left, top: rect.top, width, height, overlay };
}
