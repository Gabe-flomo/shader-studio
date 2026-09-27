/**
 * An imported p5 sketch as a Script layer record: the importer's patch (code,
 * files, assets, mode, p5), the controls its params declare, and their
 * starting values (a slider the sketch made starts where the sketch had it).
 */
import { defaultLayer, SCRIPT_MAIN_FILE, type PlayLayer, type ScriptAsset, type ScriptFile, type ScriptLayer } from '../../../types/playLayers';
import type { PlayRecord } from '../../../types/play';
import { scriptPatch } from './scriptApply';

export interface P5LayerInput {
  label: string;
  code: string;
  files: ScriptFile[];
  assets: ScriptAsset[];
  mode: '2d' | '3d';
}

/** A new Script layer holding an imported sketch. Throws when the code does not compile. */
export function p5LayerRecord(patch: P5LayerInput, startAt: Record<string, number>, id: string): ScriptLayer {
  const base = Object.fromEntries(Object.entries(defaultLayer('script', id, patch.label)).filter(([k]) => !k.startsWith('p_'))) as unknown as ScriptLayer;
  const layer: ScriptLayer = { ...base, label: patch.label, mode: patch.mode, p5: true, clear: false, readPicture: false, paramDefs: [], ...(patch.assets.length ? { assets: patch.assets } : {}) };
  const r = scriptPatch(layer, [{ name: SCRIPT_MAIN_FILE, code: patch.code }, ...patch.files], { startAt });
  if (!r.ok) throw new Error(r.error);
  const out = { ...layer, ...r.patch } as ScriptLayer & Record<string, unknown>;
  if (!out.files) delete out.files;
  return out;
}

/** This sketch in place of a layer's own: its code, files, assets, mode and controls; the layer keeps its place, name and look. */
export function replaceWithP5(l: ScriptLayer, patch: P5LayerInput, startAt: Record<string, number>): ScriptLayer {
  const fresh = p5LayerRecord(patch, startAt, l.id);
  const kept = Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('p_') && !['code', 'files', 'assets', 'paramDefs', 'mode', 'p5', 'clear', 'readPicture', 'kindId'].includes(k)));
  return { ...fresh, ...kept, label: l.label } as ScriptLayer;
}

/** The play with the layer added on top. */
export function addLayerTo(play: PlayRecord, layer: PlayLayer): PlayRecord {
  return { ...play, layers: [...play.layers, layer] };
}
