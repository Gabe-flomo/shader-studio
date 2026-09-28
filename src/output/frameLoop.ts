/**
 * frameLoop.ts — "draw this every frame while it can be seen".
 *
 * The Mapping editor's preview and the output window both redraw
 * continuously, not on pointer events. This runs a draw callback once per
 * animation frame while the loop is started and its target is visible, stops
 * asking for frames while it is hidden (a closed dialog, a scrolled-away
 * preview, a hidden tab), and picks up again when it shows.
 *
 * With `fallbackHz`, a timer keeps the frames coming when the browser holds
 * back requestAnimationFrame: a background or occluded window (the output on
 * a projector while the app has focus, WKWebView's throttling), where the
 * picture still has to move.
 *
 * The timers are injectable so the behaviour can be tested without a browser.
 */

export interface FrameLoopTimers {
  raf(cb: (now: number) => void): number;
  caf(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  now(): number;
}

export interface FrameLoopOptions {
  /** Keep drawing at about this rate when animation frames stop coming (0: no fallback). */
  fallbackHz?: number;
  /** How long without an animation frame counts as "held back" (ms). Default: 2.5 frames at the fallback rate, at least 100 ms. */
  stallMs?: number;
  timers?: Partial<FrameLoopTimers>;
}

const browserTimers = (): FrameLoopTimers => ({
  raf: cb => requestAnimationFrame(cb),
  caf: id => cancelAnimationFrame(id),
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: id => window.clearInterval(id),
  now: () => performance.now(),
});

export class FrameLoop {
  private t: FrameLoopTimers;
  private raf = 0;
  private timer = 0;
  private started = false;
  private visible = true;
  private lastFrameAt = -Infinity;
  private inDraw = false;
  readonly fallbackHz: number;
  readonly stallMs: number;
  /** Frames drawn since start (for a rate readout). */
  frames = 0;

  private draw: (now: number) => void;

  constructor(draw: (now: number) => void, opts: FrameLoopOptions = {}) {
    this.draw = draw;
    this.t = { ...browserTimers(), ...opts.timers };
    this.fallbackHz = Math.max(0, opts.fallbackHz ?? 0);
    this.stallMs = opts.stallMs ?? (this.fallbackHz > 0 ? Math.max(100, 2500 / this.fallbackHz) : 100);
  }

  /** Is it asking for frames now (started and visible)? */
  get running(): boolean { return this.started && this.visible; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastFrameAt = -Infinity;
    this.schedule();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unschedule();
  }

  /** The target can (or can't) be seen: hidden, the loop rests; shown again, it goes on. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!this.started) return;
    if (v) { this.lastFrameAt = -Infinity; this.schedule(); } else this.unschedule();
  }

  private schedule(): void {
    if (!this.running) return;
    if (!this.raf) this.raf = this.t.raf(this.onFrame);
    if (this.fallbackHz > 0 && !this.timer) this.timer = this.t.setInterval(this.onTimer, Math.round(1000 / this.fallbackHz));
  }

  private unschedule(): void {
    if (this.raf) { this.t.caf(this.raf); this.raf = 0; }
    if (this.timer) { this.t.clearInterval(this.timer); this.timer = 0; }
  }

  private tick(now: number): void {
    if (this.inDraw) return;
    this.inDraw = true;
    this.frames++;
    try { this.draw(now); } finally { this.inDraw = false; }
  }

  private onFrame = (now: number): void => {
    this.raf = 0;
    if (!this.running) return;
    // Ask for the next frame first: a draw that throws still leaves the loop going.
    this.raf = this.t.raf(this.onFrame);
    // Only an animation frame counts against the stall: a timer draw must not quiet the timer.
    this.lastFrameAt = now;
    this.tick(now);
  };

  /** The fallback: draw only when the animation frames have stopped coming. */
  private onTimer = (): void => {
    if (!this.running) return;
    const now = this.t.now();
    if (now - this.lastFrameAt < this.stallMs) return;
    this.tick(now);
  };
}

/**
 * Whether an element can be seen: on screen (IntersectionObserver) and in a
 * visible document. Calls `cb` now and on every change; returns a stop.
 */
export function watchVisible(el: Element, cb: (visible: boolean) => void): () => void {
  let onScreen = true, docShown = typeof document === 'undefined' ? true : !document.hidden;
  const emit = () => cb(onScreen && docShown);
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => { onScreen = entries[entries.length - 1]?.isIntersecting ?? true; emit(); })
    : null;
  io?.observe(el);
  const onVis = () => { docShown = !document.hidden; emit(); };
  document.addEventListener('visibilitychange', onVis);
  emit();
  return () => { io?.disconnect(); document.removeEventListener('visibilitychange', onVis); };
}
