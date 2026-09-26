/**
 * Scratch graphs: the Convert page shows a graph-to-be on the real canvas by
 * swapping it into the store, and the user's graph must come back untouched
 * (nodes, play setup, saved-graph identity, dirty flag) unless it's committed.
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

const mine = (): GraphNode[] => [
  node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
  node('f2v', 'floatToVec3', { input: { type: 'float', label: 'Float' } }, { rgb: { type: 'vec3', label: 'Color' } }),
  node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
];
const candidate = (): GraphNode[] => [
  node('t', 'time', {}, { time: { type: 'float', label: 'Time' } }),
  node('out2', 'output', { color: { type: 'vec3', label: 'Color' } }, {}),
];

describe('scratch graph', () => {
  beforeEach(() => {
    const st = useNodeGraphStore.getState();
    st.endScratch(false);
    st.replaceGraph(mine());
    useNodeGraphStore.setState({ currentGraph: { name: 'Mine', version: 2, latest: true }, graphDirty: false, selectedNodeId: 'f2v' });
  });

  it('shows the candidate and puts the user’s graph back on leave, dirty flag included', () => {
    const st = useNodeGraphStore.getState();
    st.setScratchNodes(candidate());
    let s = useNodeGraphStore.getState();
    expect(s.scratch).not.toBeNull();
    expect(s.nodes.map(n => n.id)).toEqual(['t', 'out2']);
    expect(s.selectedNodeId).toBeNull();

    st.setScratchNodes([]); // an unconvertible shader: an empty canvas, still a scratch
    expect(useNodeGraphStore.getState().nodes).toEqual([]);

    st.endScratch(false);
    s = useNodeGraphStore.getState();
    expect(s.scratch).toBeNull();
    expect(s.nodes.map(n => n.id)).toEqual(['uv', 'f2v', 'out']);
    expect(s.currentGraph).toEqual({ name: 'Mine', version: 2, latest: true });
    expect(s.graphDirty).toBe(false);
    expect(s.selectedNodeId).toBe('f2v');
  });

  it('keeps the candidate as the real graph on commit: unsaved, and undo brings the old one back', () => {
    const st = useNodeGraphStore.getState();
    st.setScratchNodes(candidate());
    st.endScratch(true);
    let s = useNodeGraphStore.getState();
    expect(s.scratch).toBeNull();
    expect(s.nodes.map(n => n.id)).toEqual(['t', 'out2']);
    expect(s.currentGraph).toBeNull();
    expect(s.graphDirty).toBe(true);
    st.undo();
    s = useNodeGraphStore.getState();
    expect(s.nodes.map(n => n.id)).toEqual(['uv', 'f2v', 'out']);
  });

  it('sits out undo and redo while a scratch is open', () => {
    const st = useNodeGraphStore.getState();
    st.setScratchNodes(candidate());
    st.undo();
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['t', 'out2']);
    st.redo();
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['t', 'out2']);
    st.endScratch(false);
  });

  it('ending a scratch that was never begun does nothing', () => {
    const before = useNodeGraphStore.getState().nodes;
    useNodeGraphStore.getState().endScratch(false);
    useNodeGraphStore.getState().endScratch(true);
    expect(useNodeGraphStore.getState().nodes).toBe(before);
  });
});
