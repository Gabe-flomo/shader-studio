import { describe, expect, it, vi } from 'vitest';
import { createLongPress, tapToggle, LONG_PRESS_MS, type LongPressTimers } from '../longPress';

/** Timers we drive by hand. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  const timers: LongPressTimers = {
    set: fn => { pending.set(++id, fn); return id; },
    clear: t => { pending.delete(t as number); },
  };
  return { timers, fire: () => { for (const [k, fn] of [...pending]) { pending.delete(k); fn(); } }, count: () => pending.size };
}
const touch = (x: number, y: number) => ({ pointerType: 'touch', clientX: x, clientY: y });

describe('long press', () => {
  it('fires after the hold, where the finger went down', () => {
    const t = fakeTimers();
    const onLong = vi.fn();
    const lp = createLongPress(onLong, t.timers);
    lp.down(touch(10, 20));
    expect(onLong).not.toHaveBeenCalled();
    t.fire();
    expect(onLong).toHaveBeenCalledWith(10, 20);
  });

  it('swallows the click that follows a hold, once', () => {
    const t = fakeTimers();
    const lp = createLongPress(() => {}, t.timers);
    lp.down(touch(0, 0));
    t.fire();
    lp.up();
    expect(lp.consumeClick()).toBe(true);
    expect(lp.consumeClick()).toBe(false);
  });

  it('a quick tap is a tap', () => {
    const t = fakeTimers();
    const onLong = vi.fn();
    const lp = createLongPress(onLong, t.timers);
    lp.down(touch(0, 0));
    lp.up();
    expect(t.count()).toBe(0);
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.consumeClick()).toBe(false);
  });

  it('moving past the slop (a scroll, a drag) cancels it; a small wobble does not', () => {
    const t = fakeTimers();
    const onLong = vi.fn();
    const lp = createLongPress(onLong, t.timers);
    lp.down(touch(0, 0));
    lp.move(touch(4, 3));
    expect(t.count()).toBe(1);
    lp.move(touch(30, 0));
    expect(t.count()).toBe(0);
    t.fire();
    expect(onLong).not.toHaveBeenCalled();
  });

  it('a mouse keeps its right-click: pressing never starts a hold', () => {
    const t = fakeTimers();
    const lp = createLongPress(() => {}, t.timers);
    lp.down({ pointerType: 'mouse', clientX: 0, clientY: 0 });
    expect(t.count()).toBe(0);
  });

  it('a pen holds like a finger', () => {
    const t = fakeTimers();
    const lp = createLongPress(() => {}, t.timers);
    lp.down({ pointerType: 'pen', clientX: 0, clientY: 0 });
    expect(t.count()).toBe(1);
  });

  it('a second finger going down restarts the hold (a pinch never opens a menu by itself)', () => {
    const t = fakeTimers();
    const onLong = vi.fn();
    const lp = createLongPress(onLong, t.timers);
    lp.down(touch(0, 0));
    lp.down(touch(100, 0));
    expect(t.count()).toBe(1);
    lp.move(touch(140, 0));
    t.fire();
    expect(onLong).not.toHaveBeenCalled();
  });

  it('uses the same half second as the context menus', () => {
    expect(LONG_PRESS_MS).toBe(500);
  });
});

describe('tapToggle', () => {
  it('a tap opens and closes; a mouse click leaves hover in charge', () => {
    expect(tapToggle(false, 'touch')).toBe(true);
    expect(tapToggle(true, 'touch')).toBe(false);
    expect(tapToggle(false, 'pen')).toBe(true);
    expect(tapToggle(true, 'mouse')).toBe(true);
    expect(tapToggle(false, 'mouse')).toBe(false);
  });
});
