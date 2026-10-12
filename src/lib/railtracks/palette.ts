/**
 * The site's colour tokens, for both themes, read from the page's own CSS.
 *
 * The visualizer frame cannot see this page's styles, so the site skin is
 * sent across as plain values. Both palettes are needed whatever the page is
 * showing (the frame recolours a light and a dark theme object), and only one
 * is ever computed, so they are read from the stylesheet rules that declare
 * them (`src/styles/tokens.css`): bare `:root` for light, and
 * `:root[data-theme='dark']` for dark. Reading the rules rather than copying
 * the values keeps the frame in step when a token changes.
 */

import type { Palette, Tone } from './frame-protocol';

/** The tokens the frame uses, without the `--c-` prefix. */
const TOKENS = [
  'ground',
  'surface',
  'raised',
  'sunken',
  'line',
  'line-faint',
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'accent-fill',
  'accent-on-fill',
  'accent-soft',
  'ok',
  'warn',
  'alert',
] as const;

function fromDeclaration(style: CSSStyleDeclaration): Palette {
  const palette: Palette = {};
  for (const token of TOKENS) {
    const value = style.getPropertyValue(`--c-${token}`).trim();
    if (value) palette[token] = value;
  }
  return palette;
}

function* styleRules(rules: CSSRuleList): Generator<CSSStyleRule> {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) yield rule;
    else if (rule instanceof CSSGroupingRule) yield* styleRules(rule.cssRules);
  }
}

/** Read both palettes. Falls back to the computed palette for whichever is missing. */
export function readSitePalettes(): Record<Tone, Palette> {
  let light: Palette = {};
  let dark: Palette = {};
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet
    }
    for (const rule of styleRules(rules)) {
      const selector = rule.selectorText.replace(/\s+/g, '');
      if (!rule.style.getPropertyValue('--c-ground')) continue;
      if (selector === ':root') light = { ...light, ...fromDeclaration(rule.style) };
      else if (/^:root\[data-theme=["']?dark["']?\]$/.test(selector)) {
        dark = { ...dark, ...fromDeclaration(rule.style) };
      }
    }
  }
  const computed = fromDeclaration(getComputedStyle(document.documentElement));
  return {
    light: Object.keys(light).length ? light : computed,
    dark: Object.keys(dark).length ? dark : computed,
  };
}

/** The tone the page is showing now: its explicit choice, else the system's. */
export function pageTone(): Tone {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Call `onChange` when the page's tone changes, by toggle or by system setting. */
export function watchPageTone(onChange: (tone: Tone) => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const notify = (): void => onChange(pageTone());
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', notify);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', notify);
  };
}
