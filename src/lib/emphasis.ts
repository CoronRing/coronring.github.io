/**
 * Key phrases picked out of a line of copy.
 *
 * Copy on this site is written as plain strings, because the same string is
 * also a meta description, an `alt`, or structured data, where markup would
 * be wrong. So emphasis is not written into the text: a caller names the
 * phrases to pick out, and `emphasize` splits the text around them for
 * whatever renders it. Plain-text consumers never see a marker to strip.
 *
 * Matching is exact and case-sensitive, so a phrase is the words as they
 * appear in the text. The project schema checks every phrase against its
 * summary, so a reworded summary fails the build rather than silently losing
 * its emphasis (see `content.config.ts`).
 */

/** One stretch of the text, emphasised or not. */
export interface Run {
  readonly text: string;
  readonly key: boolean;
}

/**
 * Split `text` into runs, with the first occurrence of each phrase marked.
 * Longer phrases win where two overlap; a phrase that is not in the text is
 * ignored.
 */
export function emphasize(text: string, phrases: readonly string[] = []): Run[] {
  const spans: Array<[number, number]> = [];
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    if (!phrase) continue;
    const at = text.indexOf(phrase);
    if (at < 0) continue;
    const end = at + phrase.length;
    if (spans.some(([s, e]) => at < e && end > s)) continue;
    spans.push([at, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);

  const runs: Run[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) runs.push({ text: text.slice(cursor, start), key: false });
    runs.push({ text: text.slice(start, end), key: true });
    cursor = end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), key: false });
  return runs;
}

/** The phrases that do not occur in `text`, for validation. */
export function missingPhrases(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((p) => !text.includes(p));
}
