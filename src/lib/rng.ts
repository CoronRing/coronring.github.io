/**
 * Random generation with a reproducible mode.
 *
 * Two sources, and the difference matters more than it looks:
 *
 * - **Seeded.** A deterministic PRNG (xoshiro128\*\*) driven by a hashed string
 *   seed. Same seed plus same settings gives the same output on any machine,
 *   which is what makes a generated fixture usable in a test.
 * - **System.** `crypto.getRandomValues`, seeded by the OS. Unpredictable and
 *   therefore not reproducible. The right choice for a token, the wrong one for
 *   a fixture.
 *
 * Neither is exposed as "just random". A generator that silently picks one is a
 * generator whose output you cannot reason about: `Math.random()` is neither
 * reproducible nor safe for anything secret, which is the worst of both.
 *
 * @see src/components/tools/RandomKit.tsx for the UI over this.
 */

/* ── Sources ──────────────────────────────────────────────────────────── */

/** A source of uniform floats in `[0, 1)`. */
export type Source = () => number;

/**
 * FNV-1a over the seed string, expanded to four 32-bit words.
 *
 * The expansion is not decoration. xoshiro's state must not be all zeros, and a
 * naive `[hash, 0, 0, 0]` initialisation puts nearly all of the state at zero,
 * which leaves the first few dozen outputs visibly correlated with the seed.
 * Stirring the hash through four rounds gives every word entropy before the
 * generator starts.
 */
function seedState(seed: string): [number, number, number, number] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const words: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    words.push(h >>> 0);
  }
  return [words[0] ?? 1, words[1] ?? 2, words[2] ?? 3, words[3] ?? 4];
}

/**
 * xoshiro128\*\* — small, fast, and statistically sound for this job.
 *
 * Chosen over a linear congruential generator because an LCG's low bits are
 * famously non-random, and "pick an integer in a small range" reads exactly
 * those bits.
 */
export function seededSource(seed: string): Source {
  let [a, b, c, d] = seedState(seed || '0');
  return () => {
    const t = Math.imul(b, 5);
    const r = (((t << 7) | (t >>> 25)) >>> 0) * 9;
    const e = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= e;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    // 2^32 divisor rather than 2^32-1: the result must be able to reach 0 and
    // must never reach 1, which is what every consumer below assumes.
    return (r >>> 0) / 4294967296;
  };
}

/**
 * The platform CSPRNG, drawn in blocks.
 *
 * Blocked rather than one call per value because `getRandomValues` is a
 * syscall-shaped operation, and generating 100,000 numbers one at a time is
 * measurably slower than filling a page at a time.
 */
export function systemSource(): Source {
  const block = new Uint32Array(256);
  let cursor = block.length;
  return () => {
    if (cursor >= block.length) {
      crypto.getRandomValues(block);
      cursor = 0;
    }
    const value = block[cursor] ?? 0;
    cursor += 1;
    return value / 4294967296;
  };
}

/* ── Distributions ────────────────────────────────────────────────────── */

export type Distribution = 'uniform' | 'normal' | 'exponential' | 'triangular';

export const DISTRIBUTIONS: ReadonlyArray<{
  readonly value: Distribution;
  readonly label: string;
  readonly note: string;
}> = [
  {
    value: 'uniform',
    label: 'Uniform',
    note: 'Every value in the range is equally likely. The default, and what people usually mean by random.',
  },
  {
    value: 'normal',
    label: 'Normal',
    note: 'Clustered around the midpoint. Sampled then clamped to the range, so the two ends are slightly over-represented.',
  },
  {
    value: 'exponential',
    label: 'Exponential',
    note: 'Heavily weighted toward the minimum with a long tail. Models waiting times and request gaps.',
  },
  {
    value: 'triangular',
    label: 'Triangular',
    note: 'Peaks at the midpoint and falls linearly to both ends. The cheap stand-in for a normal on a bounded range.',
  },
];

/**
 * Draw one float in `[min, max)` from the chosen shape.
 *
 * Every non-uniform shape is unbounded in at least one direction, so each is
 * mapped onto the range and then clamped. Clamping piles probability onto the
 * endpoints rather than distorting the interior, which is the honest trade and
 * is called out in the `note` above.
 */
function draw(source: Source, min: number, max: number, dist: Distribution): number {
  const span = max - min;
  switch (dist) {
    case 'uniform':
      return min + source() * span;

    case 'normal': {
      // Box-Muller. `1 - u` rather than `u` so a returned 0 cannot reach log(0).
      const u = 1 - source();
      const v = source();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      // Three sigma across the half-range: ~99.7% of draws land inside without
      // clamping, so the endpoint pile-up stays negligible.
      const value = min + span / 2 + (z * span) / 6;
      return Math.min(max, Math.max(min, value));
    }

    case 'exponential': {
      const u = 1 - source();
      // Mean at a fifth of the range, so the tail is visible but most of the
      // mass lands in the first half.
      const value = min - Math.log(u) * (span / 5);
      return Math.min(max, Math.max(min, value));
    }

    case 'triangular': {
      // The sum of two uniforms is triangular, exactly, with no clamping needed.
      return min + ((source() + source()) / 2) * span;
    }
  }
}

/* ── Requests ─────────────────────────────────────────────────────────── */

export interface NumberRequest {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  /** Integers are drawn on the closed range `[min, max]`; floats on `[min, max)`. */
  readonly integer: boolean;
  /** Decimal places for float output. Ignored when `integer`. */
  readonly precision: number;
  readonly distribution: Distribution;
  /** Reject duplicates. Only meaningful for integers over a range wider than `count`. */
  readonly unique: boolean;
  readonly sort: 'none' | 'asc' | 'desc';
}

export interface NumberResult {
  readonly values: readonly number[];
  /**
   * Set when `unique` was asked for and could not be honoured in full.
   *
   * Reported rather than thrown: returning 900 of a requested 1,000 with an
   * explanation is more useful than an error, but returning 900 silently would
   * be a lie about the count.
   */
  readonly shortfall?: string;
  readonly stats: {
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
    readonly stdev: number;
  };
}

/** Hard ceiling on one draw, so a stray keystroke cannot hang the tab. */
export const MAX_COUNT = 100_000;

/**
 * Generate a list of numbers.
 *
 * Unique integer draws switch strategy on density. Rejection sampling is fast
 * while the range is much wider than the count and degenerates badly as it
 * fills, so once the request wants more than a third of the available integers
 * it shuffles the range instead: a partial Fisher-Yates is O(count) and cannot
 * fail to terminate, where rejection sampling on a nearly-full range spends
 * most of its time rejecting.
 */
export function generateNumbers(request: NumberRequest, source: Source): NumberResult {
  const count = Math.max(0, Math.min(MAX_COUNT, Math.floor(request.count)));
  const lo = Math.min(request.min, request.max);
  const hi = Math.max(request.min, request.max);

  let values: number[];
  let shortfall: string | undefined;

  if (request.integer) {
    // Closed range: `randomInt(1, 6)` must be able to return 6, because that is
    // what anyone asking for a dice roll means.
    const span = Math.floor(hi) - Math.ceil(lo) + 1;
    const base = Math.ceil(lo);

    if (!request.unique) {
      values = Array.from({ length: count }, () =>
        Math.min(Math.floor(hi), base + Math.floor(draw(source, 0, span, request.distribution))),
      );
    } else if (span <= 0) {
      values = [];
      shortfall = 'The range holds no integers.';
    } else if (count > span) {
      values = shuffledRange(base, span, span, source);
      shortfall = `The range holds only ${span.toLocaleString('en-US')} distinct integers, so that is how many came back.`;
    } else if (count * 3 > span) {
      values = shuffledRange(base, span, count, source);
    } else {
      const seen = new Set<number>();
      values = [];
      // Bounded so a pathological distribution cannot spin forever: the branch
      // above guarantees the range is at least 3x the count, so this ceiling is
      // never reached in practice.
      const ceiling = count * 40 + 100;
      for (let tries = 0; values.length < count && tries < ceiling; tries += 1) {
        const value = Math.min(
          Math.floor(hi),
          base + Math.floor(draw(source, 0, span, request.distribution)),
        );
        if (!seen.has(value)) {
          seen.add(value);
          values.push(value);
        }
      }
      if (values.length < count) {
        shortfall = `Stopped at ${values.length.toLocaleString('en-US')}: the distribution kept landing on values already drawn.`;
      }
    }
  } else {
    const factor = 10 ** Math.max(0, Math.min(12, Math.floor(request.precision)));
    values = Array.from(
      { length: count },
      () => Math.round(draw(source, lo, hi, request.distribution) * factor) / factor,
    );
    if (request.unique) {
      const seen = new Set(values);
      if (seen.size < values.length) {
        values = [...seen];
        shortfall = `${(count - values.length).toLocaleString('en-US')} duplicate values were dropped. Rounded floats collide more often than you would expect.`;
      }
    }
  }

  if (request.sort === 'asc') values.sort((a, b) => a - b);
  if (request.sort === 'desc') values.sort((a, b) => b - a);

  return { values, shortfall, stats: describe(values) };
}

/** Partial Fisher-Yates over a sparse map, so the full range is never allocated. */
function shuffledRange(base: number, span: number, take: number, source: Source): number[] {
  const swapped = new Map<number, number>();
  const at = (i: number): number => swapped.get(i) ?? i;
  const out: number[] = [];
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(source() * (span - i));
    out.push(base + at(j));
    swapped.set(j, at(i));
  }
  return out;
}

/** Summary statistics, computed once so the UI does not recompute per render. */
export function describe(values: readonly number[]): NumberResult['stats'] {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stdev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return {
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    mean,
    median,
    stdev: Math.sqrt(variance),
  };
}

/* ── List operations ──────────────────────────────────────────────────── */

export type ListMode = 'shuffle' | 'sample' | 'pick';

/**
 * Reorder or draw from a list the caller supplies.
 *
 * `sample` draws without replacement (a raffle), `pick` draws with replacement
 * (a die with one face per item). Both are offered because the distinction is
 * the whole question when the list is short.
 */
export function operateOnList(
  items: readonly string[],
  mode: ListMode,
  count: number,
  source: Source,
): string[] {
  if (items.length === 0) return [];

  if (mode === 'pick') {
    return Array.from(
      { length: Math.max(0, Math.min(MAX_COUNT, count)) },
      () => items[Math.floor(source() * items.length)] ?? '',
    );
  }

  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(source() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return mode === 'shuffle' ? pool : pool.slice(0, Math.max(0, Math.min(pool.length, count)));
}

/* ── Strings and identifiers ──────────────────────────────────────────── */

export interface AlphabetOption {
  readonly value: string;
  readonly label: string;
  readonly chars: string;
  readonly note?: string;
}

export const ALPHABETS: readonly AlphabetOption[] = [
  { value: 'hex', label: 'Hex', chars: '0123456789abcdef' },
  {
    value: 'alnum',
    label: 'Alphanumeric',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  },
  {
    value: 'base58',
    label: 'Base58',
    chars: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    note: 'Alphanumeric without 0, O, I or l. Meant to be read aloud and retyped without error.',
  },
  {
    value: 'urlsafe',
    label: 'URL-safe',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
    note: 'The base64url alphabet. Survives a query string without escaping.',
  },
  {
    value: 'strong',
    label: 'With symbols',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+-=?@^_~',
    note: 'Shell metacharacters are excluded, so the result can be pasted into a command without quoting surprises.',
  },
  { value: 'digits', label: 'Digits only', chars: '0123456789' },
];

/**
 * Draw a random string, rejecting the modulo bias.
 *
 * `floor(source() * len)` is uniform to within a rounding error here, because
 * the source yields 32 bits and no alphabet is anywhere near that size. The
 * comment exists because the naive version of this function with a byte source
 * is a real and common bug: `byte % 62` favours the first 8 characters by about
 * 1.6%, which matters for a secret and never announces itself.
 */
export function randomString(length: number, chars: string, source: Source): string {
  if (chars.length === 0) return '';
  let out = '';
  for (let i = 0; i < Math.max(0, Math.min(4096, length)); i += 1) {
    out += chars[Math.floor(source() * chars.length)];
  }
  return out;
}

/**
 * A version 4 UUID, from the given source.
 *
 * `crypto.randomUUID` is not used, deliberately: it cannot be seeded, and this
 * tool's whole point is that the seeded mode is reproducible. With the system
 * source the output is identical in distribution to `randomUUID`.
 */
export function uuid4(source: Source): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(source() * 256);
  // Version 4, variant 1 — the two fields that make it a well-formed v4 rather
  // than 16 random bytes with hyphens in it.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Shannon entropy of one draw from an alphabet, in bits.
 *
 * Shown next to generated secrets because "16 characters" is not a strength and
 * "95 bits" is. The figure assumes a uniform source, which the seeded mode is
 * not in any security sense — the UI says so where it matters.
 */
export function entropyBits(length: number, alphabetSize: number): number {
  if (alphabetSize <= 1 || length <= 0) return 0;
  return length * Math.log2(alphabetSize);
}

/* ── Dice ─────────────────────────────────────────────────────────────── */

export interface DiceRoll {
  readonly notation: string;
  readonly rolls: readonly number[];
  readonly modifier: number;
  readonly total: number;
}

const DICE_RE = /^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/;

/**
 * Roll standard dice notation: `3d6`, `d20`, `2d8+1`.
 *
 * Returns null on anything unparseable rather than guessing, so the UI can say
 * "that is not dice notation" instead of quietly rolling a d6.
 */
export function rollDice(notation: string, source: Source): DiceRoll | null {
  const match = DICE_RE.exec(notation);
  if (!match) return null;

  const count = Math.min(1000, Math.max(1, Number(match[1] || '1')));
  const faces = Math.min(1_000_000, Math.max(2, Number(match[2] ?? '6')));
  const sign = match[3] === '-' ? -1 : 1;
  const modifier = match[4] ? sign * Number(match[4]) : 0;

  const rolls = Array.from({ length: count }, () => 1 + Math.floor(source() * faces));
  return {
    notation: `${count}d${faces}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
    rolls,
    modifier,
    total: rolls.reduce((sum, r) => sum + r, 0) + modifier,
  };
}

/* ── Output formatting ────────────────────────────────────────────────── */

export type OutputFormat = 'lines' | 'csv' | 'json' | 'python' | 'sql';

export const OUTPUT_FORMATS: ReadonlyArray<{
  readonly value: OutputFormat;
  readonly label: string;
}> = [
  { value: 'lines', label: 'Lines' },
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
];

/**
 * Render values in the shape they are about to be pasted into.
 *
 * The formats exist because the copy button is the point of the tool: a list
 * headed for a `WHERE ... IN` clause needs different punctuation from one
 * headed for a Python literal, and doing that by hand for 500 values is the
 * thing nobody wants to do.
 */
export function formatValues(values: ReadonlyArray<number | string>, format: OutputFormat): string {
  const quote = (v: number | string): string =>
    typeof v === 'number' ? String(v) : JSON.stringify(v);

  switch (format) {
    case 'lines':
      return values.map(String).join('\n');
    case 'csv':
      return values.map((v) => (typeof v === 'number' ? v : csvCell(v))).join(',');
    case 'json':
      return JSON.stringify(values, null, 2);
    case 'python':
      return `[${values.map(quote).join(', ')}]`;
    case 'sql':
      return `(${values.map((v) => (typeof v === 'number' ? v : `'${v.replace(/'/g, "''")}'`)).join(', ')})`;
  }
}

/** Quote a CSV cell only when it needs it, per RFC 4180. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
