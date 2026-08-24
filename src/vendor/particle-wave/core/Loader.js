/**
 * @file Loader.js
 * @description Fetches, validates, and parses .pwcloud point cloud files.
 * Supports both the object encoding and the compact flat-array encoding,
 * as well as optional per-particle color data.
 */

const SUPPORTED_VERSIONS = ['1.0.0', '1.1.0'];

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
 * @typedef {Object} ParsedCloud
 * @property {PointCloudMeta} meta
 * @property {Float32Array}   x       — length N
 * @property {Float32Array}   y       — length N
 * @property {Float32Array}   w       — length N
 * @property {Int32Array}     g       — length N
 * @property {Uint8Array|null} colors — length N*3 (RGB) or null
 * @property {number}         N       — point count
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
        `Supported: ${SUPPORTED_VERSIONS.join(', ')}. Proceeding anyway.`
      );
    }

    const meta = raw.meta ?? {};
    const encoding = raw.encoding ?? 'object';

    let N = 0;
    let x, y, w, g;
    let colors = null;

    if (encoding === 'flat') {
      const stride = raw.stride ?? 4;
      const fields = raw.fields ?? ['x', 'y', 'w', 'g'];
      const data = raw.data;
      N = Math.floor(data.length / stride);

      const xi = fields.indexOf('x');
      const yi = fields.indexOf('y');
      const wi = fields.indexOf('w');
      const gi = fields.indexOf('g');
      const ri = fields.indexOf('r');
      const gi_c = fields.indexOf('g_col') !== -1 ? fields.indexOf('g_col') : fields.indexOf('gc');
      const bi = fields.indexOf('b');

      x = new Float32Array(N);
      y = new Float32Array(N);
      w = new Float32Array(N);
      g = new Int32Array(N);

      if (raw.colors && raw.colors.length >= N * 3) {
        colors = new Uint8Array(raw.colors);
      } else if (ri >= 0 && gi_c >= 0 && bi >= 0) {
        colors = new Uint8Array(N * 3);
        for (let i = 0; i < N; i++) {
          const base = i * stride;
          colors[i * 3]     = Math.round(data[base + ri]);
          colors[i * 3 + 1] = Math.round(data[base + gi_c]);
          colors[i * 3 + 2] = Math.round(data[base + bi]);
        }
      }

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

      if (raw.colors && raw.colors.length >= N * 3) {
        colors = new Uint8Array(raw.colors);
      } else if (pts.length > 0 && pts[0].c && pts[0].c.length === 3) {
        colors = new Uint8Array(N * 3);
        for (let i = 0; i < N; i++) {
          colors[i * 3]     = pts[i].c[0];
          colors[i * 3 + 1] = pts[i].c[1];
          colors[i * 3 + 2] = pts[i].c[2];
        }
      }

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

    return { meta, x, y, w, g, colors, N };
  }
}
