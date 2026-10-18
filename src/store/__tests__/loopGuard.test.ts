/**
 * The store's loop guard (compiler/graphLoops.ts): connectNodes refuses a wire that would make a
 * loop, with a notice naming it and, when it fits, "Use last frame's instead"; a graph that already
 * has one compiles to a named error whose fix buttons select the loop and remove its closing wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { useToastStore } from '../../components/ui/toastStore';
import { densityLoopGraph } from '../../compiler/__tests__/fixtures/densityLoopGraph';
import { n } from '../graphBuilder';

const st = () => useNodeGraphStore.getState();
const wireOf = (id: string, key: string) => st().nodes.find(x => x.id === id)?.inputs[key]?.connection;

describe('loop guard', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useNodeGraphStore.setState({ nodes: densityLoopGraph({ loop: false }), activeGroupPath: [], activeGroupId: null, wireHistory: [], selectedNodeIds: [], selectedNodeId: null });
    st().compile();
  });

  it('refuses Stops Palette → Draw Agents · Over and says which loop, leaving the graph as it was', () => {
    const before = st().nodes;
    expect(st().connectNodes('node_12', 'color', 'node_13', 'over')).toBe(false);
    expect(st().nodes).toBe(before);
    expect(wireOf('node_13', 'over')).toBeUndefined();
    const t = useToastStore.getState().toasts.at(-1)!;
    expect(t.title).toBe('That would make a loop: Draw Agents → Stops Palette → Draw Agents');
    expect(t.message).toContain('Palette by density');
    expect(t.action?.label).toBe('Use last frame’s instead');
    expect(st().compilationErrors).toEqual([]);
  });

  it('"Use last frame\'s instead" routes it through a Pass\'s Previous, and that compiles', () => {
    st().connectNodes('node_12', 'color', 'node_13', 'over');
    useToastStore.getState().toasts.at(-1)!.action!.onClick();
    const pass = st().nodes.find(x => x.type === 'pass')!;
    const sample = st().nodes.find(x => x.type === 'sampleTexture')!;
    expect(pass.inputs.color.connection).toEqual({ nodeId: 'node_12', outputKey: 'color' });
    expect(sample.inputs.texture.connection).toEqual({ nodeId: pass.id, outputKey: 'previous' });
    expect(wireOf('node_13', 'over')).toEqual({ nodeId: sample.id, outputKey: 'color' });
    expect(st().compilationErrors).toEqual([]);
    expect(st().graphLoop).toBeNull();
  });

  it('still makes ordinary wires, and a Pass\'s Previous may close a loop', () => {
    expect(st().connectNodes('node_11', 'amount', 'node_12', 'anim')).toBe(true);
    expect(wireOf('node_12', 'anim')).toEqual({ nodeId: 'node_11', outputKey: 'amount' });
    useNodeGraphStore.setState({
      nodes: [
        n('sampleTexture', 'echo', 0, 0),
        n('pass', 'buf', 400, 0, {}, { color: ['echo', 'color'] }),
        n('output', 'out', 800, 0, {}, { color: ['buf', 'color'] }),
      ],
    });
    expect(st().connectNodes('buf', 'previous', 'echo', 'texture')).toBe(true);
    expect(st().compilationErrors).toEqual([]);
    // Its Texture (this frame's picture) would be a loop through the Pass.
    expect(st().connectNodes('buf', 'texture', 'echo', 'texture')).toBe(false);
    expect(wireOf('echo', 'texture')).toEqual({ nodeId: 'buf', outputKey: 'previous' });
  });

  it('a loaded graph with a loop compiles to the named error; Select the loop and Remove the wire fix it', () => {
    useNodeGraphStore.setState({ nodes: densityLoopGraph() });
    expect(() => st().compile()).not.toThrow();
    expect(st().compilationErrors[0]).toContain('Draw Agents → Stops Palette → Draw Agents');
    expect(st().graphLoop?.closing).toMatchObject({ toNodeId: 'node_13', toInputKey: 'over' });

    st().selectLoop();
    expect([...st().selectedNodeIds].sort()).toEqual(['node_12', 'node_13']);

    st().breakLoop();
    expect(wireOf('node_13', 'over')).toBeUndefined();
    expect(wireOf('node_12', 'value')).toEqual({ nodeId: 'node_13', outputKey: 'density' });
    expect(st().compilationErrors).toEqual([]);
    expect(st().graphLoop).toBeNull();
  });
});
