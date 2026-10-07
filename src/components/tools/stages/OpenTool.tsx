import React from 'react';

/**
 * The one call to action at the foot of a showcase stage: a link to the full
 * tool, with an optional short line of what the full version adds.
 */
export default function OpenTool({
  href,
  label,
  more,
}: {
  href: string;
  label: string;
  /** At most a few words. The stage is a tool, not a brochure. */
  more?: string;
}): React.ReactElement {
  return (
    <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      {more ? <span className="text-faint font-mono text-[11px]">{more}</span> : <span />}
      <a
        href={href}
        className="bg-accent-fill text-accent-on-fill inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90"
      >
        <span>{label}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
          <path
            d="M3 8 H13 M9 4 L13 8 L9 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}
