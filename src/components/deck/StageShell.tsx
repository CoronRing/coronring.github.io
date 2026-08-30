/**
 * StageShell — the frame every deck exhibit renders inside, and the two
 * control primitives they are allowed to use.
 *
 * ## The three-control rule
 *
 * The surface this replaced offered twenty-odd sliders and selects under a
 * 420px canvas, which is a parameter reference sheet, not an exhibit. A
 * visitor who has never seen the engine cannot tell which of twenty numbers is
 * the interesting one, so they move none of them.
 *
 * A stage therefore gets **at most three** control groups, and each one has to
 * change the picture in a way that is obvious within a second. The full
 * parameter set still exists, on the project page, for the reader who wants
 * it. This is the trailer, not the manual.
 *
 * `Segment` and `Chips` are the only two shapes offered, deliberately: with
 * one row of controls per stage and two possible shapes, every exhibit reads
 * the same way even though no two do the same thing.
 *
 * The shell fills the deck's whole first screen, so this row is the bottom of
 * the viewport rather than the bottom of a box. Passing no controls at all is a
 * supported state: the landing card shows the exhibit with nothing on it.
 *
 * ## Why the row scrolls sideways on a phone
 *
 * The chrome lies *on* the exhibit rather than under it, which is what lets the
 * canvas stay the same size in both of the deck's states. That is free on a
 * desktop, where three control groups are one row of about fifty pixels. On a
 * 390px screen the same three groups stacked into nearly four hundred pixels of
 * panel sitting over the middle of the cloud.
 *
 * So below `lg` the row keeps its shape and scrolls: labels move inline, the
 * groups sit end to end, and the whole thing is one thumb-height strip along
 * the bottom of the exhibit. Everything is still reachable, and the exhibit is
 * still the screen.
 */

interface ShellProps {
  /** At most three `Segment` / `Chips` groups. */
  controls?: React.ReactNode;
  /** Machine metadata, top right of the stage. Short — it is a glance, not a table. */
  readout?: React.ReactNode;
  /** One line under the controls telling the visitor what to try. */
  hint?: string;
  children: React.ReactNode;
}

export function StageShell({ controls, readout, hint, children }: ShellProps): React.ReactElement {
  return (
    <div className="absolute inset-0">
      {/*
        The exhibit fills the shell, and the chrome floats over it rather than
        taking a row of its own. That is not only a bigger canvas: it means
        showing or hiding the controls does not resize it, so the deck's
        landing card can hand over to its instrument without the engine having
        to re-lay out the cloud underneath.
      */}
      <div className="absolute inset-0">{children}</div>

      {readout && (
        <div className="text-faint pointer-events-none absolute top-4 right-4 z-20 font-mono text-[10px] tracking-[0.14em] tabular-nums lg:top-6 lg:right-8">
          {readout}
        </div>
      )}

      {(controls || hint) && (
        <div className="deck-controls border-line/80 bg-ground/70 absolute inset-x-0 bottom-0 z-20 border-t backdrop-blur-md">
          {controls && <div className="deck-ctl-row">{controls}</div>}
          {/*
            Hidden on a phone. Not for room: the line is about a cursor, a
            click and a right-click, and a visitor holding the thing in their
            hand has none of those.
          */}
          {hint && (
            <p
              className={`text-faint hidden px-4 py-2 font-mono text-[10px] tracking-[0.12em] uppercase lg:block lg:px-8 lg:pr-44 ${
                controls ? 'border-line/50 border-t' : 'py-3'
              }`}
            >
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Controls ────────────────────────────────────────────────────────── */

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
}

/**
 * A labelled segmented control. Every option is on screen, so the visitor sees
 * the whole range of the parameter without opening anything.
 */
export function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentProps<T>): React.ReactElement {
  return (
    <div className="deck-ctl">
      <p className="eyebrow deck-ctl-label text-[9.5px]">{label}</p>
      <div
        role="group"
        aria-label={label}
        className="border-line/90 bg-surface/60 inline-flex overflow-hidden border"
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              className={`px-3 py-1.5 font-mono text-[11px] tracking-wide whitespace-nowrap transition-colors ${
                on
                  ? 'bg-accent-fill text-accent-on-fill font-semibold'
                  : 'text-muted hover:text-fg hover:bg-raised/70'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ChipsProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T> & { swatch?: string }>;
  onChange: (value: T) => void;
  /** Held while the exhibit is mid-transition and cannot take another one. */
  disabled?: boolean;
}

/**
 * Detached chips, each optionally carrying a colour swatch.
 *
 * Used where the options are *subjects* rather than settings — a different
 * point cloud, a different pipeline — so they read as a choice of material
 * rather than a value on a scale.
 */
export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: ChipsProps<T>): React.ReactElement {
  return (
    <div className="deck-ctl">
      <p className="eyebrow deck-ctl-label text-[9.5px]">{label}</p>
      <div role="group" aria-label={label} className="flex gap-1.5 lg:flex-wrap">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              disabled={disabled && !on}
              onClick={() => onChange(option.value)}
              className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px] tracking-wide whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                  ? 'border-accent text-accent bg-accent-soft font-semibold'
                  : 'border-line/90 text-muted hover:border-fg hover:text-fg'
              }`}
            >
              {option.swatch && (
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: option.swatch }}
                />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
