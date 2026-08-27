/**
 * Shared controls for the tool islands.
 *
 * Four tools built independently drift into four different button styles. These
 * primitives exist so they do not: every island composes the same segmented
 * control, the same stat tile, the same panel. Nothing here holds state beyond
 * what a single control needs.
 *
 * All colour comes from `src/styles/tokens.css` via `var(--c-*)`, so both
 * themes are handled without a single conditional.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ── Panels ───────────────────────────────────────────────────────────── */

interface PanelProps {
  /** Small uppercase label in the panel's header rail. */
  title: string;
  /** Right-aligned header content — counts, controls, status. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A titled section. The header rail is what makes a dense page scannable. */
export function Panel({ title, aside, children, className = '' }: PanelProps): React.ReactElement {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] ${className}`}
    >
      <header className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2">
        <span className="eyebrow">{title}</span>
        {aside}
      </header>
      {children}
    </section>
  );
}

/* ── Stats ────────────────────────────────────────────────────────────── */

export interface Stat {
  readonly label: string;
  readonly value: string;
  /** Secondary line under the figure. */
  readonly hint?: string;
  /** Tints the figure — for a number that carries a verdict. */
  readonly tone?: 'default' | 'ok' | 'warn' | 'alert' | 'accent';
}

const TONE_COLOR: Record<NonNullable<Stat['tone']>, string> = {
  default: 'var(--c-text)',
  ok: 'var(--c-ok)',
  warn: 'var(--c-warn)',
  alert: 'var(--c-alert)',
  accent: 'var(--c-accent)',
};

/**
 * A row of figures. Hairline-separated rather than boxed, so a four-up and a
 * six-up read as the same component at different widths.
 *
 * `columns` sets the count at full width, not a fixed grid: it is converted to
 * a minimum tile width and handed to `auto-fit`, so the row reflows to fewer
 * columns on a narrow screen instead of squeezing six figures into a phone. The
 * `min(100%, …)` guard keeps a single tile from overflowing a container
 * narrower than the minimum.
 */
export function StatRow({
  stats,
  columns = 4,
}: {
  stats: readonly Stat[];
  columns?: 2 | 3 | 4 | 5 | 6;
}): React.ReactElement {
  const minTile = `${(44 / columns).toFixed(2)}rem`;
  return (
    <dl
      className="grid gap-px bg-[var(--c-line)]"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minTile}), 1fr))` }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="bg-[var(--c-surface)] px-4 py-3">
          <dt className="eyebrow">{stat.label}</dt>
          <dd
            className="tabular mt-1.5 font-mono text-lg leading-none"
            style={{ color: TONE_COLOR[stat.tone ?? 'default'] }}
          >
            {stat.value}
          </dd>
          {stat.hint && (
            <dd className="mt-1 text-[11px] text-[var(--c-text-faint)]">{stat.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/* ── Segmented control ────────────────────────────────────────────────── */

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
  /**
   * Offered but not selectable, with `title` carrying the reason.
   *
   * Preferred over dropping the option: an option that vanishes looks like a
   * feature that does not exist, where a dimmed one with a tooltip says the
   * feature is real and currently unavailable. A segmented control whose
   * options are always clickable is also a way to route around whatever gate
   * the surrounding UI thinks it is applying, which is exactly how the
   * embedding engine got called on a deployment that has no endpoint for it.
   */
  readonly disabled?: boolean;
}

/**
 * Mutually exclusive choice, rendered as a hairline-joined button strip.
 *
 * Preferred over a `<select>` wherever the option count is small: the choices
 * stay visible, which matters when the option *is* the explanation.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<Segment<T>>;
  onChange: (value: T) => void;
  label?: string;
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap overflow-hidden rounded-sm border border-[var(--c-line)]"
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 font-mono text-[11px] whitespace-nowrap transition-colors ${
              i > 0 ? 'border-l border-[var(--c-line)]' : ''
            } ${
              option.disabled
                ? 'cursor-not-allowed text-[var(--c-text-faint)] line-through decoration-1'
                : active
                  ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                  : 'text-[var(--c-text-muted)] hover:bg-[var(--c-raised)] hover:text-[var(--c-text)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Slider ───────────────────────────────────────────────────────────── */

/** Labelled range input with the live value in the label, where it is read. */
export function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className={disabled ? 'opacity-40' : undefined}>
      <label htmlFor={id} className="eyebrow flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span className="tabular text-[var(--c-text)]">
          {value.toLocaleString('en-US')}
          {suffix}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--c-accent)]"
      />
    </div>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────── */

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled = false,
  type = 'button',
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'primary' | 'quiet';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}): React.ReactElement {
  const styles: Record<string, string> = {
    primary:
      'border-transparent bg-[var(--c-accent-fill)] text-[var(--c-accent-on-fill)] hover:brightness-95',
    ghost:
      'border-[var(--c-line)] text-[var(--c-text-muted)] hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]',
    quiet: 'border-transparent text-[var(--c-text-faint)] hover:text-[var(--c-text)]',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

/** Copy-to-clipboard button that confirms in place, then reverts. */
export function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string;
  label?: string;
}): React.ReactElement {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1400);
    });
  }, [text]);

  return (
    <Button onClick={copy} disabled={text.length === 0}>
      {done ? 'Copied' : label}
    </Button>
  );
}

/* ── Text input ───────────────────────────────────────────────────────── */

/**
 * The standard paste target.
 *
 * Accepts a dropped text file, because "paste two files" is what these tools
 * are actually asked to do and reaching for the clipboard twice is friction.
 */
export function TextArea({
  id,
  value,
  onChange,
  rows = 10,
  placeholder,
  accept = true,
  className = '',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Accept dropped files. */
  accept?: boolean;
  className?: string;
}): React.ReactElement {
  const [over, setOver] = useState(false);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      if (!accept) return;
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      event.preventDefault();
      setOver(false);
      void file.text().then(onChange);
    },
    [accept, onChange],
  );

  return (
    <textarea
      id={id}
      value={value}
      spellCheck={false}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onDragOver={
        accept
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={accept ? () => setOver(false) : undefined}
      onDrop={onDrop}
      className={`w-full resize-y border-0 bg-[var(--c-sunken)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:outline-none ${
        over ? 'ring-2 ring-[var(--c-accent)] ring-inset' : ''
      } ${className}`}
    />
  );
}

/* ── Status ───────────────────────────────────────────────────────────── */

export type Tone = 'ok' | 'warn' | 'alert' | 'idle' | 'busy';

const BADGE_TONE: Record<Tone, string> = {
  ok: 'text-[var(--c-ok)] border-[var(--c-ok)]',
  warn: 'text-[var(--c-warn)] border-[var(--c-warn)]',
  alert: 'text-[var(--c-alert)] border-[var(--c-alert)]',
  idle: 'text-[var(--c-text-faint)] border-[var(--c-line)]',
  busy: 'text-[var(--c-accent)] border-[var(--c-accent)]',
};

/** Small outlined status pill. */
export function Badge({
  tone = 'idle',
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${BADGE_TONE[tone]}`}
    >
      {tone === 'busy' && (
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

/** Inline error strip. Used wherever a failure needs to be readable, not thrown. */
export function ErrorNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="rounded-sm border border-[var(--c-alert)] bg-[var(--c-alert-soft)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--c-alert)]">
      {children}
    </p>
  );
}

/* ── Misc ─────────────────────────────────────────────────────────────── */

/** Stable id suffix for a component instance, for label/control pairing. */
export function useInstanceId(prefix: string): string {
  const id = useMemo(() => `${prefix}-${Math.random().toString(36).slice(2, 8)}`, [prefix]);
  return id;
}

/** `1,234` — the only number formatting rule this codebase has. */
export function num(value: number): string {
  return value.toLocaleString('en-US');
}

/* ── Output ───────────────────────────────────────────────────────────── */

/**
 * Download a string as a file.
 *
 * Sibling to `CopyButton` and present for the same reason: a converter that
 * produces 4,000 lines of Markdown is not usefully delivered through the
 * clipboard, and asking someone to select-all inside a scrolling `<pre>` is
 * the kind of friction these tools exist to remove.
 */
export function DownloadButton({
  text,
  filename,
  label = 'Download',
  mime = 'text/plain;charset=utf-8',
}: {
  text: string;
  filename: string;
  label?: string;
  mime?: string;
}): React.ReactElement {
  const save = useCallback(() => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Revoked on the next frame rather than immediately: revoking too early
    // has been observed to cancel the download in Safari.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }, [text, filename, mime]);

  return (
    <Button onClick={save} disabled={text.length === 0} title={filename}>
      {label}
    </Button>
  );
}

/**
 * Read the clipboard into an input.
 *
 * Renders nothing where `navigator.clipboard.readText` does not exist, because
 * a button that cannot work is worse than no button. Firefox withholds it
 * outside an extension, so this is a real branch rather than a defensive one.
 */
export function PasteButton({
  onPaste,
  label = 'Paste',
}: {
  onPaste: (text: string) => void;
  label?: string;
}): React.ReactElement | null {
  const [failed, setFailed] = useState(false);
  const supported =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  if (!supported || failed) return null;

  return (
    <Button
      onClick={() => {
        navigator.clipboard.readText().then(onPaste, () => setFailed(true));
      }}
      title="Read the clipboard"
    >
      {label}
    </Button>
  );
}

/**
 * A read-only result surface with copy and download in its header.
 *
 * Every converter on this site ends in one of these, so "can I get this out of
 * the page" has the same answer everywhere.
 */
export function OutputBox({
  title,
  text,
  filename,
  mime,
  rows = 14,
  aside,
  empty = 'Nothing yet.',
}: {
  title: string;
  text: string;
  filename: string;
  mime?: string;
  rows?: number;
  /** Extra header content, placed left of the copy controls. */
  aside?: React.ReactNode;
  empty?: string;
}): React.ReactElement {
  return (
    <Panel
      title={title}
      aside={
        <div className="flex items-center gap-2">
          {aside}
          <CopyButton text={text} />
          <DownloadButton text={text} filename={filename} mime={mime} />
        </div>
      }
    >
      {text ? (
        <pre
          className="overflow-auto bg-[var(--c-sunken)] p-3.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--c-text)]"
          style={{ maxHeight: `${rows * 1.6}rem` }}
        >
          {text}
        </pre>
      ) : (
        <p className="bg-[var(--c-sunken)] px-3.5 py-6 font-mono text-[11.5px] text-[var(--c-text-faint)]">
          {empty}
        </p>
      )}
    </Panel>
  );
}

/* ── Form fields ──────────────────────────────────────────────────────── */

const FIELD_CLASS =
  'w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none';

/** Labelled wrapper, so every control on a page shares one baseline. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="eyebrow block">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">{hint}</p>}
    </div>
  );
}

/** Single-line text input. */
export function TextField({
  id,
  value,
  onChange,
  placeholder,
  mono = true,
  onEnter,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  onEnter?: () => void;
}): React.ReactElement {
  return (
    <input
      id={id}
      type="text"
      value={value}
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? (e) => e.key === 'Enter' && onEnter() : undefined}
      className={`${FIELD_CLASS} ${mono ? '' : 'font-sans text-[13px]'}`}
    />
  );
}

/**
 * Numeric input that keeps its own text while being edited.
 *
 * A controlled `<input type="number">` bound straight to a number cannot be
 * typed into: clearing it to type a new value round-trips through `NaN`, and an
 * intermediate `-` or `1.` is not a number either. So the raw string is the
 * state and the number is derived, which is the only version that lets someone
 * type `-0.5` one character at a time.
 */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      step={step}
      className={FIELD_CLASS}
    />
  );
}

/** Native select, styled to match. Used past the point a segmented strip fits. */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={FIELD_CLASS}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Checkbox with its label as the hit target. */
export function Toggle({
  id,
  label,
  checked,
  onChange,
  title,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}): React.ReactElement {
  return (
    <label
      htmlFor={id}
      title={title}
      className="flex cursor-pointer items-center gap-2 font-mono text-[11.5px] text-[var(--c-text-muted)] select-none hover:text-[var(--c-text)]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--c-accent)]"
      />
      {label}
    </label>
  );
}

/** Horizontal control rail. The row above every instrument on this site. */
export function Toolbar({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** A keyboard shortcut, rendered as a key. */
export function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd className="rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-1 py-0.5 font-mono text-[10px] text-[var(--c-text-muted)]">
      {children}
    </kbd>
  );
}

/* ── Persistence ──────────────────────────────────────────────────────── */

/**
 * State that survives a reload, scoped per tool.
 *
 * Losing a pasted document to an accidental refresh is the most annoying thing
 * a tool like this can do. Every read and write is guarded: `localStorage`
 * throws outright in a browser configured to block site data, and a tool that
 * fails to boot because of a privacy setting is worse than one that forgets.
 */
export function usePersisted<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `coronring.tools.${key}`;
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  // Read after mount, never during render. Astro ships markup rendered from
  // `initial`, so reading storage in the initial state would make the first
  // client render disagree with the HTML and get thrown away.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* unavailable or corrupt: the default stands */
    }
    loaded.current = true;
  }, [storageKey]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (!loaded.current) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* quota or blocked: in-memory state still works */
      }
    },
    [storageKey],
  );

  return [value, update];
}
