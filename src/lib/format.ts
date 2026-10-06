/** Small, dependency-free formatting helpers shared across pages and islands. */

/** `1234567` → `"1,234,567"`. Locale-stable so SSR and client output match. */
export function number(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** `2026-03-01` → `"Mar 2026"`. Used on the resume timeline. */
export function monthYear(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** `2026-03-01` → `"March 1, 2026"`. Used on long-form content. */
export function longDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(d);
}

/** Byte count → human string. `2048` → `"2.0 KB"`. */
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

/**
 * Minutes to read a Markdown body at a steady 230 words a minute, never less
 * than one. Counts words in the raw source, so tables and code count too, which
 * is closer to how long a technical post actually takes than prose alone.
 */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return Math.max(1, Math.round(words / 230));
}

/** Zero-pad to two digits, for HUD-style ordinal labels. */
export function ordinal(index: number): string {
  return String(index).padStart(2, '0');
}
