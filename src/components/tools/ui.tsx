/**
 * Shared controls for the tool islands.
 *
 * Designed with a tactical HUD sci-fi aesthetic inspired by Endfield.
 * All colour comes from `src/styles/tokens.css` via `var(--c-*)`, so both
 * themes are handled seamlessly without conditionals.
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
  /** Show technical corner bracket accents on the panel. */
  cornerTicks?: boolean;
}

/** A titled section. The header rail is what makes a dense page scannable. */
export function Panel({
  title,
  aside,
  children,
  className = '',
  cornerTicks = false,
}: PanelProps): React.ReactElement {
  return (
    <section
      className={`relative overflow-hidden rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] shadow-[var(--shadow-panel)] ${
        cornerTicks ? 'corner-ticks' : ''
      } ${className}`}
    >
      <header className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 bg-[var(--c-accent-fill)]" />
          <span className="eyebrow font-mono text-[11px] tracking-widest text-[var(--c-text)]">
            {title}
          </span>
        </div>
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
      className="grid gap-px border-y border-[var(--c-line)] bg-[var(--c-line)]"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minTile}), 1fr))` }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="group relative bg-[var(--c-surface)] px-4 py-3 transition-colors hover:bg-[var(--c-raised)]"
        >
          <dt className="eyebrow text-[10px] text-[var(--c-text-faint)]">{stat.label}</dt>
          <dd
            className="tabular mt-1.5 font-mono text-lg leading-none font-semibold tracking-tight"
            style={{ color: TONE_COLOR[stat.tone ?? 'default'] }}
          >
            {stat.value}
          </dd>
          {stat.hint && (
            <dd className="mt-1 font-mono text-[10.5px] text-[var(--c-text-faint)]">{stat.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/* ── Top-level Workspace Tabs ─────────────────────────────────────────── */

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly badge?: string | number;
  readonly badgeTone?: Tone;
  readonly disabled?: boolean;
}

/**
 * Primary workspace tab bar for switching major modes (e.g. Diff vs Semantic).
 */
export function Tabs<T extends string>({
  active,
  tabs,
  onChange,
  className = '',
}: {
  active: T;
  tabs: ReadonlyArray<TabItem<T>>;
  onChange: (tab: T) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 overflow-x-auto border-b border-[var(--c-line)] pb-px ${className}`}
    >
      {tabs.map((tab) => {
        const isSelected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isSelected}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`group relative flex items-center gap-2 px-4 py-2.5 font-mono text-xs tracking-wider transition-all select-none disabled:cursor-not-allowed disabled:opacity-40 ${
              isSelected
                ? 'font-bold text-[var(--c-text)]'
                : 'text-[var(--c-text-muted)] hover:bg-[var(--c-raised)] hover:text-[var(--c-text)]'
            }`}
          >
            {tab.icon && (
              <span
                className={`transition-colors ${
                  isSelected
                    ? 'text-[var(--c-accent)]'
                    : 'text-[var(--c-text-faint)] group-hover:text-[var(--c-text)]'
                }`}
              >
                {tab.icon}
              </span>
            )}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <Badge tone={tab.badgeTone ?? (isSelected ? 'busy' : 'idle')}>{tab.badge}</Badge>
            )}
            {/* Active glowing indicator line */}
            {isSelected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-[2px] bg-[var(--c-accent-fill)] shadow-[0_0_8px_var(--c-accent)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Segmented control ────────────────────────────────────────────────── */

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
  readonly disabled?: boolean;
}

/**
 * Mutually exclusive choice, rendered as a hairline-joined button strip.
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
      className="inline-flex flex-wrap overflow-hidden rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-[2px] px-2.5 py-1 font-mono text-[11px] font-medium whitespace-nowrap transition-all ${
              option.disabled
                ? 'cursor-not-allowed text-[var(--c-text-faint)] line-through opacity-50'
                : active
                  ? 'bg-[var(--c-surface)] font-semibold text-[var(--c-text)] shadow-xs'
                  : 'text-[var(--c-text-muted)] hover:text-[var(--c-text)]'
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

/** Labelled range input with live value. */
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
        <span className="text-[var(--c-text-muted)]">{label}</span>
        <span className="tabular font-mono text-[11.5px] font-semibold text-[var(--c-text)]">
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
        className="mt-2 w-full accent-[var(--c-accent-fill)]"
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
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  icon?: React.ReactNode;
}): React.ReactElement {
  const styles: Record<string, string> = {
    primary:
      'border-transparent bg-[var(--c-accent-fill)] text-[var(--c-accent-on-fill)] font-bold shadow-xs hover:brightness-95 active:scale-[0.98]',
    ghost:
      'border-[var(--c-line)] bg-[var(--c-surface)] text-[var(--c-text)] hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] hover:bg-[var(--c-accent-soft)] active:scale-[0.98]',
    quiet:
      'border-transparent text-[var(--c-text-muted)] hover:bg-[var(--c-raised)] hover:text-[var(--c-text)] active:scale-[0.98]',
    danger:
      'border-[var(--c-alert)] text-[var(--c-alert)] hover:bg-[var(--c-alert-soft)] active:scale-[0.98]',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] tracking-wide transition-all select-none disabled:pointer-events-none disabled:opacity-40 ${styles[variant]}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

/** Copy-to-clipboard button with confirmation. */
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
    <Button onClick={copy} disabled={text.length === 0} variant={done ? 'primary' : 'ghost'}>
      {done ? '✓ Copied' : label}
    </Button>
  );
}

/* ── Text input ───────────────────────────────────────────────────────── */

/**
 * Standard paste target with file drag & drop support.
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
    <div className="relative">
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
        className={`w-full resize-y border-0 bg-[var(--c-sunken)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:ring-1 focus:ring-[var(--c-accent)] focus:outline-none focus:ring-inset ${
          over ? 'ring-2 ring-[var(--c-accent)] ring-inset' : ''
        } ${className}`}
      />
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--c-surface)]/80 backdrop-blur-xs">
          <span className="font-mono text-xs font-bold text-[var(--c-accent)]">
            Drop text file to load
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Status ───────────────────────────────────────────────────────────── */

export type Tone = 'ok' | 'warn' | 'alert' | 'idle' | 'busy' | 'accent';

const BADGE_TONE: Record<Tone, string> = {
  ok: 'text-[var(--c-ok)] border-[var(--c-ok)] bg-[var(--c-ok)]/10',
  warn: 'text-[var(--c-warn)] border-[var(--c-warn)] bg-[var(--c-warn)]/10',
  alert: 'text-[var(--c-alert)] border-[var(--c-alert)] bg-[var(--c-alert)]/10',
  idle: 'text-[var(--c-text-faint)] border-[var(--c-line)] bg-[var(--c-surface)]',
  busy: 'text-[var(--c-accent)] border-[var(--c-accent)] bg-[var(--c-accent-soft)]',
  accent:
    'text-[var(--c-accent-on-fill)] border-transparent bg-[var(--c-accent-fill)] font-semibold',
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
      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase select-none ${BADGE_TONE[tone]}`}
    >
      {tone === 'busy' && (
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

/** Inline error / caution strip with left accent bar. */
export function ErrorNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-sm border-y border-r border-l-2 border-[var(--c-alert)] border-[var(--c-line)] bg-[var(--c-alert-soft)] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--c-alert)]">
      {children}
    </div>
  );
}

/* ── Misc ─────────────────────────────────────────────────────────────── */

/** Stable id suffix for a component instance. */
export function useInstanceId(prefix: string): string {
  const id = useMemo(() => `${prefix}-${Math.random().toString(36).slice(2, 8)}`, [prefix]);
  return id;
}

/** Number with locale commas. */
export function num(value: number): string {
  return value.toLocaleString('en-US');
}

/* ── Output ───────────────────────────────────────────────────────────── */

/**
 * Download a string as a file.
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
      title="Read from clipboard"
    >
      {label}
    </Button>
  );
}

/**
 * A read-only result surface with copy and download in its header.
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
  'w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]';

/** Labelled wrapper for controls. */
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
      <label htmlFor={htmlFor} className="eyebrow block text-[10px] text-[var(--c-text-muted)]">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 font-mono text-[10.5px] text-[var(--c-text-faint)]">{hint}</p>}
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

/** Numeric input that maintains string draft while typing. */
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

/** Native select styled to match HUD. */
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

/** Checkbox with label. */
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
        className="size-3.5 accent-[var(--c-accent-fill)]"
      />
      {label}
    </label>
  );
}

/** Horizontal control rail. */
export function Toolbar({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** A keyboard shortcut keycap. */
export function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd className="rounded-xs border border-[var(--c-line)] bg-[var(--c-raised)] px-1 py-0.5 font-mono text-[10px] text-[var(--c-text-muted)]">
      {children}
    </kbd>
  );
}

/* ── Persistence ──────────────────────────────────────────────────────── */

export function usePersisted<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `coronring.tools.${key}`;
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage disabled */
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
        /* storage full or blocked */
      }
    },
    [storageKey],
  );

  return [value, update];
}
