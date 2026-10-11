/**
 * Transform covers what each single-purpose transform node does (docs/transform-node.md): with
 * matching settings its GLSL gives the same point (and distance) as the old node's, run on the CPU
 * (compiler/__tests__/glslRun.ts) at a spread of sample points.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { getNodeDefinition } from '../definitions';
import { TransformNode, transformSockets, type TransformDim } from '../definitions/transformAny';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Env } from '../../compiler/__tests__/glslRun';

const ROTATE_BUILTIN = `vec2 rotate(vec2 v, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}`;

const oldNode = (type: string, params: Record<string, unknown>): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id: 'o', type, position: { x: 0, y: 0 }, params: { ...def.defaultParams, ...params }, inputs: { ...def.inputs }, outputs: { ...def.outputs } } as GraphNode;
};
const transform = (dim: TransformDim, params: Record<string, unknown>): GraphNode => {
  const s = transformSockets(dim);
  return { id: 't', type: 'transform', position: { x: 0, y: 0 }, params: { ...TransformNode.defaultParams, dim, ...params }, inputs: s.inputs, outputs: s.outputs } as GraphNode;
};

/** Run both nodes' code on the same inputs; return [old output, Transform output] per sample. */
function run(
  old: GraphNode, oldVars: Record<string, string>, oldOut: string,
  t: GraphNode, tVars: Record<string, string>, tOut: string,
  samples: Env[],
): Array<[unknown, unknown]> {
  const od = getNodeDefinition(old.type)!;
  const o = od.generateGLSL(old, oldVars);
  const n = TransformNode.generateGLSL(t, tVars);
  const src = [ROTATE_BUILTIN, od.glslFunction ?? '', TransformNode.glslFunction, 'void main() {', o.code, n.code, '}'].join('\n');
  const prog = compileFragment(src);
  return samples.map(env => {
    const out = prog.run({ ...env });
    return [out[o.outputVars[oldOut]], out[n.outputVars[tOut]]];
  });
}

const near = (a: unknown, b: unknown) => {
  const x = (Array.isArray(a) ? a : [a]) as number[];
  const y = (Array.isArray(b) ? b : [b]) as number[];
  expect(y.length).toBe(x.length);
  x.forEach((v, i) => expect(y[i]).toBeCloseTo(v, 5));
};

const pts2 = [[0.3, -0.2], [-0.7, 0.45], [1.2, 0.9], [0, 0]].map(P => ({ P, D: 0.37, T: 0.6, u_time: 1.7 }));
const pts3 = [[0.3, -0.2, 0.8], [-0.7, 0.45, -0.1], [1.2, 0.9, 0.33]].map(P => ({ P, D: 0.37, T: 0.6, u_time: 1.7 }));
const pts4 = [[0.3, -0.2, 0.8, 0.1], [-0.7, 0.45, -0.1, -0.6], [1.2, 0.9, 0.33, 0.5]].map(P => ({ P, D: 0.37, T: 0.6, u_time: 1.7 }));

describe('Transform does what each old transform node does', () => {
  it('Transform 2D (Place 2D) = Place mode, 2D', () => {
    const params = { x: 0.3, y: -0.4, rotate: 35, scale: 1.6 };
    for (const [a, b] of run(oldNode('place2D', params), { uv: 'P', turn: 'T', grow: 'D' }, 'p', transform('2', params), { p: 'P', turn: 'T', grow: 'D' }, 'p', pts2)) near(a, b);
    for (const [a, b] of run(oldNode('place2D', params), { uv: 'P' }, 'scale', transform('2', params), { p: 'P' }, 'scale', pts2)) near(a, b);
  });

  it('UV Transform 2D = Apply mode with Pivot and Stretch, 2D', () => {
    // uvTransform2dFn as written (the CPU runner has no mat2): mat2(c*sx, s*sx, -s*sy, c*sy) * (uv - pivot) + pivot + translate.
    expect(getNodeDefinition('uvTransform2d')!.glslFunction).toContain('uv = mat2(c * scale.x, s * scale.x, -s * scale.y, c * scale.y) * uv;');
    const uvt = (uv: number[], t: number[], a: number, s: number[], pv: number[]) => {
      const c = Math.cos(a), sn = Math.sin(a), x = uv[0] - pv[0], y = uv[1] - pv[1];
      return [c * s[0] * x - sn * s[1] * y + pv[0] + t[0], sn * s[0] * x + c * s[1] * y + pv[1] + t[1]];
    };
    const angle = 0.7;
    const t = transform('2', { mode: 'space', x: 0.2, y: -0.1, rotate: angle * 180 / Math.PI, stretch: true, sx: 1.5, sy: 0.6, px: 0.25, py: -0.3 });
    const prog = compileFragment([TransformNode.glslFunction, 'void main() {', TransformNode.generateGLSL(t, { p: 'P' }).code, '}'].join('\n'));
    for (const env of pts2) near(uvt(env.P, [0.2, -0.1], angle, [1.5, 0.6], [0.25, -0.3]), prog.run({ ...env }).t_p);
    // Wired Translate and Angle go to Offset and Turn.
    const t2 = transform('2', { mode: 'space', scale: 1.2 });
    const prog2 = compileFragment([TransformNode.glslFunction, 'void main() {', TransformNode.generateGLSL(t2, { p: 'P', turn: 'T', offset: 'P' }).code, '}'].join('\n'));
    for (const env of pts2) near(uvt(env.P, env.P, env.T, [1.2, 1.2], [0, 0]), prog2.run({ ...env }).t_p);
  });

  it('Rotate 2D = Apply mode, the angle on Turn', () => {
    for (const [a, b] of run(oldNode('rotate2d', {}), { input: 'P', angle: 'T' }, 'output', transform('2', { mode: 'space' }), { p: 'P', turn: 'T' }, 'p', pts2)) near(a, b);
    for (const [a, b] of run(oldNode('rotate2d', { angle: 1.1 }), { input: 'P' }, 'output', transform('2', { mode: 'space', rotate: 1.1 * 180 / Math.PI }), { p: 'P' }, 'p', pts2)) near(a, b);
  });

  it('Translate 3D = Place mode Move, 3D', () => {
    for (const [a, b] of run(oldNode('translate3D', { tx: 0.4, ty: -1, tz: 2 }), { pos: 'P' }, 'pos', transform('3', { x: 0.4, y: -1, z: 2 }), { p: 'P' }, 'p', pts3)) near(a, b);
  });

  for (const axis of ['x', 'y', 'z'] as const) {
    it(`Rotate 3D about ${axis.toUpperCase()} = Apply mode Rotate ${axis.toUpperCase()} (and Place mode with the angle negated)`, () => {
      const angle = 0.9;
      const o = oldNode('rotate3D', { axis, angle });
      for (const [a, b] of run(o, { pos: 'P' }, 'pos', transform('3', { mode: 'space', [`r${axis}`]: angle * 180 / Math.PI }), { p: 'P' }, 'p', pts3)) near(a, b);
      for (const [a, b] of run(o, { pos: 'P' }, 'pos', transform('3', { [`r${axis}`]: -angle * 180 / Math.PI }), { p: 'P' }, 'p', pts3)) near(a, b);
    });
  }

  it('Scale 3D = Apply mode Scale, with its distance half on Distance', () => {
    const o = oldNode('scale3d', { scale: 2.5 });
    const t = transform('3', { mode: 'space', scale: 2.5 });
    for (const [a, b] of run(o, { p: 'P', dist: 'D' }, 'p', t, { p: 'P', dist: 'D' }, 'p', pts3)) near(a, b);
    for (const [a, b] of run(o, { p: 'P', dist: 'D' }, 'dist', t, { p: 'P', dist: 'D' }, 'dist', pts3)) near(a, b);
  });

  it('Translate 4D = Place mode Move, 4D', () => {
    for (const [a, b] of run(oldNode('translate4D', { tx: 0.4, ty: -1, tz: 2, tw: 0.7 }), { p4: 'P' }, 'p4', transform('4', { x: 0.4, y: -1, z: 2, w: 0.7 }), { p: 'P' }, 'p', pts4)) near(a, b);
  });

  for (const plane of ['xy', 'xw', 'zw'] as const) {
    it(`Rotate 4D in ${plane.toUpperCase()} (with Spin) = Place mode Turn ${plane.toUpperCase()} and Spin`, () => {
      const o = oldNode('rotate4D', { plane, angle: 40, spin: 15 });
      const t = transform('4', { [`r${plane}`]: 40, spin: 15, spinPlane: plane });
      for (const [a, b] of run(o, { p4: 'P' }, 'p4', t, { p: 'P' }, 'p', pts4)) near(a, b);
    });
  }

  it('Scale 4D = Place mode Scale, with its distance half on Distance', () => {
    const o = oldNode('scale4D', { scale: 1.8 });
    const t = transform('4', { scale: 1.8 });
    for (const [a, b] of run(o, { p4: 'P', dist: 'D' }, 'p4', t, { p: 'P', dist: 'D' }, 'p', pts4)) near(a, b);
    for (const [a, b] of run(o, { p4: 'P', dist: 'D' }, 'dist', t, { p: 'P', dist: 'D' }, 'dist', pts4)) near(a, b);
  });
});
