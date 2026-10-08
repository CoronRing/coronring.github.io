import type React from 'react';

/**
 * ToolIcon — one mark per tool, drawn on a 24px grid.
 *
 * Two tones from one colour: the primary shape in `currentColor`, a secondary
 * shape at reduced opacity. Chunky silhouettes with cut corners and offset
 * slabs rather than thin outline pictograms, so a mark still reads at 18px and
 * sits with the display face. The marks are evocative rather than literal; the
 * name next to each one does the explaining.
 *
 * Usable from an island or, with no hydration, from an Astro page.
 */

/** Tone of the secondary shape, relative to `currentColor`. */
const SECONDARY = 0.38;

type Mark = (secondary: React.SVGProps<SVGGElement>) => React.ReactElement;

const MARKS: Record<string, Mark> = {
  /* Stacked slabs: tokens counted off a pile, the last one short. */
  'token-counter': (s) => (
    <>
      <polygon points="6,3 21,3 19,7.5 4,7.5" />
      <g {...s}>
        <polygon points="6,9.75 21,9.75 19,14.25 4,14.25" />
      </g>
      <polygon points="6,16.5 14,16.5 12,21 4,21" />
      <polygon points="16,16.5 21,16.5 19,21 14,21" />
    </>
  ),

  /* A plug meeting a socket: the handshake. */
  'mcp-tester': (s) => (
    <>
      <polygon points="3,4 11,4 11,7.5 6.5,7.5 6.5,16.5 11,16.5 11,20 3,20" />
      <rect x="9" y="10" width="5" height="1.75" />
      <rect x="9" y="12.25" width="5" height="1.75" />
      <g {...s}>
        <polygon points="14,6 21,6 21,18 17,18 14,15" />
      </g>
    </>
  ),

  /* A set letter over a baseline shard. */
  'string-kit': (s) => (
    <>
      <polygon points="3,3 21,3 21,7 14,7 14,16 11,19 10,19 10,7 3,7" />
      <g {...s}>
        <polygon points="3,19.5 9,19.5 7,22 3,22" />
        <polygon points="15,19.5 21,19.5 21,22 13,22" />
      </g>
    </>
  ),

  /* A dial with a quarter run: time until the break. */
  'rest-reminder': (s) => (
    <>
      <g {...s}>
        <circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" />
      </g>
      <path d="M12 5.5 A7.5 7.5 0 0 1 19.5 13" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="9.5" y="1" width="5" height="2.25" />
      <polygon points="11,9 13,9 13,13.5 12,14.5 11,13.5" />
    </>
  ),

  /* Two sheets offset: before and after. */
  'text-diff': (s) => (
    <>
      <g {...s}>
        <polygon points="3,3 14,3 14,17 3,17" />
      </g>
      <polygon points="10,7 17,7 21,11 21,21 10,21" />
    </>
  ),

  /* Runs of text cut at different lengths. */
  'chunk-visualizer': (s) => (
    <>
      <polygon points="3,3.5 14,3.5 13,7 3,7" />
      <polygon points="3,10.25 8,10.25 7,13.75 3,13.75" />
      <polygon points="3,17 17,17 16,20.5 3,20.5" />
      <g {...s}>
        <polygon points="16,3.5 21,3.5 21,7 15,7" />
        <polygon points="10,10.25 21,10.25 21,13.75 9,13.75" />
        <polygon points="19,17 21,17 21,20.5 18,20.5" />
      </g>
    </>
  ),

  /* A bracket and a run arrow: code executing. */
  'python-runner': (s) => (
    <>
      <g {...s}>
        <polygon points="3,3 9,3 9,6.5 6.5,6.5 6.5,17.5 9,17.5 9,21 3,21" />
      </g>
      <polygon points="11,5 21,12 11,19 13,12" />
    </>
  ),

  /* A sheet with a folded corner and two lines cut through it. */
  'doc-viewer': (s) => (
    <>
      <path fillRule="evenodd" d="M4 2H15L20 7V22H4Z M7.5 11H16.5V13H7.5Z M7.5 15.5H13V17.5H7.5Z" />
      <g {...s}>
        <polygon points="16.5,2 22,2 22,7.5" />
      </g>
    </>
  ),

  /* The wildcard: an asterisk over a matched block. */
  'regex-lab': (s) => (
    <>
      <g transform="translate(12 9)">
        <rect x="-1.6" y="-7" width="3.2" height="14" />
        <rect x="-1.6" y="-7" width="3.2" height="14" transform="rotate(60)" />
        <rect x="-1.6" y="-7" width="3.2" height="14" transform="rotate(-60)" />
      </g>
      <g {...s}>
        <polygon points="3,18 21,18 19,22 3,22" />
      </g>
    </>
  ),

  /* A die with a clipped corner. */
  'random-kit': (s) => (
    <>
      <g {...s}>
        <polygon points="7,2 22,2 22,17" />
      </g>
      <path
        fillRule="evenodd"
        d="M2 6H14L18 10V22H2Z M5 9H8V12H5Z M8.5 12.5H11.5V15.5H8.5Z M12 16H15V19H12Z"
      />
    </>
  ),

  /* An hourglass, the upper half still full. */
  'read-time': (s) => (
    <>
      <rect x="4" y="2" width="16" height="2.25" />
      <polygon points="5.5,5.5 18.5,5.5 12,12" />
      <g {...s}>
        <polygon points="12,12 18.5,18.5 5.5,18.5" />
      </g>
      <rect x="4" y="19.75" width="16" height="2.25" />
    </>
  ),

  /* The rest of the kit: a grid with one cell lit. */
  'all-tools': (s) => (
    <>
      <polygon points="3,3 10.5,3 10.5,8 8,10.5 3,10.5" />
      <g {...s}>
        <rect x="13.5" y="3" width="7.5" height="7.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" />
      </g>
      <polygon points="16,13.5 21,13.5 21,21 13.5,21 13.5,16" />
    </>
  ),
};

interface Props {
  /** Tool slug from `data/tools.ts`, or `"all-tools"` for the index. */
  slug: string;
  /** Rendered size in px. */
  size?: number;
  className?: string;
}

/** Whether a mark exists for `slug`, for callers that would rather omit the slot. */
export function hasToolIcon(slug: string): boolean {
  return slug in MARKS;
}

export default function ToolIcon({ slug, size = 20, className }: Props): React.ReactElement | null {
  const mark = MARKS[slug];
  if (!mark) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {mark({ opacity: SECONDARY })}
    </svg>
  );
}
