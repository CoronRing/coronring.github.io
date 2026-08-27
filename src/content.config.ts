import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content collections.
 *
 * Projects, resources, and resume entries are *content*, not markup. Keeping
 * them in schema-validated MDX/JSON means adding one is a new file rather
 * than a template edit, and a typo in a field fails the build instead of
 * silently rendering an empty page.
 *
 * Media fields are plain strings pointing under `public/`, not Astro image
 * imports. That is deliberate: the assets do not exist yet, and an `image()`
 * schema would make the build fail on a missing file. `MediaFrame` renders a
 * designed placeholder when a path is absent, so pages are complete and
 * correctly laid out before any art lands.
 */

const linkSchema = z.object({
  label: z.string(),
  href: z.string().url(),
});

/** One media slot: image or video under `public/`, plus its caption. */
const mediaSchema = z.object({
  /** e.g. `/media/projects/particle-hero.webp`. Omit to show a placeholder. */
  src: z.string().optional(),
  poster: z.string().optional(),
  alt: z.string().default(''),
  caption: z.string().optional(),
  ratio: z.enum(['16/9', '4/3', '1/1', '21/9', '3/4']).default('16/9'),
  /** Placeholder label, so an empty slot says what belongs there. */
  label: z.string().default('Media'),
});

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    /** One-line hook shown on the card. */
    summary: z.string().max(200),
    /** Sorts listings; lower surfaces first. */
    order: z.number().default(100),
    status: z.enum(['live', 'in-progress', 'archived']).default('live'),
    /** Drives the "Interactive" badge and the demo slot. */
    interactive: z.boolean().default(false),
    /** Registry key resolved in `src/components/demos/registry.ts`. */
    demo: z.string().optional(),
    /**
     * Environment id from `src/data/py-presets.ts`.
     *
     * Set it and the project page grows a runnable Python console with that
     * package installed. Most of the work here is a package with no interface,
     * and letting a reader run it is worth more than another paragraph about
     * what it does. Validated at render time rather than here, so the error
     * names the preset registry rather than a Zod path.
     */
    pyPreset: z.string().optional(),
    tech: z.array(z.string()).default([]),
    role: z.string().optional(),
    period: z.string().optional(),
    /** Short outcome bullets — what shipped, what it moved. */
    highlights: z.array(z.string()).default([]),
    links: z.array(linkSchema).default([]),
    /** Lead visual for the card and the top of the detail page. */
    hero: mediaSchema.optional(),
    /** Further stills/clips shown on the detail page. */
    gallery: z.array(mediaSchema).default([]),
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
    /** External resource; omit for original write-ups. */
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
    kind: z.enum(['work', 'education', 'leadership', 'award', 'certification']),
    /** Bullet points, ordered explicitly. */
    highlights: z.array(z.string()).default([]),
    tech: z.array(z.string()).default([]),
    links: z.array(linkSchema).default([]),
    /** Optional logo/photo for the timeline row. */
    media: mediaSchema.optional(),
  }),
});

export const collections = { projects, resources, experience };
