/**
 * RAG chunking strategies, implemented over source offsets.
 *
 * ## Why offsets rather than strings
 *
 * Every splitter here returns `[start, end)` ranges into the original text, not
 * detached substrings. That is what makes the visualiser possible: chunk 7 can
 * be painted *in place*, overlap can be shown as the region two chunks both
 * claim, and a boundary that lands mid-sentence can be pointed at rather than
 * described. A splitter that returns strings has already thrown that away.
 *
 * ## What is implemented
 *
 * The strategies mirror the ones people actually reach for — LangChain's
 * `CharacterTextSplitter`, `RecursiveCharacterTextSplitter`,
 * `MarkdownHeaderTextSplitter` and `SemanticChunker`, plus the sentence-window
 * pattern from LlamaIndex. Behaviour is faithful in shape: recursive splitting
 * descends the separator list and then *merges* the pieces back up to the size
 * budget, which is the part naive re-implementations usually miss and the part
 * that decides what the chunks look like.
 *
 * One honest deviation: `semantic` uses lexical cosine similarity over
 * sentence term vectors, not embeddings. Embeddings are a network call and this
 * page does not make one. It finds topic shifts in structured prose reasonably
 * well and is labelled in the UI as the approximation it is.
 *
 * Token figures come from `./tokens.ts` and inherit its ±10-15% error.
 */

import { estimateTokens } from './tokens';

/** A half-open range into the source text. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

export interface Chunk extends Range {
  readonly index: number;
  readonly text: string;
  /** Estimated tokens, from the shared estimator. */
  readonly tokens: number;
  /** Section path, for header-aware splitting. */
  readonly label?: string;
  /** Characters shared with the previous chunk. */
  readonly overlapBefore: number;
  /** True when the chunk begins or ends inside a sentence. */
  readonly cutsSentence: boolean;
}

export type StrategyId =
  'fixed' | 'recursive' | 'sentence' | 'paragraph' | 'markdown' | 'semantic' | 'window';

export interface ChunkConfig {
  /** Target maximum chunk size. Characters, or tokens when `unit` is `token`. */
  readonly size: number;
  /** Overlap between neighbouring chunks, in the same unit as `size`. */
  readonly overlap: number;
  /** Budget unit. Token budgets are converted through the estimator's rate. */
  readonly unit: 'char' | 'token';
  /** Separator ladder for `recursive`, most-preferred first. */
  readonly separators?: readonly string[];
  /** `semantic`: percentile of similarity drops treated as topic breaks (0-100). */
  readonly breakpointPercentile?: number;
  /** `window`: sentences of context either side of the focus sentence. */
  readonly windowSize?: number;
  /** Drop chunks with nothing but whitespace. */
  readonly dropEmpty?: boolean;
}

export interface StrategyInfo {
  readonly id: StrategyId;
  readonly name: string;
  /** One line, shown next to the control. */
  readonly summary: string;
  /** What it is good and bad at — shown when the strategy is selected. */
  readonly detail: string;
  /** Config fields this strategy actually reads. */
  readonly uses: readonly (keyof ChunkConfig)[];
}

export const STRATEGIES: readonly StrategyInfo[] = [
  {
    id: 'recursive',
    name: 'Recursive character',
    summary: 'Descends a separator ladder, then merges back up to the budget.',
    detail:
      'The default in most RAG stacks, and the right first choice. It tries to split on paragraphs, then lines, then sentences, then words, taking the largest unit that fits, so boundaries land at natural breaks unless the text leaves no option. Merging the pieces back up to the size budget is what keeps it from emitting a pile of one-line chunks.',
    uses: ['size', 'overlap', 'unit', 'separators'],
  },
  {
    id: 'fixed',
    name: 'Fixed size',
    summary: 'Cuts every N characters regardless of content.',
    detail:
      'The baseline, and mostly useful as one: it is fast, perfectly predictable, and cuts sentences in half. Worth using when the input has no structure to respect: OCR output, log lines, transcripts without punctuation. Worth measuring against too, because a strategy that cannot beat it is not earning its complexity.',
    uses: ['size', 'overlap', 'unit'],
  },
  {
    id: 'sentence',
    name: 'Sentence packing',
    summary: 'Whole sentences, packed until the budget is reached.',
    detail:
      'Never cuts mid-sentence, which removes the single most common cause of a retrieved chunk being unusable. Overlap is measured in sentences rather than characters, so the shared context is always a complete thought. Degrades on text without reliable punctuation.',
    uses: ['size', 'overlap', 'unit'],
  },
  {
    id: 'paragraph',
    name: 'Paragraph',
    summary: 'Blank-line blocks, packed to the budget, oversize ones split.',
    detail:
      'Respects the author’s own units. Excellent on well-formatted prose and documentation; poor on text that arrives as one wall, where every paragraph is either far under or far over the budget.',
    uses: ['size', 'overlap', 'unit'],
  },
  {
    id: 'markdown',
    name: 'Markdown headers',
    summary: 'Splits at headers, carrying the header path onto each chunk.',
    detail:
      'Structure-aware: each chunk knows which section it came from, and that path can be prepended at index time so a chunk retrieved out of context still says what it is about. Sections longer than the budget fall back to recursive splitting inside the section.',
    uses: ['size', 'overlap', 'unit'],
  },
  {
    id: 'semantic',
    name: 'Semantic (lexical)',
    summary: 'Breaks where adjacent sentences stop sharing vocabulary.',
    detail:
      'Groups sentences and cuts at topic shifts rather than at a size. Real semantic chunkers measure the shift with embeddings; this one uses cosine similarity over term vectors, so it needs no network call and finds coarse topic boundaries well while missing paraphrase. Chunk sizes come out uneven by design. That is the point, and it is also why the strategy is harder to budget for.',
    uses: ['size', 'unit', 'breakpointPercentile'],
  },
  {
    id: 'window',
    name: 'Sentence window',
    summary: 'One sentence per chunk, with k neighbours as context.',
    detail:
      'Retrieval matches a single precise sentence, but the model is handed the surrounding window. Very high overlap by construction, so the index grows several times over. The trade is precision at match time against storage and embedding cost.',
    uses: ['windowSize'],
  },
] as const;

export const DEFAULT_SEPARATORS: readonly string[] = ['\n\n', '\n', '. ', ', ', ' ', ''];

/* ── Primitives ───────────────────────────────────────────────────────── */

/**
 * Average characters per token for the current text.
 *
 * Token budgets have to become character budgets somewhere, because every
 * splitter works on offsets. Measuring the ratio on *this* text rather than
 * assuming 4.0 keeps the conversion honest on code and CJK, where the real
 * figure is closer to 2 and 1.
 */
function charsPerToken(text: string): number {
  if (text.length === 0) return 4;
  const { tokens } = estimateTokens(text);
  return Math.max(1, text.length / Math.max(1, tokens));
}

/** Median of an ascending list; 0 for an empty one. */
function medianOf(ascending: readonly number[]): number {
  if (ascending.length === 0) return 0;
  const mid = ascending.length / 2;
  if (ascending.length % 2 === 1) return ascending[(ascending.length - 1) / 2] ?? 0;
  return Math.round(((ascending[mid - 1] ?? 0) + (ascending[mid] ?? 0)) / 2);
}

/** Resolve a config to a character budget. */
function budget(text: string, config: ChunkConfig): { size: number; overlap: number } {
  const ratio = config.unit === 'token' ? charsPerToken(text) : 1;
  const size = Math.max(16, Math.round(config.size * ratio));
  return { size, overlap: Math.max(0, Math.min(size - 1, Math.round(config.overlap * ratio))) };
}

/**
 * Sentence boundaries, as ranges.
 *
 * A scanner rather than a `split`, because offsets must survive. Terminators
 * followed by whitespace end a sentence, unless the preceding token looks like
 * a common abbreviation or a single initial — `e.g.` and `J. Smith` are the two
 * that wreck naive sentence splitting on real documents.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'eg',
  'ie',
  'fig',
  'no',
  'al',
  'inc',
  'ltd',
  'co',
  'approx',
]);

export function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);

    // A blank line ends a sentence whatever the punctuation.
    if (ch === '\n' && text.charAt(i + 1) === '\n') {
      if (i + 1 > start) ranges.push({ start, end: i + 1 });
      start = i + 1;
      continue;
    }

    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Absorb a run of terminators and any closing quote or bracket.
    let end = i + 1;
    while (end < text.length && /[.!?)\]"'”’]/.test(text.charAt(end))) end++;
    if (end < text.length && !/\s/.test(text.charAt(end))) continue;

    if (ch === '.') {
      const before = text.slice(Math.max(0, i - 12), i);
      const word = /([A-Za-z]+)$/.exec(before)?.[1] ?? '';
      // Abbreviations and single initials do not terminate a sentence.
      if (ABBREVIATIONS.has(word.toLowerCase()) || word.length === 1) continue;
    }

    ranges.push({ start, end });
    // Whitespace between sentences belongs to the next one, keeping coverage total.
    start = end;
    i = end - 1;
  }

  if (start < text.length) {
    const trailing = text.slice(start);
    // Trailing whitespace is not a sentence. Attaching it to the previous one
    // keeps the ranges tiling the source without emitting an empty chunk.
    const last = ranges[ranges.length - 1];
    if (trailing.trim() === '' && last) {
      ranges[ranges.length - 1] = { start: last.start, end: text.length };
    } else {
      ranges.push({ start, end: text.length });
    }
  }
  return ranges.filter((r) => r.end > r.start);
}

/** Blank-line separated blocks, as ranges. */
function paragraphRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const pattern = /\n[ \t]*\n/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end > start) ranges.push({ start, end });
    start = end;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

/**
 * Split one range on `separator`, keeping the separator with the piece before it.
 *
 * Keeping it attached is what makes the ranges tile the source exactly, so the
 * visualiser never shows an unexplained gap between two chunks.
 */
function splitRange(text: string, range: Range, separator: string): Range[] {
  if (separator === '') {
    // Last resort: hand back single characters for the merger to repack.
    const out: Range[] = [];
    for (let i = range.start; i < range.end; i++) out.push({ start: i, end: i + 1 });
    return out;
  }

  const pieces: Range[] = [];
  let cursor = range.start;
  let found = text.indexOf(separator, cursor);

  while (found !== -1 && found < range.end) {
    const end = Math.min(found + separator.length, range.end);
    if (end > cursor) pieces.push({ start: cursor, end });
    cursor = end;
    found = text.indexOf(separator, cursor);
  }
  if (cursor < range.end) pieces.push({ start: cursor, end: range.end });
  return pieces.length > 0 ? pieces : [range];
}

/** Recursively split until every piece fits, or the separators run out. */
function recursiveRanges(
  text: string,
  range: Range,
  separators: readonly string[],
  size: number,
): Range[] {
  if (range.end - range.start <= size) return [range];
  if (separators.length === 0) return [range];

  const [head, ...rest] = separators;
  if (head === undefined) return [range];
  const pieces = splitRange(text, range, head);

  // The separator did not divide anything — drop to the next one.
  if (pieces.length <= 1) return recursiveRanges(text, range, rest, size);

  return pieces.flatMap((piece) =>
    piece.end - piece.start <= size ? [piece] : recursiveRanges(text, piece, rest, size),
  );
}

/**
 * Pack contiguous pieces into chunks of at most `size`, overlapping by `overlap`.
 *
 * This is the merge step: without it, a document full of short lines becomes a
 * document full of short chunks, and retrieval quality collapses because no
 * single chunk carries enough context to answer anything.
 */
function mergeRanges(pieces: readonly Range[], size: number, overlap: number): Range[] {
  const merged: Range[] = [];
  let current: Range | null = null;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece) continue;

    if (current === null) {
      current = { ...piece };
      continue;
    }

    if (piece.end - current.start <= size) {
      current = { start: current.start, end: piece.end };
      continue;
    }

    merged.push(current);

    /*
     * Start the next chunk `overlap` characters back, but never before the
     * chunk's own start — that would make no forward progress and loop.
     */
    const target = Math.max(current.start + 1, current.end - overlap);
    let restart = i;
    for (let previous = pieces[restart - 1]; previous && previous.start >= target;) {
      restart--;
      previous = pieces[restart - 1];
    }

    current = { start: (pieces[restart] ?? piece).start, end: piece.end };
    // Re-entering an earlier piece means the window would exceed the budget;
    // clamp back to a plain forward step in that case.
    if (current.end - current.start > size) current = { ...piece };
  }

  if (current !== null) merged.push(current);
  return merged;
}

/* ── Semantic (lexical) ───────────────────────────────────────────────── */

/** Term-frequency vector over lowercase word tokens. */
function termVector(text: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
    vector.set(raw, (vector.get(raw) ?? 0) + 1);
  }
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, count] of a) {
    normA += count * count;
    const other = b.get(term);
    if (other !== undefined) dot += count * other;
  }
  for (const count of b.values()) normB += count * count;
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/**
 * Group sentences, cutting where adjacent similarity drops into the tail.
 *
 * The threshold is a percentile of the observed similarities rather than an
 * absolute value, because absolute cosine scores are not comparable between
 * documents — a legal contract and a chat log have entirely different baselines.
 */
function semanticRanges(text: string, percentile: number, maxSize: number): Range[] {
  const sentences = sentenceRanges(text);
  if (sentences.length <= 1) return sentences;

  const vectors = sentences.map((r) => termVector(text.slice(r.start, r.end)));
  const similarities: number[] = [];
  for (let i = 1; i < vectors.length; i++) {
    const previous = vectors[i - 1];
    const current = vectors[i];
    similarities.push(previous && current ? cosine(previous, current) : 0);
  }

  const sorted = [...similarities].sort((a, b) => a - b);
  const cutoffIndex = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((percentile / 100) * sorted.length)),
  );
  const threshold = sorted[cutoffIndex] ?? 0;

  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  if (!first || !last) return sentences;

  const groups: Range[] = [];
  let start = first.start;

  for (let i = 1; i < sentences.length; i++) {
    const sentence = sentences[i];
    const previous = sentences[i - 1];
    if (!sentence || !previous) continue;

    const breakHere = (similarities[i - 1] ?? 1) <= threshold;
    const wouldOverflow = sentence.end - start > maxSize;
    if (breakHere || wouldOverflow) {
      groups.push({ start, end: previous.end });
      start = sentence.start;
    }
  }
  groups.push({ start, end: last.end });
  return groups.filter((r) => r.end > r.start);
}

/* ── Markdown ─────────────────────────────────────────────────────────── */

interface Section extends Range {
  readonly label: string;
}

/** Split at ATX headers, accumulating the header path down the hierarchy. */
function markdownSections(text: string): Section[] {
  const pattern = /^(#{1,6})[ \t]+(.+)$/gm;
  const sections: Section[] = [];
  const path: string[] = [];
  let cursor = 0;
  let label = '';
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      sections.push({ start: cursor, end: match.index, label });
    }
    const depth = (match[1] ?? '#').length;
    path.length = Math.min(path.length, depth - 1);
    path[depth - 1] = (match[2] ?? '').trim();
    label = path.filter(Boolean).join(' › ');
    cursor = match.index;
  }

  if (cursor < text.length) sections.push({ start: cursor, end: text.length, label });
  return sections.filter((s) => s.end > s.start);
}

/* ── Assembly ─────────────────────────────────────────────────────────── */

export interface ChunkStats {
  readonly count: number;
  readonly minChars: number;
  readonly maxChars: number;
  readonly meanChars: number;
  readonly medianChars: number;
  readonly totalTokens: number;
  readonly meanTokens: number;
  /** Total characters emitted ÷ characters in the source. 1.0 means no overlap. */
  readonly expansion: number;
  /**
   * Mean characters each chunk actually shares with its predecessor.
   *
   * Requested overlap is a ceiling, not a promise: a splitter that respects
   * natural boundaries can only step back to one of them, so the achieved
   * figure is usually below the configured one and sometimes zero. Showing both
   * is the difference between a config that works and one that only looks like
   * it does.
   */
  readonly achievedOverlap: number;
  /** Chunks that begin or end inside a sentence. */
  readonly sentenceCuts: number;
  /** Chunks under a quarter of the budget — usually useless on their own. */
  readonly runts: number;
  /** Chunks over the requested budget, which no strategy can always avoid. */
  readonly oversize: number;
}

export interface ChunkResult {
  readonly chunks: readonly Chunk[];
  readonly stats: ChunkStats;
  /** Character budget actually used, after any token conversion. */
  readonly effectiveSize: number;
  readonly effectiveOverlap: number;
}

/** Does this range start or end inside a sentence? */
function cutsSentence(range: Range, sentences: readonly Range[]): boolean {
  const startsMid = sentences.some((s) => range.start > s.start && range.start < s.end - 1);
  const endsMid = sentences.some((s) => range.end > s.start + 1 && range.end < s.end);
  return startsMid || endsMid;
}

/** Apply `strategy` to `text`. Returns an empty result for empty input. */
export function chunkText(text: string, strategy: StrategyId, config: ChunkConfig): ChunkResult {
  const empty: ChunkResult = {
    chunks: [],
    stats: {
      count: 0,
      minChars: 0,
      maxChars: 0,
      meanChars: 0,
      medianChars: 0,
      totalTokens: 0,
      meanTokens: 0,
      expansion: 0,
      achievedOverlap: 0,
      sentenceCuts: 0,
      runts: 0,
      oversize: 0,
    },
    effectiveSize: config.size,
    effectiveOverlap: config.overlap,
  };
  if (text.length === 0) return empty;

  const { size, overlap } = budget(text, config);
  const separators = config.separators ?? DEFAULT_SEPARATORS;
  const whole: Range = { start: 0, end: text.length };

  let ranges: Range[];
  let labels: (string | undefined)[] = [];

  switch (strategy) {
    case 'fixed': {
      ranges = [];
      const step = Math.max(1, size - overlap);
      for (let i = 0; i < text.length; i += step) {
        ranges.push({ start: i, end: Math.min(text.length, i + size) });
        if (i + size >= text.length) break;
      }
      break;
    }

    case 'recursive':
      ranges = mergeRanges(recursiveRanges(text, whole, separators, size), size, overlap);
      break;

    case 'sentence':
      ranges = mergeRanges(sentenceRanges(text), size, overlap);
      break;

    case 'paragraph': {
      const paragraphs = paragraphRanges(text).flatMap((range) =>
        range.end - range.start > size ? recursiveRanges(text, range, separators, size) : [range],
      );
      ranges = mergeRanges(paragraphs, size, overlap);
      break;
    }

    case 'markdown': {
      const sections = markdownSections(text);
      ranges = [];
      labels = [];
      for (const section of sections) {
        const pieces =
          section.end - section.start > size
            ? mergeRanges(recursiveRanges(text, section, separators, size), size, overlap)
            : [section];
        for (const piece of pieces) {
          ranges.push(piece);
          labels.push(section.label || undefined);
        }
      }
      break;
    }

    case 'semantic':
      ranges = semanticRanges(text, config.breakpointPercentile ?? 20, size);
      break;

    case 'window': {
      const sentences = sentenceRanges(text);
      const k = Math.max(0, config.windowSize ?? 1);
      ranges = sentences.map((sentence, i) => ({
        start: sentences[Math.max(0, i - k)]?.start ?? sentence.start,
        end: sentences[Math.min(sentences.length - 1, i + k)]?.end ?? sentence.end,
      }));
      break;
    }

    default:
      ranges = [whole];
  }

  const sentences = sentenceRanges(text);
  let previousEnd = 0;

  const chunks: Chunk[] = ranges
    .map((range, index) => {
      const body = text.slice(range.start, range.end);
      const overlapBefore = index === 0 ? 0 : Math.max(0, previousEnd - range.start);
      previousEnd = range.end;
      return {
        ...range,
        index,
        text: body,
        tokens: estimateTokens(body).tokens,
        label: labels[index],
        overlapBefore,
        cutsSentence: cutsSentence(range, sentences),
      };
    })
    .filter((chunk) => (config.dropEmpty === false ? true : chunk.text.trim().length > 0))
    // Re-index after any drops so chunk numbers stay contiguous in the UI.
    .map((chunk, index) => ({ ...chunk, index }));

  const lengths = chunks.map((c) => c.end - c.start).sort((a, b) => a - b);
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const tokens = chunks.reduce((sum, c) => sum + c.tokens, 0);

  return {
    chunks,
    effectiveSize: size,
    effectiveOverlap: overlap,
    stats: {
      count: chunks.length,
      minChars: lengths[0] ?? 0,
      maxChars: lengths[lengths.length - 1] ?? 0,
      meanChars: chunks.length === 0 ? 0 : Math.round(total / chunks.length),
      medianChars: medianOf(lengths),
      totalTokens: tokens,
      meanTokens: chunks.length === 0 ? 0 : Math.round(tokens / chunks.length),
      expansion: text.length === 0 ? 0 : total / text.length,
      achievedOverlap:
        chunks.length < 2
          ? 0
          : Math.round(
              chunks.slice(1).reduce((sum, c) => sum + c.overlapBefore, 0) / (chunks.length - 1),
            ),
      sentenceCuts: chunks.filter((c) => c.cutsSentence).length,
      runts: chunks.filter((c) => c.end - c.start < size / 4).length,
      oversize: chunks.filter((c) => c.end - c.start > size).length,
    },
  };
}

/**
 * Painted segments over the source text.
 *
 * Chunks overlap, so the text cannot simply be sliced per chunk. This walks the
 * boundary points and returns tiling segments, each tagged with how many chunks
 * claim it — which is exactly what the overlap shading needs.
 */
export interface PaintedSegment extends Range {
  /** Chunk indices covering this segment. */
  readonly chunks: readonly number[];
}

export function paintChunks(length: number, chunks: readonly Chunk[]): PaintedSegment[] {
  if (chunks.length === 0) return length > 0 ? [{ start: 0, end: length, chunks: [] }] : [];

  const points = new Set<number>([0, length]);
  for (const chunk of chunks) {
    points.add(chunk.start);
    points.add(chunk.end);
  }

  const sorted = [...points].filter((p) => p >= 0 && p <= length).sort((a, b) => a - b);
  const segments: PaintedSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    segments.push({
      start,
      end,
      chunks: chunks.filter((c) => c.start < end && c.end > start).map((c) => c.index),
    });
  }

  return segments;
}
