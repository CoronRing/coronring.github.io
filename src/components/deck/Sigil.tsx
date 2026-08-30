import type { SigilKey } from './frames';

/**
 * Sigil — the mark on a deck token.
 *
 * The reference identifies each operator by a portrait. There are no portraits
 * here, and a row of six identical grey circles would make the rail useless
 * for navigation: the visitor has to be able to aim at a frame, not read a
 * list. So each frame gets a stroke glyph that says what kind of thing it is —
 * a broken ring for the particle engine, a graph for the agent system, a
 * bracket stack for the prompt package.
 *
 * All six share one frame (a 24-tick scale on the same radius) so the rail
 * reads as one instrument with six channels rather than six unrelated icons.
 * The glyph inside is what differs.
 *
 * Drawn rather than generated. A hash-driven sigil looks like noise at 56px;
 * six hand-set glyphs read instantly, which is the entire job.
 *
 * `currentColor` throughout, so a token themes and highlights for free.
 */

const BOX = 48;
const C = BOX / 2;
const R_TICK = 22;

/** The shared outer scale. Every fourth tick is long. */
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const major = i % 4 === 0;
  const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
  const inner = R_TICK - (major ? 4 : 2);
  return {
    major,
    x1: C + Math.cos(a) * inner,
    y1: C + Math.sin(a) * inner,
    x2: C + Math.cos(a) * R_TICK,
    y2: C + Math.sin(a) * R_TICK,
  };
});

/**
 * The inner glyphs, in the shared 48-unit box.
 *
 * Kept to strokes on a 1.6 weight so they hold up at 24px and do not turn to
 * mud when a token is inactive and dimmed.
 */
const GLYPHS: Record<SigilKey, React.ReactElement> = {
  // Broken ring with a bar out through the gap: the corona cloud, in one line.
  particle: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M 27.6 12.6 A 10 10 0 1 0 27.6 35.4" />
      <path d="M 22 24 H 34" />
      <circle cx={C} cy={C} r="2.4" fill="currentColor" stroke="none" />
    </g>
  ),

  // Four nodes and the edges between them: an agent graph mid-run.
  agent: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M 16 15 L 30 21 L 18 32 L 32 34" />
      <circle cx="16" cy="15" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="30" cy="21" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="32" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="32" cy="34" r="2.6" fill="currentColor" stroke="none" />
    </g>
  ),

  // A brace enclosing three lines: a template about to be filled.
  prompt: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M 20 15 q -3 0 -3 3 v 3 q 0 3 -3 3 q 3 0 3 3 v 3 q 0 3 3 3" />
      <path d="M 24 19 H 33" />
      <path d="M 24 24 H 31" />
      <path d="M 24 29 H 34" />
    </g>
  ),

  // A dial with its needle past the midpoint: a score being read off.
  gauge: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M 15 30 A 10 10 0 0 1 33 30" />
      <path d="M 24 30 L 30 21" />
      <circle cx={C} cy="30" r="1.8" fill="currentColor" stroke="none" />
    </g>
  ),

  // A die with its pins: everything that runs below the model.
  chip: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="17" y="17" width="14" height="14" rx="1" />
      <path d="M 21 13 v 4 M 27 13 v 4 M 21 31 v 4 M 27 31 v 4" />
      <path d="M 13 21 h 4 M 13 27 h 4 M 31 21 h 4 M 31 27 h 4" />
    </g>
  ),

  // A branch that splits and rejoins: control flow, which is the subject.
  branch: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M 24 14 v 5 q 0 3 -3 3 h -3 q -3 0 -3 3 v 3" />
      <path d="M 24 19 q 0 3 3 3 h 3 q 3 0 3 3 v 3" />
      <circle cx={C} cy="13" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="33" cy="34" r="2.2" fill="currentColor" stroke="none" />
    </g>
  ),
};

interface Props {
  name: SigilKey;
  /** Hide the shared tick scale — used where the token already has a ring. */
  bare?: boolean;
  className?: string;
}

export default function Sigil({ name, bare = false, className }: Props): React.ReactElement {
  return (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} fill="none" aria-hidden="true" className={className}>
      {!bare && (
        <g stroke="currentColor" strokeLinecap="butt">
          {TICKS.map((t, i) => (
            <line
              key={i}
              x1={t.x1.toFixed(2)}
              y1={t.y1.toFixed(2)}
              x2={t.x2.toFixed(2)}
              y2={t.y2.toFixed(2)}
              strokeWidth={t.major ? 1.3 : 0.8}
              opacity={t.major ? 0.6 : 0.3}
            />
          ))}
        </g>
      )}
      {GLYPHS[name]}
    </svg>
  );
}
