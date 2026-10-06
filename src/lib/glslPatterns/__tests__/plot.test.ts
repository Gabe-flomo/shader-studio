/**
 * The transfer plot (plot.ts): an expression of one number, sampled on the CPU over a range
 * picked from its literals, with its edges marked.
 */
import { describe, it, expect } from 'vitest';
import { explainExpression, explainLine, transferPlot, needsPicture, type Explanation } from '..';

const ex = (s: string, types: Record<string, string> = { x: 'float', a: 'float' }): Explanation => {
  const r = explainExpression(s, { types: types as never });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const at = (p: NonNullable<ReturnType<typeof transferPlot>>, x: number) => p.points.reduce((b, q) => (Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b))[1];

describe('transfer plots', () => {
  it('the user’s line: 1.0 - step(0.02, a) plots 0…0.1 around the 0.02 edge', () => {
    const r = explainLine('float silent = 1.0 - step(0.02, a)', { types: { a: 'float' } });
    if (!r.ok) throw new Error(r.error);
    const p = transferPlot(r)!;
    expect(p.input).toBe('a');
    expect(p.edges).toEqual([0.02]);
    expect(p.from).toBe(0);
    expect(p.to).toBeCloseTo(0.1);
    expect(at(p, 0.01)).toBe(1);
    expect(at(p, 0.05)).toBe(0);
  });

  const withEdges: Array<[string, number[]]> = [
    ['step(0.5, x)', [0.5]],
    ['smoothstep(0.2, 0.3, x)', [0.2, 0.3]],
    ['smoothstep(0.3, 0.2, x)', [0.2, 0.3]],
    ['clamp(x, 0.0, 1.0)', [0, 1]],
    ['max(x, 0.25)', [0.25]],
    ['step(0.5, x * 2.0)', [0.25]],
    ['1.0 - smoothstep(-0.1, 0.1, x)', [-0.1, 0.1]],
    ['x > 0.7 ? 1.0 : 0.0', [0.7]],
  ];
  it.each(withEdges)('%s: the range includes the edges', (src, edges) => {
    const p = transferPlot(ex(src))!;
    expect(p).not.toBeNull();
    expect(p.edges.length).toBe(edges.length);
    p.edges.forEach((e, i) => expect(e).toBeCloseTo(edges[i]));
    for (const e of edges) {
      expect(p.from).toBeLessThanOrEqual(e);
      expect(p.to).toBeGreaterThan(e);
    }
  });

  it('shapers without edges get a range by what they do', () => {
    expect([transferPlot(ex('sin(x)'))!.from, transferPlot(ex('sin(x)'))!.to]).toEqual([0, 2 * Math.PI]);
    expect(transferPlot(ex('fract(x * 2.0)'))!.to).toBe(3);
    expect(transferPlot(ex('x * 0.5 + 0.5'))!.from).toBe(-1);
    expect(transferPlot(ex('pow(x, 2.0)'))!.to).toBe(1);
  });

  it('spots where y is 0…1 and keeps 0 and 1 in view', () => {
    const p = transferPlot(ex('smoothstep(0.2, 0.3, x)'))!;
    expect(p.yMin).toBeLessThan(0);
    expect(p.yMax).toBeGreaterThan(1);
  });

  it('no plot for space, several inputs, or nothing to vary; those want a picture', () => {
    const space = ex('length(uv) - 0.3', { uv: 'vec2' });
    expect(transferPlot(space)).toBeNull();
    expect(needsPicture(space)).toBe(true);
    const two = ex('mix(a, b, x)', { a: 'float', b: 'float', x: 'float' });
    expect(transferPlot(two)).toBeNull();
    expect(needsPicture(two)).toBe(true);
    const none = ex('1.0 + 2.0', {});
    expect(transferPlot(none)).toBeNull();
    expect(needsPicture(none)).toBe(false);
    expect(needsPicture(ex('sin(x)'))).toBe(false);
  });
});
