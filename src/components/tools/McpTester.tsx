import { useCallback, useMemo, useState } from 'react';
import {
  callTool,
  curlForUrl,
  probe,
  PROTOCOL_VERSIONS,
  toCurl,
  type Check,
  type CheckStatus,
  type Connection,
  type Exchange,
  type ProbeReport,
  type ProtocolVersion,
  type ToolCallResult,
  type ToolSummary,
} from '../../lib/mcp';
import {
  Badge,
  Button,
  CopyButton,
  ErrorNote,
  num,
  Panel,
  PasteButton,
  Segmented,
  StatRow,
  type Tone,
} from './ui';

/**
 * McpTester — point it at an MCP endpoint and find out what is actually there.
 *
 * The protocol work is in `src/lib/mcp.ts`. This file runs the probe, streams
 * checks in as they land, and gives every check an expandable view of the exact
 * HTTP exchange behind it — because "tools/list failed" is not a bug report and
 * the request that produced it is.
 *
 * Requests go straight from this tab to the server named in the form. That has
 * one consequence worth stating plainly in the UI rather than burying: a server
 * without CORS headers cannot be reached from a browser at all, and no amount
 * of retrying will change it. When that happens the tool hands over a `curl`.
 */

const STATUS_TONE: Record<CheckStatus, Tone> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'alert',
  skip: 'idle',
};

const STATUS_MARK: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '×',
  skip: '–',
};

/** Public endpoints worth pointing at, for anyone who does not have one to hand. */
const EXAMPLES: ReadonlyArray<{ label: string; url: string }> = [
  { label: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' },
  { label: 'Local dev', url: 'http://localhost:3000/mcp' },
];

export default function McpTester(): React.ReactElement {
  const [url, setUrl] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [extraHeaders, setExtraHeaders] = useState<string>('');
  const [timeoutMs, setTimeoutMs] = useState<number>(15_000);
  const [samples, setSamples] = useState<number>(5);
  const [version, setVersion] = useState<'auto' | ProtocolVersion>('auto');
  const [advanced, setAdvanced] = useState<boolean>(false);

  const [running, setRunning] = useState<boolean>(false);
  const [live, setLive] = useState<readonly Check[]>([]);
  const [report, setReport] = useState<ProbeReport | null>(null);

  /**
   * Headers built from the form.
   *
   * Every custom header widens the CORS preflight, so only what was actually
   * filled in is sent — an empty `Authorization` would fail servers that
   * validate it strictly.
   */
  const headers = useMemo(() => {
    const built: Record<string, string> = {};
    if (token.trim()) {
      built.authorization = /^(bearer|basic) /i.test(token.trim())
        ? token.trim()
        : `Bearer ${token.trim()}`;
    }
    for (const line of extraHeaders.split('\n')) {
      const at = line.indexOf(':');
      if (at <= 0) continue;
      const key = line.slice(0, at).trim().toLowerCase();
      const value = line.slice(at + 1).trim();
      if (key && value) built[key] = value;
    }
    return built;
  }, [token, extraHeaders]);

  const run = useCallback(async () => {
    if (!url.trim() || running) return;
    setRunning(true);
    setLive([]);
    setReport(null);

    const result = await probe({
      url,
      headers,
      timeoutMs,
      latencySamples: samples,
      forceVersion: version === 'auto' ? undefined : version,
      onCheck: (check) => setLive((prev) => [...prev, check]),
    });

    setReport(result);
    setRunning(false);
  }, [url, headers, timeoutMs, samples, version, running]);

  const checks = report?.checks ?? live;
  const counts = useMemo(() => {
    const tally: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const check of checks) tally[check.status]++;
    return tally;
  }, [checks]);

  return (
    <div className="space-y-6">
      {/* ── Connection ────────────────────────────────────────────────── */}
      <Panel
        title="Endpoint"
        cornerTicks
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <PasteButton onPaste={setUrl} label="Paste URL" />
            <div className="flex items-center gap-1 border-l border-[var(--c-line)] pl-2">
              {EXAMPLES.map((example) => (
                <Button key={example.label} variant="quiet" onClick={() => setUrl(example.url)}>
                  {example.label}
                </Button>
              ))}
            </div>
            <Button variant="quiet" onClick={() => setAdvanced((a) => !a)}>
              {advanced ? 'Hide options' : 'Options'}
            </Button>
          </div>
        }
      >
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              aria-label="MCP endpoint URL"
              className="min-w-[18rem] flex-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-2 font-mono text-[13px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none"
            />
            <Button type="submit" variant="primary" disabled={running || url.trim() === ''}>
              {running ? 'Probing…' : 'Run probe'}
            </Button>
          </div>

          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Bearer token, optional. Never stored or sent anywhere but this endpoint."
            aria-label="Authorization token"
            autoComplete="off"
            className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-1.5 font-mono text-xs text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none"
          />

          {advanced && (
            <div className="grid gap-3 border-t border-[var(--c-line)] pt-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow mb-1.5 block">Extra headers (one per line)</span>
                <textarea
                  value={extraHeaders}
                  onChange={(e) => setExtraHeaders(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={'x-api-key: …\nx-tenant: acme'}
                  className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none"
                />
              </label>

              <div className="space-y-3">
                <div>
                  <span className="eyebrow mb-1.5 block">Protocol version</span>
                  <Segmented
                    label="Protocol version"
                    value={version}
                    options={[
                      { value: 'auto' as const, label: 'Auto' },
                      ...PROTOCOL_VERSIONS.map((v) => ({ value: v, label: v.slice(2) })),
                    ]}
                    onChange={setVersion}
                  />
                </div>
                <div className="flex gap-4">
                  <label className="block">
                    <span className="eyebrow mb-1.5 block">Timeout (ms)</span>
                    <input
                      type="number"
                      min={1000}
                      max={120000}
                      step={1000}
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(Number(e.target.value))}
                      className="tabular w-24 rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1 font-mono text-xs text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow mb-1.5 block">Latency samples</span>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={samples}
                      onChange={(e) => setSamples(Number(e.target.value))}
                      className="tabular w-20 rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-1 font-mono text-xs text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </form>
      </Panel>

      {/* ── Transport failure ─────────────────────────────────────────── */}
      {report?.fatal && (
        <div className="space-y-3">
          <ErrorNote>
            {report.fatal.kind === 'timeout'
              ? `No response within ${num(timeoutMs)} ms. The endpoint accepted the connection but never answered. Raise the timeout, or check whether the server is stuck behind a cold start.`
              : report.fatal.kind === 'cors'
                ? 'The browser blocked the request before any response was readable. The most likely cause is CORS: an MCP endpoint reachable from a browser must answer the preflight with Access-Control-Allow-Origin, and must allow the content-type, mcp-protocol-version, mcp-method and mcp-name request headers. A wrong hostname, a dead port, or a self-signed certificate produce the same opaque failure. The browser does not tell scripts which of the four it was.'
                : report.fatal.message}
          </ErrorNote>
          <Panel
            title="Reproduce outside the browser"
            aside={<CopyButton text={curlForUrl(url, headers)} label="Copy curl" />}
          >
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--c-text-muted)]">
              {curlForUrl(url, headers)}
            </pre>
          </Panel>
        </div>
      )}

      {/* ── Server identity ───────────────────────────────────────────── */}
      {report?.connection && <ServerCard connection={report.connection} report={report} />}

      {/* ── Checks ────────────────────────────────────────────────────── */}
      {checks.length > 0 && (
        <Panel
          title="Checks"
          aside={
            <div className="flex items-center gap-1.5">
              {running && <Badge tone="busy">running</Badge>}
              {counts.pass > 0 && <Badge tone="ok">{counts.pass} pass</Badge>}
              {counts.warn > 0 && <Badge tone="warn">{counts.warn} warn</Badge>}
              {counts.fail > 0 && <Badge tone="alert">{counts.fail} fail</Badge>}
            </div>
          }
        >
          <ul className="divide-y divide-[var(--c-line)]">
            {checks.map((check, i) => (
              <CheckRow key={`${check.id}-${i}`} check={check} />
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Tools ─────────────────────────────────────────────────────── */}
      {report?.connection && hasTools(report.tools) && (
        <ToolInspector connection={report.connection} tools={report.tools} />
      )}

      {checks.length === 0 && !running && (
        <p className="text-xs leading-relaxed text-[var(--c-text-faint)]">
          The probe negotiates a protocol era, identifies the server, lists its tools, resources and
          prompts, validates every tool schema, checks that unknown methods are rejected properly,
          and samples round-trip latency. Nothing is written to the server beyond the tool calls you
          make yourself.
        </p>
      )}
    </div>
  );
}

/** Narrow a tool list to a non-empty tuple, so the inspector needs no fallbacks. */
function hasTools(
  tools: readonly ToolSummary[],
): tools is readonly [ToolSummary, ...ToolSummary[]] {
  return tools.length > 0;
}

/* ── Server card ──────────────────────────────────────────────────────── */

function ServerCard({
  connection,
  report,
}: {
  connection: Connection;
  report: ProbeReport;
}): React.ReactElement {
  const capabilities = Object.keys(connection.capabilities ?? {});

  const stats = [
    {
      label: 'server',
      value: connection.serverInfo?.name ?? 'unnamed',
      hint: connection.serverInfo?.version,
    },
    {
      label: 'protocol',
      value: connection.version,
      hint: connection.era === 'modern' ? 'stateless era' : 'initialize era',
      tone: 'accent' as const,
    },
    { label: 'tools', value: num(report.tools.length) },
    { label: 'resources', value: num(report.resourceCount) },
    { label: 'prompts', value: num(report.promptCount) },
    ...(report.timing
      ? [
          {
            label: 'median latency',
            value: `${num(report.timing.median)} ms`,
            hint: `${num(report.timing.min)}–${num(report.timing.max)} ms`,
            tone:
              report.timing.median < 400
                ? ('ok' as const)
                : report.timing.median < 1500
                  ? ('warn' as const)
                  : ('alert' as const),
          },
        ]
      : []),
  ];

  return (
    <Panel
      title="Server"
      aside={
        capabilities.length > 0 ? (
          <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
            {capabilities.join(' · ')}
          </span>
        ) : undefined
      }
    >
      <StatRow stats={stats} columns={6} />
      {connection.instructions && (
        <p className="border-t border-[var(--c-line)] px-4 py-3 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--c-text-muted)]">
          {connection.instructions.length > 600
            ? `${connection.instructions.slice(0, 600)}…`
            : connection.instructions}
        </p>
      )}
    </Panel>
  );
}

/* ── Check row ────────────────────────────────────────────────────────── */

function CheckRow({ check }: { check: Check }): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border font-mono text-[10px] leading-none"
          style={{
            color: `var(--c-${check.status === 'pass' ? 'ok' : check.status === 'warn' ? 'warn' : check.status === 'fail' ? 'alert' : 'text-faint'})`,
            borderColor: 'currentColor',
          }}
        >
          {STATUS_MARK[check.status]}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="font-mono text-[12.5px]">{check.label}</span>
            {check.latencyMs !== undefined && (
              <span className="tabular font-mono text-[10px] text-[var(--c-text-faint)]">
                {num(check.latencyMs)} ms
              </span>
            )}
            <Badge tone={STATUS_TONE[check.status]}>{check.status}</Badge>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text-muted)]">
            {check.detail}
          </p>
        </div>

        {check.exchange && (
          <Button variant="quiet" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Inspect'}
          </Button>
        )}
      </div>

      {open && check.exchange && <ExchangeView exchange={check.exchange} />}
    </li>
  );
}

/** The raw HTTP exchange — what a bug report needs and a summary cannot carry. */
function ExchangeView({ exchange }: { exchange: Exchange }): React.ReactElement {
  return (
    <div className="grid gap-px bg-[var(--c-line)] md:grid-cols-2">
      <div className="bg-[var(--c-sunken)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Request</span>
          <CopyButton
            text={toCurl(exchange.url, exchange.requestHeaders, exchange.requestBody)}
            label="curl"
          />
        </div>
        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed text-[var(--c-text-muted)]">
          {`POST ${exchange.url}\n`}
          {Object.entries(exchange.requestHeaders)
            .map(([k, v]) => `${k}: ${k === 'authorization' ? '<redacted>' : v}`)
            .join('\n')}
          {`\n\n${JSON.stringify(exchange.requestBody, null, 2)}`}
        </pre>
      </div>

      <div className="bg-[var(--c-sunken)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="eyebrow">Response</span>
          <span
            className="tabular font-mono text-[10px]"
            style={{ color: exchange.status < 400 ? 'var(--c-ok)' : 'var(--c-alert)' }}
          >
            {exchange.status} {exchange.statusText}
          </span>
          {exchange.streamed && <Badge>sse</Badge>}
        </div>
        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed text-[var(--c-text-muted)]">
          {Object.entries(exchange.responseHeaders)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}
          {'\n\n'}
          {exchange.body
            ? JSON.stringify(exchange.body, null, 2)
            : (exchange.raw ?? '(no body)').slice(0, 4000)}
        </pre>
      </div>
    </div>
  );
}

/* ── Tool inspector ───────────────────────────────────────────────────── */

/**
 * Seed arguments from a tool's JSON Schema.
 *
 * A blank textarea in front of a 12-property schema is a wall; a filled-in
 * skeleton with the right keys and plausible types is a starting point. Only
 * required properties are seeded — sending every optional field is rarely what
 * a first call should do.
 */
function seedArguments(tool: ToolSummary): string {
  const properties = (tool.inputSchema?.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const seed: Record<string, unknown> = {};

  for (const key of tool.required) {
    const definition = properties[key] ?? {};
    if (Array.isArray(definition.enum) && definition.enum.length > 0) {
      seed[key] = definition.enum[0];
      continue;
    }
    seed[key] =
      definition.type === 'number' || definition.type === 'integer'
        ? 0
        : definition.type === 'boolean'
          ? false
          : definition.type === 'array'
            ? []
            : definition.type === 'object'
              ? {}
              : '';
  }

  return JSON.stringify(seed, null, 2);
}

function ToolInspector({
  connection,
  tools,
}: {
  connection: Connection;
  /** Never empty — the caller renders nothing when the server has no tools. */
  tools: readonly [ToolSummary, ...ToolSummary[]];
}): React.ReactElement {
  const [active, setActive] = useState<string>(tools[0].name);
  const tool = tools.find((t) => t.name === active) ?? tools[0];

  const [args, setArgs] = useState<string>(() => seedArguments(tools[0]));
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [calling, setCalling] = useState<boolean>(false);
  const [argError, setArgError] = useState<string>('');

  const select = (name: string): void => {
    const next = tools.find((t) => t.name === name);
    if (!next) return;
    setActive(name);
    setArgs(seedArguments(next));
    setResult(null);
    setArgError('');
  };

  const invoke = async (): Promise<void> => {
    let parsed: Record<string, unknown>;
    try {
      parsed = args.trim() === '' ? {} : (JSON.parse(args) as Record<string, unknown>);
    } catch (error) {
      setArgError(error instanceof Error ? error.message : 'Arguments are not valid JSON.');
      return;
    }

    setArgError('');
    setCalling(true);
    try {
      setResult(await callTool(connection, tool.name, parsed));
    } catch (error) {
      setArgError(error instanceof Error ? error.message : String(error));
    } finally {
      setCalling(false);
    }
  };

  return (
    <Panel
      title={`Tools · ${tools.length}`}
      aside={
        <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
          calls run against the live server
        </span>
      }
    >
      <div className="grid md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {/* List */}
        <ul className="max-h-[26rem] divide-y divide-[var(--c-line)] overflow-y-auto border-b border-[var(--c-line)] md:border-r md:border-b-0">
          {tools.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                onClick={() => select(entry.name)}
                aria-pressed={entry.name === active}
                className={`w-full px-3 py-2 text-left transition-colors hover:bg-[var(--c-raised)] ${
                  entry.name === active ? 'bg-[var(--c-accent-soft)]' : ''
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[12px]">{entry.name}</span>
                  {entry.issues.length > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-[var(--c-warn)]">
                      {entry.issues.length}!
                    </span>
                  )}
                </span>
                {entry.description && (
                  <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-[var(--c-text-faint)]">
                    {entry.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Detail */}
        <div className="min-w-0 space-y-3 p-4">
          <div>
            <h3 className="font-mono text-sm">{tool.title ?? tool.name}</h3>
            {tool.description && (
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text-muted)]">
                {tool.description}
              </p>
            )}
          </div>

          {tool.issues.length > 0 && (
            <ul className="space-y-1 rounded-sm border border-[var(--c-warn)] bg-[color-mix(in_srgb,var(--c-warn)_10%,transparent)] px-3 py-2">
              {tool.issues.map((issue) => (
                <li key={issue} className="font-mono text-[11px] text-[var(--c-warn)]">
                  · {issue}
                </li>
              ))}
            </ul>
          )}

          <details className="rounded-sm border border-[var(--c-line)]">
            <summary className="cursor-pointer px-3 py-1.5 font-mono text-[11px] text-[var(--c-text-muted)]">
              inputSchema
            </summary>
            <pre className="overflow-x-auto border-t border-[var(--c-line)] bg-[var(--c-sunken)] p-3 font-mono text-[10.5px] leading-relaxed text-[var(--c-text-muted)]">
              {JSON.stringify(tool.inputSchema ?? {}, null, 2)}
            </pre>
          </details>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Arguments (JSON)</span>
              <Button onClick={() => void invoke()} disabled={calling} variant="primary">
                {calling ? 'Calling…' : 'Call tool'}
              </Button>
            </div>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full resize-y rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
            />
          </div>

          {argError && <ErrorNote>{argError}</ErrorNote>}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={result.ok ? 'ok' : 'alert'}>
                  {result.ok ? 'ok' : result.needsInput ? 'input required' : 'error'}
                </Badge>
                <span className="tabular font-mono text-[10px] text-[var(--c-text-faint)]">
                  {num(result.exchange.latencyMs)} ms · HTTP {result.exchange.status}
                  {result.exchange.streamed && ' · sse'}
                </span>
              </div>
              <pre className="max-h-72 overflow-auto rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {result.error
                  ? `${result.error.code}: ${result.error.message}`
                  : result.text ||
                    JSON.stringify(
                      result.structured ?? result.exchange.body?.result ?? {},
                      null,
                      2,
                    )}
              </pre>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
