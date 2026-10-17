/**
 * The dial behind the NewsRing frame: one morning's selection, replayed.
 *
 * NewsRing reads every source first and only then lets the model choose
 * (collect, then select), so the picture is a ring of sources with everything
 * they published flowing inward. Most of it is dropped on the way in. The
 * stories that made the digest travel all the way to the inner ring, from the
 * tick of the source they actually came from, and leave a thread behind, so
 * by the end of a cycle the dial shows where today's news came from.
 *
 * A cycle runs in the same two phases NewsRing does. **Reading**: every
 * candidate streams in from its source at once, and most give out on the way.
 * **Selecting**: the picks arrive one at a time, about a second apart, and
 * each landing is reported (`onLand`) so the stage can light that story in its
 * list and put its headline in the middle of the ring. The full selection is
 * then held long enough to read before the cycle starts over.
 *
 * `setHighlight` picks one story out: its thread and its source are drawn
 * strong and the rest step back, so a story in the stage's list can be traced
 * to where it came from.
 *
 * Lines, ticks and dots are on one canvas and the source names on another,
 * for the same reason as the agent flow: the deck reads the first back as
 * particles (`../seed.ts`).
 */

/** Colours, resolved from the page's tokens by the caller. */
export interface DialPalette {
  readonly line: string;
  readonly lineStrong: string;
  readonly dot: string;
  readonly faint: string;
  readonly text: string;
  readonly ground: string;
  /** The picked colour. */
  readonly accent: string;
  readonly dark: boolean;
}

/** Where the inner ring is, so the stage can size the headline inside it. */
export interface DialLayout {
  readonly cx: number;
  readonly cy: number;
  readonly inner: number;
}

interface Candidate {
  source: number;
  born: number;
  life: number;
  picked: boolean;
  /** Where a dropped candidate gives out, as a share of the ring radius. */
  dropAt: number;
  /** Angle it swirls through on the way in. */
  swirl: number;
  /** For picks: which story it is. */
  story: number;
  landed: boolean;
}

/** Seconds the reading phase spends streaming every candidate in. */
const READ = 2.4;
/** Seconds between one pick landing and the next. The list beside the dial carries the reading. */
const PER_STORY = 0.85;
/** Seconds a picked story takes to come in. */
const PICK_TRAVEL = 1.3;
/** When the first pick sets off, relative to the end of reading. */
const FIRST_PICK = READ - 0.7;
/** Seconds the full selection is held before the cycle starts over: time to read the list. */
const HOLD = 12;
/** Seconds the threads take to fade at the end of a cycle. */
const CLEAR = 0.9;

const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

export class NewsDial {
  private readonly shape: HTMLCanvasElement;
  private readonly type: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly tctx: CanvasRenderingContext2D;

  private palette: DialPalette;
  private names: readonly string[];
  private width = 0;
  private height = 0;
  private dpr = 1;
  /** Bottom of the box the deck's control row covers, in CSS pixels. */
  private chrome = 0;

  /** Sources each story came from, in landing order. */
  private picks: number[] = [];
  /** How many candidates one cycle draws in total. */
  private volume = 120;

  private clock = 0;
  private cycleStart = 0;
  private candidates: Candidate[] = [];
  private scheduled = 0;
  private flashes = new Map<number, number>();
  /** The story picked out by the stage, or -1. */
  private highlight = -1;

  private paused = false;
  private running = false;
  private raf = 0;
  private last = 0;

  onLand: ((story: number) => void) | null = null;
  onCycle: (() => void) | null = null;

  constructor(
    shape: HTMLCanvasElement,
    type: HTMLCanvasElement,
    palette: DialPalette,
    names: readonly string[],
  ) {
    const sctx = shape.getContext('2d', { willReadFrequently: true });
    const tctx = type.getContext('2d');
    if (!sctx || !tctx) throw new Error('Canvas 2D is not available.');
    this.shape = shape;
    this.type = type;
    this.sctx = sctx;
    this.tctx = tctx;
    this.palette = palette;
    this.names = names;
  }

  /* ── Public surface ──────────────────────────────────────────────── */

  resize(width: number, height: number, dpr: number, chrome: number): DialLayout {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.chrome = chrome;
    for (const canvas of [this.shape, this.type]) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this.draw();
    return this.layout();
  }

  /**
   * Today's selection: the source index of each picked story, in order, and
   * how many candidates were read in all. Restarts the cycle.
   */
  setSelection(picks: readonly number[], candidates: number): void {
    this.picks = [...picks];
    this.volume = Math.max(picks.length + 30, Math.min(260, candidates));
    this.restart();
  }

  /** Where the cycle is, for the stage's caption in the middle of the ring. */
  progress(): { phase: 'reading' | 'selecting'; read: number; total: number } {
    const t = this.clock - this.cycleStart;
    const read = Math.min(this.volume, this.scheduled + this.picksSent());
    return { phase: t < READ ? 'reading' : 'selecting', read, total: this.volume };
  }

  private picksSent(): number {
    return this.candidates.filter((c) => c.picked).length;
  }

  setPalette(palette: DialPalette): void {
    this.palette = palette;
    this.draw();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Pick out one story (by its index in the selection), or none with -1. */
  setHighlight(story: number): void {
    if (story === this.highlight) return;
    this.highlight = story;
    if (!this.running) this.draw();
  }

  /** True once every pick of the cycle has landed. */
  allLanded(): boolean {
    return this.clock - this.cycleStart >= this.lastLanding();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Jump to the end of the cycle: every pick landed. For reduced motion. */
  settle(): void {
    this.clock = this.cycleStart + this.lastLanding() + 0.01;
    this.spawn();
    for (const c of this.candidates) if (c.picked && !c.landed) this.land(c);
    this.candidates = this.candidates.filter((c) => c.picked);
    this.draw();
  }

  layout(): DialLayout {
    const g = this.geometry();
    return { cx: g.cx, cy: g.cy, inner: g.inner };
  }

  draw(): void {
    if (!this.width || !this.height) return;
    this.drawShape();
    this.drawType();
  }

  /* ── Time ────────────────────────────────────────────────────────── */

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.clock += dt;
      this.spawn();
      this.update();
    }
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private lastLanding(): number {
    return FIRST_PICK + Math.max(0, this.picks.length - 1) * PER_STORY + PICK_TRAVEL;
  }

  private cycleLength(): number {
    return this.lastLanding() + HOLD + CLEAR;
  }

  private restart(): void {
    this.cycleStart = this.clock;
    this.candidates = [];
    this.scheduled = 0;
    this.flashes.clear();
    this.highlight = -1;
    this.onCycle?.();
  }

  /** Emit everything the cycle has reached: drops at a steady rate, picks on their beat. */
  private spawn(): void {
    const t = this.clock - this.cycleStart;
    const drops = this.volume - this.picks.length;
    // Eased, so the stream builds up and tails off rather than switching on.
    const share = Math.min(1, t / (READ - 1.2));
    const due = Math.min(drops, Math.floor(share * share * (3 - 2 * share) * drops));
    while (this.scheduled < due) {
      this.scheduled += 1;
      const source = Math.floor(Math.random() * this.names.length);
      this.emit({
        source,
        born: this.clock - Math.random() * 0.05,
        life: 1.3 + Math.random() * 1.2,
        picked: false,
        dropAt: 0.62 + Math.random() * 0.3,
        swirl: (Math.random() - 0.5) * 0.5,
        story: -1,
        landed: false,
      });
    }
    this.picks.forEach((source, story) => {
      const at = FIRST_PICK + story * PER_STORY;
      const exists = this.candidates.some((c) => c.picked && c.story === story);
      if (!exists && t >= Math.max(0, at)) {
        this.emit({
          source,
          born: this.cycleStart + Math.max(0, at),
          life: PICK_TRAVEL,
          picked: true,
          dropAt: 0,
          swirl: (story % 2 === 0 ? 1 : -1) * 0.35,
          story,
          landed: false,
        });
      }
    });
  }

  private emit(c: Candidate): void {
    this.candidates.push(c);
    this.flashes.set(c.source, this.clock);
  }

  private update(): void {
    for (const c of this.candidates) {
      if (c.picked && !c.landed && this.clock - c.born >= c.life) this.land(c);
    }
    // Dropped candidates leave once they have faded; picks stay for the cycle.
    this.candidates = this.candidates.filter((c) => c.picked || this.clock - c.born < c.life);
    if (this.clock - this.cycleStart >= this.cycleLength()) this.restart();
  }

  private land(c: Candidate): void {
    c.landed = true;
    this.onLand?.(c.story);
  }

  /* ── Geometry ────────────────────────────────────────────────────── */

  private geometry(): {
    cx: number;
    cy: number;
    outer: number;
    inner: number;
    labels: boolean;
  } {
    const top = 36;
    // The ring may run under the control row, which is translucent: the dial
    // is the exhibit and should be the size of the others.
    const bottom = this.height - this.chrome * 0.3 - 12;
    const room = Math.max(60, (bottom - top) / 2);
    const narrow = this.width < 640;
    const across = this.width * (narrow ? 0.47 : 0.45);
    // Names need about 104px outside the ring; drop them only once the ring would get small.
    const labels = Math.min(room, across) - 104 > 150;
    const outer = Math.max(60, Math.min(room, across) - (labels ? 104 : 18));
    const cy = top + room;
    return { cx: this.width * (narrow ? 0.5 : 0.55), cy, outer, inner: outer * 0.64, labels };
  }

  private angle(source: number): number {
    return (source / Math.max(1, this.names.length)) * Math.PI * 2 - Math.PI / 2;
  }

  /** Where a candidate is `u` of the way in (0 at the ring, 1 at its end). */
  private position(c: Candidate, u: number): { x: number; y: number } {
    const g = this.geometry();
    const end = c.picked ? g.inner : g.outer * c.dropAt;
    const eased = 1 - Math.pow(1 - u, 2.2);
    const r = g.outer - (g.outer - end) * eased;
    const a = this.angle(c.source) + c.swirl * eased;
    return { x: g.cx + Math.cos(a) * r, y: g.cy + Math.sin(a) * r };
  }

  /* ── Drawing ─────────────────────────────────────────────────────── */

  private drawShape(): void {
    const ctx = this.sctx;
    const { palette } = this;
    const g = this.geometry();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = 'round';

    const t = this.clock - this.cycleStart;
    const clearing = Math.max(0, t - this.lastLanding() - HOLD) / CLEAR;
    const keep = 1 - Math.min(1, clearing);

    // The two rings.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = palette.lineStrong;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.outer, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // A fine scale between them, so the gap reads as a dial and not as empty space.
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let i = 0; i < 120; i += 1) {
      const a = (i / 120) * Math.PI * 2;
      const r0 = g.inner + 6;
      const r1 = g.inner + (i % 5 === 0 ? 14 : 9);
      ctx.beginPath();
      ctx.moveTo(g.cx + Math.cos(a) * r0, g.cy + Math.sin(a) * r0);
      ctx.lineTo(g.cx + Math.cos(a) * r1, g.cy + Math.sin(a) * r1);
      ctx.stroke();
    }

    // Source ticks, lit for a moment when they publish.
    const focusSource = this.highlight >= 0 ? (this.picks[this.highlight] ?? -1) : -1;
    for (let i = 0; i < this.names.length; i += 1) {
      const a = this.angle(i);
      const lit = Math.max(0, 1 - (this.clock - (this.flashes.get(i) ?? -10)) / 0.7);
      const pickedHere = this.candidates.some((c) => c.picked && c.source === i && c.landed);
      const focus = i === focusSource;
      const back = focusSource >= 0 && !focus ? 0.4 : 1;
      ctx.globalAlpha = (0.55 + lit * 0.45) * back;
      ctx.strokeStyle = pickedHere || focus ? palette.accent : palette.dot;
      ctx.lineWidth = focus ? 3.4 : pickedHere ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.moveTo(g.cx + Math.cos(a) * (g.outer - 7), g.cy + Math.sin(a) * (g.outer - 7));
      ctx.lineTo(g.cx + Math.cos(a) * (g.outer + 7), g.cy + Math.sin(a) * (g.outer + 7));
      ctx.stroke();
      ctx.fillStyle = pickedHere ? palette.accent : palette.dot;
      ctx.beginPath();
      ctx.arc(
        g.cx + Math.cos(a) * (g.outer + 12),
        g.cy + Math.sin(a) * (g.outer + 12),
        (focus ? 3.4 : 1.8) + lit * 1.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Candidates on their way in.
    for (const c of this.candidates) {
      const u = Math.min(1, (this.clock - c.born) / c.life);
      if (u < 0) continue;
      if (c.picked) {
        // The thread: the whole path so far, so the selection stays drawn.
        const focus = this.highlight === c.story;
        const back = this.highlight >= 0 && !focus ? 0.28 : 1;
        ctx.globalAlpha = 0.85 * keep * back;
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = focus ? 3 : 1.5;
        ctx.beginPath();
        for (let s = 0; s <= 24; s += 1) {
          const p = this.position(c, (s / 24) * u);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        const head = this.position(c, u);
        this.glow(ctx, head.x, head.y, palette.accent, (focus ? 1.6 : c.landed ? 1 : 1.3) * keep * back);
        if (c.landed) {
          // A flash round the inner ring when it lands.
          const since = this.clock - (c.born + c.life);
          if (since < 0.8) {
            ctx.globalAlpha = (1 - since / 0.8) * 0.9;
            ctx.strokeStyle = palette.accent;
            ctx.lineWidth = 2;
            const a = Math.atan2(head.y - g.cy, head.x - g.cx);
            const sweep = 0.25 + since * 2.2;
            ctx.beginPath();
            ctx.arc(g.cx, g.cy, g.inner, a - sweep, a + sweep);
            ctx.stroke();
          }
        }
        continue;
      }
      const p = this.position(c, u);
      const tail = this.position(c, Math.max(0, u - 0.12));
      ctx.globalAlpha = (u < 0.7 ? 0.85 : ((1 - u) / 0.3) * 0.85) * 0.95;
      ctx.strokeStyle = palette.dot;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = palette.text;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private glow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colour: string,
    strength: number,
  ): void {
    if (strength <= 0.01) return;
    const r = 12 * strength;
    const prev = ctx.globalCompositeOperation;
    if (this.palette.dark) ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.45 * Math.min(1, strength);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = prev;
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawType(): void {
    const ctx = this.tctx;
    const { palette } = this;
    const g = this.geometry();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!g.labels) return;

    const focusSource = this.highlight >= 0 ? (this.picks[this.highlight] ?? -1) : -1;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.names.length; i += 1) {
      const a = this.angle(i);
      const lit = Math.max(0, 1 - (this.clock - (this.flashes.get(i) ?? -10)) / 0.7);
      const pickedHere = this.candidates.some((c) => c.picked && c.source === i && c.landed);
      const focus = i === focusSource;
      const r = g.outer + 20;
      const x = g.cx + Math.cos(a) * r;
      const y = g.cy + Math.sin(a) * r;
      // Radial type, flipped on the left half so it never reads upside down.
      const flip = Math.cos(a) < 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(flip ? a + Math.PI : a);
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.globalAlpha = focus ? 1 : (pickedHere ? 1 : 0.5 + lit * 0.4) * (focusSource >= 0 ? 0.45 : 1);
      ctx.font = `${focus ? 700 : 500} ${focus ? 11 : 9.5}px ${MONO}`;
      ctx.fillStyle = pickedHere || focus ? palette.accent : palette.faint;
      if ((pickedHere || focus) && !palette.dark) ctx.fillStyle = palette.text;
      ctx.fillText((this.names[i] ?? '').toUpperCase(), 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
