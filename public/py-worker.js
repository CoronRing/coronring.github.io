/*
 * Pyodide host, in a worker.
 *
 * ## Why a worker rather than the main thread
 *
 * Three reasons, in order of how much they matter:
 *
 * 1. **`while True: pass` must not kill the tab.** Pyodide is synchronous
 *    WebAssembly, so a runaway loop on the main thread blocks rendering, input
 *    and the stop button itself. In a worker the page stays alive and the parent
 *    can `terminate()`, which is the only reliable way to stop Python mid-loop.
 * 2. **A 12 MB runtime download must not block first paint.** The page is
 *    interactive before the interpreter exists.
 * 3. **`input()` needs a blocking read.** `Atomics.wait` is illegal on the main
 *    thread and legal here, so a worker is what makes `input()` possible at all.
 *
 * ## Protocol
 *
 * Parent to worker: `{ id, type, ... }`
 *   `boot`    { indexUrl }                  load the interpreter
 *   `install` { packages, wheels }          native packages, then wheels
 *   `run`     { code, stdin }               execute
 *   `reset`   {}                            clear globals, keep the interpreter
 *
 * Worker to parent, all tagged with the originating `id`:
 *   `status`  { phase, detail }             progress, for the UI
 *   `stdout` / `stderr`  { text }           streamed as produced
 *   `result`  { repr, elapsedMs, ... }      one per `run`
 *   `error`   { message, traceback }        a failure, terminal for that id
 *   `ready`   { python, packages }          boot finished
 *
 * This file is served as a static asset rather than bundled, because a worker
 * needs a stable URL and `importScripts` needs a script that is not a module.
 */

/* eslint-disable no-undef */

let pyodide = null;
let booting = null;

/** Post a message tagged with the request it belongs to. */
function send(id, type, payload) {
  self.postMessage({ id, type, ...payload });
}

/**
 * Load the interpreter.
 *
 * Idempotent and concurrency-safe: two `run` messages arriving before boot
 * finishes both await the same promise rather than starting two interpreters,
 * which would double a 12 MB download and then race on the filesystem.
 */
async function boot(id, indexUrl) {
  if (pyodide) return pyodide;
  if (booting) return booting;

  booting = (async () => {
    send(id, 'status', { phase: 'downloading', detail: 'Fetching the Python runtime' });
    importScripts(`${indexUrl}pyodide.js`);

    send(id, 'status', { phase: 'starting', detail: 'Starting the interpreter' });
    pyodide = await loadPyodide({
      indexURL: indexUrl,
      // Routed to the parent per-line as produced, rather than collected and
      // posted at the end: a script that prints in a loop should show its
      // progress, and one that dies halfway should still show what it printed.
      stdout: (text) => send(id, 'stdout', { text: `${text}\n` }),
      stderr: (text) => send(id, 'stderr', { text: `${text}\n` }),
    });

    // Wired up front so a preset's package list is one message rather than two.
    await pyodide.loadPackage('micropip');
    return pyodide;
  })();

  try {
    return await booting;
  } catch (error) {
    booting = null;
    throw error;
  }
}

/**
 * Which of these packages does Pyodide ship a WebAssembly build for?
 *
 * Asked before installing so the two kinds of failure stay distinguishable. A
 * package Pyodide has is a fast local load; a pure-Python wheel comes from PyPI;
 * a package needing a compiled extension with no wasm build cannot be installed
 * at all, and that last case is a fact about the ecosystem rather than an error
 * in the request. Reporting them the same way would be misleading.
 */
function nativeSplit(packages) {
  const lock = pyodide._api?.lockfile;
  const known = lock && lock.packages ? new Set(Object.keys(lock.packages)) : null;
  if (!known) return { native: [], remote: packages };

  const normalise = (name) => name.toLowerCase().replace(/[_.]+/g, '-');
  const index = new Map([...known].map((name) => [normalise(name), name]));

  const native = [];
  const remote = [];
  for (const spec of packages) {
    // Only a bare name can be satisfied from the bundled set. A version
    // constraint has to go through the resolver.
    const bare = /^[A-Za-z0-9._-]+$/.test(spec);
    const hit = bare ? index.get(normalise(spec)) : undefined;
    if (hit) native.push(hit);
    else remote.push(spec);
  }
  return { native, remote };
}

/**
 * Install packages, reporting each one.
 *
 * Installed one at a time rather than as a batch. A batch that fails names only
 * the first blocker, and the useful answer to "can I run this" is the full list
 * of what worked and what did not.
 */
async function install(id, packages, wheels) {
  const requested = [...(packages ?? []), ...(wheels ?? [])];
  if (requested.length === 0) return { installed: [], failed: [] };

  const { native, remote } = nativeSplit(packages ?? []);
  const installed = [];
  const failed = [];

  if (native.length > 0) {
    send(id, 'status', {
      phase: 'installing',
      detail: `Loading ${native.length} bundled package${native.length === 1 ? '' : 's'}`,
    });
    try {
      await pyodide.loadPackage(native);
      installed.push(...native);
    } catch (error) {
      // Fall through to the per-package path, which will name the culprit.
      for (const name of native) remote.push(name);
    }
  }

  const micropip = pyodide.pyimport('micropip');
  for (const spec of [...remote, ...(wheels ?? [])]) {
    send(id, 'status', { phase: 'installing', detail: `Installing ${spec}` });
    try {
      await micropip.install(spec, { keep_going: true });
      installed.push(spec);
    } catch (error) {
      failed.push({ spec, reason: reasonFor(error) });
    }
  }

  return { installed, failed };
}

/**
 * Reduce an install failure to the sentence that explains it.
 *
 * micropip's message is a Python traceback ending in the interesting line. The
 * "no pure Python wheel" case is singled out because it is by far the most
 * common and the most misread: it does not mean the package is broken, it means
 * nobody has published a WebAssembly build of a compiled dependency.
 */
function reasonFor(error) {
  const text = String(error && error.message ? error.message : error);
  const wheel = /Can't find a pure Python 3 wheel for:?\s*(.+)/.exec(text);
  if (wheel) {
    return `needs a compiled extension with no WebAssembly build: ${wheel[1].trim()}`;
  }
  const extra = /Unknown extra '([^']+)'/.exec(text);
  if (extra) {
    return `asks for the "${extra[1]}" extra, which the current version of that dependency no longer publishes`;
  }
  const conflict = /Can't find a pure Python 3 wheel|Requested '([^']+)'/.exec(text);
  if (conflict && conflict[1]) return `no version satisfying ${conflict[1]}`;
  const last = text.trim().split('\n').filter(Boolean).pop();
  return (last || 'install failed').slice(0, 300);
}

/**
 * Run one snippet.
 *
 * `runPythonAsync` rather than `runPython`, so top-level `await` works. That is
 * not a nicety: every interesting example that touches the network or an async
 * library needs it, and without it those examples fail with a syntax error.
 */
async function run(id, code, stdin) {
  // `input()` reads from a fixed buffer. Prompting the user mid-run would need
  // a synchronous round trip to the main thread, which is a much bigger machine
  // than this needs; a stdin box next to the editor covers the same ground.
  const lines = (stdin ?? '').split('\n');
  let cursor = 0;
  pyodide.setStdin({
    stdin: () => (cursor < lines.length ? lines[cursor++] : null),
  });

  const started = performance.now();
  try {
    const value = await pyodide.runPythonAsync(code);
    const elapsedMs = performance.now() - started;

    // The value of the last expression, when there is one. A script ending in a
    // bare expression is how people check a value, and dropping it silently
    // makes the runner feel broken.
    let repr = '';
    if (value !== undefined && value !== null) {
      try {
        repr = pyodide.globals.get('repr')(value).toString();
      } catch {
        repr = String(value);
      }
      if (value && typeof value.destroy === 'function') value.destroy();
    }

    send(id, 'result', { repr, elapsedMs, ok: true });
  } catch (error) {
    const elapsedMs = performance.now() - started;
    const text = String(error && error.message ? error.message : error);
    send(id, 'error', {
      message: lastLineOf(text),
      traceback: text,
      elapsedMs,
    });
  }
}

/** The exception line at the end of a Python traceback, which is what to lead with. */
function lastLineOf(traceback) {
  const lines = traceback
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line && !line.startsWith('File "') && !line.startsWith('^')) return line;
  }
  return lines[lines.length - 1] ?? 'Execution failed';
}

/**
 * Clear user globals without restarting the interpreter.
 *
 * A full restart means re-downloading nothing but re-initialising everything,
 * including any installed packages, which takes seconds. Clearing the namespace
 * takes microseconds and is what "reset" actually means to someone who wants a
 * clean slate for their next snippet.
 */
function reset() {
  pyodide.runPython(`
import sys as _sys
_keep = {'__name__', '__doc__', '__package__', '__loader__', '__spec__', '__builtins__'}
for _name in [n for n in list(globals()) if n not in _keep and not n.startswith('_')]:
    del globals()[_name]
del _sys, _keep, _name
`);
}

self.onmessage = async (event) => {
  const { id, type } = event.data ?? {};
  try {
    switch (type) {
      case 'boot': {
        await boot(id, event.data.indexUrl);
        const lock = pyodide._api?.lockfile;
        send(id, 'ready', {
          python: pyodide.version,
          packages: lock && lock.packages ? Object.keys(lock.packages).length : 0,
        });
        break;
      }

      case 'install': {
        await boot(id, event.data.indexUrl);
        const report = await install(id, event.data.packages, event.data.wheels);
        send(id, 'installed', report);
        break;
      }

      case 'run': {
        await boot(id, event.data.indexUrl);
        if (event.data.packages || event.data.wheels) {
          const report = await install(id, event.data.packages, event.data.wheels);
          send(id, 'installed', report);
        }
        send(id, 'status', { phase: 'running', detail: 'Executing' });
        await run(id, event.data.code, event.data.stdin);
        break;
      }

      case 'reset': {
        if (pyodide) reset();
        send(id, 'result', { repr: '', elapsedMs: 0, ok: true, reset: true });
        break;
      }

      default:
        send(id, 'error', { message: `Unknown message type "${type}".`, traceback: '' });
    }
  } catch (error) {
    send(id, 'error', {
      message: String(error && error.message ? error.message : error).slice(0, 500),
      traceback: String(error && error.stack ? error.stack : ''),
    });
  }
};
