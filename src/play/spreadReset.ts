/**
 * spreadReset.ts — a Spread's Reset (docs/spread-control.md): every member's
 * own value goes back to its slider's minimum, as one edit (undoable), and
 * the curve then lays the offsets from there. The card's Reset button calls
 * `resetSpread`; a Reset-mode Spread's signal reaches it through the engine
 * (playEngine.onSpreadReset), wired once by `wireSpreadResets`.
 */
import type { PlayRecord } from '../types/play';
import { parseLayerTarget, parseSpreadTarget } from '../types/play';
import { parseFinishTarget, patchFinishEffect } from '../types/playFinish';
import { parseAudioFxTarget, patchAudioFxEffect } from '../types/playAudioFx';
import { aeRack, aeSlot, parseAuTarget, parseGrainsTarget, patchSlot } from '../types/playAudioEngine';
import { parseActionTarget, parseReaderTarget } from '../types/play';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { playEngine } from '../lib/playEngine';
import { spreadResetValues } from './spreads';
import { targetParts } from './playControls';

/** Numbers into a record's own values (layer properties, Finish and sound effects, Audio Units, Spreads); graph params are returned apart. */
export function writeRecordValues(play: PlayRecord, values: ReadonlyMap<string, number>): { play: PlayRecord; graph: Array<{ nodeId: string; paramKey: string; value: number }> } {
  let p = play;
  const graph: Array<{ nodeId: string; paramKey: string; value: number }> = [];
  for (const [id, value] of values) {
    const c = p.controls.find(x => x.id === id);
    if (!c || !Number.isFinite(value)) continue;
    if (parseReaderTarget(c.target) || parseGrainsTarget(c.target) || parseActionTarget(c.target)) continue;
    const ft = parseFinishTarget(c.target);
    if (ft) { p = { ...p, finish: patchFinishEffect(p.finish, ft.effectId, { [ft.key]: value }) }; continue; }
    const at = parseAudioFxTarget(c.target);
    if (at) { p = { ...p, audioFx: patchAudioFxEffect(p.audioFx, at.chainId, at.effectId, { [at.key]: value }) }; continue; }
    const au = parseAuTarget(c.target);
    if (au) { p = { ...p, audioEngine: patchSlot(p.audioEngine, au.rackId, au.slotId, { params: { ...aeSlot(aeRack(p.audioEngine, au.rackId), au.slotId)?.params, [au.address]: value } }) }; continue; }
    const st = parseSpreadTarget(c.target);
    if (st) { p = { ...p, spreads: (p.spreads ?? []).map(s => (s.id === st.spreadId ? { ...s, [st.key]: value } : s)) }; continue; }
    const lt = parseLayerTarget(c.target);
    if (lt) { p = { ...p, layers: p.layers.map(l => (l.id === lt.layerId ? { ...l, [lt.key]: value } as typeof l : l)) }; continue; }
    const { nodeId, paramKey } = targetParts(c.target);
    graph.push({ nodeId, paramKey, value });
  }
  return { play: p, graph };
}

/** Reset a Spread now: its members' own values to their minimums (one Play edit, plus the graph's sliders). */
export function resetSpread(spreadId: string): void {
  const st = useNodeGraphStore.getState();
  const values = spreadResetValues(st.play, spreadId);
  if (!values.size) return;
  const { graph } = writeRecordValues(st.play, values);
  st.setPlay(p => writeRecordValues(p, values).play);
  for (const g of graph) st.updateNodeParams(g.nodeId, { [g.paramKey]: g.value }, { immediate: true });
}

let wired = false;
/** A Reset-mode Spread's signal resets it (after the frame, never inside the engine's tick). Once per app. */
export function wireSpreadResets(): void {
  if (wired) return;
  wired = true;
  playEngine.onSpreadReset(id => queueMicrotask(() => resetSpread(id)));
}
