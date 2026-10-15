/**
 * The agent flow behind the Railtracks frame: an endless run, traced as it
 * happens.
 *
 * ## The picture
 *
 * A plotter head sits near the top of the box and the paper runs downward
 * under it, so everything the run has done flows down and off the bottom
 * while the head keeps printing what it does next. One lane per agent:
 *
 * - The **main agent** prints a straight lane down the middle.
 * - A **tool call** branches straight out, at a right angle, to a leaf, and a
 *   pulse runs out to it and back with the result.
 * - A **subagent** forks off on a diagonal into a lane of its own, in its own
 *   colour. It makes its own tool calls, may fork a subagent of its own, and
 *   when it finishes it runs back on a diagonal and merges into its parent,
 *   which waits on it (drawn dashed) until then.
 *
 * Each top-level run starts slow and accelerates as it goes, the way a run
 * gathers pace once the plan is made, then the next run starts slow again.
 * Hovering stops the paper so every label can be read, and the hovered item
 * says what it is.
 *
 * ## Where things live
 *
 * Positions are stored in *paper* coordinates: a lane slot (an integer, 0 for
 * the main lane) across, and `tau`, how much paper had run when it was printed,
 * down. Screen position is derived every frame, so a resize re-lays out the
 * whole history and nothing has to be recomputed. Every animation is keyed to
 * the paper rather than the clock, so stopping the paper stops everything.
 *
 * Lines and nodes are drawn on one canvas and the type on another, so the deck
 * can read the picture back as particles without the text (see `../seed.ts`).
 */

import type { Source } from '../../../lib/rng';

/* ── Model ─────────────────────────────────────────────────────────── */

export type FlowKind = 'flow' | 'llm' | 'tool' | 'agent' | 'merge' | 'done';

/** One printed item, as the hover card describes it. */
export interface FlowItem {
  readonly id: number;
  readonly kind: FlowKind;
  /** 0 for the main agent, 1 for a subagent, 2 for a subagent's subagent. */
  readonly depth: number;
  /** Lane slot the item sits on; a tool leaf sits off it, see `side`. */
  readonly slot: number;
  /** Tool leaves only: which way the branch goes, -1 or 1. */
  readonly side: number;
  readonly tau: number;
  /** Short text printed beside it. Empty for model calls, which would crowd the lane. */
  readonly label: string;
  /** Who did it: the agent's name, or the tool's. */
  readonly title: string;
  /** One line on what happened. */
  readonly detail: string;
  readonly laneId: number;
}

/** What the hover card needs, in CSS pixels relative to the box. */
export interface HoverInfo {
  readonly item: FlowItem;
  readonly x: number;
  readonly y: number;
}

/** Live counters for the stage readout. */
export interface FlowStats {
  readonly run: number;
  readonly agents: number;
  readonly tools: number;
  /** Current paper speed as a multiple of the starting speed. */
  readonly speed: number;
  readonly paused: boolean;
}

/** Colours, resolved from the page's tokens by the caller. */
export interface FlowPalette {
  readonly depth: readonly [string, string, string];
  readonly tool: string;
  readonly ground: string;
  readonly text: string;
  readonly faint: string;
  readonly accent: string;
  /** True on a dark theme, where glow is additive light. */
  readonly dark: boolean;
}

interface Segment {
  slot1: number;
  t1: number;
  slot2: number;
  /** `null` while the lane is still printing it: the end is the head. */
  t2: number | null;
  depth: number;
  dashed: boolean;
  laneId: number;
}

interface Stub {
  slot: number;
  side: number;
  tau: number;
  depth: number;
  laneId: number;
}

type Action =
  | { type: 'llm'; detail: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'spawn'; count: 1 | 2 };

interface Lane {
  id: number;
  depth: number;
  slot: number;
  parent: Lane | null;
  name: string;
  queue: Action[];
  /** Paper position at which the next action fires. */
  nextAt: number;
  /** Children still running; the lane waits (dashed) until it is empty. */
  waiting: Set<number>;
  /** The segment the lane is currently printing. */
  live: Segment | null;
  /** True once the lane has merged back, or for a lane that has not started. */
  closed: boolean;
  /** Paper position the lane's own line starts at, after its fork diagonal. */
  startsAt: number;
}

/* ── Content ───────────────────────────────────────────────────────── */

/** Top-level runs, each a flow name and how it reports done. */
const RUNS: ReadonlyArray<{ name: string; done: string }> = [
  { name: 'Daily news brief', done: 'Brief sent' },
  { name: 'Fix the failing test', done: 'Tests green' },
  { name: 'Support ticket triage', done: '12 tickets routed' },
  { name: 'Paper review', done: 'Review drafted' },
  { name: 'Release notes', done: 'Notes published' },
  { name: 'Market scan', done: 'Report filed' },
];

const SUBAGENTS: readonly string[] = [
  'Researcher',
  'Coder',
  'Critic',
  'Planner',
  'Fact checker',
  'SQL analyst',
  'Summarizer',
  'Browser',
];

const SUB_SUBAGENTS: readonly string[] = [
  'Scraper',
  'Reader',
  'Test runner',
  'Linter',
  'Translator',
];

/** Tools, each with the shapes its one-line result can take. */
const TOOLS: ReadonlyArray<{ name: string; results: readonly string[] }> = [
  {
    name: 'web_search',
    results: ['"gemini 4 argon pricing" → 8 results', '"vllm 0.9 changelog" → 5 results'],
  },
  { name: 'read_file', results: ['src/agent.py · 214 lines', 'README.md · 3.1 kB'] },
  { name: 'write_file', results: ['tests/test_flow.py · 2 hunks', 'notes/brief.md · created'] },
  { name: 'run_python', results: ['exit 0 · 1.8 s', '3 passed, 1 failed'] },
  { name: 'fetch_url', results: ['200 · 41 kB of article text', '200 · RSS, 30 items'] },
  { name: 'sql_query', results: ['412 rows · 38 ms', '1 row · 9 ms'] },
  { name: 'grep_repo', results: ['"retry(" → 7 matches', '"TODO" → 23 matches'] },
  { name: 'vector_search', results: ['top 5 of 18k chunks', 'top 3, best 0.84'] },
  { name: 'send_email', results: ['1 message queued', 'held for approval'] },
  { name: 'shell', results: ['git status · clean', 'uv sync · 0.6 s'] },
  { name: 'mcp.github', results: ['issue #212 opened', '4 open PRs listed'] },
];

const THOUGHTS: readonly string[] = [
  'Plans the next two tool calls',
  'Reads the results and decides what is missing',
  'Drafts the answer from what it has',
  'Chooses which subagent to hand this to',
  'Checks the draft against the brief',
];

/* ── Tuning ────────────────────────────────────────────────────────── */

/** Paper speed at the start of a run, CSS pixels per second. */
const SPEED_START = 42;
/** Paper speed a run accelerates toward. */
const SPEED_TOP = 240;
/** Paper a run takes to reach its top speed. */
const RAMP_PAPER = 2000;
/** Seconds for the actual speed to close half the gap to its target. */
const SPEED_HALF_LIFE = 0.32;

/** Paper between one action and the next on a lane. */
const GAP_MIN = 20;
const GAP_MAX = 38;
/** Paper a tool call's pulse takes to run out to the leaf and back. */
const PULSE_PAPER = 34;
/** A branch is this share of the lane spacing long. */
const STUB_SHARE = 0.5;
/** Paper between the sleepers drawn across the main lane. */
const SLEEPER_PITCH = 11;
/** Below this box width the flow keeps to one lane either side, centred. */
const NARROW = 640;
/** Paper kept clear around a merge, so two labels never share a line. */
const MERGE_CLEARANCE = 20;

/** Head line, as a share of the box height from the top. */
const HEAD_AT = 0.13;
/** Where the history starts fading out, as a share of the box height. */
const FADE_FROM = 0.66;

const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

/* ── Engine ────────────────────────────────────────────────────────── */

export class AgentFlow {
  private readonly shape: HTMLCanvasElement;
  private readonly type: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly tctx: CanvasRenderingContext2D;
  private readonly random: Source;

  private palette: FlowPalette;
  private width = 0;
  private height = 0;
  private dpr = 1;

  /** Paper run so far. */
  private paper = 0;
  private speed = SPEED_START;
  private runStart = 0;
  private runIndex = 0;
  private agentsThisRun = 1;
  private toolsThisRun = 0;

  private nextId = 1;
  private lanes: Lane[] = [];
  private segments: Segment[] = [];
  private stubs: Stub[] = [];
  private items: FlowItem[] = [];
  /** Where each item's label was last drawn, for hit testing. */
  private labelBoxes = new Map<number, { x: number; y: number; w: number; h: number }>();

  /** Paper position at which the next top-level run begins, while one is due. */
  private pendingRun: number | null = null;

  private paused = false;
  private hovered: FlowItem | null = null;
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(
    shape: HTMLCanvasElement,
    type: HTMLCanvasElement,
    palette: FlowPalette,
    random: Source,
  ) {
    const sctx = shape.getContext('2d', { willReadFrequently: true });
    const tctx = type.getContext('2d');
    if (!sctx || !tctx) throw new Error('Canvas 2D is not available.');
    this.shape = shape;
    this.type = type;
    this.sctx = sctx;
    this.tctx = tctx;
    this.palette = palette;
    this.random = random;
    this.startMainLane();
  }

  /* ── Public surface ──────────────────────────────────────────────── */

  /** Match the canvases to their box. Call on mount and on every resize. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of [this.shape, this.type]) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this.draw();
  }

  /**
   * Run the paper forward without drawing, so the box opens on a history
   * rather than on an empty sheet. The run then starts slow from here.
   */
  preroll(paper: number): void {
    const step = 6;
    for (let p = 0; p < paper; p += step) this.advance(step);
    this.runStart = this.paper;
    this.speed = SPEED_START;
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
    this.raf = 0;
  }

  setPalette(palette: FlowPalette): void {
    this.palette = palette;
    this.draw();
  }

  /** Stop the paper (the hover pause) or let it run again from the start speed. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) this.hovered = null;
    this.draw();
  }

  /**
   * What is under a point in the box, if anything. Nodes are hit within a
   * comfortable radius, and labels anywhere on their plate.
   */
  pick(x: number, y: number): HoverInfo | null {
    let best: HoverInfo | null = null;
    let bestDistance = 18;
    for (const item of this.items) {
      if (item.tau > this.paper) continue;
      const at = this.itemPoint(item);
      if (at.y < -20 || at.y > this.height * 0.94) continue;
      const box = this.labelBoxes.get(item.id);
      const onLabel =
        box !== undefined &&
        x >= box.x - 3 &&
        x <= box.x + box.w + 3 &&
        y >= box.y - 3 &&
        y <= box.y + box.h + 3;
      const d = onLabel ? 0 : Math.hypot(at.x - x, at.y - y);
      if (d < bestDistance) {
        best = { item, x: at.x, y: at.y };
        bestDistance = d;
      }
    }
    this.hovered = best?.item ?? null;
    this.draw();
    return best;
  }

  stats(): FlowStats {
    return {
      run: this.runIndex + 1,
      agents: this.agentsThisRun,
      tools: this.toolsThisRun,
      speed: this.speed / SPEED_START,
      paused: this.paused,
    };
  }

  /** Draw one frame at the current paper position (for reduced motion and theme changes). */
  draw(): void {
    if (!this.width || !this.height) return;
    this.drawShape();
    this.drawType();
  }

  /* ── Frame loop ──────────────────────────────────────────────────── */

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    const target = this.paused ? 0 : this.targetSpeed();
    // Exponential approach: smooth on the way up, quick to stop on hover.
    const halfLife = this.paused ? 0.09 : SPEED_HALF_LIFE;
    this.speed += (target - this.speed) * (1 - Math.pow(0.5, dt / halfLife));
    if (this.paused && this.speed < 0.5) this.speed = 0;

    const travel = this.speed * dt;
    if (travel > 0) {
      // Small steps so a fast frame never skips past an action.
      const steps = Math.ceil(travel / 6);
      for (let i = 0; i < steps; i += 1) this.advance(travel / steps);
    }

    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Starts slow, accelerates through the run. */
  private targetSpeed(): number {
    const progress = Math.max(0, Math.min(1, (this.paper - this.runStart) / RAMP_PAPER));
    const eased = progress * progress * (3 - 2 * progress) * 0.35 + progress * progress * 0.65;
    return SPEED_START + (SPEED_TOP - SPEED_START) * eased;
  }

  /* ── Simulation ──────────────────────────────────────────────────── */

  private advance(distance: number): void {
    this.paper += distance;
    // Lanes are walked by index: a lane that forks appends to the list.
    for (let i = 0; i < this.lanes.length; i += 1) {
      const lane = this.lanes[i];
      if (!lane || lane.closed || lane.waiting.size > 0) continue;
      if (this.paper < lane.nextAt) continue;
      this.step(lane);
    }
    this.cull();
  }

  private step(lane: Lane): void {
    if (lane.queue.length === 0) {
      if (lane.depth === 0) this.finishRun(lane);
      else this.merge(lane);
      return;
    }
    const action = lane.queue.shift()!;
    const gap = GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);

    if (action.type === 'llm') {
      this.add({
        kind: 'llm',
        lane,
        label: '',
        title: `${lane.name} · model call`,
        detail: action.detail,
      });
      lane.nextAt = this.paper + gap * 0.8;
      return;
    }

    if (action.type === 'tool') {
      const side = this.toolSide(lane);
      this.stubs.push({
        slot: lane.slot,
        side,
        tau: this.paper,
        depth: lane.depth,
        laneId: lane.id,
      });
      this.add({
        kind: 'tool',
        lane,
        side,
        label: action.name,
        title: action.name,
        detail: action.detail,
      });
      this.toolsThisRun += 1;
      lane.nextAt = this.paper + Math.max(gap, PULSE_PAPER + 6);
      return;
    }

    // Spawn: fork one or two subagents, then wait for them.
    const slots = this.childSlots(lane, action.count);
    if (slots.length === 0) {
      lane.nextAt = this.paper + gap * 0.5;
      return;
    }
    for (const slot of slots) this.fork(lane, slot);
    this.setLive(lane, true);
    lane.nextAt = this.paper + gap;
  }

  private fork(parent: Lane, slot: number): void {
    const depth = parent.depth + 1;
    const span = Math.abs(slot - parent.slot);
    const names = depth === 1 ? SUBAGENTS : SUB_SUBAGENTS;
    const name = names[Math.floor(this.random() * names.length)] ?? 'Worker';
    // The diagonal is 45°, so it uses as much paper as it travels across.
    const startsAt = this.paper + span * this.laneSpacingPaper();

    const child: Lane = {
      id: this.nextId++,
      depth,
      slot,
      parent,
      name,
      queue: this.childScript(depth),
      nextAt: startsAt + GAP_MIN,
      waiting: new Set(),
      live: null,
      closed: false,
      startsAt,
    };
    this.segments.push({
      slot1: parent.slot,
      t1: this.paper,
      slot2: slot,
      t2: startsAt,
      depth,
      dashed: false,
      laneId: child.id,
    });
    child.live = {
      slot1: slot,
      t1: startsAt,
      slot2: slot,
      t2: null,
      depth,
      dashed: false,
      laneId: child.id,
    };
    this.segments.push(child.live);
    parent.waiting.add(child.id);
    this.lanes.push(child);
    this.agentsThisRun += 1;

    this.items.push({
      id: this.nextId++,
      kind: 'agent',
      depth,
      slot,
      side: 0,
      tau: startsAt,
      label: name,
      title: name,
      detail:
        depth === 1
          ? `Subagent, called by ${parent.name} as a tool. Runs its own loop with its own tools.`
          : `Subagent of ${parent.name}, two levels down. Same loop, narrower job.`,
      laneId: child.id,
    });
  }

  private merge(lane: Lane): void {
    const parent = lane.parent;
    if (parent) {
      // Two siblings finishing together would land on the same spot and print
      // their labels over each other; the later one holds its lane a beat.
      const span = Math.abs(lane.slot - parent.slot);
      const landsAt = this.paper + span * this.laneSpacingPaper();
      const crowded = this.items.some(
        (i) => i.slot === parent.slot && Math.abs(i.tau - landsAt) < MERGE_CLEARANCE,
      );
      if (crowded) {
        lane.nextAt = this.paper + MERGE_CLEARANCE / 2;
        return;
      }
    }
    lane.closed = true;
    if (lane.live) lane.live.t2 = this.paper;
    lane.live = null;
    if (!parent) return;

    const span = Math.abs(lane.slot - parent.slot);
    const landsAt = this.paper + span * this.laneSpacingPaper();
    this.segments.push({
      slot1: lane.slot,
      t1: this.paper,
      slot2: parent.slot,
      t2: landsAt,
      depth: lane.depth,
      dashed: false,
      laneId: lane.id,
    });
    this.items.push({
      id: this.nextId++,
      kind: 'merge',
      depth: lane.depth,
      slot: parent.slot,
      side: 0,
      tau: landsAt,
      label: `← ${lane.name}`,
      title: `${lane.name} returns`,
      detail: `Its result lands in ${parent.name}'s context, and ${parent.name} carries on.`,
      // The child's lane, so hovering the merge lights the subagent it closes.
      laneId: lane.id,
    });

    // The parent resumes once the diagonal has landed.
    parent.waiting.delete(lane.id);
    if (parent.waiting.size === 0) {
      this.setLive(parent, false, landsAt);
      parent.nextAt = landsAt + GAP_MIN;
    }
  }

  /** Switch a lane between printing solid (working) and dashed (waiting on children). */
  private setLive(lane: Lane, waiting: boolean, from = this.paper): void {
    if (lane.live) lane.live.t2 = from;
    lane.live = {
      slot1: lane.slot,
      t1: from,
      slot2: lane.slot,
      t2: null,
      depth: lane.depth,
      dashed: waiting,
      laneId: lane.id,
    };
    this.segments.push(lane.live);
  }

  private startMainLane(): void {
    const lane: Lane = {
      id: this.nextId++,
      depth: 0,
      slot: 0,
      parent: null,
      name: 'Orchestrator',
      queue: [],
      nextAt: 0,
      waiting: new Set(),
      live: null,
      closed: false,
      startsAt: 0,
    };
    this.lanes.push(lane);
    this.setLive(lane, false, 0);
    this.beginRun(lane);
  }

  private beginRun(lane: Lane): void {
    const run = RUNS[this.runIndex % RUNS.length]!;
    this.agentsThisRun = 1;
    this.toolsThisRun = 0;
    this.add({
      kind: 'flow',
      lane,
      label: run.name,
      title: `Flow · ${run.name}`,
      detail: 'A new run: the orchestrator gets the task and plans its first step.',
    });
    lane.queue = this.mainScript();
    lane.nextAt = this.paper + GAP_MAX;
  }

  private finishRun(lane: Lane): void {
    const run = RUNS[this.runIndex % RUNS.length]!;
    this.add({
      kind: 'done',
      lane,
      label: run.done,
      title: `Run complete · ${run.name}`,
      detail: `${this.agentsThisRun} agents and ${this.toolsThisRun} tool calls. Recorded, so it can be replayed step by step.`,
    });
    this.runIndex += 1;
    // The next run starts after a short stretch of quiet lane, and starts slow.
    const next = this.paper + GAP_MAX * 1.6;
    lane.nextAt = Number.POSITIVE_INFINITY;
    this.pendingRun = next;
    this.runStart = next;
  }

  private mainScript(): Action[] {
    const actions: Action[] = [{ type: 'llm', detail: this.choose(THOUGHTS) }];
    const length = 8 + Math.floor(this.random() * 5);
    for (let i = 0; i < length; i += 1) {
      const roll = this.random();
      if (roll < 0.4) actions.push(this.toolAction());
      else if (roll < 0.55) actions.push({ type: 'llm', detail: this.choose(THOUGHTS) });
      else if (roll < 0.8) actions.push({ type: 'spawn', count: 1 });
      else actions.push({ type: 'spawn', count: 2 });
    }
    actions.push({ type: 'llm', detail: 'Writes the final answer' });
    return actions;
  }

  private childScript(depth: number): Action[] {
    const actions: Action[] = [];
    const length = 2 + Math.floor(this.random() * 3);
    for (let i = 0; i < length; i += 1) {
      const roll = this.random();
      if (depth === 1 && i > 0 && roll < 0.18) actions.push({ type: 'spawn', count: 1 });
      else if (roll < 0.72) actions.push(this.toolAction());
      else actions.push({ type: 'llm', detail: this.choose(THOUGHTS) });
    }
    return actions;
  }

  private toolAction(): Action {
    const tool = this.choose(TOOLS);
    return { type: 'tool', name: tool.name, detail: this.choose(tool.results) };
  }

  private choose<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)]!;
  }

  /* ── Space ───────────────────────────────────────────────────────── */

  /** How many lanes fit either side of the main one. */
  private maxSlot(): number {
    if (!this.width) return 2;
    // A phone has room for one lane either side, with its labels.
    if (this.width < NARROW) return 1;
    return Math.max(1, Math.min(3, Math.floor((this.width * 0.42) / this.laneSpacing())));
  }

  private laneSpacing(): number {
    return Math.max(64, Math.min(132, this.width * 0.15));
  }

  /** Paper used by a 45° diagonal across one lane. */
  private laneSpacingPaper(): number {
    return this.laneSpacing();
  }

  private occupied(slot: number): boolean {
    return this.lanes.some((l) => !l.closed && l.slot === slot);
  }

  /** Free slots for a lane's children, outward first. */
  private childSlots(lane: Lane, count: 1 | 2): number[] {
    const max = this.maxSlot();
    if (lane.depth >= 2) return [];
    if (lane.slot === 0) {
      const order = this.random() < 0.5 ? [1, -1] : [-1, 1];
      const free = order.filter((s) => !this.occupied(s));
      return free.slice(0, count);
    }
    const out = Math.sign(lane.slot);
    for (let s = lane.slot + out; Math.abs(s) <= max; s += out) {
      if (!this.occupied(s)) return [s];
    }
    return [];
  }

  /** Branch toward whichever side has room for the leaf and its label. */
  private toolSide(lane: Lane): number {
    if (lane.slot !== 0) {
      const out = Math.sign(lane.slot);
      if (!this.occupied(lane.slot + out) && Math.abs(lane.slot + out) <= this.maxSlot())
        return out;
      if (!this.occupied(lane.slot - out)) return -out;
      return out;
    }
    const right = !this.occupied(1);
    const left = !this.occupied(-1);
    if (right && left) return this.random() < 0.6 ? 1 : -1;
    if (right) return 1;
    if (left) return -1;
    return 1;
  }

  private add(spec: {
    kind: FlowKind;
    lane: Lane;
    side?: number;
    label: string;
    title: string;
    detail: string;
  }): void {
    this.items.push({
      id: this.nextId++,
      kind: spec.kind,
      depth: spec.lane.depth,
      slot: spec.lane.slot,
      side: spec.side ?? 0,
      tau: this.paper,
      label: spec.label,
      title: spec.title,
      detail: spec.detail,
      laneId: spec.lane.id,
    });
  }

  /** Forget everything that has run off the bottom. */
  private cull(): void {
    if (this.pendingRun !== null && this.paper >= this.pendingRun) {
      this.pendingRun = null;
      const main = this.lanes[0];
      if (main) this.beginRun(main);
    }
    if (!this.height) return;
    // Paper further back than this is below the box.
    const gone = this.paper - this.height * (1 - HEAD_AT) - 60;
    this.items = this.items.filter((i) => i.tau > gone);
    this.stubs = this.stubs.filter((s) => s.tau > gone);
    this.segments = this.segments.filter((s) => s.t2 === null || s.t2 > gone);
    this.lanes = this.lanes.filter((l) => !l.closed || l.startsAt > gone);
  }

  /* ── Geometry ────────────────────────────────────────────────────── */

  /** A little right of centre on a desktop, where the copy column overlaps the box's left edge. */
  private centre(): number {
    return this.width * (this.width < NARROW ? 0.5 : 0.55);
  }

  private slotX(slot: number): number {
    return this.centre() + slot * this.laneSpacing();
  }

  private tauY(tau: number): number {
    return this.height * HEAD_AT + (this.paper - tau);
  }

  /** Where an item is drawn: on its lane, or at the end of its branch for a tool. */
  private itemPoint(item: FlowItem): { x: number; y: number } {
    const x = this.slotX(item.slot);
    const y = this.tauY(item.tau);
    if (item.kind === 'tool') return { x: x + item.side * this.laneSpacing() * STUB_SHARE, y };
    return { x, y };
  }

  /** Point along a segment at a paper position, clamped to the segment. */
  private segmentEnd(seg: Segment): { x: number; y: number } {
    const end = seg.t2 === null ? this.paper : Math.min(seg.t2, this.paper);
    const span = (seg.t2 ?? this.paper) - seg.t1;
    const u = span <= 0 ? 1 : Math.max(0, Math.min(1, (end - seg.t1) / span));
    const x1 = this.slotX(seg.slot1);
    const x2 = this.slotX(seg.slot2);
    return { x: x1 + (x2 - x1) * u, y: this.tauY(end) };
  }

  /**
   * Fade the bottom of a layer out, so history dissolves rather than being
   * cut. One mask over the finished layer rather than an alpha per item: a
   * long lane is one segment, and fading it by either end would be wrong.
   */
  private fadeOut(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createLinearGradient(0, this.height * FADE_FROM, 0, this.height);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    // Above the head the paper has not been printed yet; only the leads show.
    ctx.globalCompositeOperation = 'source-over';
  }

  private colour(depth: number): string {
    return this.palette.depth[Math.min(2, depth)] ?? this.palette.depth[0];
  }

  /** While something is hovered, everything outside its lane steps back. */
  private dimmed(laneId: number): boolean {
    return this.hovered !== null && this.hovered.laneId !== laneId;
  }

  /* ── Drawing: shapes ─────────────────────────────────────────────── */

  private drawShape(): void {
    const ctx = this.sctx;
    const { palette } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const headY = this.height * HEAD_AT;

    // Sleepers across the main lane: it is a rail, and they show the paper moving.
    const sleeper = Math.min(9, this.laneSpacing() * 0.07);
    ctx.strokeStyle = this.colour(0);
    ctx.lineWidth = 1;
    for (const seg of this.segments) {
      if (seg.depth !== 0 || seg.slot1 !== seg.slot2 || seg.t1 > this.paper) continue;
      const top = seg.t2 === null ? this.paper : Math.min(seg.t2, this.paper);
      const x = this.slotX(seg.slot1);
      // Waiting stretches keep their sleepers, fainter, so the rail stays continuous.
      ctx.globalAlpha = (this.dimmed(seg.laneId) ? 0.08 : 0.32) * (seg.dashed ? 0.6 : 1);
      ctx.beginPath();
      for (
        let t = Math.ceil(seg.t1 / SLEEPER_PITCH) * SLEEPER_PITCH;
        t <= top;
        t += SLEEPER_PITCH
      ) {
        const y = this.tauY(t);
        if (y > this.height) continue;
        ctx.moveTo(x - sleeper, y);
        ctx.lineTo(x + sleeper, y);
      }
      ctx.stroke();
    }

    // Lanes and diagonals.
    for (const seg of this.segments) {
      if (seg.t1 > this.paper) continue;
      const a = { x: this.slotX(seg.slot1), y: this.tauY(seg.t1) };
      const b = this.segmentEnd(seg);
      ctx.strokeStyle = this.colour(seg.depth);
      ctx.globalAlpha = (this.dimmed(seg.laneId) ? 0.2 : 1) * (seg.dashed ? 0.55 : 0.92);
      ctx.lineWidth = seg.depth === 0 ? 2.2 : 1.8;
      ctx.setLineDash(seg.dashed ? [2, 6] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Tool branches, with the pulse that runs out and back.
    const branch = this.laneSpacing() * STUB_SHARE;
    for (const stub of this.stubs) {
      const y = this.tauY(stub.tau);
      const x = this.slotX(stub.slot);
      const age = this.paper - stub.tau;
      const grow = Math.min(1, age / 10);
      ctx.globalAlpha = (this.dimmed(stub.laneId) ? 0.2 : 1) * 0.85;
      ctx.strokeStyle = this.colour(stub.depth);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + stub.side * branch * grow, y);
      ctx.stroke();

      if (age < PULSE_PAPER) {
        const u = age / PULSE_PAPER;
        const reach = u < 0.5 ? u * 2 : (1 - u) * 2;
        this.glow(
          ctx,
          x + stub.side * branch * reach,
          y,
          u < 0.5 ? this.colour(stub.depth) : palette.accent,
          1,
        );
      }
    }

    // Nodes.
    for (const item of this.items) {
      if (item.tau > this.paper) continue;
      const { x, y } = this.itemPoint(item);
      if (y > this.height + 10) continue;
      ctx.globalAlpha = this.dimmed(item.laneId) ? 0.25 : 1;
      this.node(ctx, item, x, y);
    }

    // Heads: one per lane still printing, where its line meets the paper.
    for (const lane of this.lanes) {
      if (lane.closed) continue;
      if (lane.startsAt > this.paper) {
        // Still on its way out along the fork diagonal.
        const fork = this.segments.find((s) => s.laneId === lane.id && s.slot1 !== s.slot2);
        if (fork) {
          const p = this.segmentEnd(fork);
          this.glow(ctx, p.x, p.y, this.colour(lane.depth), 1.1);
        }
        continue;
      }
      const x = this.slotX(lane.slot);
      const waiting = lane.waiting.size > 0;
      if (!waiting) {
        // A comet tail down the lane under the head: where the work just went.
        const tail = ctx.createLinearGradient(0, headY, 0, headY + 70);
        tail.addColorStop(0, this.colour(lane.depth));
        tail.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = tail;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, headY);
        ctx.lineTo(x, headY + 70);
        ctx.stroke();
      }
      this.glow(ctx, x, headY, this.colour(lane.depth), waiting ? 0.55 : 1.25);
      // A short dotted lead above the head: the lane continues.
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = this.colour(lane.depth);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([1, 5]);
      ctx.beginPath();
      ctx.moveTo(x, headY - 8);
      ctx.lineTo(x, Math.max(0, headY - 40));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Merges still travelling home draw their own head.
    for (const seg of this.segments) {
      if (seg.slot1 === seg.slot2 || seg.t2 === null || seg.t2 <= this.paper || seg.t1 > this.paper)
        continue;
      const lane = this.lanes.find((l) => l.id === seg.laneId);
      if (lane && !lane.closed) continue;
      const p = this.segmentEnd(seg);
      this.glow(ctx, p.x, p.y, this.colour(seg.depth), 1);
    }

    // The hovered item gets a ring, so the card is unmistakably about it.
    if (this.hovered) {
      const { x, y } = this.itemPoint(this.hovered);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.fadeOut(ctx);
  }

  private node(ctx: CanvasRenderingContext2D, item: FlowItem, x: number, y: number): void {
    const colour = this.colour(item.depth);
    const { palette } = this;
    ctx.lineWidth = 1.5;
    switch (item.kind) {
      case 'llm':
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tool': {
        const s = 7;
        ctx.fillStyle = palette.ground;
        ctx.strokeStyle = palette.tool;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        break;
      }
      case 'agent': {
        const r = 6;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'merge':
        ctx.fillStyle = palette.ground;
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'flow':
      case 'done': {
        ctx.fillStyle = palette.ground;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = item.kind === 'flow' ? palette.accent : colour;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  /** A soft point of light: additive on dark, a plain dot with a halo on light. */
  private glow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colour: string,
    strength: number,
  ): void {
    const r = 13 * strength;
    const prev = ctx.globalCompositeOperation;
    if (this.palette.dark) ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = prev;
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, 3.4 * Math.min(1.2, strength), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── Drawing: type ───────────────────────────────────────────────── */

  private drawType(): void {
    const ctx = this.tctx;
    const { palette } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.labelBoxes.clear();
    ctx.textBaseline = 'middle';

    const resting = this.paused ? 1 : 0.8;
    for (const item of this.items) {
      if (!item.label || item.tau > this.paper) continue;
      const { x, y } = this.itemPoint(item);
      if (y < -10 || y > this.height + 10) continue;
      const alpha = this.dimmed(item.laneId) ? 0.22 : resting;

      const strong = item.kind === 'flow' || item.kind === 'done' || item.kind === 'agent';
      ctx.font = `${strong ? 600 : 500} ${strong ? 11 : 10.5}px ${MONO}`;
      // On a phone the colour already says subagent; the word would crowd two forks together.
      const tag = item.kind === 'agent' && this.width < NARROW ? '' : TAGS[item.kind];
      const tagWidth = tag ? ctx.measureText(tag).width : 0;
      const width = tagWidth + ctx.measureText(item.label).width;

      // Tools label outward past the leaf; everything else to the open side of its lane.
      const preferred = item.kind === 'tool' ? item.side : item.slot < 0 ? -1 : 1;
      const gap = item.kind === 'tool' ? 9 : 13;
      // Keep every label inside the box: one that would run off an edge goes the other way.
      const fits = (side: number): boolean =>
        side > 0 ? x + gap + width <= this.width - 4 : x - gap - width >= 4;
      const side = fits(preferred) || !fits(-preferred) ? preferred : -preferred;
      const left = side > 0 ? x + gap : x - gap - width;
      const plate = { x: left - 4, y: y - 8, w: width + 8, h: 16 };
      this.labelBoxes.set(item.id, plate);

      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = palette.ground;
      ctx.fillRect(plate.x, plate.y, plate.w, plate.h);

      ctx.globalAlpha = alpha;
      if (tag) {
        ctx.fillStyle = palette.faint;
        ctx.fillText(tag, left, y + 0.5);
      }
      ctx.fillStyle =
        item.kind === 'agent' || item.kind === 'merge' ? this.colour(item.depth) : palette.text;
      ctx.fillText(item.label, left + tagWidth, y + 0.5);
    }
    this.fadeOut(ctx);
  }
}

/** The small faint prefix some labels carry, saying what kind of thing they are. */
const TAGS: Record<FlowKind, string> = {
  flow: 'FLOW ',
  done: 'DONE ',
  agent: 'SUBAGENT ',
  llm: '',
  tool: '',
  merge: '',
};
