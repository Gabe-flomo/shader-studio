/**
 * controlLink.ts — "quick link" between two controls (Controls page, ⌘-click):
 * one control's value drives another, the same "Another control" source
 * (playSources.ts, `{ kind: 'control' }`) MapToMenu offers, just reached in
 * two clicks instead of Map… → Your controls → pick. Pure: each takes the
 * record and returns the next one; PlayPage wires it through `update` so
 * it's undoable like any other edit.
 */
import { playId } from './playControls';
import type { PlayMapping, PlayRecord } from '../types/play';

/** The enabled mapping already linking these two controls, in whichever direction it runs. */
export function findControlLink(play: PlayRecord, aId: string, bId: string): PlayMapping | undefined {
  return play.mappings.find(m => m.enabled && m.source.kind === 'control'
    && ((m.controlId === bId && m.source.controlId === aId) || (m.controlId === aId && m.source.controlId === bId)));
}

/**
 * Makes `sourceId`'s value drive `targetId`: a mapping onto `targetId` whose source is
 * "Another control" (`sourceId`), defaulting to the target's own range — the same default
 * `mapSourceTo` (layerOps.ts) uses for a control target. `null` when either id is missing, or
 * they're the same control.
 */
export function linkControls(play: PlayRecord, sourceId: string, targetId: string): { play: PlayRecord; mapping: PlayMapping } | null {
  if (sourceId === targetId) return null;
  const source = play.controls.find(c => c.id === sourceId);
  const target = play.controls.find(c => c.id === targetId);
  if (!source || !target) return null;
  const mapping: PlayMapping = {
    id: playId('map'), controlId: target.id, source: { kind: 'control', controlId: source.id },
    outMin: target.min, outMax: target.max, curve: 'linear', smoothMs: 60, enabled: true,
  };
  return { play: { ...play, mappings: [...play.mappings, mapping] }, mapping };
}
