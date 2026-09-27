/**
 * captureScrub.ts — when the capture window's time slider moves, what gets
 * drawn and when. The picture has two renders: a quick one (the shader at the
 * new time, a coarse warm-up at most) and a settled one (the layers stepped
 * frame by frame from 0, slow on a phone). While the slider moves, each
 * animation frame draws the quick picture once for the latest time; the
 * settle runs only when the slider is released, or after `settleMs` (250) of
 * no movement, and only for the time still on the slider: a settle whose
 * time the slider has left is stale and its result is dropped, its work
 * stopped through the AbortSignal it was given.
 *
 *   const s = createScrubScheduler({ quick, settle, onSettled })
 *   s.move(t)     the slider moved: quick(t) on the next frame, settle later
 *   s.release()   the slider was let go: settle now (once)
 *   s.commit(t)   a discrete change (typed time, reset): move + release
 *   s.cancel()    forget the pending settle (play started, the mount is going)
 *   s.busy        a settle is running
 *
 * Pure of the DOM: timers and frames are injectable for tests.
 */

export interface ScrubOptions<R> {
  /** The cheap picture at `t`: drawn once per frame while scrubbing. */
  quick: (t: number) => void;
  /** The exact picture at `t`; resolve null when it gave up. Check `signal` between chunks. */
  settle: (t: number, signal: AbortSignal) => Promise<R | null>;
  /** The settled picture for `t`, only when `t` is still the slider's time. */
  onSettled?: (result: R, t: number) => void;
  /** Called when a settle starts (true) and when none is running (false). */
  onBusy?: (busy: boolean) => void;
  /** Quiet time after the last move before settling. */
  settleMs?: number;
  /** Injectable timers (tests). */
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  requestFrame?: (fn: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface ScrubScheduler {
  move(t: number): void;
  release(): void;
  commit(t: number): void;
  cancel(): void;
  readonly busy: boolean;
  readonly time: number;
}

export function createScrubScheduler<R>(o: ScrubOptions<R>): ScrubScheduler {
  const settleMs = o.settleMs ?? 250;
  const setT = o.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearT = o.clearTimeout ?? (id => window.clearTimeout(id));
  const reqF = o.requestFrame ?? (fn => requestAnimationFrame(fn));
  const cancelF = o.cancelFrame ?? (id => cancelAnimationFrame(id));

  let time = 0;
  let token = 0;
  let timer = 0;
  let frame = 0;
  let running: AbortController | null = null;
  let runningFor: number | null = null;
  let settledFor: number | null = null;
  let hasTime = false;

  const setBusy = (b: boolean) => { o.onBusy?.(b); };
  const dropRunning = () => {
    if (!running) return;
    running.abort();
    running = null; runningFor = null;
    setBusy(false);
  };
  const clearTimer = () => { if (timer) { clearT(timer); timer = 0; } };
  const clearFrame = () => { if (frame) { cancelF(frame); frame = 0; } };

  const startSettle = () => {
    clearTimer();
    // Already settled, or settling, for this very time: nothing to add.
    if (settledFor === time || (running && runningFor === time)) return;
    dropRunning();
    const my = ++token;
    const at = time;
    const ac = new AbortController();
    running = ac; runningFor = at;
    setBusy(true);
    void o.settle(at, ac.signal).then(r => {
      if (my !== token || ac.signal.aborted) return;
      running = null; runningFor = null;
      setBusy(false);
      if (r !== null && r !== undefined) { settledFor = at; o.onSettled?.(r, at); }
    }, () => {
      if (my !== token || ac.signal.aborted) return;
      running = null; runningFor = null;
      setBusy(false);
    });
  };

  return {
    move(t) {
      time = t; hasTime = true;
      token++;
      settledFor = null;
      dropRunning();
      if (!frame) frame = reqF(() => { frame = 0; o.quick(time); });
      clearTimer();
      timer = setT(() => { timer = 0; startSettle(); }, settleMs);
    },
    release() {
      if (!hasTime) return;
      // The quick frame still pending is pointless: the settle draws this time.
      clearFrame();
      startSettle();
    },
    commit(t) {
      time = t; hasTime = true;
      token++;
      settledFor = null;
      clearFrame();
      clearTimer();
      startSettle();
    },
    cancel() {
      token++;
      settledFor = null;
      clearFrame();
      clearTimer();
      dropRunning();
    },
    get busy() { return running !== null; },
    get time() { return time; },
  };
}
