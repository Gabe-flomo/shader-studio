/**
 * The Inputs board (implementation guide, phase 4): Map turns an old mapping
 * into a source of the record (playing the same) and routes it onto more
 * controls with the likely defaults; routes are edited and removed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { addFreeSource, defaultRoute, mappingToSource, ownSource, patchRoute, removeRoute, routeToControl, routesInto, sourceType } from '../routeOps';
import { playEngine } from '../../lib/playEngine';
import { rtNew } from '../kit/routes.js';
import { inputBus } from '../../lib/inputBus';
import { emptyPlayRecord, type PlayControl, type PlayMapping, type PlayRecord } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); inputBus.setParamBindings({}); });

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const knob: PlayMapping = { id: 'm1', controlId: 'a', source: { kind: 'control', controlId: 'src' }, outMin: 2, outMax: 8, curve: 'exp', smoothMs: 30, delayMs: 50, enabled: true };
const base = (): PlayRecord => ({ ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a'), ctl('b'), ctl('c', { min: -1, max: 1 })], mappings: [knob] });

function drive(play: PlayRecord, values: number[], read: string[]): number[][] {
  inputBus.setParamBindings(Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`])));
  playEngine.setRecord(play);
  // Each run from a clean slate: smoothing and delay lines are kept by route id, and both runs use m1.
  (playEngine as unknown as { rt: unknown }).rt = rtNew();
  let t = 1;
  return values.map(v => {
    playEngine.setBaseValues(new Map([['src', v], ['a', 5], ['b', 5], ['c', 0]]));
    inputBus.tick(1 / 60, (t += 1 / 60));
    return read.map(id => (playEngine.liveValue(id) as number | undefined) ?? NaN);
  });
}

describe('Map on the Inputs board', () => {
  it('an old mapping turned into a source plays the same', () => {
    const own = ownSource(base(), 'm1')!;
    expect(own.play.mappings).toEqual([]);
    expect(own.source).toEqual(mappingToSource(knob));
    const values = [0, 0.2, 0.7, 1, 0.4, 0.4, 0.9, 0];
    expect(drive(own.play, values, ['a'])).toEqual(drive(base(), values, ['a']));
  });

  it('routes a number with Add ±half the range, an on/off input with Set and a short glide; says what it did', () => {
    const r = routeToControl(base(), 'm1', 'b');
    expect(r.play.sources![0].outputs[0].routes[1]).toMatchObject({ to: 'b', mode: 'add', outMin: -5, outMax: 5 });
    expect(r.said).toMatch(/now drives b, adding up to 50% of its range/);
    // The same control again, or a missing one: unchanged.
    expect(routeToControl(r.play, 'm1', 'b').play).toBe(r.play);
    expect(routeToControl(r.play, 'm1', 'zz').play).toBe(r.play);
    expect(sourceType({ kind: 'key', code: 'KeyA' })).toBe('boolean');
    expect(defaultRoute('boolean', ctl('x'))).toMatchObject({ mode: 'replace', outMin: 0, outMax: 10, smoothMs: 120 });
    const free = addFreeSource(base(), { kind: 'key', code: 'KeyA' });
    expect(routeToControl(free.play, free.id, 'c').play.sources![0].outputs[0].routes[0]).toMatchObject({ to: 'c', mode: 'replace', outMin: -1, outMax: 1 });
  });

  it('one source drives both in the engine; a route can be edited and taken off', () => {
    const r = routeToControl(base(), 'm1', 'b').play;
    const got = drive(r, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], ['a', 'b']);
    // a: Set 2..8 (exp, smoothed, late); b: its slider 5 plus up to +5.
    expect(got[got.length - 1][0]).toBeGreaterThan(7);
    expect(got[got.length - 1][1]).toBeCloseTo(10, 6);
    expect(routesInto(r, 'b')).toEqual([expect.objectContaining({ sourceId: 'm1', mode: 'add', mapping: false })]);
    const rid = r.sources![0].outputs[0].routes[1].id;
    expect(patchRoute(r, 'm1', rid, { enabled: false }).sources![0].outputs[0].routes[1].enabled).toBe(false);
    expect(routesInto(removeRoute(r, 'm1', rid), 'b')).toEqual([]);
    expect(routesInto(base(), 'a')).toEqual([expect.objectContaining({ sourceId: 'm1', mapping: true })]);
  });
});
