import { useDeferredValue, useMemo, useState } from 'react';
import {
  chunkText,
  DEFAULT_SEPARATORS,
  paintChunks,
  STRATEGIES,
  type Chunk,
  type ChunkConfig,
  type StrategyId,
} from '../../lib/chunking';
import { Badge, Button, CopyButton, num, Panel, Segmented, Slider, StatRow, TextArea } from './ui';

/**
 * ChunkVisualizer — see where a splitter actually cuts, and what it costs.
 *
 * The splitters live in `src/lib/chunking.ts` and work over source offsets, so
 * the display can paint chunks *in place* rather than listing detached strings.
 * That is the whole argument for this page: a chunk list tells you there are 42
 * chunks; the painted view tells you that eleven of them start halfway through
 * a sentence and that the overlap you configured is not the overlap you got.
 *
 * Runs entirely in the tab. Nothing pasted here is transmitted.
 */

/** Characters of source painted before the view truncates, for DOM sanity. */
const PAINT_LIMIT = 30_000;

const SAMPLES: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Markdown doc',
    text: `# Retrieval-augmented generation

Retrieval quality is decided long before the model sees a prompt. Chunking
strategy, embedding choice, and the reranker do most of the work; the generation
step mostly reveals whether the earlier decisions were sound.

## Chunking

A fixed-size splitter is the baseline. It cuts every N characters, which means it
cuts sentences in half, and a chunk that begins mid-clause carries a fragment the
embedding cannot represent well. The recursive character splitter descends a
ladder of separators: paragraphs, then lines, then sentences, then words. It
takes the largest unit that fits inside the budget.

Overlap exists to survive the boundary case: a fact stated across two sentences
lands wholly inside at least one chunk. It is not free. Overlap of 20% inflates
the index by roughly a fifth, and every duplicated token is paid for twice, once
at embedding time and again on every retrieval that returns both neighbours.

## Evaluation

Measure recall at k before anything else. A pipeline that never retrieves the
right chunk cannot be rescued by a better model, and a pipeline that retrieves it
at rank 40 cannot be rescued by a bigger context window either. Then measure
faithfulness: whether the answer is actually supported by what was retrieved.

Numbers beat intuition here. Chunk size is the single most consequential knob in
most RAG systems and the one most often set by copying a tutorial.`,
  },
  {
    label: 'Prose',
    text: `The archive had been catalogued twice, once in 1931 and again after the flood, and neither catalogue agreed with the shelves. Boxes marked correspondence held photographic plates. A ledger of shipping manifests had been filed under botany, apparently because someone in 1974 had read the word "cargo" as "carga" and then as a genus.

Marguerite worked through it alphabetically, which was the only decision she never revisited. Six weeks in she found the letters. They were not where any of the three finding aids said they would be, and they were not addressed to anyone the museum had ever heard of.

What made them valuable was not their contents but their postmarks. Read in order, they described a route that no ship of that period was supposed to have taken, and they were signed with an initial that appeared nowhere else in the collection.`,
  },
  {
    label: 'Transcript',
    text: `SPEAKER 1: okay so the issue is when we bumped the chunk size to 2000 recall went down which is the opposite of what everyone expected
SPEAKER 2: right and we checked it wasn't the embedding truncating
SPEAKER 1: yeah that was the first thing, model takes 8k so no
SPEAKER 2: so what was it
SPEAKER 1: dilution. the chunk covers three topics now, the embedding averages them, and the vector sits between all three clusters instead of inside one
SPEAKER 2: so it matches nothing well
SPEAKER 1: it matches everything badly which is worse because it still ranks
SPEAKER 2: did smaller fix it
SPEAKER 1: 400 with 15 percent overlap, recall at 5 went from 0.61 to 0.78, and the answers got shorter which the eval liked`,
  },
];

export default function ChunkVisualizer(): React.ReactElement {
  const [text, setText] = useState<string>('');
  const [strategy, setStrategy] = useState<StrategyId>('recursive');
  const [size, setSize] = useState<number>(600);
  const [overlap, setOverlap] = useState<number>(80);
  const [unit, setUnit] = useState<'char' | 'token'>('char');
  const [percentile, setPercentile] = useState<number>(20);
  const [windowSize, setWindowSize] = useState<number>(1);
  const [separators, setSeparators] = useState<readonly string[]>(DEFAULT_SEPARATORS);
  const [focus, setFocus] = useState<number | null>(null);

  const info = STRATEGIES.find((s) => s.id === strategy);
  const uses = (field: keyof ChunkConfig): boolean => info?.uses.includes(field) ?? false;

  const deferred = useDeferredValue(text);
  const stale = deferred !== text;

  /*
   * Overlap is capped at half the chunk size. The slider's own max moves with
   * the size, but its stored value does not — dragging size down after setting
   * a large overlap would otherwise leave a configuration the slider is no
   * longer showing.
   */
  const boundedOverlap = Math.min(overlap, Math.floor(size / 2));

  const config: ChunkConfig = useMemo(
    () => ({
      size,
      overlap: boundedOverlap,
      unit,
      separators,
      breakpointPercentile: percentile,
      windowSize,
    }),
    [size, boundedOverlap, unit, separators, percentile, windowSize],
  );

  const result = useMemo(() => chunkText(deferred, strategy, config), [deferred, strategy, config]);
  const { chunks, stats } = result;

  const painted = useMemo(
    () => paintChunks(Math.min(deferred.length, PAINT_LIMIT), chunks),
    [deferred.length, chunks],
  );

  const overlapShortfall =
    uses('overlap') && boundedOverlap > 0 && stats.count > 1
      ? 1 - stats.achievedOverlap / result.effectiveOverlap
      : 0;

  const statTiles = [
    { label: 'chunks', value: num(stats.count), tone: 'accent' as const },
    {
      label: 'mean size',
      value: `${num(stats.meanChars)}c`,
      hint: `median ${num(stats.medianChars)}c · ${num(stats.meanTokens)} tok`,
    },
    { label: 'range', value: `${num(stats.minChars)}–${num(stats.maxChars)}c` },
    {
      label: 'index expansion',
      value: `${stats.expansion.toFixed(2)}×`,
      hint: 'chars stored ÷ source',
      tone: stats.expansion > 1.5 ? ('warn' as const) : ('default' as const),
    },
    {
      label: 'overlap achieved',
      value: `${num(stats.achievedOverlap)}c`,
      hint: uses('overlap')
        ? `asked ${num(result.effectiveOverlap)}c`
        : 'not used by this strategy',
      tone: overlapShortfall > 0.5 ? ('warn' as const) : ('default' as const),
    },
    {
      label: 'sentence cuts',
      value: num(stats.sentenceCuts),
      hint: `${num(stats.runts)} runts · ${num(stats.oversize)} oversize`,
      tone: stats.sentenceCuts > stats.count / 3 ? ('warn' as const) : ('default' as const),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Input ─────────────────────────────────────────────────────── */}
      <Panel
        title="Document"
        aside={
          <div className="flex items-center gap-1.5">
            {stale && <Badge tone="busy">chunking</Badge>}
            {SAMPLES.map((sample) => (
              <Button key={sample.label} onClick={() => setText(sample.text)}>
                {sample.label}
              </Button>
            ))}
            <Button variant="quiet" onClick={() => setText('')} disabled={text.length === 0}>
              Clear
            </Button>
          </div>
        }
      >
        <TextArea
          id="cv-input"
          value={text}
          onChange={setText}
          rows={8}
          placeholder="Paste the document you are about to index, or drop a file. Markdown, prose, transcripts: the strategy that wins depends on which."
        />
      </Panel>

      {/* ── Strategy ──────────────────────────────────────────────────── */}
      <Panel
        title="Strategy"
        aside={
          <Segmented
            label="Budget unit"
            value={unit}
            options={[
              { value: 'char' as const, label: 'Characters' },
              { value: 'token' as const, label: 'Tokens' },
            ]}
            onChange={setUnit}
          />
        }
      >
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={entry.id === strategy}
                onClick={() => setStrategy(entry.id)}
                className={`rounded-sm border px-2.5 py-1.5 text-left transition-colors ${
                  entry.id === strategy
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)]'
                    : 'border-[var(--c-line)] hover:border-[var(--c-text-muted)]'
                }`}
              >
                <span
                  className="block font-mono text-[11.5px]"
                  style={{ color: entry.id === strategy ? 'var(--c-accent)' : 'var(--c-text)' }}
                >
                  {entry.name}
                </span>
              </button>
            ))}
          </div>

          <p className="prose-measure text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
            {info?.detail}
          </p>

          <div className="grid gap-5 border-t border-[var(--c-line)] pt-4 sm:grid-cols-3">
            <Slider
              id="cv-size"
              label={`Chunk size (${unit === 'token' ? 'tokens' : 'chars'})`}
              value={size}
              min={unit === 'token' ? 32 : 100}
              max={unit === 'token' ? 2048 : 4000}
              step={unit === 'token' ? 16 : 50}
              onChange={setSize}
              disabled={!uses('size')}
            />
            <Slider
              id="cv-overlap"
              label={`Overlap (${unit === 'token' ? 'tokens' : 'chars'})`}
              value={boundedOverlap}
              min={0}
              max={Math.max(1, Math.floor(size / 2))}
              step={unit === 'token' ? 4 : 10}
              onChange={setOverlap}
              disabled={!uses('overlap')}
            />
            {uses('breakpointPercentile') ? (
              <Slider
                id="cv-percentile"
                label="Breakpoint percentile"
                value={percentile}
                min={5}
                max={60}
                step={5}
                suffix="%"
                onChange={setPercentile}
              />
            ) : (
              <Slider
                id="cv-window"
                label="Window (sentences either side)"
                value={windowSize}
                min={0}
                max={5}
                onChange={setWindowSize}
                disabled={!uses('windowSize')}
              />
            )}
          </div>

          {uses('separators') && (
            <label className="block">
              <span className="eyebrow mb-1.5 block">
                Separator ladder, most preferred first, comma separated
              </span>
              <input
                value={separators.map(escapeSeparator).join(', ')}
                onChange={(e) =>
                  setSeparators(e.target.value.split(',').map((s) => unescapeSeparator(s.trim())))
                }
                spellCheck={false}
                className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
              />
            </label>
          )}
        </div>
      </Panel>

      {chunks.length > 0 && (
        <>
          {/* ── Metrics ─────────────────────────────────────────────── */}
          <Panel
            title="Result"
            aside={
              <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
                budget {num(result.effectiveSize)} chars
                {unit === 'token' && ` ≈ ${num(size)} tokens`}
              </span>
            }
          >
            <StatRow stats={statTiles} columns={6} />
            <SizeHistogram chunks={chunks} budget={result.effectiveSize} />
          </Panel>

          {overlapShortfall > 0.5 && (
            <p className="rounded-sm border border-[var(--c-warn)] bg-[color-mix(in_srgb,var(--c-warn)_9%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-[var(--c-warn)]">
              Requested {num(result.effectiveOverlap)} characters of overlap, achieved{' '}
              {num(stats.achievedOverlap)} on average. Boundary-respecting splitters can only step
              back to a boundary that exists, so a large overlap against large natural units
              collapses to none. If the overlap matters, reduce the chunk size or move to a
              fixed-size split.
            </p>
          )}

          {/* ── Painted source ──────────────────────────────────────── */}
          <Panel
            title="Where it cuts"
            aside={
              <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--c-text-faint)]">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-[color-mix(in_srgb,var(--c-accent)_22%,transparent)]" />
                  chunk
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-[color-mix(in_srgb,var(--c-accent)_55%,transparent)]" />
                  overlap
                </span>
                {focus !== null && (
                  <Button variant="quiet" onClick={() => setFocus(null)}>
                    Clear focus
                  </Button>
                )}
              </div>
            }
          >
            <div className="max-h-[28rem] overflow-y-auto p-4 font-mono text-[12px] leading-[1.75] whitespace-pre-wrap">
              {painted.map((segment, i) => {
                const covering = segment.chunks.length;
                const focused = focus !== null && segment.chunks.includes(focus);
                return (
                  <span
                    key={i}
                    title={
                      covering === 0
                        ? 'not in any chunk'
                        : `chunk ${segment.chunks.map((c) => c + 1).join(' + ')}`
                    }
                    onClick={() => setFocus(segment.chunks[0] ?? null)}
                    style={{
                      background:
                        covering === 0
                          ? 'transparent'
                          : covering > 1
                            ? 'color-mix(in srgb, var(--c-accent) 55%, transparent)'
                            : (segment.chunks[0] ?? 0) % 2 === 0
                              ? 'color-mix(in srgb, var(--c-accent) 22%, transparent)'
                              : 'color-mix(in srgb, var(--c-text) 10%, transparent)',
                      outline: focused ? '1px solid var(--c-accent)' : undefined,
                      color: covering === 0 ? 'var(--c-text-faint)' : 'var(--c-text)',
                      cursor: covering > 0 ? 'pointer' : 'default',
                    }}
                  >
                    {deferred.slice(segment.start, segment.end)}
                  </span>
                );
              })}
            </div>
            {deferred.length > PAINT_LIMIT && (
              <p className="border-t border-[var(--c-line)] px-4 py-2 font-mono text-[10px] text-[var(--c-text-faint)]">
                Painted the first {num(PAINT_LIMIT)} of {num(deferred.length)} characters. Every
                figure above covers the whole document.
              </p>
            )}
          </Panel>

          {/* ── Chunk table ─────────────────────────────────────────── */}
          <Panel
            title={`Chunks · ${num(chunks.length)}`}
            aside={
              <CopyButton text={JSON.stringify(exportable(chunks), null, 2)} label="Copy JSON" />
            }
          >
            <ul className="max-h-[30rem] divide-y divide-[var(--c-line)] overflow-y-auto">
              {chunks.map((chunk) => (
                <li
                  key={chunk.index}
                  onMouseEnter={() => setFocus(chunk.index)}
                  className={`px-4 py-2.5 transition-colors ${
                    focus === chunk.index ? 'bg-[var(--c-accent-soft)]' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tabular font-mono text-[11px] text-[var(--c-accent)]">
                      #{chunk.index + 1}
                    </span>
                    <span className="tabular font-mono text-[10px] text-[var(--c-text-faint)]">
                      {num(chunk.end - chunk.start)} chars · {num(chunk.tokens)} tok ·{' '}
                      {num(chunk.start)}–{num(chunk.end)}
                    </span>
                    {chunk.label && (
                      <span className="font-mono text-[10px] text-[var(--c-text-muted)]">
                        {chunk.label}
                      </span>
                    )}
                    {chunk.overlapBefore > 0 && (
                      <span className="font-mono text-[10px] text-[var(--c-text-faint)]">
                        +{num(chunk.overlapBefore)} shared
                      </span>
                    )}
                    {chunk.cutsSentence && (
                      <span className="font-mono text-[10px] text-[var(--c-warn)]">
                        cuts a sentence
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-3 font-mono text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
                    {chunk.text.trim()}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}

/* ── Histogram ────────────────────────────────────────────────────────── */

/**
 * Distribution of chunk sizes.
 *
 * One series, so one hue and no legend — the panel title names it. The bar is
 * the only saturated thing in the figure; the axis and the budget marker stay
 * recessive so the shape reads first. What matters is not the mean but the
 * spread: a strategy that produces a tight cluster under the budget is doing
 * its job, and a bimodal one is telling you the document has two kinds of
 * section in it.
 */
function SizeHistogram({
  chunks,
  budget,
}: {
  chunks: readonly Chunk[];
  budget: number;
}): React.ReactElement | null {
  const BUCKETS = 24;
  const lengths = chunks.map((c) => c.end - c.start);
  if (lengths.length < 2) return null;

  const max = Math.max(...lengths, budget);
  const width = max / BUCKETS;
  const counts = new Array<number>(BUCKETS).fill(0);
  for (const length of lengths) {
    const bucket = Math.min(BUCKETS - 1, Math.floor(length / width));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const peak = Math.max(...counts);

  return (
    <figure className="border-t border-[var(--c-line)] px-4 py-3">
      <figcaption className="eyebrow mb-2">Chunk size distribution</figcaption>

      <div className="relative flex h-20 items-end gap-[2px]">
        {/* Budget marker — recessive, labelled, not a second series. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[var(--c-text-faint)]"
          style={{ left: `${Math.min(100, (budget / max) * 100)}%` }}
        />
        {counts.map((count, i) => (
          <div
            key={i}
            title={`${Math.round(i * width)}–${Math.round((i + 1) * width)} chars: ${count} chunk${count === 1 ? '' : 's'}`}
            className="flex-1 rounded-t-[2px] transition-[height]"
            style={{
              height: `${peak === 0 ? 0 : Math.max(count > 0 ? 3 : 0, (count / peak) * 100)}%`,
              background: 'var(--c-accent-fill)',
            }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--c-text-faint)]">
        <span>0</span>
        <span>budget {num(budget)}</span>
        <span>{num(Math.round(max))} chars</span>
      </div>
    </figure>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Show a separator as it would be typed, not as a literal control character. */
function escapeSeparator(separator: string): string {
  return separator === ''
    ? '""'
    : separator.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/ /g, '␣');
}

function unescapeSeparator(value: string): string {
  if (value === '""' || value === '') return '';
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/␣/g, ' ');
}

/** The shape a chunk would take in an index — what the copy button hands over. */
function exportable(chunks: readonly Chunk[]): unknown[] {
  return chunks.map((chunk) => ({
    id: chunk.index,
    text: chunk.text,
    start: chunk.start,
    end: chunk.end,
    tokens: chunk.tokens,
    ...(chunk.label ? { section: chunk.label } : {}),
  }));
}
