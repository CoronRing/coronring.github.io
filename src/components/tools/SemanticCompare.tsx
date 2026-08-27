/**
 * The semantic half of the diff.
 *
 * A lexical diff answers "what characters changed". This answers "did the
 * meaning move", and the interesting cases are exactly where the two disagree:
 * a paraphrase scores near zero lexically and near one semantically, and a
 * negation does the reverse.
 *
 * Two engines. Local TF-IDF runs in the tab and is lexical by construction.
 * Remote sends the text to the site's backend to be embedded by a model that
 * does understand paraphrase. Local is the default, remote is opt-in per click,
 * and the button says what leaves the page before it leaves.
 *
 * @see src/lib/semantic.ts for the metrics and the alignment
 * @see src/lib/embed-api.ts for the client
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { EmbedError, embedTexts, probeCapability, type EmbedCapability } from '../../lib/embed-api';
import {
  DEFAULT_LOCAL,
  METRICS,
  alignSegments,
  compareDense,
  compareSparse,
  disagreement,
  interpret,
  localVectors,
  segment,
  type Alignment,
  type AlignmentKind,
  type Metric,
  type Segment,
  type SegmentUnit,
} from '../../lib/semantic';
import {
  Badge,
  Button,
  CopyButton,
  ErrorNote,
  Field,
  Panel,
  Segmented,
  Select,
  StatRow,
  Toggle,
  Toolbar,
  num,
} from './ui';

type Engine = 'local' | 'remote';

export interface SemanticCompareProps {
  a: string;
  b: string;
  /** Labels from the diff panes, so both halves of the page agree on names. */
  nameA?: string;
  nameB?: string;
  /** The lexical similarity already computed, for the comparison row. */
  lexical: number;
}

export default function SemanticCompare({
  a,
  b,
  nameA = 'original',
  nameB = 'revised',
  lexical,
}: SemanticCompareProps): React.ReactElement {
  const [engine, setEngine] = useState<Engine>('local');
  const [metric, setMetric] = useState<Metric>('cosine');
  const [unit, setUnit] = useState<SegmentUnit>('paragraph');
  const [breakdown, setBreakdown] = useState(true);

  const [capability, setCapability] = useState<EmbedCapability | null | undefined>(undefined);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);

  const deferredA = useDeferredValue(a);
  const deferredB = useDeferredValue(b);
  const empty = deferredA.trim() === '' || deferredB.trim() === '';

  /* ── Capability probe ───────────────────────────────────────────── */

  // Probed once, lazily, so the page makes no request unless the panel is on
  // screen. `undefined` means not yet asked, `null` means asked and unavailable.
  useEffect(() => {
    const controller = new AbortController();
    void probeCapability(controller.signal).then(setCapability);
    return () => controller.abort();
  }, []);

  /* ── Local engine ───────────────────────────────────────────────── */

  const local = useMemo(() => {
    if (empty) return null;
    const vectors = localVectors(deferredA, deferredB, DEFAULT_LOCAL);
    return {
      score: compareSparse(vectors.a, vectors.b, metric),
      cosine: compareSparse(vectors.a, vectors.b, 'cosine'),
      terms: { a: vectors.a.size, b: vectors.b.size },
    };
  }, [deferredA, deferredB, empty, metric]);

  const segments = useMemo(
    () => ({ a: segment(deferredA, unit), b: segment(deferredB, unit) }),
    [deferredA, deferredB, unit],
  );

  const localAlignment = useMemo(() => {
    if (empty || !breakdown || segments.a.length === 0 || segments.b.length === 0) return null;
    // Vectors are built once per pair rather than once per comparison: the
    // alignment scores every left segment against every right one, so a naive
    // implementation recomputes the same TF-IDF vector n times.
    const cache = new Map<string, ReturnType<typeof localVectors>>();
    const score = (left: Segment, right: Segment): number => {
      const key = `${left.index}:${right.index}`;
      let vectors = cache.get(key);
      if (!vectors) {
        vectors = localVectors(left.text, right.text, DEFAULT_LOCAL);
        cache.set(key, vectors);
      }
      return compareSparse(vectors.a, vectors.b, 'cosine');
    };
    return alignSegments(segments.a, segments.b, score, { matchFloor: 0.97, rewriteFloor: 0.25 });
  }, [breakdown, empty, segments]);

  /* ── Remote engine ──────────────────────────────────────────────── */

  const runRemote = useCallback(async () => {
    if (empty) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setBusy(true);
    setError(null);

    const limit = capability?.maxTexts ?? 32;
    // Whole documents first so the headline score is always available, then as
    // many segments as the budget allows. A partial breakdown is worth more than
    // no breakdown, and the UI says how many were covered.
    const texts: string[] = [deferredA, deferredB];

    // Segments are embedded individually and paired locally afterwards. The
    // alternative, embedding every candidate pair, is quadratic in requests for
    // an answer a cosine over n vectors already gives.
    const perSide = breakdown ? Math.floor(Math.max(0, limit - 2) / 2) : 0;
    if (perSide > 0) {
      for (const left of segments.a.slice(0, perSide)) texts.push(left.text);
      for (const right of segments.b.slice(0, perSide)) texts.push(right.text);
    }

    try {
      const result = await embedTexts(texts, { signal: controller.signal });
      const [vectorA, vectorB] = result.vectors;
      if (!vectorA || !vectorB) throw new EmbedError('The service returned no vectors.');

      const leftVectors = result.vectors.slice(2, 2 + Math.min(perSide, segments.a.length));
      const rightVectors = result.vectors.slice(2 + leftVectors.length);

      setRemote({
        vectorA,
        vectorB,
        model: result.model,
        dimensions: result.dimensions,
        elapsedMs: result.elapsedMs,
        leftVectors,
        rightVectors,
        covered: leftVectors.length + rightVectors.length,
        totalSegments: segments.a.length + segments.b.length,
      });
      setEngine('remote');
    } catch (thrown) {
      setError(
        thrown instanceof EmbedError
          ? thrown.message
          : 'The embedding request failed for an unknown reason.',
      );
    } finally {
      setBusy(false);
    }
  }, [breakdown, capability, deferredA, deferredB, empty, segments]);

  // Vectors describe the text they were made from. Once either side changes they
  // are stale, and showing a stale score next to edited text is worse than
  // showing none.
  useEffect(() => {
    setRemote(null);
    if (engine === 'remote') setEngine('local');
  }, [deferredA, deferredB]);

  useEffect(() => () => abort.current?.abort(), []);

  const remoteScore = useMemo(() => {
    if (!remote) return null;
    return {
      score: compareDense(remote.vectorA, remote.vectorB, metric),
      cosine: compareDense(remote.vectorA, remote.vectorB, 'cosine'),
    };
  }, [remote, metric]);

  const remoteAlignment = useMemo(() => {
    if (!remote || !breakdown) return null;
    const left = segments.a.slice(0, remote.leftVectors.length);
    const right = segments.b.slice(0, remote.rightVectors.length);
    if (left.length === 0 || right.length === 0) return null;
    return alignSegments(
      left,
      right,
      (x, y) =>
        compareDense(
          remote.leftVectors[x.index] ?? [],
          remote.rightVectors[y.index] ?? [],
          'cosine',
        ),
      // Embedding cosine sits high even for unrelated text, so both thresholds
      // move up. 0.45 here would pair every segment with something.
      { matchFloor: 0.985, rewriteFloor: 0.78 },
    );
  }, [remote, breakdown, segments]);

  /* ── Presentation ───────────────────────────────────────────────── */

  const active = engine === 'remote' && remoteScore ? remoteScore : local;
  const alignment = engine === 'remote' && remoteAlignment ? remoteAlignment : localAlignment;
  /**
   * Is the remote engine callable at all?
   *
   * One flag, read by the engine switch, the button and the notice, so the
   * three cannot disagree about whether the feature is available. They did:
   * the button was gated on this and the switch was not, so clicking the
   * segment posted to an endpoint that does not exist on the deployed service
   * and surfaced the framework's raw "Not Found".
   *
   * `undefined` means the probe has not answered yet, which is also not
   * callable, so both non-true states collapse here.
   */
  const remoteUnavailable = capability?.enabled !== true && !remote;

  const metricInfo = METRICS.find((entry) => entry.value === metric) ?? METRICS[0]!;
  const unavailable = engine === 'remote' && metric === 'jaccard';
  const clash = active ? disagreement(lexical, active.cosine) : null;

  return (
    <Panel
      title="Semantic comparison"
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {busy && <Badge tone="busy">Embedding</Badge>}
          {remote && !busy && (
            <Badge tone="ok">
              {remote.model} · {remote.dimensions}d
            </Badge>
          )}
          <Segmented
            label="Engine"
            value={engine}
            onChange={(value) => {
              // Guarded here as well as on the option, because a control that
              // dispatches on click is the last place a gate should be
              // implicit.
              if (value === 'remote' && remoteUnavailable) return;
              if (value === 'remote' && !remote) void runRemote();
              else setEngine(value);
            }}
            options={[
              {
                value: 'local',
                label: 'Local',
                title: 'TF-IDF in this tab. Lexical, private, instant.',
              },
              {
                value: 'remote',
                label: 'Embedding model',
                disabled: remoteUnavailable,
                title: remoteUnavailable
                  ? capability === undefined
                    ? 'Checking whether the embedding service is up.'
                    : 'This deployment has no embedding endpoint, so there is nothing to call. The local engine is doing the work.'
                  : 'Sends both texts to this site’s backend to be embedded. Nothing is stored there.',
              },
            ]}
          />
        </div>
      }
    >
      {empty ? (
        <p className="px-4 py-6 text-center font-mono text-[11.5px] text-[var(--c-text-faint)]">
          Paste text into both panes above.
        </p>
      ) : (
        <>
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Metric" htmlFor="sem-metric">
              <Select
                id="sem-metric"
                value={metric}
                onChange={(value) => setMetric(value as Metric)}
                options={METRICS.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            </Field>

            <Field label="Segment by" htmlFor="sem-unit">
              <Select
                id="sem-unit"
                value={unit}
                onChange={(value) => setUnit(value as SegmentUnit)}
                options={[
                  { value: 'paragraph', label: 'Paragraph' },
                  { value: 'sentence', label: 'Sentence' },
                  { value: 'line', label: 'Line' },
                ]}
              />
            </Field>

            <div className="flex items-end">
              <Toggle
                id="sem-breakdown"
                label="Align segments"
                checked={breakdown}
                onChange={setBreakdown}
                title="Pair each segment with its closest counterpart, to show where the meaning moved"
              />
            </div>

            <div className="flex items-end">
              <Toolbar>
                {engine === 'remote' || remote ? (
                  <Button onClick={runRemote} disabled={busy}>
                    {busy ? 'Embedding' : 'Re-embed'}
                  </Button>
                ) : (
                  <Button
                    onClick={runRemote}
                    disabled={busy || remoteUnavailable}
                    title={
                      capability === undefined
                        ? 'Checking whether the service is up'
                        : capability?.enabled
                          ? `Sends both texts to ${capability.model}. Nothing is stored.`
                          : 'The embedding service is not reachable right now.'
                    }
                  >
                    Embed with a model
                  </Button>
                )}
              </Toolbar>
            </div>
          </div>

          {engine === 'local' && capability?.enabled === true && !remote && (
            <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
              The local engine is lexical: it will call a rewritten paragraph different even when
              the meaning is unchanged, because it has no idea that two different words can mean the
              same thing. Embedding with a model fixes that, and sends both texts to this
              site&rsquo;s backend to do it. Nothing is stored there, and the text is not logged.
            </p>
          )}

          {capability === null && (
            <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--c-warn)]">
              The embedding service is unreachable, so only the local engine is available. It runs
              on free-tier hardware and is sometimes down.
            </p>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          {unavailable ? (
            <p className="border-t border-[var(--c-line)] px-4 py-6 text-center text-[12px] text-[var(--c-warn)]">
              Jaccard measures set overlap and has no meaning on a dense embedding, where every
              dimension is present in both vectors. Pick another metric.
            </p>
          ) : (
            active && (
              <>
                <StatRow
                  columns={4}
                  stats={[
                    {
                      label: metricInfo.similarity
                        ? 'Semantic similarity'
                        : `${metricInfo.label} distance`,
                      value: metricInfo.similarity
                        ? active.score.toFixed(4)
                        : active.score.toFixed(3),
                      hint: metricInfo.similarity ? '1.0 is identical' : '0 is identical',
                      tone: 'accent',
                    },
                    {
                      label: 'Lexical similarity',
                      value: lexical.toFixed(4),
                      hint: 'from the character diff above',
                    },
                    {
                      label: 'Gap',
                      value: `${((active.cosine - lexical) * 100 >= 0 ? '+' : '') + ((active.cosine - lexical) * 100).toFixed(1)}%`,
                      tone: Math.abs(active.cosine - lexical) > 0.25 ? 'warn' : 'default',
                      hint: 'semantic minus lexical',
                    },
                    {
                      label: engine === 'remote' ? 'Embedded in' : 'Terms compared',
                      value:
                        engine === 'remote' && remote
                          ? `${remote.elapsedMs} ms`
                          : num(Math.max(local?.terms.a ?? 0, local?.terms.b ?? 0)),
                      hint: engine === 'remote' ? 'server round trip' : 'TF-IDF vocabulary',
                    },
                  ]}
                />

                <div className="border-t border-[var(--c-line)] px-4 py-3">
                  <p className="text-[12.5px] leading-relaxed text-[var(--c-text)]">
                    {interpret(active.cosine, engine)}
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--c-text-faint)]">
                    {metricInfo.note}
                  </p>
                  {clash && (
                    <p className="mt-2.5 border-l-2 border-[var(--c-warn)] pl-3 text-[12px] leading-relaxed text-[var(--c-text)]">
                      {clash}
                    </p>
                  )}
                </div>
              </>
            )
          )}

          {alignment && alignment.rows.length > 0 && (
            <AlignmentTable
              alignment={alignment}
              nameA={nameA}
              nameB={nameB}
              unit={unit}
              partial={
                engine === 'remote' && remote && remote.covered < remote.totalSegments
                  ? `${remote.covered} of ${remote.totalSegments} segments fit in one request`
                  : undefined
              }
            />
          )}
        </>
      )}
    </Panel>
  );
}

interface RemoteState {
  readonly vectorA: readonly number[];
  readonly vectorB: readonly number[];
  readonly model: string;
  readonly dimensions: number;
  readonly elapsedMs: number;
  readonly leftVectors: ReadonlyArray<readonly number[]>;
  readonly rightVectors: ReadonlyArray<readonly number[]>;
  readonly covered: number;
  readonly totalSegments: number;
}

/* ── Alignment ────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<AlignmentKind, string> = {
  matched: 'unchanged',
  moved: 'moved',
  rewritten: 'reworded',
  added: 'added',
  removed: 'removed',
};

const KIND_COLOR: Record<AlignmentKind, string> = {
  matched: 'var(--c-text-faint)',
  moved: 'var(--c-accent)',
  rewritten: 'var(--c-warn)',
  added: 'var(--c-ok)',
  removed: 'var(--c-alert)',
};

/**
 * Segment-level pairing.
 *
 * This is the part that turns a score into something actionable. A headline
 * figure of 0.91 says the document is mostly the same; this table says which
 * paragraph is the one that is not.
 */
function AlignmentTable({
  alignment,
  nameA,
  nameB,
  unit,
  partial,
}: {
  alignment: ReturnType<typeof alignSegments>;
  nameA: string;
  nameB: string;
  unit: SegmentUnit;
  partial?: string;
}): React.ReactElement {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const rows = showUnchanged
    ? alignment.rows
    : alignment.rows.filter((row) => row.kind !== 'matched');

  return (
    <div className="border-t border-[var(--c-line)]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--c-raised)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(Object.keys(KIND_LABEL) as AlignmentKind[]).map((kind) =>
            alignment.counts[kind] > 0 ? (
              <span key={kind} className="flex items-center gap-1.5 font-mono text-[11px]">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ background: KIND_COLOR[kind] }}
                />
                <span className="text-[var(--c-text-muted)]">
                  {num(alignment.counts[kind])} {KIND_LABEL[kind]}
                </span>
              </span>
            ) : null,
          )}
          <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
            paired mean {alignment.weightedScore.toFixed(3)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            id="sem-unchanged"
            label="show unchanged"
            checked={showUnchanged}
            onChange={setShowUnchanged}
          />
          <CopyButton
            label="Copy report"
            text={alignment.rows
              .map((row) =>
                [
                  KIND_LABEL[row.kind],
                  row.score === undefined ? '' : row.score.toFixed(4),
                  (row.left?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
                  (row.right?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
                ].join('\t'),
              )
              .join('\n')}
          />
        </div>
      </div>

      {partial && (
        <p className="border-b border-[var(--c-line)] px-4 py-2 text-[11px] text-[var(--c-warn)]">
          {partial}. The rest were not embedded, so they are absent from this table rather than
          unchanged.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[11.5px] text-[var(--c-text-faint)]">
          Every {unit} paired at near-identical similarity. Turn on &ldquo;show unchanged&rdquo; to
          see them.
        </p>
      ) : (
        <div className="max-h-[30rem] overflow-auto">
          {rows.map((row, i) => (
            <AlignmentRow key={i} row={row} nameA={nameA} nameB={nameB} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlignmentRow({
  row,
  nameA,
  nameB,
}: {
  row: Alignment;
  nameA: string;
  nameB: string;
}): React.ReactElement {
  return (
    <div className="grid gap-px border-b border-[var(--c-line-faint)] sm:grid-cols-[7rem_1fr_1fr]">
      <div className="bg-[var(--c-raised)] px-4 py-2.5">
        <span
          className="font-mono text-[10px] tracking-wide uppercase"
          style={{ color: KIND_COLOR[row.kind] }}
        >
          {KIND_LABEL[row.kind]}
        </span>
        {row.score !== undefined && (
          <span className="tabular mt-0.5 block font-mono text-[11px] text-[var(--c-text-faint)]">
            {row.score.toFixed(3)}
          </span>
        )}
      </div>

      <div className="px-4 py-2.5">
        {row.left ? (
          <>
            <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
              {nameA} #{row.left.index + 1}
            </span>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text)]">{row.left.text}</p>
          </>
        ) : (
          <span className="font-mono text-[11px] text-[var(--c-text-faint)] italic">
            not present
          </span>
        )}
      </div>

      <div className="px-4 py-2.5">
        {row.right ? (
          <>
            <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
              {nameB} #{row.right.index + 1}
            </span>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text)]">
              {row.right.text}
            </p>
          </>
        ) : (
          <span className="font-mono text-[11px] text-[var(--c-text-faint)] italic">
            not present
          </span>
        )}
      </div>
    </div>
  );
}
