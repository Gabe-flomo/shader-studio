/**
 * quickPlay.ts — Quick controls (quick.ts) as Play controls: each pin's built node param, found the way the slider's
 * right-click Play menu finds it (the build's node by role, the first of the param names it has), made a Play control.
 * Before the scene is built there is nothing to find: the pins wait, and buildFromBuilder2D attaches them after
 * every Build (Done builds, so Done does too).
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { candidateFor, collectPlayCandidates, type PlayCandidate } from '../play/playControls';
import { addCandidateControl } from '../components/play/layerOps';
import { usePlaySplit } from '../components/play/playSplit';
import type { GraphNode } from '../types/nodeGraph';
import { find2dBuild } from './apply';
import { useSceneBuilder2D } from './store';
import type { QuickPin } from './quick';

/** The node param a pin builds, in the build `sceneId` of `nodes`; null before a Build (or when it builds none). */
export function quickPinParam(nodes: GraphNode[], sceneId: string | null, pin: QuickPin): { nodeId: string; key: string } | null {
  if (!sceneId || !pin.play) return null;
  const n = find2dBuild(nodes, sceneId)?.byRole.get(pin.play.role);
  const key = n ? pin.play.keys.find(k => k in n.params) : undefined;
  return n && key ? { nodeId: n.id, key } : null;
}

/** A pin's Play candidate as the graph is now. */
function candidateOf(pin: QuickPin): PlayCandidate | null {
  const st = useNodeGraphStore.getState();
  const p = quickPinParam(st.nodes, useSceneBuilder2D.getState().targetSceneId, pin);
  return p ? candidateFor(collectPlayCandidates(st.nodes, st.paramBindings), p.nodeId, p.key) ?? null : null;
}

/** Where a pin is: a Play control, waiting for Build, or one that can't be (no node param: change it in the builder). */
export function quickPinStatus(pin: QuickPin): 'play' | 'queued' | 'none' {
  if (!pin.play) return 'none';
  const c = candidateOf(pin);
  if (!c) return 'queued';
  return useNodeGraphStore.getState().play.controls.some(x => x.target === c.target) ? 'play' : 'queued';
}

/** Makes every pin that is built a Play control (the ones already there stay as they are). How many are on Play. */
export function attachQuickControls(pins: readonly QuickPin[] | undefined = useSceneBuilder2D.getState().scene.quick): number {
  let on = 0;
  for (const pin of pins ?? []) {
    const c = pin.play ? candidateOf(pin) : null;
    if (!c) continue;
    useNodeGraphStore.getState().setPlay(p => addCandidateControl(p, c));
    on++;
  }
  return on;
}

/** Opens Play on its Controls page. */
export function openPlayControls(): void {
  usePlaySplit.getState().setRailPage('controls');
  useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 }));
}
