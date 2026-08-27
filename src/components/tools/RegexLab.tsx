/**
 * Regex Lab: match, replace, filter, and understand.
 *
 * Four modes over one input, because they are four questions about the same
 * text. Match highlights hits, Replace previews a substitution with a count,
 * Filter is `grep` with an include and an exclude list, and Explain annotates
 * the pattern itself.
 *
 * The pattern is deliberately not run until it has been checked for the shape
 * that hangs a browser. See `assessRisk` for why a warning is the only real
 * defence available.
 *
 * @see src/lib/regex-lab.ts for the engine
 */

import { useCallback, useDeferredValue, useMemo, useState } from 'react';

import {
  FLAGS,
  MAX_MATCHES,
  TEMPLATES,
  TEMPLATE_GROUPS,
  applyReplace,
  assessRisk,
  compile,
  countWords,
  explain,
  filterLines,
  runMatches,
  type FilterSpec,
  type Match,
  type Template,
  type Token,
} from '../../lib/regex-lab';
import {
  Badge,
  Button,
  CopyButton,
  ErrorNote,
  Field,
  OutputBox,
  Panel,
  PasteButton,
  StatRow,
  Tabs,
  TextArea,
  TextField,
  Toggle,
  Toolbar,
  num,
  usePersisted,
} from './ui';

type Mode = 'match' | 'replace' | 'filter' | 'explain';

/** Cap on rendered match rows. The tally view covers the rest. */
const ROW_LIMIT = 300;

export default function RegexLab(): React.ReactElement {
  const [mode, setMode] = useState<Mode>('match');
  const [pattern, setPattern] = usePersisted('regex.pattern', '\\b(\\w+)@(\\w+\\.\\w+)\\b');
  const [flags, setFlags] = usePersisted('regex.flags', 'i');
  const [text, setText] = usePersisted(
    'regex.text',
    'Reach me at guan@railtown.ai or the old first.last@example.co.uk address.\nSupport goes to help@example.com, not to noreply@example.com.',
  );
  const [replacement, setReplacement] = usePersisted('regex.replacement', '$1 [at] $2');
  const [acknowledged, setAcknowledged] = useState(false);

  const deferredText = useDeferredValue(text);
  const deferredPattern = useDeferredValue(pattern);
  const stale = deferredText !== text || deferredPattern !== pattern;

  const risk = useMemo(() => assessRisk(deferredPattern), [deferredPattern]);
  const blocked = risk.level === 'caution' && !acknowledged;

  const compiled = useMemo(
    () => (blocked ? 'held' : compile(deferredPattern, flags)),
    [blocked, deferredPattern, flags],
  );
  const regex = typeof compiled === 'string' ? null : compiled;
  const compileError = typeof compiled === 'string' && compiled !== 'held' ? compiled : undefined;

  const toggleFlag = useCallback(
    (flag: string) => {
      setFlags(flags.includes(flag) ? flags.replace(flag, '') : flags + flag);
    },
    [flags, setFlags],
  );

  const applyTemplate = useCallback(
    (template: Template) => {
      setPattern(template.pattern);
      setFlags(template.flags);
      setAcknowledged(false);
      if (template.sample) setText(template.sample);
    },
    [setFlags, setPattern, setText],
  );

  return (
    <div className="space-y-5">
      <Tabs
        active={mode}
        onChange={setMode}
        tabs={[
          { id: 'match', label: 'Match' },
          { id: 'replace', label: 'Replace' },
          { id: 'filter', label: 'Filter Lines' },
          { id: 'explain', label: 'Explain Pattern' },
        ]}
      />

      <Panel
        title="Pattern"
        cornerTicks
        aside={
          <div className="flex items-center gap-2">
            {stale && <Badge tone="busy">Matching</Badge>}
            <CopyButton text={`/${pattern}/${flags}`} label="Copy /pattern/" />
          </div>
        }
      >
        <div className="p-4">
          <div className="flex items-stretch rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] font-mono focus-within:ring-1 focus-within:ring-[var(--c-accent)]">
            <span className="flex items-center border-r border-[var(--c-line)] px-2 text-[13px] text-[var(--c-text-faint)]">
              /
            </span>
            <input
              type="text"
              value={pattern}
              spellCheck={false}
              autoComplete="off"
              aria-label="Regular expression"
              onChange={(event) => {
                setPattern(event.target.value);
                setAcknowledged(false);
              }}
              placeholder="\b\w+@\w+\.\w+\b"
              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[13px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:outline-none"
            />
            <span className="flex items-center border-l border-[var(--c-line)] px-2 text-[13px] font-semibold text-[var(--c-accent)]">
              /{flags}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {FLAGS.map((option) => (
              <Toggle
                key={option.flag}
                id={`flag-${option.flag}`}
                label={option.label}
                title={option.note}
                checked={flags.includes(option.flag)}
                onChange={() => toggleFlag(option.flag)}
              />
            ))}
          </div>
        </div>

        {risk.level === 'caution' && (
          <div className="border-t border-[var(--c-warn)] bg-[var(--c-raised)] px-4 py-3">
            <p className="text-[12px] leading-relaxed text-[var(--c-text)]">
              <span className="font-mono text-[11px] font-bold tracking-wide text-[var(--c-warn)] uppercase">
                Held before running
              </span>
              <br />
              {risk.reason}
            </p>
            {!acknowledged && (
              <div className="mt-2.5">
                <Button onClick={() => setAcknowledged(true)} variant="primary">
                  Run it anyway
                </Button>
                <span className="ml-2 font-mono text-[11px] text-[var(--c-text-faint)]">
                  If the tab freezes, closing it is the only way out.
                </span>
              </div>
            )}
          </div>
        )}

        {compileError && <ErrorNote>{compileError}</ErrorNote>}
      </Panel>

      <Panel
        title="Test String"
        cornerTicks
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <PasteButton onPaste={setText} />
            <Button variant="quiet" onClick={() => setText('')} disabled={text === ''}>
              Clear
            </Button>
          </div>
        }
      >
        <TextArea
          id="regex-text"
          value={text}
          onChange={setText}
          rows={8}
          placeholder="Paste text, or drop a file. Logs, config, CSV: whatever you are trying to pick apart."
        />
      </Panel>

      {mode === 'match' && <MatchMode text={deferredText} regex={regex} held={blocked} />}
      {mode === 'replace' && (
        <ReplaceMode
          text={deferredText}
          regex={regex}
          held={blocked}
          replacement={replacement}
          onReplacement={setReplacement}
        />
      )}
      {mode === 'filter' && <FilterMode text={deferredText} />}
      {mode === 'explain' && <ExplainMode pattern={deferredPattern} />}

      <Templates onPick={applyTemplate} active={pattern} />
    </div>
  );
}

/* ── Match ────────────────────────────────────────────────────────────── */

function MatchMode({
  text,
  regex,
  held,
}: {
  text: string;
  regex: RegExp | null;
  held: boolean;
}): React.ReactElement {
  const run = useMemo(() => (regex && !held ? runMatches(text, regex) : null), [held, regex, text]);

  if (held) {
    return (
      <Panel title="Matches">
        <p className="px-4 py-6 text-center font-mono text-[11.5px] text-[var(--c-text-faint)]">
          Not run. Acknowledge the warning above first.
        </p>
      </Panel>
    );
  }
  if (!run)
    return (
      <Panel title="Matches">
        <Empty />
      </Panel>
    );

  return (
    <>
      <Panel
        title="Matches"
        aside={
          <div className="flex items-center gap-2">
            {run.truncated && <Badge tone="warn">Truncated</Badge>}
            <span className="tabular font-mono text-[11px] text-[var(--c-text-faint)]">
              {run.elapsedMs.toFixed(1)} ms
            </span>
          </div>
        }
      >
        <StatRow
          columns={5}
          stats={[
            { label: 'Matches', value: num(run.matches.length), tone: 'accent' },
            { label: 'Distinct', value: num(run.tallies.length) },
            { label: 'Lines hit', value: num(run.matchedLines) },
            { label: 'Words in text', value: num(countWords(text)) },
            {
              label: 'Coverage',
              value: `${(
                (run.matches.reduce((sum, m) => sum + m.text.length, 0) / (text.length || 1)) *
                100
              ).toFixed(1)}%`,
              hint: 'of characters matched',
            },
          ]}
        />
        {run.error && <ErrorNote>{run.error}</ErrorNote>}
        {run.truncated && (
          <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2 text-[11.5px] text-[var(--c-text-muted)]">
            Stopped at {num(MAX_MATCHES)} matches or the time budget. The counts above are for what
            was collected, not for the whole input.
          </p>
        )}
        <Highlighted text={text} matches={run.matches} />
      </Panel>

      {run.matches.length > 0 && <MatchTable matches={run.matches} />}

      {run.tallies.length > 1 && (
        <Panel title="Frequency">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left font-mono text-[11.5px]">
              <tbody>
                {run.tallies.slice(0, 200).map((tally) => (
                  <tr key={tally.text} className="border-b border-[var(--c-line-faint)]">
                    <td className="tabular w-16 px-4 py-1.5 text-right text-[var(--c-accent)]">
                      {num(tally.count)}
                    </td>
                    <td className="px-4 py-1.5 break-all text-[var(--c-text)]">{tally.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

/**
 * The input with matches marked.
 *
 * Built by slicing between match offsets rather than by replacing in the string.
 * A replace-based highlighter has to escape its own markers and gets the offsets
 * wrong as soon as one match contains the marker text.
 */
function Highlighted({
  text,
  matches,
}: {
  text: string;
  matches: readonly Match[];
}): React.ReactElement {
  const parts = useMemo(() => {
    const out: Array<{ text: string; hit: boolean; index?: number }> = [];
    let cursor = 0;
    for (const match of matches.slice(0, ROW_LIMIT)) {
      if (match.index > cursor) out.push({ text: text.slice(cursor, match.index), hit: false });
      out.push({ text: match.text, hit: true, index: match.index });
      cursor = match.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
    return out;
  }, [matches, text]);

  return (
    <div className="max-h-72 overflow-auto border-t border-[var(--c-line)] bg-[var(--c-sunken)] p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
      {parts.length === 0 ? (
        <span className="text-[var(--c-text-faint)]">Nothing to show.</span>
      ) : (
        parts.map((part, i) =>
          part.hit ? (
            <mark
              key={i}
              className="rounded-[2px] bg-[var(--c-accent-fill)] px-[1px] text-[var(--c-accent-on-fill)]"
            >
              {/* An empty match still needs to be visible, or a \b pattern
                  reports 40 hits and shows nothing. */}
              {part.text === '' ? '​|' : part.text}
            </mark>
          ) : (
            <span key={i} className="text-[var(--c-text-muted)]">
              {part.text}
            </span>
          ),
        )
      )}
    </div>
  );
}

function MatchTable({ matches }: { matches: readonly Match[] }): React.ReactElement {
  const groups = matches[0]?.captures.length ?? 0;

  return (
    <Panel
      title="Captures"
      aside={
        <CopyButton
          label="Copy as TSV"
          text={matches
            .map((match) =>
              [
                match.line,
                match.column,
                match.text,
                ...match.captures.map((capture) => capture.value ?? ''),
              ].join('\t'),
            )
            .join('\n')}
        />
      }
    >
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left font-mono text-[11.5px]">
          <thead className="sticky top-0 bg-[var(--c-raised)]">
            <tr className="border-b border-[var(--c-line)]">
              <th className="px-3 py-1.5 font-normal text-[var(--c-text-faint)]">Line:Col</th>
              <th className="px-3 py-1.5 font-normal text-[var(--c-text-faint)]">Match</th>
              {Array.from({ length: groups }, (_, i) => (
                <th key={i} className="px-3 py-1.5 font-normal text-[var(--c-text-faint)]">
                  {matches[0]?.captures[i]?.name ?? `$${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, ROW_LIMIT).map((match, i) => (
              <tr key={i} className="border-b border-[var(--c-line-faint)]">
                <td className="tabular px-3 py-1.5 whitespace-nowrap text-[var(--c-text-faint)]">
                  {match.line}:{match.column}
                </td>
                <td className="px-3 py-1.5 break-all text-[var(--c-accent)]">{match.text}</td>
                {match.captures.map((capture) => (
                  <td key={capture.index} className="px-3 py-1.5 break-all text-[var(--c-text)]">
                    {capture.value === null ? (
                      <span className="text-[var(--c-text-faint)] italic">no match</span>
                    ) : capture.value === '' ? (
                      <span className="text-[var(--c-text-faint)] italic">empty</span>
                    ) : (
                      capture.value
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {matches.length > ROW_LIMIT && (
        <p className="border-t border-[var(--c-line)] px-4 py-2 font-mono text-[11px] text-[var(--c-text-faint)]">
          Showing the first {num(ROW_LIMIT)} of {num(matches.length)}. Copy as TSV gives every row.
        </p>
      )}
    </Panel>
  );
}

/* ── Replace ──────────────────────────────────────────────────────────── */

function ReplaceMode({
  text,
  regex,
  held,
  replacement,
  onReplacement,
}: {
  text: string;
  regex: RegExp | null;
  held: boolean;
  replacement: string;
  onReplacement: (value: string) => void;
}): React.ReactElement {
  const result = useMemo(
    () => (regex && !held ? applyReplace(text, regex, replacement) : null),
    [held, regex, replacement, text],
  );

  const delta = result ? result.output.length - text.length : 0;

  return (
    <>
      <Panel title="Replacement">
        <div className="p-4">
          <Field
            label="Template"
            htmlFor="replacement"
            hint="$1 for a group, $<name> for a named one, $& for the whole match, $$ for a literal dollar."
          >
            <TextField id="replacement" value={replacement} onChange={onReplacement} />
          </Field>
        </div>
        {result && (
          <StatRow
            columns={4}
            stats={[
              { label: 'Substitutions', value: num(result.count), tone: 'accent' },
              { label: 'Before', value: `${num(text.length)} ch` },
              { label: 'After', value: `${num(result.output.length)} ch` },
              {
                label: 'Change',
                value: `${delta >= 0 ? '+' : ''}${num(delta)}`,
                tone: delta === 0 ? 'default' : delta > 0 ? 'warn' : 'ok',
              },
            ]}
          />
        )}
        {result?.error && <ErrorNote>{result.error}</ErrorNote>}
      </Panel>

      <OutputBox
        title="Result"
        text={result?.output ?? ''}
        filename="replaced.txt"
        rows={16}
        empty={held ? 'Not run. Acknowledge the warning above first.' : 'Enter a pattern.'}
      />
    </>
  );
}

/* ── Filter ───────────────────────────────────────────────────────────── */

/**
 * Include and exclude terms, which is what a log filter actually needs.
 *
 * Kept separate from the pattern box on purpose. Expressing "has X but not Y" as
 * one regex needs a negative lookahead, and the result is write-only: nobody
 * reads `^(?!.*health).*GET.*$` back a week later and knows what it was for.
 */
function FilterMode({ text }: { text: string }): React.ReactElement {
  const [spec, setSpec] = usePersisted<FilterSpec>('regex.filter', {
    include: [],
    exclude: [],
    regex: false,
    caseSensitive: false,
    invert: false,
    dedupe: false,
    trim: false,
    dropBlank: true,
  });
  const [includeRaw, setIncludeRaw] = usePersisted('regex.include', 'ERROR');
  const [excludeRaw, setExcludeRaw] = usePersisted('regex.exclude', 'health');

  const terms = useCallback(
    (raw: string): string[] =>
      raw
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    [],
  );

  const result = useMemo(
    () =>
      filterLines(text, {
        ...spec,
        include: terms(includeRaw),
        exclude: terms(excludeRaw),
      }),
    [excludeRaw, includeRaw, spec, terms, text],
  );

  const set = useCallback(
    <K extends keyof FilterSpec>(key: K, value: FilterSpec[K]) => {
      setSpec({ ...spec, [key]: value });
    },
    [spec, setSpec],
  );

  return (
    <>
      <Panel title="Filter">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field
            label="Must contain (all)"
            htmlFor="f-include"
            hint="One term per line. A line must match every term to survive."
          >
            <textarea
              id="f-include"
              value={includeRaw}
              onChange={(event) => setIncludeRaw(event.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full resize-y rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-2.5 font-mono text-[12px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
            />
          </Field>
          <Field
            label="Must not contain (any)"
            htmlFor="f-exclude"
            hint="One term per line. Matching any of these drops the line."
          >
            <textarea
              id="f-exclude"
              value={excludeRaw}
              onChange={(event) => setExcludeRaw(event.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full resize-y rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-2.5 font-mono text-[12px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--c-line)] px-4 py-3">
          <Toggle
            id="f-regex"
            label="terms are regexes"
            checked={spec.regex}
            onChange={(value) => set('regex', value)}
            title="Off, terms are plain substrings and special characters are escaped for you"
          />
          <Toggle
            id="f-case"
            label="case sensitive"
            checked={spec.caseSensitive}
            onChange={(value) => set('caseSensitive', value)}
          />
          <Toggle
            id="f-invert"
            label="invert result"
            checked={spec.invert}
            onChange={(value) => set('invert', value)}
            title="Keep exactly the lines that would otherwise be dropped"
          />
          <Toggle
            id="f-dedupe"
            label="remove duplicates"
            checked={spec.dedupe}
            onChange={(value) => set('dedupe', value)}
          />
          <Toggle
            id="f-trim"
            label="trim lines"
            checked={spec.trim}
            onChange={(value) => set('trim', value)}
          />
          <Toggle
            id="f-blank"
            label="drop blank lines"
            checked={spec.dropBlank}
            onChange={(value) => set('dropBlank', value)}
          />
        </div>

        <StatRow
          columns={5}
          stats={[
            { label: 'Kept', value: num(result.kept), tone: 'accent' },
            { label: 'Of', value: num(result.total) },
            {
              label: 'Kept share',
              value: `${result.total > 0 ? ((result.kept / result.total) * 100).toFixed(1) : '0'}%`,
            },
            { label: 'Words', value: num(result.words) },
            { label: 'Duplicates cut', value: num(result.duplicatesRemoved) },
          ]}
        />
        {result.error && <ErrorNote>{result.error}</ErrorNote>}
      </Panel>

      <OutputBox
        title="Surviving lines"
        text={result.lines.join('\n')}
        filename="filtered.txt"
        rows={18}
        empty="No line matched. Loosen the include list, or check the exclude list is not catching everything."
      />
    </>
  );
}

/* ── Explain ──────────────────────────────────────────────────────────── */

const KIND_STYLE: Record<Token['kind'], string> = {
  literal: 'text-[var(--c-text)]',
  group: 'text-[var(--c-accent)] font-semibold',
  class: 'text-[var(--c-accent)]',
  quantifier: 'text-[var(--c-warn)] font-semibold',
  anchor: 'text-[var(--c-ok)] font-semibold',
  escape: 'text-[var(--c-accent)]',
  alternation: 'text-[var(--c-warn)] font-semibold',
};

function ExplainMode({ pattern }: { pattern: string }): React.ReactElement {
  const tokens = useMemo(() => explain(pattern), [pattern]);

  return (
    <Panel title="Pattern, piece by piece">
      {tokens.length === 0 ? (
        <Empty />
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left">
            <tbody>
              {tokens.map((token, i) => (
                <tr key={i} className="border-b border-[var(--c-line-faint)]">
                  <td className="w-32 px-4 py-2 align-top">
                    <code
                      className={`rounded-sm bg-[var(--c-sunken)] px-1.5 py-0.5 font-mono text-[12px] break-all ${KIND_STYLE[token.kind]}`}
                    >
                      {token.text === ' ' ? '␣' : token.text}
                    </code>
                  </td>
                  <td className="px-4 py-2 align-top text-[12px] leading-relaxed text-[var(--c-text-muted)]">
                    {token.note}
                  </td>
                  <td className="w-24 px-4 py-2 text-right align-top">
                    <span className="font-mono text-[10px] tracking-wide text-[var(--c-text-faint)] uppercase">
                      {token.kind}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Templates ────────────────────────────────────────────────────────── */

function Templates({
  onPick,
  active,
}: {
  onPick: (template: Template) => void;
  active: string;
}): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Panel
      title="Starting points"
      aside={
        <span className="font-mono text-[11px] text-[var(--c-text-faint)]">
          {num(TEMPLATES.length)} patterns
        </span>
      }
    >
      <div className="divide-y divide-[var(--c-line-faint)]">
        {TEMPLATE_GROUPS.map((group) => {
          const entries = TEMPLATES.filter((template) => template.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group} className="px-4 py-3">
              <p className="eyebrow">{group}</p>
              <div className="mt-2 space-y-1.5">
                {entries.map((template) => (
                  <div key={template.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPick(template)}
                        className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                          template.pattern === active
                            ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                            : 'border-[var(--c-line)] text-[var(--c-text-muted)] hover:border-[var(--c-line-strong)] hover:text-[var(--c-text)]'
                        }`}
                      >
                        {template.name}
                      </button>
                      <Button
                        onClick={() => setOpen(open === template.name ? null : template.name)}
                        variant="quiet"
                      >
                        {open === template.name ? 'less' : 'why'}
                      </Button>
                    </div>
                    {open === template.name && (
                      <p className="mt-1.5 max-w-[52rem] text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
                        {template.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Empty(): React.ReactElement {
  return (
    <p className="px-4 py-6 text-center font-mono text-[11.5px] text-[var(--c-text-faint)]">
      Enter a pattern above.
    </p>
  );
}

export { Toolbar };
