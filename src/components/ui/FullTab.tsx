/**
 * FullTab: the "full page" tab at the trailing end of a list row.
 *
 * Used by the site rail, the phone drawer and the tools roster, where each row
 * either previews something or jumps to a band of the home page, and this tab
 * is the way to the dedicated page instead. Astro renders it as static HTML
 * (no hydration) in the rail; the roster renders it inside its island.
 *
 * At rest it is a narrow strip reading FULL; on hover or keyboard focus it
 * grows leftward over the row and reads "Visit the full page". Rows alternate
 * `slant` so a column of tabs draws one zig-zag. Geometry and the open state
 * are CSS (`.full-tab` in `global.css`), sized per host through the
 * `--full-tab-*` custom properties.
 */

export type FullTabSlant = 'up' | 'down';

export interface FullTabProps {
  href: string;
  /** What the page is, appended for screen readers: "Visit the full page, Tools". */
  label: string;
  /** Direction of the leading edge. Alternate it row by row. */
  slant: FullTabSlant;
  /** Marks the tab of the held or current row. */
  on?: boolean;
  /** Pass -1 to keep the tab out of the tab order, as a roving tab list does. */
  tabIndex?: number;
}

/** Slant for the `n`th tab in a column, so neighbours always alternate. */
export function slantAt(n: number): FullTabSlant {
  return n % 2 === 0 ? 'up' : 'down';
}

export default function FullTab({
  href,
  label,
  slant,
  on = false,
  tabIndex,
}: FullTabProps): React.ReactElement {
  return (
    <a
      href={href}
      tabIndex={tabIndex}
      data-slant={slant}
      data-on={on ? '' : undefined}
      className="full-tab"
    >
      <span aria-hidden="true" className="full-tab-rest">
        Full
      </span>
      <span className="full-tab-open">
        Visit the full page
        <span className="sr-only">, {label}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0">
          <path
            d="M3 8 H13 M9 4 L13 8 L9 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </a>
  );
}
