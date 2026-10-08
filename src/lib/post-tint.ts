/**
 * Post tints: one colour per post, derived from its title.
 *
 * Every post cover shares the same near-black ground. A tint gives each one a
 * light of its own on that wall, drawn the way the page backdrop draws its
 * aurora (`components/decor/Backdrop.astro`): a few soft radial pools of
 * neighbouring hues at irregular positions, so it reads as dim light falling
 * on a surface rather than a flat colour fill. The same hue is the post's
 * supporting colour wherever the post is shown as a card.
 *
 * ## How the hue is chosen
 *
 * - **From the title**, hashed, so a post keeps its colour across rebuilds
 *   and pages without anyone picking one.
 * - **Never yellow.** Hues from orange through yellow-green are left out.
 *   They either compete with the hazard yellow that means "act here", or go
 *   muddy at this darkness.
 * - **In OKLCH**, at one lightness and chroma, so every tint has the same
 *   perceived brightness and no post shouts louder than another.
 * - **Apart from its neighbours.** Posts are listed by date, so a post's
 *   neighbours are the ones published just before it. If its hashed hue
 *   lands too close to one of those, it steps around the wheel by the golden
 *   angle until it clears. Posts are assigned oldest first, so publishing a
 *   new post never changes the colour of an old one.
 */

/** Hues left out, in OKLCH degrees: orange through yellow-green. */
const BLOCKED_FROM = 55;
const BLOCKED_TO = 130;
const OPEN_ARC = 360 - (BLOCKED_TO - BLOCKED_FROM);

/** How many earlier posts a new one must differ from, and by how much. */
const NEIGHBOURS = 3;
const MIN_SEPARATION = 42;
/** Golden-ratio step through the open arc: successive tries land far apart. */
const GOLDEN = 0.381966;
const MAX_TRIES = 8;

/** One lightness and chroma for every tint, so they are equally bright. */
const LIGHTNESS = 0.66;
const CHROMA = 0.16;

export interface PostTint {
  /** OKLCH hue in degrees. */
  hue: number;
  /** The supporting colour. Mix it toward the text colour for type. */
  color: string;
  /** A CSS `background` of soft light pools, for layering over a dark cover. */
  glow: string;
}

/** The fields a tint is derived from. */
export interface Tintable {
  id: string;
  title: string;
  published: Date;
}

/** FNV-1a: tiny, stable, and well spread for short strings. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, seeded from the hash, for the pools' positions. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A position in [0, 1) along the open arc, as a hue. */
function arcHue(u: number): number {
  return (BLOCKED_TO + u * OPEN_ARC) % 360;
}

function blocked(hue: number): boolean {
  const h = ((hue % 360) + 360) % 360;
  return h > BLOCKED_FROM && h < BLOCKED_TO;
}

function separation(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function oklch(hue: number, alpha = 1, lightness = LIGHTNESS, chroma = CHROMA): string {
  const h = (((hue % 360) + 360) % 360).toFixed(1);
  return alpha === 1
    ? `oklch(${lightness} ${chroma} ${h})`
    : `oklch(${lightness} ${chroma} ${h} / ${alpha})`;
}

/**
 * Three pools, as the backdrop has: the post's hue plus one on each side of
 * it, each at a seeded position and size. A side hue that would fall into the
 * blocked arc swings to the other side instead.
 */
function glowFor(title: string, hue: number): string {
  const rand = random(hash(`${title}#glow`));
  const pools = [
    { offset: 0, alpha: 0.55 },
    { offset: -36, alpha: 0.4 },
    { offset: 30, alpha: 0.34 },
  ];
  return pools
    .map(({ offset, alpha }) => {
      const h = blocked(hue + offset) ? hue - offset : hue + offset;
      const x = 12 + rand() * 76;
      const y = 10 + rand() * 80;
      const w = 48 + rand() * 34;
      return `radial-gradient(${w.toFixed(0)}% ${(w * 1.25).toFixed(0)}% at ${x.toFixed(0)}% ${y.toFixed(0)}%, ${oklch(h, alpha, 0.6, 0.17)}, transparent 72%)`;
    })
    .join(', ');
}

/**
 * Tints for a set of posts, keyed by post id. Pass every published post, not
 * just the ones on screen, so a post's colour does not depend on the page.
 */
export function assignTints(posts: readonly Tintable[]): Map<string, PostTint> {
  const oldestFirst = [...posts].sort((a, b) => a.published.valueOf() - b.published.valueOf());
  const tints = new Map<string, PostTint>();
  const recent: number[] = [];

  for (const post of oldestFirst) {
    let u = hash(post.title) / 4294967296;
    let hue = arcHue(u);
    for (let tries = 0; tries < MAX_TRIES; tries += 1) {
      if (recent.every((other) => separation(hue, other) >= MIN_SEPARATION)) break;
      u = (u + GOLDEN) % 1;
      hue = arcHue(u);
    }
    recent.push(hue);
    if (recent.length > NEIGHBOURS) recent.shift();
    tints.set(post.id, { hue, color: oklch(hue), glow: glowFor(post.title, hue) });
  }
  return tints;
}
