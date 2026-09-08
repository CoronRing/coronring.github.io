import React, { useState } from 'react';

interface SamplePrompt {
  id: string;
  name: string;
  text: string;
  tokens: Array<{ text: string; color: string }>;
  charCount: number;
  tokenCount: number;
}

const SAMPLES: SamplePrompt[] = [
  {
    id: 'agent',
    name: 'Agent Prompt',
    text: 'Summarize the attached transcript in 5 concise bullets. Focus on agent failure modes.',
    tokens: [
      {
        text: 'Sum',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      { text: 'mar', color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25' },
      { text: 'ize', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      {
        text: ' the',
        color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      },
      {
        text: ' attached',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      {
        text: ' transcript',
        color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
      },
      {
        text: ' in',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      {
        text: ' 5',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      {
        text: ' concise',
        color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      },
      {
        text: ' bullets',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      { text: '.', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' Focus',
        color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      },
      {
        text: ' on',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      {
        text: ' agent',
        color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
      },
      {
        text: ' failure',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      { text: ' modes', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      { text: '.', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
    ],
    charCount: 86,
    tokenCount: 17,
  },
  {
    id: 'code',
    name: 'Python Schema',
    text: 'def calculate_context_budget(used: int, limit: int = 128000) -> float:',
    tokens: [
      { text: 'def', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25' },
      {
        text: ' calculate',
        color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      },
      { text: '_context', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      {
        text: '_budget',
        color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      },
      { text: '(', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: 'used',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      { text: ':', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' int',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      { text: ',', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' limit',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      { text: ':', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' int',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      {
        text: ' =',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      { text: ' 128', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      { text: '000', color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25' },
      { text: ')', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' ->',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      {
        text: ' float',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      { text: ':', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
    ],
    charCount: 71,
    tokenCount: 19,
  },
  {
    id: 'rag',
    name: 'RAG Chunk',
    text: 'Model Context Protocol (MCP) standardizes how AI applications provide tools to LLMs.',
    tokens: [
      {
        text: 'Model',
        color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      },
      { text: ' Context', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      {
        text: ' Protocol',
        color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      },
      { text: ' (', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: 'MCP',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      { text: ')', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
      {
        text: ' standard',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      { text: 'izes', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25' },
      {
        text: ' how',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      { text: ' AI', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25' },
      {
        text: ' applications',
        color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      },
      {
        text: ' provide',
        color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      },
      {
        text: ' tools',
        color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
      },
      {
        text: ' to',
        color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
      },
      { text: ' LL', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25' },
      {
        text: 'Ms',
        color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      },
      { text: '.', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25' },
    ],
    charCount: 84,
    tokenCount: 17,
  },
];

const MODELS = [
  {
    name: 'Claude 3.5 Sonnet',
    inPrice: 3.0,
    outPrice: 15.0,
    provider: 'Anthropic',
    barWidth: '92%',
  },
  { name: 'GPT-4o', inPrice: 2.5, outPrice: 10.0, provider: 'OpenAI', barWidth: '78%' },
  { name: 'Gemini 1.5 Pro', inPrice: 1.25, outPrice: 5.0, provider: 'Google', barWidth: '46%' },
  {
    name: 'Llama 3.3 70B',
    inPrice: 0.59,
    outPrice: 0.79,
    provider: 'Meta / Groq',
    barWidth: '22%',
  },
];

interface Props {
  href: string;
}

export default function TokenStage({ href }: Props): React.ReactElement {
  const [selectedSample, setSelectedSample] = useState(0);
  const sample = SAMPLES[selectedSample] ?? SAMPLES[0]!;

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Presets & Live Counters ──────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-faint mr-2 font-mono text-[11px] tracking-wider uppercase">
            Sample:
          </span>
          {SAMPLES.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSample(idx)}
              className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                idx === selectedSample
                  ? 'bg-accent-fill text-accent-on-fill font-medium'
                  : 'bg-raised text-muted hover:text-fg'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 font-mono text-xs">
          <div className="flex items-baseline gap-1.5">
            <span className="text-faint">Tokens:</span>
            <span className="text-accent text-sm font-semibold">{sample.tokenCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-faint">Characters:</span>
            <span className="text-fg font-semibold">{sample.charCount}</span>
          </div>
          <div className="hidden items-baseline gap-1.5 sm:flex">
            <span className="text-faint">Ratio:</span>
            <span className="text-muted">
              {(sample.charCount / sample.tokenCount).toFixed(1)} c/t
            </span>
          </div>
        </div>
      </div>

      {/* ── Visual Token Breakdown Chip Cloud ─────────────────────────── */}
      <div className="border-line bg-surface/60 rounded-sm border p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow text-[11px]">BPE Token Segmentation</p>
          <span className="text-faint font-mono text-[10px]">
            {sample.tokenCount} tokens parsed
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-xs leading-relaxed select-text sm:text-[13px]">
          {sample.tokens.map((tok, i) => (
            <span
              key={`${tok.text}-${i}`}
              className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 transition-transform hover:scale-105 ${tok.color}`}
              title={`Token #${i + 1}: "${tok.text}"`}
            >
              {tok.text}
            </span>
          ))}
        </div>
      </div>

      {/* ── Multi-Model Price Catalogue Breakdown ───────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-[11px]">Catalogue Pricing (2,400+ Models Indexed)</p>
          <span className="text-faint font-mono text-[10px]">$ / Million Tokens (Input)</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {MODELS.map((model) => {
            const costPer1k = ((sample.tokenCount * model.inPrice) / 1000).toFixed(4);
            return (
              <div
                key={model.name}
                className="group border-line bg-surface/80 hover:border-fg rounded-sm border p-3 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-fg font-mono text-xs font-semibold">{model.name}</span>
                  <span className="text-faint font-mono text-[10px]">{model.provider}</span>
                </div>

                <div className="mt-2.5 flex items-baseline justify-between font-mono text-xs">
                  <span className="text-muted">
                    ${model.inPrice.toFixed(2)}{' '}
                    <span className="text-faint text-[10px]">/ MTok</span>
                  </span>
                  <span className="text-accent font-semibold">
                    ${costPer1k} <span className="text-faint text-[10px]">/ call</span>
                  </span>
                </div>

                {/* Relative price gauge */}
                <div className="bg-sunken mt-2 h-1 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-accent-fill h-full transition-all duration-500"
                    style={{ width: model.barWidth }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Context Headroom & Footer CTA ──────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <div className="text-muted flex items-center gap-3 font-mono text-xs">
          <span className="size-2 rounded-full bg-[var(--c-ok)]" />
          <span>
            128k context window: <strong className="text-fg">0.01% used</strong>
          </span>
          <span className="text-faint hidden sm:inline">· 127,983 headroom</span>
        </div>

        <a
          href={href}
          className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
        >
          <span>Open Full Token Counter</span>
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
