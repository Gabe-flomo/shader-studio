/**
 * "Switch to Transform" (nodes/toTransform.ts): every old transform node becomes a Transform that gives
 * the same output (run on the CPU before and after, wires and settings as they were), or is refused with
 * a reason when part of it can't be carried exactly.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { getNodeDefinition } from '../definitions';
import { TransformNode } from '../definitions/transformAny';
import { TO_TRANSFORM_TYPES, planToTransform, switchToTransformIn } from '../toTransform';
import { compileGraph } from '../../compiler/graphCompiler';
import { compileFragment, type Env } from '../../compiler/__tests__/glslRun';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayRecord } from '../../types/play';

const ROTATE_BUILTIN = `vec2 rotate(vec2 v, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}`;
const MAT2_FREE: Record<string, string> = {
  // The CPU runner has no mat2: UV Transform 2D's helper, written out the same way.
  uvTransform2d: `vec2 uvTransform2dFn(vec2 uv, vec2 translate, float angle, vec2 scale, vec2 pivot) {
    uv -= pivot;
    float c = cos(angle), s = sin(angle);
    uv = vec2(c * scale.x * uv.x + -s * scale.y * uv.y, s * scale.x * uv.x + c * scale.y * uv.y);
    uv += pivot + translate;
    return uv;
}`,
};

const node = (type: string, params: Record<string, unknown> = {}, wires: Record<string, string> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s, ...(wires[k] ? { connection: { nodeId: 'src', outputKey: wires[k] } } : {}) }]));
  return { id: 'o', type, position: { x: 0, y: 0 }, params: { ...def.defaultParams, ...params }, inputs, outputs: { ...def.outputs } } as GraphNode;
};

/** Each output of the node before and after the switch, on the CPU, at the same inputs (`vars`: socket → value name). */
function sameOutputs(old: GraphNode, vars: Record<string, string>, samples: Env[], exact: boolean) {
  const plan = planToTransform([old], old)!;
  expect(plan.ok, plan.reason).toBe(true);
  const t = { ...plan.node, id: 't' };
  const od = getNodeDefinition(old.type)!;
  const oldVars = Object.fromEntries(Object.entries(vars).filter(([k]) => old.inputs[k]?.connection));
  const newVars = Object.fromEntries(Object.entries(oldVars).map(([k, v]) => [plan.inputMap[k], v]));
  const o = od.generateGLSL(old, oldVars);
  const n = TransformNode.generateGLSL(t, newVars);
  const prog = compileFragment([ROTATE_BUILTIN, MAT2_FREE[old.type] ?? od.glslFunction ?? '', TransformNode.glslFunction, 'void main() {', o.code, n.code, '}'].join('\n'));
  for (const env of samples) {
    const out = prog.run({ ...env });
    for (const [ok, nk] of Object.entries(plan.outputMap)) {
      const a = out[o.outputVars[ok]] as number | number[];
      const b = out[n.outputVars[nk]] as number | number[];
      if (exact) expect(b, `${old.type}.${ok}`).toEqual(a);
      else ([a].flat() as number[]).forEach((v, i) => expect(([b].flat() as number[])[i]).toBeCloseTo(v, 6));
    }
  }
  return plan;
}

const S2 = [[0.3, -0.2], [-0.7, 0.45], [1.2, 0.9]].map(P => ({ P, D: 0.37, T: 0.6, G: 1.3, O: [0.1, -0.3], g_uv: P, u_time: 1.7 }));
const S3 = [[0.3, -0.2, 0.8], [-0.7, 0.45, -0.1]].map(P => ({ P, D: 0.37, T: 0.6, G: 1.3, u_time: 1.7 }));
const S4 = [[0.3, -0.2, 0.8, 0.1], [-0.7, 0.45, -0.1, -0.6]].map(P => ({ P, D: 0.37, T: 0.6, G: 1.3, u_time: 1.7 }));

describe('Switch to Transform: the same output, node by node', () => {
  it('Transform 2D (Place 2D): exact, with Offset, Turn and Grow wired', () => {
    const p = sameOutputs(node('place2D', { x: 0.3, y: -0.4, rotate: 35, scale: 1.6 }, { uv: 'a', offset: 'b', turn: 'c', grow: 'd' }), { uv: 'P', offset: 'O', turn: 'T', grow: 'G' }, S2, true);
    expect(p.node.params).toMatchObject({ dim: '2', mode: 'place', x: 0.3, rotate: 35, scale: 1.6 });
  });
  it('UV Transform 2D: Apply mode with Pivot and Stretch (to float rounding)', () => {
    const p = sameOutputs(node('uvTransform2d', { tx: 0.2, ty: -0.1, angle: 0.7, sx: 1.5, sy: 0.6, pivotX: 0.25, pivotY: -0.3 }, { uv: 'a' }), { uv: 'P' }, S2, false);
    expect(p.node.params).toMatchObject({ mode: 'space', stretch: true, sx: 1.5, px: 0.25 });
  });
  it('UV Transform 2D with Translate and Angle wired: they go to Offset and Turn', () => {
    const p = sameOutputs(node('uvTransform2d', { tx: 5, angle: 3, sx: 1.2, sy: 1.2 }, { uv: 'a', translate: 'b', angle: 'c' }), { uv: 'P', translate: 'O', angle: 'T' }, S2, false);
    expect(p.node.params).toMatchObject({ x: 0, y: 0, rotate: 0 });
    expect(p.node.inputs.offset.connection).toBeDefined();
  });
  it('Rotate 2D: Apply mode, its Angle wire on Turn (exact)', () => {
    sameOutputs(node('rotate2d', {}, { input: 'a', angle: 'b' }), { input: 'P', angle: 'T' }, S2, true);
    sameOutputs(node('rotate2d', { angle: 1.1 }, { input: 'a' }), { input: 'P' }, S2, false);
  });
  it('Translate 3D: exact', () => {
    sameOutputs(node('translate3D', { tx: 0.4, ty: -1, tz: 2 }, { pos: 'a' }), { pos: 'P' }, S3, true);
  });
  for (const axis of ['x', 'y', 'z']) {
    it(`Rotate 3D about ${axis.toUpperCase()}: Apply mode (to float rounding)`, () => {
      sameOutputs(node('rotate3D', { axis, angle: 0.9 }, { pos: 'a' }), { pos: 'P' }, S3, false);
    });
  }
  it('Scale 3D: Apply mode, both halves, Scale wire on Grow', () => {
    sameOutputs(node('scale3d', { scale: 2.5 }, { p: 'a', dist: 'b' }), { p: 'P', dist: 'D' }, S3, true);
    sameOutputs(node('scale3d', { scale: 2.5 }, { p: 'a', dist: 'b', scale: 'c' }), { p: 'P', dist: 'D', scale: 'G' }, S3, true);
  });
  it('Translate 4D: exact', () => {
    sameOutputs(node('translate4D', { tx: 0.4, ty: -1, tz: 2, tw: 0.7 }, { p4: 'a' }), { p4: 'P' }, S4, true);
  });
  for (const plane of ['xy', 'xw', 'zw']) {
    it(`Rotate 4D in ${plane.toUpperCase()} with Spin: exact`, () => {
      const p = sameOutputs(node('rotate4D', { plane, angle: 40, spin: 15 }, { p4: 'a' }), { p4: 'P' }, S4, true);
      expect(p.node.params).toMatchObject({ [`r${plane}`]: 40, spin: 15, spinPlane: plane });
    });
  }
  it('Scale 4D: both halves, Scale wire on Grow, exact', () => {
    sameOutputs(node('scale4D', { scale: 1.8 }, { p4: 'a', dist: 'b' }), { p4: 'P', dist: 'D' }, S4, true);
    sameOutputs(node('scale4D', { scale: 1.8 }, { p4: 'a', dist: 'b', scale: 'c' }), { p4: 'P', dist: 'D', scale: 'G' }, S4, true);
  });
});

describe('Switch to Transform: refused with a reason when it would change the picture', () => {
  const reason = (n: GraphNode, bound = {}) => planToTransform([n], n, bound)!.reason;
  it('a wired setting with no Transform socket', () => {
    expect(reason(node('translate3D', {}, { pos: 'a', tx: 'b' }))).toMatch(/wired one by one/);
    expect(reason(node('uvTransform2d', {}, { uv: 'a', scale: 'b' }))).toMatch(/Scale is wired as a vec2/);
    expect(reason(node('rotate3D', {}, { pos: 'a', angle: 'b' }))).toMatch(/Turn takes all three/);
    expect(reason(node('rotate4D', {}, { p4: 'a', angle: 'b' }))).toMatch(/radians/);
  });
  it('Rotate 2D with nothing in its Input', () => {
    expect(reason(node('rotate2d', { angle: 1 }))).toMatch(/Nothing is wired into its Input/);
  });
  it('an angle in radians that is keyframed, on Play or set by the group card', () => {
    const kf = node('rotate3D', { angle: 1, __keyframes_angle: [{ t: 0, v: 1 }] }, { pos: 'a' });
    expect(reason(kf)).toMatch(/animated in radians/);
    expect(reason(node('rotate2d', { angle: 1 }, { input: 'a' }), { playTargets: (k: string) => k === 'angle' })).toMatch(/animated/);
    // A renamed setting in the same units is fine: its keyframes move with it.
    const moved = planToTransform([], node('translate3D', { tx: 1, __keyframes_tx: [{ t: 0, v: 1 }] }, { pos: 'a' }))!;
    expect(moved.ok).toBe(true);
    expect(moved.node.params.__keyframes_x).toEqual([{ t: 0, v: 1 }]);
  });
  it('every old type has a mapping', () => {
    expect([...TO_TRANSFORM_TYPES].sort()).toEqual(['place2D', 'rotate2d', 'rotate3D', 'rotate4D', 'scale3d', 'scale4D', 'translate3D', 'translate4D', 'uvTransform2d'].sort());
  });
});

describe('Switch all to Transform', () => {
  const play = (targets: string[]): PlayRecord => ({ controls: targets.map((target, i) => ({ id: `c${i}`, target, label: target })) } as unknown as PlayRecord);
  it('switches a whole graph, groups included, keeps wires, retargets Play and renames group overrides; it still compiles', () => {
    const uv: GraphNode = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } };
    const pl = { ...node('place2D', { x: 0.2 }, {}), id: 'pl', inputs: { ...node('place2D').inputs, uv: { ...node('place2D').inputs.uv, connection: { nodeId: 'uv', outputKey: 'uv' } } } };
    const circle = { ...node('circleSDF'), id: 'c' };
    circle.inputs = { ...circle.inputs, position: { ...circle.inputs.position, connection: { nodeId: 'pl', outputKey: 'p' } } };
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'c', outputKey: 'distance' } } }, outputs: {} };
    const before = compileGraph({ nodes: [uv, pl, circle, out] });
    expect(before.success).toBe(true);
    const r = switchToTransformIn([uv, pl, circle, out], play(['pl::x']), () => true);
    expect(r.switched).toEqual(['pl']);
    const t = r.nodes.find(n => n.id === 'pl')!;
    expect(t.type).toBe('transform');
    expect(r.nodes.find(n => n.id === 'c')!.inputs.position.connection).toEqual({ nodeId: 'pl', outputKey: 'p' });
    expect(r.play.controls[0].target).toBe('pl::x');
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('inside a Scene Group: a Translate 3D the card overrides is renamed there', () => {
    const scenePos: GraphNode = { id: 'sp', type: 'scenePos', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Pos' } } };
    const tr = { ...node('translate3D', { tx: 0.5 }), id: 'tr' };
    tr.inputs = { ...tr.inputs, pos: { ...tr.inputs.pos, connection: { nodeId: 'sp', outputKey: 'pos' } } };
    const group: GraphNode = { id: 'g', type: 'sceneGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { 'tr::tx': 0.9, subgraph: { nodes: [scenePos, tr], inputPorts: [], outputPorts: [] } } };
    const r = switchToTransformIn([group], play(['g::tr::ty']), () => true);
    const g = r.nodes[0];
    expect(g.params['tr::x']).toBe(0.9);
    expect('tr::tx' in g.params).toBe(false);
    expect(r.play.controls[0].target).toBe('g::tr::y');
    const inner = (g.params.subgraph as { nodes: GraphNode[] }).nodes.find(n => n.id === 'tr')!;
    expect([inner.type, inner.params.x, inner.inputs.p.connection?.nodeId]).toEqual(['transform', 0.5, 'sp']);
  });

  it('leaves the ones it can\'t switch, saying why', () => {
    const r = switchToTransformIn([node('rotate2d', { angle: 1 })], play([]), () => true);
    expect(r.switched).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/Input/);
  });
});
