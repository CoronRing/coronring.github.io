/**
 * Railtracks run logs: what a file holds, and how to turn it into runs.
 *
 * Railtracks writes a run in two formats, both under `.railtracks/data/`:
 *
 * - **Session file** (`sessions/*.json`). One JSON object per session, with a
 *   `runs` array already in the shape the V1 visualizer draws. Written when a
 *   flow runs with `save_state`, which Railtracks has deprecated.
 * - **Event stream** (`events/*.jsonl`). One JSON event per line, appended as
 *   the session runs, so a file can be read while its run is still going. This
 *   is what current Railtracks writes by default.
 *
 * The V1 visualizer only reads runs, so `eventsToRuns` rebuilds them from an
 * event stream: one run per top-level node call, an edge from each caller to
 * each node it called, every model call attached to the node that made it.
 * The mapping follows how the session file records the same session, and was
 * checked against every session in a working `.railtracks` folder that has
 * both files. Event types it does not use (middleware, context) are kept in
 * `events` for a renderer that does.
 */

/* ── The run shape the V1 visualizer reads ───────────────────────────── */

export interface RunStamp {
  step: number;
  /** Unix time in seconds. */
  time: number;
  identifier: string;
}

export interface LlmMessage {
  role: string;
  content: unknown;
}

export interface LlmCall {
  model_name: string;
  model_provider: string;
  input: LlmMessage[];
  output: LlmMessage | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost: number | null;
  system_fingerprint: string | null;
  /** Seconds. */
  latency: number | null;
}

export interface RunNode {
  identifier: string;
  node_type: string;
  name: string;
  stamp: RunStamp;
  details: {
    internals?: {
      guard_details?: unknown[];
      llm_details?: LlmCall[];
      latency?: { total_time: number };
    };
  };
  /** The same node at an earlier step, or null. */
  parent: RunNode | null;
}

export interface RunEdge {
  identifier: string;
  /** The calling node, or null for the call that started the run. */
  source: string | null;
  target: string;
  stamp: RunStamp;
  details: {
    status?: string;
    input_args?: unknown[];
    input_kwargs?: unknown;
    output?: unknown;
  };
  parent: RunEdge | null;
}

export interface Run {
  session_id: string;
  name: string;
  run_id: string;
  start_time: number;
  end_time: number;
  /** `Completed`, `Failed`, or `Running` for a run still being written. */
  status: string;
  nodes: RunNode[];
  edges: RunEdge[];
  steps: RunStamp[];
}

/* ── Events ──────────────────────────────────────────────────────────── */

export interface RunEvent {
  event_type: string;
  scope_type: string;
  scope_id: string;
  event_id: string;
  /** ISO 8601. */
  stamp: string;
  parent_scope_id: string | null;
  payload: Record<string, unknown>;
}

/* ── A loaded session, whatever it came from ─────────────────────────── */

export type SessionStatus = 'completed' | 'failed' | 'running' | 'unknown';

export interface LoadedSession {
  id: string;
  /** Flow name, else session name, else the entry point. */
  name: string;
  source: 'session' | 'events';
  /** Unix seconds, when known. */
  startTime: number | null;
  endTime: number | null;
  status: SessionStatus;
  /** The session's error message, when it failed and said why. */
  error: string | null;
  runs: Run[];
  /** The raw event stream, for a renderer that reads events directly. */
  events: RunEvent[] | null;
}

export class RunParseError extends Error {
  override name = 'RunParseError';
}

/* ── Reading input ───────────────────────────────────────────────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** ISO 8601 to Unix seconds. Microseconds are dropped; milliseconds are plenty here. */
function seconds(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

function isEvent(value: unknown): value is RunEvent {
  return isRecord(value) && typeof value.event_type === 'string' && isRecord(value.payload);
}

function isRunLike(value: unknown): value is Run {
  return isRecord(value) && Array.isArray(value.nodes);
}

/**
 * Parse whatever was dropped, pasted or picked: a session file, a single run,
 * an event stream, or a JSON array of events.
 *
 * A JSONL file that is still being written can end in a half-written line;
 * that line is skipped rather than failing the whole file.
 */
export function parseRunText(text: string, fileName = ''): LoadedSession {
  const trimmed = text.trim();
  if (!trimmed) throw new RunParseError('The file is empty.');

  let whole: unknown;
  let parsedWhole = false;
  try {
    whole = JSON.parse(trimmed);
    parsedWhole = true;
  } catch {
    /* not a single JSON document; try JSON Lines below */
  }

  if (parsedWhole) {
    if (isRecord(whole) && Array.isArray(whole.runs)) return fromSessionFile(whole, fileName);
    if (isRunLike(whole)) return fromSessionFile({ runs: [whole] }, fileName);
    if (Array.isArray(whole) && whole.length > 0 && whole.every(isEvent)) {
      return eventsToSession(whole, fileName);
    }
    if (isEvent(whole)) return eventsToSession([whole], fileName);
    throw new RunParseError(
      'This JSON is not a Railtracks run. Expected a session file with a "runs" array, or an event stream.',
    );
  }

  const events: RunEvent[] = [];
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value: unknown = JSON.parse(line);
      if (isEvent(value)) events.push(value);
    } catch (error) {
      // Only the last line may be partial: the writer is mid-append.
      if (index !== lines.length - 1) {
        throw new RunParseError(`Line ${index + 1} is not valid JSON.`, { cause: error });
      }
    }
  });
  if (events.length === 0) {
    throw new RunParseError('Not valid JSON, and no Railtracks events found line by line.');
  }
  return eventsToSession(events, fileName);
}

/** The session id at the end of a Railtracks file name, if there is one. */
export function sessionIdFromName(fileName: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl?$/i.exec(
    fileName,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

/** The flow name a session file carries before its id, as in `{flow}_{id}.json`. */
export function flowNameFromName(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const match = /^(.*)_[0-9a-f]{8}-[0-9a-f-]{27}\.json$/i.exec(base);
  return match?.[1] ? match[1] : null;
}

function fromSessionFile(session: Record<string, unknown>, fileName: string): LoadedSession {
  const runsRaw = Array.isArray(session.runs) ? session.runs.filter(isRunLike) : [];
  const id =
    str(session.session_id) ??
    sessionIdFromName(fileName) ??
    (runsRaw[0] ? str((runsRaw[0] as unknown as Record<string, unknown>).session_id) : null) ??
    'session';
  const runs = runsRaw.map((run) => ({ ...run, session_id: run.session_id ?? id }));
  const statuses = runs.map((run) => run.status?.toLowerCase());
  const status: SessionStatus = statuses.includes('failed')
    ? 'failed'
    : statuses.length > 0 && statuses.every((s) => s === 'completed')
      ? 'completed'
      : 'unknown';
  return {
    id,
    name:
      str(session.flow_name) ??
      str(session.session_name) ??
      runs[0]?.name ??
      flowNameFromName(fileName) ??
      'Session',
    source: 'session',
    startTime: numOrNull(session.start_time) ?? runs[0]?.start_time ?? null,
    endTime: numOrNull(session.end_time) ?? runs.at(-1)?.end_time ?? null,
    status,
    error: null,
    runs,
    events: null,
  };
}

/* ── Events to runs ──────────────────────────────────────────────────── */

interface NodeState {
  id: string;
  name: string;
  type: string;
  /** The node that called this one; null for a top-level call. */
  caller: string | null;
  invoked: boolean;
  invokedAt: number;
  args: unknown[];
  kwargs: unknown;
  response?: unknown;
  failure?: { type: string; message: string };
  finishedAt?: number;
  duration?: number;
  llm: LlmCall[];
}

interface LlmState {
  node: string | null;
  type: string | null;
  call: LlmCall;
}

const payloadTime = (event: RunEvent): number =>
  seconds(event.payload.timestamp) ?? seconds(event.stamp) ?? 0;

/**
 * A node that answered was called, even when its `node.invocation` line is
 * missing from the stream; take the caller from the answer instead.
 */
function markInvoked(node: NodeState, payload: Record<string, unknown>): void {
  if (node.invoked) return;
  node.invoked = true;
  node.caller = str(payload.spatial_parent_node_id);
}

/**
 * Rebuild a session's runs from its event stream.
 *
 * Exported for tests and for callers holding parsed events; `parseRunText`
 * is the usual way in.
 */
export function eventsToSession(events: readonly RunEvent[], fileName = ''): LoadedSession {
  const nodes = new Map<string, NodeState>();
  const order: string[] = [];
  const llmTypes = new Map<string, { provider: string; model: string }>();
  const llmCalls = new Map<string, LlmState>();

  let sessionId = sessionIdFromName(fileName);
  let flowName: string | null = null;
  let sessionName: string | null = null;
  let entryPoint: string | null = null;
  let startTime: number | null = null;
  let endTime: number | null = null;
  let completedStatus: string | null = null;
  let error: string | null = null;
  let lastTime: number | null = null;

  for (const event of events) {
    const p = event.payload;
    const time = payloadTime(event);
    lastTime = lastTime === null ? time : Math.max(lastTime, time);
    if (!sessionId && event.scope_type === 'session') sessionId = event.scope_id;

    switch (event.event_type) {
      case 'session.started':
        sessionId = str(p.session_id) ?? sessionId;
        flowName = str(p.flow_name);
        sessionName = str(p.session_name);
        entryPoint = str(p.entry_point_name);
        startTime = time;
        break;
      case 'session.completed':
        completedStatus = str(p.status);
        error = str(p.error);
        endTime = time;
        break;
      case 'node.creation': {
        const id = str(p.node_id);
        if (!id || nodes.has(id)) break;
        nodes.set(id, {
          id,
          name: str(p.name) ?? 'node',
          type: str(p.node_type) ?? 'Node',
          caller: null,
          invoked: false,
          invokedAt: time,
          args: [],
          kwargs: {},
          llm: [],
        });
        order.push(id);
        break;
      }
      case 'node.invocation': {
        const node = nodes.get(str(p.parent_node_id) ?? '');
        if (!node) break;
        node.invoked = true;
        node.invokedAt = time;
        node.caller = str(p.spatial_parent_node_id);
        node.args = Array.isArray(p.args) ? p.args : [];
        node.kwargs = p.kwargs ?? {};
        break;
      }
      case 'node.response': {
        const node = nodes.get(str(p.parent_node_id) ?? '');
        if (!node) break;
        markInvoked(node, p);
        node.response = p.response;
        break;
      }
      case 'node.failure': {
        const node = nodes.get(str(p.parent_node_id) ?? '');
        if (node) {
          markInvoked(node, p);
          node.failure = {
            type: str(p.exception_name) ?? 'Error',
            message: str(p.exception_message) ?? '',
          };
          node.finishedAt ??= time;
        }
        break;
      }
      case 'node.destruction': {
        const node = nodes.get(str(p.parent_node_id) ?? '');
        if (!node) break;
        markInvoked(node, p);
        node.finishedAt = time;
        node.duration = numOrNull(p.duration_seconds) ?? undefined;
        if (node.response === undefined && !node.failure) node.response = p.response;
        break;
      }
      case 'llm.creation': {
        const id = str(p.llm_id);
        if (id) {
          llmTypes.set(id, {
            provider: str(p.model_provider) ?? '',
            model: str(p.model_name) ?? '',
          });
        }
        break;
      }
      case 'llm.invocation': {
        const invokeId = str(p.parent_llm_invoke_id);
        if (!invokeId) break;
        const typeId = str(p.parent_llm_type_id);
        const type = typeId ? llmTypes.get(typeId) : undefined;
        const state: LlmState = {
          node: str(p.spatial_parent_node_id),
          type: typeId,
          call: {
            model_name: type?.model.split('/').pop() ?? '',
            model_provider: type?.provider ?? '',
            input: Array.isArray(p.message_input) ? (p.message_input as LlmMessage[]) : [],
            output: null,
            input_tokens: null,
            output_tokens: null,
            total_cost: null,
            system_fingerprint: null,
            latency: null,
          },
        };
        llmCalls.set(invokeId, state);
        const node = state.node ? nodes.get(state.node) : undefined;
        node?.llm.push(state.call);
        break;
      }
      case 'llm.response':
      case 'llm.failure': {
        const state = llmCalls.get(str(p.parent_llm_invoke_id) ?? '');
        if (!state) break;
        const call = state.call;
        if (event.event_type === 'llm.response') {
          call.output = isRecord(p.output) ? (p.output as unknown as LlmMessage) : null;
          call.model_name = str(p.reported_model_name) ?? call.model_name;
          call.input_tokens = numOrNull(p.input_tokens);
          call.output_tokens = numOrNull(p.output_tokens);
          call.total_cost = numOrNull(p.total_cost);
          call.system_fingerprint = str(p.system_fingerprint);
          call.latency = numOrNull(p.latency);
        } else {
          call.output = {
            role: 'error',
            content: `${str(p.exception_name) ?? 'Error'}: ${str(p.exception_message) ?? ''}`,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  const id = sessionId ?? 'session';
  const runs = buildRuns(id, nodes, order, lastTime ?? 0);

  const sessionStatus: SessionStatus = completedStatus
    ? /fail|error/i.test(completedStatus)
      ? 'failed'
      : 'completed'
    : runs.some((run) => run.status === 'Failed')
      ? 'failed'
      : events.length > 0
        ? 'running'
        : 'unknown';

  return {
    id,
    name: flowName ?? sessionName ?? entryPoint ?? runs[0]?.name ?? 'Session',
    source: 'events',
    startTime: startTime ?? runs[0]?.start_time ?? null,
    endTime: endTime ?? (sessionStatus === 'running' ? null : lastTime),
    status: sessionStatus,
    error,
    runs,
    events: [...events],
  };
}

function rootOf(nodes: Map<string, NodeState>, id: string): string {
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const caller = nodes.get(current)?.caller;
    if (!caller || !nodes.has(caller)) return current;
    current = caller;
  }
  return current;
}

function buildRuns(
  sessionId: string,
  nodes: Map<string, NodeState>,
  order: readonly string[],
  lastTime: number,
): Run[] {
  const invoked = order.map((id) => nodes.get(id)!).filter((node) => node.invoked);
  const byRoot = new Map<string, NodeState[]>();
  for (const node of invoked) {
    const root = rootOf(nodes, node.id);
    const group = byRoot.get(root) ?? [];
    group.push(node);
    byRoot.set(root, group);
  }

  const runs: Run[] = [];
  for (const [rootId, members] of byRoot) {
    const root = nodes.get(rootId)!;

    // Steps, in the order the session file numbers them: a call when a node
    // is invoked, a finish when it ends.
    type Moment = { time: number; node: NodeState; kind: 'start' | 'end' };
    const moments: Moment[] = [];
    for (const node of members) {
      moments.push({ time: node.invokedAt, node, kind: 'start' });
      if (node.finishedAt !== undefined) moments.push({ time: node.finishedAt, node, kind: 'end' });
    }
    moments.sort(
      (a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === 'start' ? -1 : 1),
    );

    const steps: RunStamp[] = [];
    const startStamp = new Map<string, RunStamp>();
    const endStamp = new Map<string, RunStamp>();
    moments.forEach((moment, step) => {
      const caller = moment.node.caller ? nodes.get(moment.node.caller) : undefined;
      const stamp: RunStamp = {
        step,
        time: moment.time,
        identifier:
          moment.kind === 'start'
            ? `${caller?.name ?? 'START'} CREATED ${moment.node.name}`
            : `${moment.node.failure ? 'Failed executing' : 'Finished executing'} ${moment.node.name}`,
      };
      steps.push(stamp);
      (moment.kind === 'start' ? startStamp : endStamp).set(moment.node.id, stamp);
    });

    const runNodes: RunNode[] = [];
    const runEdges: RunEdge[] = [];
    for (const node of members) {
      const first = startStamp.get(node.id)!;
      const last = endStamp.get(node.id);
      const internals: NonNullable<RunNode['details']['internals']> = {};
      if (node.llm.length > 0 || node.type === 'Agent') {
        internals.guard_details = [];
        internals.llm_details = node.llm;
      }
      const duration =
        node.duration ?? (node.finishedAt !== undefined ? node.finishedAt - node.invokedAt : null);
      if (duration !== null) internals.latency = { total_time: duration };

      const created: RunNode = {
        identifier: node.id,
        node_type: node.type,
        name: node.name,
        stamp: first,
        details: {},
        parent: null,
      };
      // A node still running shows what it has done so far, model calls included.
      runNodes.push(
        last
          ? { ...created, stamp: last, details: { internals }, parent: created }
          : { ...created, details: { internals } },
      );

      const status = node.failure ? 'Failed' : last ? 'Completed' : 'Running';
      const edgeId = node.id === rootId ? `run-${rootId}` : `edge-${node.id}`;
      const opened: RunEdge = {
        identifier: edgeId,
        source: node.caller && nodes.has(node.caller) ? node.caller : null,
        target: node.id,
        stamp: first,
        details: { input_args: node.args, input_kwargs: node.kwargs, status: 'Running' },
        parent: null,
      };
      runEdges.push(
        last
          ? {
              ...opened,
              stamp: last,
              details: {
                ...opened.details,
                status,
                output: node.failure ?? node.response ?? null,
              },
              parent: opened,
            }
          : opened,
      );
    }

    // The session file lists nodes and edges in the order they finished.
    const finished = (stamp: RunStamp): number => stamp.step;
    runNodes.sort((a, b) => finished(a.stamp) - finished(b.stamp));
    runEdges.sort((a, b) => finished(a.stamp) - finished(b.stamp));

    runs.push({
      session_id: sessionId,
      name: root.name,
      run_id: `run-${rootId}`,
      start_time: root.invokedAt,
      end_time: root.finishedAt ?? lastTime,
      status: root.failure ? 'Failed' : root.finishedAt !== undefined ? 'Completed' : 'Running',
      nodes: runNodes,
      edges: runEdges,
      steps,
    });
  }
  return runs.sort((a, b) => a.start_time - b.start_time);
}

/* ── Figures for the readout ─────────────────────────────────────────── */

export interface RunFigures {
  nodes: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when no call reported a cost. */
  cost: number | null;
  /** Seconds. */
  duration: number | null;
}

export function runFigures(run: Run): RunFigures {
  let llmCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost: number | null = null;
  for (const node of run.nodes) {
    for (const call of node.details.internals?.llm_details ?? []) {
      llmCalls += 1;
      inputTokens += call.input_tokens ?? 0;
      outputTokens += call.output_tokens ?? 0;
      if (call.total_cost !== null) cost = (cost ?? 0) + call.total_cost;
    }
  }
  const duration =
    Number.isFinite(run.end_time) && Number.isFinite(run.start_time)
      ? Math.max(0, run.end_time - run.start_time)
      : null;
  return { nodes: run.nodes.length, llmCalls, inputTokens, outputTokens, cost, duration };
}
