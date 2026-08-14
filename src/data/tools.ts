/**
 * Tools registry.
 *
 * The tools index renders straight from this array, so shipping a new utility
 * is: build the island, add the route, add one entry here. Nothing else.
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
  readonly group: 'tokens' | 'prompt' | 'data' | 'text';
  /**
   * True when the tool does all of its work in-browser with no network calls.
   * Surfaced in the UI — it matters when someone pastes a real prompt in.
   */
  readonly offline: boolean;
}

export const TOOLS: readonly ToolEntry[] = [
  {
    slug: 'token-counter',
    name: 'Token Counter',
    summary: 'Count tokens and estimate cost across model tokenizers.',
    rationale:
      'Context budgeting is guesswork without a real count. Paste a prompt, see tokens, characters, and projected input cost per model.',
    status: 'live',
    group: 'tokens',
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
    slug: 'prompt-diff',
    name: 'Prompt Diff',
    summary: 'Token-aware diff between two prompt revisions.',
    rationale:
      'Word diffs mislead on prompts. This one aligns on token boundaries so you can see what a revision truly costs.',
    status: 'planned',
    group: 'prompt',
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
  {
    slug: 'chunk-visualizer',
    name: 'Chunk Visualizer',
    summary: 'See how a splitter carves a document, and where it cuts badly.',
    rationale:
      'Retrieval quality dies at chunk boundaries. Visualise size, overlap, and the splits that land mid-sentence.',
    status: 'planned',
    group: 'text',
    offline: true,
  },
] as const;

export const TOOL_GROUPS: Record<ToolEntry['group'], string> = {
  tokens: 'Tokens & Cost',
  prompt: 'Prompt Engineering',
  data: 'Structured Data',
  text: 'Text Processing',
};
