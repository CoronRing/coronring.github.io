/**
 * URL helpers that keep every internal link correct regardless of whether the
 * site is served from a domain root or a sub-path.
 *
 * Astro exposes the configured `base` as `import.meta.env.BASE_URL`. Hardcoding
 * "/projects" everywhere would silently break the day this moves to a project
 * page, so all internal links route through `href()`.
 */

const BASE: string = import.meta.env.BASE_URL ?? '/';

/** Strip trailing slashes, but never reduce a path to the empty string. */
function trimEnd(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Resolve a root-relative path against the configured base.
 *
 * @example href('/projects') // "/projects" or "/my-repo/projects"
 */
export function href(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  const base = trimEnd(BASE);
  const rel = path.startsWith('/') ? path : `/${path}`;
  return base === '/' ? rel : `${base}${rel}`;
}

/** Absolute URL, for canonical tags, Open Graph, and structured data. */
export function absolute(path: string, site: string): string {
  return new URL(href(path), site).toString();
}

/**
 * Is `candidate` the active nav destination for the page at `current`?
 *
 * "/" matches only itself; every other entry also matches its descendants so
 * that `/projects/some-demo` still highlights the Projects tab.
 */
export function isActive(current: string, candidate: string): boolean {
  const here = trimEnd(stripBase(current));
  const target = trimEnd(candidate);
  if (target === '/') return here === '/';
  return here === target || here.startsWith(`${target}/`);
}

function stripBase(path: string): string {
  const base = trimEnd(BASE);
  if (base !== '/' && path.startsWith(base)) {
    return path.slice(base.length) || '/';
  }
  return path;
}
