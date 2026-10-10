/**
 * Starter recipes (nodes/recipes): every recipe builds a graph that compiles, puts its result on
 * the Output, notes every node it adds, and lands its cards without covering any other card.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { estimateNodeHeight } from '../../../store/graphLayout';
import { getNodeDefinition } from '../../definitions';
import { applyRecipe, placeNear, PICTURE_DEPTH_SET, STARTER_RECIPES } from '..';
import type { GraphNode } from '../../../types/nodeGraph';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
const box = (nd: GraphNode) => ({ x: nd.position.x, y: nd.position.y, w: 360, h: H(nd) });
const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function noOverlap(list: GraphNode[]) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    expect(hit(box(list[i]), box(list[j])), `${list[i].id} (${list[i].type}) / ${list[j].id} (${list[j].type})`).toBe(false);
  }
}
let k = 0;
const nextId = () => `r${k++}`;

/** Three starting graphs: an Output showing a picture, an empty Output, and no Output at all. */
const starts = (type: string): Array<{ name: string; nodes: GraphNode[] }> => [
  { name: 'over a picture', nodes: [n('circleSDF', 'pic', -900, -600), n('floatToVec3', 'picCol', -500, -600, {}, { input: ['pic', 'distance'] }), n('output', 'out', 1600, -600, {}, { color: ['picCol', 'rgb'] }), n(type, 'self', 0, 0)] },
  { name: 'empty Output', nodes: [n('output', 'out', 1600, -600), n(type, 'self', 0, 0)] },
  { name: 'no Output', nodes: [n(type, 'self', 0, 0)] },
];

describe('every starter recipe', () => {
  // The picture-with-depth set is opened from a March Loop card, not keyed by a node type (depthRecipes.test.ts)
  for (const [type, recipes] of Object.entries(STARTER_RECIPES).filter(([t]) => t !== PICTURE_DEPTH_SET)) {
    it(`${type} is a real node type`, () => expect(getNodeDefinition(type), type).toBeDefined());
    for (const recipe of recipes) {
      for (const start of starts(type)) {
        it(`${type} · ${recipe.label} · ${start.name}: compiles, shows on the Output, notes every node, no overlaps`, () => {
          const r = applyRecipe(start.nodes, 'self', recipe, nextId, H)!;
          expect(r).not.toBeNull();
          const res = compileGraph({ nodes: r.nodes });
          expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
          expect(r.shown).toBe(true);
          const out = r.nodes.find(nd => nd.type === 'output')!;
          expect(out.inputs.color.connection).toBeDefined();
          // What the Output shows now depends on the new node (the recipe is about it).
          const byId = new Map(r.nodes.map(nd => [nd.id, nd]));
          const seen = new Set<string>();
          const stack = [out.inputs.color.connection!.nodeId];
          while (stack.length) {
            const id = stack.pop()!;
            if (seen.has(id)) continue;
            seen.add(id);
            for (const i of Object.values(byId.get(id)?.inputs ?? {})) if (i.connection) stack.push(i.connection.nodeId);
          }
          expect(seen.has('self'), 'the Output reads the new node').toBe(true);
          for (const id of r.added) expect(String(byId.get(id)!.params.__comment ?? '').trim(), `${byId.get(id)!.type} has a note`).not.toBe('');
          noOverlap(r.nodes);
          // The new node stays where it was put.
          expect(byId.get('self')!.position).toEqual({ x: 0, y: 0 });
        });
      }
    }
  }
});

describe('a recipe never takes a wire the node already has', () => {
  it('Grid: a UV the user wired into Columns stays', () => {
    const nodes = [n('constant', 'cols', -500, 0, { value: 7 }), n('output', 'out', 1600, 0), n('gridLayout', 'self', 0, 0, {}, { columns: ['cols', 'value'] })];
    const r = applyRecipe(nodes, 'self', STARTER_RECIPES.gridLayout[0], nextId, H)!;
    expect(r.nodes.find(nd => nd.id === 'self')!.inputs.columns.connection?.nodeId).toBe('cols');
  });
  it('a node note the user wrote stays', () => {
    const nodes = [n('output', 'out', 1600, 0), n('gridLayout', 'self', 0, 0, { __comment: 'mine' })];
    const r = applyRecipe(nodes, 'self', STARTER_RECIPES.gridLayout[1], nextId, H)!;
    expect(r.nodes.find(nd => nd.id === 'self')!.params.__comment).toBe('mine');
  });
});

describe('placement', () => {
  it('slides cards down past whatever is in the way, keeping their columns', () => {
    const wall = [0, 1, 2, 3].map(i => n('fbm', `wall${i}`, 420 * i, 0));
    const added = [n('palette', 'a', 420, 0), n('palette', 'b', 840, 100)];
    const placed = placeNear(wall, added, H);
    expect(placed.map(nd => nd.position.x)).toEqual([420, 840]);
    noOverlap([...wall, ...placed]);
  });
  it('a recipe in a crowded graph lands on no card', () => {
    const crowd: GraphNode[] = [];
    for (let x = -3; x <= 4; x++) for (let y = -2; y <= 2; y++) if (x || y) crowd.push(n('circleSDF', `c${x}_${y}`, x * 420, y * 300));
    const nodes = [...crowd, n('output', 'out', 2400, 0), n('gridLayout', 'self', 0, 0)];
    for (const recipe of STARTER_RECIPES.gridLayout) {
      const r = applyRecipe(nodes, 'self', recipe, nextId, H)!;
      const added = r.nodes.filter(nd => r.added.includes(nd.id));
      for (const a of added) for (const b of r.nodes) if (a.id !== b.id) expect(hit(box(a), box(b)), `${a.id} / ${b.id}`).toBe(false);
    }
  });
});
