/**
 * presetActions.ts — a Combine preset into the draft (the presets strip): its products made, the stack replaced. The
 * products the last preset made in this window go first, so trying one after another doesn't pile them up; your own
 * products stay.
 */
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { useCombine } from './store';
import { removeCombine } from './apply';
import { presetGraph } from './presets';

let madeByPreset: string[] = [];

export function applyCombinePreset(key: string): boolean {
  const c = useCombine.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  let nodes = useNodeGraphStore.getState().nodes;
  if (c.anchorId) nodes = removeCombine(nodes, c.anchorId);
  if (madeByPreset.length) {
    const gone = new Set(madeByPreset);
    nodes = nodes.filter(n => !gone.has(n.id)).map(n => {
      const stale = Object.entries(n.inputs).filter(([, s]) => s.connection && gone.has(s.connection.nodeId));
      if (!stale.length) return n;
      const inputs = { ...n.inputs };
      for (const [k, s] of stale) inputs[k] = { ...s, connection: undefined };
      return { ...n, inputs };
    });
  }
  const made = presetGraph(key, nodes, () => useNodeGraphStore.getState().newNodeId());
  if (!made) return false;
  madeByPreset = made.made;
  undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(made.nodes));
  c.replace(made.spec);
  c.setAnchor(null);
  c.setIsolate(null);
  c.setPicker(null);
  c.select(made.spec.layers[made.spec.layers.length - 1]?.id ?? null);
  return true;
}

/** A new window: the last preset's products are yours now. */
export function forgetPresetProducts(): void { madeByPreset = []; }
