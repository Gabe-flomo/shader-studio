/**
 * audioSync.ts — songs play only while something in the open graph owns them.
 *
 * The audio engine keys each song by its owner: an Audio Input node's id, or
 * `layer:<id>` for a Play audio layer. Owners go away without the engine
 * hearing about it (a deleted layer; on phones the node card that would stop
 * it isn't shown), and ids repeat between graphs (node_3, "bars"), so a song
 * could keep playing into the next graph. Here: when a different graph is
 * loaded every song stops and is released; when a node or audio layer is
 * deleted, its song does.
 */
import { audioEngine } from './audioEngine';
import { layerAudio } from './layerAudio';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';

/** Engine keys the graph still owns: its Audio Input nodes (groups included) and its audio layers. */
export function audioOwners(nodes: readonly GraphNode[], play: PlayRecord): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly GraphNode[]) => {
    for (const n of list) {
      if (n.type === 'audioInput') out.add(n.id);
      const sub = n.params?.subgraph as SubgraphData | undefined;
      if (sub?.nodes) walk(sub.nodes);
    }
  };
  walk(nodes);
  for (const l of play.layers) if (l.kind === 'audio') out.add(`layer:${l.id}`);
  return out;
}

function release(key: string): void {
  if (key.startsWith('layer:')) layerAudio.remove(key.slice('layer:'.length));
  else audioEngine.removeAudio(key);
}

/** Start watching the graph. Returns a stop function. */
export function startAudioSync(): () => void {
  let s = useNodeGraphStore.getState();
  let epoch = s.graphEpoch, nodes = s.nodes, play = s.play;
  return useNodeGraphStore.subscribe(state => {
    if (state.graphEpoch !== epoch) {
      epoch = state.graphEpoch; nodes = state.nodes; play = state.play;
      for (const k of audioEngine.loadedNodeIds()) release(k);
      return;
    }
    if (state.nodes === nodes && state.play === play) return;
    nodes = state.nodes; play = state.play;
    const owned = audioOwners(nodes, play);
    for (const k of audioEngine.loadedNodeIds()) if (!owned.has(k)) release(k);
  });
}
