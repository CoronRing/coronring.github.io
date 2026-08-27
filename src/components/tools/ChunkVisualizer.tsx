import React, { useDeferredValue, useMemo, useState, useRef } from 'react';
import {
  chunkText,
  DEFAULT_SEPARATORS,
  paintChunks,
  STRATEGIES,
  type Chunk,
  type ChunkConfig,
  type StrategyId,
} from '../../lib/chunking';
import {
  Badge,
  Button,
  CopyButton,
  num,
  Panel,
  PasteButton,
  Segmented,
  Slider,
  TextArea,
} from './ui';

/**
 * ChunkVisualizer — see where a splitter actually cuts in place, and what it costs.
 *
 * Runs entirely in the tab. Nothing pasted here is transmitted.
 */

/** Characters of source painted before the view truncates, for DOM sanity. */
const PAINT_LIMIT = 50_000;

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

type ViewMode = 'inplace' | 'split' | 'edit';

export default function ChunkVisualizer(): React.ReactElement {
  const [text, setText] = useState<string>(SAMPLES[0]?.text ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('inplace');
  const [strategy, setStrategy] = useState<StrategyId>('recursive');
  const [size, setSize] = useState<number>(500);
  const [overlap, setOverlap] = useState<number>(80);
  const [unit, setUnit] = useState<'char' | 'token'>('char');
  const [percentile, setPercentile] = useState<number>(20);
  const [windowSize, setWindowSize] = useState<number>(1);
  const [separators, setSeparators] = useState<readonly string[]>(DEFAULT_SEPARATORS);
  const [focus, setFocus] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState<boolean>(true);

  const containerRef = useRef<HTMLDivElement>(null);

  const info = STRATEGIES.find((s) => s.id === strategy);
  const uses = (field: keyof ChunkConfig): boolean => info?.uses.includes(field) ?? false;

  const deferred = useDeferredValue(text);
  const stale = deferred !== text;

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

  const focusedChunk = focus !== null ? chunks.find((c) => c.index === focus) : null;

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
    <div className="space-y-5">
      {/* ── Control HUD ───────────────────────────────────────────────── */}
      <div className="hud-card space-y-4 p-4">
        {/* Top bar: View Mode Switcher, Samples, Stale Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-accent">VIEW</span>
            <Segmented
              value={viewMode}
              options={[
                { value: 'inplace' as const, label: 'In-Place Cuts' },
                { value: 'split' as const, label: 'Split View' },
                { value: 'edit' as const, label: 'Raw Editor' },
              ]}
              onChange={setViewMode}
            />
            {stale && <Badge tone="busy">chunking...</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">Samples:</span>
            {SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setText(sample.text);
                  setFocus(null);
                }}
                className="rounded border border-[var(--c-line)] bg-[var(--c-sunken)] px-2 py-0.5 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
              >
                {sample.label}
              </button>
            ))}
            <PasteButton onPaste={setText} />
            <button
              type="button"
              onClick={() => setText('')}
              disabled={text.length === 0}
              className="rounded border border-[var(--c-line)] px-2 py-0.5 font-mono text-[11px] text-[var(--c-text-faint)] transition-colors hover:border-red-400/50 hover:text-red-400 disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Strategy Switcher */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="eyebrow">STRATEGY</span>
              <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
                ({info?.name})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Segmented
                label="Unit"
                value={unit}
                options={[
                  { value: 'char' as const, label: 'Chars' },
                  { value: 'token' as const, label: 'Tokens' },
                ]}
                onChange={setUnit}
              />
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className="font-mono text-[11px] text-[var(--c-accent)] underline underline-offset-2 hover:opacity-80"
              >
                {showConfig ? 'Hide Knobs' : 'Show Knobs'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STRATEGIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={entry.id === strategy}
                onClick={() => {
                  setStrategy(entry.id);
                  setFocus(null);
                }}
                className={`rounded border px-2.5 py-1 text-left transition-all ${
                  entry.id === strategy
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] shadow-sm'
                    : 'border-[var(--c-line)] bg-[var(--c-sunken)] hover:border-[var(--c-text-muted)]'
                }`}
              >
                <span
                  className="block font-mono text-[11.5px] font-medium"
                  style={{ color: entry.id === strategy ? 'var(--c-accent)' : 'var(--c-text)' }}
                >
                  {entry.name}
                </span>
              </button>
            ))}
          </div>

          <p className="font-mono text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
            {info?.detail}
          </p>
        </div>

        {/* Tuner Knobs (collapsible or open) */}
        {showConfig && (
          <div className="grid gap-4 border-t border-[var(--c-line)] pt-3 sm:grid-cols-3">
            <Slider
              id="cv-size"
              label={`Chunk Size (${unit === 'token' ? 'tokens' : 'chars'})`}
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

            {uses('separators') && (
              <div className="sm:col-span-3">
                <label className="block">
                  <span className="eyebrow mb-1 block">
                    Separator ladder (preferred first, comma separated)
                  </span>
                  <input
                    value={separators.map(escapeSeparator).join(', ')}
                    onChange={(e) =>
                      setSeparators(
                        e.target.value.split(',').map((s) => unescapeSeparator(s.trim())),
                      )
                    }
                    spellCheck={false}
                    className="w-full rounded border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Live Quick Stats Bar ───────────────────────────────────────── */}
      {chunks.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          {statTiles.map((st) => (
            <div
              key={st.label}
              className={`rounded border p-2.5 ${
                st.tone === 'warn'
                  ? 'border-yellow-500/40 bg-yellow-500/5'
                  : 'border-[var(--c-line)] bg-[var(--c-card)]'
              }`}
            >
              <div className="font-mono text-[10px] text-[var(--c-text-faint)] uppercase tracking-wider">
                {st.label}
              </div>
              <div
                className={`font-mono text-[14px] font-bold ${
                  st.tone === 'accent'
                    ? 'text-[var(--c-accent)]'
                    : st.tone === 'warn'
                      ? 'text-yellow-400'
                      : 'text-[var(--c-text)]'
                }`}
              >
                {st.value}
              </div>
              {st.hint && (
                <div className="truncate font-mono text-[9.5px] text-[var(--c-text-faint)]">
                  {st.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MAIN IN-PLACE DISPLAY WORKSPACE ───────────────────────────── */}
      <div className="space-y-4">
        {/* If in edit mode, show TextArea */}
        {viewMode === 'edit' && (
          <Panel
            title="Raw Document Editor"
            cornerTicks
            aside={
              <Button variant="quiet" onClick={() => setViewMode('inplace')}>
                Switch to In-Place Visualizer →
              </Button>
            }
          >
            <TextArea
              id="cv-input"
              value={text}
              onChange={setText}
              rows={18}
              placeholder="Paste or write your document text here..."
            />
          </Panel>
        )}

        {/* If in Split mode: Side by Side Raw Editor & In-Place Painted View */}
        {viewMode === 'split' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Source Editor (Live Input)" cornerTicks>
              <TextArea
                id="cv-input-split"
                value={text}
                onChange={setText}
                rows={22}
                placeholder="Type or paste markdown, prose, transcripts..."
              />
            </Panel>

            <Panel
              title={`In-Place Highlighted Cuts (${num(chunks.length)} chunks)`}
              cornerTicks
              aside={
                <div className="flex items-center gap-2">
                  {focus !== null && (
                    <Button variant="quiet" onClick={() => setFocus(null)}>
                      Clear Focus
                    </Button>
                  )}
                  <CopyButton
                    text={JSON.stringify(exportable(chunks), null, 2)}
                    label="Copy JSON"
                  />
                </div>
              }
            >
              <InPlaceDisplay
                text={deferred}
                painted={painted}
                chunks={chunks}
                focus={focus}
                onSelectChunk={setFocus}
              />
            </Panel>
          </div>
        )}

        {/* If in In-Place Mode: Direct Front-and-Center Visualizer */}
        {viewMode === 'inplace' && (
          <Panel
            title={`In-Place Boundary Canvas · ${num(chunks.length)} Chunks`}
            cornerTicks
            aside={
              <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--c-text-faint)]">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-[color-mix(in_srgb,var(--c-accent)_25%,transparent)] ring-1 ring-[var(--c-accent)]" />
                  Chunk
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-[color-mix(in_srgb,var(--c-accent)_70%,transparent)] ring-1 ring-[var(--c-accent)]" />
                  Overlap Region
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-yellow-500/30 ring-1 ring-yellow-400" />
                  Sentence Cut
                </span>
                {focus !== null && (
                  <Button variant="quiet" onClick={() => setFocus(null)}>
                    Reset Focus
                  </Button>
                )}
                <Button variant="quiet" onClick={() => setViewMode('split')}>
                  Split View
                </Button>
              </div>
            }
          >
            {/* Quick Chunk Navigator Pill Ribbon */}
            <div className="flex flex-wrap items-center gap-1 border-b border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-2">
              <span className="mr-1.5 font-mono text-[10.5px] text-[var(--c-text-faint)]">
                Jump to:
              </span>
              {chunks.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  onClick={() => setFocus(focus === c.index ? null : c.index)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
                    focus === c.index
                      ? 'bg-[var(--c-accent)] font-bold text-black'
                      : c.cutsSentence
                        ? 'border border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                        : 'border border-[var(--c-line)] bg-[var(--c-card)] text-[var(--c-text-muted)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)]'
                  }`}
                  title={`Chunk #${c.index + 1} (${c.end - c.start}c, ${c.tokens} tok)`}
                >
                  #{c.index + 1}
                  {c.cutsSentence && ' ⚠️'}
                </button>
              ))}
            </div>

            {/* In-Place Text Viewer */}
            <div ref={containerRef}>
              <InPlaceDisplay
                text={deferred}
                painted={painted}
                chunks={chunks}
                focus={focus}
                onSelectChunk={setFocus}
              />
            </div>

            {/* Active Focused Chunk Telemetry Drawer */}
            {focusedChunk && (
              <div className="border-t border-[var(--c-line)] bg-[var(--c-sunken)] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11.5px]">
                    <span className="rounded bg-[var(--c-accent)] px-1.5 py-0.5 font-bold text-black">
                      CHUNK #{focusedChunk.index + 1}
                    </span>
                    <span className="text-[var(--c-text)] font-semibold">
                      {focusedChunk.end - focusedChunk.start} chars
                    </span>
                    <span className="text-[var(--c-text-faint)]">·</span>
                    <span className="text-[var(--c-accent)]">
                      {focusedChunk.tokens} tokens
                    </span>
                    <span className="text-[var(--c-text-faint)]">·</span>
                    <span className="text-[var(--c-text-muted)]">
                      range [{focusedChunk.start}..{focusedChunk.end}]
                    </span>
                    {focusedChunk.overlapBefore > 0 && (
                      <>
                        <span className="text-[var(--c-text-faint)]">·</span>
                        <span className="text-emerald-400">
                          +{focusedChunk.overlapBefore}c overlap
                        </span>
                      </>
                    )}
                    {focusedChunk.cutsSentence && (
                      <span className="rounded border border-yellow-500/50 bg-yellow-500/10 px-1.5 py-0.5 text-[10.5px] text-yellow-400">
                        Severed mid-sentence
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyButton text={focusedChunk.text} label="Copy Chunk Text" />
                    <Button variant="quiet" onClick={() => setFocus(null)}>
                      Close
                    </Button>
                  </div>
                </div>
                <div className="mt-2.5 max-h-32 overflow-y-auto rounded border border-[var(--c-line)] bg-[var(--c-card)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--c-text-muted)] whitespace-pre-wrap select-all">
                  {focusedChunk.text}
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* ── Distribution & Inspector ───────────────────────────────────── */}
      {chunks.length > 1 && (
        <Panel
          title="Chunk Size Distribution & Shape"
          cornerTicks
          aside={
            <CopyButton
              text={JSON.stringify(exportable(chunks), null, 2)}
              label="Export All Chunks (JSON)"
            />
          }
        >
          <SizeHistogram chunks={chunks} budget={result.effectiveSize} />
        </Panel>
      )}
    </div>
  );
}

/* ── In-Place Text Renderer ────────────────────────────────────────────── */

function InPlaceDisplay({
  text,
  painted,
  chunks,
  focus,
  onSelectChunk,
}: {
  text: string;
  painted: ReturnType<typeof paintChunks>;
  chunks: readonly Chunk[];
  focus: number | null;
  onSelectChunk: (index: number | null) => void;
}): React.ReactElement {
  if (text.length === 0) {
    return (
      <div className="p-8 text-center font-mono text-[12px] text-[var(--c-text-faint)]">
        Paste a document or select a sample above to view in-place highlighted chunk boundaries.
      </div>
    );
  }

  return (
    <div className="max-h-[34rem] overflow-y-auto p-4 font-mono text-[12.5px] leading-[1.85] whitespace-pre-wrap select-text">
      {painted.map((segment, i) => {
        const covering = segment.chunks.length;
        const primaryChunkIdx = segment.chunks[0];
        const isFocused = focus !== null && segment.chunks.includes(focus);
        const hasDimming = focus !== null && !isFocused;

        const isStartOfChunk =
          primaryChunkIdx !== undefined &&
          chunks[primaryChunkIdx]?.start === segment.start;

        return (
          <span key={i} className="relative inline">
            {/* Inline Chunk Badge at boundary start */}
            {isStartOfChunk && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChunk(primaryChunkIdx);
                }}
                className={`inline-flex items-center rounded px-1 py-0.2 mr-1 align-baseline font-mono text-[9px] font-bold tracking-tight cursor-pointer transition-transform hover:scale-105 select-none ${
                  focus === primaryChunkIdx
                    ? 'bg-[var(--c-accent)] text-black ring-1 ring-white'
                    : 'bg-[var(--c-line)] text-[var(--c-text-muted)] hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)]'
                }`}
                title={`Click to focus Chunk #${primaryChunkIdx + 1}`}
              >
                #{primaryChunkIdx + 1}
              </span>
            )}

            <span
              title={
                covering === 0
                  ? 'Unchunked space'
                  : covering > 1
                    ? `Overlap Region: Chunks ${segment.chunks.map((c) => `#${c + 1}`).join(' & ')}`
                    : `Chunk #${(primaryChunkIdx ?? 0) + 1}`
              }
              onClick={() => {
                if (primaryChunkIdx !== undefined) {
                  onSelectChunk(focus === primaryChunkIdx ? null : primaryChunkIdx);
                }
              }}
              style={{
                backgroundColor:
                  covering === 0
                    ? 'transparent'
                    : covering > 1
                      ? 'color-mix(in srgb, var(--c-accent) 55%, transparent)'
                      : (primaryChunkIdx ?? 0) % 2 === 0
                        ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)'
                        : 'color-mix(in srgb, var(--c-text) 9%, transparent)',
                outline: isFocused ? '1.5px solid var(--c-accent)' : undefined,
                boxShadow: isFocused ? '0 0 8px rgba(0, 230, 180, 0.25)' : undefined,
                color: hasDimming
                  ? 'var(--c-text-faint)'
                  : covering === 0
                    ? 'var(--c-text-faint)'
                    : 'var(--c-text)',
                cursor: covering > 0 ? 'pointer' : 'default',
                borderRadius: '2px',
                padding: '1px 0px',
                transition: 'background-color 0.15s ease, opacity 0.15s ease',
                opacity: hasDimming ? 0.35 : 1,
              }}
            >
              {text.slice(segment.start, segment.end)}
            </span>
          </span>
        );
      })}

      {text.length > PAINT_LIMIT && (
        <p className="mt-4 border-t border-[var(--c-line)] pt-2 font-mono text-[10.5px] text-[var(--c-text-faint)]">
          Displayed first {num(PAINT_LIMIT)} characters in-place.
        </p>
      )}
    </div>
  );
}

/* ── Histogram ────────────────────────────────────────────────────────── */

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
    <figure className="p-4">
      <figcaption className="eyebrow mb-2">Chunk size distribution</figcaption>

      <div className="relative flex h-20 items-end gap-[2px]">
        {/* Budget marker */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[var(--c-accent)]"
          style={{ left: `${Math.min(100, (budget / max) * 100)}%` }}
        />
        {counts.map((count, i) => (
          <div
            key={i}
            title={`${Math.round(i * width)}–${Math.round((i + 1) * width)} chars: ${count} chunk${count === 1 ? '' : 's'}`}
            className="flex-1 rounded-t-[2px] transition-[height]"
            style={{
              height: `${peak === 0 ? 0 : Math.max(count > 0 ? 4 : 0, (count / peak) * 100)}%`,
              background: 'var(--c-accent-fill)',
            }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--c-text-faint)]">
        <span>0 chars</span>
        <span className="text-[var(--c-accent)]">budget {num(budget)}</span>
        <span>{num(Math.round(max))} chars</span>
      </div>
    </figure>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function escapeSeparator(separator: string): string {
  return separator === ''
    ? '""'
    : separator.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/ /g, '␣');
}

function unescapeSeparator(value: string): string {
  if (value === '""' || value === '') return '';
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/␣/g, ' ');
}

function exportable(chunks: readonly Chunk[]): unknown[] {
  return chunks.map((chunk) => ({
    id: chunk.index,
    text: chunk.text,
    start: chunk.start,
    end: chunk.end,
    tokens: chunk.tokens,
    cutsSentence: chunk.cutsSentence,
    overlapBefore: chunk.overlapBefore,
    ...(chunk.label ? { section: chunk.label } : {}),
  }));
}
