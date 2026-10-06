// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import { corpusIntegration } from './scripts/build-corpus.mjs';
import { rehypeTableScroll } from './scripts/rehype-table-scroll.mjs';

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
  integrations: [
    react(),
    mdx(),
    // `/404` and `/viewer` are `noindex`; listing them would contradict their own meta tag.
    sitemap({ filter: (page) => !/\/(404|viewer)\/?$/.test(new URL(page).pathname) }),
    corpusIntegration(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Emit `/about/index.html` style routes — friendlier for static hosts.
    format: 'directory',
  },
  markdown: {
    // Tables scroll inside the reading measure and keep short figures on one line.
    rehypePlugins: [rehypeTableScroll],
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      wrap: true,
    },
  },
});
