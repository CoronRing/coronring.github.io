import React, { useState } from 'react';

interface FrameTab {
  id: string;
  name: string;
  method: string;
  latency: string;
  payload: string;
}

const FRAMES: FrameTab[] = [
  {
    id: 'init',
    name: '01 · Handshake',
    method: 'initialize',
    latency: '8ms',
    payload: JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
          },
          clientInfo: {
            name: 'CoronRing-Agent',
            version: '1.2.0',
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'list',
    name: '02 · Tool Discovery',
    method: 'tools/list',
    latency: '12ms',
    payload: JSON.stringify(
      {
        tools: [
          {
            name: 'query_vector_store',
            description: 'Semantic vector similarity search across indexed documentation.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                top_k: { type: 'integer', default: 5 },
              },
              required: ['query'],
            },
          },
          {
            name: 'execute_py_sandbox',
            description: 'Run Python snippet in isolated WebAssembly container.',
            inputSchema: {
              type: 'object',
              properties: { code: { type: 'string' } },
              required: ['code'],
            },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'call',
    name: '03 · Tool Execution',
    method: 'tools/call',
    latency: '19ms',
    payload: JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 42,
        result: {
          content: [
            {
              type: 'text',
              text: 'Found 3 chunks in knowledge store. Match confidence: 0.942.',
            },
          ],
          isError: false,
        },
      },
      null,
      2,
    ),
  },
];

interface Props {
  href: string;
}

export default function McpStage({ href }: Props): React.ReactElement {
  const [activeFrame, setActiveFrame] = useState(0);
  const frame = FRAMES[activeFrame] ?? FRAMES[0]!;

  return (
    <div className="space-y-6">
      {/* ── Visual Protocol Architecture & Connection Flow ────────────── */}
      <div className="border-line bg-surface/60 rounded-sm border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow text-[11px]">Model Context Protocol Bridge</p>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--c-ok)]" />
            <span className="text-fg font-medium">stdio://local-daemon</span>
            <span className="text-faint">· 14ms latency</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 text-center font-mono text-xs sm:grid-cols-3">
          <div className="border-line bg-surface/90 flex flex-col items-center justify-center rounded-sm border p-2.5">
            <span className="text-faint text-[10px] uppercase">Client Runtime</span>
            <span className="text-fg mt-0.5 font-semibold">Claude / Cursor IDE</span>
            <span className="text-accent mt-1 text-[10px]">JSON-RPC 2.0 Client</span>
          </div>

          <div className="border-line bg-raised/50 flex flex-col items-center justify-center rounded-sm border border-dashed p-2.5">
            <span className="text-faint text-[10px] uppercase">Transport Layer</span>
            <span className="text-fg mt-0.5 font-semibold">stdio / SSE Bridge</span>
            <span className="mt-1 text-[10px] text-[var(--c-ok)]">Zero Overhead</span>
          </div>

          <div className="border-line bg-surface/90 flex flex-col items-center justify-center rounded-sm border p-2.5">
            <span className="text-faint text-[10px] uppercase">MCP Server</span>
            <span className="text-fg mt-0.5 font-semibold">Local Tool Daemon</span>
            <span className="text-accent mt-1 text-[10px]">7 Tools · 3 Resources</span>
          </div>
        </div>
      </div>

      {/* ── Active Server Capabilities Badges ──────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <div className="border-line bg-surface flex items-center gap-2 rounded-sm border px-3 py-1 font-mono text-xs">
          <span className="text-accent">●</span>
          <span className="text-muted">Tools:</span>
          <span className="text-fg font-semibold">7 active schemas</span>
        </div>
        <div className="border-line bg-surface flex items-center gap-2 rounded-sm border px-3 py-1 font-mono text-xs">
          <span className="text-[var(--c-ok)]">●</span>
          <span className="text-muted">Resources:</span>
          <span className="text-fg font-semibold">3 mounted</span>
        </div>
        <div className="border-line bg-surface flex items-center gap-2 rounded-sm border px-3 py-1 font-mono text-xs">
          <span className="text-muted">●</span>
          <span className="text-muted">Protocol:</span>
          <span className="text-fg font-semibold">2024-11-05</span>
        </div>
        <div className="border-line bg-surface flex items-center gap-2 rounded-sm border px-3 py-1 font-mono text-xs">
          <span className="text-[var(--c-ok)]">✓</span>
          <span className="text-muted">Schema Validation:</span>
          <span className="text-fg font-semibold">Strict Draft-07</span>
        </div>
      </div>

      {/* ── Interactive JSON-RPC Frame Inspector ────────────────────────── */}
      <div className="border-line bg-surface/80 overflow-hidden rounded-sm border">
        <div className="border-line bg-raised/40 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-1.5">
            {FRAMES.map((f, idx) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFrame(idx)}
                className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                  idx === activeFrame
                    ? 'bg-accent-fill text-accent-on-fill font-medium'
                    : 'bg-surface text-muted hover:text-fg'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="text-faint">
              method: <span className="text-accent font-semibold">{frame.method}</span>
            </span>
            <span className="text-faint">
              rtt: <span className="text-[var(--c-ok)]">{frame.latency}</span>
            </span>
          </div>
        </div>

        <div className="max-h-[14rem] overflow-x-auto bg-[var(--c-ground)]/40 p-4">
          <pre className="text-fg font-mono text-xs leading-relaxed">
            <code>{frame.payload}</code>
          </pre>
        </div>
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────────────── */}
      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="text-muted font-mono text-xs">
          Validate endpoints, test tool schemas, and benchmark tool-call latency directly in your
          browser.
        </p>

        <a
          href={href}
          className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
        >
          <span>Launch MCP Tester</span>
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
