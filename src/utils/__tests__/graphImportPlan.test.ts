import { describe, it, expect } from 'vitest';
import { planGraphImport, fitAspect } from '../graphImportPlan';

const graph = (label: string) => JSON.stringify({ nodes: [], looseGroups: [], label });

describe('planGraphImport', () => {
  it('recreates a picked folder\'s structure and skips non-graphs', () => {
    const plan = planGraphImport([
      { path: 'my-graphs/Rings/fractal rings.json', content: graph('a') },
      { path: 'my-graphs/Rings/Deep/zoom rings.json', content: graph('b') },
      { path: 'my-graphs/plain.json', content: graph('c') },
      { path: 'my-graphs/notes.txt', content: 'hi' },
      { path: 'my-graphs/broken.json', content: '{nope' },
      { path: 'my-graphs/preset.json', content: JSON.stringify({ subgraph: {} }) },
    ], []);
    expect(plan.graphs.map(g => [g.name, g.folder])).toEqual([
      ['fractal rings', 'Rings'],
      ['zoom rings', 'Rings / Deep'],
      ['plain', null],
    ]);
    expect(plan.skipped.map(s => s.reason)).toEqual(['not a .json file', 'not valid JSON', 'not a graph (no nodes array)']);
  });

  it('understands the backup zip layout and leaves presets out', () => {
    const plan = planGraphImport([
      { path: 'backup_2026-09-24/graphs/Experiments/blob.json', content: graph('a') },
      { path: 'backup_2026-09-24/graphs/loose.json', content: graph('b') },
      { path: 'backup_2026-09-24/presets/thing.json', content: graph('c') },
    ], []);
    expect(plan.graphs.map(g => [g.name, g.folder])).toEqual([['blob', 'Experiments'], ['loose', null]]);
    expect(plan.skipped[0].reason).toMatch(/presets are not graphs/);
  });

  it('never overwrites an existing graph name', () => {
    const plan = planGraphImport([{ path: 'a.json', content: graph('x') }, { path: 'b/a.json', content: graph('y') }], ['a']);
    expect(plan.graphs.map(g => g.name)).toEqual(['a 2', 'a 3']);
  });

  it('a single file has no folder', () => {
    expect(planGraphImport([{ path: 'solo.json', content: graph('x') }], []).graphs[0]).toMatchObject({ name: 'solo', folder: null });
  });
});

describe('fitAspect', () => {
  it('fits the largest box of the ratio inside the panel', () => {
    expect(fitAspect(1000, 500, 1)).toEqual({ width: 500, height: 500 });
    expect(fitAspect(1000, 500, 16 / 9)).toEqual({ width: 888, height: 500 });
    expect(fitAspect(500, 1000, 16 / 9)).toEqual({ width: 500, height: 281 });
    expect(fitAspect(500, 1000, 9 / 16)).toEqual({ width: 500, height: 888 });
  });
});
