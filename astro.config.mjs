// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import { corpusIntegration } from './scripts/build-corpus.mjs';

/**
 * User-site deployment: https://coronring.github.io serves from the domain root,
 * so `base` stays "/" . If this ever moves to a project page, set `base` to the
 * repo name and every internal link keeps working via `src/lib/url.ts#href`.
 */
export default defineConfig({
  site: 'https://coronring.github.io',
  base: '/',
  trailingSlash: 'ignore',
  output: 'static',
  integrations: [react(), mdx(), sitemap(), corpusIntegration()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Emit `/about/index.html` style routes — friendlier for static hosts.
    format: 'directory',
  },
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      wrap: true,
    },
  },
});
