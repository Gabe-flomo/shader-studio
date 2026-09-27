/**
 * layerKinds — saving a sketch as a layer kind, making layers of it, editing
 * it everywhere at once, and the registry of kinds you have installed.
 *
 * Two places hold kinds:
 *   - the play file (`PlayRecord.layerKinds`): the kinds its layers use, so
 *     the file travels (and exports) with them;
 *   - the registry: kinds installed on this machine. Today that is the ones
 *     you saved (kept in localStorage, so any file's Add layer offers them);
 *     plugin layers (`defineLayer`) will register here too, with their own
 *     `source`. Adding a layer of an installed kind copies its definition
 *     into the file.
 *
 * Everything that changes a record is a pure function of it, so the Layers
 * panel, tests and a future SDK share one implementation.
 */
import { useSyncExternalStore } from 'react';
import { defaultLayer, type PlayLayer, type ScriptLayer } from '../types/playLayers';
import type { PlayRecord } from '../types/play';
import { newLayerKindId, parseLayerKinds, withKindParams, type LayerKindColour, type LayerKindDef, type LayerKindIcon } from '../types/layerKinds';

export type { LayerKindDef } from '../types/layerKinds';

// ── The registry ────────────────────────────────────────────────────────────

/** Where an installed kind came from. `plugin` is for defineLayer later. */
export type LayerKindSource = 'saved' | 'plugin';
export interface RegisteredKind { def: LayerKindDef; source: LayerKindSource }

export interface LayerKindRegistry {
  list(): RegisteredKind[];
  get(id: string): RegisteredKind | undefined;
  /** Add or replace (by id). */
  register(def: LayerKindDef, source: LayerKindSource): void;
  unregister(id: string): void;
  subscribe(fn: () => void): () => void;
}

/**
 * A registry: a list of kinds by id with change listeners, and a hook for
 * persisting it. The app has one (`layerKindRegistry`) backed by
 * localStorage; tests and a plugin host can make their own.
 */
export function createLayerKindRegistry(initial: RegisteredKind[] = [], persist?: (all: RegisteredKind[]) => void): LayerKindRegistry {
  let items = [...initial];
  const listeners = new Set<() => void>();
  const changed = () => { items = [...items].sort((a, b) => a.def.name.localeCompare(b.def.name)); persist?.(items); for (const l of listeners) l(); };
  return {
    list: () => items,
    get: id => items.find(k => k.def.id === id),
    register(def, source) { items = [...items.filter(k => k.def.id !== def.id), { def, source }]; changed(); },
    unregister(id) { const before = items.length; items = items.filter(k => k.def.id !== id); if (items.length !== before) changed(); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

const STORAGE_KEY = 'shader-studio:play:layerKinds';

function loadSaved(): RegisteredKind[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return parseLayerKinds(raw ? JSON.parse(raw) : []).map(def => ({ def, source: 'saved' as const }));
  } catch { return []; }
}

/** The kinds installed on this machine (the ones you saved). */
export const layerKindRegistry = createLayerKindRegistry(loadSaved(), all => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter(k => k.source === 'saved').map(k => k.def))); } catch { /* storage full or blocked: the list still works for this session */ }
});

export function useInstalledKinds(): RegisteredKind[] {
  return useSyncExternalStore(layerKindRegistry.subscribe, layerKindRegistry.list, layerKindRegistry.list);
}

// ── Kinds in a play file ────────────────────────────────────────────────────

export interface KindLook { name: string; hint: string; icon: LayerKindIcon; colour: LayerKindColour }

/** The line under a kind's name in Add layer: its own, or what it is and how many controls it has. */
export function kindHint(hint: string, controls: number): string {
  return hint.trim() || `A sketch you saved as a layer kind · ${controls} control${controls === 1 ? '' : 's'}`;
}

export function kindById(play: PlayRecord, id: string | undefined): LayerKindDef | null {
  return id ? play.layerKinds?.find(k => k.id === id) ?? null : null;
}

/** How many layers in the file are made from the kind. */
export function kindUses(play: PlayRecord, id: string): number {
  return play.layers.filter(l => l.kind === 'script' && l.kindId === id).length;
}

/** What Add layer offers beyond the built-in kinds: the file's kinds, then installed ones the file does not have. */
export function addableKinds(play: PlayRecord, installed: readonly RegisteredKind[]): Array<{ def: LayerKindDef; inFile: boolean }> {
  const inFile = play.layerKinds ?? [];
  const have = new Set(inFile.map(k => k.id));
  return [...inFile.map(def => ({ def, inFile: true })), ...installed.filter(k => !have.has(k.def.id)).map(k => ({ def: k.def, inFile: false }))];
}

/** The file with `kind` in its list (replacing an older copy with the same id). */
function withKind(play: PlayRecord, kind: LayerKindDef): PlayRecord {
  const list = play.layerKinds ?? [];
  const i = list.findIndex(k => k.id === kind.id);
  return { ...play, layerKinds: i < 0 ? [...list, kind] : list.map(k => (k.id === kind.id ? kind : k)) };
}

/** A new layer of a kind: its code, params at their declared values, its canvas settings. */
export function kindLayer(kind: LayerKindDef, id: string, label: string): ScriptLayer {
  const base = defaultLayer('script', id, label) as ScriptLayer & Record<string, unknown>;
  for (const k of Object.keys(base)) if (k.startsWith('p_')) delete base[k];
  return withKindParams({ ...base, mode: kind.mode, code: kind.code, paramDefs: kind.paramDefs.map(d => ({ ...d })), clear: kind.clear, readPicture: kind.readPicture, kindId: kind.id });
}

/** Add a layer of `kind` (copying the kind into the file if it is not there yet). */
export function addKindLayer(play: PlayRecord, kind: LayerKindDef, id: string): PlayRecord {
  const own = kindById(play, kind.id) ?? kind;
  const n = kindUses(play, own.id) + 1;
  return { ...withKind(play, own), layers: [...play.layers, kindLayer(own, id, `${own.name} ${n}`)] };
}

/**
 * Save a Script layer's sketch as a kind: the kind joins the file and the
 * layer becomes the first layer of it. Returns the kind (to install as well).
 */
export function saveLayerAsKind(play: PlayRecord, layerId: string, look: KindLook, id = newLayerKindId(look.name)): { play: PlayRecord; kind: LayerKindDef | null } {
  const l = play.layers.find(x => x.id === layerId);
  if (!l || l.kind !== 'script') return { play, kind: null };
  const kind: LayerKindDef = {
    id, name: look.name.trim() || 'Sketch', hint: look.hint.trim(), icon: look.icon, colour: look.colour,
    mode: l.mode, code: l.code, paramDefs: l.paramDefs.map(d => ({ ...d })), clear: l.clear, readPicture: l.readPicture, version: 1,
  };
  const next = withKind(play, kind);
  // A layer still called "Script 2" takes the kind's name; one you named keeps yours.
  const label = /^Script \d+$/.test(l.label) ? `${kind.name} 1` : l.label;
  return { play: { ...next, layers: next.layers.map(x => (x.id === layerId ? { ...x, label, kindId: id } as PlayLayer : x)) }, kind };
}

/** A new name, hint, icon or colour for a kind (its layers are unchanged). */
export function restyleKind(play: PlayRecord, id: string, look: Partial<KindLook>): { play: PlayRecord; kind: LayerKindDef | null } {
  const k = kindById(play, id);
  if (!k) return { play, kind: null };
  const kind = restyledKind(k, look);
  return { play: withKind(play, kind), kind };
}

/** The kind with a new name, hint, icon or colour (a blank name keeps the old one). */
export function restyledKind(k: LayerKindDef, look: Partial<KindLook>): LayerKindDef {
  return { ...k, ...look, name: (look.name ?? k.name).trim() || k.name, hint: (look.hint ?? k.hint).trim(), version: k.version + 1 };
}

/**
 * Edit the kind: new code (and the params it declares) for the kind and for
 * every layer made from it. Each layer keeps its own values for params it
 * already had; new params start at their declared value.
 */
export function editKind(play: PlayRecord, id: string, code: string, paramDefs: ScriptLayer['paramDefs'], mode?: ScriptLayer['mode']): { play: PlayRecord; kind: LayerKindDef | null } {
  const k = kindById(play, id);
  if (!k) return { play, kind: null };
  const kind: LayerKindDef = { ...k, mode: mode ?? k.mode, code, paramDefs: paramDefs.map(d => ({ ...d })), version: k.version + 1 };
  const next = withKind(play, kind);
  return {
    play: { ...next, layers: next.layers.map(l => (l.kind === 'script' && l.kindId === id ? withKindParams({ ...l, mode: kind.mode, code, paramDefs: paramDefs.map(d => ({ ...d })) }) : l)) },
    kind,
  };
}

/** Edit this layer only: it becomes a plain Script layer with its own copy of the code. The kind stays in the file. */
export function detachLayer(play: PlayRecord, layerId: string): PlayRecord {
  return { ...play, layers: play.layers.map(l => { if (l.id !== layerId || l.kind !== 'script' || !l.kindId) return l; const plain = { ...l }; delete plain.kindId; return plain; }) };
}

/** Take a kind out of the file: its layers become plain Script layers that keep the code. */
export function removeKind(play: PlayRecord, id: string): PlayRecord {
  const rest = (play.layerKinds ?? []).filter(k => k.id !== id);
  const out: PlayRecord = { ...play, layers: play.layers.map(l => { if (l.kind !== 'script' || l.kindId !== id) return l; const plain = { ...l }; delete plain.kindId; return plain; }) };
  if (rest.length) out.layerKinds = rest; else delete out.layerKinds;
  return out;
}

/** A layer of a kind back to the kind's defaults (name, id and visibility stay); null when it is not one. */
export function resetKindLayer(play: PlayRecord, l: PlayLayer): PlayLayer | null {
  if (l.kind !== 'script' || !l.kindId) return null;
  const k = kindById(play, l.kindId);
  return k ? { ...kindLayer(k, l.id, l.label), visible: l.visible } : null;
}
