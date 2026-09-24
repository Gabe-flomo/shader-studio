/**
 * Whole graph → publishable subgraph: the Output node becomes the output
 * port, UV/Time sources optionally become input ports, and the result
 * flattens into a function like any group.
 */
import { describe, it, expect } from 'vitest';
import { GROUP_PORT_SENTINEL, type GraphNode } from '../../types/nodeGraph';
import { graphToSubgraph } from '../../nodes/userNodes/graphToSubgraph';
import { flattenSubgraphToFunction } from '../flattenSubgraph';

function graph(): GraphNode[] {
  return [
    { id: 'uv1', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
    { id: 't1', type: 'time', position: { x: 0, y: 0 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
    { id: 'len', type: 'length', position: { x: 0, y: 0 },
      inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv1', outputKey: 'uv' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 't1', outputKey: 'time' } } },
      outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1 } },
    { id: 'f2v', type: 'floatToVec3', position: { x: 0, y: 0 },
      inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'len', outputKey: 'output' } } },
      outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
    { id: 'out', type: 'output', position: { x: 0, y: 0 },
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, outputs: {}, params: {} },
  ];
}

describe('graphToSubgraph', () => {
  it('drops the Output node and makes its source the output port', () => {
    const r = graphToSubgraph(graph(), { exposeUv: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subgraph.nodes.some(n => n.type === 'output')).toBe(false);
    expect(r.subgraph.outputPorts).toEqual([{ key: 'out0', type: 'vec3', label: 'Color', fromNodeId: 'f2v', fromOutputKey: 'rgb' }]);
    expect(r.subgraph.inputPorts).toEqual([]);
    // uv node kept when not exposed
    expect(r.subgraph.nodes.some(n => n.type === 'uv')).toBe(true);
  });

  it('turns UV and Time sources into input ports when asked', () => {
    const r = graphToSubgraph(graph(), { exposeUv: true, exposeTime: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.subgraph.inputPorts.map(p => [p.key, p.type])).toEqual([['in_uv', 'vec2'], ['in_time', 'float']]);
    expect(r.subgraph.nodes.some(n => n.type === 'uv' || n.type === 'time')).toBe(false);
    const len = r.subgraph.nodes.find(n => n.id === 'len')!;
    expect(len.inputs.input.connection).toEqual({ nodeId: GROUP_PORT_SENTINEL, outputKey: 'in_uv' });
    expect(len.inputs.scale.connection).toEqual({ nodeId: GROUP_PORT_SENTINEL, outputKey: 'in_time' });

    // …and the result flattens into a function with those arguments
    const flat = flattenSubgraphToFunction({
      subgraph: r.subgraph, fnName: 'un_whole',
      inputs: [{ key: 'uv', portKey: 'in_uv', type: 'vec2', label: 'UV' }, { key: 'time', portKey: 'in_time', type: 'float', label: 'Time' }],
      outputs: [{ key: 'color', portKey: 'out0', type: 'vec3', label: 'Color' }],
      params: [],
    });
    if (!flat.ok) throw new Error(flat.error);
    expect(flat.functionCode).toMatch(/^vec3 un_whole\(vec2 in_uv, float in_time\)/);
    expect(flat.functionCode).toContain('in_time');
  });

  it('does not mutate the original graph', () => {
    const g = graph();
    const before = JSON.stringify(g);
    graphToSubgraph(g, { exposeUv: true, exposeTime: true });
    expect(JSON.stringify(g)).toBe(before);
  });

  it('refuses a graph with no wired Output', () => {
    const g = graph();
    delete g[4].inputs.color.connection;
    expect(graphToSubgraph(g).ok).toBe(false);
    expect(graphToSubgraph(g.slice(0, 4)).ok).toBe(false);
  });
});
