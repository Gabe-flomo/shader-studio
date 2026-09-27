/**
 * The capture window's scrubbing: the quick picture once a frame while the
 * slider moves, the settle only after a pause or on release, stale settles
 * dropped, and a capture's plan unchanged by any of it.
 */
import { describe, expect, it } from 'vitest';
import { createScrubScheduler } from '../captureScrub';
import { captureSteps } from '../backgroundLibrary';

/** Hand-cranked timers and frames. */
function clock() {
  const timers = new Map<number, { at: number; fn: () => void }>();
  const frames = new Map<number, () => void>();
  let id = 0, now = 0;
  return {
    setTimeout: (fn: () => void, ms: number) => { timers.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i: number) => { timers.delete(i); },
    requestFrame: (fn: () => void) => { frames.set(++id, fn); return id; },
    cancelFrame: (i: number) => { frames.delete(i); },
    /** Run the pending frames. */
    frame() { const fs = [...frames.values()]; frames.clear(); fs.forEach(f => f()); },
    /** Advance the clock, firing timers that come due. */
    advance(ms: number) {
      now += ms;
      for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn(); }
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

function harness(o: { settleMs?: number; slow?: boolean } = {}) {
  const c = clock();
  const quick: number[] = [];
  const settles: Array<{ t: number; signal: AbortSignal; resolve: (v: number | null) => void }> = [];
  const settled: number[] = [];
  const busy: boolean[] = [];
  const s = createScrubScheduler<number>({
    quick: t => { quick.push(t); },
    settle: (t, signal) => new Promise(resolve => { settles.push({ t, signal, resolve }); if (!o.slow) resolve(t); }),
    onSettled: (r, t) => { settled.push(t); expect(r).toBe(t); },
    onBusy: b => { busy.push(b); },
    settleMs: o.settleMs ?? 250,
    ...c,
  });
  return { c, s, quick, settles, settled, busy };
}

describe('scrub scheduling', () => {
  it('draws the quick picture once per frame, for the latest time', () => {
    const { c, s, quick } = harness();
    s.move(1); s.move(2); s.move(3);
    expect(quick).toEqual([]);
    c.frame();
    expect(quick).toEqual([3]);
    s.move(4); c.frame();
    expect(quick).toEqual([3, 4]);
  });

  it('settles only after a pause in the movement, once, for the last time', async () => {
    const { c, s, settles, settled } = harness();
    s.move(1); c.advance(100);
    s.move(2); c.advance(100);
    s.move(3); c.advance(240);
    expect(settles).toHaveLength(0);
    c.advance(20);
    expect(settles.map(x => x.t)).toEqual([3]);
    await flush();
    expect(settled).toEqual([3]);
    c.advance(1000);
    expect(settles).toHaveLength(1);
  });

  it('release settles straight away, exactly once, and the pending quick frame is dropped', async () => {
    const { c, s, quick, settles, settled } = harness();
    s.move(5);
    s.release();
    expect(settles.map(x => x.t)).toEqual([5]);
    c.frame();
    expect(quick).toEqual([]);
    c.advance(1000);
    expect(settles).toHaveLength(1);
    await flush();
    expect(settled).toEqual([5]);
    // Let go again without moving, or after the pause already settled it: nothing more to do.
    s.release();
    expect(settles).toHaveLength(1);
  });

  it('a release after the pause already settled that time adds no settle', async () => {
    const { c, s, settles } = harness();
    s.move(2); c.advance(300);
    await flush();
    expect(settles).toHaveLength(1);
    s.release();
    expect(settles).toHaveLength(1);
  });

  it('drops a settle the slider has moved on from, aborting its work', async () => {
    const { c, s, settles, settled, busy } = harness({ slow: true });
    s.move(1); c.advance(300);
    expect(settles).toHaveLength(1);
    expect(s.busy).toBe(true);
    s.move(2);
    expect(settles[0].signal.aborted).toBe(true);
    expect(s.busy).toBe(false);
    settles[0].resolve(1);
    await flush();
    expect(settled).toEqual([]);
    s.release();
    expect(settles.map(x => x.t)).toEqual([1, 2]);
    settles[1].resolve(2);
    await flush();
    expect(settled).toEqual([2]);
    expect(busy).toEqual([true, false, true, false]);
  });

  it('a settle that gives up (null) reports nothing settled', async () => {
    const { s, settles, settled, busy } = harness({ slow: true });
    s.commit(3);
    settles[0].resolve(null);
    await flush();
    expect(settled).toEqual([]);
    expect(busy).toEqual([true, false]);
  });

  it('commit settles at once; cancel forgets everything pending', () => {
    const { c, s, quick, settles } = harness({ slow: true });
    s.commit(7);
    expect(settles.map(x => x.t)).toEqual([7]);
    s.move(8);
    s.cancel();
    expect(settles[0].signal.aborted).toBe(true);
    c.frame(); c.advance(1000);
    expect(quick).toEqual([]);
    expect(settles).toHaveLength(1);
    expect(c.pendingFrames()).toBe(0);
    expect(c.pendingTimers()).toBe(0);
  });
});

describe('the capture plan', () => {
  it('is the same as before scrubbing existed: 1/60 s steps from 0, 1800 at most, whatever the preview settled with', () => {
    for (const t of [0, 0.5, 7.25, 30, 120]) {
      const full = captureSteps(t, { maxSteps: 1800 });
      // Frame-exact: every step at k/60 s while 1800 cover it, else 1800 even steps.
      const n = Math.floor(t * 60 + 1e-9);
      if (n <= 1800) { expect(full.dt).toBeCloseTo(1 / 60); expect(full.steps).toHaveLength(n); }
      else { expect(full.steps).toHaveLength(1800); expect(full.dt).toBeCloseTo(t / 1800); }
      // The preview's coarser plans do not touch it.
      captureSteps(t, { maxSteps: 30 }); captureSteps(t, { maxSteps: 600 });
      expect(captureSteps(t, { maxSteps: 1800 })).toEqual(full);
    }
  });
});
