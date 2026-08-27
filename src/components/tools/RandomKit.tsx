/**
 * Random Kit: numbers, lists, strings, dice, all from a source you choose.
 *
 * The source picker is the design decision. Every other generator on the web
 * hides it, which means you cannot tell whether the output is reproducible or
 * whether it is safe to use as a secret, and those are the only two questions
 * anyone actually has. Here it is the first control on the page and both answers
 * are stated in the UI.
 *
 * @see src/lib/rng.ts for the generators
 */

import { useCallback, useMemo, useState } from 'react';

import {
  ALPHABETS,
  DISTRIBUTIONS,
  MAX_COUNT,
  OUTPUT_FORMATS,
  entropyBits,
  formatValues,
  generateNumbers,
  operateOnList,
  randomString,
  rollDice,
  seededSource,
  systemSource,
  uuid4,
  type Distribution,
  type ListMode,
  type NumberRequest,
  type OutputFormat,
  type Source,
} from '../../lib/rng';
import {
  Badge,
  Button,
  CopyButton,
  DownloadButton,
  ErrorNote,
  Field,
  Kbd,
  NumberField,
  OutputBox,
  Panel,
  Segmented,
  Select,
  StatRow,
  TextArea,
  TextField,
  Toggle,
  Toolbar,
  num,
  usePersisted,
} from './ui';

type Kind = 'numbers' | 'list' | 'strings' | 'dice';
type SourceKind = 'seeded' | 'system';

export default function RandomKit(): React.ReactElement {
  const [kind, setKind] = useState<Kind>('numbers');
  const [sourceKind, setSourceKind] = usePersisted<SourceKind>('rng.source', 'seeded');
  const [seed, setSeed] = usePersisted('rng.seed', 'particle-wave');
  const [format, setFormat] = usePersisted<OutputFormat>('rng.format', 'lines');

  // Bumped on every draw. A seeded source is a pure function of the seed, so
  // without this "Generate" would be a no-op: the same seed gives the same
  // numbers, which is the feature, and it needs an explicit way to advance.
  const [nonce, setNonce] = useState(0);

  const makeSource = useCallback(
    (): Source => (sourceKind === 'system' ? systemSource() : seededSource(`${seed}#${nonce}`)),
    [sourceKind, seed, nonce],
  );

  return (
    <div className="space-y-4">
      <Panel
        title="Source"
        aside={
          <Badge tone={sourceKind === 'system' ? 'ok' : 'idle'}>
            {sourceKind === 'system' ? 'Unpredictable' : 'Reproducible'}
          </Badge>
        }
      >
        <div className="space-y-3 p-4">
          <Segmented
            label="Randomness source"
            value={sourceKind}
            onChange={setSourceKind}
            options={[
              {
                value: 'seeded',
                label: 'Seeded (reproducible)',
                title: 'xoshiro128** from a hashed seed',
              },
              { value: 'system', label: 'System (secure)', title: 'crypto.getRandomValues' },
            ]}
          />

          {sourceKind === 'seeded' ? (
            <>
              <p className="text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
                A deterministic generator, xoshiro128**, driven by a hash of the seed. The same seed
                and settings give the same output on any machine, which is what makes generated data
                usable as a test fixture. Not suitable for anything secret: with the seed, every
                value is predictable.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1">
                  <Field label="Seed" htmlFor="rng-seed">
                    <TextField
                      id="rng-seed"
                      value={seed}
                      onChange={setSeed}
                      placeholder="any string"
                    />
                  </Field>
                </div>
                <Button onClick={() => setSeed(Math.random().toString(36).slice(2, 10))}>
                  Random seed
                </Button>
              </div>
              <p className="font-mono text-[11px] text-[var(--c-text-faint)]">
                Each draw advances an internal counter, so pressing Generate gives the next batch.
                Reset the seed to start the sequence over.
              </p>
            </>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
              The platform CSPRNG, <code className="font-mono">crypto.getRandomValues</code>, seeded
              by the operating system. Suitable for a token or a password. Not reproducible, so
              nothing generated here can be regenerated later.
            </p>
          )}
        </div>
      </Panel>

      <Segmented
        label="What to generate"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'numbers', label: 'Numbers' },
          { value: 'list', label: 'Lists' },
          { value: 'strings', label: 'Strings and IDs' },
          { value: 'dice', label: 'Dice' },
        ]}
      />

      {kind === 'numbers' && (
        <Numbers
          makeSource={makeSource}
          onDraw={() => setNonce((n) => n + 1)}
          format={format}
          setFormat={setFormat}
        />
      )}
      {kind === 'list' && (
        <Lists
          makeSource={makeSource}
          onDraw={() => setNonce((n) => n + 1)}
          format={format}
          setFormat={setFormat}
        />
      )}
      {kind === 'strings' && (
        <Strings
          makeSource={makeSource}
          onDraw={() => setNonce((n) => n + 1)}
          secure={sourceKind === 'system'}
        />
      )}
      {kind === 'dice' && <Dice makeSource={makeSource} onDraw={() => setNonce((n) => n + 1)} />}
    </div>
  );
}

/* ── Numbers ──────────────────────────────────────────────────────────── */

interface Shared {
  makeSource: () => Source;
  onDraw: () => void;
}

function Numbers({
  makeSource,
  onDraw,
  format,
  setFormat,
}: Shared & {
  format: OutputFormat;
  setFormat: (value: OutputFormat) => void;
}): React.ReactElement {
  const [request, setRequest] = usePersisted<NumberRequest>('rng.numbers', {
    count: 10,
    min: 1,
    max: 100,
    integer: true,
    precision: 4,
    distribution: 'uniform',
    unique: false,
    sort: 'none',
  });
  const [result, setResult] = useState<ReturnType<typeof generateNumbers> | null>(null);

  const set = useCallback(
    <K extends keyof NumberRequest>(key: K, value: NumberRequest[K]) => {
      setRequest({ ...request, [key]: value });
    },
    [request, setRequest],
  );

  const generate = useCallback(() => {
    onDraw();
    // The source is built after the nonce advances, so the next batch differs.
    setResult(generateNumbers(request, makeSource()));
  }, [makeSource, onDraw, request]);

  const distribution = DISTRIBUTIONS.find((entry) => entry.value === request.distribution);
  const text = result ? formatValues(result.values, format) : '';

  return (
    <>
      <Panel
        title="Settings"
        aside={
          <Toolbar>
            <Button onClick={generate} variant="primary">
              Generate
            </Button>
          </Toolbar>
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="How many" htmlFor="n-count" hint={`Up to ${num(MAX_COUNT)}`}>
            <NumberField
              id="n-count"
              value={request.count}
              onChange={(value) =>
                set('count', Math.max(1, Math.min(MAX_COUNT, Math.round(value))))
              }
            />
          </Field>
          <Field label="Minimum" htmlFor="n-min">
            <NumberField id="n-min" value={request.min} onChange={(value) => set('min', value)} />
          </Field>
          <Field label="Maximum" htmlFor="n-max" hint={request.integer ? 'Inclusive' : 'Exclusive'}>
            <NumberField id="n-max" value={request.max} onChange={(value) => set('max', value)} />
          </Field>
          <Field label="Type" htmlFor="n-type">
            <Select
              id="n-type"
              value={request.integer ? 'int' : 'float'}
              onChange={(value) => set('integer', value === 'int')}
              options={[
                { value: 'int', label: 'Integer' },
                { value: 'float', label: 'Float' },
              ]}
            />
          </Field>

          {!request.integer && (
            <Field label="Decimal places" htmlFor="n-precision">
              <NumberField
                id="n-precision"
                value={request.precision}
                onChange={(value) => set('precision', Math.max(0, Math.min(12, Math.round(value))))}
              />
            </Field>
          )}

          <Field label="Distribution" htmlFor="n-dist">
            <Select
              id="n-dist"
              value={request.distribution}
              onChange={(value) => set('distribution', value as Distribution)}
              options={DISTRIBUTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>

          <Field label="Order" htmlFor="n-sort">
            <Select
              id="n-sort"
              value={request.sort}
              onChange={(value) => set('sort', value as NumberRequest['sort'])}
              options={[
                { value: 'none', label: 'As drawn' },
                { value: 'asc', label: 'Ascending' },
                { value: 'desc', label: 'Descending' },
              ]}
            />
          </Field>

          <div className="flex items-end">
            <Toggle
              id="n-unique"
              label="No duplicates"
              checked={request.unique}
              onChange={(value) => set('unique', value)}
              title="Draw without replacement. Only possible while the range is wider than the count."
            />
          </div>
        </div>

        {distribution && (
          <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
            {distribution.note}
          </p>
        )}
      </Panel>

      {result && (
        <>
          {result.shortfall && <ErrorNote>{result.shortfall}</ErrorNote>}
          <Panel title="Distribution">
            <StatRow
              columns={6}
              stats={[
                { label: 'Count', value: num(result.values.length), tone: 'accent' },
                { label: 'Minimum', value: fmt(result.stats.min) },
                { label: 'Maximum', value: fmt(result.stats.max) },
                { label: 'Mean', value: fmt(result.stats.mean) },
                { label: 'Median', value: fmt(result.stats.median) },
                { label: 'Std dev', value: fmt(result.stats.stdev) },
              ]}
            />
            <Histogram values={result.values} min={request.min} max={request.max} />
          </Panel>

          <OutputBox
            title="Values"
            text={text}
            filename={`random.${format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt'}`}
            rows={14}
            aside={
              <Segmented
                label="Format"
                value={format}
                onChange={setFormat}
                options={OUTPUT_FORMATS.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                }))}
              />
            }
          />
        </>
      )}
    </>
  );
}

/** Trim a float for display without losing an integer's exactness. */
function fmt(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * Distribution check.
 *
 * Present because it is the only way to see that the distribution setting did
 * what it said. A list of numbers all looks equally random; the shape is where a
 * bad generator or a misread option shows itself.
 *
 * One hue, per the site's palette. No legend, because there is one series and
 * the panel title names it.
 */
function Histogram({
  values,
  min,
  max,
}: {
  values: readonly number[];
  min: number;
  max: number;
}): React.ReactElement | null {
  const buckets = useMemo(() => {
    if (values.length === 0) return null;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const span = hi - lo || 1;
    const width = Math.min(32, Math.max(8, Math.round(Math.sqrt(values.length))));
    const counts = new Array<number>(width).fill(0);
    for (const value of values) {
      const slot = Math.min(width - 1, Math.max(0, Math.floor(((value - lo) / span) * width)));
      counts[slot] = (counts[slot] ?? 0) + 1;
    }
    return { counts, lo, hi, width };
  }, [values, min, max]);

  if (!buckets) return null;
  const peak = Math.max(...buckets.counts, 1);
  const step = (buckets.hi - buckets.lo) / buckets.width;

  return (
    <div className="border-t border-[var(--c-line)] p-4">
      <div className="flex h-24 items-end gap-[2px]">
        {buckets.counts.map((count, i) => (
          <div
            key={i}
            title={`${fmt(buckets.lo + i * step)} to ${fmt(buckets.lo + (i + 1) * step)}: ${num(count)}`}
            style={{ height: `${Math.max(count > 0 ? 3 : 0, (count / peak) * 100)}%` }}
            className="flex-1 rounded-t-[3px] bg-[var(--c-accent-fill)] transition-[height]"
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--c-text-faint)]">
        <span>{fmt(buckets.lo)}</span>
        <span>
          {num(buckets.width)} buckets, peak {num(peak)}
        </span>
        <span>{fmt(buckets.hi)}</span>
      </div>
    </div>
  );
}

/* ── Lists ────────────────────────────────────────────────────────────── */

function Lists({
  makeSource,
  onDraw,
  format,
  setFormat,
}: Shared & {
  format: OutputFormat;
  setFormat: (value: OutputFormat) => void;
}): React.ReactElement {
  const [raw, setRaw] = usePersisted(
    'rng.list',
    'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\ngolf\nhotel',
  );
  const [mode, setMode] = useState<ListMode>('shuffle');
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<readonly string[] | null>(null);

  const items = useMemo(
    () =>
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    [raw],
  );

  const generate = useCallback(() => {
    onDraw();
    setResult(operateOnList(items, mode, count, makeSource()));
  }, [count, items, makeSource, mode, onDraw]);

  return (
    <>
      <Panel
        title="List"
        aside={
          <div className="flex items-center gap-2">
            <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
              {num(items.length)} items
            </span>
            <Button onClick={generate} variant="primary" disabled={items.length === 0}>
              Generate
            </Button>
          </div>
        }
      >
        <TextArea
          id="rng-list"
          value={raw}
          onChange={setRaw}
          rows={8}
          placeholder="One item per line. Blank lines and surrounding whitespace are ignored."
        />
        <div className="grid gap-4 border-t border-[var(--c-line)] p-4 sm:grid-cols-3">
          <Field label="Operation" htmlFor="l-mode">
            <Select
              id="l-mode"
              value={mode}
              onChange={(value) => setMode(value as ListMode)}
              options={[
                { value: 'shuffle', label: 'Shuffle all' },
                { value: 'sample', label: 'Sample without replacement' },
                { value: 'pick', label: 'Pick with replacement' },
              ]}
            />
          </Field>
          {mode !== 'shuffle' && (
            <Field
              label="How many"
              htmlFor="l-count"
              hint={
                mode === 'sample'
                  ? 'Capped at the list length: each item can be drawn once.'
                  : 'Unbounded: an item can repeat.'
              }
            >
              <NumberField
                id="l-count"
                value={count}
                onChange={(value) => setCount(Math.max(1, Math.round(value)))}
              />
            </Field>
          )}
          <div className="flex items-end">
            <p className="text-[11.5px] leading-relaxed text-[var(--c-text-faint)]">
              Shuffle is Fisher-Yates, so every ordering is equally likely. The naive{' '}
              <code className="font-mono">sort(() =&gt; Math.random() - 0.5)</code> is not, and is
              measurably biased.
            </p>
          </div>
        </div>
      </Panel>

      {result && (
        <OutputBox
          title="Result"
          text={formatValues(result, format)}
          filename="shuffled.txt"
          rows={14}
          aside={
            <Segmented
              label="Format"
              value={format}
              onChange={setFormat}
              options={OUTPUT_FORMATS.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          }
        />
      )}
    </>
  );
}

/* ── Strings ──────────────────────────────────────────────────────────── */

function Strings({ makeSource, onDraw, secure }: Shared & { secure: boolean }): React.ReactElement {
  const [length, setLength] = usePersisted('rng.str-length', 24);
  const [count, setCount] = usePersisted('rng.str-count', 5);
  const [alphabetId, setAlphabetId] = usePersisted('rng.alphabet', 'base58');
  const [uuids, setUuids] = useState(false);
  const [result, setResult] = useState<readonly string[] | null>(null);

  const alphabet = ALPHABETS.find((entry) => entry.value === alphabetId) ?? ALPHABETS[0]!;

  const generate = useCallback(() => {
    onDraw();
    const source = makeSource();
    setResult(
      Array.from({ length: Math.max(1, Math.min(1000, count)) }, () =>
        uuids ? uuid4(source) : randomString(length, alphabet.chars, source),
      ),
    );
  }, [alphabet, count, length, makeSource, onDraw, uuids]);

  const bits = uuids ? 122 : entropyBits(length, alphabet.chars.length);

  return (
    <>
      <Panel
        title="Settings"
        aside={
          <Button onClick={generate} variant="primary">
            Generate
          </Button>
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Alphabet" htmlFor="s-alphabet">
            <Select
              id="s-alphabet"
              value={alphabetId}
              onChange={setAlphabetId}
              options={ALPHABETS.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>
          <Field label="Length" htmlFor="s-length">
            <NumberField
              id="s-length"
              value={length}
              onChange={(value) => setLength(Math.max(1, Math.min(4096, Math.round(value))))}
            />
          </Field>
          <Field label="How many" htmlFor="s-count">
            <NumberField
              id="s-count"
              value={count}
              onChange={(value) => setCount(Math.max(1, Math.min(1000, Math.round(value))))}
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              id="s-uuid"
              label="UUID v4 instead"
              checked={uuids}
              onChange={setUuids}
              title="Version 4, variant 1, with the version and variant bits set correctly"
            />
          </div>
        </div>

        <div className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5">
          {!uuids && alphabet.note && (
            <p className="text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
              {alphabet.note}
            </p>
          )}
          <p className="mt-1 font-mono text-[11px] text-[var(--c-text-faint)]">
            {uuids
              ? '122 bits of randomness per UUID: 128 minus the 6 fixed version and variant bits.'
              : `${bits.toFixed(1)} bits per string, from ${alphabet.chars.length} characters at length ${length}.`}
          </p>
          {!secure && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--c-warn)]">
              The seeded source is generating these. Anyone with the seed can reproduce every value,
              so treat them as fixtures rather than secrets. Switch to the system source for
              anything that needs to be unguessable.
            </p>
          )}
        </div>
      </Panel>

      {result && (
        <OutputBox
          title={uuids ? 'UUIDs' : 'Strings'}
          text={result.join('\n')}
          filename={uuid_or_string(uuids)}
          rows={14}
          aside={
            result.length === 1 ? undefined : (
              <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
                {num(result.length)}
              </span>
            )
          }
        />
      )}
    </>
  );
}

function uuid_or_string(uuids: boolean): string {
  return uuids ? 'uuids.txt' : 'strings.txt';
}

/* ── Dice ─────────────────────────────────────────────────────────────── */

function Dice({ makeSource, onDraw }: Shared): React.ReactElement {
  const [notation, setNotation] = usePersisted('rng.dice', '3d6');
  const [rolls, setRolls] = useState(1);
  const [result, setResult] = useState<ReturnType<typeof rollDice>[] | null>(null);

  const generate = useCallback(() => {
    onDraw();
    const source = makeSource();
    setResult(
      Array.from({ length: Math.max(1, Math.min(10_000, rolls)) }, () =>
        rollDice(notation, source),
      ),
    );
  }, [makeSource, notation, onDraw, rolls]);

  const valid = result?.filter((roll): roll is NonNullable<typeof roll> => roll !== null) ?? [];
  const totals = valid.map((roll) => roll.total);
  const parsed = result !== null && result[0] !== null;

  return (
    <>
      <Panel
        title="Dice"
        aside={
          <Button onClick={generate} variant="primary">
            Roll
          </Button>
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <Field
            label="Notation"
            htmlFor="d-notation"
            hint="3d6, d20, 2d8+1. Up to 1,000 dice with up to a million faces."
          >
            <TextField
              id="d-notation"
              value={notation}
              onChange={setNotation}
              onEnter={generate}
              placeholder="3d6"
            />
          </Field>
          <Field label="Repeat" htmlFor="d-rolls" hint="Roll the same expression this many times.">
            <NumberField
              id="d-rolls"
              value={rolls}
              onChange={(value) => setRolls(Math.max(1, Math.min(10_000, Math.round(value))))}
            />
          </Field>
          <div className="flex items-end">
            <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
              <Kbd>Enter</Kbd> rolls
            </span>
          </div>
        </div>
      </Panel>

      {result !== null && !parsed && (
        <ErrorNote>
          &ldquo;{notation}&rdquo; is not dice notation. Try <code>3d6</code>, <code>d20</code> or{' '}
          <code>2d8+1</code>.
        </ErrorNote>
      )}

      {valid.length > 0 && (
        <>
          <Panel title={valid[0]!.notation}>
            <StatRow
              columns={5}
              stats={[
                { label: 'Rolls', value: num(valid.length) },
                { label: 'Total', value: fmt(totals.reduce((a, b) => a + b, 0)), tone: 'accent' },
                { label: 'Lowest', value: fmt(Math.min(...totals)) },
                { label: 'Highest', value: fmt(Math.max(...totals)) },
                {
                  label: 'Mean',
                  value: fmt(totals.reduce((a, b) => a + b, 0) / totals.length),
                },
              ]}
            />
            {valid.length > 1 && (
              <Histogram values={totals} min={Math.min(...totals)} max={Math.max(...totals) + 1} />
            )}
          </Panel>

          <OutputBox
            title="Rolls"
            text={valid
              .map((roll) =>
                roll.rolls.length === 1 && roll.modifier === 0
                  ? String(roll.total)
                  : `${roll.total}  =  ${roll.rolls.join(' + ')}${
                      roll.modifier
                        ? ` ${roll.modifier > 0 ? '+' : '-'} ${Math.abs(roll.modifier)}`
                        : ''
                    }`,
              )
              .join('\n')}
            filename="rolls.txt"
            rows={12}
          />
        </>
      )}
    </>
  );
}

export { CopyButton, DownloadButton };
