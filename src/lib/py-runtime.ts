/**
 * Typed host for the Pyodide worker.
 *
 * One class, one worker, one lifecycle. Everything the UI needs to know arrives
 * through callbacks rather than being polled, and the only way to stop a running
 * script is `terminate()`, which is why the worker is owned here rather than
 * shared.
 *
 * ## The hard requirement
 *
 * A visitor can type `while True: pass`. That has to be survivable. Killing the
 * worker is the only mechanism the platform offers, so `stop()` terminates and
 * `start()` builds a fresh one. Everything else follows from that: state lives
 * in the worker and is expected to be lost, and the UI is written so that losing
 * it is visible rather than confusing.
 *
 * @see public/py-worker.js for the other side of the protocol
 * @see src/data/py-presets.ts for the package sets
 */

import { href } from './url';

/** Pinned. A minor Pyodide bump changes the bundled package set and their versions. */
export const PYODIDE_VERSION = '0.28.3';

/**
 * Where the runtime is fetched from.
 *
 * jsDelivr rather than self-hosted. The full distribution is hundreds of
 * megabytes because it carries every prebuilt package, and committing even the
 * core to a repository that deploys through GitHub Pages would be the largest
 * thing in it by an order of magnitude. The cost is a third-party request, which
 * the tool page states plainly.
 */
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/* ── Events ───────────────────────────────────────────────────────────── */

export type Phase = 'idle' | 'downloading' | 'starting' | 'installing' | 'running' | 'ready';

export interface StreamChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export interface InstallReport {
  readonly installed: readonly string[];
  readonly failed: ReadonlyArray<{ readonly spec: string; readonly reason: string }>;
}

export interface RunResult {
  /** `repr()` of the final expression, when the snippet ended in one. */
  readonly repr: string;
  readonly elapsedMs: number;
  readonly ok: boolean;
}

export interface RunFailure {
  /** The exception line, which is what to lead with. */
  readonly message: string;
  /** The full traceback, for the details pane. */
  readonly traceback: string;
  readonly elapsedMs: number;
}

export interface RuntimeHandlers {
  onPhase?: (phase: Phase, detail: string) => void;
  onOutput?: (chunk: StreamChunk) => void;
  onInstalled?: (report: InstallReport) => void;
  onReady?: (info: { python: string; packages: number }) => void;
}

interface WorkerMessage {
  id: number;
  type: string;
  phase?: Phase;
  detail?: string;
  text?: string;
  repr?: string;
  elapsedMs?: number;
  ok?: boolean;
  message?: string;
  traceback?: string;
  installed?: string[];
  failed?: Array<{ spec: string; reason: string }>;
  python?: string;
  packages?: number;
}

/* ── Runtime ──────────────────────────────────────────────────────────── */

export interface RunRequest {
  readonly code: string;
  /** Fed to `input()`, one line per call. */
  readonly stdin?: string;
  /** Installed before the code runs, if not already present. */
  readonly packages?: readonly string[];
  /** Wheel URLs, for a package not on PyPI. */
  readonly wheels?: readonly string[];
  /** Kill the run after this long. 0 disables the limit. */
  readonly timeoutMs?: number;
}

export class PythonRuntime {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: RunResult) => void; reject: (error: RunFailure) => void }
  >();
  private handlers: RuntimeHandlers;
  private timers = new Map<number, number>();
  /** Packages already installed in this worker, so a rerun does not reinstall. */
  private satisfied = new Set<string>();

  constructor(handlers: RuntimeHandlers = {}) {
    this.handlers = handlers;
  }

  /** True while a worker exists. It may still be booting. */
  get alive(): boolean {
    return this.worker !== null;
  }

  /**
   * Start the worker and load the interpreter.
   *
   * Safe to call repeatedly: an existing worker is reused. The returned promise
   * resolves when the interpreter is ready to run code.
   */
  async start(): Promise<void> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    await new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type: 'boot', indexUrl: PYODIDE_INDEX });
    });
  }

  /** Install packages without running anything, so the UI can prepare a preset. */
  async install(packages: readonly string[], wheels: readonly string[] = []): Promise<void> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    await new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: 'install',
        indexUrl: PYODIDE_INDEX,
        packages: [...packages],
        wheels: [...wheels],
      });
    });
  }

  /**
   * Run a snippet.
   *
   * @throws RunFailure On a Python exception, a timeout, or a terminated worker.
   *   Not an `Error`: a Python traceback is not a JavaScript stack, and flattening
   *   it into an `Error.message` throws away the part the user needs.
   */
  run(request: RunRequest): Promise<RunResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;

    const fresh = (request.packages ?? []).filter((spec) => !this.satisfied.has(spec));
    const wheels = (request.wheels ?? []).filter((spec) => !this.satisfied.has(spec));
    for (const spec of [...fresh, ...wheels]) this.satisfied.add(spec);

    return new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      const budget = request.timeoutMs ?? 0;
      if (budget > 0) {
        this.timers.set(
          id,
          window.setTimeout(() => {
            // Terminate, do not just reject. The worker is inside synchronous
            // WebAssembly and will not respond to a message; the promise would
            // resolve and the loop would keep burning a core.
            this.stop();
            this.settleAll({
              message: `Stopped after ${(budget / 1000).toFixed(0)}s. The interpreter was restarted, so any state from this session is gone.`,
              traceback: '',
              elapsedMs: budget,
            });
          }, budget),
        );
      }

      worker.postMessage({
        id,
        type: 'run',
        indexUrl: PYODIDE_INDEX,
        code: request.code,
        stdin: request.stdin ?? '',
        packages: fresh.length > 0 ? fresh : undefined,
        wheels: wheels.length > 0 ? wheels : undefined,
      });
    });
  }

  /** Clear user globals, keeping the interpreter and its installed packages. */
  async reset(): Promise<void> {
    if (!this.worker) return;
    const id = this.nextId++;
    const worker = this.worker;
    await new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type: 'reset' });
    }).catch(() => undefined);
  }

  /**
   * Kill the worker.
   *
   * The only way to interrupt running Python. Everything in the interpreter is
   * lost, including installed packages, which is why `satisfied` is cleared
   * here: a stale entry would make the next run skip an install it needs.
   */
  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.satisfied.clear();
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.handlers.onPhase?.('idle', 'Stopped');
  }

  /** Release everything. Call from a component's cleanup. */
  dispose(): void {
    this.settleAll({ message: 'The runner was closed.', traceback: '', elapsedMs: 0 });
    this.stop();
  }

  /* ── Internals ──────────────────────────────────────────────────── */

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    // A classic worker, not a module worker: it calls `importScripts`, which is
    // unavailable in a module worker and which Pyodide's loader needs.
    //
    // Routed through `href()` like every other internal path, so the worker is
    // still found if this site ever moves to a sub-path. A hardcoded "/" would
    // 404 there, and it would 404 silently: the worker would simply never boot.
    const worker = new Worker(href('/py-worker.js'));
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.receive(event.data);
    worker.onerror = (event) => {
      this.settleAll({
        message: event.message || 'The Python worker failed to start.',
        traceback: '',
        elapsedMs: 0,
      });
    };
    this.worker = worker;
    return worker;
  }

  private receive(message: WorkerMessage): void {
    const { id, type } = message;

    switch (type) {
      case 'status':
        this.handlers.onPhase?.(message.phase ?? 'running', message.detail ?? '');
        return;

      case 'stdout':
      case 'stderr':
        this.handlers.onOutput?.({
          stream: type === 'stdout' ? 'stdout' : 'stderr',
          text: message.text ?? '',
        });
        return;

      case 'installed':
        this.handlers.onInstalled?.({
          installed: message.installed ?? [],
          failed: message.failed ?? [],
        });
        // A failed install must not be remembered as satisfied, or a rerun
        // silently skips it and the error moves to the import instead.
        for (const failure of message.failed ?? []) this.satisfied.delete(failure.spec);
        return;

      case 'ready':
        this.handlers.onPhase?.('ready', 'Ready');
        this.handlers.onReady?.({
          python: message.python ?? '',
          packages: message.packages ?? 0,
        });
        this.settle(id, { repr: '', elapsedMs: 0, ok: true });
        return;

      case 'result':
        this.handlers.onPhase?.('ready', 'Ready');
        this.settle(id, {
          repr: message.repr ?? '',
          elapsedMs: message.elapsedMs ?? 0,
          ok: message.ok !== false,
        });
        return;

      case 'error':
        this.handlers.onPhase?.('ready', 'Ready');
        this.fail(id, {
          message: message.message ?? 'Execution failed',
          traceback: message.traceback ?? '',
          elapsedMs: message.elapsedMs ?? 0,
        });
        return;
    }
  }

  private settle(id: number, result: RunResult): void {
    this.clearTimer(id);
    const entry = this.pending.get(id);
    this.pending.delete(id);
    entry?.resolve(result);
  }

  private fail(id: number, failure: RunFailure): void {
    this.clearTimer(id);
    const entry = this.pending.get(id);
    this.pending.delete(id);
    entry?.reject(failure);
  }

  private settleAll(failure: RunFailure): void {
    for (const [id, entry] of this.pending) {
      this.clearTimer(id);
      entry.reject(failure);
    }
    this.pending.clear();
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

/* ── Syntax highlighting ──────────────────────────────────────────────── */

export type TokenKind =
  | 'keyword'
  | 'builtin'
  | 'string'
  | 'comment'
  | 'number'
  | 'decorator'
  | 'def'
  | 'operator'
  | 'plain';

export interface CodeToken {
  readonly text: string;
  readonly kind: TokenKind;
}

const KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'case',
  'type',
]);

const BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'bool',
  'bytes',
  'callable',
  'chr',
  'dict',
  'dir',
  'divmod',
  'enumerate',
  'filter',
  'float',
  'format',
  'frozenset',
  'getattr',
  'hasattr',
  'hash',
  'hex',
  'id',
  'input',
  'int',
  'isinstance',
  'issubclass',
  'iter',
  'len',
  'list',
  'map',
  'max',
  'min',
  'next',
  'object',
  'oct',
  'open',
  'ord',
  'pow',
  'print',
  'range',
  'repr',
  'reversed',
  'round',
  'set',
  'setattr',
  'slice',
  'sorted',
  'staticmethod',
  'str',
  'sum',
  'super',
  'tuple',
  'type',
  'vars',
  'zip',
  'self',
  'cls',
  'Exception',
  'ValueError',
  'TypeError',
  'KeyError',
  'IndexError',
  'RuntimeError',
]);

/**
 * Tokenise Python for display.
 *
 * A scanner, not a parser, and deliberately so. A real Python grammar in the
 * editor would be a few hundred kilobytes of dependency to colour text that the
 * interpreter is about to check anyway. What this needs to get right is the
 * cases where a naive highlighter looks broken: triple-quoted strings, f-string
 * prefixes, escapes inside strings, and a `#` that is inside a string rather
 * than starting a comment. Those are handled; operator precedence is not, and
 * does not need to be.
 */
export function tokenizePython(source: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  let plainFrom = 0;

  const flush = (until: number): void => {
    if (until > plainFrom) tokens.push({ text: source.slice(plainFrom, until), kind: 'plain' });
  };
  const emit = (text: string, kind: TokenKind): void => {
    tokens.push({ text, kind });
    i += text.length;
    plainFrom = i;
  };

  while (i < source.length) {
    const ch = source[i] ?? '';

    if (ch === '#') {
      flush(i);
      const end = source.indexOf('\n', i);
      emit(source.slice(i, end === -1 ? source.length : end), 'comment');
      continue;
    }

    // A string may carry a prefix: r, b, f, u, rb, fr, and their cases.
    const prefix = /^(?:[rbfuRBFU]{0,3})?(?=['"])/.exec(source.slice(i, i + 4));
    if (prefix && (source[i + prefix[0].length] === '"' || source[i + prefix[0].length] === "'")) {
      flush(i);
      const quoteStart = i + prefix[0].length;
      const quote = source[quoteStart] ?? '"';
      const triple = source.slice(quoteStart, quoteStart + 3) === quote.repeat(3);
      const delimiter = triple ? quote.repeat(3) : quote;
      let j = quoteStart + delimiter.length;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source.startsWith(delimiter, j)) {
          j += delimiter.length;
          break;
        }
        // An unterminated single-quoted string ends at the line, which is what
        // the tokeniser does too. Without this, one stray quote colours the
        // rest of the file as a string.
        if (!triple && source[j] === '\n') break;
        j += 1;
      }
      emit(source.slice(i, j), 'string');
      continue;
    }

    if (ch === '@' && /[A-Za-z_]/.test(source[i + 1] ?? '')) {
      flush(i);
      const match = /^@[\w.]+/.exec(source.slice(i));
      emit(match?.[0] ?? '@', 'decorator');
      continue;
    }

    if (/\d/.test(ch) && !/[\w]/.test(source[i - 1] ?? ' ')) {
      flush(i);
      const match = /^(?:0[xXoObB][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)/.exec(
        source.slice(i),
      );
      emit(match?.[0] ?? ch, 'number');
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      flush(i);
      const match = /^[A-Za-z_]\w*/.exec(source.slice(i));
      const word = match?.[0] ?? ch;
      // The name after `def` or `class` is the one worth picking out: it is what
      // someone scans for when reading unfamiliar code.
      const declared = /(?:^|\n)\s*(?:async\s+)?(?:def|class)\s+$/.test(source.slice(0, i));
      emit(
        word,
        declared
          ? 'def'
          : KEYWORDS.has(word)
            ? 'keyword'
            : BUILTINS.has(word)
              ? 'builtin'
              : 'plain',
      );
      continue;
    }

    if ('+-*/%=<>!&|^~:,.()[]{}'.includes(ch)) {
      flush(i);
      emit(ch, 'operator');
      continue;
    }

    i += 1;
  }

  flush(i);
  return tokens;
}
