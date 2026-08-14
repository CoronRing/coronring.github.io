/**
 * Theme state, shared between the pre-paint inline script and the toggle.
 *
 * Three states, deliberately:
 *   'system' — no `data-theme` attribute; CSS follows `prefers-color-scheme`
 *   'light'  — `data-theme="light"`, pins the light palette
 *   'dark'   — `data-theme="dark"`, pins the dark palette
 */

export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'coronring:theme' as const;

/** Narrow an untrusted string (e.g. from localStorage) to a Theme. */
export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Current choice, defaulting to 'system' when unset or corrupt. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    // Private-browsing modes can throw on localStorage access.
    return 'system';
  }
}

/** Write the choice to the document root. 'system' removes the attribute. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}
