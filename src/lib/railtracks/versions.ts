/**
 * Which visualizer to load, and which one a Railtracks release shipped with.
 *
 * Both lists are read live from the registries on every visit, so a new
 * visualizer or Railtracks release appears here without a site rebuild:
 *
 * - **Visualizer versions** from npm (`@railtownai/railtracks-visualizer`),
 *   with publish dates and the React each one expects.
 * - **Railtracks versions** from PyPI (`railtracks`), with release dates.
 *
 * A Railtracks release does not pin a visualizer: `railtracks viz` downloads
 * whatever build is current. So "the visualizer it shipped with" is the newest
 * stable visualizer published on or before that release's date, which is what
 * a user installing that release on its release day would have seen.
 *
 * Visualizer versions fall into **lines** by major version. Everything below
 * 2 is the V1 visualizer, which draws a session's runs; 2 and up is V2, the
 * event-stream visualizer that `railtracks viz --beta` serves. V2 has not been
 * published to npm yet, and appears here on its own when it is.
 */

export const VISUALIZER_PACKAGE = '@railtownai/railtracks-visualizer';
export const RAILTRACKS_PACKAGE = 'railtracks';

const NPM_URL = `https://registry.npmjs.org/${VISUALIZER_PACKAGE.replace('/', '%2f')}`;
const PYPI_URL = `https://pypi.org/pypi/${RAILTRACKS_PACKAGE}/json`;

/** The React major a visualizer gets when its manifest names none. */
const DEFAULT_REACT_MAJOR = 18;

export type VisualizerLine = 'v1' | 'v2';

export interface VisualizerVersion {
  version: string;
  line: VisualizerLine;
  /** ISO 8601 publish time. */
  published: string;
  prerelease: boolean;
  /** React major to load it with, from its peer dependency range. */
  reactMajor: number;
  /**
   * Stylesheets its dependencies ship as files, which a bundle cannot carry:
   * the graph library's base CSS, pinned to the version this build depends on.
   */
  styles: string[];
}

/** Graph libraries whose base stylesheet a visualizer build needs, by package. */
const DEPENDENCY_STYLES: Record<string, string> = {
  '@xyflow/react': 'dist/style.css',
  reactflow: 'dist/style.css',
};

function stylesFor(dependencies: Record<string, string> | undefined): string[] {
  return Object.entries(DEPENDENCY_STYLES).flatMap(([name, file]) => {
    const range = dependencies?.[name];
    if (!range) return [];
    const version = range.replace(/^[\^~>=<\s]+/, '').split(/\s/)[0] ?? '';
    return [`https://esm.sh/${name}@${version || 'latest'}/${file}`];
  });
}

export interface RailtracksVersion {
  version: string;
  /** ISO 8601 upload time of its first file. */
  released: string;
}

export interface VersionCatalog {
  /** Newest first. */
  visualizers: VisualizerVersion[];
  /** Newest first. */
  railtracks: RailtracksVersion[];
  latest: Record<VisualizerLine, VisualizerVersion | null>;
}

/* ── Semver, as much as these two registries need ─────────────────────── */

interface Parsed {
  nums: number[];
  pre: string | null;
}

function parse(version: string): Parsed {
  const [core = '', pre] = version.split(/-(.*)/s, 2);
  return { nums: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre: pre ?? null };
}

/** Compare two versions: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const length = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < length; i += 1) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true });
}

export function lineOf(version: string): VisualizerLine {
  return (parse(version).nums[0] ?? 0) >= 2 ? 'v2' : 'v1';
}

/** The highest React major a peer range admits, e.g. `^18.3.1 || ^19` gives 19. */
export function reactMajorFor(range: string | undefined): number {
  if (!range) return DEFAULT_REACT_MAJOR;
  const majors = [...range.matchAll(/(?:^|[^\d.])(\d+)(?=\.|\b)/g)]
    .map((match) => Number(match[1]))
    .filter((major) => major >= 16 && major < 100);
  return majors.length > 0 ? Math.max(...majors) : DEFAULT_REACT_MAJOR;
}

/* ── Fetching ────────────────────────────────────────────────────────── */

interface NpmDocument {
  versions?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      deprecated?: string;
    }
  >;
  time?: Record<string, string>;
}

interface PypiDocument {
  releases?: Record<string, Array<{ upload_time_iso_8601?: string; yanked?: boolean }>>;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchVisualizerVersions(signal?: AbortSignal): Promise<VisualizerVersion[]> {
  const doc = await getJson<NpmDocument>(NPM_URL, signal);
  const versions = Object.entries(doc.versions ?? {})
    .filter(([, manifest]) => !manifest.deprecated)
    .map(([version, manifest]) => ({
      version,
      line: lineOf(version),
      published: doc.time?.[version] ?? '',
      prerelease: parse(version).pre !== null,
      reactMajor: reactMajorFor(manifest.peerDependencies?.react),
      styles: stylesFor(manifest.dependencies),
    }));
  return versions.sort((a, b) => compareVersions(b.version, a.version));
}

export async function fetchRailtracksVersions(signal?: AbortSignal): Promise<RailtracksVersion[]> {
  const doc = await getJson<PypiDocument>(PYPI_URL, signal);
  const versions: RailtracksVersion[] = [];
  for (const [version, files] of Object.entries(doc.releases ?? {})) {
    // A yanked release was withdrawn; nobody should be matching logs to it.
    if (files.length > 0 && files.every((file) => file.yanked === true)) continue;
    const times = files.map((file) => file.upload_time_iso_8601).filter((t): t is string => !!t);
    if (times.length === 0) continue;
    versions.push({
      version,
      released: times.sort()[0]!,
    });
  }
  return versions.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Both lists. The visualizer list is required; the Railtracks list is a
 * convenience, so if PyPI is unreachable the catalog still loads without it.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<VersionCatalog> {
  const [visualizers, railtracks] = await Promise.all([
    fetchVisualizerVersions(signal),
    fetchRailtracksVersions(signal).catch((): RailtracksVersion[] => []),
  ]);
  const newestStable = (line: VisualizerLine): VisualizerVersion | null =>
    visualizers.find((v) => v.line === line && !v.prerelease) ??
    visualizers.find((v) => v.line === line) ??
    null;
  return { visualizers, railtracks, latest: { v1: newestStable('v1'), v2: newestStable('v2') } };
}

/** The visualizer a Railtracks release would have loaded on its release day. */
export function visualizerForRailtracks(
  catalog: VersionCatalog,
  railtracksVersion: string,
): VisualizerVersion | null {
  const release = catalog.railtracks.find((r) => r.version === railtracksVersion);
  if (!release) return null;
  const cutoff = Date.parse(release.released);
  const stable = catalog.visualizers.filter((v) => !v.prerelease && v.published);
  const before = stable
    .filter((v) => Date.parse(v.published) <= cutoff)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  // A release older than every visualizer gets the oldest one there is.
  return before[0] ?? stable.at(-1) ?? null;
}

/* ── Loading a version ───────────────────────────────────────────────── */

/**
 * The esm.sh address of one visualizer build, bundled with its dependencies
 * and pinned to the React it expects. The frame derives the React modules
 * from this bundle's own imports, so the page and the visualizer can never
 * hold two copies of React.
 */
export function bundleUrl(version: VisualizerVersion): string {
  const react = version.reactMajor;
  return `https://esm.sh/${VISUALIZER_PACKAGE}@${version.version}?bundle&deps=react@${react},react-dom@${react}`;
}
