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

  it('double-click on an output removes every wire leaving it, in one undo step, and remembers them', () => {
    // a second wire from the circle, so the output feeds two inputs
    useNodeGraphStore.getState().connectNodes('circ', 'distance', 'circ', 'radius');
    const before = useNodeGraphStore.getState().wireHistory.length;
    const removed = useNodeGraphStore.getState().disconnectOutput('circ', 'distance');
    expect(removed).toBe(2);
    const st = useNodeGraphStore.getState();
    expect(st.nodes.find(n => n.id === 'f2v')!.inputs.input.connection).toBeUndefined();
    expect(st.nodes.find(n => n.id === 'circ')!.inputs.radius.connection).toBeUndefined();
    expect(st.wireHistory.length).toBe(before + 2);
    expect(st.pastWiresFor('f2v', st.nodes).map(w => w.fromNodeId)).toEqual(['circ']);
    expect(useNodeGraphStore.getState().disconnectOutput('circ', 'distance')).toBe(0);
  });

});

describe('palette conversion', () => {
  const pal = (id: string, type: 'palette' | 'stopPalette', params: Record<string, unknown>): GraphNode => node(id, type,
    { value: { type: 'float', label: 'Angle', connection: { nodeId: 't', outputKey: 'time' } }, anim: { type: 'float', label: 'Angle offset' },
      ...(type === 'palette' ? { offset: { type: 'vec3', label: 'Offset' } } : {}) },
    { color: { type: 'vec3', label: 'Color' } }, params);
  const withPalette = (p: GraphNode) => [
    node('t', 'time', {}, { time: { type: 'float', label: 'Time' } }),
    p,
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: p.id, outputKey: 'color' } } }, {}),
  ];

  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: withPalette(pal('p', 'palette', { preset: '1', scale: 2, speed: 0.5, value: 0, anim: 0 })), activeGroupPath: [], activeGroupId: null, wireHistory: [] });
  });

  it('converts a cosine Palette in place: same id, wires in and out kept, colours sampled from its preset', () => {
    expect(useNodeGraphStore.getState().convertPaletteToStops('p', 6)).toBe(true);
    const st = useNodeGraphStore.getState();
    const p = st.nodes.find(n => n.id === 'p')!;
    expect(p.type).toBe('stopPalette');
    expect(p.inputs.value.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(p.inputs.offset).toBeUndefined();
    expect(st.nodes.find(n => n.id === 'out')!.inputs.color.connection).toEqual({ nodeId: 'p', outputKey: 'color' });
    expect(p.params).toMatchObject({ stops: '6', wrap: 'loop', scale: 2, speed: 0.5 });
    // IQ Rainbow (preset 1) at t = 0: red channel 0.5 + 0.5·cos(0) = 1
    expect((p.params.color0 as number[])[0]).toBeCloseTo(1, 5);
  });

  it('pasting onto a cosine Palette converts it and takes the colours in one undo step', () => {
    const used = useNodeGraphStore.getState().setPaletteStops('p', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(used).toBe(3);
    let p = useNodeGraphStore.getState().nodes.find(n => n.id === 'p')!;
    expect(p.type).toBe('stopPalette');
    expect(p.params).toMatchObject({ stops: '3', color0: [1, 0, 0], color2: [0, 0, 1] });
    useNodeGraphStore.getState().undo();
    p = useNodeGraphStore.getState().nodes.find(n => n.id === 'p')!;
    expect(p.type).toBe('palette');
  });

  it('thins a palette longer than 32 stops evenly, keeping both ends', () => {
    useNodeGraphStore.setState({ nodes: withPalette(pal('p', 'stopPalette', { stops: '5' })) });
    const many = Array.from({ length: 40 }, (_, i) => [i / 39, 0, 0] as [number, number, number]);
    expect(useNodeGraphStore.getState().setPaletteStops('p', many)).toBe(32);
    const p = useNodeGraphStore.getState().nodes.find(n => n.id === 'p')!;
    expect(p.params.stops).toBe('32');
    expect((p.params.color0 as number[])[0]).toBe(0);
    expect((p.params.color31 as number[])[0]).toBe(1);
  });

  it('Auto conversion of a palette that repeats every 2 spans both halves and halves Scale and Speed', () => {
    // preset 3 = IQ Lemon (blue channel at frequency 0.5)
    useNodeGraphStore.setState({ nodes: withPalette(pal('p', 'palette', { preset: '3', scale: 1, speed: 0.4, value: 0, anim: 0 })) });
    expect(useNodeGraphStore.getState().convertPaletteToStops('p', 'auto')).toBe(true);
    const p = useNodeGraphStore.getState().nodes.find(n => n.id === 'p')!;
    expect(p.params).toMatchObject({ scale: 0.5, speed: 0.2, wrap: 'loop', blend: 'curve' });
    expect(Number(p.params.stops)).toBeGreaterThan(8);
  });
});

