/**
 * Reading the page's own theme back out for the particle engine.
 *
 * The engine takes colours as plain strings, so anything that should follow the
 * site's palette has to be resolved from the custom properties at the moment it
 * is set, and re-resolved when the theme changes. Both surfaces that mount the
 * engine — the deck's `ParticleStage` and the project page's `ParticleWaveDemo`
 * — need the same three answers, so they live here rather than twice.
 */

import type { ParticleWaveConfig } from '@npmring/particle-wave';

/** Current value of a CSS custom property on `:root`. */
export function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Whether the page is currently rendering dark, by explicit choice or system. */
export function isDarkTheme(): boolean {
  if (typeof window === 'undefined') return true;
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark') return true;
  if (chosen === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * How the travelling wave front should be drawn for the current theme.
 *
 * The front's glow is an *additive* band: it brightens whatever it crosses.
 * Over the dark theme's near-black ground that is exactly right and is what
 * makes a click read as a wave. Over the light theme's near-white ground it is
 * very nearly a no-op — adding white to white — so light gets the ink colour
 * with the glow off, which draws the core line with normal blending and is
 * legible for the opposite reason.
 *
 * `--c-text` rather than the particle colour, because the front is not a
 * particle: it has to contrast with the background in either theme, which is
 * precisely what the ink token already guarantees.
 */
export function waveFrontConfig(): Partial<ParticleWaveConfig> {
  const dark = isDarkTheme();
  return {
    clickWaveVisualColor: readToken('--c-text', dark ? '#f5f5f5' : '#191919'),
    clickWaveVisualGlow: dark,
  };
}
