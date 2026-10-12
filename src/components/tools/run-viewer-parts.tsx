/**
 * The pieces of the Run Viewer that are not the stage: version controls, the
 * folder's session list, the empty stage, and the figures under a run.
 * State lives in `RunViewer.tsx`; everything here is drawn from props.
 */

import { useMemo, useState } from 'react';
import type { FolderSession } from '../../lib/railtracks/folder';
import type { LoadedSession, Run, SessionStatus } from '../../lib/railtracks/runs';
import { runFigures } from '../../lib/railtracks/runs';
import type {
  RailtracksVersion,
  VersionCatalog,
  VisualizerVersion,
} from '../../lib/railtracks/versions';
import { Badge, Button, Kbd, num, StatRow, type Stat, type Tone } from './ui';

/* ── Formatting ──────────────────────────────────────────────────────── */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : DATE.format(ms);
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 90 * 60) return `${Math.round(s / 60)}m ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)}h ago`;
  if (s < 14 * 86400) return `${Math.round(s / 86400)}d ago`;
  return DATE.format(ms);
}

export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${Math.round(seconds - m * 60)}s`;
}

function cost(value: number | null): string {
  if (value === null) return '–';
  if (value === 0) return '$0';
  return value < 0.01 ? `$${value.toPrecision(2)}` : `$${value.toFixed(3)}`;
}

export const STATUS_TONE: Record<SessionStatus, Tone> = {
  completed: 'ok',
  failed: 'alert',
  running: 'busy',
  unknown: 'idle',
};

const STATUS_DOT: Record<SessionStatus, string> = {
  completed: 'bg-[var(--c-ok)]',
  failed: 'bg-[var(--c-alert)]',
  running: 'bg-[var(--c-accent-fill)] animate-pulse',
  unknown: 'bg-[var(--c-text-faint)]',
};

export function StatusDot({ status }: { status: SessionStatus }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
    />
  );
}

/* ── Version controls ────────────────────────────────────────────────── */

/** `latest:v1`, `latest:v2`, or an exact version. */
export type VisualizerChoice = string;

const SELECT =
  'w-full min-w-0 cursor-pointer rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent)] focus:outline-none disabled:cursor-wait disabled:opacity-60';

const LABEL = 'eyebrow mb-1.5 block text-[10px] text-[var(--c-text-muted)]';

export function VersionControls({
  catalog,
  catalogError,
  choice,
  railtracks,
  resolved,
  onChoice,
  onRailtracks,
}: {
  catalog: VersionCatalog | null;
  catalogError: string | null;
  choice: VisualizerChoice;
  railtracks: string;
  resolved: VisualizerVersion | null;
  onChoice: (choice: VisualizerChoice) => void;
  onRailtracks: (version: string) => void;
}): React.ReactElement {
  const loading = !catalog && !catalogError;
  const v1 = catalog?.visualizers.filter((v) => v.line === 'v1') ?? [];
  const v2 = catalog?.visualizers.filter((v) => v.line === 'v2') ?? [];
  const latest = catalog?.latest;
  const release: RailtracksVersion | undefined = catalog?.railtracks.find(
    (r) => r.version === railtracks,
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <label htmlFor="rv-railtracks" className={LABEL}>
          Railtracks version
        </label>
        <select
          id="rv-railtracks"
          className={SELECT}
          value={railtracks}
          disabled={loading}
          onChange={(e) => onRailtracks(e.target.value)}
        >
          <option value="">
            {loading ? 'Loading from PyPI…' : 'Not sure · pick a visualizer'}
          </option>
          {catalog?.railtracks.map((r) => (
            <option key={r.version} value={r.version}>
              {r.version} · {shortDate(r.released)}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label htmlFor="rv-visualizer" className={LABEL}>
          Visualizer version
        </label>
        <select
          id="rv-visualizer"
          className={SELECT}
          value={choice}
          disabled={loading}
          onChange={(e) => onChoice(e.target.value)}
        >
          {loading ? (
            <option value={choice}>Loading from npm…</option>
          ) : (
            <>
              <optgroup label="Quick pick">
                <option value="latest:v1">
                  V1 · latest{latest?.v1 ? ` (${latest.v1.version})` : ''}
                </option>
                <option value="latest:v2" disabled={!latest?.v2}>
                  V2 · latest{latest?.v2 ? ` (${latest.v2.version})` : ' · not on npm yet'}
                </option>
              </optgroup>
              {v1.length > 0 && (
                <optgroup label="V1 · session runs">
                  {v1.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version} · {shortDate(v.published)}
                    </option>
                  ))}
                </optgroup>
              )}
              {v2.length > 0 && (
                <optgroup label="V2 · event streams">
                  {v2.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version} · {shortDate(v.published)}
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          )}
        </select>
      </div>

      <p className="font-mono text-[10.5px] leading-relaxed text-[var(--c-text-faint)] sm:col-span-2">
        {catalogError ? (
          <span className="text-[var(--c-warn)]">
            Version lists unavailable ({catalogError}). Loading the newest visualizer esm.sh knows
            of.
          </span>
        ) : release && resolved ? (
          <>
            Railtracks {release.version} came out {shortDate(release.released)}. The newest
            visualizer published by then is{' '}
            <span className="text-[var(--c-text)]">{resolved.version}</span>, which is what{' '}
            <code>railtracks viz</code> would have downloaded.
          </>
        ) : resolved ? (
          <>
            Visualizer <span className="text-[var(--c-text)]">{resolved.version}</span>, published{' '}
            {shortDate(resolved.published)}, loaded live from npm. Both lists come from the
            registries on every visit.
          </>
        ) : (
          'Reading the version lists from npm and PyPI.'
        )}
      </p>
    </div>
  );
}

/* ── The folder's sessions ───────────────────────────────────────────── */

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  now,
}: {
  sessions: readonly FolderSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
}): React.ReactElement {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.id.includes(q) || (s.name ?? '').toLowerCase().includes(q) || s.status === q,
    );
  }, [sessions, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--c-line)] p-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${num(sessions.length)} sessions`}
          aria-label="Filter sessions"
          className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Sessions in this folder">
        {shown.map((s) => {
          const active = s.id === selectedId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'true' : undefined}
                className={`group relative block w-full border-b border-[var(--c-line-faint)] px-3 py-2.5 text-left transition-colors ${
                  active ? 'bg-[var(--c-raised)]' : 'hover:bg-[var(--c-raised)]/60'
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[3px] bg-[var(--c-accent-fill)]"
                  />
                )}
                <span className="flex items-center gap-2">
                  <StatusDot status={s.status} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--c-text)]">
                    {s.name ?? 'Unnamed session'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--c-text-faint)]">
                    {timeAgo(s.lastModified, now)}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2 pl-4 font-mono text-[10px] text-[var(--c-text-faint)]">
                  <span className="truncate">{s.id.slice(0, 8)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {s.events && s.session ? 'json + jsonl' : s.events ? 'jsonl' : 'json'}
                  </span>
                  {s.status === 'running' && (
                    <span className="ml-auto text-[var(--c-accent)]">live</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center font-mono text-[11px] text-[var(--c-text-faint)]">
            {sessions.length === 0 ? 'No runs in this folder yet.' : 'Nothing matches.'}
          </li>
        )}
      </ul>
    </div>
  );
}

/* ── Empty stage ─────────────────────────────────────────────────────── */

export function EmptyStage({
  canPickFolder,
  onFile,
  onFolder,
  onSample,
  reopen,
}: {
  canPickFolder: boolean;
  onFile: () => void;
  onFolder: () => void;
  onSample: () => void;
  reopen: { name: string; onClick: () => void } | null;
}): React.ReactElement {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-[var(--c-sunken)] p-6">
      <div className="pointer-events-none absolute inset-4 border border-dashed border-[var(--c-line)]" />
      <div className="relative max-w-md text-center">
        <RunMark />
        <h2 className="display mt-5 text-2xl">Drop a run here</h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--c-text-muted)]">
          A session file from{' '}
          <code className="font-mono text-[12px]">.railtracks/data/sessions</code> or an event
          stream from <code className="font-mono text-[12px]">events</code>. Or open the whole
          folder and watch new runs arrive as your agent writes them.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" onClick={onFile}>
            Open file
          </Button>
          <Button onClick={onFolder}>Open folder</Button>
          {reopen && <Button onClick={reopen.onClick}>Reopen {reopen.name}</Button>}
        </div>
        <p className="mt-5 font-mono text-[11px] text-[var(--c-text-faint)]">
          or paste the JSON with <Kbd>Ctrl</Kbd> <Kbd>V</Kbd> ·{' '}
          <button
            type="button"
            onClick={onSample}
            className="text-[var(--c-accent)] underline underline-offset-4 hover:no-underline"
          >
            try a sample run
          </button>
        </p>
        {!canPickFolder && (
          <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-[var(--c-text-faint)]">
            This browser reads a folder once. Watching it for new runs needs Chrome or Edge.
          </p>
        )}
      </div>
    </div>
  );
}

/** Three nodes on a rail: a call and the two it made. */
function RunMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 96 64" className="mx-auto h-16 w-24" aria-hidden="true">
      <path
        d="M48 18 V30 M48 30 H24 V42 M48 30 H72 V42"
        fill="none"
        stroke="var(--c-text-faint)"
        strokeWidth="1.5"
      />
      <rect
        x="32"
        y="4"
        width="32"
        height="14"
        rx="2"
        fill="var(--c-surface)"
        stroke="var(--c-line-strong)"
      />
      <rect x="32" y="4" width="3" height="14" fill="var(--c-accent-fill)" />
      <rect
        x="8"
        y="42"
        width="32"
        height="14"
        rx="2"
        fill="var(--c-surface)"
        stroke="var(--c-line)"
      />
      <rect
        x="56"
        y="42"
        width="32"
        height="14"
        rx="2"
        fill="var(--c-surface)"
        stroke="var(--c-line)"
      />
    </svg>
  );
}

/* ── Figures under the stage ─────────────────────────────────────────── */

export function RunReadout({ run }: { run: Run | undefined }): React.ReactElement | null {
  if (!run) return null;
  const f = runFigures(run);
  const status = run.status.toLowerCase();
  const stats: Stat[] = [
    {
      label: 'Status',
      value: run.status,
      tone: status === 'failed' ? 'alert' : status === 'completed' ? 'ok' : 'accent',
    },
    { label: 'Duration', value: duration(f.duration) },
    { label: 'Nodes', value: num(f.nodes), hint: `${num(run.steps.length)} steps` },
    { label: 'Model calls', value: num(f.llmCalls) },
    {
      label: 'Tokens',
      value: num(f.inputTokens + f.outputTokens),
      hint: `${num(f.inputTokens)} in · ${num(f.outputTokens)} out`,
    },
    { label: 'Cost', value: cost(f.cost) },
  ];
  return <StatRow stats={stats} columns={6} />;
}

export function SourceBadge({ session }: { session: LoadedSession }): React.ReactElement {
  return (
    <Badge tone="idle">
      {session.source === 'events' ? 'from event stream' : 'from session file'}
    </Badge>
  );
}
