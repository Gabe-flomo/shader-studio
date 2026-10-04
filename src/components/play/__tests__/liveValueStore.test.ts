/**
 * liveValueStore: the Play page's live values, read per control so only the
 * rows whose value moved render again (not the whole page every poll).
 */
import { describe, expect, it, vi } from 'vitest';
import { createLiveValueStore, sameLive } from '../liveValueStore';
import type { ControlValue } from '../../../lib/playEngine';

describe('sameLive', () => {
  it('compares numbers by value and colours by channel', () => {
    expect(sameLive(0.5, 0.5)).toBe(true);
    expect(sameLive(0.5, 0.6)).toBe(false);
    expect(sameLive(undefined, undefined)).toBe(true);
    expect(sameLive(undefined, 0)).toBe(false);
    expect(sameLive([1, 0, 0], [1, 0, 0])).toBe(true);
    expect(sameLive([1, 0, 0], [1, 0, 0.1])).toBe(false);
    expect(sameLive([1, 0, 0], 1)).toBe(false);
  });
});

describe('createLiveValueStore', () => {
  const setup = () => {
    const values = new Map<string, ControlValue>();
    const store = createLiveValueStore(id => values.get(id), false);
    return { values, store };
  };

  it('has the value at subscribe time, before any poll', () => {
    const { values, store } = setup();
    values.set('a', 0.25);
    store.subscribe('a', () => {});
    expect(store.get('a')).toBe(0.25);
  });

  it('tells only the listeners of the control that moved', () => {
    const { values, store } = setup();
    values.set('a', 0.1); values.set('b', 0.2);
    const la = vi.fn(), lb = vi.fn();
    store.subscribe('a', la); store.subscribe('b', lb);
    values.set('a', 0.3);
    store.poll();
    expect(la).toHaveBeenCalledTimes(1);
    expect(lb).not.toHaveBeenCalled();
    expect(store.get('a')).toBe(0.3);
    // Nothing moved: nobody is told.
    store.poll();
    expect(la).toHaveBeenCalledTimes(1);
  });

  it('keeps a copy of a colour, and a new one only when a channel moves', () => {
    const { values, store } = setup();
    const c: [number, number, number] = [1, 0.5, 0];
    values.set('c', c);
    const l = vi.fn();
    store.subscribe('c', l);
    const first = store.get('c');
    expect(first).toEqual([1, 0.5, 0]);
    expect(first).not.toBe(c);
    store.poll();
    expect(store.get('c')).toBe(first);
    c[1] = 0.6; // the engine writes in place
    store.poll();
    expect(l).toHaveBeenCalledTimes(1);
    expect(store.get('c')).toEqual([1, 0.6, 0]);
    expect(store.get('c')).not.toBe(first);
  });

  it('goes back to undefined when a control stops being driven', () => {
    const { values, store } = setup();
    values.set('a', 1);
    const l = vi.fn();
    store.subscribe('a', l);
    values.delete('a');
    store.poll();
    expect(l).toHaveBeenCalledTimes(1);
    expect(store.get('a')).toBeUndefined();
  });

  it('stops watching a control when its last listener goes', () => {
    const { values, store } = setup();
    values.set('a', 1);
    const off1 = store.subscribe('a', () => {});
    const off2 = store.subscribe('a', () => {});
    expect(store.watching()).toBe(1);
    off1();
    expect(store.watching()).toBe(1);
    off2();
    expect(store.watching()).toBe(0);
    expect(store.get('a')).toBeUndefined();
  });
});
