/**
 * offlineHistory.ts — the passes that remember earlier frames (the Previous
 * Frame node's feedback, the Echo node's ring of copies), stepped for an
 * offline render the way the live preview steps them.
 *
 * The live preview draws about 60 times a second and each draw moves the
 * feedback and the echo ring on by one. An offline render draws once per
 * output frame, at 24, 30 or 60 fps, so on its own a 30 fps render would
 * smear half as fast and echo twice as far back. Here each output frame runs
 * as many passes as the live preview would have in that time (two at 30 fps),
 * so the trails come out the same length.
 *
 * A render that starts after the clock's 0 (a take) first runs up to two
 * seconds of passes before its first frame, so the trails are already there,
 * as they were on screen when the take started.
 *
 * GPU-agnostic: ShaderCanvas passes render targets and draw calls; the tests
 * pass numbers.
 */

/** Passes per second the live preview runs at (a 60 Hz screen). */
export const LIVE_RATE = 60;
/** Seconds of passes run before a render's first frame, when it starts after 0. */
export const WARM_UP_SECONDS = 2;

export interface HistoryGpu<R> {
  /** A new target at the render size, cleared to black. */
  create(): R;
  dispose(r: R): void;
  /** Draw the graph at `time` into `into`. `prev` is the last pass (feedback; null when the graph has none), `echoes` the ring, newest first. */
  draw(time: number, into: R, prev: R | null, echoes: readonly R[]): void;
  /** Copy a picture into a target (an echo slot). */
  copy(from: R, into: R): void;
}

export interface HistoryFrame {
  /** Seconds between output frames (1 / fps). */
  dt: number;
  /** The first frame of a render: start the history over (and warm it up). */
  first: boolean;
  /** The graph reads the previous frame (a Previous Frame node). */
  feedback: boolean;
  /** The graph's Echo node, or null. */
  echo: { copies: number; delay: number } | null;
}

export class OfflineHistory<R> {
  private gpu: HistoryGpu<R>;
  private ping: [R, R] | null = null;
  private plain: R | null = null;
  private ring: R[] = [];
  private echoFrame = 0;
  /** Pass times of the last frame (for tests and the warm-up). */
  lastPasses: number[] = [];

  constructor(gpu: HistoryGpu<R>) { this.gpu = gpu; }

  reset(): void {
    if (this.ping) { this.gpu.dispose(this.ping[0]); this.gpu.dispose(this.ping[1]); this.ping = null; }
    if (this.plain) { this.gpu.dispose(this.plain); this.plain = null; }
    for (const r of this.ring) this.gpu.dispose(r);
    this.ring = [];
    this.echoFrame = 0;
  }

  /** The pass times for one output frame at `time`. */
  static passTimes(time: number, f: Pick<HistoryFrame, 'dt' | 'first' | 'feedback' | 'echo'>): number[] {
    const stateful = f.feedback || !!f.echo;
    if (!stateful) return [time];
    const step = 1 / LIVE_RATE;
    if (f.first) {
      const out: number[] = [];
      const warm = Math.min(WARM_UP_SECONDS, Math.max(0, time));
      const n = Math.round(warm * LIVE_RATE);
      for (let i = n; i > 0; i--) out.push(time - i * step);
      out.push(time);
      return out;
    }
    const n = Math.max(1, Math.round(f.dt * LIVE_RATE));
    return Array.from({ length: n }, (_, k) => time - (f.dt * (n - 1 - k)) / n);
  }

  /** Render the output frame at `time`; returns the target holding it. */
  frame(time: number, f: HistoryFrame): R {
    if (f.first) this.reset();
    const passes = OfflineHistory.passTimes(time, f);
    this.lastPasses = passes;
    let out: R | null = null;
    for (const t of passes) out = this.pass(t, f);
    return out!;
  }

  private pass(t: number, f: HistoryFrame): R {
    let out: R;
    if (f.feedback) {
      if (!this.ping) this.ping = [this.gpu.create(), this.gpu.create()];
      const [read, write] = this.ping;
      this.gpu.draw(t, write, read, this.ring);
      this.ping = [write, read];
      out = write;
    } else {
      if (!this.plain) this.plain = this.gpu.create();
      this.gpu.draw(t, this.plain, null, this.ring);
      out = this.plain;
    }
    const echo = f.echo;
    if (!echo) { if (this.ring.length) { for (const r of this.ring) this.gpu.dispose(r); this.ring = []; this.echoFrame = 0; } return out; }
    if (this.ring.length !== echo.copies) {
      for (const r of this.ring) this.gpu.dispose(r);
      this.ring = Array.from({ length: echo.copies }, () => this.gpu.create());
      this.echoFrame = 0;
    }
    // As the live preview: every `delay` passes the oldest slot becomes the newest and takes this picture.
    this.echoFrame++;
    if (this.echoFrame % Math.max(1, echo.delay) === 0 && this.ring.length) {
      this.ring.unshift(this.ring.pop()!);
      this.gpu.copy(out, this.ring[0]);
    }
    return out;
  }
}
