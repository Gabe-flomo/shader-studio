/**
 * Small pure pieces of the stream runtime: reconnect timing, the rows-per-
 * second meter, and the demo feed.
 */

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

/**
 * How long to wait before reconnect attempt `attempt` (0 = the first retry):
 * doubling from `base` up to `max`, with up to `jitter` of it random so many
 * clients don't retry in step. `rand` is Math.random unless a test fixes it.
 */
export function backoffDelay(attempt: number, o: { base?: number; max?: number; jitter?: number; rand?: () => number } = {}): number {
  const base = o.base ?? BACKOFF_BASE_MS, max = o.max ?? BACKOFF_MAX_MS, jitter = o.jitter ?? 0.2;
  const raw = Math.min(max, base * 2 ** Math.max(0, Math.min(30, Math.floor(attempt))));
  const r = (o.rand ?? Math.random)();
  return Math.min(max, Math.round(raw * (1 - jitter + jitter * 2 * r)));
}

/** Rows per second over the last `span` ms: a list of (time, count) kept short. */
export class RateMeter {
  private marks: Array<[number, number]> = [];
  private span: number;
  constructor(span = 5000) { this.span = span; }
  add(now: number, count: number): void {
    if (count <= 0) return;
    this.marks.push([now, count]);
    this.trim(now);
  }
  rate(now: number): number {
    this.trim(now);
    if (!this.marks.length) return 0;
    const total = this.marks.reduce((s, [, c]) => s + c, 0);
    // Over the span, or since the first mark when the feed is younger than that.
    const since = Math.max(1000, Math.min(this.span, now - this.marks[0][0] + 1000));
    return (total * 1000) / since;
  }
  reset(): void { this.marks = []; }
  private trim(now: number): void {
    while (this.marks.length && this.marks[0][0] < now - this.span) this.marks.shift();
  }
}

/**
 * The demo feed's row at tick `i` (made up in the app, no network): a point
 * wandering on a Lissajous curve with a little noise, a slowly rising and
 * falling level, and one of three categories. Pure, so a take of it replays
 * the same.
 */
export function demoRow(i: number, rate: number): Record<string, number | string> {
  const t = i / Math.max(1, rate);
  const noise = (k: number) => {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return (s - Math.floor(s)) - 0.5;
  };
  return {
    t: Math.round(t * 1000) / 1000,
    x: round3(0.5 + 0.38 * Math.sin(t * 0.9) + 0.005 * noise(1)),
    y: round3(0.5 + 0.38 * Math.sin(t * 1.3 + 0.7) + 0.005 * noise(2)),
    level: round3(0.5 + 0.35 * Math.sin(t * 0.35) + 0.15 * noise(3)),
    kind: ['calm', 'busy', 'peak'][Math.min(2, Math.floor((0.5 + 0.5 * Math.sin(t * 0.2)) * 3))],
  };
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;
