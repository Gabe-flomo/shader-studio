/**
 * 4D fractals (quaternion Julia and Mandelbrot): the GLSL run on the CPU (glslRun.ts). Points known to be
 * inside measure negative, far points positive and about their distance, and the examples compile.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { compileFragment, type Val } from './glslRun';

function sdf(type: string, params: Record<string, unknown> = {}) {
  const def = getNodeDefinition(type)!;
  const nd = n(type, 'nd', 0, 0, params);
  const { code } = def.generateGLSL(nd, { p4: 'in_p4' } as never);
  const prog = compileFragment(`${typeof def.glslFunction === 'string' ? def.glslFunction : ''}\nvoid main() {\n${code}\n}`);
  return (q: number[]) => (prog.run({ in_p4: q } as never) as Record<string, Val>).nd_dist as number;
}

describe('4D fractals', () => {
  it('quaternion Mandelbrot: the origin is inside, far points are outside', () => {
    const d = sdf('quatMandelSDF');
    expect(d([0, 0, 0, 0])).toBeLessThan(0);
    const far = d([3, 0, 0, 0]);
    expect(far).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(3);
  });

  it('quaternion Julia: far points are outside and the estimate never exceeds the distance from the origin', () => {
    const d = sdf('quatJuliaSDF');
    for (const q of [[2, 0, 0, 0], [0, 2.5, 0, 0], [1.5, 1.5, 0.5, 0], [0, 0, 0, 3]]) {
      const v = d(q);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(Math.hypot(...q) + 1e-6);
    }
  });

  it('the Quaternion Julia example compiles', () => {
    const g = EXAMPLE_GRAPHS.fourDQuatJulia;
    expect(g).toBeTruthy();
    expect(compileGraph({ nodes: resolveNodeAliases(g.nodes, getNodeDefinition) }).success).toBe(true);
  });
});
