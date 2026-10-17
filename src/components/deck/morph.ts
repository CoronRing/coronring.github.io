/**
 * One exhibit coming apart and reforming as the next.
 *
 * The deck's first three exhibits are all drawn: a trace of lines and nodes,
 * a cloud of particles, a dial. On a cut between two of them the outgoing
 * picture is read back as points (`seed.ts`), so is the first frame of the
 * incoming one, and this animates one set into the other on a canvas laid over
 * the stage. When it lands, the real exhibit is revealed underneath, at the
 * picture the particles just drew.
 *
 * ## The motion
 *
 * Each particle leaves at its own moment and travels on a slightly curved
 * path. Its progress follows a smoothstep of `p^1.6`: it eases out of the old
 * picture, gathers speed, is fastest late in its journey, and settles without
 * a long tail. The colour runs a little behind the position, so a particle
 * that left a yellow lane is still yellow while it travels and only fades into
 * the incoming picture's colour as it arrives.
 *
 * ## Pairing
 *
 * Both clouds are ranked along a Hilbert curve and paired by rank, the same
 * idea the particle engine's own morph uses: two points close on the curve
 * are close in the plane, so neighbours stay neighbours and the eye reads one
 * shape deforming into another rather than noise. Where the counts differ,
 * particles share a start (a line splits into several) or an end (several
 * converge on one point); none is created or destroyed mid-flight.
 */

import type { SeedCloud } from './seed';

/** How a morph runs. */
export interface MorphTiming {
  /** Milliseconds from the first particle leaving to the last one landing. */
  readonly duration: number;
  /** Share of the run over which departures are spread. */
  readonly stagger: number;
  /** Milliseconds the outgoing picture, labels and all, takes to fade off the particles. */
  readonly overlayFade: number;
}

export const MORPH_TIMING: MorphTiming = { duration: 2600, stagger: 0.34, overlayFade: 380 };

/** Upper bound on particles in flight. */
const MAX_PARTICLES = 7000;
/** Grid side for the pairing curve. */
const CURVE_ORDER = 512;

/** Distance along a Hilbert curve for an integer cell. */
function hilbert(x: number, y: number, order: number): number {
  let d = 0;
  for (let s = order >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

/** Indices of `n` points ordered along the curve, over a shared box. */
function rank(
  xs: Float32Array,
  ys: Float32Array,
  box: { x: number; y: number; w: number; h: number },
): Uint32Array {
  const n = xs.length;
  const keys = new Float64Array(n);
  const last = CURVE_ORDER - 1;
  for (let i = 0; i < n; i += 1) {
    const gx = Math.min(last, Math.max(0, (((xs[i] ?? 0) - box.x) / box.w) * last)) | 0;
    const gy = Math.min(last, Math.max(0, (((ys[i] ?? 0) - box.y) / box.h) * last)) | 0;
    keys[i] = hilbert(gx, gy, CURVE_ORDER);
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (keys[a] ?? 0) - (keys[b] ?? 0));
  return Uint32Array.from(idx);
}

/** A cloud's points in the morph canvas's own coordinates. */
function place(cloud: SeedCloud, originLeft: number, originTop: number): {
  x: Float32Array;
  y: Float32Array;
} {
  const n = cloud.points.length / 2;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const dx = cloud.left - originLeft;
  const dy = cloud.top - originTop;
  for (let i = 0; i < n; i += 1) {
    x[i] = dx + (cloud.points[i * 2] ?? 0) * cloud.width;
    y[i] = dy + (cloud.points[i * 2 + 1] ?? 0) * cloud.height;
  }
  return { x, y };
}

/** Smoothstep of `p^1.6`: slow away, fastest late, a short soft landing. */
function travel(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const q = Math.pow(p, 1.6);
  return q * q * (3 - 2 * q);
}

export class Morph {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly timing: MorphTiming;
  private readonly width: number;
  private readonly height: number;
  private readonly dpr: number;
  private readonly origin: { left: number; top: number };

  private readonly from: SeedCloud;
  private n = 0;
  private sx: Float32Array = new Float32Array(0);
  private sy: Float32Array = new Float32Array(0);
  private tx: Float32Array = new Float32Array(0);
  private ty: Float32Array = new Float32Array(0);
  private sc: Uint8Array = new Uint8Array(0);
  private tc: Uint8Array = new Uint8Array(0);
  private delay: Float32Array = new Float32Array(0);
  private curl: Float32Array = new Float32Array(0);
  /** Where each particle was drawn last frame, for handing over mid-flight. */
  private cx: Float32Array = new Float32Array(0);
  private cy: Float32Array = new Float32Array(0);
  private cc: Uint8Array = new Uint8Array(0);

  private started = 0;
  private raf = 0;
  private done: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    from: SeedCloud,
    origin: { left: number; top: number; width: number; height: number },
    timing: MorphTiming = MORPH_TIMING,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    this.ctx = ctx;
    this.canvas = canvas;
    this.timing = timing;
    this.from = from;
    this.origin = { left: origin.left, top: origin.top };
    this.width = origin.width;
    this.height = origin.height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.hold();
  }

  /**
   * Show the outgoing picture as particles, still, while the incoming exhibit
   * gets its first frame drawn.
   */
  private hold(): void {
    const at = place(this.from, this.origin.left, this.origin.top);
    this.n = at.x.length;
    this.cx = at.x;
    this.cy = at.y;
    this.cc = this.from.colors;
    this.paint(this.cx, this.cy, this.cc, this.n, 1);
  }

  /** Pair the clouds and run. `onDone` fires once every particle has landed. */
  run(to: SeedCloud, onDone: () => void): void {
    const a = place(this.from, this.origin.left, this.origin.top);
    const b = place(to, this.origin.left, this.origin.top);
    const ns = a.x.length;
    const nt = b.x.length;
    const n = Math.min(MAX_PARTICLES, Math.max(ns, nt));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const set of [a, b]) {
      for (let i = 0; i < set.x.length; i += 1) {
        const x = set.x[i] ?? 0;
        const y = set.y[i] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const box = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    const ra = rank(a.x, a.y, box);
    const rb = rank(b.x, b.y, box);

    this.n = n;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.sc = new Uint8Array(n * 3);
    this.tc = new Uint8Array(n * 3);
    this.delay = new Float32Array(n);
    this.curl = new Float32Array(n);
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.cc = new Uint8Array(n * 3);

    for (let k = 0; k < n; k += 1) {
      const i = ra[Math.min(ns - 1, Math.floor((k * ns) / n))] ?? 0;
      const j = rb[Math.min(nt - 1, Math.floor((k * nt) / n))] ?? 0;
      this.sx[k] = a.x[i] ?? 0;
      this.sy[k] = a.y[i] ?? 0;
      this.tx[k] = b.x[j] ?? 0;
      this.ty[k] = b.y[j] ?? 0;
      for (let c = 0; c < 3; c += 1) {
        this.sc[k * 3 + c] = this.from.colors[i * 3 + c] ?? 255;
        this.tc[k * 3 + c] = to.colors[j * 3 + c] ?? 255;
      }
      this.delay[k] = Math.random() * this.timing.stagger;
      const dist = Math.hypot((this.tx[k] ?? 0) - (this.sx[k] ?? 0), (this.ty[k] ?? 0) - (this.sy[k] ?? 0));
      this.curl[k] = (Math.random() * 2 - 1) * Math.min(56, dist * 0.2);
    }

    this.done = onDone;
    this.started = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Where the particles are now, as a cloud another morph can start from. */
  current(): SeedCloud {
    const n = this.n;
    const points = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      points[i * 2] = (this.cx[i] ?? 0) / this.width;
      points[i * 2 + 1] = (this.cy[i] ?? 0) / this.height;
    }
    const overlay = document.createElement('canvas');
    overlay.width = this.canvas.width;
    overlay.height = this.canvas.height;
    overlay.getContext('2d')?.drawImage(this.canvas, 0, 0);
    return {
      points,
      colors: this.cc.slice(0, n * 3),
      left: this.origin.left,
      top: this.origin.top,
      width: this.width,
      height: this.height,
      overlay,
    };
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.done = null;
  }

  private readonly frame = (now: number): void => {
    const t = (now - this.started) / this.timing.duration;
    const span = 1 - this.timing.stagger;
    const n = this.n;

    for (let k = 0; k < n; k += 1) {
      const p = Math.max(0, Math.min(1, (t - (this.delay[k] ?? 0)) / span));
      const e = travel(p);
      const sx = this.sx[k] ?? 0;
      const sy = this.sy[k] ?? 0;
      const dx = (this.tx[k] ?? 0) - sx;
      const dy = (this.ty[k] ?? 0) - sy;
      const len = Math.hypot(dx, dy) || 1;
      // A bow across the path, largest mid-flight, so paths read as currents rather than rails.
      const bow = Math.sin(Math.PI * e) * (this.curl[k] ?? 0);
      this.cx[k] = sx + dx * e + (-dy / len) * bow;
      this.cy[k] = sy + dy * e + (dx / len) * bow;
      // Colour trails the position: it holds the old picture's colour into the flight.
      const w = travel(Math.max(0, Math.min(1, (p - 0.12) / 0.88)));
      for (let c = 0; c < 3; c += 1) {
        const from = this.sc[k * 3 + c] ?? 255;
        const to = this.tc[k * 3 + c] ?? 255;
        this.cc[k * 3 + c] = from + (to - from) * w;
      }
    }

    const fade = Math.max(0, 1 - (t * this.timing.duration) / this.timing.overlayFade);
    this.paint(this.cx, this.cy, this.cc, n, fade);

    if (t >= 1) {
      const done = this.done;
      this.done = null;
      this.raf = 0;
      done?.();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Particles bucketed by colour, so a frame is a few hundred fills rather than thousands. */
  private paint(
    xs: Float32Array,
    ys: Float32Array,
    colors: Uint8Array,
    n: number,
    overlay: number,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (overlay > 0) {
      ctx.globalAlpha = overlay;
      ctx.drawImage(
        this.from.overlay,
        this.from.left - this.origin.left,
        this.from.top - this.origin.top,
        this.from.width,
        this.from.height,
      );
    }

    const buckets = new Map<number, number[]>();
    for (let k = 0; k < n; k += 1) {
      const key =
        (((colors[k * 3] ?? 0) >> 3) << 10) |
        (((colors[k * 3 + 1] ?? 0) >> 3) << 5) |
        ((colors[k * 3 + 2] ?? 0) >> 3);
      const list = buckets.get(key);
      if (list) list.push(k);
      else buckets.set(key, [k]);
    }

    ctx.globalAlpha = 0.92;
    const size = 1.9;
    for (const [key, list] of buckets) {
      const r = ((key >> 10) & 31) << 3;
      const g = ((key >> 5) & 31) << 3;
      const b = (key & 31) << 3;
      ctx.fillStyle = `rgb(${r + 4},${g + 4},${b + 4})`;
      ctx.beginPath();
      for (const k of list) ctx.rect((xs[k] ?? 0) - size / 2, (ys[k] ?? 0) - size / 2, size, size);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
