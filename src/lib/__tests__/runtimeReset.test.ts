// @vitest-environment jsdom
/**
 * The one ↺ (lib/runtimeReset.ts): every part registered resets, in order, once per reset; a part
 * that throws doesn't stop the others; a part that sends the old 'reset-time' event while resetting
 * doesn't start a second round; the old event still resets everything; unregistering stops it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRuntimeReset, resetRuntime, runtimeResetCount } from '../runtimeReset';

const offs: Array<() => void> = [];
const on = (fn: () => void) => { offs.push(onRuntimeReset(fn)); };
afterEach(() => { for (const off of offs.splice(0)) off(); vi.restoreAllMocks(); });

describe('resetRuntime', () => {
  it('runs every registered part once, in the order registered, and counts the resets', () => {
    const seen: string[] = [];
    on(() => seen.push('preview'));
    on(() => seen.push('builder'));
    on(() => seen.push('try board'));
    const before = runtimeResetCount();
    resetRuntime();
    expect(seen).toEqual(['preview', 'builder', 'try board']);
    expect(runtimeResetCount()).toBe(before + 1);
    resetRuntime();
    expect(seen).toHaveLength(6);
  });

  it('a part that throws is reported and the rest still reset', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    on(() => { throw new Error('boom'); });
    on(() => seen.push('after'));
    resetRuntime();
    expect(seen).toEqual(['after']);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("the old 'reset-time' event is the same true reset, and one sent while resetting doesn't reset twice", () => {
    let n = 0;
    on(() => { n++; window.dispatchEvent(new CustomEvent('reset-time')); });
    window.dispatchEvent(new CustomEvent('reset-time'));
    expect(n).toBe(1);
    resetRuntime();
    expect(n).toBe(2);
  });

  it('a part unregistered (a viewport closed) no longer resets; one registering during a reset waits for the next', () => {
    let a = 0, late = 0;
    const off = onRuntimeReset(() => { a++; });
    on(() => { offs.push(onRuntimeReset(() => { late++; })); });
    resetRuntime();
    expect([a, late]).toEqual([1, 0]);
    off();
    resetRuntime();
    expect(a).toBe(1);
    expect(late).toBe(1);
  });
});
