/**
 * presetsUi.ts — the app's side of layer sets and rack presets
 * (docs/presets.md): the lists as hooks, a poster of the picture as it is,
 * adding a set to Play (one undo step, notes in a toast), saving a rack as a
 * preset (asking the engine for each plug-in's state first) and adding or
 * applying one. The record work is in play/layerSets.ts and play/rackPresets.ts.
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playOverlay } from '../../play/overlay';
import { LAYER_SETS_CHANGED, LAYER_SETS_KEY, loadLayerSet, loadLayerSets, type LayerSet } from '../../play/layerSets';
import {
  applyRackPreset, loadRackPresets, presetSoundOnMaster, rackPresetFrom, RACK_PRESETS_CHANGED, RACK_PRESETS_KEY, saveRackPreset, type RackPreset,
} from '../../play/rackPresets';
import { aeRack, unitKey } from '../../types/playAudioEngine';
import { audioEngineHost, useEngineSelection } from '../../lib/audioEngineHost';
import { usePluginSettings } from '../../lib/pluginSettings';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { usePlayUi } from './playUi';

const POSTER_W = 384, POSTER_H = 216;

/** A list kept in localStorage, re-read when it changes (this tab's event, another tab's storage event). */
function useList<T>(key: string, event: string, load: () => T[]): T[] {
  const [list, setList] = useState<T[]>(load);
  useEffect(() => {
    const on = () => setList(load());
    const onStorage = (e: StorageEvent) => { if (e.key === key) on(); };
    window.addEventListener(event, on);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(event, on); window.removeEventListener('storage', onStorage); };
  }, [key, event, load]);
  return list;
}
const readSets = () => loadLayerSets();
const readRacks = () => loadRackPresets();
export const useLayerSets = () => useList<LayerSet>(LAYER_SETS_KEY, LAYER_SETS_CHANGED, readSets);
export const useRackPresets = () => useList<RackPreset>(RACK_PRESETS_KEY, RACK_PRESETS_CHANGED, readRacks);

/**
 * The picture as it is now (shader, layers, Finish), as a small JPEG. Taken
 * from the render loop's own copy (the GL canvas keeps no buffer between
 * frames); undefined when nothing has been drawn.
 */
export async function capturePlayPoster(): Promise<string | undefined> {
  const { canvas, release } = playOverlay.acquirePicture();
  try {
    for (let i = 0; i < 3 && !(canvas.width && canvas.height); i++) await new Promise(r => requestAnimationFrame(() => r(null)));
    await new Promise(r => requestAnimationFrame(() => r(null)));
    if (!canvas.width || !canvas.height) return undefined;
    const c = document.createElement('canvas');
    c.width = POSTER_W; c.height = POSTER_H;
    const g = c.getContext('2d');
    if (!g) return undefined;
    g.fillStyle = '#000'; g.fillRect(0, 0, POSTER_W, POSTER_H);
    // Contain: the whole picture, bars where the shapes differ.
    const s = Math.min(POSTER_W / canvas.width, POSTER_H / canvas.height);
    const w = canvas.width * s, h = canvas.height * s;
    g.drawImage(canvas, (POSTER_W - w) / 2, (POSTER_H - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return undefined; } finally { release(); }
}

/** Is a graph ref (a control's `node::param` path, an Audio Input node's id) in the graph open now? */
function graphHas(ref: string): boolean {
  const nodeId = ref.split('::')[0];
  return useNodeGraphStore.getState().nodes.some(n => n.id === nodeId);
}

/** Add a set to Play: after the selected layer (else at the top of the list), one undo step, what didn't come in said. */
export function addLayerSetToPlay(set: LayerSet, opts: { afterSelected?: boolean } = {}): void {
  const selected = opts.afterSelected === false ? '' : usePlayUi.getState().selected;
  const play = useNodeGraphStore.getState().play;
  const after = selected && play.layers.some(l => l.id === selected && l.kind !== 'background') ? selected : undefined;
  let made: ReturnType<typeof loadLayerSet> | null = null;
  useNodeGraphStore.getState().setPlay(p => { made = loadLayerSet(p, set, { after, graphHas }); return made.play; }, { label: `Added the set “${set.name}”` });
  const r = made as ReturnType<typeof loadLayerSet> | null;
  if (!r?.layerIds.length) { toast.error('Nothing to add', { message: r?.notes.join(' ') || 'The set has no layers.' }); return; }
  usePlayUi.getState().select(r.layerIds[0]);
  const linked = set.media.filter(m => m.linked).length;
  const parts = [`${r.layerIds.length} layer${r.layerIds.length === 1 ? '' : 's'} in the folder “${r.play.groups?.find(g => g.id === r.groupId)?.label ?? set.name}”.`];
  if (r.notes.length) parts.push(`Not added: ${r.notes.join('; ')}.`);
  if (linked) parts.push(`${linked} file${linked === 1 ? '' : 's'} come${linked === 1 ? 's' : ''} from a linked folder: Relink… if this computer doesn’t have it.`);
  toast.success(`Added “${set.name}”`, { message: parts.join(' ') });
}

// ── Rack presets ────────────────────────────────────────────────────────────

/** Does this computer have the unit? Only known once the engine listed its plug-ins (desktop). */
function unitCheck(): ((u: Parameters<typeof unitKey>[0]) => boolean) | undefined {
  const units = usePluginSettings.getState().units;
  if (!units) return undefined;
  const have = new Set(units.map(u => u.code));
  return u => have.has(unitKey(u));
}

/** Ask for a name, take each plug-in's state as it is now, and save the rack as a preset. */
export async function saveRackAsPreset(rackId: string): Promise<void> {
  const p = useNodeGraphStore.getState().play;
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack) return;
  const name = (await askText('Save the rack as a preset', { label: 'Name', initial: rack.name, confirmLabel: 'Save' }))?.trim();
  if (!name) return;
  // The whole state of each Audio Unit (what's dialled in its own window), on the desktop.
  const states: Record<string, string> = {};
  for (const s of [rack.instrument, ...rack.effects]) {
    if (s?.kind !== 'au') continue;
    const st = await audioEngineHost.slotState(rackId, s.id).catch(() => null);
    if (st) states[s.id] = st;
  }
  const { preset, left } = rackPresetFrom(useNodeGraphStore.getState().play, rackId, name, states);
  if (!preset) return;
  if (!reportFileResult(saveRackPreset(preset), { failTitle: 'Couldn’t save the preset' })) return;
  toast.success(`Saved “${name}”`, { message: `Presets → Racks in the Files page. ${left.length ? `Not in it (wiring stays with the setup): ${left.join('; ')}.` : 'Add it from Add track → From a preset…'}` });
}

/** Add a rack from a preset, or put the preset's devices on `replace`. One undo step. */
export function applyRackPresetToPlay(preset: RackPreset, replace?: string): void {
  let res: ReturnType<typeof applyRackPreset> | null = null;
  useNodeGraphStore.getState().setPlay(p => { res = applyRackPreset(p, preset, { hasUnit: unitCheck(), replace }); return res.rackId ? res.play : p; }, { label: replace ? `Replaced a rack with “${preset.name}”` : `Added the rack “${preset.name}”` });
  const r = res as ReturnType<typeof applyRackPreset> | null;
  if (!r?.rackId) { toast.error('Couldn’t add the rack', { message: r?.notes.join(' ') }); return; }
  useEngineSelection.getState().select(r.rackId);
  const title = replace ? `“${preset.name}” is on the track` : `Added “${preset.name}”`;
  if (r.missing.length) toast.error(title, { message: r.notes.join('. ') + '.' });
  else toast.success(title, { message: r.notes.length ? `Not added: ${r.notes.join('; ')}.` : 'Its controls are on the Controls tab.' });
}

/** A preset's Sound effects on Finish → Sound's master chain. */
export function presetSoundToMaster(preset: RackPreset): void {
  const next = presetSoundOnMaster(useNodeGraphStore.getState().play, preset);
  if (!next) { toast.info('No Sound effects in it', { message: 'Audio Unit effects run in the engine and have no Finish → Sound version.' }); return; }
  useNodeGraphStore.getState().setPlay(next, { label: `Added “${preset.name}”’s Sound effects` });
  toast.success(`Added “${preset.name}”’s Sound effects`, { message: 'At the end of Finish → Sound’s master chain.' });
}
