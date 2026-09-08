import React, { useState } from 'react';

export interface OtherToolItem {
  slug: string;
  name: string;
  summary: string;
  group: 'text' | 'runtime' | 'generate';
  offline: boolean;
  href: string;
  badge: string;
}

const OTHER_TOOLS: OtherToolItem[] = [
  {
    slug: 'text-diff',
    name: 'Text Diff',
    summary: 'Compare two revisions lexically and semantically, with a real change ratio.',
    group: 'text',
    offline: false,
    href: '/tools/text-diff',
    badge: 'Myers Diff + Embeddings',
  },
  {
    slug: 'chunk-visualizer',
    name: 'Chunk Visualizer',
    summary: 'See how splitters carve documents, and inspect boundary cuts mid-sentence.',
    group: 'text',
    offline: true,
    href: '/tools/chunk-visualizer',
    badge: '7 Chunking Strategies',
  },
  {
    slug: 'python-runner',
    name: 'Python Runner',
    summary: 'Run Python in the tab, with real packages from PyPI on WebAssembly.',
    group: 'runtime',
    offline: false,
    href: '/tools/python-runner',
    badge: 'CPython on WASM',
  },
  {
    slug: 'regex-lab',
    name: 'Regex Lab',
    summary: 'Match, replace, filter, and detect catastrophic backtracking before it hangs.',
    group: 'text',
    offline: true,
    href: '/tools/regex-lab',
    badge: 'ReDoS Guard Protected',
  },
  {
    slug: 'doc-viewer',
    name: 'Document Viewer',
    summary: 'Render Markdown, HTML, video, audio, and code from GitHub or web URLs cleanly.',
    group: 'text',
    offline: false,
    href: '/tools/doc-viewer',
    badge: 'Sandboxed Viewport',
  },
  {
    slug: 'random-kit',
    name: 'Random Kit',
    summary: 'Numbers, lists, strings and dice, with explicit CSPRNG cryptographic source.',
    group: 'generate',
    offline: true,
    href: '/tools/random-kit',
    badge: 'CSPRNG Cryptographic',
  },
  {
    slug: 'read-time',
    name: 'Read Time',
    summary: 'How long to read and speak, measured directly from the browser speech engine.',
    group: 'text',
    offline: true,
    href: '/tools/read-time',
    badge: 'Speech Synthesis Fit',
  },
];

interface Props {
  indexHref: string;
}

export default function OtherStage({ indexHref }: Props): React.ReactElement {
  const [filter, setFilter] = useState<'all' | 'text' | 'runtime' | 'generate'>('all');

  const filtered = OTHER_TOOLS.filter((t) => filter === 'all' || t.group === filter);

  return (
    <div className="space-y-6">
      {/* ── Filter Bar & Suite Count ───────────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-faint mr-2 font-mono text-[11px] tracking-wider uppercase">
            Category:
          </span>
          {(
            [
              { id: 'all', label: 'All (7)' },
              { id: 'text', label: 'Text & Diff' },
              { id: 'runtime', label: 'Runtime' },
              { id: 'generate', label: 'Generators' },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                filter === c.id
                  ? 'bg-accent-fill text-accent-on-fill font-medium'
                  : 'bg-raised text-muted hover:text-fg'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <span className="text-faint font-mono text-xs">7 remaining utilities · 11 total live</span>
      </div>

      {/* ── Visual Mini-Grid ───────────────────────────────────────────── */}
      <div className="grid max-h-[19rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <a
            key={item.slug}
            href={item.href}
            className="group border-line bg-surface/80 hover:border-fg flex flex-col justify-between rounded-sm border p-3.5 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg group-hover:text-accent font-mono text-xs font-semibold transition-colors">
                  {item.name}
                </span>
                <span className="text-faint border-line rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase">
                  {item.badge}
                </span>
              </div>
              <p className="text-muted mt-2 line-clamp-2 text-xs leading-relaxed">{item.summary}</p>
            </div>

            <div className="border-line/60 text-faint mt-3 flex items-center justify-between border-t pt-2 font-mono text-[11px]">
              <span>{item.offline ? 'offline' : 'network'}</span>
              <span className="group-hover:text-accent flex items-center gap-1 transition-colors">
                Open →
              </span>
            </div>
          </a>
        ))}
      </div>

      {/* ── Footer CTA: Full Suite Index ───────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="text-muted font-mono text-xs">
          Need the whole toolkit? The full index includes detailed roadmaps, network safety audits,
          and upcoming tools.
        </p>

        <a
          href={indexHref}
          className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
        >
          <span>Explore All 11 Tools</span>
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
