/**
 * Tools registry.
 *
 * The tools index renders straight from this array, so shipping a new utility
 * is: build the island, add the route, add one entry here. Nothing else.
 *
 * `offline` is not decoration. `ToolLayout` reads it to decide what the page
 * promises about the network, and one tool here — the MCP tester — genuinely
 * cannot be offline, because talking to a server is the entire job.
 */

export type ToolStatus = 'live' | 'planned';

export interface ToolEntry {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  /** Longer "why this exists" line, shown on the tool page itself. */
  readonly rationale: string;
  readonly status: ToolStatus;
  /** Grouping label on the index. */
  readonly group: 'tokens' | 'prompt' | 'data' | 'text' | 'protocol' | 'runtime' | 'generate';
  /**
   * True when the tool does all of its work in-browser with no network calls.
   * Surfaced in the UI — it matters when someone pastes a real prompt in.
   */
  readonly offline: boolean;
  /**
   * What the page does touch, when `offline` is false. One sentence, shown in
   * place of the blanket privacy note.
   */
  readonly network?: string;
}

export const TOOLS: readonly ToolEntry[] = [
  {
    slug: 'token-counter',
    name: 'Token Counter',
    summary: 'Count tokens and price them against 2,400 models from every major provider.',
    rationale:
      'Context budgeting is guesswork without a real count, and model choice is guesswork without a real price. Paste a prompt, see tokens, then compare projected cost across the whole hosted-model catalogue rather than the four models you happen to remember.',
    status: 'live',
    group: 'tokens',
    offline: false,
    network:
      'Fetches a static price table from this site. Your text is never sent anywhere, and the request carries nothing but its own URL.',
  },
  {
    slug: 'text-diff',
    name: 'Text Diff',
    summary: 'Compare two revisions lexically and semantically, with a real change ratio.',
    rationale:
      'Paste or drop two files and see exactly what moved: Myers line alignment, word-level highlighting inside modified lines, and a character-level similarity ratio that does not call a one-word edit a rewritten paragraph. Then ask the other question, whether the meaning moved, and watch the two answers disagree.',
    status: 'live',
    group: 'text',
    offline: false,
    network:
      'The diff itself runs in this tab. The semantic comparison is opt-in per click: pressing it sends both texts to this site’s backend to be embedded, and nothing is stored there.',
  },
  {
    slug: 'chunk-visualizer',
    name: 'Chunk Visualizer',
    summary: 'See how a splitter carves a document, and where it cuts badly.',
    rationale:
      'Retrieval quality dies at chunk boundaries. Run seven real chunking strategies over your own document and see the cuts painted in place, with size distribution, the overlap you actually got, and every boundary that lands mid-sentence.',
    status: 'live',
    group: 'text',
    offline: true,
  },
  {
    slug: 'mcp-tester',
    name: 'MCP Tester',
    summary: 'Probe an MCP endpoint: handshake, tools, schema conformance, latency.',
    rationale:
      'An MCP server that returns 200 is not the same as an MCP server that works. Point this at an endpoint and it negotiates a protocol era, identifies the server, validates every tool schema, checks error handling, samples latency, and lets you call a tool by hand.',
    status: 'live',
    group: 'protocol',
    offline: false,
    network:
      'Sends requests to the endpoint you name, straight from this tab. No proxy, no relay, nothing stored. Tokens you paste go only to that server.',
  },
  {
    slug: 'python-runner',
    name: 'Python Runner',
    summary: 'Run Python in the tab, with real packages from PyPI.',
    rationale:
      'Most of the work here is a Python package with no interface, and the fastest way to show what one does is to let you run it. This is CPython compiled to WebAssembly with a package installer attached, so a wheel from PyPI runs in the same tab you are reading this in.',
    status: 'live',
    group: 'runtime',
    offline: false,
    network:
      'Downloads the Python runtime and any packages from public CDNs on first use. Your code runs in this tab and is never sent anywhere.',
  },
  {
    slug: 'string-kit',
    name: 'String Kit',
    summary: 'Raw HTML to clean Markdown, plus thirty text transforms.',
    rationale:
      'The converter is the reason to come here: paste a page’s source and get Markdown with the navigation, banners and share bars stripped out. Behind it sits a shelf of transforms for the things that waste ten minutes at a time, each one saying where it stops being safe.',
    status: 'live',
    group: 'text',
    offline: true,
  },
  {
    slug: 'regex-lab',
    name: 'Regex Lab',
    summary: 'Match, replace, filter and explain, with a guard against the patterns that hang.',
    rationale:
      'Four questions about one piece of text: what matches, what a replacement would do, which lines survive an include and exclude list, and what the pattern actually says. Patterns shaped like a catastrophic backtrack are flagged before they run, because nothing in a browser can interrupt one that has started.',
    status: 'live',
    group: 'text',
    offline: true,
  },
  {
    slug: 'random-kit',
    name: 'Random Kit',
    summary: 'Numbers, lists, strings and dice, from a source you pick.',
    rationale:
      'Every other generator hides where its randomness comes from, which leaves the only two questions that matter unanswered: can I reproduce this, and is it safe to use as a secret. Here the source is the first control on the page, and both answers are stated.',
    status: 'live',
    group: 'generate',
    offline: true,
  },
  {
    slug: 'read-time',
    name: 'Read Time',
    summary: 'How long to read, and how long to say, measured from a real voice.',
    rationale:
      'A word count against a published rate gets you close. Speaking rate varies by more than double across the voices on one machine, so this drives the browser’s own speech engine, watches its progress events, and fits the real rate in about two seconds regardless of how long the text is.',
    status: 'live',
    group: 'text',
    offline: true,
  },
  {
    slug: 'rest-reminder',
    name: 'Rest Reminder',
    summary: 'Tactical HUD recovery clock with cross-platform OS notifications and zero-network audio synthesis.',
    rationale:
      'Long uninterrupted screen sessions cause ciliary eye lock and posture fatigue. Set your cadence (20-20-20 eye care, 25m Pomodoro, 50m deep work, 90m ultradian rhythm), get native OS alerts to your desktop or phone, and follow tactical box-breathing prompts during breaks.',
    status: 'live',
    group: 'runtime',
    offline: true,
  },
  {
    slug: 'context-budget',
    name: 'Context Budgeter',
    summary: 'Model a context window as a budget across system, tools, and history.',
    rationale:
      'Shows what actually fits: allocate a window between system prompt, tool schemas, retrieved chunks, and conversation history.',
    status: 'planned',
    group: 'tokens',
    offline: true,
  },
  {
    slug: 'json-schema-forge',
    name: 'JSON Schema Forge',
    summary: 'Turn sample JSON into a strict tool-use schema.',
    rationale:
      'Structured-output schemas are tedious to hand-write. Paste representative JSON, get a tightened schema with enums and required fields inferred.',
    status: 'planned',
    group: 'data',
    offline: true,
  },
] as const;

export const TOOL_GROUPS: Record<ToolEntry['group'], string> = {
  tokens: 'Tokens & Cost',
  prompt: 'Prompt Engineering',
  data: 'Structured Data',
  text: 'Text Processing',
  protocol: 'Protocol & Agents',
  runtime: 'Run Code',
  generate: 'Generators',
};
