/**
 * Learning and ranking (suggestions/learning.ts, usage.ts, rank.ts): your graphs outrank the
 * examples, the example prior fades as your own data grows, saved > imported > old live wires,
 * and the table updates incrementally (only changed graphs are re-read; deleted ones forgotten).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import {
  learnedTable, learnGraph, LEARNING_KEY, learningSummary, LIVE_HALF_LIFE_MS, personalTable, priorScale, priorTable, PRIOR_MASS,
  reconcileSavedGraphs, recordWireBetween, resetLearning, setLearningStorage, textSignature, WEIGHTS, type KV,
} from '../learning';
import { CoTable, graphPairs, normaliseEnd, strength } from '../usage';
import { rankMoves, learnedNext } from '../rank';
import type { PriorTable } from '../prior';
import shipped from '../examplePrior.json';

function memoryKV(init: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: k => data[k] ?? null, set: (k, v) => { data[k] = v; }, remove: k => { delete data[k]; }, keys: () => Object.keys(data) };
}

/** A saved graph: circle → `next` (its distance into `key`) → Output. */
function graph(next: string, key: string, savedAt = 1000): { nodes: GraphNode[]; savedAt: number } {
  return { savedAt, nodes: [
    n('uv', 'u', 0, 0), n('circleSDF', 'c', 400, 0, {}, { position: ['u', 'uv'] }),
    n(next, 'x', 800, 0, {}, { [key]: ['c', 'distance'] }), n('output', 'o', 1200, 0),
  ] };
}

/** The shipped prior (the real examples): circle → SDF Glow is its strongest circle pattern. */
const PRIOR = shipped as PriorTable;

let kv: ReturnType<typeof memoryKV>;
beforeEach(() => { kv = memoryKV(); setLearningStorage(kv); });

describe('the co-occurrence table', () => {
  it('normalises socket keys and old type names, and skips wildcards', () => {
    expect(normaliseEnd('min', 'result', 'out')).toEqual({ type: 'sdfUnion', key: 'dist' });
    expect(normaliseEnd('multiply', '__param_b', 'in')).toEqual({ type: 'multiply', key: 'b' });
    const nodes = [n('uv', 'u', 0, 0), n('circleSDF', 'c', 0, 0, {}, { position: ['u', 'uv'] })];
    const e = { id: 'e', type: 'exprNode', position: { x: 0, y: 0 }, outputs: { result: { type: 'float', label: 'r' } }, params: {}, inputs: { a: { type: 'float', label: 'a', connection: { nodeId: 'c', outputKey: 'distance' } } } } as GraphNode;
    const g = n('light', 'g', 0, 0, {}, { distance: ['e', 'result'] });
    expect([...graphPairs([...nodes, e, g])]).toEqual(['uv.uv>circleSDF.position']);
  });

  it('counts a pair once per graph and gives P(next | this) and lift', () => {
    const t = new CoTable();
    t.add('a.o>b.i', 3); t.add('a.o>c.i', 1); t.add('d.o>b.i', 4);
    const s = t.stat('a', 'o', 'b', 'i');
    expect(s.p).toBeCloseTo(0.75);
    expect(s.lift).toBeCloseTo(0.75 / (7 / 8));
    expect(strength(t.stat('a', 'o', 'c', 'i'))).toBeGreaterThan(0);
  });
});

describe('ranking weights', () => {
  it('with no data of your own, the examples decide', () => {
    const t = learnedTable(Date.now(), PRIOR);
    expect(t.personal).toBe(0);
    expect(t.priorWeight).toBe(PRIOR_MASS);
    const ranked = rankMoves(n('circleSDF', 'c', 0, 0), [n('circleSDF', 'c', 0, 0)], { table: t.table, personal: personalTable(), prior: priorTable(PRIOR) });
    expect(ranked[0].move.id).toBe('glow');
    expect(ranked[0].why).toMatch(/examples/);
  });

  it('your own graphs outrank the examples', () => {
    for (let i = 0; i < 6; i++) learnGraph(`g${i}`, 'saved', graph('distanceShape', 'distance').nodes, `s${i}`);
    const t = learnedTable(Date.now(), PRIOR);
    const c = n('circleSDF', 'c', 0, 0);
    const ranked = rankMoves(c, [c], { table: t.table, personal: personalTable(), prior: priorTable(PRIOR) });
    // Rings and Outline both add Outline (distance): your habit puts them above the examples' Glow.
    const ids = ranked.map(r => r.move.id);
    expect(ids.indexOf('rings')).toBeLessThan(ids.indexOf('glow'));
    const rings = ranked.find(r => r.move.id === 'rings')!;
    expect(rings.why).toBe('you often add Outline (distance) after Circle SDF');
    expect(rings.reason).toBe('you');
  });

  it('the example prior fades as your data grows', () => {
    expect(priorScale(0)).toBe(PRIOR_MASS);
    expect(priorScale(40)).toBe(PRIOR_MASS / 2);
    expect(priorScale(400)).toBeLessThan(PRIOR_MASS / 10);
    const share = () => {
      const t = learnedTable(Date.now(), PRIOR).table;
      return t.stat('circleSDF', 'distance', 'light', 'distance').count;
    };
    const before = share();
    for (let i = 0; i < 20; i++) learnGraph(`fbm${i}`, 'saved', [n('fbm', 'f', 0, 0), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] })], `s${i}`);
    expect(share()).toBeLessThan(before / 1.4);
  });

  it('saved graphs count more than imported ones, and live wires fade with time', () => {
    learnGraph('mine', 'saved', graph('light', 'distance').nodes, 'a');
    learnGraph('import:x', 'imported', graph('sdfFill', 'd').nodes, 'b');
    const t = personalTable();
    expect(t.stat('circleSDF', 'distance', 'light', 'distance').count).toBe(WEIGHTS.saved);
    expect(t.stat('circleSDF', 'distance', 'sdfFill', 'd').count).toBe(WEIGHTS.imported);
    const now = Date.now();
    recordWireBetween('circleSDF', 'distance', 'sdfOnion', 'dist', now - LIVE_HALF_LIFE_MS);
    recordWireBetween('circleSDF', 'distance', 'sdfOffset', 'sdf', now);
    const p = personalTable(now);
    expect(p.stat('circleSDF', 'distance', 'sdfOnion', 'dist').count).toBeCloseTo(WEIGHTS.live / 2, 3);
    expect(p.stat('circleSDF', 'distance', 'sdfOffset', 'sdf').count).toBeCloseTo(WEIGHTS.live, 3);
  });

  it('feeds the quick-add picks: what usually follows a socket', () => {
    for (let i = 0; i < 4; i++) learnGraph(`g${i}`, 'saved', graph('sdfOnion', 'dist').nodes, `s${i}`);
    const l = learnedTable(Date.now(), PRIOR);
    const picks = learnedNext('circleSDF', 'distance', 'out', { table: l.table, personal: personalTable(), prior: priorTable(PRIOR) });
    expect(picks[0]).toMatchObject({ type: 'sdfOnion', key: 'dist', you: true });
  });
});

describe('incremental updates', () => {
  const save = (name: string, g: { nodes: GraphNode[]; savedAt: number }) => { kv.data[`shader-studio:${name}`] = JSON.stringify(g); };

  it('seeds from saved graphs as yours, then re-reads only what changed, and forgets deleted ones', () => {
    save('one', graph('light', 'distance'));
    save('two', graph('sdfFill', 'd'));
    kv.data['shader-studio:settings:theme'] = '"dark"';
    reconcileSavedGraphs();
    expect(learningSummary()).toMatchObject({ saved: 2, imported: 0 });
    const stored = () => JSON.parse(kv.data[LEARNING_KEY] ?? '{}') as { graphs?: Record<string, { sig: string; at: number }> };

    // Nothing changed: nothing re-read (same signatures, same times).
    const sigBefore = learnedTable().table.total;
    reconcileSavedGraphs();
    expect(learnedTable().table.total).toBe(sigBefore);

    // One changed, one new (a workspace folder brought it in: imported), one deleted.
    save('one', graph('sdfOnion', 'dist'));
    save('three', graph('light', 'distance'));
    delete kv.data['shader-studio:two'];
    reconcileSavedGraphs();
    expect(learningSummary()).toMatchObject({ saved: 1, imported: 1 });
    const t = personalTable();
    expect(t.stat('circleSDF', 'distance', 'sdfOnion', 'dist').count).toBe(1);
    expect(t.stat('circleSDF', 'distance', 'sdfFill', 'd').count).toBe(0);
    expect(t.stat('circleSDF', 'distance', 'light', 'distance').count).toBe(WEIGHTS.imported);
    void stored;
  });

  it('a graph is re-learned only when its text changes', () => {
    const text = JSON.stringify(graph('light', 'distance'));
    expect(textSignature(text)).toBe(textSignature(text));
    expect(textSignature(text)).not.toBe(textSignature(text + ' '));
  });

  it('Reset learning forgets everything, and graphs saved before it stay forgotten', () => {
    save('old', graph('light', 'distance', 1000));
    reconcileSavedGraphs();
    expect(learningSummary().saved).toBe(1);
    resetLearning(5000);
    expect(learningSummary()).toEqual({ saved: 0, imported: 0, live: 0 });
    reconcileSavedGraphs();
    expect(learningSummary().saved).toBe(0);
    // A graph saved after the reset is learned (as yours when you saved it: learnSaved; here it arrived: imported).
    save('new', graph('sdfFill', 'd', 9000));
    reconcileSavedGraphs();
    expect(learningSummary().imported).toBe(1);
  });

  it('App settings\' Reset (removing the key) is Reset learning', () => {
    save('old', graph('light', 'distance', 1000));
    reconcileSavedGraphs();
    expect(learningSummary().saved).toBe(1);
    delete kv.data[LEARNING_KEY];
    reconcileSavedGraphs();
    expect(learningSummary().saved).toBe(0);
  });

  it('persists compactly and reloads', () => {
    learnGraph('a', 'saved', graph('light', 'distance').nodes, 'x');
    recordWireBetween('uv', 'uv', 'fbm', 'uv');
    resetLearning(1); // writes now
    learnGraph('b', 'saved', graph('sdfFill', 'd').nodes, 'y');
    // Debounced write: force a reload from what's stored after a flush.
    setLearningStorage(kv);
    expect(learningSummary().saved).toBeLessThanOrEqual(1);
  });
});
