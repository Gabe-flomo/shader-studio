/** sampleInputs: a code node's inputs traced to what feeds them, with the sample values Explain draws them with. */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { describeInputs } from '../sampleInputs';

const node = (id: string, type: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {}, ...extra,
});

describe('describeInputs', () => {
  it('knows what the common sources give, with their ranges', () => {
    const g: GraphNode[] = [
      node('u', 'uv', { outputs: { uv: { type: 'vec2', label: 'UV' } } }),
      node('time', 'time'),
      node('noise', 'fbm'),
      node('k', 'constant', { params: { value: 0.25 } }),
      node('b', 'exprNode', {
        inputs: {
          uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'u', outputKey: 'uv' } },
          t: { type: 'float', label: 't', connection: { nodeId: 'time', outputKey: 'time' } },
          h: { type: 'float', label: 'h', connection: { nodeId: 'noise', outputKey: 'out' } },
          k: { type: 'float', label: 'k', connection: { nodeId: 'k', outputKey: 'value' } },
          s: { type: 'float', label: 's' },
          z: { type: 'float', label: 'z' },
        },
        params: { inputs: [
          { name: 'uv', type: 'vec2', slider: null }, { name: 't', type: 'float', slider: null }, { name: 'h', type: 'float', slider: null },
          { name: 'k', type: 'float', slider: null }, { name: 's', type: 'float', slider: { min: 0, max: 5 } }, { name: 'z', type: 'float', slider: null },
        ] },
      }),
    ];
    const byName = Object.fromEntries(describeInputs(g, 'b', t => ({ label: { uv: 'UV', time: 'Time', fbm: 'Fractal Noise (FBM)', constant: 'Constant' }[t as string] ?? t })).map(i => [i.name, i]));
    expect(byName.uv.text).toMatch(/^uv: vec2, from a UV node \(vec2\): pixel position, centred/);
    expect(byName.uv.sample).toMatchObject({ value: [0.3, 0.2], range: [-1, 1] });
    expect(byName.t.sample).toMatchObject({ value: 2, range: [0, 10] });
    expect(byName.t.clock).toBe(true);
    expect(byName.h.text).toMatch(/^h: float, from a Fractal Noise \(FBM\) node: smooth noise value, range 0\.\.1/);
    expect(byName.k.sample).toMatchObject({ value: 0.25, range: [0.25, 0.25], fixed: true });
    expect(byName.s.text).toBe('s: float, a slider on the node, range 0..5, now 2.5');
    expect(byName.z.text).toMatch(/not connected/);
  });

  it('never uses a user label, and adds the built-in clock to an Expression Block', () => {
    const g: GraphNode[] = [node('b', 'exprNode', { params: { label: 'Moonlight', inputs: [{ name: 'x', type: 'float', slider: null }] } })];
    const ins = describeInputs(g, 'b');
    expect(ins.map(i => i.name)).toEqual(['x', 't']);
    expect(ins.map(i => i.text).join(' ')).not.toContain('Moonlight');
  });
});
