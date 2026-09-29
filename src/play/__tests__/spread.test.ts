import { describe, expect, it } from 'vitest';
import { spValue, spWeights } from '../kit/spread.js';
import { dpHash01, dpPickPad, dpSlots } from '../kit/drumPads.js';
import { addToSpread, deleteSpread, makeSpread, moveSpreadMember, patchSpread, removeFromSpread, spreadOf, spreadResetValues, spreadValues } from '../spreads';
import { emptyPlayRecord, parsePlayRecord, spreadTarget, type PlayControl, type PlayRecord } from '../../types/play';

const ctl = (id: string, min = 0, max = 10): PlayControl => ({ id, target: `n${id}::p`, kind: 'float', label: id, min, max, step: 0.1 });
const rec = (): PlayRecord => ({ ...emptyPlayRecord(), controls: [ctl('a'), ctl('b'), ctl('c'), ctl('d')] });

describe('the Spread curve', () => {
  it('lays a linear ramp over the order, and Shift rotates it', () => {
    expect(spWeights(3, 0, 'linear', undefined, false)).toEqual([0, 0.5, 1]);
    expect(spWeights(3, 1, 'linear', undefined, false).map(x => +x.toFixed(3))).toEqual([1, 0, 0.5]);
    expect(spWeights(3, 0, 'linear', undefined, true)).toEqual([1, 0.5, 0]);
    expect(spWeights(1, 0, 'linear', undefined, false)).toEqual([1]);
  });
  it('adds Amount times the share of the range, clamped', () => {
    expect(spValue(2, 0, 10, 0.5, 1)).toBe(7);
    expect(spValue(2, 0, 10, 0.5, 0)).toBe(2);
    expect(spValue(9, 0, 10, 1, 1)).toBe(10);
    expect(spValue(1, 0, 10, -1, 1)).toBe(0);
  });
});

describe('Spread edits', () => {
  it('makes a Spread with its Amount and Shift controls, and members join and leave', () => {
    const { play, spreadId } = makeSpread(rec(), ['a', 'b']);
    expect(spreadOf(play, 'a')?.id).toBe(spreadId);
    expect(play.controls.some(c => c.target === spreadTarget(spreadId, 'amount'))).toBe(true);
    expect(play.controls.find(c => c.target === spreadTarget(spreadId, 'shift'))?.max).toBe(1);
    const more = addToSpread(play, spreadId, 'c');
    expect(more.spreads?.[0].members).toEqual(['a', 'b', 'c']);
    expect(more.controls.find(c => c.target === spreadTarget(spreadId, 'shift'))?.max).toBe(2);
    const moved = moveSpreadMember(more, spreadId, 2, 0);
    expect(moved.spreads?.[0].members).toEqual(['c', 'a', 'b']);
    const fewer = removeFromSpread(moved, spreadId, 'a');
    expect(fewer.spreads?.[0].members).toEqual(['c', 'b']);
    // A slider is in one Spread at most: a second Spread takes it over.
    const two = makeSpread(fewer, ['b']);
    expect(spreadOf(two.play, 'b')?.id).toBe(two.spreadId);
    expect(two.play.spreads?.[0].members).toEqual(['c']);
    // Never a Spread's own Amount.
    const amountId = play.controls.find(c => c.target === spreadTarget(spreadId, 'amount'))!.id;
    expect(addToSpread(play, spreadId, amountId).spreads?.[0].members).toEqual(['a', 'b']);
  });
  it('patches the curve and mode, renames its controls, and deletes cleanly', () => {
    const { play, spreadId } = makeSpread(rec(), ['a', 'b', 'c']);
    const custom = patchSpread(play, spreadId, { curve: 'custom' });
    expect(custom.spreads?.[0].curveY?.length).toBeGreaterThan(1);
    const named = patchSpread(custom, spreadId, { label: 'Sizes', mode: 'reset', resetOn: 'beat', invert: true });
    expect(named.controls.find(c => c.target === spreadTarget(spreadId, 'amount'))?.label).toBe('Sizes · Amount');
    expect(named.spreads?.[0]).toMatchObject({ mode: 'reset', resetOn: 'beat', invert: true });
    const gone = deleteSpread(named, spreadId);
    expect(gone.spreads).toBeUndefined();
    expect(gone.controls.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('values and Reset: offsets ride on the base, Reset goes to each minimum', () => {
    const { play, spreadId } = makeSpread(rec(), ['a', 'b', 'c']);
    const sp = play.spreads![0];
    const rows = spreadValues(sp, play.controls, () => 2, 0.5, 0);
    expect(rows.map(r => r.value)).toEqual([2, 4.5, 7]);
    expect([...spreadResetValues(play, spreadId).values()]).toEqual([0, 0, 0]);
  });
  it('survives a file round trip', () => {
    const { play, spreadId } = makeSpread(rec(), ['a', 'b']);
    const back = parsePlayRecord(JSON.parse(JSON.stringify(patchSpread(play, spreadId, { curve: 'sine', amount: 0.3 }))));
    expect(back.spreads?.[0]).toMatchObject({ id: spreadId, members: ['a', 'b'], curve: 'sine', amount: 0.3 });
    expect(back.controls.filter(c => c.target.startsWith('spread:')).length).toBe(2);
  });
});

describe('the sample index', () => {
  it('walks through the pads with sounds and wraps', () => {
    const slots = dpSlots(i => [0, 2, 5].includes(i), 16);
    expect(slots).toEqual([0, 2, 5]);
    expect(dpPickPad(slots, 0, 0, 'index', 0, 0)).toBe(0);
    expect(dpPickPad(slots, 0, 1, 'index', 0, 0)).toBe(2);
    expect(dpPickPad(slots, 2, 2, 'index', 0, 0)).toBe(0);
    expect(dpPickPad(slots, 5, -1, 'index', 0, 0)).toBe(2);
    expect(dpPickPad(slots, 1, 3, 'index', 0, 0)).toBe(1); // a silent pad plays itself
  });
  it('random and spread modes are seeded and stay inside the slots', () => {
    const slots = [0, 2, 5];
    const a = Array.from({ length: 20 }, (_, n) => dpPickPad(slots, 0, 0, 'random', 0, dpHash01(7, n)));
    const b = Array.from({ length: 20 }, (_, n) => dpPickPad(slots, 0, 0, 'random', 0, dpHash01(7, n)));
    expect(a).toEqual(b);
    expect(a.every(p => slots.includes(p))).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(1);
    const s = Array.from({ length: 20 }, (_, n) => dpPickPad(slots, 2, 0, 'spread', 1, dpHash01(3, n)));
    expect(s.every(p => slots.includes(p))).toBe(true);
  });
});
