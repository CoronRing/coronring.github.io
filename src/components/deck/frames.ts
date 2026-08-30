/**
 * The deck roster.
 *
 * The deck is the landing page: one full-height instrument that cuts between
 * projects the way the reference site cuts between operators. This module owns
 * *what* it cuts between; `ProjectDeck.tsx` owns how.
 *
 * ## Why a table rather than more frontmatter
 *
 * A frame needs two things the projects collection has no business carrying: a
 * stage key (which interactive exhibit fills the viewport) and a short code
 * (the two-letter mark on its token). Both are presentation decisions specific
 * to this one surface, so they live here, keyed by project id, and the project
 * content stays about the project. Everything else on a frame — title, blurb,
 * stack, status, link — comes from the collection, so editing an MDX file
 * still edits the deck.
 *
 * A project with no entry here is simply not on the deck. That is deliberate:
 * the deck is a curated six, not a listing. The listing is `/projects`.
 */

/** Which interactive exhibit fills the stage. */
export type StageKey = 'particle' | 'agent' | 'prompt' | 'reserved';

/** Which sigil is drawn on the frame's token. See `Sigil.tsx`. */
export type SigilKey = 'particle' | 'agent' | 'prompt' | 'gauge' | 'chip' | 'branch';

/** A project as the deck receives it from Astro. Mirrors the collection. */
export interface DeckProject {
  id: string;
  title: string;
  summary: string;
  status: 'live' | 'in-progress' | 'archived';
  tech: string[];
  period?: string;
  href: string;
}

export interface DeckFrame {
  id: string;
  /** Two-letter mark, kept for compact contexts. */
  code: string;
  title: string;
  /** Name under the rail token. A logo does not say what a project is. */
  railName: string;
  /** Two or three sentences. The stage carries the rest. */
  blurb: string;
  /** One label/value pair. The frame's own exhibit says the rest. */
  meta: { label: string; value: string };
  status: DeckProject['status'] | 'reserved';
  stage: StageKey;
  sigil: SigilKey;
  /** Absent on reserved frames — there is nothing to open yet. */
  href?: string;
}

/** Presentation-only additions, keyed by project id. */
const DECK_META: Record<string, { code: string; stage: StageKey; sigil: SigilKey }> = {
  'particle-wave': { code: 'PW', stage: 'particle', sigil: 'particle' },
  featherring: { code: 'FR', stage: 'agent', sigil: 'agent' },
  'gs-prompt-manager': { code: 'GS', stage: 'prompt', sigil: 'prompt' },
};

/**
 * Slots held for work that is real but not yet written up.
 *
 * They are on the deck rather than hidden because a roster of three reads as
 * the whole of the work, and it is not. They are marked `reserved` and say so
 * on the stage; nothing here claims to be shippable, and none of them offers a
 * link to a page that does not exist.
 *
 * The three areas match the capability pillars the home page already carries,
 * so this is the same claim in a different register, not a new one.
 */
const RESERVED: readonly DeckFrame[] = [
  {
    id: 'evaluation',
    code: 'EV',
    title: 'Evaluation',
    railName: 'Evaluation',
    blurb:
      'Benchmarks that score expert systems on accuracy, hallucination, security and fairness, and the harness that keeps those scores comparable between runs. Write-up in progress.',
    meta: { label: 'Area', value: 'Measurement' },
    status: 'reserved',
    stage: 'reserved',
    sigil: 'gauge',
  },
  {
    id: 'systems',
    code: 'SY',
    title: 'Systems',
    railName: 'Systems',
    blurb:
      'GPU programming, HDL, and vision-language models that read hardware schematics. The half of the work that runs below the model rather than on top of it. Write-up in progress.',
    meta: { label: 'Area', value: 'Low level' },
    status: 'reserved',
    stage: 'reserved',
    sigil: 'chip',
  },
  {
    id: 'research',
    code: 'RS',
    title: 'Research',
    railName: 'Research',
    blurb:
      'Control-flow guided test generation, and what it takes to move branch coverage on code a model has never seen. Write-up in progress.',
    meta: { label: 'Area', value: 'Program analysis' },
    status: 'reserved',
    stage: 'reserved',
    sigil: 'branch',
  },
];

/**
 * Merge the projects collection with the deck's presentation table, then
 * append the reserved slots.
 *
 * Order follows the order the projects arrive in, which the caller has already
 * sorted by the collection's `order` field.
 */
export function buildFrames(projects: readonly DeckProject[]): DeckFrame[] {
  const fromCollection = projects.flatMap<DeckFrame>((project) => {
    const meta = DECK_META[project.id];
    if (!meta) return [];
    return [
      {
        id: project.id,
        code: meta.code,
        title: project.title,
        railName: project.title,
        blurb: project.summary,
        meta: { label: 'Stack', value: project.tech.slice(0, 3).join(' · ') },
        status: project.status,
        stage: meta.stage,
        sigil: meta.sigil,
        href: project.href,
      },
    ];
  });

  return [...fromCollection, ...RESERVED];
}
