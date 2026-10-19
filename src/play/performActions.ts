/**
 * performActions.ts — what Perform's bar does to the app (docs/perform-mode.md): write many
 * control values as one undo step (Randomize, Reset), and Panic. The maths is in perform.ts.
 */
import type { PlayControl, PlayRecord } from '../types/play';
import { parseLayerTarget } from '../types/play';
import { endParamBurst, undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { controlExists, readBaseValues, targetParts } from './playControls';
import { writeRecordValues } from './spreadReset';
import { randomizedValues, resetValues } from './perform';
import { playEngine } from '../lib/playEngine';
import { audioEngineHost } from '../lib/audioEngineHost';
import { tape } from '../lib/tape';
import { playSampler } from './drumPads';

/** The controls Perform shows (the ones whose target is still there). */
export function performControls(): PlayControl[] {
  const { nodes, play } = useNodeGraphStore.getState();
  return play.controls.filter(c => controlExists(nodes, c, play));
}

/** Every control's own value now (not a mapping's): numbers and colours. */
export function currentControlValues(): Map<string, number | number[]> {
  const { nodes, play } = useNodeGraphStore.getState();
  return readBaseValues(nodes, play);
}

/**
 * Write several controls' values as ONE undo step named `label` (the graph's params and the
 * Play record together). Returns how many changed.
 */
export function applyControlValues(values: ReadonlyMap<string, number | number[]>, label: string): number {
  if (!values.size) return 0;
  const st = useNodeGraphStore.getState();
  const numbers = new Map<string, number>();
  const colours: Array<{ c: PlayControl; v: number[] }> = [];
  for (const [id, v] of values) {
    if (typeof v === 'number') { numbers.set(id, v); continue; }
    const c = st.play.controls.find(x => x.id === id);
    if (c) colours.push({ c, v });
  }
  let { play, graph } = writeRecordValues(st.play, numbers) as { play: PlayRecord; graph: Array<{ nodeId: string; paramKey: string; value: number | number[] }> };
  for (const { c, v } of colours) {
    const lt = parseLayerTarget(c.target);
    if (lt) { play = { ...play, layers: play.layers.map(l => (l.id === lt.layerId ? { ...l, [lt.key]: v } as typeof l : l)) }; continue; }
    const { nodeId, paramKey } = targetParts(c.target);
    graph = [...graph, { nodeId, paramKey, value: v }];
  }
  if (play === st.play && graph.length === 0) return 0;
  undoManager.push(st.nodes, { label }, st.play);
  undoManager.quietly(() => {
    if (play !== st.play) st.setPlay(play, false);
    const byNode = new Map<string, Record<string, unknown>>();
    for (const g of graph) byNode.set(g.nodeId, { ...byNode.get(g.nodeId), [g.paramKey]: g.value });
    for (const [nodeId, params] of byNode) useNodeGraphStore.getState().updateNodeParams(nodeId, params, { immediate: true });
  });
  // The next slider drag is its own step, not part of this one.
  endParamBurst();
  return values.size;
}

/** Randomize: every control moves by up to `strength` of its range, as one undo step. */
export function randomizeControls(strength: number, rand: () => number = Math.random): number {
  return applyControlValues(randomizedValues(performControls(), currentControlValues(), strength, rand), 'Randomized the controls');
}

/** Reset: every control back to its home value (Perform's opening values), as one undo step. */
export function resetControls(home: ReadonlyMap<string, number | number[]>): number {
  return applyControlValues(resetValues(performControls(), home, currentControlValues()), 'Reset the controls');
}

/**
 * Panic: stop all sound and let go of momentary things. The tape stops, every Sound rack gets
 * all notes off, Sampler pads stop, held keys / pads / clicks are released and Look actions let
 * go. Controls keep their values (Reset is for those).
 */
export function panic(): void {
  tape.stop();
  audioEngineHost.panic();
  for (const l of useNodeGraphStore.getState().play.layers) if (l.kind === 'sampler') playSampler.stopAll(l.id);
  playEngine.releaseAll();
}
