/**
 * Wire memory: a wire that is disconnected or replaced is remembered for the
 * session, and a node's context menu can offer it back ("Reconnect …").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

// The store reads localStorage while its module loads, so the stub has to exist before the import.
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

function graph(): GraphNode[] {
  return [
    node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
    node('t', 'time', {}, { time: { type: 'float', label: 'Time' } }),
    node('circ', 'circleSDF',
      { position: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 't', outputKey: 'time' } }, offset: { type: 'vec2', label: 'Center' } },
      { distance: { type: 'float', label: 'Distance' } }, { radius: 0.3 }),
    node('f2v', 'floatToVec3', { input: { type: 'float', label: 'Float', connection: { nodeId: 'circ', outputKey: 'distance' } } }, { rgb: { type: 'vec3', label: 'Color' } }),
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
  ];
}

describe('wire memory', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], activeGroupId: null, wireHistory: [] });
  });

  it('remembers a disconnected wire and offers it on both ends until it is back', () => {
    const s = useNodeGraphStore.getState();
    s.disconnectInput('circ', 'radius');
    const past = useNodeGraphStore.getState().wireHistory;
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ fromNodeId: 't', fromOutputKey: 'time', toNodeId: 'circ', toInputKey: 'radius' });

    const scope = useNodeGraphStore.getState().nodes;
    expect(useNodeGraphStore.getState().pastWiresFor('circ', scope)).toHaveLength(1);
    expect(useNodeGraphStore.getState().pastWiresFor('t', scope)).toHaveLength(1);
    expect(useNodeGraphStore.getState().pastWiresFor('uv', scope)).toHaveLength(0);

    // Reconnecting restores the wire and the offer disappears (the memory itself stays)
    useNodeGraphStore.getState().connectNodes('t', 'time', 'circ', 'radius');
    const after = useNodeGraphStore.getState();
    expect(after.nodes.find(n => n.id === 'circ')!.inputs.radius.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(after.pastWiresFor('circ', after.nodes)).toHaveLength(0);
  });

  it('remembers the wire a new connection replaced, not the new one', () => {
    // Swap the circle's UV source from the UV node to… the Time node (nonsense, but a replacement)
    useNodeGraphStore.getState().connectNodes('t', 'time', 'circ', 'position');
    const st = useNodeGraphStore.getState();
    expect(st.wireHistory).toHaveLength(1);
    expect(st.wireHistory[0]).toMatchObject({ fromNodeId: 'uv', fromOutputKey: 'uv', toNodeId: 'circ', toInputKey: 'position' });
    expect(st.pastWiresFor('circ', st.nodes).map(w => w.fromNodeId)).toEqual(['uv']);
    // Re-connecting the same wire again records nothing new
    useNodeGraphStore.getState().connectNodes('t', 'time', 'circ', 'position');
    expect(useNodeGraphStore.getState().wireHistory).toHaveLength(1);
  });

  it('drops offers whose other end no longer exists and keeps the newest copy of a repeated wire', () => {
    const s = useNodeGraphStore.getState();
    s.disconnectInput('f2v', 'input');
    s.connectNodes('circ', 'distance', 'f2v', 'input');
    s.disconnectInput('f2v', 'input');
    expect(useNodeGraphStore.getState().wireHistory.filter(w => w.toNodeId === 'f2v')).toHaveLength(1);
    // Without the source node in scope there is nothing to reconnect to
    const scopeWithoutCircle = useNodeGraphStore.getState().nodes.filter(n => n.id !== 'circ');
    expect(useNodeGraphStore.getState().pastWiresFor('f2v', scopeWithoutCircle)).toHaveLength(0);
  });
});
