/**
 * What each tool's demo screen shows.
 *
 * Presentation data for the home page's tool showcase, kept here rather than in
 * `src/data/tools.ts` for the same reason `deck/frames.ts` exists: the registry
 * describes the tool, this describes one particular way of drawing it, and the
 * two should not have to change together.
 *
 * ## What a screen is allowed to claim
 *
 * These are samples, labelled as samples. Where the output is arithmetic the
 * numbers are the right arithmetic for the input shown (412 words at 200 words
 * a minute really is two minutes); where it is structure, the rows show the
 * fields the tool reports rather than a measurement it did not take. Nothing
 * here is a benchmark and nothing should read as one.
 */

/** How a row is tinted. Diffs and matches want more than one colour. */
export type Tone = 'plain' | 'accent' | 'plus' | 'minus' | 'faint';

export interface ScreenRow {
  label: string;
  value: string;
  tone?: Tone;
}

export interface ToolScreen {
  /** Matches a `slug` in `src/data/tools.ts`. */
  slug: string;
  /** What the sample input is called on this tool's screen. */
  inputLabel: string;
  /** Typed out, character by character, when the screen opens. */
  input: string;
  /** Revealed one at a time once the input has finished typing. */
  rows: readonly ScreenRow[];
}

export const SCREENS: readonly ToolScreen[] = [
  {
    slug: 'token-counter',
    inputLabel: 'Prompt',
    input: 'Summarise the attached transcript in five bullets.',
    rows: [
      { label: 'characters', value: '49' },
      { label: 'tokens', value: '10' },
      { label: 'catalogue', value: '2,400 models priced', tone: 'faint' },
      { label: 'cheapest / dearest', value: 'sorted by projected cost', tone: 'accent' },
    ],
  },
  {
    slug: 'text-diff',
    inputLabel: 'Two revisions',
    input: 'draft-v3.md  ←→  draft-v4.md',
    rows: [
      { label: '- 14', value: 'const timeout = 5_000;', tone: 'minus' },
      { label: '+ 14', value: 'const timeout = RETRY_MS;', tone: 'plus' },
      { label: '~ 22', value: 'word-level highlight inside the line', tone: 'accent' },
      { label: 'similarity', value: 'character ratio, not line count', tone: 'faint' },
    ],
  },
  {
    slug: 'chunk-visualizer',
    inputLabel: 'Document',
    input: '1 file · fixed 512 · overlap 64',
    rows: [
      { label: 'chunk 01', value: '████████████████ 512', tone: 'accent' },
      { label: 'chunk 02', value: '  ██████████████ 512' },
      { label: 'chunk 03', value: '    ████████ 291', tone: 'faint' },
      { label: 'boundaries', value: 'where a sentence gets cut in half' },
    ],
  },
  {
    slug: 'mcp-tester',
    inputLabel: 'Server',
    input: 'stdio://./server --transport stdio',
    rows: [
      { label: 'initialize', value: 'protocol 2025-06-18', tone: 'plus' },
      { label: 'tools/list', value: '7 tools', tone: 'plus' },
      { label: 'tools/call', value: 'search_docs → 1 content block', tone: 'accent' },
      { label: 'frames', value: 'every request and response, raw', tone: 'faint' },
    ],
  },
  {
    slug: 'python-runner',
    inputLabel: 'Cell',
    input: 'import numpy as np; np.arange(6).reshape(2, 3)',
    rows: [
      { label: 'runtime', value: 'CPython on WebAssembly', tone: 'faint' },
      { label: 'out', value: 'array([[0, 1, 2],', tone: 'accent' },
      { label: '', value: '       [3, 4, 5]])', tone: 'accent' },
      { label: 'network', value: 'none, it runs in this tab' },
    ],
  },
  {
    slug: 'string-kit',
    inputLabel: 'Input',
    input: 'Applied ML Engineer',
    rows: [
      { label: 'kebab', value: 'applied-ml-engineer', tone: 'accent' },
      { label: 'snake', value: 'applied_ml_engineer' },
      { label: 'base64', value: 'QXBwbGllZCBNTCBFbmdpbmVlcg==' },
      { label: 'sha-256', value: 'and twenty other transforms', tone: 'faint' },
    ],
  },
  {
    slug: 'regex-lab',
    inputLabel: 'Pattern',
    input: '/(\\w+)@(\\w+)\\.(\\w{2,})/g',
    rows: [
      { label: 'match 1', value: 'guan@example.com', tone: 'accent' },
      { label: '$1 $2 $3', value: 'guan · example · com', tone: 'plus' },
      { label: 'explain', value: 'each group, in English' },
      { label: 'steps', value: 'catastrophic backtracking, caught', tone: 'faint' },
    ],
  },
  {
    slug: 'random-kit',
    inputLabel: 'Draw',
    input: 'uuid v4 · 1 value',
    rows: [
      { label: 'uuid', value: '9f2c41a8-7d3e-4b16-b0aa-5e1c8f92d704', tone: 'accent' },
      { label: 'source', value: 'crypto.getRandomValues' },
      { label: 'also', value: 'passwords, ints, picks, shuffles' },
      { label: 'seeded', value: 'reproducible when you want it', tone: 'faint' },
    ],
  },
  {
    slug: 'read-time',
    inputLabel: 'Article',
    input: '412 words · 2,380 characters',
    rows: [
      { label: 'reading', value: '2 min at 200 wpm', tone: 'accent' },
      { label: 'speaking', value: '3 min at 130 wpm' },
      { label: 'longest sentence', value: '38 words' },
      { label: 'grade', value: 'readability, and where it drops', tone: 'faint' },
    ],
  },
  {
    slug: 'rest-reminder',
    inputLabel: 'Cycle',
    input: '20 min focus · 20 s look away · 20 ft',
    rows: [
      { label: 'next break', value: '11:24', tone: 'accent' },
      { label: 'today', value: '6 cycles' },
      { label: 'alert', value: 'in-page, no notification permission' },
      { label: 'state', value: 'survives a reload', tone: 'faint' },
    ],
  },
];

/** Screen for a slug, if the showcase carries one. */
export function screenFor(slug: string): ToolScreen | undefined {
  return SCREENS.find((s) => s.slug === slug);
}
