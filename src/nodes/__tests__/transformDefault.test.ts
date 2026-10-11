/**
 * The one Transform is the default (docs/transform-node.md): search ranks it first, new things make it in
 * the right Dimension, and in 3D it is placed like the 3D transforms (in a Scene Group, wrapped by smart 3D).
 * The single-purpose nodes stay offered.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { getNodeDefinition, getOfferedDefinitions } from '../definitions';
import { TransformNode, transformDefFor, transformSectionSummary } from '../definitions/transformAny';
import { scoreNodeDef } from '../searchNodes';
import { planSmart3DAdd } from '../smart3d';
import { addToScene, buildSceneSubgraphFor, sceneRole } from '../scene3dShapes';
import { addScopeOf, hiddenHere, transformDimHere } from '../addScope';
import { instantiateNode } from '../scene3dDefaults';
import { isParamVisible } from '../../compiler/uniformPatcher';
import { typeByName } from '../../suggestions/doRefs';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { parser } from '@shaderfrog/glsl-parser';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { parseRecipe } from '../../sceneBuilder/recipe';
import type { GraphNode } from '../../types/nodeGraph';

const OLD = ['place2D', 'uvTransform2d', 'rotate2d', 'translate3D', 'rotate3D', 'rotateAxis3D', 'scale3d', 'translate4D', 'rotate4D', 'scale4D'];

describe('the old transform nodes stay', () => {
  it('are still offered and still load', () => {
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    for (const t of OLD) {
      expect(offered.has(t), t).toBe(true);
      expect(getNodeDefinition(t)?.deprecated, t).toBeFalsy();
    }
  });
});

describe('search: Transform first', () => {
  const rank = (q: string) => getOfferedDefinitions().map(d => ({ d, s: scoreNodeDef(d, q) })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.d.label.localeCompare(b.d.label)).map(x => x.d.type);
  for (const q of ['transform', 'move', 'translate', 'place', 'position', 'rotate', 'scale']) {
    it(`“${q}” lists Transform first, the specific nodes after it`, () => {
      const r = rank(q);
      expect(r[0]).toBe('transform');
      expect(r.length).toBeGreaterThan(1);
    });
  }
  it('“translate 3d” still finds Translate 3D', () => {
    expect(rank('translate 3d')).toContain('translate3D');
  });
});

describe('the Do bar language makes Transform', () => {
  it('in the dimension named', () => {
    expect(typeByName(['rotate'])).toEqual({ type: 'transform' });
    expect(typeByName(['move'])).toEqual({ type: 'transform' });
    expect(typeByName(['translate', '3d'])).toEqual({ type: 'transform', params: { dim: '3' } });
    expect(typeByName(['rotate', '4d'])).toEqual({ type: 'transform', params: { dim: '4' } });
    expect(typeByName(['transform'])).toEqual({ type: 'transform' });
    // The old nodes by their type id (how a printed recipe names them).
    expect(typeByName(['rotate3d'])).toEqual({ type: 'rotate3D' });
  });
  it('node factories give a 3D Transform 3D sockets', () => {
    const t = n('transform', 't', 0, 0, { dim: '3' }, { p: ['a', 'pos'] });
    expect(t.inputs.p.type).toBe('vec3');
    expect(t.inputs.p.connection).toEqual({ nodeId: 'a', outputKey: 'pos' });
    expect(instantiateNode('t', 'transform', TransformNode, { x: 0, y: 0 }, { dim: '4' }).outputs.p.type).toBe('vec4');
  });
});

describe('Transform in 3D', () => {
  it('is 3D inside a Scene Group and on the top level of a 3D graph, 2D otherwise', () => {
    expect(transformDimHere({ groupType: 'sceneGroup' }, [])).toBe('3');
    expect(transformDimHere({ groupType: 'spaceWarpGroup' }, [])).toBe('3');
    expect(transformDimHere({ groupType: null }, [{ id: 'm', type: 'marchLoopGroup' } as GraphNode])).toBe('3');
    expect(transformDimHere({ groupType: null }, [])).toBe('2');
    expect(transformDimHere(addScopeOf([], []), [])).toBe('2');
  });

  it('is offered inside Scene Groups', () => {
    expect(hiddenHere(new Set(), { groupType: 'sceneGroup' }).has('transform')).toBe(false);
  });

  it('a top-level 3D Transform is wrapped in a Scene by smart 3D, as a warp with a partner shape', () => {
    const def = transformDefFor('3');
    const plan = planSmart3DAdd('transform', def, [], { x: 0, y: 0 });
    expect(plan.kind).toBe('wrap-scene');
    if (plan.kind !== 'wrap-scene') return;
    expect(plan.posInput).toBe('p');
    expect(plan.distOutput).toBeNull();
    expect(plan.spawnMarch).toBe(true);
    const role = sceneRole(def)!;
    expect(role).toMatchObject({ kind: 'warp', posInput: 'p', posOutput: 'p', distInput: null });
    let i = 0;
    const node = instantiateNode('t0', 'transform', def, { x: 0, y: 0 });
    const sub = buildSceneSubgraphFor(() => `n${++i}`, node, role);
    const types = sub.nodes.map(x => x.type);
    expect(types).toEqual(['scenePos', 'transform', 'sphereSDF3D', 'sceneOutput']);
    expect(node.inputs.p.connection?.nodeId).toBe(sub.nodes[0].id);
    // A 2D Transform is not a 3D node.
    expect(planSmart3DAdd('transform', TransformNode, [], { x: 0, y: 0 }).kind).toBe('none');
    expect(sceneRole(TransformNode)).toBeNull();
  });

  it('a top-level 4D Transform gets a Lift and a tesseract', () => {
    const def = transformDefFor('4');
    expect(planSmart3DAdd('transform', def, [], { x: 0, y: 0 }).kind).toBe('wrap-scene');
    let i = 0;
    const sub = buildSceneSubgraphFor(() => `n${++i}`, instantiateNode('t0', 'transform', def, { x: 0, y: 0 }), sceneRole(def)!);
    expect(sub.nodes.map(x => x.type)).toEqual(['scenePos', 'lift4D', 'transform', 'tesseractSDF', 'sceneOutput']);
  });

  it('a shape added beside another is moved aside by a 3D Transform', () => {
    let i = 0;
    const next = () => `n${++i}`;
    const sphere = getNodeDefinition('sphereSDF3D')!;
    const first = buildSceneSubgraphFor(next, instantiateNode(next(), 'sphereSDF3D', sphere, { x: 0, y: 0 }), sceneRole(sphere)!);
    const placed = addToScene(next, first, instantiateNode(next(), 'boxSDF3D', getNodeDefinition('boxSDF3D')!, { x: 0, y: 0 }), sceneRole(getNodeDefinition('boxSDF3D')!)!, { byHand: false })!;
    const shift = placed.subgraph.nodes.find(x => x.type === 'transform')!;
    expect(shift.params).toMatchObject({ dim: '3', x: 1.3, _autoShift: true });
    expect(placed.spread).toBe(1.3);
  });
});

describe('the builders make Transform', () => {
  it('the 3D Scene Builder places and turns a shape with one 3D Transform, and the scene compiles', () => {
    const { spec } = parseRecipe('surface · box at=(1,0,0) rot=(0,30,0)');
    const g = buildStandaloneGraph(spec);
    expect(compileGraph({ nodes: g.nodes }).success).toBe(true);
    const all: GraphNode[] = [];
    const walk = (ns: GraphNode[]) => { for (const x of ns) { all.push(x); const sg = x.params.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes); } };
    walk(g.nodes);
    expect(all.some(x => ['translate3D', 'rotate3D', 'scale3d'].includes(x.type))).toBe(false);
    const t = all.find(x => x.type === 'transform')!;
    expect(t.params).toMatchObject({ dim: '3', x: 1, ry: 30 });
  });
});

describe('the card', () => {
  const vis = (key: string, params: Record<string, unknown>) => isParamVisible(TransformNode.paramDefs![key], { ...TransformNode.defaultParams, ...params }, TransformNode.defaultParams);
  it('Position grows with the Dimension, and so does Rotate', () => {
    expect([vis('x', {}), vis('y', {}), vis('z', {}), vis('w', {})]).toEqual([true, true, false, false]);
    expect([vis('z', { dim: '3' }), vis('w', { dim: '3' })]).toEqual([true, false]);
    expect(vis('w', { dim: '4' })).toBe(true);
    expect(Object.keys(TransformNode.paramDefs!).filter(k => TransformNode.paramDefs![k].section === 'Rotate' && k.startsWith('r') && vis(k, { dim: '4' }))).toHaveLength(6);
    expect(['rx', 'ry', 'rz'].every(k => vis(k, { dim: '3' }))).toBe(true);
    expect(vis('rotate', { dim: '2' })).toBe(true);
    // Pivot Z: Apply mode and 3D or 4D.
    expect(vis('pz', { mode: 'space', dim: '2' })).toBe(false);
    expect(vis('pz', { mode: 'space', dim: '3' })).toBe(true);
    expect(vis('pz', { mode: 'place', dim: '3' })).toBe(false);
  });
  it('Position is always open; Rotate and Scale fold to a one-line summary', () => {
    expect(TransformNode.pinnedSection).toBe('Position');
    const sections = [...new Set(Object.values(TransformNode.paramDefs!).map(pd => pd.section).filter(Boolean))];
    expect(sections).toEqual(['Position', 'Rotate', 'Scale']);
    expect(transformSectionSummary('Rotate', { ...TransformNode.defaultParams, rotate: 30 })).toBe('Rotate 30°');
    expect(transformSectionSummary('Scale', { ...TransformNode.defaultParams })).toBe('Scale 1.0');
    expect(transformSectionSummary('Rotate', { ...TransformNode.defaultParams, dim: '3', ry: 45 })).toBe('Rotate Y 45°');
    expect(transformSectionSummary('Rotate', { ...TransformNode.defaultParams, dim: '4', rxw: 20 })).toBe('Turn XW 20°');
  });
  for (const dim of ['2', '3', '4'] as const) {
    it(`${dim}D Apply mode with Stretch, Spin and Distance parses`, () => {
      const node = n('transform', 't', 0, 0, { dim, mode: 'space', stretch: true, spin: 10, px: 0.2 });
      const { code } = TransformNode.generateGLSL(node, { p: `vec${dim}(0.1)`, dist: '0.5', turn: dim === '3' ? 'vec3(0.1)' : '0.1', grow: '1.2' });
      const src = `precision highp float;\nuniform float u_time;\n${TransformNode.glslFunction}\nvoid main() {\n${code} gl_FragColor = vec4(t_scale + t_dist);\n}`;
      expect(() => parser.parse(src, { quiet: true })).not.toThrow();
    });
  }
});
