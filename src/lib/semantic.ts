/**
 * Semantic comparison: does this text still *mean* the same thing.
 *
 * ## Why the lexical diff is not enough
 *
 * `diff.ts` answers "what characters changed" exactly and cheaply. It cannot
 * answer either of the two questions people actually bring to a rewrite:
 *
 * - A paraphrase that changes every word and no meaning reads as a total
 *   rewrite. Similarity near zero, semantic distance near zero.
 * - A negation that changes one word inverts the meaning. Similarity near one,
 *   semantic distance large.
 *
 * Both are the same failure: character overlap is not meaning. This module adds
 * the other axis, and the two are shown side by side because the interesting
 * cases are exactly where they disagree.
 *
 * ## Two engines, and why both exist
 *
 * **Local** builds sparse TF-IDF vectors over character n-grams and word
 * unigrams, entirely in the tab. It is a real similarity measure and it is
 * *lexical*: it will call a paraphrase different, because it has no idea that
 * "car" and "automobile" are related. Fast, private, always available.
 *
 * **Remote** sends both texts to the site's own backend, which embeds them with
 * Google's embedding model and returns the vectors. That model does know about
 * paraphrase. It costs a network round trip, it means the text leaves the page,
 * and the backend is free-tier hardware that can be down.
 *
 * The local engine is the default. The remote one is opt-in, per request, and
 * the UI says plainly what leaves the page. A tool that silently uploads pasted
 * text is not a tool anyone should use twice.
 *
 * @see src/lib/embed-api.ts for the client
 * @see chat/service/embed.py for the service
 */

/* ── Vectors ──────────────────────────────────────────────────────────── */

/** A sparse vector, keyed by term. Sparse because a vocabulary is mostly zeros. */
export type SparseVector = ReadonlyMap<string, number>;

/** A dense embedding, as a model returns it. */
export type DenseVector = readonly number[];

export type Metric = 'cosine' | 'euclidean' | 'dot' | 'manhattan' | 'jaccard' | 'angular';

export interface MetricInfo {
  readonly value: Metric;
  readonly label: string;
  /** What it measures, and when it is the wrong choice. */
  readonly note: string;
  /** Higher is more similar. False for the distance metrics. */
  readonly similarity: boolean;
}

export const METRICS: readonly MetricInfo[] = [
  {
    value: 'cosine',
    label: 'Cosine',
    similarity: true,
    note: 'The angle between the vectors, ignoring their length. The default for embeddings, and the right one: length tracks how much text there is, not what it says.',
  },
  {
    value: 'angular',
    label: 'Angular',
    similarity: true,
    note: 'Cosine converted to an angle and rescaled. Spreads out the top of the range, where cosine on modern embeddings bunches everything between 0.7 and 1.0.',
  },
  {
    value: 'dot',
    label: 'Dot product',
    similarity: true,
    note: 'Cosine times both lengths. Identical to cosine for normalised vectors, and misleading otherwise, because a longer text scores higher for being longer.',
  },
  {
    value: 'euclidean',
    label: 'Euclidean',
    similarity: false,
    note: 'Straight-line distance. For unit-length vectors it is a monotone function of cosine, so it ranks identically and reads differently.',
  },
  {
    value: 'manhattan',
    label: 'Manhattan',
    similarity: false,
    note: 'Sum of per-dimension differences. Less dominated by one large disagreement than Euclidean, which makes it more forgiving of a single outlier dimension.',
  },
  {
    value: 'jaccard',
    label: 'Jaccard',
    similarity: true,
    note: 'Shared terms over total terms, on the local engine only. Set overlap, so it ignores how often a term appears. Not defined for dense embeddings.',
  },
];

/* ── Local engine ─────────────────────────────────────────────────────── */

/**
 * English stop words.
 *
 * Removed before weighting because they carry no topic signal and, being in
 * every document, get near-zero IDF anyway. Dropping them explicitly keeps the
 * vectors smaller and the term overlap readable.
 *
 * Kept short on purpose. An aggressive stop list eats negations, and "not" is
 * the single most important word in a semantic comparison of two revisions.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'there',
  'here',
  'then',
  'so',
  'such',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'may',
  'might',
  'shall',
  'should',
  'must',
]);

export interface LocalOptions {
  /** Character n-gram width. 0 turns n-grams off and leaves word unigrams only. */
  readonly ngram: number;
  readonly stopWords: boolean;
  /** Fold plural and common verb endings, so "chunks" and "chunk" agree. */
  readonly stem: boolean;
}

export const DEFAULT_LOCAL: LocalOptions = { ngram: 4, stopWords: true, stem: true };

/**
 * A deliberately crude suffix stripper.
 *
 * Not Porter. Porter is 60 rules and this is 6, and the difference does not show
 * up in a similarity score: what matters is that "chunking" and "chunks" land on
 * the same term, which the common suffixes cover. Over-stemming is the risk, and
 * the length floors are what hold it back.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'ies', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const base = word.slice(0, -suffix.length);
      return suffix === 'ies' ? `${base}y` : base;
    }
  }
  return word;
}

/**
 * Term frequencies over words and character n-grams.
 *
 * Both, not either. Word terms catch shared vocabulary; character n-grams catch
 * shared morphology and survive a typo, which word terms do not: `chunking` and
 * `chunkign` share no words and most of their 4-grams.
 */
export function termFrequencies(text: string, options: LocalOptions): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (term: string): void => {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  };

  const lower = text.toLowerCase();
  const tokens = lower.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

  for (const token of tokens) {
    if (options.stopWords && STOP_WORDS.has(token)) continue;
    bump(`w:${options.stem ? stem(token) : token}`);
  }

  if (options.ngram > 1) {
    // n-grams run over the whitespace-collapsed text so they cross word
    // boundaries, which is what makes them sensitive to phrasing rather than
    // just to spelling.
    const flat = lower.replace(/\s+/g, ' ');
    for (let i = 0; i + options.ngram <= flat.length; i += 1) {
      bump(`g:${flat.slice(i, i + options.ngram)}`);
    }
  }

  return counts;
}

/**
 * TF-IDF vectors for a pair of documents.
 *
 * With a corpus of two, IDF is nearly degenerate: a term is in one document or
 * both, so there are two possible weights. That is still the right transform.
 * It is what pushes shared boilerplate toward zero and leaves the terms unique
 * to one side carrying the signal, which is exactly the comparison being asked
 * for.
 */
export function localVectors(
  a: string,
  b: string,
  options: LocalOptions,
): { readonly a: SparseVector; readonly b: SparseVector } {
  const tfA = termFrequencies(a, options);
  const tfB = termFrequencies(b, options);

  const weight = (counts: Map<string, number>, other: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [term, count] of counts) {
      const documents = 1 + (other.has(term) ? 1 : 0);
      // Smoothed IDF over a corpus of 2. Sub-linear TF, because a term repeated
      // twenty times is not twenty times as important as one used once.
      const idf = Math.log((2 + 1) / (documents + 1)) + 1;
      out.set(term, (1 + Math.log(count)) * idf);
    }
    return out;
  };

  return { a: weight(tfA, tfB), b: weight(tfB, tfA) };
}

/* ── Metrics ──────────────────────────────────────────────────────────── */

/**
 * Compare two sparse vectors.
 *
 * Iterates the smaller side, so cost is proportional to the shorter document
 * rather than to the union of both vocabularies.
 */
export function compareSparse(a: SparseVector, b: SparseVector, metric: Metric): number {
  if (a.size === 0 || b.size === 0) return metric === 'cosine' || metric === 'dot' ? 0 : 0;

  const [small, large] = a.size <= b.size ? [a, b] : [b, a];

  let dot = 0;
  let shared = 0;
  for (const [term, value] of small) {
    const other = large.get(term);
    if (other !== undefined) {
      dot += value * other;
      shared += 1;
    }
  }

  switch (metric) {
    case 'dot':
      return dot;
    case 'cosine':
    case 'angular': {
      const cos = dot / (norm(a) * norm(b) || 1);
      return metric === 'cosine' ? cos : angular(cos);
    }
    case 'jaccard':
      return shared / (a.size + b.size - shared || 1);
    case 'euclidean':
    case 'manhattan': {
      let total = 0;
      const terms = new Set([...a.keys(), ...b.keys()]);
      for (const term of terms) {
        const delta = (a.get(term) ?? 0) - (b.get(term) ?? 0);
        total += metric === 'euclidean' ? delta * delta : Math.abs(delta);
      }
      return metric === 'euclidean' ? Math.sqrt(total) : total;
    }
  }
}

/** Compare two dense embeddings. */
export function compareDense(a: DenseVector, b: DenseVector, metric: Metric): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let sumA = 0;
  let sumB = 0;
  let squares = 0;
  let absolute = 0;

  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    sumA += x * x;
    sumB += y * y;
    squares += (x - y) ** 2;
    absolute += Math.abs(x - y);
  }

  switch (metric) {
    case 'dot':
      return dot;
    case 'cosine':
    case 'angular': {
      const cos = dot / (Math.sqrt(sumA) * Math.sqrt(sumB) || 1);
      return metric === 'cosine' ? cos : angular(cos);
    }
    case 'euclidean':
      return Math.sqrt(squares);
    case 'manhattan':
      return absolute;
    case 'jaccard':
      // Set overlap has no meaning on a dense vector, where every dimension is
      // present in both. Returning cosine would be a quiet lie, so this returns
      // NaN and the UI reports the metric as unavailable.
      return Number.NaN;
  }
}

function norm(vector: SparseVector): number {
  let total = 0;
  for (const value of vector.values()) total += value * value;
  return Math.sqrt(total);
}

/**
 * Cosine as a rescaled angle.
 *
 * Present because raw cosine on a modern embedding model is a bad display scale:
 * unrelated sentences sit around 0.7 rather than 0, so the whole interesting
 * range is squeezed into the top third of the bar. Converting to an angle and
 * back spreads it out without changing the ranking.
 */
function angular(cosine: number): number {
  const clamped = Math.max(-1, Math.min(1, cosine));
  return 1 - Math.acos(clamped) / Math.PI;
}

/* ── Segment alignment ────────────────────────────────────────────────── */

export interface Segment {
  readonly index: number;
  readonly text: string;
  /** Character offset in the source. */
  readonly start: number;
}

export type SegmentUnit = 'paragraph' | 'sentence' | 'line';

/**
 * Split text into comparable units.
 *
 * Paragraphs by default. A whole-document score answers "did this change" and a
 * per-segment alignment answers "where", which is the question that leads
 * somewhere.
 */
export function segment(text: string, unit: SegmentUnit): Segment[] {
  const out: Segment[] = [];
  const pattern =
    unit === 'paragraph' ? /\n\s*\n/g : unit === 'line' ? /\r?\n/g : /(?<=[.!?。！？])\s+/g;

  let start = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const end = match.index;
    const body = text.slice(start, end);
    if (body.trim() !== '') {
      out.push({ index, text: body.trim(), start });
      index += 1;
    }
    start = end + match[0].length;
  }
  const tail = text.slice(start);
  if (tail.trim() !== '') out.push({ index, text: tail.trim(), start });
  return out;
}

export type AlignmentKind = 'matched' | 'moved' | 'rewritten' | 'added' | 'removed';

export interface Alignment {
  readonly kind: AlignmentKind;
  readonly left?: Segment;
  readonly right?: Segment;
  /** Similarity of the pair, on the chosen metric. Absent for added and removed. */
  readonly score?: number;
}

export interface AlignmentResult {
  readonly rows: readonly Alignment[];
  readonly counts: Readonly<Record<AlignmentKind, number>>;
  /** Mean similarity over paired segments, weighted by length. */
  readonly weightedScore: number;
}

/**
 * Pair segments across the two sides by similarity, greedily.
 *
 * Greedy best-first over the full similarity matrix, not the Hungarian
 * algorithm. Optimal assignment is O(n³) and the gain is not visible here: the
 * scores are far apart in practice, so the greedy choice and the optimal one
 * agree on all but near-ties, and a near-tie between two candidate matches is
 * ambiguous to a reader anyway.
 *
 * A pair below `rewriteFloor` is not a pair. Without that, the last unmatched
 * paragraph on each side always pairs with the other, however unrelated, and the
 * result claims a match that no reader would agree with.
 */
export function alignSegments(
  left: readonly Segment[],
  right: readonly Segment[],
  score: (a: Segment, b: Segment) => number,
  { matchFloor = 0.92, rewriteFloor = 0.45 }: { matchFloor?: number; rewriteFloor?: number } = {},
): AlignmentResult {
  const pairs: Array<{ a: number; b: number; value: number }> = [];
  for (const a of left) {
    for (const b of right) {
      pairs.push({ a: a.index, b: b.index, value: score(a, b) });
    }
  }
  pairs.sort((x, y) => y.value - x.value);

  const takenLeft = new Set<number>();
  const takenRight = new Set<number>();
  const matched: Array<{ a: number; b: number; value: number }> = [];

  for (const pair of pairs) {
    if (pair.value < rewriteFloor) break;
    if (takenLeft.has(pair.a) || takenRight.has(pair.b)) continue;
    takenLeft.add(pair.a);
    takenRight.add(pair.b);
    matched.push(pair);
  }

  const rows: Alignment[] = [];
  const counts: Record<AlignmentKind, number> = {
    matched: 0,
    moved: 0,
    rewritten: 0,
    added: 0,
    removed: 0,
  };

  // Emitted in left-hand order, with additions inserted where they land, so the
  // result reads as a document rather than as a list of pairs.
  const byLeft = new Map(matched.map((pair) => [pair.a, pair]));
  let rightCursor = 0;

  const pushRight = (until: number): void => {
    while (rightCursor < until) {
      if (!takenRight.has(rightCursor)) {
        const seg = right[rightCursor];
        if (seg) {
          rows.push({ kind: 'added', right: seg });
          counts.added += 1;
        }
      }
      rightCursor += 1;
    }
  };

  for (const segment_ of left) {
    const pair = byLeft.get(segment_.index);
    if (!pair) {
      rows.push({ kind: 'removed', left: segment_ });
      counts.removed += 1;
      continue;
    }
    pushRight(pair.b);
    const partner = right[pair.b];
    if (!partner) continue;
    // "Moved" needs both a high score and a changed position: a paragraph that
    // is identical and in the same place is simply unchanged.
    const kind: AlignmentKind =
      pair.value >= matchFloor
        ? partner.index !== segment_.index
          ? 'moved'
          : 'matched'
        : 'rewritten';
    rows.push({ kind, left: segment_, right: partner, score: pair.value });
    counts[kind] += 1;
    rightCursor = Math.max(rightCursor, pair.b + 1);
  }
  pushRight(right.length);

  // Length-weighted, so a one-line heading does not count as much as a
  // paragraph. Unweighted means means a document of many short paired segments
  // scores far higher than the text actually warrants.
  let weight = 0;
  let total = 0;
  for (const row of rows) {
    if (row.score === undefined) continue;
    const length = (row.left?.text.length ?? 0) + (row.right?.text.length ?? 0);
    weight += length;
    total += row.score * length;
  }

  return { rows, counts, weightedScore: weight > 0 ? total / weight : 0 };
}

/* ── Interpretation ───────────────────────────────────────────────────── */

/**
 * Turn a cosine into a sentence.
 *
 * The bands are calibrated for a modern embedding model, where unrelated text
 * sits near 0.7 rather than near 0. Reading raw cosine as a percentage is the
 * most common way to misuse an embedding: 0.75 sounds like agreement and means
 * "nothing in common".
 */
export function interpret(cosine: number, engine: 'local' | 'remote'): string {
  if (engine === 'local') {
    if (cosine >= 0.95) return 'Effectively the same text.';
    if (cosine >= 0.8) return 'Heavy overlap. An edit, not a rewrite.';
    if (cosine >= 0.5) return 'Substantial shared vocabulary, substantially reworded.';
    if (cosine >= 0.25) return 'Same subject, different text.';
    return 'Little shared vocabulary. Either a full rewrite or a different topic.';
  }
  if (cosine >= 0.97) return 'Near-identical meaning. A paraphrase at most.';
  if (cosine >= 0.92) return 'The same claim, said differently.';
  if (cosine >= 0.85) return 'Closely related. Same topic, some shift in emphasis or scope.';
  if (cosine >= 0.75) return 'Loosely related. Shared domain, different point.';
  return 'Unrelated as far as the model is concerned.';
}

/**
 * Where the two axes disagree, which is the whole reason for showing both.
 *
 * Returns null when they agree, so the UI shows this only when it has something
 * to say.
 */
export function disagreement(lexical: number, semantic: number): string | null {
  if (semantic - lexical > 0.35) {
    return 'Almost every word changed and the meaning did not. That is a paraphrase, and a lexical diff will overstate it badly.';
  }
  if (lexical - semantic > 0.25) {
    return 'The text barely changed and the meaning moved. Look for a negation, a swapped number, or an inverted condition: a small edit did something large.';
  }
  return null;
}
