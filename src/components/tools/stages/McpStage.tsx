import React, { useState } from 'react';
import { CopyButton } from '../ui';
import OpenTool from './OpenTool';

/**
 * MCP Tester on the showcase screen: one sample run, drawn the way the tool
 * reports it. The checks on the left use the tool's own labels (see `emit`
 * calls in `lib/mcp.ts`) and the exchange on the right is what was sent and
 * received for the selected check, in the 2026-07-28 shape the client speaks
 * first (`server/discover`, `_meta` on every request, `ttlMs`/`cacheScope` on
 * list results). It is a sample, labelled as one; the full tool runs it live
 * against any Streamable HTTP endpoint.
 */

type Status = 'pass' | 'warn';

interface Check {
  label: string;
  status: Status;
  detail: string;
  ms: number;
  request: string;
  response: string;
}

const ENDPOINT = 'https://docs.example.dev/mcp';

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const DISCOVER_REQ = json({
  jsonrpc: '2.0',
  id: 1,
  method: 'server/discover',
  params: {
    _meta: { protocolVersion: '2026-07-28', clientInfo: { name: 'mcp-tester', version: '1.0' } },
  },
});
const DISCOVER_RES = json({
  jsonrpc: '2.0',
  id: 1,
  result: {
    serverInfo: { name: 'docs-search', version: '0.4.2' },
    protocolVersions: ['2026-07-28'],
    capabilities: { tools: {}, resources: {} },
  },
});
const LIST_REQ = json({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: { _meta: { protocolVersion: '2026-07-28' } },
});
const LIST_RES = json({
  jsonrpc: '2.0',
  id: 2,
  result: {
    tools: [
      {
        name: 'search_docs',
        description: 'Full-text search over the documentation.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      { name: 'get_page', description: 'Fetch one page by path.', inputSchema: { type: 'object' } },
      { name: 'list_sections', description: 'Table of contents.', inputSchema: { type: 'object' } },
    ],
  },
});

const CHECKS: readonly Check[] = [
  {
    label: 'Reachability',
    status: 'pass',
    detail: 'HTTP 200 over Streamable HTTP',
    ms: 38,
    request: `POST ${ENDPOINT}\nContent-Type: application/json\nAccept: application/json, text/event-stream\nMcp-Method: server/discover`,
    response: 'HTTP/2 200\ncontent-type: application/json',
  },
  {
    label: 'Browser access (CORS)',
    status: 'pass',
    detail: 'Allows this origin, exposes Mcp-* headers',
    ms: 21,
    request: `OPTIONS ${ENDPOINT}\nOrigin: https://coronring.github.io\nAccess-Control-Request-Method: POST\nAccess-Control-Request-Headers: content-type, mcp-method`,
    response:
      'HTTP/2 204\naccess-control-allow-origin: https://coronring.github.io\naccess-control-allow-headers: content-type, mcp-method, mcp-name\naccess-control-expose-headers: mcp-protocol-version',
  },
  {
    label: 'Protocol version',
    status: 'pass',
    detail: '2026-07-28, the current revision',
    ms: 41,
    request: DISCOVER_REQ,
    response: DISCOVER_RES,
  },
  {
    label: 'Handshake',
    status: 'pass',
    detail: 'server/discover → docs-search 0.4.2',
    ms: 41,
    request: DISCOVER_REQ,
    response: DISCOVER_RES,
  },
  {
    label: 'tools/list',
    status: 'pass',
    detail: '3 tools, all with a usable schema',
    ms: 47,
    request: LIST_REQ,
    response: LIST_RES,
  },
  {
    label: 'Cacheable result',
    status: 'warn',
    detail: 'tools/list omits ttlMs and cacheScope',
    ms: 47,
    request: LIST_REQ,
    response: LIST_RES,
  },
  {
    label: 'Latency',
    status: 'pass',
    detail: '5 calls · median 44 ms · max 61 ms',
    ms: 44,
    request: LIST_REQ,
    response: json({ calls: 5, median_ms: 44, min_ms: 39, max_ms: 61 }),
  },
];

const STATUS: Record<Status, { icon: string; label: string; className: string }> = {
  pass: { icon: '✓', label: 'pass', className: 'text-ok' },
  warn: { icon: '!', label: 'warn', className: 'text-warn' },
};

interface Props {
  href: string;
}

export default function McpStage({ href }: Props): React.ReactElement {
  const [selected, setSelected] = useState(2);
  const [side, setSide] = useState<'request' | 'response'>('response');
  const check = CHECKS[selected] ?? CHECKS[0]!;
  const body = check[side];
  const passed = CHECKS.filter((c) => c.status === 'pass').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── Endpoint ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-line bg-sunken text-fg flex min-w-0 flex-1 items-center gap-2 border px-3 py-1.5 font-mono text-xs">
          <span className="text-faint">POST</span>
          <span className="truncate">{ENDPOINT}</span>
        </div>
        <span className="border-line text-muted border px-2 py-1.5 font-mono text-[10px] tracking-wider uppercase">
          Streamable HTTP
        </span>
        <span className="text-faint font-mono text-[10px] tracking-wider uppercase">
          Sample run
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ── Checks ────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow text-[10px]">Checks</p>
            <span className="text-faint font-mono text-[10px] tabular-nums">
              {passed} pass · {CHECKS.length - passed} warn
            </span>
          </div>
          <ul
            className="divide-line border-line mt-2 divide-y border-y"
            role="listbox"
            aria-label="Checks"
          >
            {CHECKS.map((c, i) => {
              const s = STATUS[c.status];
              const on = i === selected;
              return (
                <li key={c.label} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    className={`relative grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                      on ? 'bg-raised' : 'hover:bg-raised/50'
                    }`}
                  >
                    {on && (
                      <span
                        className="bg-accent-fill absolute inset-y-0 left-0 w-[3px]"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`font-mono text-xs font-bold ${s.className}`}
                      aria-label={s.label}
                    >
                      {s.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="text-fg block font-mono text-xs">{c.label}</span>
                      <span className="text-faint block truncate text-[11px]">{c.detail}</span>
                    </span>
                    <span className="text-faint font-mono text-[10px] tabular-nums">{c.ms} ms</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Exchange ──────────────────────────────────────────────── */}
        <div className="border-line flex min-h-0 min-w-0 flex-col border">
          <div className="border-line bg-raised/40 flex items-center justify-between gap-2 border-b px-2 py-1.5">
            <div className="flex gap-1">
              {(['request', 'response'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSide(k)}
                  aria-pressed={side === k}
                  className={`rounded-sm px-2.5 py-1 font-mono text-[11px] capitalize transition-colors ${
                    side === k ? 'bg-fg text-ground' : 'text-muted hover:text-fg'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <CopyButton text={body} />
          </div>
          <pre className="text-fg min-h-0 flex-1 overflow-auto bg-[var(--c-ground)]/40 p-3 font-mono text-[11.5px] leading-relaxed">
            <code>{body}</code>
          </pre>
        </div>
      </div>

      <OpenTool href={href} label="Open MCP Tester" more="Point it at your own server" />
    </div>
  );
}
