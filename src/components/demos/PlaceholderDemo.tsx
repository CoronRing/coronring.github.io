import { useState } from 'react';
import type { DemoProps } from './registry';

/**
 * PlaceholderDemo — a stand-in island that proves the demo pipeline works.
 *
 * It exists so the structural build is verifiable end to end: hydration,
 * registry resolution, theming via CSS custom properties, and the frame chrome.
 * Real demos replace it one at a time; delete this once none reference it.
 */
export default function PlaceholderDemo({ title }: DemoProps): React.ReactElement {
  const [count, setCount] = useState<number>(0);

  return (
    <div className="flex min-h-[18rem] flex-col items-center justify-center gap-5 p-10 text-center">
      <p className="eyebrow">Demo slot</p>

      <p className="max-w-md text-sm leading-relaxed text-[var(--c-text-muted)]">
        This is the mount point for <span className="text-[var(--c-text)]">{title}</span>. The
        island is hydrated and interactive; the real demo drops in here.
      </p>

      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="inline-flex h-10 items-center rounded-md border border-[var(--c-line)] bg-[var(--c-raised)] px-4 font-mono text-sm transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
      >
        hydrated · {count}
      </button>
    </div>
  );
}
