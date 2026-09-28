/**
 * controlTrace.ts — the Controls board's live graphs (ControlsBoard.tsx): a
 * ring buffer of a control's recent values, and one sampler shared by every
 * graph on screen.
 *
 * The sampler runs a single requestAnimationFrame loop only while at least
 * one graph is drawing (a group on screen and unfolded, or the isolated
 * strip): it samples every control TRACE_HZ times a second into its buffer,
 * then calls each drawer, which paints its canvas directly. Nothing here
 * touches React state, so a graph ticking never re-renders a card
 * (docs/split-view.md, "The Controls board").
 */

/** Samples a second, and how many seconds a graph shows. */
export const TRACE_HZ = 30;
export const TRACE_SECONDS = 6;
export const TRACE_CAPACITY = TRACE_HZ * TRACE_SECONDS;

/**
 * The last `capacity` samples of a value with `channels` numbers each (1 for
 * a slider, 2 for an X/Y pair, 3 for a colour), oldest first. `seenMin` and
 * `seenMax` cover every sample since the last resetSeen (channel 0; for a
 * pair or a colour, each channel's own through seenRange).
 */
export class TraceBuffer {
  readonly capacity: number;
  readonly channels: number;
  private data: Float32Array;
  private head = 0;
  private count = 0;
  private lo: number[];
  private hi: number[];

  constructor(capacity = TRACE_CAPACITY, channels = 1) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.channels = Math.max(1, Math.floor(channels));
    this.data = new Float32Array(this.capacity * this.channels);
    this.lo = new Array(this.channels).fill(Infinity);
    this.hi = new Array(this.channels).fill(-Infinity);
  }

  get length(): number { return this.count; }

  /** Add a sample (a number, or one per channel; missing channels are 0, non-numbers are skipped). */
  push(v: number | ArrayLike<number>): void {
    const at = this.head * this.channels;
    for (let c = 0; c < this.channels; c++) {
      const x = typeof v === 'number' ? (c === 0 ? v : 0) : (v[c] ?? 0);
      const n = Number.isFinite(x) ? x : 0;
      this.data[at + c] = n;
      if (n < this.lo[c]) this.lo[c] = n;
      if (n > this.hi[c]) this.hi[c] = n;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** The i-th sample, oldest first (0 ≤ i < length). */
  at(i: number, channel = 0): number {
    if (i < 0 || i >= this.count) return NaN;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.data[((start + i) % this.capacity) * this.channels + channel];
  }

  /** The newest sample, or NaN when empty. */
  last(channel = 0): number {
    return this.count ? this.at(this.count - 1, channel) : NaN;
  }

  /** Lowest and highest in the buffer now. */
  windowRange(channel = 0): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.count; i++) { const x = this.at(i, channel); if (x < lo) lo = x; if (x > hi) hi = x; }
    return this.count ? [lo, hi] : [NaN, NaN];
  }

  /** Lowest and highest since the last resetSeen. */
  seenRange(channel = 0): [number, number] {
    return this.lo[channel] === Infinity ? [NaN, NaN] : [this.lo[channel], this.hi[channel]];
  }
  get seenMin(): number { return this.seenRange()[0]; }
  get seenMax(): number { return this.seenRange()[1]; }

  resetSeen(): void {
    this.lo.fill(Infinity);
    this.hi.fill(-Infinity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.resetSeen();
  }
}

/** Where `v` sits between `min` and `max`, 0..1 (clamped; a flat range sits in the middle). */
export function normalise(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!(max > min)) return 0.5;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

// ── The shared sampler ───────────────────────────────────────────────────────

/** One reading per trace: its key (a control id, or `pair:<id>`) and value. */
export type TraceSample = [key: string, value: number | ArrayLike<number>, channels: number];

const buffers = new Map<string, TraceBuffer>();
const drawers = new Set<() => void>();
let source: (() => TraceSample[]) | null = null;
let raf = 0;
let last = 0;

/** A trace's buffer (made on first use; a new channel count starts it afresh). */
export function traceBuffer(key: string, channels = 1): TraceBuffer {
  let b = buffers.get(key);
  if (!b || b.channels !== channels) { b = new TraceBuffer(TRACE_CAPACITY, channels); buffers.set(key, b); }
  return b;
}

/** What the sampler reads (the board sets it while mounted). */
export function setTraceSource(fn: (() => TraceSample[]) | null): void {
  source = fn;
}

/** Sample once now (the loop does this TRACE_HZ times a second). */
export function sampleTraces(): void {
  if (!source) return;
  for (const [key, v, ch] of source()) traceBuffer(key, ch).push(v);
}

const tick = (t: number) => {
  raf = drawers.size ? requestAnimationFrame(tick) : 0;
  if (t - last >= 1000 / TRACE_HZ - 1) { last = t; sampleTraces(); }
  for (const d of drawers) d();
};

/** Draw on every frame while registered; the loop runs only while something draws. Returns the unregister. */
export function addTraceDrawer(draw: () => void): () => void {
  drawers.add(draw);
  if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  return () => {
    drawers.delete(draw);
    if (!drawers.size && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}

/** For tests: how many drawers are registered, and whether the loop runs. */
export function traceLoopState(): { drawers: number; running: boolean } {
  return { drawers: drawers.size, running: raf !== 0 };
}
