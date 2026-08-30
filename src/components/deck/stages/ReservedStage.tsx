import { useEffect, useRef } from 'react';
import Sigil from '../Sigil';
import type { SigilKey } from '../frames';
import { StageShell } from '../StageShell';

/**
 * ReservedStage — the exhibit for a slot that is held but not yet written up.
 *
 * ## Why draw anything at all
 *
 * A deck of three reads as the whole of the work, and it is not. Six frames
 * with three of them honest about their state is a truer picture than three
 * frames that imply there is nothing else. But a slot that renders as a grey
 * box says "unfinished site", not "unfinished write-up", so the placeholder
 * has to be worth looking at on its own.
 *
 * What it draws is a bench instrument with nothing mounted: two counter-
 * rotating tick rings, a sweep, a dashed acquisition arc that never closes,
 * and the frame's sigil held in the middle. It is the same instrument language
 * as the rail tokens and the hero's HUD ring, so it belongs to the set rather
 * than standing in for a member of it.
 *
 * ## The parallax
 *
 * The rings shift a few pixels against the pointer, which is the cheapest way
 * to make a static drawing feel like it is sitting in space rather than
 * printed on the page. Written to CSS custom properties from a `pointermove`
 * coalesced into one `requestAnimationFrame`, so a fast cursor cannot queue
 * more than one write per frame, and nothing here goes through React state.
 *
 * The whole effect is decorative: it is skipped under reduced motion, and its
 * absence changes nothing about what the frame says.
 */

const BOX = 400;
const C = BOX / 2;

/** One ring of radial ticks, every `major`th one long. */
function ticks(radius: number, count: number, major: number, len: number) {
  return Array.from({ length: count }, (_, i) => {
    const isMajor = i % major === 0;
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const inner = radius - (isMajor ? len : len * 0.5);
    return {
      isMajor,
      x1: C + Math.cos(a) * inner,
      y1: C + Math.sin(a) * inner,
      x2: C + Math.cos(a) * radius,
      y2: C + Math.sin(a) * radius,
    };
  });
}

const OUTER = ticks(186, 72, 6, 14);
const INNER = ticks(126, 36, 3, 9);

/** An arc path centred on `midDeg`, spanning `spanDeg`, at radius `r`. */
function arc(midDeg: number, spanDeg: number, r: number): string {
  const a0 = ((midDeg - spanDeg / 2) * Math.PI) / 180;
  const a1 = ((midDeg + spanDeg / 2) * Math.PI) / 180;
  return [
    `M ${(C + Math.cos(a0) * r).toFixed(2)} ${(C + Math.sin(a0) * r).toFixed(2)}`,
    `A ${r} ${r} 0 ${spanDeg > 180 ? 1 : 0} 1 ${(C + Math.cos(a1) * r).toFixed(2)} ${(C + Math.sin(a1) * r).toFixed(2)}`,
  ].join(' ');
}

interface Props {
  sigil: SigilKey;
  /** Frame title, drawn once across the instrument's baseline. */
  title: string;
  active: boolean;
}

export default function ReservedStage({ sigil, title, active }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let pending: { x: number; y: number } | null = null;

    const write = (): void => {
      frame = 0;
      if (!pending) return;
      const rect = host.getBoundingClientRect();
      // −1..1 from the centre of the stage, so the shift is symmetric.
      const dx = (pending.x - rect.left) / rect.width - 0.5;
      const dy = (pending.y - rect.top) / rect.height - 0.5;
      host.style.setProperty('--px', dx.toFixed(3));
      host.style.setProperty('--py', dy.toFixed(3));
      pending = null;
    };

    const onMove = (event: PointerEvent): void => {
      pending = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(write);
    };

    const onLeave = (): void => {
      host.style.setProperty('--px', '0');
      host.style.setProperty('--py', '0');
    };

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active]);

  return (
    <StageShell
      readout={
        <span>
          <span className="opacity-60">SLOT </span>RESERVED
        </span>
      }
      hint="Nothing mounted on this bench yet · the write-up lands here"
    >
      <div
        ref={hostRef}
        className="deck-parallax relative grid size-full place-items-center overflow-hidden"
      >
        <div aria-hidden="true" className="grid-backdrop pointer-events-none absolute inset-0" />

        <div className="deck-parallax-layer text-fg relative aspect-square w-[min(78%,32rem)]">
          <svg viewBox={`0 0 ${BOX} ${BOX}`} fill="none" aria-hidden="true" className="size-full">
            {/* Outer scale — turns slowly one way. */}
            <g className="deck-spin-slow" style={{ transformOrigin: '50% 50%' }}>
              <g stroke="currentColor">
                {OUTER.map((t, i) => (
                  <line
                    key={i}
                    x1={t.x1.toFixed(2)}
                    y1={t.y1.toFixed(2)}
                    x2={t.x2.toFixed(2)}
                    y2={t.y2.toFixed(2)}
                    strokeWidth={t.isMajor ? 1.6 : 1}
                    opacity={t.isMajor ? 0.4 : 0.18}
                  />
                ))}
              </g>
              {/* The acquisition arc: dashed, and deliberately never closed. */}
              <path
                d={arc(-90, 128, 168)}
                stroke="var(--c-accent)"
                strokeWidth="3"
                strokeDasharray="14 9"
                opacity="0.75"
              />
            </g>

            {/* Inner scale — turns the other way, so the two never lock up. */}
            <g className="deck-spin-rev" style={{ transformOrigin: '50% 50%' }}>
              <g stroke="currentColor">
                {INNER.map((t, i) => (
                  <line
                    key={i}
                    x1={t.x1.toFixed(2)}
                    y1={t.y1.toFixed(2)}
                    x2={t.x2.toFixed(2)}
                    y2={t.y2.toFixed(2)}
                    strokeWidth={t.isMajor ? 1.4 : 0.9}
                    opacity={t.isMajor ? 0.34 : 0.15}
                  />
                ))}
              </g>
            </g>

            {/* Crosshair guides and the bezel. */}
            <g stroke="currentColor" opacity="0.22">
              <circle cx={C} cy={C} r="96" strokeWidth="1" />
              <path d={`M ${C} 24 V 74 M ${C} ${BOX - 24} V ${BOX - 74}`} strokeWidth="1" />
              <path d={`M 24 ${C} H 74 M ${BOX - 24} ${C} H ${BOX - 74}`} strokeWidth="1" />
            </g>

            {/* The sweep. */}
            <g className="deck-sweep" style={{ transformOrigin: '50% 50%' }}>
              <path
                d={`M ${C} ${C} L ${C} 30`}
                stroke="var(--c-accent)"
                strokeWidth="1.5"
                opacity="0.55"
              />
            </g>
          </svg>

          {/* The sigil, held where the instrument would be. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Sigil name={sigil} bare className="text-fg/70 deck-breathe size-[26%]" />
          </div>
        </div>

        <p className="text-faint absolute bottom-6 left-4 font-mono text-[10px] tracking-[0.3em] uppercase lg:left-8">
          {title} · bench idle
        </p>
      </div>
    </StageShell>
  );
}
