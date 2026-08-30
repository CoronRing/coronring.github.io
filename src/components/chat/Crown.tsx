/**
 * Crown — the assistant's mark.
 *
 * The site's own logo, alive: the ring broken on the right with the bar running
 * out through the gap (see `ui/Mark.astro` for the geometry and why it is
 * broken), plus three rays that make the corona a corona rather than a letter.
 *
 * It is drawn here rather than imported so it can *move*. The rays breathe, the
 * core turns over, and both are driven by a single custom property the caller
 * sets from whichever band of the page the visitor is reading, so the mark takes
 * on the character of what the assistant is currently looking at.
 *
 * ## The rule the animation is held to
 *
 * The mark has to be a mark on **every** frame. An earlier pass had the rays
 * scale to nothing and the bar drawn on a dash offset, which meant that at most
 * moments a third of the logo was missing and what was left read as a squiggle.
 * So: the ring and the bar are always fully drawn, the rays vary in opacity but
 * never below half, and the only thing that actually moves is the core.
 *
 * All of the motion is `transform` and `opacity` on a fixed viewBox, so it costs
 * one composited layer and never reflows the button it sits in.
 */

interface Props {
  /**
   * How lively the mark is, 0..1. Raised while the assistant is being pointed
   * at, or has something to say.
   */
  energy?: number;
  className?: string;
}

/* Geometry on a 32x32 grid, matching `ui/Mark.astro`. */
const C = 16;
const R = 11;
/** Half-angle of the opening on the right, in degrees. */
const GAP = 18;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const px = (deg: number): string => (C + R * Math.cos(rad(deg))).toFixed(2);
const py = (deg: number): string => (C + R * Math.sin(rad(deg))).toFixed(2);

/** The ring, swept the long way round so the gap lands on the right. */
const RING = `M ${px(GAP)} ${py(GAP)} A ${R} ${R} 0 1 1 ${px(-GAP)} ${py(-GAP)}`;

/**
 * The rays, at the three angles the ring has most room for.
 *
 * Each is a chord from just outside the ring to a little further out, so they
 * read as light leaving the corona rather than as ticks on a dial.
 */
const RAYS = [-140, -90, -40].map((deg, i) => ({
  i,
  d: `M ${(C + 13.6 * Math.cos(rad(deg))).toFixed(2)} ${(C + 13.6 * Math.sin(rad(deg))).toFixed(2)} L ${(
    C +
    17.8 * Math.cos(rad(deg))
  ).toFixed(2)} ${(C + 17.8 * Math.sin(rad(deg))).toFixed(2)}`,
}));

export default function Crown({ energy = 0.4, className = '' }: Props): React.ReactElement {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`crown ${className}`}
      style={{ '--crown-energy': energy } as React.CSSProperties}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="crown-rays" strokeWidth="1.7">
        {RAYS.map((ray) => (
          <path key={ray.i} style={{ '--i': ray.i } as React.CSSProperties} d={ray.d} />
        ))}
      </g>

      <path d={RING} />
      {/* From inside the core out past the ring, so it passes through the gap. */}
      <path d="M16 16 H29.5" />

      {/* The core, which turns over rather than pulsing: a pulsing dot is a
          notification badge, and a badge nobody asked for is what this is not. */}
      <g className="crown-core">
        <path d="M16 12.6 L19.4 16 L16 19.4 L12.6 16 Z" strokeWidth="2.4" />
      </g>
    </svg>
  );
}
