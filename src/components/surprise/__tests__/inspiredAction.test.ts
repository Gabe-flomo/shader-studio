/**
 * The Do bar's Surprise in the store: it replaces the graph (only its nodes and one Output remain), one
 * undo step brings the old graph back exactly, and the user's saved graphs and GLSL join the pool.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore, undoManager } from '../../../store/useNodeGraphStore';
import { scratchGraph } from '../../../suggestions/doScratch';
import { inspiredSurprise, userSources } from '../inspiredAction';
import { GLSL_KEY } from '../../../files/inventory';

describe('Surprise replaces the graph, one undo step', () => {
  it('after a surprise only its nodes (and one Output) exist; undo restores the graph exactly', async () => {
    undoManager.clear();
    const before = scratchGraph('glow');
    useNodeGraphStore.setState({ nodes: before, activeGroupPath: [], activeGroupId: null, scratch: null });
    const snapshot = JSON.stringify(useNodeGraphStore.getState().nodes);
    const res = await inspiredSurprise({ seed: 31337 });
    expect(res).toBeTruthy();
    const now = useNodeGraphStore.getState().nodes;
    expect(now.map(n => n.id).sort()).toEqual(res!.nodes.map(n => n.id).sort());
    expect(now.some(n => before.some(b => b.id === n.id))).toBe(false);
    expect(now.filter(n => n.type === 'output')).toHaveLength(1);
    expect(res!.seed).toBeGreaterThan(0);
    useNodeGraphStore.getState().undo();
    expect(JSON.stringify(useNodeGraphStore.getState().nodes)).toBe(snapshot);
  }, 30_000);

  it('the same seed makes the same picture again (same pool)', async () => {
    const a = await inspiredSurprise({ seed: 4242 });
    const b = await inspiredSurprise({ seed: 4242 });
    expect(a!.stages).toEqual(b!.stages);
    expect(a!.inspirations.map(i => i.id)).toEqual(b!.inspirations.map(i => i.id));
  }, 30_000);

  it('reads saved graphs, GLSL page shaders and Custom Function presets from storage', () => {
    const data: Record<string, string> = {
      'shader-studio:My glow': JSON.stringify({ nodes: scratchGraph('glow') }),
      [GLSL_KEY]: JSON.stringify([{ id: 's1', name: 'Blobs', code: 'float blob(vec2 p) { return length(p) - 0.3; }' }]),
      'shader-studio:cfp:ring': JSON.stringify({ label: 'Ring', body: 'return ring(uv);', glslFunctions: 'float ring(vec2 p) { return abs(length(p) - 0.5); }' }),
    };
    const keys = Object.keys(data);
    const got = userSources({ length: keys.length, key: i => keys[i] ?? null, getItem: k => data[k] ?? null });
    expect(got.map(s => s.id).sort()).toEqual(['preset:shader-studio:cfp:ring', 'saved:My glow', 'shader:s1']);
  });
});
