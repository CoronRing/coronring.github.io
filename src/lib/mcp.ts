/**
 * A browser MCP client, and the probe suite the MCP Tester runs with it.
 *
 * ## Which protocol this speaks
 *
 * MCP changed shape in revision `2026-07-28`. The `initialize` handshake, the
 * `Mcp-Session-Id` header, the standalone GET stream, and `ping` were all
 * removed; every request now carries its own protocol version, client identity
 * and capabilities in `params._meta`, and mirrors some of that into HTTP
 * headers. Servers advertise themselves through `server/discover` instead of an
 * initialization result.
 *
 * A tester that only spoke one era would be useless against half the servers in
 * the wild, so this speaks both:
 *
 *  1. Try modern (`server/discover` with per-request metadata).
 *  2. On `400`/`404`/`405`, read the body. A *recognised modern* JSON-RPC error
 *     means the server is modern and something else is wrong — in particular
 *     `UnsupportedProtocolVersionError` names the versions it does support, so
 *     the probe retries with one of those rather than falling back.
 *  3. Otherwise fall back to the legacy `initialize` handshake and carry any
 *     `Mcp-Session-Id` on subsequent requests.
 *
 * That ladder is the one the specification prescribes for clients supporting
 * both eras.
 *
 * ## Why this runs in the browser and not through a proxy
 *
 * A hosted proxy would dodge CORS, and would also be an open server-side
 * request forwarder pointed at any URL a stranger types — including `10.0.0.x`
 * and cloud metadata endpoints. That is a classic SSRF pivot and not worth
 * shipping for a convenience. Requests therefore go straight from the tab to
 * the server named in the form, with the visitor's own network position and
 * nothing else. Where CORS blocks that, the tool says so precisely and hands
 * over a `curl` command, which is the honest outcome.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 */

/** Protocol revisions this client can speak, newest first. */
export const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'] as const;

export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

/** The revision that removed `initialize` and protocol-level sessions. */
export const MODERN_FROM: ProtocolVersion = '2026-07-28';

const CLIENT_INFO = { name: 'coronring-mcp-tester', version: '1.0.0' } as const;

/** MCP-defined JSON-RPC error codes worth naming in the report. */
const ERROR_NAMES: Record<number, string> = {
  [-32700]: 'Parse error',
  [-32600]: 'Invalid request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid params',
  [-32603]: 'Internal error',
  [-32020]: 'HeaderMismatch',
  [-32021]: 'MissingRequiredClientCapability',
  [-32022]: 'UnsupportedProtocolVersion',
};

/* ── Wire types ───────────────────────────────────────────────────────── */

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
}

/** One HTTP exchange, kept for the request/response inspector. */
export interface Exchange {
  readonly method: string;
  readonly url: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  /** Response headers the browser allowed us to read. */
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly body: JsonRpcResponse | null;
  /** Raw text, when the body was not JSON-RPC. */
  readonly raw?: string;
  readonly latencyMs: number;
  /** Whether the reply arrived as SSE rather than a single JSON object. */
  readonly streamed: boolean;
}

/** Thrown when the request never produced an HTTP response at all. */
export class TransportError extends Error {
  constructor(
    message: string,
    /** Best guess at the cause, used to pick the explanation shown. */
    readonly kind: 'cors' | 'network' | 'timeout' | 'protocol',
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface ConnectionOptions {
  readonly url: string;
  /** Extra headers, typically `Authorization`. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Force an era instead of probing for it. */
  readonly forceVersion?: ProtocolVersion;
}

/** What the probe worked out about the server it is talking to. */
export interface Connection {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly version: ProtocolVersion;
  readonly era: 'modern' | 'legacy';
  /** Legacy servers only — mirrored back on every subsequent request. */
  sessionId?: string;
  serverInfo?: { name?: string; version?: string; title?: string };
  capabilities?: Record<string, unknown>;
  instructions?: string;
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

/** Is this revision one of the ones that still used `initialize`? */
function isLegacy(version: ProtocolVersion): boolean {
  return version < MODERN_FROM;
}

/**
 * Build the headers for one JSON-RPC POST.
 *
 * `Mcp-Method` and `Mcp-Name` are required from 2026-07-28 so that gateways can
 * route without parsing the body; a mismatch against the body is a `-32020`.
 * Both are omitted for legacy servers, which do not define them.
 */
function buildHeaders(
  connection: Pick<Connection, 'headers' | 'version' | 'sessionId' | 'era'>,
  method: string,
  name?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': connection.version,
    ...connection.headers,
  };

  if (!isLegacy(connection.version)) {
    headers['mcp-method'] = method;
    if (name !== undefined) headers['mcp-name'] = encodeHeaderValue(name);
  }
  if (connection.sessionId) headers['mcp-session-id'] = connection.sessionId;

  return headers;
}

/**
 * Encode a header value per the spec's Base64 sentinel rule.
 *
 * Header values must be printable ASCII. A tool name with a non-ASCII character
 * — or one that happens to look like the sentinel — is carried as
 * `=?base64?…?=` rather than mangled or dropped.
 */
export function encodeHeaderValue(value: string): string {
  const safe = /^[\x20-\x7E]*$/.test(value) && value.trim() === value;
  const sentinel = value.startsWith('=?base64?') && value.endsWith('?=');
  if (safe && !sentinel) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `=?base64?${btoa(binary)}?=`;
}

/** Params `_meta` block required from 2026-07-28. */
function metaFor(version: ProtocolVersion): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

let nextId = 1;

/**
 * Send one JSON-RPC request and return the exchange.
 *
 * Handles both reply shapes: a single JSON object, or an SSE stream carrying
 * notifications ahead of the response. The stream is read only until the
 * matching response arrives, then cancelled — which is also how cancellation is
 * signalled in this revision.
 *
 * @throws {TransportError} If no HTTP response was produced.
 */
export async function rpc(
  connection: Pick<Connection, 'url' | 'headers' | 'version' | 'sessionId' | 'era' | 'timeoutMs'>,
  method: string,
  params?: Record<string, unknown>,
  nameForHeader?: string,
): Promise<Exchange> {
  const id = nextId++;
  const body: Record<string, unknown> = { jsonrpc: '2.0', id, method };

  const merged: Record<string, unknown> = { ...(params ?? {}) };
  if (!isLegacy(connection.version)) merged._meta = metaFor(connection.version);
  if (Object.keys(merged).length > 0) body.params = merged;

  const headers = buildHeaders(connection, method, nameForHeader);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), connection.timeoutMs);
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(connection.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      // No cookies: this is a cross-origin call to a server the visitor named,
      // and sending ambient credentials to it would be a poor default.
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
  } catch (error) {
    window.clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new TransportError(`No response within ${connection.timeoutMs} ms.`, 'timeout');
    }
    /*
     * `fetch` collapses CORS rejection, DNS failure and connection refusal into
     * one opaque TypeError — the browser deliberately withholds the difference
     * from script. Report it as the most likely of the three for a URL that
     * resolves, and let the UI explain both.
     */
    throw new TransportError(
      error instanceof Error ? error.message : 'Request failed before a response arrived.',
      'cors',
    );
  }
  window.clearTimeout(timer);

  const contentType = response.headers.get('content-type') ?? '';
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let parsed: JsonRpcResponse | null = null;
  let raw: string | undefined;
  let streamed = false;

  if (contentType.includes('text/event-stream') && response.body) {
    streamed = true;
    parsed = await readSseResponse(response.body, id, controller);
  } else if (response.status !== 202) {
    raw = await response.text();
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw) as JsonRpcResponse;
        raw = undefined;
      } catch {
        // Left as `raw` — an HTML error page from a proxy, most often.
      }
    }
  }

  return {
    method,
    url: connection.url,
    requestHeaders: headers,
    requestBody: body,
    status: response.status,
    statusText: response.statusText,
    contentType,
    responseHeaders,
    body: parsed,
    raw,
    latencyMs: Math.round(performance.now() - started),
    streamed,
  };
}

/**
 * Read an SSE reply until the response with `id` arrives.
 *
 * Server-sent notifications ahead of the response are skipped: this client does
 * not surface progress events, and the probe only needs the terminal result.
 */
async function readSseResponse(
  stream: ReadableStream<Uint8Array>,
  id: number,
  controller: AbortController,
): Promise<JsonRpcResponse | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; \r\n\r\n is equally legal.
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator) break;

        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        const payload = rawEvent
          .split(/\r?\n/)
          // A line starting with ':' is a keep-alive comment and carries no data.
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (payload.length === 0) continue;
        try {
          const message = JSON.parse(payload) as JsonRpcResponse;
          if (message.id === id) return message;
        } catch {
          // Ignore an unparseable event rather than failing the whole probe.
        }
      }
    }
  } finally {
    // Closing the stream is the transport-level cancellation signal.
    void reader.cancel().catch(() => undefined);
    controller.abort();
  }

  return null;
}

/**
 * Send a JSON-RPC notification — a message with no `id` and no reply.
 *
 * Only `notifications/initialized` needs this, and only against pre-2026
 * servers, but sending it as a *request* is a real conformance bug: a strict
 * server will answer with an error, and a lenient one will log one.
 */
async function notify(
  connection: Pick<Connection, 'url' | 'headers' | 'version' | 'sessionId' | 'era' | 'timeoutMs'>,
  method: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), connection.timeoutMs);
  try {
    await fetch(connection.url, {
      method: 'POST',
      headers: buildHeaders(connection, method),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: controller.signal,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
  } catch {
    // A refused notification does not invalidate the session; the probe goes on.
  } finally {
    window.clearTimeout(timer);
  }
}

/* ── Probe ────────────────────────────────────────────────────────────── */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

/** One line of the report. */
export interface Check {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  /** One sentence, written to be read without expanding the exchange. */
  readonly detail: string;
  readonly latencyMs?: number;
  readonly exchange?: Exchange;
}

export interface ToolSummary {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  /** Required top-level properties, for the call form. */
  readonly required: readonly string[];
  /** Conformance problems found in this tool's definition. */
  readonly issues: readonly string[];
}

export interface Timing {
  readonly samples: readonly number[];
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export interface ProbeReport {
  readonly checks: readonly Check[];
  readonly connection?: Connection;
  readonly tools: readonly ToolSummary[];
  readonly resourceCount: number;
  readonly promptCount: number;
  readonly timing?: Timing;
  /** Set when the run ended before it could finish. */
  readonly fatal?: { message: string; kind: TransportError['kind'] };
}

/**
 * Error codes that only a 2026-07-28-era server produces.
 *
 * Deliberately *not* the generic JSON-RPC codes: a pre-2026 server rejecting an
 * unknown protocol version answers `-32600 Invalid request`, and treating that
 * as proof of modernity would strand the client on an era the server does not
 * speak. Only these three prove the server is modern.
 */
const MODERN_ERROR_CODES = new Set([-32020, -32021, -32022]);

/** Recognised modern error → the server is modern, whatever the status code. */
function modernError(exchange: Exchange): JsonRpcError | undefined {
  const error = exchange.body?.error;
  return error && MODERN_ERROR_CODES.has(error.code) ? error : undefined;
}

function describeError(error: JsonRpcError): string {
  const name = ERROR_NAMES[error.code];
  return `${name ? `${name} ` : ''}(${error.code}): ${error.message}`;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export interface ProbeOptions extends ConnectionOptions {
  /** Repeat count for the latency sample. */
  readonly latencySamples?: number;
  /** Called as each check completes, so the UI can fill in live. */
  readonly onCheck?: (check: Check) => void;
}

/**
 * Run the full suite against `options.url`.
 *
 * Never throws: a transport failure ends the run and is reported as `fatal`,
 * because a tester that throws its own stack trace at the user has failed at
 * the one job it has.
 */
export async function probe(options: ProbeOptions): Promise<ProbeReport> {
  const checks: Check[] = [];
  const emit = (check: Check): void => {
    checks.push(check);
    options.onCheck?.(check);
  };

  const base = {
    url: options.url.trim(),
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? 15_000,
  };

  // ── 1. Endpoint shape ────────────────────────────────────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(base.url);
  } catch {
    emit({
      id: 'url',
      label: 'Endpoint URL',
      status: 'fail',
      detail: 'Not a valid absolute URL. It needs a scheme, e.g. https://example.com/mcp.',
    });
    return { checks, tools: [], resourceCount: 0, promptCount: 0 };
  }

  if (parsedUrl.protocol === 'http:' && window.location.protocol === 'https:') {
    emit({
      id: 'url',
      label: 'Endpoint URL',
      status: 'fail',
      detail:
        'This page is served over HTTPS, so the browser blocks plain-HTTP requests as mixed content. Use https://, or run this tool from a local HTTP page.',
    });
    return { checks, tools: [], resourceCount: 0, promptCount: 0 };
  }

  emit({
    id: 'url',
    label: 'Endpoint URL',
    status: 'pass',
    detail: `${parsedUrl.origin}${parsedUrl.pathname} over ${parsedUrl.protocol.replace(':', '')}.`,
  });

  // ── 2. Era detection ─────────────────────────────────────────────────
  let connection: Connection;
  try {
    connection = await negotiate(base, options.forceVersion, emit);
  } catch (error) {
    const transport =
      error instanceof TransportError ? error : new TransportError(String(error), 'network');
    emit({
      id: 'reach',
      label: 'Reachability',
      status: 'fail',
      detail: transport.message,
    });
    return {
      checks,
      tools: [],
      resourceCount: 0,
      promptCount: 0,
      fatal: { message: transport.message, kind: transport.kind },
    };
  }

  // ── 3. Listings ──────────────────────────────────────────────────────
  const tools = await listTools(connection, emit);
  const resourceCount = await listCount(connection, 'resources/list', 'resources', emit);
  const promptCount = await listCount(connection, 'prompts/list', 'prompts', emit);

  // ── 4. Conformance ───────────────────────────────────────────────────
  await checkUnknownMethod(connection, emit);

  // ── 5. Latency ───────────────────────────────────────────────────────
  const timing = await measure(connection, options.latencySamples ?? 5, emit);

  return { checks, connection, tools, resourceCount, promptCount, timing };
}

/**
 * Work out which era and version the server speaks, and identify it.
 *
 * @throws {TransportError} If no HTTP response can be obtained at all.
 */
async function negotiate(
  base: { url: string; headers: Readonly<Record<string, string>>; timeoutMs: number },
  forced: ProtocolVersion | undefined,
  emit: (check: Check) => void,
): Promise<Connection> {
  const attempt = (version: ProtocolVersion): Connection => ({
    ...base,
    version,
    era: isLegacy(version) ? 'legacy' : 'modern',
  });

  if (forced && isLegacy(forced)) return legacyHandshake(attempt(forced), emit);

  const modern = attempt(forced ?? MODERN_FROM);
  const discover = await rpc(modern, 'server/discover');

  emit({
    id: 'cors',
    label: 'Browser access (CORS)',
    status: 'pass',
    detail: `The server allowed a cross-origin POST from ${window.location.origin} and returned ${discover.status}.`,
    latencyMs: discover.latencyMs,
    exchange: discover,
  });

  const error = discover.body?.error;

  // A modern server that cannot speak our version names the ones it can.
  if (error?.code === -32022) {
    const supported = extractSupported(error);
    const usable = supported.find((v): v is ProtocolVersion =>
      (PROTOCOL_VERSIONS as readonly string[]).includes(v),
    );
    if (usable && isLegacy(usable)) {
      emit({
        id: 'version',
        label: 'Protocol version',
        status: 'warn',
        detail: `Server rejected ${modern.version} and advertises ${supported.join(', ')}. Falling back to the initialize handshake at ${usable}.`,
        exchange: discover,
      });
      return legacyHandshake(attempt(usable), emit);
    }
    if (usable) {
      emit({
        id: 'version',
        label: 'Protocol version',
        status: 'warn',
        detail: `Server rejected ${modern.version}; retrying at ${usable}.`,
        exchange: discover,
      });
      return finishModern(attempt(usable), emit);
    }
    emit({
      id: 'version',
      label: 'Protocol version',
      status: 'fail',
      detail: `Server supports only ${supported.join(', ') || 'unknown versions'}, none of which this client speaks.`,
      exchange: discover,
    });
    return modern;
  }

  if (discover.status < 400 && discover.body?.result) {
    return finishModern(modern, emit, discover);
  }

  // 400/404/405 with a *recognised* modern error still means a modern server.
  const recognised = modernError(discover);
  if (recognised) {
    emit({
      id: 'version',
      label: 'Protocol version',
      status: 'warn',
      detail: `Modern server, but server/discover returned ${describeError(recognised)}.`,
      exchange: discover,
    });
    return finishModern(modern, emit);
  }

  /*
   * Not modern. Many pre-2026 servers still name the versions they accept in a
   * generic `-32600`, so prefer the newest one both sides know over a blind
   * guess at 2025-11-25.
   */
  const advertised = discover.body?.error ? extractSupported(discover.body.error) : [];
  const usable =
    PROTOCOL_VERSIONS.filter((v) => isLegacy(v) && advertised.includes(v))[0] ?? '2025-11-25';

  emit({
    id: 'version',
    label: 'Protocol version',
    status: 'warn',
    detail: `No stateless handshake (HTTP ${discover.status}${
      discover.body?.error ? `, ${discover.body.error.message}` : ''
    }). Falling back to the pre-2026 initialize handshake at ${usable}.`,
    exchange: discover,
  });

  return legacyHandshake(attempt(usable), emit);
}

/**
 * Pull the version list out of a version-rejection error.
 *
 * `UnsupportedProtocolVersionError` carries `data.supported`, but plenty of
 * deployed servers only put the list in the message text — so the message is
 * scanned for date-shaped versions as a fallback. Guessing the era wrong costs
 * a whole run, and this recovers most of those cases for free.
 */
function extractSupported(error: JsonRpcError): string[] {
  const data = error.data as { supported?: unknown } | undefined;
  const supported = data?.supported;
  if (Array.isArray(supported)) {
    const listed = supported.filter((v): v is string => typeof v === 'string');
    if (listed.length > 0) return listed;
  }
  return error.message.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/** Record identity and capabilities from a modern `server/discover` result. */
function finishModern(
  connection: Connection,
  emit: (check: Check) => void,
  discover?: Exchange,
): Connection {
  const result = discover?.body?.result;
  const info = result?.serverInfo as Connection['serverInfo'] | undefined;

  connection.serverInfo = info;
  connection.capabilities = result?.capabilities as Record<string, unknown> | undefined;

  emit({
    id: 'handshake',
    label: 'Handshake',
    status: discover?.body?.result ? 'pass' : 'warn',
    detail: discover?.body?.result
      ? `Stateless (${connection.version}). ${info?.name ?? 'Server'}${
          info?.version ? ` ${info.version}` : ''
        } advertises ${describeCapabilities(connection.capabilities)}.`
      : `Assuming the stateless era at ${connection.version}; server/discover did not return a result, which it is required to implement.`,
    latencyMs: discover?.latencyMs,
    exchange: discover,
  });

  return connection;
}

/** Run the pre-2026 `initialize` handshake, including the session id. */
async function legacyHandshake(
  connection: Connection,
  emit: (check: Check) => void,
): Promise<Connection> {
  const init = await rpc(connection, 'initialize', {
    protocolVersion: connection.version,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });

  // Only readable when the server lists it in Access-Control-Expose-Headers.
  const session = init.responseHeaders['mcp-session-id'];
  if (session) connection.sessionId = session;

  const result = init.body?.result;
  if (!result) {
    emit({
      id: 'handshake',
      label: 'Handshake',
      status: 'fail',
      detail: init.body?.error
        ? `initialize failed. ${describeError(init.body.error)}`
        : `initialize returned HTTP ${init.status} with no JSON-RPC result.`,
      latencyMs: init.latencyMs,
      exchange: init,
    });
    return connection;
  }

  const negotiated = result.protocolVersion;
  if (
    typeof negotiated === 'string' &&
    (PROTOCOL_VERSIONS as readonly string[]).includes(negotiated)
  ) {
    connection = { ...connection, version: negotiated as ProtocolVersion };
  }

  const info = result.serverInfo as Connection['serverInfo'] | undefined;
  connection.serverInfo = info;
  connection.capabilities = result.capabilities as Record<string, unknown> | undefined;
  connection.instructions =
    typeof result.instructions === 'string' ? result.instructions : undefined;

  emit({
    id: 'handshake',
    label: 'Handshake',
    status: 'pass',
    detail: `initialize at ${connection.version}. ${info?.name ?? 'Server'}${
      info?.version ? ` ${info.version}` : ''
    } advertises ${describeCapabilities(connection.capabilities)}.${
      session ? ` Session ${session.slice(0, 12)}…` : ''
    }`,
    latencyMs: init.latencyMs,
    exchange: init,
  });

  if (!session) {
    emit({
      id: 'session',
      label: 'Session header',
      status: 'warn',
      detail:
        'No readable Mcp-Session-Id. Either the server is stateless, or it set the header without listing it in Access-Control-Expose-Headers. In that case a browser client cannot see it, and every later call will look unauthenticated.',
    });
  }

  // The handshake is only complete once the client confirms it.
  await notify(connection, 'notifications/initialized');

  return connection;
}

function describeCapabilities(capabilities: Record<string, unknown> | undefined): string {
  const names = Object.keys(capabilities ?? {});
  return names.length > 0 ? names.join(', ') : 'no capabilities';
}

/* ── Listings and conformance ─────────────────────────────────────────── */

/**
 * Validate one tool definition.
 *
 * Everything checked here is something that breaks a real client: a missing
 * `inputSchema` leaves a model guessing at arguments, and an `x-mcp-header`
 * outside the permitted shape makes a conforming client *drop the tool*.
 */
function inspectTool(raw: Record<string, unknown>, seen: Set<string>): ToolSummary {
  const issues: string[] = [];
  const name = typeof raw.name === 'string' ? raw.name : '';

  if (name === '') issues.push('missing a name');
  else if (seen.has(name)) issues.push('duplicate name');
  seen.add(name);

  const description = typeof raw.description === 'string' ? raw.description : undefined;
  if (!description) issues.push('no description, so a model has nothing to select on');

  const schema = raw.inputSchema as Record<string, unknown> | undefined;
  if (!schema) {
    issues.push('no inputSchema');
  } else if (schema.type !== 'object') {
    issues.push(`inputSchema.type is ${JSON.stringify(schema.type)}, expected "object"`);
  }

  const properties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const headerNames = new Set<string>();
  for (const [property, definition] of Object.entries(properties)) {
    const header = definition?.['x-mcp-header'];
    if (header === undefined) continue;
    if (
      typeof header !== 'string' ||
      header === '' ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header)
    ) {
      issues.push(`x-mcp-header on "${property}" is not a valid HTTP token`);
    } else if (headerNames.has(header.toLowerCase())) {
      issues.push(`x-mcp-header "${header}" is used twice`);
    } else {
      headerNames.add(header.toLowerCase());
    }
    if (definition.type === 'number') {
      issues.push(`x-mcp-header on "${property}" is a number, which is not permitted`);
    }
  }

  return {
    name,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    description,
    inputSchema: schema,
    outputSchema: raw.outputSchema as Record<string, unknown> | undefined,
    required: Array.isArray(schema?.required)
      ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
    issues,
  };
}

async function listTools(
  connection: Connection,
  emit: (check: Check) => void,
): Promise<ToolSummary[]> {
  let exchange: Exchange;
  try {
    exchange = await rpc(connection, 'tools/list');
  } catch (error) {
    emit({
      id: 'tools',
      label: 'tools/list',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const error = exchange.body?.error;
  if (error) {
    emit({
      id: 'tools',
      label: 'tools/list',
      status: error.code === -32601 ? 'warn' : 'fail',
      detail:
        error.code === -32601
          ? 'Not implemented. Valid for a server that only exposes resources or prompts.'
          : describeError(error),
      latencyMs: exchange.latencyMs,
      exchange,
    });
    return [];
  }

  const raw = exchange.body?.result?.tools;
  if (!Array.isArray(raw)) {
    emit({
      id: 'tools',
      label: 'tools/list',
      status: 'fail',
      detail: `Result has no "tools" array (HTTP ${exchange.status}).`,
      latencyMs: exchange.latencyMs,
      exchange,
    });
    return [];
  }

  const seen = new Set<string>();
  const tools = raw.map((tool) => inspectTool(tool as Record<string, unknown>, seen));
  const flawed = tools.filter((t) => t.issues.length > 0);

  emit({
    id: 'tools',
    label: 'tools/list',
    status: flawed.length > 0 ? 'warn' : 'pass',
    detail:
      flawed.length > 0
        ? `${tools.length} tool${tools.length === 1 ? '' : 's'}, ${flawed.length} with definition problems. See the inspector below.`
        : `${tools.length} tool${tools.length === 1 ? '' : 's'}, all with a usable schema.`,
    latencyMs: exchange.latencyMs,
    exchange,
  });

  /*
   * `ttlMs` and `cacheScope` became required on list results in 2026-07-28.
   * Their absence is not fatal, but it costs every client its cache.
   */
  if (!isLegacy(connection.version)) {
    const result = exchange.body?.result ?? {};
    const missing = ['ttlMs', 'cacheScope'].filter((field) => result[field] === undefined);
    if (missing.length > 0) {
      emit({
        id: 'cacheable',
        label: 'Cacheable result',
        status: 'warn',
        detail: `tools/list omits ${missing.join(' and ')}, required from 2026-07-28. Clients cannot cache the listing and will re-fetch it on every run.`,
        exchange,
      });
    }
  }

  return tools;
}

/** Count the entries a list method returns, tolerating an unimplemented one. */
async function listCount(
  connection: Connection,
  method: string,
  field: string,
  emit: (check: Check) => void,
): Promise<number> {
  let exchange: Exchange;
  try {
    exchange = await rpc(connection, method);
  } catch (error) {
    emit({
      id: method,
      label: method,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }

  const error = exchange.body?.error;
  if (error) {
    emit({
      id: method,
      label: method,
      status: error.code === -32601 ? 'skip' : 'warn',
      detail: error.code === -32601 ? 'Not implemented.' : describeError(error),
      latencyMs: exchange.latencyMs,
      exchange,
    });
    return 0;
  }

  const items = exchange.body?.result?.[field];
  const count = Array.isArray(items) ? items.length : 0;
  emit({
    id: method,
    label: method,
    status: 'pass',
    detail: `${count} ${field}.`,
    latencyMs: exchange.latencyMs,
    exchange,
  });
  return count;
}

/**
 * Confirm the server rejects an unknown method properly.
 *
 * A server that answers `200 OK` to a method it has never heard of will happily
 * swallow a typo'd tool call, and the failure will surface much later as an
 * empty result somewhere else.
 */
async function checkUnknownMethod(
  connection: Connection,
  emit: (check: Check) => void,
): Promise<void> {
  let exchange: Exchange;
  try {
    exchange = await rpc(connection, 'coronring/does-not-exist');
  } catch (error) {
    emit({
      id: 'unknown',
      label: 'Unknown method',
      status: 'warn',
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const code = exchange.body?.error?.code;
  if (code === -32601) {
    emit({
      id: 'unknown',
      label: 'Unknown method',
      status: 'pass',
      detail: `Rejected with -32601 Method not found (HTTP ${exchange.status}).`,
      latencyMs: exchange.latencyMs,
      exchange,
    });
    return;
  }

  emit({
    id: 'unknown',
    label: 'Unknown method',
    status: 'warn',
    detail:
      code === undefined
        ? `Answered HTTP ${exchange.status} without a JSON-RPC error. An unknown method must return -32601, or a client cannot tell a typo from an empty result.`
        : `Returned ${describeError(exchange.body?.error as JsonRpcError)} instead of -32601.`,
    latencyMs: exchange.latencyMs,
    exchange,
  });
}

/**
 * Sample round-trip latency.
 *
 * `tools/list` is the probe because it is cheap, idempotent, and universally
 * implemented. The first call of the run is excluded from the summary — it
 * carries TLS setup and any cold start, which is a different number from the
 * steady-state latency a client will actually see.
 */
async function measure(
  connection: Connection,
  samples: number,
  emit: (check: Check) => void,
): Promise<Timing | undefined> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const exchange = await rpc(connection, 'tools/list');
      timings.push(exchange.latencyMs);
    } catch {
      break;
    }
  }

  if (timings.length === 0) return undefined;

  const sorted = [...timings].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const timing: Timing = {
    samples: timings,
    min: sorted[0] ?? 0,
    median: median(sorted),
    p95: sorted[p95Index] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };

  emit({
    id: 'latency',
    label: 'Latency',
    status: timing.median < 400 ? 'pass' : timing.median < 1500 ? 'warn' : 'fail',
    detail: `${timings.length} calls to tools/list: median ${timing.median} ms, min ${timing.min} ms, max ${timing.max} ms. Includes network round trip from this browser.`,
  });

  return timing;
}

/* ── Tool invocation ──────────────────────────────────────────────────── */

export interface ToolCallResult {
  readonly exchange: Exchange;
  readonly ok: boolean;
  /** `content` flattened to text, when the result carries any. */
  readonly text: string;
  readonly structured?: unknown;
  readonly error?: JsonRpcError;
  /** True when the server asked for more input under the MRTR pattern. */
  readonly needsInput: boolean;
}

/**
 * Call one tool.
 *
 * `Mcp-Name` must mirror `params.name` from 2026-07-28 or the server returns
 * `-32020`, so the name is passed through to the header builder rather than
 * being left to the caller to remember.
 */
export async function callTool(
  connection: Connection,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const exchange = await rpc(connection, 'tools/call', { name, arguments: args }, name);
  const result = exchange.body?.result;
  const error = exchange.body?.error;

  const content = Array.isArray(result?.content)
    ? (result.content as Record<string, unknown>[])
    : [];
  const text = content
    .map((part) => (typeof part.text === 'string' ? part.text : `[${String(part.type ?? 'part')}]`))
    .join('\n');

  return {
    exchange,
    ok: !error && result !== undefined && result.isError !== true,
    text,
    structured: result?.structuredContent,
    error,
    needsInput: result?.resultType === 'input_required',
  };
}

/* ── Reproduction ─────────────────────────────────────────────────────── */

/**
 * The equivalent `curl` for an exchange.
 *
 * The escape hatch for the CORS case: when the browser refuses to make the
 * request, the visitor still leaves with something that will run in a terminal.
 */
export function toCurl(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): string {
  const quoted = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
  const lines = [`curl -sS -X POST ${quoted(url)}`];
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`  -H ${quoted(`${key}: ${value}`)}`);
  }
  lines.push(`  -d ${quoted(JSON.stringify(body))}`);
  return lines.join(' \\\n');
}

/** A ready-to-run `curl` for the first request the probe would make. */
export function curlForUrl(
  url: string,
  headers: Readonly<Record<string, string>>,
  version: ProtocolVersion = MODERN_FROM,
): string {
  const method = isLegacy(version) ? 'initialize' : 'server/discover';
  const connection = {
    url,
    headers,
    version,
    era: isLegacy(version) ? 'legacy' : 'modern',
  } as const;
  const params = isLegacy(version)
    ? { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO }
    : { _meta: metaFor(version) };
  return toCurl(url, buildHeaders(connection, method), {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });
}
