/**
 * @file Loader.js
 * @description Fetches, validates, and parses .pwcloud point cloud files.
 * Supports both the object encoding and the compact flat-array encoding.
 */

const SUPPORTED_VERSIONS = ['1.0.0'];

/**
 * @typedef {Object} PointCloudMeta
 * @property {string} source_image
 * @property {[number, number]} source_size
 * @property {string} extractor
 * @property {number} point_count
 * @property {string} generated_at
 * @property {string} generator
 */

/**
 * @typedef {Object} PointCloudPoint
 * @property {number} x  — normalised x ∈ [0,1]
 * @property {number} y  — normalised y ∈ [0,1]
 * @property {number} w  — saliency weight ∈ [0,1]
 * @property {number} g  — semantic group index
 */

/**
 * @typedef {Object} ParsedCloud
 * @property {PointCloudMeta} meta
 * @property {Float32Array}   x   — length N
 * @property {Float32Array}   y   — length N
 * @property {Float32Array}   w   — length N
 * @property {Int32Array}     g   — length N
 * @property {number}         N   — point count
 */

export class Loader {
  /**
   * Load a .pwcloud from a URL string or accept a pre-parsed plain object.
   * @param {string | Object} src
   * @param {AbortSignal}     [signal]
   * @returns {Promise<ParsedCloud>}
   */
  static async load(src, signal) {
    let raw;
    if (typeof src === 'string') {
      const res = await fetch(src, { signal });
      if (!res.ok) {
        throw new Error(`[ParticleWave/Loader] HTTP ${res.status} fetching "${src}"`);
      }
      raw = await res.json();
    } else if (src && typeof src === 'object') {
      raw = src;
    } else {
      throw new TypeError('[ParticleWave/Loader] src must be a URL string or a plain object');
    }
    return Loader._parse(raw);
  }

  /**
   * @param {Object} raw
   * @returns {ParsedCloud}
   */
  static _parse(raw) {
    // Version check
    if (!SUPPORTED_VERSIONS.includes(raw.version)) {
      console.warn(
        `[ParticleWave/Loader] Unknown version "${raw.version}". ` +
          `Supported: ${SUPPORTED_VERSIONS.join(', ')}. Proceeding anyway.`,
      );
    }

    const meta = raw.meta ?? {};
    const encoding = raw.encoding ?? 'object';

    let N = 0;
    let x, y, w, g;

    if (encoding === 'flat') {
      // Compact: data is [x0,y0,w0,g0, x1,y1,w1,g1, ...]
      const stride = raw.stride ?? 4;
      const fields = raw.fields ?? ['x', 'y', 'w', 'g'];
      const data = raw.data;
      N = Math.floor(data.length / stride);

      const xi = fields.indexOf('x');
      const yi = fields.indexOf('y');
      const wi = fields.indexOf('w');
      const gi = fields.indexOf('g');

      x = new Float32Array(N);
      y = new Float32Array(N);
      w = new Float32Array(N);
      g = new Int32Array(N);

      for (let i = 0; i < N; i++) {
        const base = i * stride;
        x[i] = xi >= 0 ? data[base + xi] : 0;
        y[i] = yi >= 0 ? data[base + yi] : 0;
        w[i] = wi >= 0 ? data[base + wi] : 1;
        g[i] = gi >= 0 ? data[base + gi] : 0;
      }
    } else {
      // Object encoding: points array
      const pts = raw.points ?? [];
      N = pts.length;
      x = new Float32Array(N);
      y = new Float32Array(N);
      w = new Float32Array(N);
      g = new Int32Array(N);
      for (let i = 0; i < N; i++) {
        x[i] = pts[i].x ?? 0;
        y[i] = pts[i].y ?? 0;
        w[i] = pts[i].w ?? 1;
        g[i] = pts[i].g ?? 0;
      }
    }

    if (N === 0) {
      throw new Error('[ParticleWave/Loader] Point cloud is empty');
    }

    // Validate value ranges (warn only — don't throw)
    let oobCount = 0;
    for (let i = 0; i < N; i++) {
      if (x[i] < 0 || x[i] > 1 || y[i] < 0 || y[i] > 1) oobCount++;
    }
    if (oobCount > 0) {
      console.warn(
        `[ParticleWave/Loader] ${oobCount}/${N} points have coordinates outside [0,1]. ` +
          'They will be clamped by the renderer.',
      );
    }

    return { meta, x, y, w, g, N };
  }
}
