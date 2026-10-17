import { emphasize } from '../../lib/emphasis';

/**
 * A line of copy with its key phrases picked out, so a reader skimming a
 * paragraph lands on the words that carry it. See `lib/emphasis.ts`.
 *
 * The phrases are set in the full text colour at a heavier weight, which
 * reads against the muted body copy they usually sit in without turning the
 * paragraph into a row of links. Usable from Astro as well as React: with no
 * `client:` directive it renders to static HTML.
 */
export default function Emph({
  text,
  phrases,
}: {
  text: string;
  phrases?: readonly string[];
}): React.ReactElement {
  return (
    <>
      {emphasize(text, phrases).map((run, i) =>
        run.key ? (
          <strong key={i} className="text-fg font-semibold">
            {run.text}
          </strong>
        ) : (
          run.text
        ),
      )}
    </>
  );
}
