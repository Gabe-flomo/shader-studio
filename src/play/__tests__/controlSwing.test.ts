/**
 * The swing ring (controlSwing.ts): the part of a slider's range its sources
 * can move it across, read the way rtFrame plays Replace and Add routes.
 */
import { describe, expect, it } from 'vitest';
import { controlSwing, swingFraction } from '../controlSwing';
import { emptyPlayRecord, type PlayControl, type PlayMapping, type PlayRecord, type PlayRoute, type PlaySourceDef } from '../../types/play';

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const route = (to: string, mode: 'replace' | 'add', outMin: number, outMax: number, over: Partial<PlayRoute> = {}): PlayRoute => ({ id: `r_${to}_${outMin}_${outMax}`, to, mode, outMin, outMax, curve: 'linear', enabled: true, ...over });
const src = (id: string, routes: PlayRoute[], over: Partial<PlaySourceDef> = {}): PlaySourceDef => ({ id, enabled: true, source: { kind: 'mouse', axis: 'x' }, outputs: [{ kind: 'value', routes }], ...over });
const mapping = (id: string, controlId: string, outMin: number, outMax: number, over: Partial<PlayMapping> = {}): PlayMapping => ({ id, controlId, source: { kind: 'mouse', axis: 'y' }, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true, ...over });
const rec = (over: Partial<PlayRecord>): PlayRecord => ({ ...emptyPlayRecord(), controls: [ctl('a'), ctl('col', { kind: 'color' }), ctl('btn', { kind: 'action' })], ...over });

describe('controlSwing', () => {
  it('nothing drives it, or it is missing: null', () => {
    expect(controlSwing(rec({}), 'a', 5)).toBeNull();
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'replace', 2, 8)])] }), 'zz', 5)).toBeNull();
  });

  it('a Replace covers its range; an old mapping is a Replace too', () => {
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'replace', 2, 8)])] }), 'a', 5)).toEqual({ lo: 2, hi: 8 });
    expect(controlSwing(rec({ mappings: [mapping('m', 'a', 1, 4)] }), 'a', 9)).toEqual({ lo: 1, hi: 4 });
  });

  it('an inverted range covers the same span', () => {
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'replace', 8, 2)])] }), 'a', 5)).toEqual({ lo: 2, hi: 8 });
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'add', 2, -3)])] }), 'a', 5)).toEqual({ lo: 2, hi: 7 });
  });

  it('several Replaces: the union', () => {
    expect(controlSwing(rec({ mappings: [mapping('m', 'a', 1, 3)], sources: [src('s', [route('a', 'replace', 6, 7)])] }), 'a', 0)).toEqual({ lo: 1, hi: 7 });
  });

  it('an Add swings around the slider, kept in range', () => {
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'add', -2, 2)])] }), 'a', 5)).toEqual({ lo: 3, hi: 7 });
    // The default ±half the range from the slider at 8: up to 10 and no further.
    expect(controlSwing(rec({ sources: [src('s', [route('a', 'add', -5, 5)])] }), 'a', 8)).toEqual({ lo: 3, hi: 10 });
  });

  it('several Adds sum', () => {
    const play = rec({ sources: [src('s1', [route('a', 'add', -1, 1)]), src('s2', [route('a', 'add', 0, 2)])] });
    expect(controlSwing(play, 'a', 5)).toEqual({ lo: 4, hi: 8 });
  });

  it('Adds on top of Replaces move from the Replaces span', () => {
    const play = rec({ sources: [src('s1', [route('a', 'replace', 2, 4)]), src('s2', [route('a', 'add', -1, 1)])] });
    expect(controlSwing(play, 'a', 9)).toEqual({ lo: 1, hi: 5 });
  });

  it('off sources and routes, and routes elsewhere, do not count', () => {
    const play = rec({
      mappings: [mapping('m', 'a', 0, 10, { enabled: false })],
      sources: [src('s1', [route('a', 'replace', 0, 10)], { enabled: false }), src('s2', [route('a', 'replace', 0, 10, { enabled: false }), route('b', 'replace', 0, 1), route('a', 'replace', 4, 6)])],
    });
    expect(controlSwing(play, 'a', 0)).toEqual({ lo: 4, hi: 6 });
  });

  it('colours and buttons have no slider to shade', () => {
    const play = rec({ sources: [src('s', [route('col', 'replace', 0, 1), route('btn', 'replace', 0, 1)])] });
    expect(controlSwing(play, 'col', 0)).toBeNull();
    expect(controlSwing(play, 'btn', 0)).toBeNull();
  });

  it('swingFraction places a value along the range', () => {
    expect(swingFraction(5, 0, 10)).toBe(0.5);
    expect(swingFraction(-3, 0, 10)).toBe(0);
    expect(swingFraction(30, 0, 10)).toBe(1);
    expect(swingFraction(1, 1, 1)).toBe(0);
  });
});
