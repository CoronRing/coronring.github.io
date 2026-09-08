import React, { useState } from 'react';

interface TransformPreset {
  id: string;
  name: string;
  inputTitle: string;
  outputTitle: string;
  input: string;
  output: string;
  savings: string;
  detail: string;
}

const PRESETS: TransformPreset[] = [
  {
    id: 'html-md',
    name: 'HTML → Clean Markdown',
    inputTitle: 'Raw Scraped HTML (With Ads & Nav)',
    outputTitle: 'Stripped Markdown for Context Window',
    input: `<article class="post-content">
  <div class="ad-banner tracking">Sponsored</div>
  <h1>Agent Evaluation Harness</h1>
  <p>To measure <strong>hallucination</strong> in production, track <a href="/benchmark">score distributions</a>.</p>
  <nav class="share-widget"><button>Tweet</button></nav>
</article>`,
    output: `# Agent Evaluation Harness

To measure **hallucination** in production, track [score distributions](/benchmark).`,
    savings: '-68% tokens saved (strips boilerplate DOM)',
    detail: 'Sanitizes DOM trees, preserves semantic text & links, strips tracking scripts.',
  },
  {
    id: 'case',
    name: 'Identifier Case Studio',
    inputTitle: 'Raw Input Text / Role Name',
    outputTitle: 'Multi-Case Transformed Identifiers',
    input: `applied ML agent benchmark runner v2`,
    output: `kebab-case:    applied-ml-agent-benchmark-runner-v2
snake_case:    applied_ml_agent_benchmark_runner_v2
PascalCase:    AppliedMlAgentBenchmarkRunnerV2
SCREAMING:     APPLIED_ML_AGENT_BENCHMARK_RUNNER_V2`,
    savings: 'Instant normalization for APIs & code generation',
    detail: 'Clean boundary detection handles camelCase, acronyms, and punctuation.',
  },
  {
    id: 'clean',
    name: 'Text Normalizer & Dedup',
    inputTitle: 'Messy Terminal Log / OCR Text',
    outputTitle: 'Sanitized Output Text',
    input: `[INFO] \u001b[32mBuild completed\u001b[0m in 1.42s...  \n\n\n\n\tModel latency: 120ms\t\t\n   Trailing spaces removed   `,
    output: `[INFO] Build completed in 1.42s...
Model latency: 120ms
Trailing spaces removed`,
    savings: '-42% token waste from unneeded whitespace & escapes',
    detail: 'Strips ANSI escape sequences, collapses excessive blank lines, normalizes tabs.',
  },
];

interface Props {
  href: string;
}

export default function StringStage({ href }: Props): React.ReactElement {
  const [activePreset, setActivePreset] = useState(0);
  const preset = PRESETS[activePreset] ?? PRESETS[0]!;

  return (
    <div className="space-y-6">
      {/* ── Preset Switcher & Efficiency Badge ─────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-faint mr-2 font-mono text-[11px] tracking-wider uppercase">
            Transform:
          </span>
          {PRESETS.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePreset(idx)}
              className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                idx === activePreset
                  ? 'bg-accent-fill text-accent-on-fill font-medium'
                  : 'bg-raised text-muted hover:text-fg'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-[var(--c-ok)]">
          <span className="size-2 rounded-full bg-[var(--c-ok)]" />
          <span className="font-semibold">{preset.savings}</span>
        </div>
      </div>

      {/* ── Side-by-Side Dual Pane Workbench ──────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Input Pane */}
        <div className="border-line bg-surface/80 flex flex-col overflow-hidden rounded-sm border">
          <div className="border-line bg-raised/30 flex items-center justify-between border-b px-3 py-2">
            <span className="text-faint font-mono text-[11px] uppercase">{preset.inputTitle}</span>
            <span className="text-alert font-mono text-[10px]">Unprocessed Input</span>
          </div>
          <div className="min-h-[10rem] flex-1 overflow-x-auto bg-[var(--c-ground)]/40 p-3.5">
            <pre className="text-muted font-mono text-xs leading-relaxed whitespace-pre-wrap">
              <code>{preset.input}</code>
            </pre>
          </div>
        </div>

        {/* Output Pane */}
        <div className="border-line bg-surface/80 flex flex-col overflow-hidden rounded-sm border">
          <div className="border-line bg-raised/30 flex items-center justify-between border-b px-3 py-2">
            <span className="text-faint font-mono text-[11px] uppercase">{preset.outputTitle}</span>
            <span className="font-mono text-[10px] text-[var(--c-ok)]">Clean Result</span>
          </div>
          <div className="bg-surface min-h-[10rem] flex-1 overflow-x-auto p-3.5">
            <pre className="text-fg font-mono text-xs leading-relaxed whitespace-pre-wrap">
              <code>{preset.output}</code>
            </pre>
          </div>
        </div>
      </div>

      {/* ── 30+ Text Transforms Summary Shelf ──────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="text-faint">Included 30+ transforms:</span>
        {[
          'Markdown to HTML',
          'Slugify',
          'Base64 encode/decode',
          'URL codec',
          'JSON format',
          'Word count',
          'Diff clean',
        ].map((t) => (
          <span
            key={t}
            className="border-line bg-surface text-muted rounded-sm border px-2 py-0.5 text-[11px]"
          >
            {t}
          </span>
        ))}
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="text-muted font-mono text-xs">{preset.detail}</p>

        <a
          href={href}
          className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
        >
          <span>Open String Kit</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
            <path
              d="M3 8 H13 M9 4 L13 8 L9 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
