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

  it('Grid Paint: paints a wired distance gated by Placed, or the whole placed cell when only a colour comes in', () => {
    const nodes = (withD: boolean): GraphNode[] => [
      ...graph({ affect: 'grow' }, false).slice(0, 3),
      { id: 'circ', type: 'circleSDF', position: { x: 0, y: 0 }, inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'gp', outputKey: 'cellUV' } }, radius: { type: 'float', label: 'Radius' }, offset: { type: 'vec2', label: 'Offset' } }, outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.3 } },
      { id: 'paint', type: 'gridPaint', position: { x: 0, y: 0 }, inputs: { distance: { type: 'float', label: 'Distance', ...(withD ? { connection: { nodeId: 'circ', outputKey: 'distance' } } : {}) }, color: { type: 'vec3', label: 'Colour' }, placed: { type: 'float', label: 'Placed', connection: { nodeId: 'gp', outputKey: 'placed' } }, background: { type: 'vec3', label: 'Background' } }, outputs: { color: { type: 'vec3', label: 'Color' }, mask: { type: 'float', label: 'Mask' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'paint', outputKey: 'color' } } }, outputs: {}, params: {} },
    ];
    const withShape = compileGraph({ nodes: nodes(true) });
    expect(withShape.errors ?? []).toEqual([]);
    expect(withShape.fragmentShader).toMatch(/(\w+)_mask = \(1\.0 - smoothstep\([^\n]*\)\) \* \w+_on;/);
    const colourOnly = compileGraph({ nodes: nodes(false) });
    expect(colourOnly.errors ?? []).toEqual([]);
    expect(colourOnly.fragmentShader).toMatch(/_mask = \w+_on \+ 0\.0/);
  });
  it('Cell UV carries the affect scale, so an outside shape grows with the built-in one', () => {
    const r = compileGraph({ nodes: graph({ affect: 'grow' }) }).fragmentShader;
    expect(r).toMatch(/(\w+)_sc = 1\.0 \+ \1_inf;/);
    expect(r).toMatch(/(\w+)_rq {3}= vec2\([^\n]*\) \/ \1_sc;/);
  });
});
