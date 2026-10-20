/**
 * The pass lock (store/passLock.ts): at 10 passes every way of adding one is refused, with a toast that
 * offers Show passes; removing, undo and loading are never refused; the refused action leaves no undo step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { undoManager, useNodeGraphStore } from '../useNodeGraphStore';
import { usePassPanelRequest } from '../passLock';
import { useToastStore } from '../../components/ui/toastStore';
import { n } from '../graphBuilder';
import { passBudget } from '../../compiler/passBudget';
import type { GraphNode } from '../../types/nodeGraph';

/** `count` Pass nodes in a chain, plus whatever else, on to the Output. */
function passes(count: number, extra: GraphNode[] = []): GraphNode[] {
  const nodes: GraphNode[] = [n('uv', 'uvn', 0, 0), n('swizzle', 'rgb', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] })];
  let from: [string, string] = ['rgb', 'output'];
  for (let i = 0; i < count; i++) { nodes.push(n('pass', `p${i}`, 0, 0, {}, { color: from })); from = [`p${i}`, 'color']; }
  return [...nodes, ...extra, n('output', 'out', 0, 0, {}, { color: from })];
}

const st = () => useNodeGraphStore.getState();
const used = () => passBudget(st().nodes).used;
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  undoManager.clear();
});

describe('Pass lock', () => {
  it('adding a pass node: allowed up to 10, refused at 10 with a toast that offers Show passes', () => {
    st().replaceGraph(passes(9));
    expect(st().addNode('pass', { x: 0, y: 0 })).toBeTruthy();
    expect(used()).toBe(10);
    const steps = undoManager.canUndo;
    const before = st().nodes;
    st().addNode('pass', { x: 0, y: 0 });
    expect(st().nodes).toBe(before);
    expect(used()).toBe(10);
    // The step the action pushed before it was refused is gone: undo isn't a no-op.
    expect(undoManager.canUndo).toBe(steps);
    const t = lastToast()!;
    expect(t.title).toBe('Locked: this would need 11 passes, and 10 is the most.');
    expect(t.message).toMatch(/^Remove a pass first, or bypass a node that adds passes\./);
    const asked = usePassPanelRequest.getState().n;
    t.action!.onClick();
    expect(usePassPanelRequest.getState().n).toBe(asked + 1);
  });

  it('a node that adds no pass is still added at 10', () => {
    st().replaceGraph(passes(10));
    const id = st().addNode('circleSDF', { x: 0, y: 0 });
    expect(st().nodes.some(x => x.id === id)).toBe(true);
    expect(lastToast()).toBeUndefined();
  });

  it('a built node, a duplicate, and a builder writing the store itself are refused at 10', () => {
    st().replaceGraph(passes(10));
    const before = st().nodes;
    st().addBuiltNode(n('pass', 'x', 0, 0), 'a Pass');
    expect(st().nodes).toBe(before);
    st().duplicateNodes(['p3']);
    expect(st().nodes).toBe(before);
    // Builders (agentBuilder, sceneDraft…) call setState on the store directly.
    useNodeGraphStore.setState({ nodes: [...before, n('opticalFlow', 'of', 0, 0, {}, { texture: ['p0', 'texture'] })] });
    expect(st().nodes).toBe(before);
    expect(used()).toBe(10);
  });

  it('turning a node that opens passes back on is refused past 10; bypassing another unlocks', () => {
    // 8 Passes + a Feedback (texture) = 9; a bypassed Optical Flow would add 2.
    const nodes = passes(8, [
      n('textureFeedback', 'fb', 0, 0, {}, { texture: ['p7', 'texture'] }),
      n('textureInput', 'img', 0, 0), { ...n('opticalFlow', 'of', 0, 0, {}, { texture: ['img', 'texture'] }), bypassed: true },
    ]);
    st().replaceGraph(nodes);
    expect(used()).toBe(9);
    st().toggleBypass('of');
    expect(st().nodes.find(x => x.id === 'of')!.bypassed).toBe(true);
    expect(lastToast()!.title).toBe('Locked: this would need 11 passes, and 10 is the most.');
    st().toggleBypass('fb');
    expect(used()).toBe(8);
    st().toggleBypass('of');
    expect(st().nodes.find(x => x.id === 'of')!.bypassed).toBeFalsy();
    expect(used()).toBe(10);
  });

  it('a setting that opens a pass is refused at 10 (Curve Trace Draw: Beam)', () => {
    const beam = passes(10, [n('curveTrace', 'ct', 0, 0)]);
    st().replaceGraph(beam);
    expect(used()).toBe(10);
    // The same graph with Beam on costs 11.
    expect(passBudget(beam.map(x => (x.id === 'ct' ? { ...x, params: { ...x.params, draw: 'beam' } } : x))).used).toBe(11);
    st().updateNodeParams('ct', { draw: 'beam' });
    expect(st().nodes.find(x => x.id === 'ct')!.params.draw).not.toBe('beam');
    expect(used()).toBe(10);
  });

  it('never refuses loading a graph past the limit, undo, or removing passes from it', () => {
    st().replaceGraph(passes(12));
    expect(used()).toBe(12);
    expect(st().compilationErrors[0]).toMatch(/^This graph needs 12 passes, and 10 is the most/);
    st().removeNode('p11');
    expect(used()).toBe(11);
    st().undo();
    expect(used()).toBe(12);
    expect(lastToast()).toBeUndefined();
  });
});
