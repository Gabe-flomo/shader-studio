/**
 * A lone Shuffle added to a graph compiles: its `a` / `b` params (the alpha and blue slots, 'a4' and
 * 'a3') share their keys with its A and B sockets, and used to be copied in as the sockets' fallback
 * values, a text literal that broke the compile ("1 error": val.map is not a function).
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];

describe('adding a Shuffle on its own', () => {
  it('compiles with no errors, alone and wired to the Output', () => {
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    useNodeGraphStore.getState().replaceGraph(outputOnly());
    const id = useNodeGraphStore.getState().addNode('channelShuffle', { x: 0, y: 0 })!;
    const s = useNodeGraphStore.getState();
    expect(s.compilationErrors).toEqual([]);
    const sh = s.nodes.find(n => n.id === id)!;
    expect(sh.inputs.a.defaultValue).toBeUndefined();
    expect(sh.inputs.b.defaultValue).toBeUndefined();
    const wired = s.nodes.map(n => (n.type === 'output' ? { ...n, inputs: { color: { ...n.inputs.color, connection: { nodeId: id, outputKey: 'color' } } } } : n));
    const r = compileGraph({ nodes: wired });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });

  it('a graph saved with the text fallbacks still compiles', () => {
    const id = useNodeGraphStore.getState().nodes.find(n => n.type === 'channelShuffle')!.id;
    const nodes = useNodeGraphStore.getState().nodes.map(n => {
      if (n.id === id) return { ...n, inputs: { ...n.inputs, a: { ...n.inputs.a, defaultValue: 'a4' as unknown as number }, b: { ...n.inputs.b, defaultValue: 'a3' as unknown as number } } };
      if (n.type === 'output') return { ...n, inputs: { color: { ...n.inputs.color, connection: { nodeId: id, outputKey: 'color' } } } };
      return n;
    });
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });
});
