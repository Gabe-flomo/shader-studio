/**
 * The phone/desktop decision (lib/viewport.ts): a phone is a touch device whose shorter side is
 * small, either way up; tablets and narrow desktop windows aren't. Plus the watcher's re-measure.
 */
import { describe, expect, it, vi } from 'vitest';
import { isTouchDevice, nextViewport, RECHECK_MS, viewportCssVars, watchViewport, type Viewport, type ViewportEvents } from '../viewport';

const at = (width: number, height: number, touch: boolean, prev: Viewport | null = null) => nextViewport(prev, { width, height, touch });

describe('nextViewport', () => {
  it('an iPhone is a phone upright and sideways', () => {
    const portrait = at(375, 812, true);
    expect(portrait.phone).toBe(true);
    expect(portrait.landscape).toBe(false);
    expect(portrait.breakpoint).toBe('mobile');
    const landscape = at(812, 375, true, portrait);
    expect(landscape.phone).toBe(true);
    expect(landscape.landscape).toBe(true);
    expect(landscape.breakpoint).toBe('mobile');
    // The biggest phones too.
    expect(at(932, 430, true).phone).toBe(true);
  });

  it('an iPad is not a phone', () => {
    expect(at(820, 1180, true).phone).toBe(false);
    expect(at(1180, 820, true).breakpoint).toBe('desktop-sm');
    expect(at(744, 1133, true).phone).toBe(false); // iPad mini upright
  });

  it('a desktop is never a phone, however narrow the window', () => {
    expect(at(1440, 900, false).breakpoint).toBe('desktop-lg');
    const narrow = at(500, 800, false);
    expect(narrow.phone).toBe(false);
    expect(narrow.breakpoint).toBe('tablet');
    expect(at(900, 600, false).breakpoint).toBe('tablet');
  });

  it('remembers that the device has touch across a resize that stops saying so', () => {
    const p = at(375, 812, true);
    const l = at(812, 375, false, p);
    expect(l.touchSeen).toBe(true);
    expect(l.phone).toBe(true);
  });

  it('the address bar coming and going cannot flip a phone (shorter side, with hysteresis)', () => {
    let v = at(812, 300, true);
    expect(v.phone).toBe(true);
    v = at(812, 375, true, v);
    expect(v.phone).toBe(true);
    // Once a phone, it stays one just past the threshold; a tablet-sized short side leaves.
    v = at(1000, 610, true, v);
    expect(v.phone).toBe(true);
    v = at(1000, 700, true, v);
    expect(v.phone).toBe(false);
    expect(at(1000, 610, true).phone).toBe(false);
  });
});

describe('isTouchDevice', () => {
  it('coarse pointer, phone UAs, and iPadOS with its desktop UA', () => {
    expect(isTouchDevice({ coarse: true, maxTouchPoints: 0, ua: '' })).toBe(true);
    expect(isTouchDevice({ coarse: false, maxTouchPoints: 5, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isTouchDevice({ coarse: false, maxTouchPoints: 5, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari' })).toBe(true);
    expect(isTouchDevice({ coarse: false, maxTouchPoints: 0, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari' })).toBe(false);
    expect(isTouchDevice({ coarse: false, maxTouchPoints: 0, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome' })).toBe(false);
  });
});

describe('viewportCssVars', () => {
  it('writes the measured height in px', () => {
    expect(viewportCssVars({ height: 812.4 })).toEqual({ '--app-vh': '812px' });
  });
});

describe('watchViewport', () => {
  function fakeWindow() {
    const handlers = new Map<string, Set<() => void>>();
    const on = (type: string, fn: () => void) => { (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(fn); };
    const off = (type: string, fn: () => void) => { handlers.get(type)?.delete(fn); };
    const fire = (type: string) => { for (const fn of handlers.get(type) ?? []) fn(); };
    const scrollTo = vi.fn();
    const win: ViewportEvents = { addEventListener: on, removeEventListener: off, visualViewport: { addEventListener: (t, f) => on(`vv:${t}`, f), removeEventListener: (t, f) => off(`vv:${t}`, f) }, scrollTo };
    return { win, fire, scrollTo, handlers };
  }

  it('measures at once and again a moment later, once per burst', () => {
    vi.useFakeTimers();
    const { win, fire } = fakeWindow();
    const measure = vi.fn();
    const stop = watchViewport(win, measure);
    fire('resize');
    expect(measure).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RECHECK_MS - 50);
    fire('vv:resize');
    expect(measure).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RECHECK_MS - 1);
    expect(measure).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(measure).toHaveBeenCalledTimes(3);
    stop();
    fire('resize');
    expect(measure).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('a rotation also scrolls the page back to the top', () => {
    vi.useFakeTimers();
    const { win, fire, scrollTo } = fakeWindow();
    const measure = vi.fn();
    const stop = watchViewport(win, measure);
    fire('orientationchange');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(measure).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RECHECK_MS);
    expect(measure).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});
