/**
 * Rebuild: a forced compile runs even when nothing changed, starts from scratch (per-node
 * definitions and user nodes' compiled definitions are built again), clears the error board,
 * asks every registered preview to reset its GPU state, and keeps the graph and Play setup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

// The store reads localStorage while its module loads, so the stub has to exist before the import.
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
vi.mock('../../compiler/graphCompiler', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../compiler/graphCompiler')>();
  return { ...m, compileGraph: vi.fn(m.compileGraph) };
});
vi.mock('../../nodes/userNodes/userNodeRegistry', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../nodes/userNodes/userNodeRegistry')>();
  return { ...m, recompileUserNodes: vi.fn(m.recompileUserNodes) };
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { recompileUserNodes } from '../../nodes/userNodes/userNodeRegistry';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { describeReset, onRebuild, rebuildHandlerCount } from '../../lib/rebuild';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

const graph = (): GraphNode[] => [
  node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
  node('f2v', 'floatToVec3', { input: { type: 'float', label: 'Float' } }, { rgb: { type: 'vec3', label: 'Color' } }),
  node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
];

describe('rebuild', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().replaceGraph(graph());
    vi.mocked(compileGraph).mockClear();
    vi.mocked(recompileUserNodes).mockClear();
  });

  it('compiles again even when the source is unchanged', async () => {
    const before = useNodeGraphStore.getState().fragmentShader;
    await useNodeGraphStore.getState().rebuild();
    expect(compileGraph).toHaveBeenCalledTimes(1);
    expect(useNodeGraphStore.getState().fragmentShader).toBe(before);
  });

  it('writes every compile output again, so previews see fresh uniform objects', async () => {
    const s0 = useNodeGraphStore.getState();
    await s0.rebuild();
    const s1 = useNodeGraphStore.getState();
    expect(s1.paramUniforms).not.toBe(s0.paramUniforms);
    expect(s1.paramUniforms).toEqual(s0.paramUniforms);
    expect(s1.particleSystems).not.toBe(s0.particleSystems);
    expect(s1.rebuildEpoch).toBe(s0.rebuildEpoch + 1);
  });

  it('a plain compile keeps the caches; a forced one builds them again', () => {
    const n = useNodeGraphStore.getState().nodes[1];
    const def = getNodeDefinitionFor(n);
    useNodeGraphStore.getState().compile();
    expect(recompileUserNodes).not.toHaveBeenCalled();
    expect(getNodeDefinitionFor(n)).toBe(def);
    useNodeGraphStore.getState().compile({ force: true });
    expect(recompileUserNodes).toHaveBeenCalledTimes(1);
    // The per-node definition is worked out again, to the same result.
    const again = getNodeDefinitionFor(n);
    expect(again).toEqual(def);
  });

  it('clears the error board and the "last working version" state, then reports what is left', async () => {
    useNodeGraphStore.setState({ glslErrors: ['ERROR: 0:1: stale'], glslErrorSource: 'x', previewStale: true });
    const result = await useNodeGraphStore.getState().rebuild();
    const s = useNodeGraphStore.getState();
    expect(s.glslErrors).toEqual([]);
    expect(s.glslErrorSource).toBeNull();
    expect(s.previewStale).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('asks every preview to reset its GPU state and collects what they reset', async () => {
    const a = vi.fn(() => ['shader program', 'render targets']);
    const b = vi.fn(async () => ['render targets', 'the side-by-side previews']);
    const offA = onRebuild(a), offB = onRebuild(b);
    try {
      const { reset } = await useNodeGraphStore.getState().rebuild();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(reset).toEqual(['shader program', 'render targets', 'the side-by-side previews']);
    } finally { offA(); offB(); }
    expect(rebuildHandlerCount()).toBe(0);
  });

  it('a preview that fails to reset does not stop the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offA = onRebuild(() => { throw new Error('boom'); });
    const offB = onRebuild(() => ['shader program']);
    try {
      const { reset } = await useNodeGraphStore.getState().rebuild();
      expect(reset).toEqual(['shader program']);
    } finally { offA(); offB(); err.mockRestore(); }
  });

  it('keeps the graph, the Play setup and the selection', async () => {
    useNodeGraphStore.setState(st => ({ play: { ...st.play, layers: [] }, selectedNodeId: 'f2v' }));
    const s0 = useNodeGraphStore.getState();
    await s0.rebuild();
    const s1 = useNodeGraphStore.getState();
    expect(s1.nodes).toBe(s0.nodes);
    expect(s1.play).toBe(s0.play);
    expect(s1.selectedNodeId).toBe('f2v');
  });

  it('says what was reset in one plain list', () => {
    expect(describeReset(['the shader program', 'render targets', 'feedback history'])).toBe('the shader program, render targets and feedback history');
    expect(describeReset([])).toBe('the shader program');
  });
});
