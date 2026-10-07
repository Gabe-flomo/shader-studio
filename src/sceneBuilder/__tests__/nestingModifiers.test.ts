/**
 * The Scene Builder's tree and modifiers (docs/scene-builder.md, "The tree" and "Modifiers"):
 * deeply nested combines round-trip spec → recipe → spec → graph → spec; per-item modifiers
 * (@move, @rotate, @scale, @round, @onion…) build the right nodes before the item's distance
 * and are read back by Describe, in builder graphs and hand-made ones; the shape gallery
 * covers the registry; and the tree's move operations are pure and safe.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { parseRecipe, printRecipe, formatRecipe } from '../recipe';
import { buildStandaloneGraph, ROLE_KEY } from '../build';
import { collapseGroups, describeGraph } from '../recognize';
import {
  addModifier, canMoveInto, insertShape, moveBy, moveIntoPrevious, moveModifierTo, moveOut, wrapItems,
} from '../edit';
import { GALLERY_SHAPES, renderThumbnail, THUMB_SDF } from '../thumbnails';
import { MODIFIER_KINDS, SHAPES, WARP_BY_KIND, canonicalSpec, findItem, type GroupSpec, type SceneSpec } from '../spec';

const inner = (n: GraphNode | undefined): GraphNode[] => ((n?.params.subgraph as SubgraphData | undefined)?.nodes ?? []);
const every = (nodes: GraphNode[]): GraphNode[] => nodes.flatMap(n => [n, ...every(inner(n))]);
const byRole = (nodes: GraphNode[], role: string) => every(nodes).find(n => n.params[ROLE_KEY] === role);
const src = (nodes: GraphNode[], n: GraphNode | undefined, key: string) => {
  const c = n?.inputs[key]?.connection;
  return c ? every(nodes).find(x => x.id === c.nodeId) : undefined;
};
const canon = (s: SceneSpec) => canonicalSpec({ ...s, root: collapseGroups(structuredClone(s.root)) });

/** smooth-union(a, b) then intersect with c then subtract d, with modifiers at every level. */
const DEEP = 'surface · subtract(\n  intersect(\n    smooth-union(sphere r=0.6 @move(0.3,0,0) @scale(1.2), box size=0.4 @rotate(30,0,45) @round(0.05)) k=0.2 @twist(1.5),\n    cylinder r=0.5 h=1 @onion(0.04)\n  ) @mirror(xz),\n  sphere r=0.3 at=(0,0.6,0)\n) @move(0,0.2,0)';

describe('deeply nested combines', () => {
  it('round-trip spec → recipe → spec → graph → spec, at any depth', () => {
    const recipes = [
      DEEP,
      'union(smooth-union(intersect(subtract(box, sphere r=0.6), sphere r=0.7), torus) k=0.1, smooth-intersect(capsule, union(cone, octahedron @twist(2))) k=0.05)',
      'smooth-subtract(union(union(union(sphere, box at=(1,0,0)), torus at=(0,1,0)), cone at=(0,0,1)), capsule @scale(0.5)) k=0.15',
    ];
    for (const r of recipes) {
      const p = parseRecipe(r);
      expect(p.errors, r).toEqual([]);
      const printed = printRecipe(p.spec);
      const again = parseRecipe(printed);
      expect(again.errors, printed).toEqual([]);
      expect(canon(again.spec)).toEqual(canon(p.spec));
      // The pretty form too.
      expect(canon(parseRecipe(formatRecipe(r)).spec)).toEqual(canon(p.spec));
      // Graph: compiles, and Describe reads exactly the spec back.
      const g = buildStandaloneGraph(again.spec);
      expect(compileGraph({ nodes: g.nodes }).success, printed).toBe(true);
      const d = describeGraph(g.nodes)!;
      expect(d.unknown, printed).toEqual([]);
      expect(canon(d.spec)).toEqual(canon(p.spec));
      expect(printRecipe(d.spec)).toBe(printed);
    }
  });

  it('reads the nesting as meant: smooth-union, then intersect, then subtract', () => {
    const { spec } = parseRecipe(DEEP);
    const root = spec.root;
    expect([root.op, root.k]).toEqual(['subtract', 0]);
    const inter = root.children[0] as GroupSpec;
    expect(inter.op).toBe('intersect');
    expect(inter.warps.map(w => w.kind)).toEqual(['mirror']);
    const blend = inter.children[0] as GroupSpec;
    expect([blend.op, blend.k]).toEqual(['union', 0.2]);
    expect(blend.warps.map(w => w.kind)).toEqual(['twist']);
    expect(blend.children.map(c => c.warps.map(w => w.kind))).toEqual([['move', 'scale'], ['rotate', 'round']]);
    expect(root.warps.map(w => [w.kind, w.values.by])).toEqual([['move', [0, 0.2, 0]]]);
  });
});

describe('per-item modifiers', () => {
  it('@move(x,y,z) and the rest read as vectors and print back the same way', () => {
    const { spec, errors } = parseRecipe('sphere @move(1, 0.5, -2) @rotate(30,0,45) @scale(2) @round(0.1) @onion(0.02) @polar-repeat(8)');
    expect(errors).toEqual([]);
    const s = spec.root.children[0];
    expect(s.warps.map(w => [w.kind, w.values])).toEqual([
      ['move', { by: [1, 0.5, -2] }], ['rotate', { by: [30, 0, 45] }], ['scale', { s: 2 }], ['round', { r: 0.1 }], ['onion', { t: 0.02 }], ['polar-repeat', { axis: 'y', count: 8 }],
    ]);
    expect(printRecipe(spec)).toBe('surface · sphere @move(1,0.5,-2) @rotate(30,0,45) @scale(2) @round(0.1) @onion(0.02) @polar-repeat(8)');
    // The older `rotate y 30` is still a Turn.
    expect(parseRecipe('box · rotate y 30').spec.root.warps.map(w => [w.kind, w.values.angle])).toEqual([['turn', 30]]);
    expect(parseRecipe('box @rotate(x 45)').spec.root.children[0].warps[0].kind).toBe('turn');
  });

  it('every modifier the inspector offers is a known warp', () => {
    for (const k of MODIFIER_KINDS) expect(WARP_BY_KIND[k], k).toBeDefined();
  });

  it('builds the nodes before the item\'s distance, with notes, and the distance steps after it, innermost first', () => {
    const { spec } = parseRecipe('box @move(1,0,0) @rotate(0,90,0) @scale(2) @round(0.1) @onion(0.02)');
    const g = buildStandaloneGraph(spec);
    expect(compileGraph({ nodes: g.nodes }).success).toBe(true);
    const box = byRole(g.nodes, 's1')!;
    // Point: Scene Pos → Move → Rotate (Y) → Scale → box.
    const scale = src(g.nodes, box, 'pos')!;
    expect([scale.type, scale.params.scale]).toEqual(['scale3d', 0.5]);
    const turn = src(g.nodes, scale, 'p')!;
    expect([turn.type, turn.params.axis, turn.params[ROLE_KEY]]).toEqual(['rotate3D', 'y', 'w2:y']);
    const move = src(g.nodes, turn, 'pos')!;
    expect([move.type, move.params.tx]).toEqual(['translate3D', 1]);
    expect(src(g.nodes, move, 'pos')!.type).toBe('scenePos');
    // Distance: box → Onion → Offset (round) → Scale's correction → Scene Output.
    const out = every(g.nodes).find(n => n.type === 'sceneOutput')!;
    const fix = src(g.nodes, out, 'dist')!;
    expect([fix.type, fix.params[ROLE_KEY], fix.params.scale]).toEqual(['scale3d', 'w3:dist', 0.5]);
    const rnd = src(g.nodes, fix, 'dist')!;
    expect([rnd.type, rnd.params.amount]).toEqual(['sdfOffset', -0.1]);
    const onion = src(g.nodes, rnd, 'sdf')!;
    expect([onion.type, onion.params.r]).toEqual(['sdfOnion', 0.02]);
    expect(src(g.nodes, onion, 'dist')!.id).toBe(box.id);
    for (const n of [scale, turn, move, fix, rnd, onion]) expect(String(n.params.__comment).length, n.type).toBeGreaterThan(20);
    expect(String(scale.params.__comment)).toMatch(/Scale on/);
  });

  it('a group\'s modifiers wrap the whole combine', () => {
    const { spec } = parseRecipe('smooth-union(sphere, box at=(0.8,0,0)) k=0.2 @move(0,1,0) @onion(0.03)');
    const g = buildStandaloneGraph(spec);
    const out = every(g.nodes).find(n => n.type === 'sceneOutput')!;
    const onion = src(g.nodes, out, 'dist')!;
    expect(onion.type).toBe('sdfOnion');
    expect(src(g.nodes, onion, 'dist')!.type).toBe('sdfUnion');
    const move = byRole(g.nodes, 'w1')!;
    expect(move.type).toBe('translate3D');
    expect(src(g.nodes, byRole(g.nodes, 's1'), 'pos')!.id).toBe(move.id);
  });

  it('Describe reads modifiers back from builder graphs in their order', () => {
    for (const r of [
      'box @round(0.05) @scale(2) @twist(1)',
      'box @scale(2) @round(0.05) @twist(1)',
      'sphere @twist(2) @displace(0.03) @move(0.5,0,0) @onion(0.02)',
      'union(box @rotate(10,20,30), sphere at=(1,0,0) @scale(0.5) @scale(3)) @round(0.02) @rotate(0,45,0)',
    ]) {
      const { spec } = parseRecipe(r);
      const d = describeGraph(buildStandaloneGraph(spec).nodes)!;
      expect(d.unknown, r).toEqual([]);
      expect(printRecipe(d.spec), r).toBe(printRecipe(spec));
    }
  });

  it('Describe recognises per-item transforms in a hand-made graph', () => {
    // Scene Pos → Translate → Scale → box → Onion → Scale (dist), and a sphere through an Offset.
    const N = (id: string, type: string, params: Record<string, unknown>, wires: Record<string, string>): GraphNode => {
      const def = getNodeDefinition(type)!;
      return {
        id, type, position: { x: 0, y: 0 }, params: { ...(def.defaultParams ?? {}), ...params },
        inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k].split('.')[0], outputKey: wires[k].split('.')[1] } } : {}) }])),
        outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
      };
    };
    const insideNodes = [
      N('sp', 'scenePos', {}, {}),
      N('tr', 'translate3D', { tx: 0, ty: 1, tz: 0 }, { pos: 'sp.pos' }),
      N('sc', 'scale3d', { scale: 0.5 }, { p: 'tr.pos' }),
      N('bx', 'boxSDF3D', {}, { pos: 'sc.p' }),
      N('on', 'sdfOnion', { r: 0.05 }, { dist: 'bx.dist' }),
      N('sc2', 'scale3d', { scale: 0.5 }, { dist: 'on.dist' }),
      N('sh', 'sphereSDF3D', { radius: 0.4 }, { pos: 'sp.pos' }),
      N('of', 'sdfOffset', { amount: -0.1 }, { sdf: 'sh.dist' }),
      N('un', 'sdfUnion', { k: 0 }, { a: 'sc2.dist', b: 'of.result' }),
      N('so', 'sceneOutput', {}, { dist: 'un.dist' }),
    ];
    const scene = N('scene', 'sceneGroup', { subgraph: { nodes: insideNodes, inputPorts: [], outputPorts: [] } }, {});
    const cam = N('cam', 'marchCamera', {}, {});
    const loop = N('loop', 'marchLoopGroup', { subgraph: { nodes: [], inputPorts: [], outputPorts: [] } }, { ro: 'cam.ro', rd: 'cam.rd', scene: 'scene.scene' });
    const out = N('out', 'output', {}, { color: 'loop.color' });
    const d = describeGraph([scene, cam, loop, out])!;
    const [box, ball] = d.spec.root.children;
    expect(box.type === 'shape' && box.kind).toBe('box');
    expect(box.warps.map(w => [w.kind, w.values])).toEqual([['move', { by: [0, 1, 0] }], ['scale', { s: 2 }], ['onion', { t: 0.05 }]]);
    expect(ball.warps.map(w => [w.kind, w.values])).toEqual([['round', { r: 0.1 }]]);
    expect(d.unknown.filter(u => /Scale|Offset|Onion/.test(u))).toEqual([]);
  });
});

describe('the shape gallery', () => {
  it('shows every shape in the registry, in its order, each with a thumbnail renderer', () => {
    // Every registry shape once, in order; the rounded variants follow their shape.
    expect(GALLERY_SHAPES.filter(g => g.key === g.kind).map(g => g.kind)).toEqual(SHAPES.map(s => s.kind));
    expect(new Set(GALLERY_SHAPES.map(g => g.kind))).toEqual(new Set(SHAPES.map(s => s.kind)));
    expect(GALLERY_SHAPES.map(g => g.key)).toEqual(expect.arrayContaining(['rounded-box', 'rounded-cylinder']));
    expect(new Set(GALLERY_SHAPES.map(g => g.key)).size).toBe(GALLERY_SHAPES.length);
    expect(Object.keys(THUMB_SDF).sort()).toEqual(SHAPES.map(s => s.kind).sort());
    // A variant's sizes are settings its shape has.
    for (const g of GALLERY_SHAPES) for (const k of Object.keys(g.size ?? {})) expect(SHAPES.find(s => s.kind === g.kind)!.params.map(p => p.key)).toContain(k);
  });

  it('renders a small picture of each tile: a solid middle on a clear background', () => {
    for (const s of GALLERY_SHAPES) {
      const px = renderThumbnail(s.key, 32);
      expect(px.length).toBe(32 * 32 * 4);
      let covered = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 128) covered++;
      expect(covered, s.kind).toBeGreaterThan(32 * 32 * 0.05);
      expect(px[3], `${s.kind} corner`).toBe(0);
    }
  });
});

describe('moving things about the tree', () => {
  const tree = () => parseRecipe('sphere · union(box, torus) · cone · smooth-union(capsule, plane)').spec;
  const order = (s: SceneSpec) => printRecipe(s);

  it('▲ / ▼ step an item among its siblings and stop at the ends', () => {
    const s = tree();
    expect(moveBy(s, 's1', -1)).toBe(false);
    expect(moveBy(s, 's1', 1)).toBe(true);
    expect(s.root.children.map(c => c.id)).toEqual(['g2', 's1', 's4', 'g3']);
    expect(moveBy(s, 's3', 1)).toBe(false);
    expect(moveBy(s, 's3', -1)).toBe(true);
    expect((s.root.children[0] as GroupSpec).children.map(c => c.id)).toEqual(['s3', 's2']);
  });

  it('Move into puts an item at the end of the group above it; Move out puts it after its group', () => {
    const s = tree();
    expect(canMoveInto(s, 's4')).toBe(true);
    expect(canMoveInto(s, 's1')).toBe(false);
    expect(moveIntoPrevious(s, 's4')).toBe(true);
    expect((findItem(s, 'g2')!.item as GroupSpec).children.map(c => c.id)).toEqual(['s2', 's3', 's4']);
    expect(moveOut(s, 's2')).toBe(true);
    expect(s.root.children.map(c => c.id)).toEqual(['s1', 'g2', 's2', 'g3']);
    expect(moveOut(s, 's1')).toBe(false);
  });

  it('Wrap in… puts a group around the selection at the first item\'s place', () => {
    const s = tree();
    const g = wrapItems(s, ['s4', 's1'], 'intersect', 0)!;
    expect(s.root.children[0].id).toBe(g.id);
    expect(g.children.map(c => c.id)).toEqual(['s1', 's4']);
    expect([g.op, g.k]).toEqual(['intersect', 0]);
    // A group inside a selected one is taken with it, not twice.
    const s2 = tree();
    const h = wrapItems(s2, ['g2', 's2', 'g3'], 'union', 0.2)!;
    expect(h.children.map(c => c.id)).toEqual(['g2', 'g3']);
    expect(wrapItems(s2, [s2.root.id], 'union', 0)).toBeNull();
    // Build the user's own: smooth-union(a, b) → intersect with c → subtract d.
    const s3 = parseRecipe('sphere · box · cylinder · capsule').spec;
    const blend = wrapItems(s3, ['s1', 's2'], 'union', 0.3)!;
    const inter = wrapItems(s3, [blend.id, 's3'], 'intersect', 0)!;
    wrapItems(s3, [inter.id, 's4'], 'subtract', 0);
    expect(order(s3)).toBe('surface · subtract(intersect(smooth-union(sphere, box), cylinder), capsule)');
  });

  it('a shape dropped from the gallery lands before, after or inside the row it was dropped on', () => {
    const s = tree();
    const a = insertShape(s, 'octahedron', 'g2', 'into');
    expect((findItem(s, 'g2')!.item as GroupSpec).children.at(-1)!.id).toBe(a.id);
    const b = insertShape(s, 'gyroid', 's1', 'before');
    expect(s.root.children[0].id).toBe(b.id);
    const c = insertShape(s, 'link', 's3', 'after');
    expect(findItem(s, c.id)!.parent!.id).toBe('g2');
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it('modifier chips are added, reordered and kept unique', () => {
    const s = tree();
    const m1 = addModifier(s, 's1', 'move');
    const m2 = addModifier(s, 's1', 'twist');
    const m3 = addModifier(s, 's1', 'onion');
    expect(new Set([m1, m2, m3]).size).toBe(3);
    moveModifierTo(s, 's1', m3, 0);
    expect(s.root.children[0].warps.map(w => w.kind)).toEqual(['onion', 'move', 'twist']);
    moveModifierTo(s, 's1', m3, 9);
    expect(s.root.children[0].warps.map(w => w.kind)).toEqual(['move', 'twist', 'onion']);
  });
});
