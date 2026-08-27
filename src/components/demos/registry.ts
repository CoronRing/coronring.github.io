/**
 * Demo registry — the list of valid `demo:` values for project frontmatter.
 *
 * ## Why this is a name list, not a component map
 *
 * The obvious design is `{ placeholder: PlaceholderDemo }` and a lookup in the
 * template. That does not work: Astro generates each island's hydration script
 * at build time from a *statically analysable* import in the rendering file. A
 * component pulled out of a map at runtime has no such import, so the build
 * fails with `NoMatchingImport`.
 *
 * So the mapping from name to component lives in `DemoFrame.astro` as explicit
 * branches — verbose, but statically analysable and correctly tree-shaken.
 * This module owns the name list and the shared props type, which is what
 * gives frontmatter a single source of truth to validate against.
 *
 * To add a demo: build the island here, add its name below, add one branch in
 * `DemoFrame.astro`.
 */

/** Props every demo island receives from `DemoFrame`. */
export interface DemoProps {
  /** Title of the hosting project, for in-demo labelling. */
  title: string;
}

export const DEMO_NAMES = ['placeholder', 'particle-wave', 'featherring', 'gs-prompt-manager'] as const;

export type DemoName = (typeof DEMO_NAMES)[number];

/** Is `name` a registered demo? Narrows for the branches in `DemoFrame`. */
export function isDemoName(name: string): name is DemoName {
  return (DEMO_NAMES as readonly string[]).includes(name);
}
