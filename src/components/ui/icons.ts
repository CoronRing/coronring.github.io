/**
 * Icon path registry.
 *
 * Kept in a plain module rather than in `Icon.astro`'s frontmatter: types
 * exported from a `.astro` file have to be re-imported through the component,
 * which couples every consumer to the template. A module also keeps the data
 * reviewable on its own.
 *
 * Every path is drawn on a 24x24 grid. Stroke icons inherit `currentColor`;
 * brand marks are filled because their shapes need fill-rule geometry.
 */

export type IconName =
  | 'github'
  | 'linkedin'
  | 'mail'
  | 'rss'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'menu'
  | 'close'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'copy'
  | 'check'
  | 'terminal'
  | 'sparkle';

/** Stroke-based paths, rendered with `fill="none"`. */
export const STROKE_ICONS: Partial<Record<IconName, string>> = {
  mail: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9Zm0 .5 9 6 9-6',
  rss: 'M5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14',
  'arrow-right': 'M4 12h15m-6-6 6 6-6 6',
  'arrow-up-right': 'M7 17 17 7M8 7h9v9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'm6 6 12 12M18 6 6 18',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m11.32 0 1.41 1.41M4.93 4.93l1.41 1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  monitor:
    'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5v-9ZM8 20h8m-4-4v4',
  copy: 'M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15M4 10.5A1.5 1.5 0 0 1 5.5 9h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8Z',
  check: 'm5 13 4.5 4.5L19 7',
  terminal: 'm5 7 5 5-5 5m7 1h7',
  sparkle: 'M12 3v6m0 6v6m-9-9h6m6 0h6M6.3 6.3l3.2 3.2m5 5 3.2 3.2m0-11.4-3.2 3.2m-5 5-3.2 3.2',
};

/** Filled brand marks, rendered with `stroke="none"`. */
export const FILLED_ICONS: Partial<Record<IconName, string>> = {
  github:
    'M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.5v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.34 1.12 2.91.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.33 4.8-4.56 5.05.36.32.68.94.68 1.9v2.82c0 .28.18.6.69.5A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z',
  linkedin:
    'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.5h4v11H3v-11Zm6.5 0h3.83v1.5h.05c.53-.96 1.83-1.98 3.77-1.98 4.03 0 4.78 2.5 4.78 5.76v5.72h-4v-5.07c0-1.21-.02-2.77-1.75-2.77-1.76 0-2.03 1.32-2.03 2.68v5.16h-4v-11Z',
};
