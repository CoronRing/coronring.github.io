/**
 * Regex execution, safely, plus the line-filter mode people actually want.
 *
 * ## Two jobs, not one
 *
 * A regex tester answers "does this pattern match". A log filter answers "show
 * me the lines with X but not Y". The second is what most people are doing when
 * they reach for a regex tester, and it is badly served by a match list: you
 * want the surviving lines, and you want to combine two or three conditions
 * without writing a lookahead. Both modes live here.
 *
 * ## The hanging problem
 *
 * JavaScript's engine backtracks, so `(a+)+b` against a wall of `a` is
 * exponential and there is no timeout to set. A tab that locks up is the worst
 * failure this page can have, because the input is gone with it.
 *
 * Three defences, in order of how much they buy:
 *
 * 1. **Match count and input caps.** Bounds the linear cost, which is most of it.
 * 2. **A deadline checked between matches.** Catches a pattern that is slow
 *    across many matches rather than inside one.
 * 3. **A static risk warning.** Flags nested unbounded quantifiers before the
 *    pattern is ever run, because defence 2 cannot interrupt a single
 *    catastrophic match once the engine is inside it.
 *
 * Defence 3 is the honest one. The others cannot save a tab from
 * `(x+x+)+y`; only not running it can, so the UI warns and asks.
 */

/* ── Limits ───────────────────────────────────────────────────────────── */

/** Maximum matches collected. Beyond this the UI reports a truncated result. */
export const MAX_MATCHES = 5_000;

/** Wall-clock budget for one run, checked between matches. */
export const TIME_BUDGET_MS = 1_500;

/** Input ceiling. A megabyte of text through a backtracking engine is not a tool. */
export const MAX_INPUT = 400_000;

/* ── Flags ────────────────────────────────────────────────────────────── */

export interface FlagOption {
  readonly flag: string;
  readonly label: string;
  readonly note: string;
}

/**
 * The flags worth exposing.
 *
 * `g` is absent because it is not a choice here: every mode needs to walk the
 * whole input, so it is always set. `y` (sticky) is absent because it is
 * meaningless without a managed `lastIndex`, which this module owns.
 */
export const FLAGS: readonly FlagOption[] = [
  { flag: 'i', label: 'i · ignore case', note: 'Case-insensitive.' },
  {
    flag: 'm',
    label: 'm · multiline',
    note: '^ and $ match at every line break rather than only at the ends of the input.',
  },
  {
    flag: 's',
    label: 's · dot all',
    note: '. matches a newline too. Almost always what you want when matching across lines.',
  },
  {
    flag: 'u',
    label: 'u · unicode',
    note: 'Escapes such as \\p{L} work and surrogate pairs count as one character.',
  },
  {
    flag: 'v',
    label: 'v · unicode sets',
    note: 'Supersedes u and adds set operations inside character classes. Newer engines only.',
  },
];

/* ── Static risk analysis ─────────────────────────────────────────────── */

/**
 * Nested unbounded quantifiers, the shape behind almost every real hang.
 *
 * Matches a quantified group whose own body ends in a quantifier: `(a+)+`,
 * `(\w*)*`, `(x{1,}){2,}`. Deliberately narrow. A pattern-risk warning that
 * fires on ordinary regexes gets ignored, and an ignored warning protects
 * nobody.
 */
const NESTED_QUANTIFIER =
  /\((?:\?[:=!<]?[A-Za-z0-9_<>]*)?[^()]*?[*+}]\s*\)\s*[*+]|\)\{\d+,\}?\)?[*+]/;

/** Alternation of overlapping single-character branches under a quantifier. */
const OVERLAPPING_ALTERNATION = /\((?:\?:)?[^()|]*\|[^()|]*\)[*+]/;

export interface RiskReport {
  readonly level: 'none' | 'caution';
  readonly reason?: string;
}

/**
 * Classify a pattern before running it.
 *
 * Pure syntax, no execution: the point is to decide whether running it is safe,
 * so it cannot involve running it.
 */
export function assessRisk(pattern: string): RiskReport {
  if (NESTED_QUANTIFIER.test(pattern)) {
    return {
      level: 'caution',
      reason:
        'This pattern nests one unbounded quantifier inside another. On input that almost matches, the engine can backtrack for longer than the age of the universe, and nothing in this page can interrupt it once it starts.',
    };
  }
  if (OVERLAPPING_ALTERNATION.test(pattern)) {
    return {
      level: 'caution',
      reason:
        'A repeated alternation whose branches can match the same text gives the engine many ways to match the same string, and it will try all of them before giving up.',
    };
  }
  return { level: 'none' };
}

/* ── Matching ─────────────────────────────────────────────────────────── */

export interface Capture {
  /** 1-based group number. */
  readonly index: number;
  /** Group name, for `(?<name>...)`. */
  readonly name?: string;
  /** Null where the group took part in no alternative that matched. */
  readonly value: string | null;
}

export interface Match {
  readonly index: number;
  readonly end: number;
  readonly text: string;
  readonly captures: readonly Capture[];
  /** 1-based line the match starts on. */
  readonly line: number;
  /** 1-based column, in UTF-16 code units. */
  readonly column: number;
}

export interface MatchRun {
  readonly matches: readonly Match[];
  /** Distinct matched strings, for the frequency view. */
  readonly tallies: ReadonlyArray<{ readonly text: string; readonly count: number }>;
  readonly elapsedMs: number;
  /** Hit `MAX_MATCHES` or the time budget. */
  readonly truncated: boolean;
  /** Lines carrying at least one match. */
  readonly matchedLines: number;
  /** Compile or execution failure, already readable. */
  readonly error?: string;
}

/** Compile a pattern, turning a `SyntaxError` into a message. */
export function compile(pattern: string, flags: string): RegExp | string {
  if (pattern === '') return 'Empty pattern.';
  try {
    // `d` gives per-group indices, which is what makes group highlighting
    // possible rather than approximate. Supported everywhere this site runs.
    return new RegExp(pattern, `${flags.replace(/[gdy]/g, '')}gd`);
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid pattern.';
  }
}

/**
 * Run a compiled pattern across the input.
 *
 * The zero-length guard is not optional. A pattern that can match nothing
 * (`a*`, `^`, `\b`) leaves `lastIndex` where it was, and the loop never
 * advances: this is the single most common way a hand-written match loop hangs,
 * and it hangs on patterns as innocent as `\b`.
 */
export function runMatches(text: string, regex: RegExp): MatchRun {
  const started = performance.now();
  const input = text.slice(0, MAX_INPUT);
  const matches: Match[] = [];
  const counts = new Map<string, number>();
  const lines = new Set<number>();

  // One pass to find line starts, so line and column are a binary search rather
  // than a `slice().split()` per match.
  const lineStarts: number[] = [0];
  for (let i = 0; i < input.length; i += 1) {
    if (input.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  regex.lastIndex = 0;
  let truncated = false;
  let error: string | undefined;

  try {
    let found: RegExpExecArray | null;
    while ((found = regex.exec(input)) !== null) {
      const index = found.index;
      const value = found[0];
      const line = lineOf(lineStarts, index);

      matches.push({
        index,
        end: index + value.length,
        text: value,
        captures: capturesOf(found),
        line: line + 1,
        column: index - (lineStarts[line] ?? 0) + 1,
      });
      counts.set(value, (counts.get(value) ?? 0) + 1);
      lines.add(line);

      // A zero-length match leaves lastIndex alone. Step it forward by one code
      // point (not one unit) so the loop terminates and does not split a
      // surrogate pair, which under the u flag throws rather than misbehaving.
      if (value.length === 0) {
        const point = input.codePointAt(regex.lastIndex);
        regex.lastIndex += point !== undefined && point > 0xffff ? 2 : 1;
      }

      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      // Checked every 200 matches: `performance.now()` is cheap but not free,
      // and calling it per match on a pattern with 5,000 hits is measurable.
      if (matches.length % 200 === 0 && performance.now() - started > TIME_BUDGET_MS) {
        truncated = true;
        break;
      }
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : 'Matching failed.';
  }

  const tallies = [...counts.entries()]
    .map(([matchText, count]) => ({ text: matchText, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  return {
    matches,
    tallies,
    elapsedMs: performance.now() - started,
    truncated: truncated || text.length > MAX_INPUT,
    matchedLines: lines.size,
    error,
  };
}

function capturesOf(found: RegExpExecArray): Capture[] {
  const names = found.groups ? Object.entries(found.groups) : [];
  const out: Capture[] = [];
  for (let i = 1; i < found.length; i += 1) {
    const value = found[i] ?? null;
    const named = names.find(([, v]) => v === found[i]);
    out.push({ index: i, name: named?.[0], value });
  }
  return out;
}

/** Index of the line containing `offset`. Binary search over line starts. */
function lineOf(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ── Replace ──────────────────────────────────────────────────────────── */

export interface ReplaceResult {
  readonly output: string;
  readonly count: number;
  readonly error?: string;
}

/**
 * Apply a replacement, counting the substitutions.
 *
 * `String.replace` gives no count, so the callback form does the counting. That
 * also means `$1` has to be expanded by hand, which is the price of knowing how
 * many times the pattern fired.
 */
export function applyReplace(text: string, regex: RegExp, template: string): ReplaceResult {
  let count = 0;
  try {
    const output = text.slice(0, MAX_INPUT).replace(regex, (...args) => {
      count += 1;
      if (count > MAX_MATCHES) return String(args[0]);
      return expand(template, args);
    });
    return { output, count };
  } catch (error) {
    return {
      output: '',
      count: 0,
      error: error instanceof Error ? error.message : 'Replacement failed.',
    };
  }
}

/**
 * Expand `$0`, `$1`, `$<name>`, `$$` and `$&` in a replacement template.
 *
 * `$$` is handled in the same pass rather than pre-substituted, because a
 * two-pass version turns the literal `$$1` into group 1 instead of `$1`.
 */
function expand(template: string, args: unknown[]): string {
  const groups = (typeof args.at(-1) === 'object' ? args.at(-1) : undefined) as
    Record<string, string | undefined> | undefined;
  const positional = args.slice(0, groups ? -3 : -2) as Array<string | undefined>;

  return template.replace(/\$(\$|&|\d{1,2}|<[A-Za-z_$][\w$]*>)/g, (whole, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return positional[0] ?? '';
    if (token.startsWith('<')) return groups?.[token.slice(1, -1)] ?? '';
    const index = Number(token);
    // An out-of-range group reference is left as written, which is what the
    // native `replace` does and is less surprising than silently emptying it.
    return index < positional.length ? (positional[index] ?? '') : whole;
  });
}

/* ── Line filter ──────────────────────────────────────────────────────── */

export interface FilterSpec {
  /** Every term must appear. */
  readonly include: readonly string[];
  /** No term may appear. */
  readonly exclude: readonly string[];
  /** Treat terms as regexes rather than plain substrings. */
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  /** Invert the whole verdict, after include and exclude are applied. */
  readonly invert: boolean;
  readonly dedupe: boolean;
  readonly trim: boolean;
  readonly dropBlank: boolean;
}

export interface FilterResult {
  readonly lines: readonly string[];
  readonly total: number;
  readonly kept: number;
  readonly words: number;
  readonly chars: number;
  readonly duplicatesRemoved: number;
  readonly error?: string;
}

/**
 * Keep the lines matching every include term and no exclude term.
 *
 * This is `grep -f` with two lists, which is the shape of the question people
 * actually ask a log: "show me the request lines that are not health checks".
 * Expressing that as one regex needs a negative lookahead and is write-only.
 */
export function filterLines(text: string, spec: FilterSpec): FilterResult {
  const raw = text.slice(0, MAX_INPUT).split(/\r?\n/);
  const flags = spec.caseSensitive ? '' : 'i';

  let includes: RegExp[];
  let excludes: RegExp[];
  try {
    includes = spec.include.map((term) => term_(term, spec.regex, flags));
    excludes = spec.exclude.map((term) => term_(term, spec.regex, flags));
  } catch (error) {
    return {
      lines: [],
      total: raw.length,
      kept: 0,
      words: 0,
      chars: 0,
      duplicatesRemoved: 0,
      error: error instanceof Error ? error.message : 'Invalid term.',
    };
  }

  const seen = new Set<string>();
  const kept: string[] = [];
  let duplicates = 0;

  for (const original of raw) {
    const line = spec.trim ? original.trim() : original;
    if (spec.dropBlank && line.trim() === '') continue;

    const hits = includes.every((r) => r.test(line));
    const blocked = excludes.some((r) => r.test(line));
    const verdict = hits && !blocked;
    if (verdict === spec.invert) continue;

    if (spec.dedupe) {
      const key = spec.caseSensitive ? line : line.toLowerCase();
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
    }
    kept.push(line);
  }

  const joined = kept.join('\n');
  return {
    lines: kept,
    total: raw.length,
    kept: kept.length,
    words: countWords(joined),
    chars: joined.length,
    duplicatesRemoved: duplicates,
  };
}

/**
 * Build one filter term.
 *
 * Non-regex terms are escaped rather than passed through, so a search for
 * `cost ($)` finds that text instead of failing to compile.
 */
function term_(text: string, isRegex: boolean, flags: string): RegExp {
  return new RegExp(isRegex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

/** Unicode-aware word count. Falls back to whitespace splitting on old engines. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  try {
    return (trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  } catch {
    return trimmed.split(/\s+/).length;
  }
}

/* ── Templates ────────────────────────────────────────────────────────── */

export interface Template {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly group: string;
  readonly note: string;
  readonly sample?: string;
}

/**
 * A starting library, honest about its limits.
 *
 * Every entry here is a *pragmatic* pattern, and the notes say where each one
 * is wrong. That is deliberate. The canonical email regex is 6,000 characters
 * and matches things no mail server accepts; a tool that hands over a short one
 * without saying it is approximate is teaching a bug.
 */
export const TEMPLATES: readonly Template[] = [
  {
    name: 'Email address',
    pattern:
      "[\\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+",
    flags: 'i',
    group: 'Contact',
    note: 'Pragmatic, not RFC 5322. It rejects quoted local parts and bare-IP domains, both of which are legal and neither of which you want in a form.',
    sample: 'Reach me at guan@railtown.ai or the old first.last+tag@sub.example.co.uk address.',
  },
  {
    name: 'URL',
    pattern: 'https?://[^\\s<>"\')\\]]+[^\\s<>"\')\\].,;:!?]',
    flags: 'i',
    group: 'Contact',
    note: 'Stops before trailing punctuation, so a URL at the end of a sentence does not swallow the full stop. Deliberately does not match bare www.',
    sample: 'See https://coronring.github.io/tools/regex-lab, or http://localhost:4321/x?y=1#z.',
  },
  {
    name: 'IPv4 address',
    pattern:
      '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b',
    flags: '',
    group: 'Network',
    note: 'Range-checked, so 999.1.1.1 does not match. Does not check that the address is routable.',
    sample: 'from 129.146.37.132 via 10.0.0.1, rejected 999.1.1.1 and 192.168.001.1',
  },
  {
    name: 'Semantic version',
    pattern: '\\bv?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+([0-9A-Za-z.-]+))?\\b',
    flags: '',
    group: 'Code',
    note: 'Captures major, minor, patch, prerelease and build. The optional leading v is a tag-naming convention, not part of semver.',
    sample: 'particle-wave 1.4.0, railtracks v1.5.0, next 2.0.0-rc.1+build.7',
  },
  {
    name: 'ISO 8601 timestamp',
    pattern:
      '\\b\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b',
    flags: '',
    group: 'Time',
    note: 'Shape only. It matches 2026-02-31, because calendar validity is not something a regex should be asked to know.',
    sample: '2026-08-25T14:03:11.482Z started, 2026-08-25 14:05 ended, 2026-02-31 is not a date',
  },
  {
    name: 'Log level line',
    pattern:
      '^(?<time>\\S+\\s+\\S+)\\s+(?<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\\s+(?<rest>.*)$',
    flags: 'im',
    group: 'Logs',
    note: 'Named groups, so a capture table reads as columns. Assumes the timestamp comes first, which most formats but not all do.',
    sample:
      '2026-08-25 14:03:11 INFO  site-chat: answered in 812ms\n2026-08-25 14:03:19 ERROR site-chat: key[1] parked 60s',
  },
  {
    name: 'Duplicate word',
    pattern: '\\b(\\w+)\\s+\\1\\b',
    flags: 'gi',
    group: 'Prose',
    note: 'A backreference, which is why this cannot be done with a plain search. Catches the the mistake this sentence contains.',
    sample: 'This is is a test of of the the duplicate word finder.',
  },
  {
    name: 'Markdown link',
    pattern: '\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)',
    flags: '',
    group: 'Prose',
    note: 'Group 1 is the label, 2 the target, 3 the optional title. Nested brackets inside a label defeat it, as they defeat most Markdown parsers.',
    sample: 'See [the tools index](/tools) and [Astro](https://astro.build "the framework").',
  },
  {
    name: 'Trailing whitespace',
    pattern: '[ \\t]+$',
    flags: 'm',
    group: 'Code',
    note: 'With the multiline flag this finds every line ending in a space or tab. Replace with nothing to clean a file.',
    sample: 'clean line\ntrailing spaces here   \ntab after this\t\nfine',
  },
  {
    name: 'Quoted string',
    pattern: '"(?:[^"\\\\]|\\\\.)*"',
    flags: '',
    group: 'Code',
    note: 'Handles escaped quotes inside the string, which the naive ".*?" does not. Single-quoted strings need the mirrored pattern.',
    sample: 'const a = "plain"; const b = "with \\" an escaped quote"; const c = "";',
  },
  {
    name: 'Hex colour',
    pattern: '#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b',
    flags: '',
    group: 'Code',
    note: 'Covers 3, 4, 6 and 8 digit forms, so the two with an alpha channel are included.',
    sample: '--c-accent: #fffa00; --c-line: #2a2a2e; --soft: #fffa0019; short #f00',
  },
  {
    name: 'Python identifier assignment',
    pattern: '^\\s*([A-Za-z_]\\w*)\\s*(?::\\s*([^=\\n]+?))?\\s*=\\s*(.+)$',
    flags: 'm',
    group: 'Code',
    note: 'Captures name, optional annotation, and value. It matches inside strings and comments too, because a regex cannot see syntax.',
    sample:
      'count = 0\nname: str = "particle"\n  indented: int = 12  # a comment\nnot an assignment',
  },
];

/** Template groups, in display order. */
export const TEMPLATE_GROUPS: readonly string[] = [
  'Contact',
  'Network',
  'Code',
  'Logs',
  'Time',
  'Prose',
];

/* ── Explanation ──────────────────────────────────────────────────────── */

export interface Token {
  readonly text: string;
  readonly kind: 'literal' | 'group' | 'class' | 'quantifier' | 'anchor' | 'escape' | 'alternation';
  readonly note: string;
}

/**
 * Break a pattern into annotated tokens.
 *
 * A single-pass scanner, not a parser. It cannot report nesting depth and does
 * not try to: the goal is to answer "what does `(?<=` mean" for someone reading
 * a pattern they inherited, and a flat list of labelled pieces does that.
 */
export function explain(pattern: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i] ?? '';

    if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      // A brace escape such as \p{L} is one token, so the class name stays attached.
      if ((next === 'p' || next === 'P') && pattern[i + 2] === '{') {
        const close = pattern.indexOf('}', i + 3);
        const end = close === -1 ? pattern.length : close + 1;
        const text = pattern.slice(i, end);
        tokens.push({
          text,
          kind: 'escape',
          note: `${next === 'p' ? 'Any' : 'Any character that is not a'} character in the Unicode category ${text.slice(3, -1)}. Needs the u or v flag.`,
        });
        i = end;
        continue;
      }
      tokens.push({ text: `\\${next}`, kind: 'escape', note: escapeNote(next) });
      i += 2;
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      if (pattern[j] === '^') j += 1;
      if (pattern[j] === ']') j += 1;
      while (j < pattern.length && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1;
      const text = pattern.slice(i, Math.min(j + 1, pattern.length));
      tokens.push({
        text,
        kind: 'class',
        note:
          text[1] === '^'
            ? 'Any one character NOT listed in the brackets.'
            : 'Any one character listed in the brackets. A hyphen between two characters is a range.',
      });
      i = j + 1;
      continue;
    }

    if (ch === '(') {
      const head = pattern.slice(i, i + 4);
      const known: ReadonlyArray<readonly [string, string]> = [
        [
          '(?:',
          'Group without capturing. Groups for a quantifier or an alternation, and takes no group number.',
        ],
        ['(?=', 'Lookahead. What follows must match here, and none of it is consumed.'],
        ['(?!', 'Negative lookahead. What follows must NOT match here.'],
        ['(?<=', 'Lookbehind. What precedes must match. Unsupported in Safari before 16.4.'],
        ['(?<!', 'Negative lookbehind. What precedes must NOT match.'],
      ];
      const hit = known.find(([prefix]) => head.startsWith(prefix));
      if (hit) {
        tokens.push({ text: hit[0], kind: 'group', note: hit[1] });
        i += hit[0].length;
        continue;
      }
      if (head.startsWith('(?<')) {
        const close = pattern.indexOf('>', i);
        const end = close === -1 ? i + 3 : close + 1;
        tokens.push({
          text: pattern.slice(i, end),
          kind: 'group',
          note: `Named capture group "${pattern.slice(i + 3, end - 1)}". Referred to as \\k<name> in the pattern and $<name> in a replacement.`,
        });
        i = end;
        continue;
      }
      tokens.push({
        text: '(',
        kind: 'group',
        note: 'Capture group. Numbered left to right by opening bracket, and available as $1 in a replacement.',
      });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ text: ')', kind: 'group', note: 'Closes the group.' });
      i += 1;
      continue;
    }

    if (ch === '{') {
      const close = pattern.indexOf('}', i);
      const body = close === -1 ? '' : pattern.slice(i + 1, close);
      if (/^\d+(,\d*)?$/.test(body)) {
        const [minRaw, maxRaw] = body.split(',');
        const lazy = pattern[close + 1] === '?';
        tokens.push({
          text: pattern.slice(i, close + (lazy ? 2 : 1)),
          kind: 'quantifier',
          note:
            maxRaw === undefined
              ? `Exactly ${minRaw} times.`
              : maxRaw === ''
                ? `${minRaw} or more times. Unbounded, so this is one to watch for backtracking.`
                : `Between ${minRaw} and ${maxRaw} times${lazy ? ', preferring the fewest' : ''}.`,
        });
        i = close + (lazy ? 2 : 1);
        continue;
      }
      tokens.push({
        text: '{',
        kind: 'literal',
        note: 'A literal brace: it is not a valid repeat count.',
      });
      i += 1;
      continue;
    }

    if (ch === '*' || ch === '+' || ch === '?') {
      // JavaScript has lazy quantifiers and no possessive ones, so `?` is the
      // only suffix worth folding into this token.
      const lazy = pattern[i + 1] === '?';
      tokens.push({
        text: lazy ? `${ch}?` : ch,
        kind: 'quantifier',
        note: quantifierNote(ch, lazy),
      });
      i += lazy ? 2 : 1;
      continue;
    }

    if (ch === '^' || ch === '$') {
      tokens.push({
        text: ch,
        kind: 'anchor',
        note:
          ch === '^'
            ? 'Start of the input, or of any line with the m flag.'
            : 'End of the input, or of any line with the m flag.',
      });
      i += 1;
      continue;
    }

    if (ch === '|') {
      tokens.push({
        text: '|',
        kind: 'alternation',
        note: 'Either side. It splits the whole enclosing group, so bracket it if you meant less.',
      });
      i += 1;
      continue;
    }

    if (ch === '.') {
      tokens.push({
        text: '.',
        kind: 'class',
        note: 'Any character except a line break, or any character at all with the s flag.',
      });
      i += 1;
      continue;
    }

    // Runs of ordinary characters collapse into one token so the list stays readable.
    let j = i;
    while (j < pattern.length && !'\\[({*+?^$|.)}'.includes(pattern[j] ?? '')) j += 1;
    tokens.push({
      text: pattern.slice(i, j),
      kind: 'literal',
      note: 'Matches exactly this text.',
    });
    i = j;
  }

  return tokens;
}

function quantifierNote(ch: string, lazy: boolean): string {
  const base =
    ch === '*'
      ? 'Zero or more of what precedes'
      : ch === '+'
        ? 'One or more of what precedes'
        : 'Optional: zero or one of what precedes';
  const greed = lazy
    ? ', preferring as few as possible'
    : ch === '?'
      ? ''
      : ', taking as many as possible and giving them back only under pressure';
  return `${base}${greed}.`;
}

function escapeNote(ch: string): string {
  const notes: Record<string, string> = {
    d: 'Any digit, 0 to 9.',
    D: 'Any character that is not a digit.',
    w: 'A word character: a letter, a digit, or an underscore. ASCII only, so accented letters are excluded.',
    W: 'Any character that is not a word character.',
    s: 'Any whitespace: space, tab, newline, and the Unicode spaces.',
    S: 'Any character that is not whitespace.',
    b: 'A word boundary. Zero width: it matches a position, not a character.',
    B: 'A position that is not a word boundary.',
    n: 'A line feed.',
    r: 'A carriage return.',
    t: 'A tab.',
    '0': 'A null character.',
    k: 'A backreference to a named group, written \\k<name>.',
  };
  if (notes[ch]) return notes[ch];
  if (/\d/.test(ch)) return `A backreference: the same text that group ${ch} matched.`;
  return `A literal ${ch}, with its special meaning removed.`;
}
