/**
 * String Kit: the HTML-to-Markdown converter, plus a shelf of transforms.
 *
 * Two modes rather than two pages. The converter is the reason to come here and
 * needs its own controls; the transforms are a long tail that all share one
 * shape (text in, text out) and would be twenty near-identical pages.
 *
 * Every output has copy and download, which is the entire point of a tool like
 * this. The input persists across reloads, because losing a pasted document to a
 * stray refresh is the most annoying thing this page could do.
 *
 * @see src/lib/html-to-markdown.ts for the converter
 * @see src/lib/string-kit.ts for the transform registry
 */

import { useCallback, useDeferredValue, useMemo, useState } from 'react';

import { DEFAULT_OPTIONS, htmlToMarkdown, type MarkdownOptions } from '../../lib/html-to-markdown';
import {
  TRANSFORMS,
  TRANSFORM_GROUPS,
  findTransform,
  textStats,
  type Transform,
  type TransformGroup,
} from '../../lib/string-kit';
import {
  Badge,
  Button,
  CopyButton,
  DownloadButton,
  ErrorNote,
  Field,
  NumberField,
  OutputBox,
  Panel,
  PasteButton,
  Select,
  StatRow,
  Tabs,
  TextArea,
  Toggle,
  Toolbar,
  num,
  usePersisted,
} from './ui';

type Mode = 'markdown' | 'transform';

const SAMPLE_HTML = `<!doctype html>
<html>
<head><title>Release notes</title><style>.x{color:red}</style></head>
<body>
  <nav class="site-nav"><a href="/">Home</a> <a href="/docs">Docs</a></nav>
  <div class="cookie-banner">We use cookies. <button>Accept</button></div>

  <article>
    <h1>particle-wave 1.4.0</h1>
    <p class="byline">Published <time datetime="2026-06-14">14 June 2026</time></p>

    <p>The extractor now ships its <strong>own</strong> browser engine, so a
       wheel and an npm tarball built from one commit <em>cannot</em> disagree
       about what release they are.</p>

    <h2>Breaking</h2>
    <ul>
      <li><code>Pipeline.run()</code> no longer writes to disk. Use
          <code>build()</code> and serialise yourself.</li>
      <li>The <code>--legacy-sampler</code> flag is gone.</li>
    </ul>

    <h2>Numbers</h2>
    <table>
      <thead><tr><th>Stage</th><th align="right">Before</th><th align="right">After</th></tr></thead>
      <tbody>
        <tr><td>Preprocess</td><td align="right">180 ms</td><td align="right">95 ms</td></tr>
        <tr><td>Extract</td><td align="right">1,240 ms</td><td align="right">410 ms</td></tr>
      </tbody>
    </table>

    <blockquote><p>Claims about a physics engine are cheap; letting the reader
      move the spring constant is not.</p></blockquote>

    <pre><code class="language-python">from particle_wave.tool.pipeline import Pipeline
cloud = Pipeline().build("photo.png")</code></pre>

    <p>See the <a href="/projects/particle-wave/" title="Project page">project
       page</a> or <img src="/img/diagram.png" alt="the pipeline diagram">.</p>
  </article>

  <aside class="related"><h3>Related</h3><ul><li><a href="/x">One</a></li></ul></aside>
  <footer>© 2026</footer>
  <script>analytics.track('view')</script>
</body>
</html>`;

export default function StringKit(): React.ReactElement {
  const [mode, setMode] = useState<Mode>('markdown');
  const [input, setInput] = usePersisted('string-kit.input', '');
  const [options, setOptions] = usePersisted<MarkdownOptions>(
    'string-kit.md-options',
    DEFAULT_OPTIONS,
  );
  const [transformId, setTransformId] = usePersisted('string-kit.transform', 'html-escape');

  // Conversion of a large document is not free, and typing must not wait for it.
  const deferred = useDeferredValue(input);
  const stale = deferred !== input;

  const set = useCallback(
    <K extends keyof MarkdownOptions>(key: K, value: MarkdownOptions[K]) => {
      setOptions({ ...options, [key]: value });
    },
    [options, setOptions],
  );

  const stats = useMemo(() => textStats(deferred), [deferred]);

  return (
    <div className="space-y-5">
      <Tabs
        active={mode}
        onChange={setMode}
        tabs={[
          { id: 'markdown', label: 'HTML to Markdown' },
          { id: 'transform', label: 'Transforms' },
        ]}
      />

      <Panel
        title="Input"
        cornerTicks
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <PasteButton onPaste={setInput} />
            {mode === 'markdown' && (
              <Button variant="quiet" onClick={() => setInput(SAMPLE_HTML)}>
                Load example
              </Button>
            )}
            <Button variant="quiet" onClick={() => setInput('')} disabled={input === ''}>
              Clear
            </Button>
          </div>
        }
      >
        <TextArea
          id="string-kit-input"
          value={input}
          onChange={setInput}
          rows={mode === 'markdown' ? 10 : 7}
          placeholder={
            mode === 'markdown'
              ? 'Paste raw HTML, or drop an .html file. The page chrome and noise are stripped automatically.'
              : 'Paste or drop any text.'
          }
        />
        <StatRow
          columns={6}
          stats={[
            { label: 'Characters', value: num(stats.chars) },
            { label: 'Bytes', value: num(stats.bytes), hint: 'UTF-8' },
            { label: 'Words', value: num(stats.words) },
            { label: 'Lines', value: num(stats.lines) },
            { label: 'Paragraphs', value: num(stats.paragraphs) },
            { label: 'Distinct chars', value: num(stats.uniqueChars) },
          ]}
        />
      </Panel>

      {mode === 'markdown' ? (
        <MarkdownMode html={deferred} options={options} set={set} stale={stale} />
      ) : (
        <TransformMode
          input={deferred}
          transformId={transformId}
          onPick={setTransformId}
          onReplaceInput={setInput}
          stale={stale}
        />
      )}
    </div>
  );
}

/* ── HTML to Markdown ─────────────────────────────────────────────────── */

function MarkdownMode({
  html,
  options,
  set,
  stale,
}: {
  html: string;
  options: MarkdownOptions;
  set: <K extends keyof MarkdownOptions>(key: K, value: MarkdownOptions[K]) => void;
  stale: boolean;
}): React.ReactElement {
  // Guarded rather than trusted. `DOMParser` will not throw on bad markup, but
  // the extraction pass walks whatever tree comes back, and a hostile document
  // is exactly the input this tool invites.
  const report = useMemo(() => {
    try {
      return htmlToMarkdown(html, options);
    } catch (error) {
      return {
        markdown: '',
        dropped: [] as ReadonlyArray<{ tag: string; count: number }>,
        unhandled: [] as readonly string[],
        stats: {
          inputChars: html.length,
          outputChars: 0,
          headings: 0,
          links: 0,
          images: 0,
          codeBlocks: 0,
          tables: 0,
        },
        error: error instanceof Error ? error.message : 'Conversion failed.',
      };
    }
  }, [html, options]);

  const ratio =
    report.stats.inputChars > 0 ? (report.stats.outputChars / report.stats.inputChars) * 100 : 0;

  return (
    <>
      <Panel
        title="Conversion"
        aside={
          stale ? (
            <Badge tone="busy">Converting</Badge>
          ) : report.extractedFrom ? (
            <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
              content from <span className="text-[var(--c-accent)]">{report.extractedFrom}</span>
            </span>
          ) : undefined
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2.5">
            <Toggle
              id="md-extract"
              label="Strip page chrome"
              checked={options.extractMain}
              onChange={(value) => set('extractMain', value)}
              title="Find the article and drop navigation, banners, share bars and footers"
            />
            <Toggle
              id="md-tables"
              label="Keep tables as tables"
              checked={options.tables}
              onChange={(value) => set('tables', value)}
              title="Off, tables become lists. A table with merged cells always becomes a list."
            />
            <Toggle
              id="md-refs"
              label="Reference-style links"
              checked={options.referenceLinks}
              onChange={(value) => set('referenceLinks', value)}
              title="Collect link targets at the end instead of inline"
            />
          </div>

          <Field label="Images" htmlFor="md-images">
            <Select
              id="md-images"
              value={options.images}
              onChange={(value) => set('images', value)}
              options={[
                { value: 'keep', label: 'Keep as Markdown images' },
                { value: 'alt-only', label: 'Alt text only' },
                { value: 'drop', label: 'Drop entirely' },
              ]}
            />
          </Field>

          <Field label="Headings" htmlFor="md-headings">
            <Select
              id="md-headings"
              value={options.headings}
              onChange={(value) => set('headings', value)}
              options={[
                { value: 'atx', label: '## ATX style' },
                { value: 'setext', label: 'Underlined (Setext)' },
              ]}
            />
          </Field>

          <Field label="Bullets" htmlFor="md-bullet">
            <Select
              id="md-bullet"
              value={options.bullet}
              onChange={(value) => set('bullet', value)}
              options={[
                { value: '-', label: '- hyphen' },
                { value: '*', label: '* asterisk' },
              ]}
            />
          </Field>

          <Field label="Emphasis" htmlFor="md-emphasis">
            <Select
              id="md-emphasis"
              value={options.emphasis}
              onChange={(value) => set('emphasis', value)}
              options={[
                { value: '_', label: '_underscore_' },
                { value: '*', label: '*asterisk*' },
              ]}
            />
          </Field>

          <Field
            label="Wrap column"
            htmlFor="md-wrap"
            hint="0 leaves paragraphs on one line, which keeps diffs clean."
          >
            <NumberField
              id="md-wrap"
              value={options.wrap}
              onChange={(value) => set('wrap', Math.max(0, Math.min(200, Math.round(value))))}
              min={0}
              max={200}
            />
          </Field>
        </div>

        <StatRow
          columns={6}
          stats={[
            {
              label: 'Size',
              value: `${ratio.toFixed(0)}%`,
              hint: `${num(report.stats.outputChars)} of ${num(report.stats.inputChars)}`,
              tone: 'accent',
            },
            { label: 'Headings', value: num(report.stats.headings) },
            { label: 'Links', value: num(report.stats.links) },
            { label: 'Images', value: num(report.stats.images) },
            { label: 'Code blocks', value: num(report.stats.codeBlocks) },
            { label: 'Tables', value: num(report.stats.tables) },
          ]}
        />
      </Panel>

      {report.error && <ErrorNote>{report.error}</ErrorNote>}

      <OutputBox
        title="Markdown"
        text={report.markdown}
        filename="converted.md"
        mime="text/markdown;charset=utf-8"
        rows={20}
        empty="Paste HTML above, or load the example."
      />

      {(report.dropped.length > 0 || report.unhandled.length > 0) && (
        <Panel title="What was discarded">
          <div className="space-y-3 p-4 text-[12px] leading-relaxed">
            {report.dropped.length > 0 && (
              <div>
                <p className="eyebrow">Removed</p>
                <p className="mt-1.5 font-mono text-[11.5px] text-[var(--c-text-muted)]">
                  {report.dropped
                    .map((entry) => `${entry.tag}${entry.count > 1 ? ` x${entry.count}` : ''}`)
                    .join(' · ')}
                </p>
              </div>
            )}
            {report.unhandled.length > 0 && (
              <div>
                <p className="eyebrow">Unwrapped</p>
                <p className="mt-1.5 font-mono text-[11.5px] text-[var(--c-text-muted)]">
                  {report.unhandled.join(' · ')}
                </p>
                <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">
                  These tags have no Markdown equivalent. Their text was kept and the tag itself
                  dropped.
                </p>
              </div>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}

/* ── Transforms ───────────────────────────────────────────────────────── */

function TransformMode({
  input,
  transformId,
  onPick,
  onReplaceInput,
  stale,
}: {
  input: string;
  transformId: string;
  onPick: (id: string) => void;
  onReplaceInput: (text: string) => void;
  stale: boolean;
}): React.ReactElement {
  const transform = findTransform(transformId) ?? TRANSFORMS[0]!;
  const inverse = transform.inverse ? findTransform(transform.inverse) : undefined;

  const result = useMemo(() => {
    if (input === '') return { output: '', error: undefined as string | undefined };
    try {
      return { output: transform.run(input), error: undefined };
    } catch (error) {
      return {
        output: '',
        error: error instanceof Error ? error.message : 'The transform failed on this input.',
      };
    }
  }, [input, transform]);

  /**
   * Does this transform survive a round trip on the current input?
   *
   * Shown because it is the one property that matters and the one nobody checks.
   * A `base64 -> decode` pair that does not round-trip is silently corrupting
   * data, and this catches it on the actual input rather than on a test vector.
   */
  const roundTrip = useMemo(() => {
    if (!inverse || input === '' || result.error) return null;
    try {
      return inverse.run(result.output) === input;
    } catch {
      return false;
    }
  }, [inverse, input, result]);

  const grouped = useMemo(() => {
    const map = new Map<TransformGroup, Transform[]>();
    for (const entry of TRANSFORMS) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <>
      <Panel title="Transform" aside={stale ? <Badge tone="busy">Working</Badge> : undefined}>
        <div className="space-y-3.5 p-4">
          {grouped.map(([group, entries]) => (
            <div key={group}>
              <p className="eyebrow">{TRANSFORM_GROUPS[group]}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    title={entry.note}
                    onClick={() => onPick(entry.id)}
                    className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                      entry.id === transform.id
                        ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                        : 'border-[var(--c-line)] text-[var(--c-text-muted)] hover:border-[var(--c-line-strong)] hover:text-[var(--c-text)]'
                    }`}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--c-text)]">{transform.note}</p>
          <Toolbar>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {transform.sample && (
                <Button onClick={() => onReplaceInput(transform.sample!)}>Load example</Button>
              )}
              {inverse && (
                <Button onClick={() => onPick(inverse.id)} title={inverse.note}>
                  Reverse: {inverse.name}
                </Button>
              )}
              {result.output !== '' && !result.error && (
                <Button
                  onClick={() => onReplaceInput(result.output)}
                  title="Move the result into the input, to chain another transform onto it"
                >
                  Chain result
                </Button>
              )}
              {roundTrip !== null && (
                <Badge tone={roundTrip ? 'ok' : 'warn'}>
                  {roundTrip ? 'Round trips exactly' : 'Does not round trip'}
                </Badge>
              )}
            </div>
          </Toolbar>
          {roundTrip === false && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-warn)]">
              Running {inverse?.name} on this result does not give the input back. For a lossy
              transform that is expected. For an encoder it means something was dropped, and the
              character list under Inspect will show what.
            </p>
          )}
        </div>
      </Panel>

      {result.error && <ErrorNote>{result.error}</ErrorNote>}

      <OutputBox
        title="Result"
        text={result.output}
        filename={`${transform.id}.txt`}
        rows={16}
        aside={
          result.output !== '' ? (
            <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
              {num(result.output.length)} chars
            </span>
          ) : undefined
        }
        empty={input === '' ? 'Paste something above.' : 'This transform produced nothing.'}
      />
    </>
  );
}

/* Re-exported so a page can offer the same controls without importing two modules. */
export { CopyButton, DownloadButton };
