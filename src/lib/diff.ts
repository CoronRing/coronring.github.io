/**
 * Text diff — line alignment, word-level refinement, and change metrics.
 *
 * ## Algorithm
 *
 * Line alignment is Myers' greedy O(ND) edit-graph walk, the same algorithm
 * behind `git diff`. It finds a *minimal* edit script, which matters here: a
 * naive LCS over lines will happily pair line 4 with line 900 because they both
 * read `}` and produce a diff nobody can read.
 *
 * Two things make it fast enough to run on every keystroke:
 *
 *  1. Lines are interned to integers before the walk, so the inner loop
 *     compares numbers rather than strings.
 *  2. Common prefix and suffix are stripped first. For the usual case — two
 *     revisions of the same document — that removes most of the input before
 *     the quadratic part starts.
 *
 * The trace is bounded by {@link MAX_EDIT_DISTANCE}. Past that the two texts
 * share almost nothing, a minimal script has no value, and the result is
 * reported as one replacement with `truncated: true` so the UI can say so
 * rather than freezing the tab.
 *
 * ## Similarity
 *
 * `stats.similarity` is a character-level ratio in the style of Python's
 * `difflib.SequenceMatcher.ratio()`: `2·M / (len(a) + len(b))`, where `M` is
 * the number of characters that survived unchanged. Matched characters are
 * counted from equal lines outright, and from a word-level diff inside changed
 * blocks — so editing one word in a long paragraph reads as a small change,
 * which a line-level ratio would score as total replacement.
 */

/** Beyond this edit distance the diff stops being informative. */
const MAX_EDIT_DISTANCE = 2_000;

export type Op = 'equal' | 'insert' | 'delete';

/** One line of the aligned output. */
export interface LineChange {
  readonly op: Op;
  /** 0-based line number in A, absent for insertions. */
  readonly a?: number;
  /** 0-based line number in B, absent for deletions. */
  readonly b?: number;
  readonly text: string;
}

/** A word-level run inside a modified line pair. */
export interface Segment {
  readonly op: Op;
  readonly text: string;
}

/**
 * One row of the side-by-side view.
 *
 * A `replace` row carries both sides plus the word-level segments that show
 * what actually moved inside the line.
 */
export interface Row {
  readonly kind: 'equal' | 'replace' | 'delete' | 'insert';
  readonly left?: LineChange;
  readonly right?: LineChange;
  readonly leftSegments?: readonly Segment[];
  readonly rightSegments?: readonly Segment[];
}

/** A contiguous run of changes plus its context, as a unified-diff hunk. */
export interface Hunk {
  readonly aStart: number;
  readonly aCount: number;
  readonly bStart: number;
  readonly bCount: number;
  readonly changes: readonly LineChange[];
}

export interface DiffStats {
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly linesModified: number;
  readonly linesUnchanged: number;
  readonly charsA: number;
  readonly charsB: number;
  /** Characters common to both, by the word-level count described above. */
  readonly charsMatched: number;
  /** 0 = nothing in common, 1 = identical. */
  readonly similarity: number;
  /** `1 - similarity`, the figure usually wanted as "how much changed". */
  readonly changeRatio: number;
}

export interface DiffOptions {
  /** Collapse runs of whitespace and ignore leading/trailing space. */
  readonly ignoreWhitespace?: boolean;
  readonly ignoreCase?: boolean;
  /** Context lines kept around each hunk in the unified view. */
  readonly context?: number;
}

export interface DiffResult {
  readonly changes: readonly LineChange[];
  readonly rows: readonly Row[];
  readonly hunks: readonly Hunk[];
  readonly stats: DiffStats;
  /** True when the inputs diverged past {@link MAX_EDIT_DISTANCE}. */
  readonly truncated: boolean;
  /** True when both sides are byte-identical. */
  readonly identical: boolean;
}

/* ── Normalisation ────────────────────────────────────────────────────── */

/** Split into lines, tolerating CRLF and a trailing newline. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
}

/** The form two lines are compared *by* — never the form they are shown as. */
function normalise(line: string, options: DiffOptions): string {
  let out = line;
  if (options.ignoreWhitespace) out = out.trim().replace(/\s+/g, ' ');
  if (options.ignoreCase) out = out.toLowerCase();
  return out;
}

/**
 * Map lines to integer ids so the edit-graph walk compares numbers.
 *
 * Interning is what makes this viable on documents of a few thousand lines:
 * string comparison in the innermost loop dominates otherwise.
 */
function intern(
  a: readonly string[],
  b: readonly string[],
  options: DiffOptions,
): [number[], number[]] {
  const ids = new Map<string, number>();
  const encode = (line: string): number => {
    const key = normalise(line, options);
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  return [a.map(encode), b.map(encode)];
}

/* ── Myers ────────────────────────────────────────────────────────────── */

/** One edit-script step over the interned sequences. */
interface Step {
  op: Op;
  a?: number;
  b?: number;
}

/**
 * One depth's snapshot of the furthest-reaching frontier.
 *
 * Only diagonals within `±(d + 1)` can hold a written value at depth `d`, so a
 * snapshot stores that window rather than the whole array. Without this the
 * trace costs `D × (2·(n+m)+1)` cells — hundreds of megabytes on a large file
 * — instead of the `D²` the algorithm actually needs.
 */
interface Frontier {
  /** Diagonal index of `cells[0]`. */
  readonly from: number;
  readonly cells: Int32Array;
}

/**
 * Read one cell of the live frontier.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly undefined,
 * which is right in general and never true here: the array is allocated to
 * cover every diagonal the walk can reach. Reading through this keeps the hot
 * loop honestly typed without an assertion on every line.
 */
function cell(v: Int32Array, i: number): number {
  return v[i] ?? 0;
}

/** Read diagonal `k`; anything outside the window was never written, so is 0. */
function at(frontier: Frontier, k: number): number {
  const i = k - frontier.from;
  return i >= 0 && i < frontier.cells.length ? (frontier.cells[i] ?? 0) : 0;
}

/**
 * Myers' greedy algorithm with a stored trace.
 *
 * Returns `null` when the edit distance exceeds the budget, leaving the caller
 * to degrade rather than spend unbounded time on two unrelated documents.
 */
function myers(a: readonly number[], b: readonly number[]): Step[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];

  const max = n + m;
  const offset = max;

  // v[k + offset] = furthest x reached on diagonal k.
  const v = new Int32Array(2 * max + 1);
  const trace: Frontier[] = [];
  const limit = Math.min(max, MAX_EDIT_DISTANCE);

  for (let d = 0; d <= limit; d++) {
    const from = Math.max(-d - 1, -max);
    const to = Math.min(d + 1, max);
    trace.push({ from, cells: v.slice(from + offset, to + offset + 1) });

    for (let k = -d; k <= d; k += 2) {
      // Extend downward when that diagonal is further along, else rightward.
      const down = k === -d || (k !== d && cell(v, k - 1 + offset) < cell(v, k + 1 + offset));
      let x = down ? cell(v, k + 1 + offset) : cell(v, k - 1 + offset) + 1;
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) return backtrack(trace, d, n, m);
    }
  }

  return null;
}

/**
 * Walk the stored trace backwards into a forward-ordered edit script.
 *
 * Starts from the end of the edit graph — `myers` only calls this once it has
 * reached `(n, m)` — and undoes one move per depth, emitting the diagonal
 * (matched) runs it passes over along the way.
 */
function backtrack(trace: readonly Frontier[], d: number, n: number, m: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;

  for (let depth = d; depth > 0; depth--) {
    const v = trace[depth];
    if (!v) break;
    const k = x - y;
    const down = k === -depth || (k !== depth && at(v, k - 1) < at(v, k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(v, prevK);
    const prevY = prevX - prevK;

    // Diagonal moves are the matched lines between the two snake endpoints.
    while (x > prevX && y > prevY) {
      steps.push({ op: 'equal', a: --x, b: --y });
    }

    if (down) {
      steps.push({ op: 'insert', b: --y });
    } else {
      steps.push({ op: 'delete', a: --x });
    }
  }

  while (x > 0 && y > 0) {
    steps.push({ op: 'equal', a: --x, b: --y });
  }

  steps.reverse();
  return steps;
}

/* ── Word-level refinement ────────────────────────────────────────────── */

/** Split into words, keeping whitespace as its own token so output rejoins exactly. */
function tokenise(line: string): string[] {
  return line.match(/\s+|[A-Za-z0-9_]+|[^\s A-Za-z0-9_]/g) ?? [];
}

/**
 * Word-level diff of two lines.
 *
 * Only ever called on a pair the line diff already decided are counterparts, so
 * the inputs are short and the O(ND) walk is trivially fast.
 */
export function diffWords(left: string, right: string): { left: Segment[]; right: Segment[] } {
  const lt = tokenise(left);
  const rt = tokenise(right);
  const ids = new Map<string, number>();
  const encode = (t: string): number => {
    let id = ids.get(t);
    if (id === undefined) {
      id = ids.size;
      ids.set(t, id);
    }
    return id;
  };

  const steps = myers(lt.map(encode), rt.map(encode));
  if (!steps) {
    return {
      left: left ? [{ op: 'delete', text: left }] : [],
      right: right ? [{ op: 'insert', text: right }] : [],
    };
  }

  const leftOut: Segment[] = [];
  const rightOut: Segment[] = [];

  // Merge adjacent same-op tokens so the DOM gets one span per run.
  const push = (into: Segment[], op: Op, text: string): void => {
    if (text === '') return;
    const last = into[into.length - 1];
    if (last && last.op === op) into[into.length - 1] = { op, text: last.text + text };
    else into.push({ op, text });
  };

  for (const step of steps) {
    if (step.op === 'equal') {
      push(leftOut, 'equal', lt[step.a as number] ?? '');
      push(rightOut, 'equal', rt[step.b as number] ?? '');
    } else if (step.op === 'delete') {
      push(leftOut, 'delete', lt[step.a as number] ?? '');
    } else {
      push(rightOut, 'insert', rt[step.b as number] ?? '');
    }
  }

  return { left: leftOut, right: rightOut };
}

/** Characters shared between two lines, per the word-level alignment. */
function matchedChars(left: string, right: string): number {
  const { left: segments } = diffWords(left, right);
  return segments.reduce((sum, s) => (s.op === 'equal' ? sum + s.text.length : sum), 0);
}

/* ── Rows ─────────────────────────────────────────────────────────────── */

/**
 * Pair delete/insert runs into side-by-side rows.
 *
 * A run of 3 deletes followed by 3 inserts is 3 modified rows, not 6 one-sided
 * ones — the pairing is what lets the word-level highlight exist at all. Ragged
 * runs leave the shorter side blank.
 */
function buildRows(changes: readonly LineChange[]): Row[] {
  const rows: Row[] = [];
  let i = 0;

  while (i < changes.length) {
    const change = changes[i];
    if (!change) break;

    if (change.op === 'equal') {
      rows.push({ kind: 'equal', left: change, right: change });
      i++;
      continue;
    }

    const deletes: LineChange[] = [];
    const inserts: LineChange[] = [];
    for (let next = changes[i]; next?.op === 'delete'; next = changes[i]) {
      deletes.push(next);
      i++;
    }
    for (let next = changes[i]; next?.op === 'insert'; next = changes[i]) {
      inserts.push(next);
      i++;
    }

    const pairs = Math.max(deletes.length, inserts.length);
    for (let p = 0; p < pairs; p++) {
      const left = deletes[p];
      const right = inserts[p];
      if (left && right) {
        const words = diffWords(left.text, right.text);
        rows.push({
          kind: 'replace',
          left,
          right,
          leftSegments: words.left,
          rightSegments: words.right,
        });
      } else if (left) {
        rows.push({ kind: 'delete', left });
      } else {
        rows.push({ kind: 'insert', right });
      }
    }
  }

  return rows;
}

/** Group changes into unified-diff hunks with `context` lines either side. */
function buildHunks(changes: readonly LineChange[], context: number): Hunk[] {
  const interesting = changes.map((c, i) => (c.op === 'equal' ? -1 : i)).filter((i) => i >= 0);
  if (interesting.length === 0) return [];

  const hunks: Hunk[] = [];
  const first = interesting[0] ?? 0;
  let start = Math.max(0, first - context);
  let end = Math.min(changes.length - 1, first + context);

  for (const index of interesting.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(changes.length - 1, index + context);
      continue;
    }
    hunks.push(sliceHunk(changes, start, end));
    start = Math.max(0, index - context);
    end = Math.min(changes.length - 1, index + context);
  }
  hunks.push(sliceHunk(changes, start, end));
  return hunks;
}

function sliceHunk(changes: readonly LineChange[], start: number, end: number): Hunk {
  const slice = changes.slice(start, end + 1);
  const aLines = slice.filter((c) => c.a !== undefined);
  const bLines = slice.filter((c) => c.b !== undefined);
  return {
    // Unified-diff headers are 1-based; an empty side is conventionally 0.
    aStart: (aLines[0]?.a ?? -1) + 1,
    aCount: aLines.length,
    bStart: (bLines[0]?.b ?? -1) + 1,
    bCount: bLines.length,
    changes: slice,
  };
}

/* ── Entry point ──────────────────────────────────────────────────────── */

/**
 * Diff two texts.
 *
 * @param a Left / original text.
 * @param b Right / revised text.
 * @param options Comparison and presentation options.
 */
export function diffText(a: string, b: string, options: DiffOptions = {}): DiffResult {
  const context = options.context ?? 3;
  const aLines = splitLines(a);
  const bLines = splitLines(b);

  const [aIds, bIds] = intern(aLines, bLines, options);

  // Strip the common head and tail before the quadratic part.
  let head = 0;
  while (head < aIds.length && head < bIds.length && aIds[head] === bIds[head]) head++;

  let tail = 0;
  while (
    tail < aIds.length - head &&
    tail < bIds.length - head &&
    aIds[aIds.length - 1 - tail] === bIds[bIds.length - 1 - tail]
  ) {
    tail++;
  }

  const changes: LineChange[] = [];
  for (let i = 0; i < head; i++) {
    changes.push({ op: 'equal', a: i, b: i, text: aLines[i] ?? '' });
  }

  const midA = aIds.slice(head, aIds.length - tail);
  const midB = bIds.slice(head, bIds.length - tail);
  const steps = midA.length === 0 && midB.length === 0 ? [] : myers(midA, midB);
  const truncated = steps === null;

  if (steps === null) {
    // Past the budget: report the divergent middle as one wholesale replacement.
    for (let i = 0; i < midA.length; i++) {
      changes.push({ op: 'delete', a: head + i, text: aLines[head + i] ?? '' });
    }
    for (let i = 0; i < midB.length; i++) {
      changes.push({ op: 'insert', b: head + i, text: bLines[head + i] ?? '' });
    }
  } else {
    for (const step of steps) {
      if (step.op === 'equal') {
        const ai = head + (step.a as number);
        changes.push({
          op: 'equal',
          a: ai,
          b: head + (step.b as number),
          text: aLines[ai] ?? '',
        });
      } else if (step.op === 'delete') {
        const ai = head + (step.a as number);
        changes.push({ op: 'delete', a: ai, text: aLines[ai] ?? '' });
      } else {
        const bi = head + (step.b as number);
        changes.push({ op: 'insert', b: bi, text: bLines[bi] ?? '' });
      }
    }
  }

  for (let i = 0; i < tail; i++) {
    const ai = aIds.length - tail + i;
    changes.push({ op: 'equal', a: ai, b: bIds.length - tail + i, text: aLines[ai] ?? '' });
  }

  const rows = buildRows(changes);
  const hunks = buildHunks(changes, context);

  /*
   * Matched characters: equal lines contribute in full, modified pairs
   * contribute only the words that survived. Newlines are counted so the ratio
   * of two identical texts is exactly 1.
   */
  let charsMatched = 0;
  let linesModified = 0;
  for (const row of rows) {
    if (row.kind === 'equal' && row.left) {
      charsMatched += row.left.text.length + 1;
    } else if (row.kind === 'replace' && row.left && row.right) {
      charsMatched += matchedChars(row.left.text, row.right.text);
      linesModified++;
    }
  }

  const charsA = aLines.reduce((sum, line) => sum + line.length + 1, 0);
  const charsB = bLines.reduce((sum, line) => sum + line.length + 1, 0);
  const total = charsA + charsB;
  const similarity = total === 0 ? 1 : Math.min(1, (2 * charsMatched) / total);

  const linesAdded = rows.filter((r) => r.kind === 'insert').length;
  const linesRemoved = rows.filter((r) => r.kind === 'delete').length;

  return {
    changes,
    rows,
    hunks,
    truncated,
    identical: a === b,
    stats: {
      linesAdded,
      linesRemoved,
      linesModified,
      linesUnchanged: rows.filter((r) => r.kind === 'equal').length,
      charsA,
      charsB,
      charsMatched,
      similarity,
      changeRatio: 1 - similarity,
    },
  };
}

/**
 * Render a result as a unified diff patch.
 *
 * Standard `@@` headers, so the output pastes straight into `git apply` or any
 * review tool that reads unified format.
 */
export function toUnifiedPatch(result: DiffResult, aName = 'a', bName = 'b'): string {
  if (result.hunks.length === 0) return '';
  const out: string[] = [`--- ${aName}`, `+++ ${bName}`];
  for (const hunk of result.hunks) {
    out.push(`@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`);
    for (const change of hunk.changes) {
      const marker = change.op === 'equal' ? ' ' : change.op === 'insert' ? '+' : '-';
      out.push(`${marker}${change.text}`);
    }
  }
  return out.join('\n');
}
