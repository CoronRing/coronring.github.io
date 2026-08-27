import { useDeferredValue, useMemo, useState } from 'react';
import { diffText, toUnifiedPatch, type DiffOptions, type Row, type Segment } from '../../lib/diff';
import {
  Badge,
  Button,
  CopyButton,
  ErrorNote,
  num,
  Panel,
  Segmented,
  StatRow,
  Tabs,
  TextArea,
  Toggle,
  Toolbar,
} from './ui';
import SemanticCompare from './SemanticCompare';

/**
 * TextDiff — fast, in-tab lexical and semantic diffing.
 *
 * Separated into clean workspace tabs:
 * 1. "Word & Line Diff" — immediate side-by-side comparison with word refinement.
 * 2. "Semantic Analysis" — deep embedding & meaning comparison without clutter.
 */

const RENDER_LIMIT = 4_000;

type Mode = 'lexical' | 'semantic';
type View = 'split' | 'unified' | 'inline';

const VIEWS: ReadonlyArray<{ value: View; label: string; title: string }> = [
  {
    value: 'split',
    label: 'Split (Side-by-side)',
    title: 'Side by side with synchronized gutters',
  },
  { value: 'unified', label: 'Unified', title: 'Single column in patch format' },
  { value: 'inline', label: 'Inline', title: 'Word-level changes in single flow' },
];

const SAMPLE_A = `You are a careful research assistant.

Answer only from the provided context. If the context does not
contain the answer, say so plainly rather than guessing.

Keep responses under 200 words.`;

const SAMPLE_B = `You are a careful research assistant.

Answer only from the retrieved context. If the context does not
contain the answer, say "I don't know" rather than guessing.
Cite the chunk id for every claim.

Keep responses under 150 words.`;

export default function TextDiff(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Mode>('lexical');

  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  const [nameA, setNameA] = useState<string>('original');
  const [nameB, setNameB] = useState<string>('revised');

  const [view, setView] = useState<View>('split');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState<boolean>(false);
  const [ignoreCase, setIgnoreCase] = useState<boolean>(false);
  const [onlyChanges, setOnlyChanges] = useState<boolean>(false);

  const deferredA = useDeferredValue(a);
  const deferredB = useDeferredValue(b);
  const stale = deferredA !== a || deferredB !== b;

  const options: DiffOptions = useMemo(
    () => ({ ignoreWhitespace, ignoreCase, context: 3 }),
    [ignoreWhitespace, ignoreCase],
  );

  const result = useMemo(
    () => diffText(deferredA, deferredB, options),
    [deferredA, deferredB, options],
  );

  const { stats } = result;
  const empty = a.length === 0 && b.length === 0;

  const changePercent = (stats.changeRatio * 100).toFixed(1);
  const similarityScore = (stats.similarity * 100).toFixed(1);

  const statTiles = [
    {
      label: 'similarity',
      value: `${similarityScore}%`,
      hint: `${changePercent}% changed`,
      tone:
        stats.similarity > 0.9
          ? ('ok' as const)
          : stats.similarity > 0.5
            ? ('warn' as const)
            : ('alert' as const),
    },
    { label: 'added', value: `+${num(stats.linesAdded)}`, hint: 'lines', tone: 'ok' as const },
    {
      label: 'removed',
      value: `−${num(stats.linesRemoved)}`,
      hint: 'lines',
      tone: 'alert' as const,
    },
    { label: 'modified', value: num(stats.linesModified), hint: 'lines', tone: 'warn' as const },
    { label: 'unchanged', value: num(stats.linesUnchanged), hint: 'lines' },
    {
      label: 'characters',
      value: `${num(stats.charsA)} → ${num(stats.charsB)}`,
      hint: `${stats.charsB >= stats.charsA ? '+' : '−'}${num(Math.abs(stats.charsB - stats.charsA))}`,
    },
  ];

  const rows = useMemo(
    () => (onlyChanges ? result.rows.filter((r) => r.kind !== 'equal') : result.rows),
    [result.rows, onlyChanges],
  );
  const shown = rows.slice(0, RENDER_LIMIT);
  const hidden = rows.length - shown.length;

  const swap = (): void => {
    setA(b);
    setB(a);
    setNameA(nameB);
    setNameB(nameA);
  };

  const loadSample = (): void => {
    setA(SAMPLE_A);
    setB(SAMPLE_B);
  };

  return (
    <div className="space-y-6">
      {/* ── Mode Selection Tabs ────────────────────────────────────────── */}
      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          {
            id: 'lexical',
            label: 'Word & Line Diff',
            badge: !empty
              ? result.identical
                ? 'identical'
                : `${changePercent}% changed`
              : undefined,
            badgeTone: result.identical ? 'ok' : 'busy',
          },
          {
            id: 'semantic',
            label: 'Semantic Analysis',
            badge: !empty ? `${(stats.similarity * 100).toFixed(0)}% lexical` : undefined,
            badgeTone: 'idle',
          },
        ]}
      />

      {/* ── Input Panes (Always visible at top) ───────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Pane
          side="A"
          name={nameA}
          onName={setNameA}
          value={a}
          onChange={setA}
          onSample={() => setA(SAMPLE_A)}
        />
        <Pane
          side="B"
          name={nameB}
          onName={setNameB}
          value={b}
          onChange={setB}
          onSample={() => setB(SAMPLE_B)}
        />
      </div>

      {/* ── Tab 1: Lexical Diff Mode ──────────────────────────────────── */}
      {activeTab === 'lexical' && (
        <div className="space-y-5">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] px-4 py-2.5 shadow-xs">
            <div className="flex flex-wrap items-center gap-4">
              <Segmented label="View" value={view} options={VIEWS} onChange={setView} />

              <div className="flex items-center gap-3 border-l border-[var(--c-line)] pl-4">
                <Toggle
                  id="diff-changes-only"
                  label="Changes only"
                  checked={onlyChanges}
                  onChange={setOnlyChanges}
                  title="Hide unchanged equal lines"
                />
                <Toggle
                  id="diff-ignore-ws"
                  label="Ignore whitespace"
                  checked={ignoreWhitespace}
                  onChange={setIgnoreWhitespace}
                />
                <Toggle
                  id="diff-ignore-case"
                  label="Ignore case"
                  checked={ignoreCase}
                  onChange={setIgnoreCase}
                />
              </div>
            </div>

            <Toolbar>
              {stale && <Badge tone="busy">Computing</Badge>}
              <Button onClick={swap} disabled={empty} title="Swap left and right texts">
                Swap ⇄
              </Button>
              <CopyButton text={toUnifiedPatch(result, nameA, nameB)} label="Copy patch" />
              {empty && <Button onClick={loadSample}>Load sample</Button>}
              <Button
                variant="quiet"
                onClick={() => {
                  setA('');
                  setB('');
                }}
                disabled={empty}
              >
                Clear
              </Button>
            </Toolbar>
          </div>

          {/* Verdict and Proportion Bar */}
          <Panel
            title="Summary"
            aside={
              empty ? (
                <Badge>Waiting for text</Badge>
              ) : result.identical ? (
                <Badge tone="ok">✓ Byte Identical</Badge>
              ) : stats.similarity >= 0.999 ? (
                <Badge tone="warn">Whitespace / case only</Badge>
              ) : (
                <Badge tone="warn">{changePercent}% changed</Badge>
              )
            }
          >
            <StatRow stats={statTiles} columns={6} />
            <ChangeBar
              added={stats.linesAdded}
              removed={stats.linesRemoved}
              modified={stats.linesModified}
              unchanged={stats.linesUnchanged}
            />
          </Panel>

          {result.truncated && (
            <ErrorNote>
              Minimal alignment stopped at 2,000 edits. The divergent region is displayed as a
              wholesale replacement. Line counts and similarity figure remain accurate.
            </ErrorNote>
          )}

          {/* Diff Output Table */}
          {!empty && (
            <Panel
              title={
                view === 'unified'
                  ? `Unified Patch · ${result.hunks.length} hunk${result.hunks.length === 1 ? '' : 's'}`
                  : `${nameA} ➔ ${nameB}`
              }
              cornerTicks
              aside={
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
                    {num(rows.length)} rows
                    {hidden > 0 && ` (showing ${num(RENDER_LIMIT)})`}
                  </span>
                </div>
              }
            >
              {result.identical ? (
                <p className="px-4 py-12 text-center font-mono text-xs text-[var(--c-text-faint)]">
                  Both inputs are byte-identical.
                </p>
              ) : view === 'unified' ? (
                <UnifiedView result={result} />
              ) : view === 'split' ? (
                <SplitView rows={shown} />
              ) : (
                <InlineView rows={shown} />
              )}

              {hidden > 0 && (
                <p className="border-t border-[var(--c-line)] px-4 py-2 font-mono text-[10.5px] text-[var(--c-text-faint)]">
                  {num(hidden)} further rows hidden. Turn on “Changes only” or copy patch.
                </p>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* ── Tab 2: Semantic Analysis Mode ─────────────────────────────── */}
      {activeTab === 'semantic' && (
        <SemanticCompare a={a} b={b} nameA={nameA} nameB={nameB} lexical={stats.similarity} />
      )}
    </div>
  );
}

/* ── Input Pane ───────────────────────────────────────────────────────── */

function Pane({
  side,
  name,
  onName,
  value,
  onChange,
  onSample,
}: {
  side: 'A' | 'B';
  name: string;
  onName: (value: string) => void;
  value: string;
  onChange: (value: string) => void;
  onSample: () => void;
}): React.ReactElement {
  const lines = value === '' ? 0 : value.split('\n').length;

  return (
    <Panel
      title={`Side ${side} · ${num(lines)} lines`}
      aside={
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            aria-label={`Label for side ${side}`}
            title="Label for this revision"
            className="w-24 rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
          />
          <Button onClick={onSample} variant="quiet">
            Sample
          </Button>
          <label className="cursor-pointer rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]">
            File
            <input
              type="file"
              accept="text/*,.md,.json,.yaml,.yml,.csv,.log,.txt,.py,.ts,.js,.html,.css"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onName(file.name);
                void file.text().then(onChange);
              }}
            />
          </label>
        </div>
      }
    >
      <TextArea
        id={`diff-pane-${side}`}
        value={value}
        onChange={onChange}
        rows={10}
        placeholder={`Paste side ${side}, or drop a text file here.`}
      />
    </Panel>
  );
}

/* ── Proportion Bar ───────────────────────────────────────────────────── */

function ChangeBar({
  added,
  removed,
  modified,
  unchanged,
}: {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}): React.ReactElement | null {
  const total = added + removed + modified + unchanged;
  if (total === 0) return null;

  const parts: ReadonlyArray<[string, number, string]> = [
    ['unchanged', unchanged, 'var(--c-line)'],
    ['modified', modified, 'var(--c-warn)'],
    ['added', added, 'var(--c-ok)'],
    ['removed', removed, 'var(--c-alert)'],
  ];

  return (
    <div className="flex h-1.5 w-full overflow-hidden border-t border-[var(--c-line)]">
      {parts.map(([label, count, color]) =>
        count === 0 ? null : (
          <span
            key={label}
            title={`${label}: ${count}`}
            style={{ width: `${(count / total) * 100}%`, background: color }}
          />
        ),
      )}
    </div>
  );
}

/* ── Split / Unified / Inline Views ──────────────────────────────────── */

const ROW_BG: Record<Row['kind'], string> = {
  equal: 'transparent',
  replace: 'color-mix(in srgb, var(--c-warn) 12%, transparent)',
  delete: 'color-mix(in srgb, var(--c-alert) 14%, transparent)',
  insert: 'color-mix(in srgb, var(--c-ok) 14%, transparent)',
};

function Segments({ segments }: { segments: readonly Segment[] }): React.ReactElement {
  return (
    <>
      {segments.map((segment, i) =>
        segment.op === 'equal' ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <mark
            key={i}
            className="rounded-xs px-[2px] font-semibold"
            style={{
              background:
                segment.op === 'insert'
                  ? 'color-mix(in srgb, var(--c-ok) 38%, transparent)'
                  : 'color-mix(in srgb, var(--c-alert) 38%, transparent)',
              color: 'var(--c-text)',
            }}
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}

function Gutter({ n }: { n?: number }): React.ReactElement {
  return (
    <td className="w-10 shrink-0 border-r border-[var(--c-line)] bg-[var(--c-raised)] px-2 py-0.5 text-right align-top font-mono text-[10px] text-[var(--c-text-faint)] select-none">
      {n === undefined ? '' : n + 1}
    </td>
  );
}

const CELL =
  'px-2.5 py-0.5 align-top font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words';

function SplitView({ rows }: { rows: readonly Row[] }): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-10" />
          <col className="w-[calc(50%-2.5rem)]" />
          <col className="w-10" />
          <col className="w-[calc(50%-2.5rem)]" />
        </colgroup>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: ROW_BG[row.kind] }}>
              <Gutter n={row.left?.a} />
              <td className={`${CELL} border-r border-[var(--c-line)]`}>
                {row.leftSegments ? <Segments segments={row.leftSegments} /> : row.left?.text}
              </td>
              <Gutter n={row.right?.b} />
              <td className={CELL}>
                {row.rightSegments ? <Segments segments={row.rightSegments} /> : row.right?.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineView({ rows }: { rows: readonly Row[] }): React.ReactElement {
  return (
    <div className="px-4 py-3 font-mono text-[12px] leading-[1.7]">
      {rows.map((row, i) => {
        if (row.kind === 'equal') {
          return (
            <p key={i} className="whitespace-pre-wrap text-[var(--c-text-muted)]">
              {row.left?.text || ' '}
            </p>
          );
        }
        if (row.kind === 'replace') {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {row.leftSegments
                ?.filter((s) => s.op !== 'equal')
                .map((s, j) => (
                  <del
                    key={`d${j}`}
                    className="mr-1 rounded-xs px-[2px] no-underline opacity-70"
                    style={{ background: 'color-mix(in srgb, var(--c-alert) 26%, transparent)' }}
                  >
                    {s.text}
                  </del>
                ))}
              {row.rightSegments && <Segments segments={row.rightSegments} />}
            </p>
          );
        }
        const deleted = row.kind === 'delete';
        return (
          <p
            key={i}
            className="rounded-xs px-1 whitespace-pre-wrap"
            style={{
              background: deleted
                ? 'color-mix(in srgb, var(--c-alert) 14%, transparent)'
                : 'color-mix(in srgb, var(--c-ok) 14%, transparent)',
            }}
          >
            <span className="mr-2 font-bold text-[var(--c-text-faint)]">{deleted ? '−' : '+'}</span>
            {(deleted ? row.left?.text : row.right?.text) || ' '}
          </p>
        );
      })}
    </div>
  );
}

function UnifiedView({ result }: { result: ReturnType<typeof diffText> }): React.ReactElement {
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-[1.6]">
      {result.hunks.map((hunk, h) => (
        <div key={h} className={h > 0 ? 'border-t border-[var(--c-line)]' : undefined}>
          <div className="bg-[var(--c-sunken)] px-4 py-1 font-mono text-[11px] font-semibold text-[var(--c-accent)]">
            @@ -{hunk.aStart},{hunk.aCount} +{hunk.bStart},{hunk.bCount} @@
          </div>
          {hunk.changes.map((change, i) => (
            <div
              key={i}
              className="flex gap-3 px-4 whitespace-pre-wrap"
              style={{
                background:
                  change.op === 'insert'
                    ? 'color-mix(in srgb, var(--c-ok) 12%, transparent)'
                    : change.op === 'delete'
                      ? 'color-mix(in srgb, var(--c-alert) 12%, transparent)'
                      : 'transparent',
              }}
            >
              <span className="w-3 shrink-0 font-bold text-[var(--c-text-faint)] select-none">
                {change.op === 'insert' ? '+' : change.op === 'delete' ? '−' : ' '}
              </span>
              <span className="break-words">{change.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
