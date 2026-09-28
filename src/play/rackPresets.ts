/**
 * rackPresets.ts — rack presets (docs/presets.md): an Audio engine rack as a
 * reusable piece: its instrument (an Audio Unit with its whole state, the
 * sample player's zones, or the Granulator's sample and settings), its
 * effects in order with their state and on/off, the rack controls picked with
 * Configure (≤ 8 a slot) and their values, a Granulator's Sound effects, the
 * Listener's place, its MIDI input and channel, volume and colour.
 *
 * The boundary rule: a rack is a component, not a complete thing, so no
 * wiring travels with it: no mappings onto its controls, no tape, no
 * "Grains from" a layer, no send from a layer's sound, no drum pad layer it
 * follows. Those belong to the setup (a layer set carries wiring; a rack
 * preset doesn't).
 *
 * Loading one adds a rack ("Add track → From a preset…") or replaces a
 * rack's instrument and effects ("Replace with preset…"). An Audio Unit this
 * computer doesn't have is left out and named; the rest loads.
 *
 * Stored like drum kits: one list in localStorage (`shader-studio:rack-presets`),
 * shown on the Files page under Presets → Racks. Pure over a KV.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import type { PlayControl, PlayRecord } from '../types/play';
import {
  AE_EFFECTS_MAX, AE_INST, AE_RACKS_MAX, aeRack, aeSlotName, auTarget, newRack, parseAudioEngine, parseAuTarget, parseGrainsTarget, unitKey,
  type AeRack, type AeSlot, type AeUnitRef, type PlayAudioEngine,
} from '../types/playAudioEngine';
import { RACK_CONTROLS_MAX } from '../types/playArrangement';
import { audioFxId, MASTER_CHAIN, parseAudioFx, rackChainId, type AudioFxChain, type PlayAudioFx } from '../types/playAudioFx';
import { withEngine } from '../components/play/engine/engineOps';
import { engineReaderInput, engineRackOfInput } from '../lib/engineSound';
import { setReaderInput } from './readerControls';
import { rackControlGroup } from './rackControls';
import { playId } from './playControls';

export const RACK_PRESETS_KEY = 'shader-studio:rack-presets';
export const RACK_PRESETS_CHANGED = 'rack-presets-changed';

/** A rack control in a preset: which slot (`inst` or an effect's id in the preset), which parameter, and how its Play control looks. */
export interface RackPresetControl { slot: string; address: string; label: string; min: number; max: number; step?: number }

export interface RackPreset {
  id: string;
  name: string;
  savedAt: number;
  note?: string;
  /** The rack, without its wiring (see the file's comment). Its values are in its slots' `params`. */
  rack: AeRack;
  controls: RackPresetControl[];
  /** A Granulator's Sound effects (its `rack:<id>` chain, Finish → Sound). */
  soundFx?: AudioFxChain;
  /** The Listener sat on this rack, after `at` effects (absent: after the chain). */
  listener?: { at?: number };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const q = (s: string) => `“${s}”`;

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * A rack as a preset (not yet saved), and what was left out because it is
 * wiring. `states`: slot id → the plug-in's whole state as it is now (the
 * app asks the engine; absent keeps what the record has).
 */
export function rackPresetFrom(p: PlayRecord, rackId: string, name: string, states: Record<string, string> = {}, id = newPresetId()): { preset: RackPreset | null; left: string[] } {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack) return { preset: null, left: [] };
  const left: string[] = [];
  const slot = (s: AeSlot | null): AeSlot | null => {
    if (!s) return null;
    const out = clone(s);
    if (states[s.id]) out.state = states[s.id];
    if (out.from) { delete out.from; left.push('Grains from a layer (it names the setup’s layers)'); }
    return out;
  };
  const r: AeRack = {
    id: 'preset', name: rack.name, instrument: slot(rack.instrument), effects: rack.effects.map(e => slot(e)!),
    keyboard: false, midi: rack.midi, channel: rack.channel, volume: rack.volume, mute: false,
    ...(rack.color ? { color: rack.color } : {}),
    ...(rack.source === MASTER_CHAIN ? { source: rack.source } : {}),
  };
  if (rack.pads) left.push('the drum pad layer it follows');
  if (rack.source && rack.source !== MASTER_CHAIN) left.push('the layer sound sent through it');
  // Rack controls, with their values (the slots' params keep them).
  const controls: RackPresetControl[] = [];
  for (const s of [rack.instrument, ...rack.effects]) {
    if (!s) continue;
    for (const a of s.controls ?? []) {
      const c = p.controls.find(x => x.target === auTarget(rack.id, s.id, a));
      if (c) controls.push({ slot: s.id, address: a, label: c.label, min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}) });
    }
  }
  const onRack = new Set(p.controls.filter(c => parseAuTarget(c.target)?.rackId === rack.id || parseGrainsTarget(c.target)?.rackId === rack.id).map(c => c.id));
  const maps = p.mappings.filter(m => onRack.has(m.controlId)).length;
  if (maps) left.push(`${plural(maps, 'mapping')} onto its controls`);
  if (p.arrangement?.tracks[rack.id]?.notes.length || Object.keys(p.arrangement?.tracks[rack.id]?.auto ?? {}).length) left.push('its clips on the tape');
  const preset = parseRackPreset({
    id, name, savedAt: Date.now(), rack: r, controls,
    ...(p.audioFx?.chains[rackChainId(rack.id)]?.effects.length ? { soundFx: p.audioFx.chains[rackChainId(rack.id)] } : {}),
    ...(engineRackOfInput(p.audioReaders?.input ?? '') === rack.id ? { listener: p.audioEngine?.listenAt !== undefined ? { at: p.audioEngine.listenAt } : {} } : {}),
  });
  return { preset, left };
}

// ── Apply ───────────────────────────────────────────────────────────────────

export interface ApplyOptions {
  /** Does this computer have the Audio Unit? Absent: don't know (keep them all; the engine says if one fails). */
  hasUnit?: (u: AeUnitRef) => boolean;
  /** Replace this rack's instrument, effects and controls instead of adding a rack. */
  replace?: string;
  newId?: (kind: 'rk' | 'fx' | 'ctl') => string;
}

export interface ApplyResult {
  play: PlayRecord;
  rackId: string;
  /** Audio Units this computer doesn't have: left out. */
  missing: string[];
  notes: string[];
}

let seq = 0;
const defaultId = (kind: 'rk' | 'fx' | 'ctl') => { if (kind === 'ctl') return playId('ctl'); seq += 1; return `${kind}_${Date.now().toString(36)}${seq.toString(36)}p`; };

function freeName(label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(label)) return label;
  const base = label.replace(/\s*\(\d+\)$/, '');
  for (let n = 2; ; n++) { const name = `${base} (${n})`; if (!taken.has(name)) return name; }
}

/** Add a rack made from the preset, or put the preset's devices on an existing rack. One record in, one out (one undo step). */
export function applyRackPreset(p: PlayRecord, preset: RackPreset, opts: ApplyOptions = {}): ApplyResult {
  const newId = opts.newId ?? defaultId;
  const racks = p.audioEngine?.racks ?? [];
  const old = opts.replace ? racks.find(r => r.id === opts.replace) : undefined;
  if (!old && racks.length >= AE_RACKS_MAX) return { play: p, rackId: '', missing: [], notes: [`A setup has up to ${AE_RACKS_MAX} tracks.`] };
  const rackId = old?.id ?? newId('rk');
  const missing: string[] = [];
  const notes: string[] = [];
  const have = (s: AeSlot) => s.kind !== 'au' || !s.unit || !opts.hasUnit || opts.hasUnit(s.unit);
  const slotIds = new Map<string, string>();
  const src = clone(preset.rack);
  let instrument: AeSlot | null = src.instrument;
  if (instrument && !have(instrument)) { missing.push(aeSlotName(instrument)); instrument = null; }
  if (instrument) slotIds.set(AE_INST, AE_INST);
  const effects: AeSlot[] = [];
  const fromIds: string[] = [];
  for (const e of src.effects) {
    if (!have(e)) { missing.push(aeSlotName(e)); continue; }
    if (effects.length >= AE_EFFECTS_MAX) break;
    const id = newId('fx');
    slotIds.set(e.id, id);
    fromIds.push(e.id);
    effects.push({ ...e, id });
  }
  // Only the rack controls whose slot came in.
  const keep = (s: AeSlot | null, oldId: string) => {
    if (!s) return s;
    const addrs = preset.controls.filter(c => c.slot === oldId).map(c => c.address).slice(0, RACK_CONTROLS_MAX);
    const out = { ...s };
    if (addrs.length) out.controls = addrs; else delete out.controls;
    return out;
  };
  instrument = keep(instrument, AE_INST);
  const fx = effects.map((e, i) => keep(e, fromIds[i])!);
  const base = old ?? newRack(rackId, racks);
  const rack: AeRack = {
    ...base,
    name: old ? old.name : freeName(preset.name, new Set(racks.map(r => r.name))),
    instrument, effects: fx,
    midi: src.midi, channel: src.channel, volume: src.volume, mute: false, keyboard: old?.keyboard ?? false,
    ...(old?.color ?? src.color ? { color: old?.color ?? src.color } : {}),
  };
  delete rack.pads; delete rack.source;
  if (src.source === MASTER_CHAIN) rack.source = MASTER_CHAIN;
  if (old?.pads) rack.pads = old.pads;

  let out: PlayRecord = { ...p };
  if (old) {
    // The old devices' controls, their mappings and their automation go (the new ones come in below).
    const gone = new Set(p.controls.filter(c => parseAuTarget(c.target)?.rackId === old.id || parseGrainsTarget(c.target)?.rackId === old.id).map(c => c.id));
    const goneTargets = new Set(p.controls.filter(c => gone.has(c.id)).map(c => c.target));
    const lostMaps = p.mappings.filter(m => gone.has(m.controlId) || (m.source.kind === 'control' && gone.has(m.source.controlId))).length;
    if (lostMaps) notes.push(`${plural(lostMaps, 'mapping')} onto the old devices’ controls went with them`);
    out.controls = p.controls.filter(c => !gone.has(c.id));
    out.mappings = p.mappings.filter(m => !gone.has(m.controlId) && !(m.source.kind === 'control' && gone.has(m.source.controlId)));
    const t = p.arrangement?.tracks[old.id];
    if (t && Object.keys(t.auto).some(k => goneTargets.has(k))) {
      const auto = Object.fromEntries(Object.entries(t.auto).filter(([k]) => !goneTargets.has(k)));
      out.arrangement = { ...p.arrangement!, tracks: { ...p.arrangement!.tracks, [old.id]: { ...t, auto } } };
    }
  }
  const ae: PlayAudioEngine = { ...(p.audioEngine ?? { racks: [] }), racks: old ? racks.map(r => (r.id === old.id ? rack : r)) : [...racks, rack] };
  out = withEngine(out, ae);

  // Its rack controls, as Play controls in the slot's group, named apart from the setup's.
  const names = new Set(out.controls.map(c => c.label));
  const controls: PlayControl[] = [];
  for (const c of preset.controls) {
    const sid = slotIds.get(c.slot);
    const s = sid === AE_INST ? rack.instrument : rack.effects.find(e => e.id === sid);
    if (!sid || !s || !s.controls?.includes(c.address)) continue;
    const label = freeName(c.label, names); names.add(label);
    controls.push({ id: newId('ctl'), target: auTarget(rackId, sid, c.address), kind: 'float', label, min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}), group: rackControlGroup(rack, s) });
  }
  if (controls.length) out = { ...out, controls: [...out.controls, ...controls] };

  // A Granulator's Sound effects.
  const chainId = rackChainId(rackId);
  if (old && out.audioFx?.chains[chainId]) {
    const chains = { ...out.audioFx.chains }; delete chains[chainId];
    out = { ...out, audioFx: { ...out.audioFx, chains } };
  }
  if (preset.soundFx?.effects.length && rack.instrument?.kind === 'granulator') {
    out = { ...out, audioFx: { ...(out.audioFx ?? {}), chains: { ...(out.audioFx?.chains ?? {}), [chainId]: freshChain(preset.soundFx) } } };
  }

  // The Listener: placed when the setup's readers aren't listening anywhere yet.
  if (preset.listener) {
    const input = out.audioReaders?.input ?? '';
    if (engineRackOfInput(input) === rackId) { /* already here */ }
    else if (out.audioReaders?.readers.length) notes.push('the Listener (this setup’s audio readers listen elsewhere: + Add → Listener moves them here)');
    else {
      out = setReaderInput(out, engineReaderInput(rackId));
      const e: PlayAudioEngine = { ...out.audioEngine!, racks: out.audioEngine!.racks };
      if (preset.listener.at !== undefined) e.listenAt = Math.min(preset.listener.at, rack.effects.length); else delete e.listenAt;
      out = { ...out, audioEngine: e };
    }
  }
  if (missing.length) notes.unshift(`${missing.map(q).join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} on this computer, so ${missing.length === 1 ? 'it was' : 'they were'} left out`);
  return { play: out, rackId, missing, notes };
}

/** A chain with fresh effect ids. */
function freshChain(c: AudioFxChain): AudioFxChain {
  return { on: c.on, effects: c.effects.map(e => ({ ...clone(e), id: audioFxId(e.kind) })) };
}

/**
 * The preset's Sound effects (a Granulator's chain) added to the end of
 * Finish → Sound's master chain. Audio Unit effects run in the engine and
 * have no web version, so they don't come; null when the preset has no
 * Sound effects.
 */
export function presetSoundOnMaster(p: PlayRecord, preset: RackPreset): PlayRecord | null {
  if (!preset.soundFx?.effects.length) return null;
  const fresh = freshChain(preset.soundFx);
  const master = p.audioFx?.chains[MASTER_CHAIN];
  const chain: AudioFxChain = master ? { ...master, effects: [...master.effects, ...fresh.effects] } : { on: true, effects: fresh.effects };
  const audioFx: PlayAudioFx = { ...(p.audioFx ?? {}), chains: { ...(p.audioFx?.chains ?? {}), [MASTER_CHAIN]: chain } };
  return { ...p, audioFx };
}

/** "Granulator · 2 effects · 4 controls" */
export function rackPresetSummary(preset: RackPreset): string {
  const r = preset.rack;
  const parts = [r.instrument ? aeSlotName(r.instrument) : 'No instrument'];
  if (r.effects.length) parts.push(plural(r.effects.length, 'effect'));
  if (preset.soundFx?.effects.length) parts.push(plural(preset.soundFx.effects.length, 'sound effect'));
  if (preset.controls.length) parts.push(plural(preset.controls.length, 'control'));
  return parts.join(' · ');
}

/** The Audio Units a preset needs (instrument and effects), by name and key. */
export function presetUnits(preset: RackPreset): Array<{ name: string; key: string; unit: AeUnitRef }> {
  return [preset.rack.instrument, ...preset.rack.effects].flatMap(s => (s?.kind === 'au' && s.unit ? [{ name: aeSlotName(s), key: unitKey(s.unit), unit: s.unit }] : []));
}

// ── Storage ─────────────────────────────────────────────────────────────────

export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, 'rack presets'),
};
function newPresetId(): string { return `rpre_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`; }
const readList = (kv: ListKV): unknown[] => { try { const a = JSON.parse(kv.get(RACK_PRESETS_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, list: RackPreset[]): FileResult {
  const r = kv.set(RACK_PRESETS_KEY, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(RACK_PRESETS_CHANGED));
  return r;
}

export function parseRackPreset(raw: unknown): RackPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const rack = parseAudioEngine({ racks: [{ ...(r.rack && typeof r.rack === 'object' ? r.rack : {}), id: 'preset' }] })?.racks[0];
  if (!rack) return null;
  const slots = new Map([rack.instrument, ...rack.effects].filter((s): s is AeSlot => !!s).map(s => [s.id, s]));
  const controls: RackPresetControl[] = [];
  for (const c of Array.isArray(r.controls) ? r.controls : []) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const s = typeof o.slot === 'string' ? slots.get(o.slot) : undefined;
    if (!s || typeof o.address !== 'string' || !s.controls?.includes(o.address)) continue;
    const min = typeof o.min === 'number' && Number.isFinite(o.min) ? o.min : 0, max = typeof o.max === 'number' && Number.isFinite(o.max) ? o.max : 1;
    controls.push({ slot: s.id, address: o.address, label: typeof o.label === 'string' && o.label.trim() ? o.label.slice(0, 80) : o.address, min: Math.min(min, max), max: Math.max(min, max), ...(typeof o.step === 'number' && o.step > 0 ? { step: o.step } : {}) });
  }
  const out: RackPreset = {
    id: r.id.slice(0, 80),
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : rack.name).slice(0, 60),
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    rack, controls,
  };
  if (typeof r.note === 'string' && r.note.trim()) out.note = r.note.trim().slice(0, 2000);
  const fx = r.soundFx ? parseAudioFx({ chains: { master: r.soundFx } })?.chains.master : undefined;
  if (fx?.effects.length) out.soundFx = fx;
  if (r.listener && typeof r.listener === 'object') {
    const at = (r.listener as Record<string, unknown>).at;
    out.listener = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? { at } : {};
  }
  return out;
}

export function loadRackPresets(kv: ListKV = localList): RackPreset[] {
  return readList(kv).flatMap(x => { const s = parseRackPreset(x); return s ? [s] : []; });
}

/** Save a preset under its name; one with the same name is replaced (keeping its id). */
export function saveRackPreset(preset: RackPreset, kv: ListKV = localList): FileResult {
  const n = preset.name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A preset needs a name.' };
  const list = loadRackPresets(kv);
  const had = list.find(x => x.name === n);
  return writeList(kv, [...list.filter(x => x.name !== n), { ...preset, name: n, id: had?.id ?? preset.id }]);
}

export function renameRackPreset(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A preset needs a name.' };
  return writeList(kv, loadRackPresets(kv).map(x => (x.id === id ? { ...x, name: n } : x)));
}

export function deleteRackPreset(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, loadRackPresets(kv).filter(x => x.id !== id));
}
