/**
 * The in-browser Python runner.
 *
 * Mounted twice over: once on the tools page with every preset, and once per
 * project page with just that project's package. `presets` is the prop that
 * decides which, so a project page is one line and no new component.
 *
 * The interpreter is not started until someone asks for it. A 12 MB download on
 * page load, for a demo most visitors will scroll past, is not a trade worth
 * making, and it would show up in every performance measurement of the page.
 *
 * @see src/lib/py-runtime.ts for the worker host
 * @see src/data/py-presets.ts for the environments
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PY_PRESETS, findPreset, type PyPreset } from '../../data/py-presets';
import {
  PYODIDE_VERSION,
  PythonRuntime,
  type InstallReport,
  type Phase,
  type RunFailure,
} from '../../lib/py-runtime';
import { CodeEditor, errorLineFrom } from './CodeEditor';
import {
  Badge,
  Button,
  CopyButton,
  DownloadButton,
  Kbd,
  Panel,
  PasteButton,
  Segmented,
  Toggle,
  Toolbar,
  num,
} from './ui';

/** Hard stop for one run. Long enough for a real pipeline, short enough to be a limit. */
const RUN_TIMEOUT_MS = 60_000;

/** Output ring size. A print-in-a-loop script must not grow the DOM without bound. */
const MAX_LINES = 2_000;

interface Line {
  readonly id: number;
  readonly stream: 'stdout' | 'stderr' | 'system' | 'result';
  readonly text: string;
}

export interface PyRunnerProps {
  /** Environments to offer. Defaults to the whole registry. */
  presets?: readonly PyPreset[];
  /** Which one starts selected. */
  initial?: string;
  /** Editor height in rows. */
  rows?: number;
}

export default function PyRunner({
  presets = PY_PRESETS,
  initial,
  rows = 18,
}: PyRunnerProps): React.ReactElement {
  const available = presets.length > 0 ? presets : PY_PRESETS;
  const first = findPreset(initial ?? '') ?? available[0]!;

  const [presetId, setPresetId] = useState(first.id);
  const preset = useMemo(
    () => available.find((entry) => entry.id === presetId) ?? first,
    [available, presetId, first],
  );

  const [sampleId, setSampleId] = useState(first.samples[0]?.id ?? '');
  const sample = useMemo(
    () => preset.samples.find((entry) => entry.id === sampleId) ?? preset.samples[0],
    [preset, sampleId],
  );

  const [code, setCode] = useState(first.samples[0]?.code ?? '');
  const [stdin, setStdin] = useState(first.samples[0]?.stdin ?? '');
  const [showStdin, setShowStdin] = useState(Boolean(first.samples[0]?.stdin));
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [install, setInstall] = useState<InstallReport | null>(null);
  const [info, setInfo] = useState<{ python: string; packages: number } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const runtime = useRef<PythonRuntime | null>(null);
  const lineId = useRef(0);
  const output = useRef<HTMLDivElement>(null);

  /* ── Output ─────────────────────────────────────────────────────── */

  const push = useCallback((stream: Line['stream'], text: string) => {
    if (text === '') return;
    setLines((current) => {
      const next = [...current, { id: (lineId.current += 1), stream, text }];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    if (!autoScroll || !output.current) return;
    output.current.scrollTop = output.current.scrollHeight;
  }, [lines, autoScroll]);

  /* ── Runtime lifecycle ──────────────────────────────────────────── */

  const ensureRuntime = useCallback((): PythonRuntime => {
    if (runtime.current?.alive) return runtime.current;
    const instance = new PythonRuntime({
      onPhase: (next, text) => {
        setPhase(next);
        setDetail(text);
      },
      onOutput: (chunk) => push(chunk.stream, chunk.text),
      onInstalled: setInstall,
      onReady: setInfo,
    });
    runtime.current = instance;
    return instance;
  }, [push]);

  // The worker owns a WebAssembly heap measured in tens of megabytes. Leaving it
  // running after the island unmounts leaks all of it for the life of the tab.
  useEffect(() => () => runtime.current?.dispose(), []);

  /* ── Actions ────────────────────────────────────────────────────── */

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setElapsed(null);
    setInstall(null);

    const instance = ensureRuntime();
    const cold = !info;
    if (cold) {
      push('system', `Starting Python ${PYODIDE_VERSION}. First run downloads the runtime.\n`);
    }

    try {
      const result = await instance.run({
        code,
        stdin,
        packages: preset.packages,
        wheels: preset.wheels,
        timeoutMs: RUN_TIMEOUT_MS,
      });
      setElapsed(result.elapsedMs);
      if (result.repr) push('result', `${result.repr}\n`);
    } catch (error) {
      const thrown = error as RunFailure;
      setFailure(thrown);
      setElapsed(thrown.elapsedMs);
      if (thrown.message?.includes('EOFError') || thrown.traceback?.includes('EOFError')) {
        setShowStdin(true);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, code, ensureRuntime, info, preset, push, stdin]);

  const stop = useCallback(() => {
    runtime.current?.stop();
    setBusy(false);
    setInfo(null);
    setPhase('idle');
    push('system', 'Interpreter stopped. The next run starts a fresh one.\n');
  }, [push]);

  const clearOutput = useCallback(() => {
    setLines([]);
    setFailure(null);
    setElapsed(null);
    setInstall(null);
  }, []);

  const choosePreset = useCallback(
    (id: string) => {
      const next = available.find((entry) => entry.id === id);
      if (!next) return;
      setPresetId(id);
      const firstSample = next.samples[0];
      setSampleId(firstSample?.id ?? '');
      setCode(firstSample?.code ?? '');
      setStdin(firstSample?.stdin ?? '');
      setShowStdin(Boolean(firstSample?.stdin));
      clearOutput();
      // Package sets differ, so the interpreter has to go: installing preset B's
      // packages on top of preset A's is how you get an environment nobody can
      // reproduce locally.
      if (runtime.current?.alive) {
        runtime.current.stop();
        setInfo(null);
        setPhase('idle');
      }
    },
    [available, clearOutput],
  );

  const chooseSample = useCallback(
    (id: string) => {
      const next = preset.samples.find((entry) => entry.id === id);
      if (!next) return;
      setSampleId(id);
      setCode(next.code);
      setStdin(next.stdin ?? '');
      setShowStdin(Boolean(next.stdin));
      setFailure(null);
    },
    [preset],
  );

  /* ── Derived ────────────────────────────────────────────────────── */

  const errorLine = failure ? errorLineFrom(failure.traceback) : undefined;
  const transcript = useMemo(() => lines.map((line) => line.text).join(''), [lines]);
  const busyLabel =
    phase === 'downloading'
      ? 'Downloading'
      : phase === 'starting'
        ? 'Starting'
        : phase === 'installing'
          ? 'Installing'
          : 'Running';

  return (
    <div className="space-y-4">
      {/* ── Environment ─────────────────────────────────────────── */}
      <Panel
        title="Environment"
        aside={
          <div className="flex items-center gap-2">
            {busy ? (
              <Badge tone="busy">{busyLabel}</Badge>
            ) : info ? (
              <Badge tone="ok">Python {info.python}</Badge>
            ) : (
              <Badge tone="idle">Not started</Badge>
            )}
          </div>
        }
      >
        <div className="space-y-3 p-4">
          {available.length > 1 && (
            <Segmented
              label="Environment"
              value={presetId}
              onChange={choosePreset}
              options={available.map((entry) => ({
                value: entry.id,
                label: entry.name,
                title: entry.blurb,
              }))}
            />
          )}

          <p className="text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">{preset.blurb}</p>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-[var(--c-text-faint)]">
            <div className="flex gap-1.5">
              <dt>download</dt>
              <dd className="text-[var(--c-text-muted)]">{preset.weight}</dd>
            </div>
            {preset.packages.length > 0 && (
              <div className="flex gap-1.5">
                <dt>packages</dt>
                <dd className="text-[var(--c-text-muted)]">{preset.packages.join(' · ')}</dd>
              </div>
            )}
            {info && (
              <div className="flex gap-1.5">
                <dt>prebuilt available</dt>
                <dd className="text-[var(--c-text-muted)]">{num(info.packages)}</dd>
              </div>
            )}
          </dl>

          {preset.blockers && preset.blockers.length > 0 && <Blockers preset={preset} />}
        </div>
      </Panel>

      {/* ── Editor ──────────────────────────────────────────────── */}
      <Panel
        title="Source"
        cornerTicks
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            {preset.samples.length > 1 && (
              <Segmented
                label="Sample"
                value={sampleId}
                onChange={chooseSample}
                options={preset.samples.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  title: entry.note,
                }))}
              />
            )}
            <PasteButton onPaste={setCode} label="Paste code" />
            <CopyButton text={code} label="Copy" />
            <DownloadButton text={code} filename={`${preset.id}-${sampleId || 'snippet'}.py`} />
          </div>
        }
      >
        <CodeEditor value={code} onChange={setCode} onRun={run} rows={rows} errorLine={errorLine} />

        {sample && (
          <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2 text-[11.5px] text-[var(--c-text-muted)]">
            {sample.note}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--c-line)] px-4 py-2.5">
          <Toolbar>
            <Button onClick={run} variant="primary" disabled={busy || code.trim() === ''}>
              {busy ? busyLabel : 'Run'}
            </Button>
            <Button onClick={stop} disabled={!busy && !info}>
              Stop
            </Button>
            <Button onClick={clearOutput} disabled={lines.length === 0}>
              Clear output
            </Button>
            <Toggle
              id="py-stdin"
              label="stdin"
              checked={showStdin}
              onChange={setShowStdin}
              title="Provide lines for input() to read"
            />
          </Toolbar>
          <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
            <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to run · <Kbd>Tab</Kbd> indents the selection
          </span>
        </div>

        {showStdin && (
          <div className="border-t border-[var(--c-line)]">
            <textarea
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="One line per input() call. Reaching the end returns None, which raises EOFError."
              className="w-full resize-y border-0 bg-[var(--c-sunken)] p-3.5 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:outline-none"
            />
          </div>
        )}
      </Panel>

      {/* ── Output ──────────────────────────────────────────────── */}
      <Panel
        title="Output"
        aside={
          <div className="flex items-center gap-2">
            {elapsed !== null && (
              <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
                {elapsed < 1000 ? `${Math.round(elapsed)} ms` : `${(elapsed / 1000).toFixed(2)} s`}
              </span>
            )}
            <Toggle id="py-follow" label="follow" checked={autoScroll} onChange={setAutoScroll} />
            <CopyButton text={transcript} label="Copy output" />
          </div>
        }
      >
        {install && (install.installed.length > 0 || install.failed.length > 0) && (
          <InstallSummary report={install} />
        )}

        <div
          ref={output}
          className="max-h-[26rem] min-h-[7rem] overflow-auto bg-[var(--c-sunken)] p-3.5 font-mono text-[12px] leading-relaxed"
        >
          {lines.length === 0 && !failure && (
            <p className="text-[var(--c-text-faint)]">
              {busy ? `${detail}…` : 'Nothing yet. Run the sample above.'}
            </p>
          )}

          {lines.map((line) => (
            <span
              key={line.id}
              className={
                line.stream === 'stderr'
                  ? 'whitespace-pre-wrap text-[var(--c-alert)]'
                  : line.stream === 'system'
                    ? 'whitespace-pre-wrap text-[var(--c-text-faint)] italic'
                    : line.stream === 'result'
                      ? 'whitespace-pre-wrap text-[var(--c-accent)]'
                      : 'whitespace-pre-wrap text-[var(--c-text)]'
              }
            >
              {line.text}
            </span>
          ))}

          {busy && detail && (
            <span className="block text-[var(--c-text-faint)] italic">{detail}…</span>
          )}
        </div>

        {failure && <Failure failure={failure} />}
      </Panel>
    </div>
  );
}

/* ── Blockers ─────────────────────────────────────────────────────────── */

/**
 * The known-unsatisfiable notice.
 *
 * Shown before the attempt rather than after, because the attempt takes most of
 * a minute and ends in a traceback that reads like a bug in the framework. It
 * does not hide the Run button: the list of what has a WebAssembly build changes
 * without notice, and a hardcoded refusal would outlive the reason for it.
 */
function Blockers({ preset }: { preset: PyPreset }): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-sm border border-[var(--c-warn)] bg-[var(--c-raised)] p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-[var(--c-text)]">
          <span className="font-mono text-[11px] tracking-wide text-[var(--c-warn)] uppercase">
            Will not install
          </span>
          <br />
          {preset.blockers?.length} of this package&rsquo;s requirements have no WebAssembly build.
          Running it here will report exactly where it stops. Nothing can be compiled inside a
          browser tab, so this is a fact about published wheels rather than about the code.
        </p>
        <Button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</Button>
      </div>

      {open && (
        <dl className="mt-3 space-y-2 border-t border-[var(--c-line)] pt-3">
          {preset.blockers?.map((blocker) => (
            <div key={blocker.spec}>
              <dt className="font-mono text-[11.5px] text-[var(--c-text)]">{blocker.spec}</dt>
              <dd className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
                {blocker.reason}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {preset.localCommand && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--c-line)] pt-3">
          <span className="text-[11px] text-[var(--c-text-faint)]">Locally:</span>
          <code className="rounded-sm bg-[var(--c-sunken)] px-2 py-1 font-mono text-[11.5px] text-[var(--c-text)]">
            {preset.localCommand}
          </code>
          <CopyButton text={preset.localCommand} />
        </div>
      )}
    </div>
  );
}

/* ── Install summary ──────────────────────────────────────────────────── */

function InstallSummary({ report }: { report: InstallReport }): React.ReactElement {
  return (
    <div className="border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5">
      {report.installed.length > 0 && (
        <p className="font-mono text-[11px] text-[var(--c-text-faint)]">
          <span className="text-[var(--c-ok)]">installed</span> {report.installed.join(' · ')}
        </p>
      )}
      {report.failed.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {report.failed.map((failure) => (
            <div key={failure.spec} className="text-[11.5px] leading-relaxed">
              <dt className="inline font-mono text-[var(--c-alert)]">{failure.spec}</dt>
              <dd className="inline text-[var(--c-text-muted)]"> {failure.reason}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ── Failure ──────────────────────────────────────────────────────────── */

/**
 * A failed run.
 *
 * The exception line leads and the traceback is behind a toggle. That order
 * matters: the last line of a Python traceback is the answer, and the twelve
 * frames above it are almost always Pyodide's own machinery.
 */
function Failure({ failure }: { failure: RunFailure }): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-[var(--c-alert)] bg-[var(--c-alert-soft)]">
      <div className="flex items-start justify-between gap-3 px-4 py-2.5">
        <p className="font-mono text-[12px] leading-relaxed text-[var(--c-alert)]">
          {failure.message}
        </p>
        {failure.traceback && (
          <div className="flex shrink-0 items-center gap-2">
            <CopyButton text={failure.traceback} label="Copy traceback" />
            <Button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Traceback'}</Button>
          </div>
        )}
      </div>
      {open && failure.traceback && (
        <pre className="max-h-64 overflow-auto border-t border-[var(--c-line)] bg-[var(--c-sunken)] p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--c-text-muted)]">
          {failure.traceback}
        </pre>
      )}
    </div>
  );
}
