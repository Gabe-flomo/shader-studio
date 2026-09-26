import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const graph = (params: Record<string, unknown>, withPoint = true): GraphNode[] => [
  { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
  { id: 'mouse', type: 'mouse', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' }, x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } }, params: {} },
  {
    id: 'gp', type: 'gridPattern', position: { x: 0, y: 0 },
    inputs: {
      uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } },
      ...(withPoint ? { affectPos: { type: 'vec2', label: 'Affect Pos', connection: { nodeId: 'mouse', outputKey: 'uv' } } } : {}),
    },
    outputs: { color: { type: 'vec3', label: 'Color' }, mask: { type: 'float', label: 'Mask' }, distance: { type: 'float', label: 'Distance' }, influence: { type: 'float', label: 'Influence' }, cellUV: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' }, cellCenter: { type: 'vec2', label: 'Cell Center' }, placed: { type: 'float', label: 'Placed' } },
    params,
  },
  { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gp', outputKey: 'color' } } }, outputs: {}, params: {} },
];

describe('Grid Pattern node', () => {
  it('compiles with every shape, pattern and affect mode', () => {
    for (const shape of ['circle', 'box', 'diamond', 'ring', 'cross', 'triangle'])
      for (const pattern of ['all', 'columns', 'rows', 'checker', 'diagonal', 'random'])
        for (const affect of ['none', 'grow', 'shrink', 'pull', 'push', 'hide', 'spin']) {
          const r = compileGraph({ nodes: graph({ shape, pattern, affect, columns: 8, size: 0.3 }) });
          expect(r.errors ?? [], `${shape}/${pattern}/${affect}`).toEqual([]);
          expect(r.fragmentShader).toContain('gpShape(');
          expect(r.fragmentShader).toContain('gpPlaced(');
        }
  });
  it('uses the same cell size as the Grid node so the two line up', () => {
    const r = compileGraph({ nodes: graph({ columns: 12 }) });
    expect(r.fragmentShader).toMatch(/(\w+)_cell = \1_asp \/ 12\.0;/);
  });
  it('measures influence from the centre when no point is wired, and from the point when one is', () => {
    const none = compileGraph({ nodes: graph({ affect: 'grow' }, false) }).fragmentShader;
    expect(none).toMatch(/_inf {2}= smoothstep\([^\n]*length\(vec2\(0\.0\) - /);
    const some = compileGraph({ nodes: graph({ affect: 'pull' }) }).fragmentShader;
    expect(some).toMatch(/_inf {2}= smoothstep\([^\n]*length\(\w+_uv - /);
    expect(some).toMatch(/(\w+)_q -= \1_dir/);
  });
});
