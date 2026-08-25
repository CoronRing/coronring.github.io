/**
 * Client for the particle-wave Python service.
 *
 * The demo has two ways to turn an upload into a point cloud, and the whole
 * point of the project is the difference between them:
 *
 * - **This module** posts the image to the ParticleWave service, which runs the
 *   real extractor — multi-scale edges, CLAHE, Poisson-disc spacing. It is the
 *   same code path the CLI uses, so what the page renders is what the tool
 *   produces.
 * - `image-to-cloud.ts` traces in the tab with a cut-down Sobel port. Faster to
 *   start, visibly coarser, and needs nothing but the browser.
 *
 * Both emit `.pwcloud` v1.0.0 in the flat encoding, so the renderer cannot tell
 * them apart — which is exactly the contract the project is built around, and
 * why the service can be swapped out without the frontend noticing.
 *
 * The service is a free-tier host and the site must not depend on it being up,
 * so callers are expected to fall back to the local tracer on any failure. That
 * is why every error here is thrown rather than surfaced as a partial result.
 */

import type { PwCloud } from './image-to-cloud';

/**
 * Where the service answers.
 *
 * Overridable with `PUBLIC_PARTICLE_WAVE_API` for a local backend or a future
 * domain. The default is baked in because the GitHub Pages build has no `.env`
 * — an unset variable there would silently disable the Python path on the one
 * deployment that matters. The URL is public information, not a credential: it
 * is printed on the service's own status page.
 */
export const API_BASE: string = (
  import.meta.env.PUBLIC_PARTICLE_WAVE_API ?? 'https://129-146-37-132.sslip.io'
).replace(/\/+$/, '');

/** Extraction options. Snake-case because they cross the wire to Python. */
export interface ConvertOptions {
  target_points?: number;
  min_radius?: number;
  max_resolution?: number;
  feature_mode?: 'edges' | 'hybrid' | 'regions';
}

export interface ConvertResult {
  cloud: PwCloud;
  /** How the service described its own work. */
  meta: {
    point_count: number;
    elapsed_ms: number;
    extractor: string;
    /** True when `target_points` bound the result rather than the radius. */
    truncated_to_cap: boolean;
  };
}

/**
 * How long to wait before giving up and tracing locally.
 *
 * Generous enough for a cold container on a shared ARM core, short enough that
 * a visitor on a dead backend is not left watching a spinner: the local tracer
 * finishes well inside a second, so the fallback is barely a pause.
 */
const TIMEOUT_MS = 20_000;

/** Is the service reachable? Used to label the control before anything is sent. */
export async function ping(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      signal,
      // No credentials: the endpoint is open and sending cookies to a
      // third-party origin would only invite them to be blocked.
      credentials: 'omit',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Convert an image to a point cloud on the server.
 *
 * @throws If the service is unreachable, times out, or rejects the upload —
 *   including the deliberate rejections (too large, unsupported format, rate
 *   limited), because the local tracer can still handle most of those.
 */
export async function convertViaApi(
  file: File,
  options: ConvertOptions = {},
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const form = new FormData();
  form.append('image', file);
  form.append('options', JSON.stringify(options));

  // Compose the caller's signal with our own deadline, so an unmount cancels
  // the request just as readily as a timeout does.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  const onAbort = (): void => deadline.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${API_BASE}/api/convert`, {
      method: 'POST',
      body: form,
      signal: deadline.signal,
      credentials: 'omit',
    });

    if (!response.ok) {
      // The service returns `{detail: "..."}` on every deliberate refusal;
      // anything else means it fell over, and the status is all we have.
      const detail = await response
        .json()
        .then((body: { detail?: string }) => body.detail)
        .catch(() => undefined);
      throw new Error(detail ?? `Service returned ${response.status}`);
    }

    const payload = (await response.json()) as ConvertResult;
    if (payload?.cloud?.encoding !== 'flat') {
      throw new Error('Service returned an unrecognised cloud format.');
    }
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
