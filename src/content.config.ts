import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content collections.
 *
 * Projects, resources, and resume entries are *content*, not markup. Keeping
 * them in schema-validated MDX/JSON means adding a project is one new file —
 * no template edits — and a typo in a field fails the build instead of
 * silently rendering an empty page.
 */

/** Reusable link shape used across collections. */
const linkSchema = z.object({
  label: z.string(),
  href: z.string().url(),
});

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** One-line hook shown on the index card. */
      summary: z.string().max(180),
      /** Sorts the index; lower numbers surface first. */
      order: z.number().default(100),
      status: z.enum(['live', 'in-progress', 'archived']).default('live'),
      /** Drives the "Interactive" badge and the demo slot on the detail page. */
      interactive: z.boolean().default(false),
      /**
       * Name of the React island to mount in the demo slot, resolved by
       * `src/components/demos/registry.ts`. Required when `interactive`.
       */
      demo: z.string().optional(),
      tech: z.array(z.string()).default([]),
      role: z.string().optional(),
      period: z.string().optional(),
      links: z.array(linkSchema).default([]),
      cover: image().optional(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

const resources = defineCollection({
  loader: glob({ base: './src/content/resources', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(220),
    category: z.enum(['agents', 'llm-ops', 'engineering', 'reading', 'tooling']),
    /** External resource being pointed at; omit for original write-ups. */
    url: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    updated: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

const experience = defineCollection({
  loader: glob({ base: './src/content/experience', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    organization: z.string(),
    role: z.string(),
    start: z.coerce.date(),
    /** Omit for a current position; the UI renders "Present". */
    end: z.coerce.date().optional(),
    location: z.string().optional(),
    kind: z.enum(['work', 'education', 'award', 'certification']),
    /** Bullet points. Kept in frontmatter so ordering is explicit. */
    highlights: z.array(z.string()).default([]),
    tech: z.array(z.string()).default([]),
    links: z.array(linkSchema).default([]),
  }),
});

export const collections = { projects, resources, experience };
