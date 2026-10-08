import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../build';
import { parseRecipe, printRecipe } from '../recipe';
import { SHAPES } from '../spec';

const FOUR = SHAPES.filter(s => s.fourD).map(s => s.kind);

describe('4D shapes in the 3D Scene Builder', () => {
  it('has the 4D shapes', () => {
    expect(FOUR).toEqual(['hypersphere', 'tesseract', 'duocylinder', 'clifford-torus', 'cell24', 'julia4d', 'mandel4d']);
  });

  it.each(FOUR)('%s builds as Lift to 4D → Rotate 4D → the shape, and compiles', kind => {
    const r = parseRecipe(`surface · ${kind} w=0.1 spin=10 · background night`);
    expect(r.errors).toEqual([]);
    const g = buildStandaloneGraph(r.spec);
    const inner = g.nodes.flatMap(n => ((n.params.subgraph as { nodes?: typeof g.nodes } | undefined)?.nodes ?? []));
    const types = inner.map(n => n.type);
    expect(types).toContain('lift4D');
    expect(types).toContain('rotate4D');
    expect(compileGraph({ nodes: g.nodes }).success).toBe(true);
    const again = parseRecipe(printRecipe(r.spec));
    expect(again.errors).toEqual([]);
  });

  it('combines a 4D shape with a 3D one', () => {
    const r = parseRecipe('surface · smooth-union(tesseract w=0.2, sphere r=0.4 at=(0.8,0,0)) · background night');
    expect(r.errors).toEqual([]);
    expect(compileGraph({ nodes: buildStandaloneGraph(r.spec).nodes }).success).toBe(true);
  });
});
