/** The per-frame draw loop behind the Mapping editor's preview and the output window: frames while visible, rest while hidden, a timer when rAF is held back. */
import { describe, expect, it } from 'vitest';
import { FrameLoop, type FrameLoopTimers } from '../frameLoop';

/** Fake animation frames and intervals, stepped by hand. */
function fakeTimers() {
  let now = 0, nextId = 1;
  const rafs = new Map<number, (now: number) => void>();
  const intervals = new Map<number, { cb: () => void; ms: number; due: number }>();
  const timers: FrameLoopTimers = {
    raf: cb => { const id = nextId++; rafs.set(id, cb); return id; },
    caf: id => { rafs.delete(id); },
    setInterval: (cb, ms) => { const id = nextId++; intervals.set(id, { cb, ms, due: now + ms }); return id; },
    clearInterval: id => { intervals.delete(id); },
    now: () => now,
  };
  return {
    timers,
    /** One animation frame, `dt` ms later: every pending callback runs once. */
    frame(dt = 16) {
      now += dt;
      const cbs = [...rafs.entries()];
      rafs.clear();
      for (const [, cb] of cbs) cb(now);
    },
    /** Time passes with no animation frames (the browser holding them back); due intervals fire. */
    idle(ms: number) {
      const end = now + ms;
      while (true) {
        let next: { cb: () => void; ms: number; due: number } | null = null;
        for (const e of intervals.values()) if (!next || e.due < next.due) next = e;
        if (!next || next.due > end) break;
        now = next.due;
        next.due += next.ms;
        next.cb();
      }
      now = end;
    },
    pendingFrames: () => rafs.size,
    pendingIntervals: () => intervals.size,
  };
}

describe('FrameLoop', () => {
  it('draws once per animation frame while started', () => {
    const T = fakeTimers();
    const drawn: number[] = [];
    const loop = new FrameLoop(now => drawn.push(now), { timers: T.timers });
    expect(T.pendingFrames()).toBe(0);
    loop.start();
    expect(T.pendingFrames()).toBe(1);
    T.frame(); T.frame(); T.frame();
    expect(drawn).toEqual([16, 32, 48]);
    expect(loop.frames).toBe(3);
    expect(T.pendingFrames()).toBe(1); // always one frame ahead, never two
  });

  it('pauses while hidden and resumes when shown again', () => {
    const T = fakeTimers();
    let drawn = 0;
    const loop = new FrameLoop(() => { drawn++; }, { timers: T.timers });
    loop.start();
    T.frame(); T.frame();
    expect(drawn).toBe(2);
    loop.setVisible(false);
    expect(loop.running).toBe(false);
    expect(T.pendingFrames()).toBe(0);
    T.frame(); T.frame(); T.frame();
    expect(drawn).toBe(2);
    loop.setVisible(true);
    expect(loop.running).toBe(true);
    T.frame();
    expect(drawn).toBe(3);
  });

  it('stops for good on stop(), even mid-hide', () => {
    const T = fakeTimers();
    let drawn = 0;
    const loop = new FrameLoop(() => { drawn++; }, { timers: T.timers, fallbackHz: 30 });
    loop.start();
    T.frame();
    loop.setVisible(false);
    loop.stop();
    loop.setVisible(true); // showing again after a stop schedules nothing
    T.frame();
    T.idle(500);
    expect(drawn).toBe(1);
    expect(T.pendingFrames()).toBe(0);
    expect(T.pendingIntervals()).toBe(0);
  });

  it('keeps going when a draw throws', () => {
    const T = fakeTimers();
    let n = 0;
    const loop = new FrameLoop(() => { if (++n === 1) throw new Error('boom'); }, { timers: T.timers });
    loop.start();
    expect(() => T.frame()).toThrow('boom');
    T.frame();
    expect(n).toBe(2);
    expect(T.pendingFrames()).toBe(1);
  });

  it('falls back to a timer when animation frames stop coming, and defers to them when they return', () => {
    const T = fakeTimers();
    let drawn = 0;
    const loop = new FrameLoop(() => { drawn++; }, { timers: T.timers, fallbackHz: 30 });
    loop.start();
    expect(T.pendingIntervals()).toBe(1);
    T.frame(); T.frame();
    expect(drawn).toBe(2);
    // Frames flowing: the timer draws nothing of its own.
    T.idle(40);
    expect(drawn).toBe(2);
    // Frames held back for a second: the timer draws at about 30 a second once it notices the stall.
    T.idle(1000);
    expect(drawn).toBeGreaterThanOrEqual(24);
    expect(drawn).toBeLessThanOrEqual(31);
    const afterStall = drawn;
    // Frames again: they draw, the timer steps aside.
    T.frame(); T.frame();
    expect(drawn).toBe(afterStall + 2);
    T.idle(40);
    expect(drawn).toBe(afterStall + 2);
  });

  it('runs no timer without a fallback rate', () => {
    const T = fakeTimers();
    let drawn = 0;
    const loop = new FrameLoop(() => { drawn++; }, { timers: T.timers });
    loop.start();
    expect(T.pendingIntervals()).toBe(0);
    T.idle(1000);
    expect(drawn).toBe(0);
  });

  it('start is idempotent', () => {
    const T = fakeTimers();
    const loop = new FrameLoop(() => {}, { timers: T.timers });
    loop.start(); loop.start();
    expect(T.pendingFrames()).toBe(1);
    loop.stop(); loop.stop();
    expect(T.pendingFrames()).toBe(0);
  });
});
