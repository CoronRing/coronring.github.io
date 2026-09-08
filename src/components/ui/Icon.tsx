/**
 * Icon — the React counterpart of `Icon.astro`, over the same registry.
 *
 * The islands cannot render an Astro component, and duplicating the paths
 * inside a `.tsx` file would leave two registries to keep in step. This reads
 * from `./icons.ts` so a path is edited once.
 */
import type { IconName } from './icons';
import { STROKE_ICONS, FILLED_ICONS } from './icons';

export interface IconProps {
  name: IconName;
  /** Rendered size in pixels, applied to both axes. */
  size?: number;
  className?: string;
  /** Provide when the icon is the only content of an interactive element. */
  label?: string;
}

export default function Icon({ name, size = 16, className = '', label }: IconProps) {
  const filledPath = FILLED_ICONS[name];
  const strokePath = STROKE_ICONS[name];
  const path = filledPath ?? strokePath;
  if (!path) return null;

  /**
   * A labelled icon is announced as an image; an unlabelled one is decorative
   * and hidden from the accessibility tree.
   */
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filledPath ? 'currentColor' : 'none'}
      stroke={filledPath ? 'none' : 'currentColor'}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`.trim()}
      {...a11y}
    >
      <path d={path} />
    </svg>
  );
}
