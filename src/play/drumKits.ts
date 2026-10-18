/**
 * drumKits.ts — saved drum kits (docs/sampler.md, "Kits"): a Sampler's Drum
 * view as a preset on this device, beside the Finish stack's presets
 * (play/finishLibrary.ts).
 *
 * A kit keeps every pad (its sample or generated drum and how it plays: mode,
 * loop, reverse, choke, filter, LFO), each pad's numbers (every SM_PARAMS
 * key: start, end, transpose, gain, pan, the envelopes, filter, LFO…), the
 * kit's Keys / MIDI / Pad grid settings, its Volume and its effect chain.
 * Samples are named by their media-library id (lib/backgroundLibrary.ts), so
 * a kit whose sample this device doesn't have shows those pads as missing.
 *
 * One list in localStorage (`shader-studio:drum-kits`), so kits travel in
 * library ZIPs, `.play` library items, profile ZIPs and the workspace
 * folder, and show on the Files page (Presets → Drum kits). Pure functions
 * over a KV: the tests and the importers use them without a browser.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import { emptyDrumPad, padHasSound, type DrumPad, type DrumPadLayer } from '../types/playLayers';
import { audioFxId, layerChainId, parseAudioFx, type AudioFxChain, type PlayAudioFx } from '../types/playAudioFx';
import { DP_PADS, DP_SYNTHS, dpKey, type DpSynth } from './kit/drumPads.js';
import { SM_CHOKES, SM_FILTERS, SM_LFO_SHAPES, SM_LFO_TO, SM_PADS, SM_PARAMS, smClamp, type SmFilter, type SmLfoShape, type SmLfoTo } from './kit/sampler.js';
import { afNewEffect } from './kit/audioFx.js';

export const DRUM_KITS_KEY = 'shader-studio:drum-kits';
/** Fired on window when the list changes, so every open card refreshes. */
export const DRUM_KITS_CHANGED = 'drum-kits-changed';

export interface DrumKit {
  id: string;
  name: string;
  savedAt: number;
  description?: string;
  /** Sixteen pads or more, up to 128 (empty ones included, so a kit's layout is kept). */
  pads: DrumPad[];
  /** Each pad's numbers, `pad<N>_<key>` (only the ones that differ from the defaults are stored). */
  numbers: Record<string, number>;
  volume: number;
  keys: boolean;
  midi: boolean;
  channel: number;
  baseNote: number;
  grid: boolean;
  /** The kit's effect chain (the layer's `layer:<id>` chain), when it has one. */
  fx?: AudioFxChain;
}

/** Where the list is kept: localStorage in the app, a map in tests. */
export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, 'drum kits'),
};

const newId = () => `kit_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const readList = (kv: ListKV): unknown[] => { try { const a = JSON.parse(kv.get(DRUM_KITS_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, list: DrumKit[]): FileResult {
  const r = kv.set(DRUM_KITS_KEY, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(DRUM_KITS_CHANGED));
  return r;
}

const padNumberKeys = new Set(SM_PARAMS.map(p => p.key));
const padDefault = (key: string): number => SM_PARAMS.find(p => p.key === key)?.value ?? 0;
/** Every number of the first `pads` pads at its default. */
export function defaultPadNumbers(pads = DP_PADS): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < pads; i++) for (const p of SM_PARAMS) out[dpKey(i, p.key)] = p.value;
  return out;
}

function parsePad(raw: unknown): DrumPad {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const p = emptyDrumPad();
  if (typeof r.sampleId === 'string') p.sampleId = r.sampleId.slice(0, 200);
  if (typeof r.fileName === 'string') p.fileName = r.fileName.slice(0, 120);
  p.bytes = Math.max(0, Math.round(num(r.bytes, 0)));
  if ((DP_SYNTHS as readonly string[]).includes(r.synth as string)) p.synth = r.synth as DpSynth;
  if (typeof r.name === 'string') p.name = r.name.slice(0, 60);
  if (r.mode === 'gate') p.mode = 'gate';
  p.loop = r.loop === true;
  p.reverse = r.reverse === true;
  p.choke = Math.max(0, Math.min(SM_CHOKES, Math.round(num(r.choke, 0))));
  if ((SM_FILTERS as readonly string[]).includes(r.filter as string) && r.filter !== 'off') p.filter = r.filter as SmFilter;
  if ((SM_LFO_SHAPES as readonly string[]).includes(r.lfoShape as string) && r.lfoShape !== 'sine') p.lfoShape = r.lfoShape as SmLfoShape;
  if ((SM_LFO_TO as readonly string[]).includes(r.lfoTo as string) && r.lfoTo !== 'pitch') p.lfoTo = r.lfoTo as SmLfoTo;
  return p;
}

/** A kit from storage or a file, checked; null when it isn't one. */
export function parseDrumKit(raw: unknown): DrumKit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || !Array.isArray(r.pads)) return null;
  const pads: DrumPad[] = [];
  for (let i = 0; i < Math.min(SM_PADS, Math.max(DP_PADS, r.pads.length)); i++) pads.push(parsePad(r.pads[i]));
  while (pads.length > DP_PADS && !padHasSound(pads[pads.length - 1])) pads.pop();
  const numbers: Record<string, number> = {};
  if (r.numbers && typeof r.numbers === 'object') {
    for (const [k, v] of Object.entries(r.numbers as Record<string, unknown>)) {
      const m = /^pad(\d+)_([A-Za-z]+)$/.exec(k);
      if (!m || Number(m[1]) < 1 || Number(m[1]) > pads.length || !padNumberKeys.has(m[2]) || typeof v !== 'number' || !Number.isFinite(v)) continue;
      numbers[k] = smClamp(m[2], v);
    }
  }
  const fx = r.fx ? parseAudioFx({ chains: { master: r.fx } })?.chains.master : undefined;
  return {
    id: r.id.slice(0, 80),
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Drum kit').slice(0, 60),
    savedAt: num(r.savedAt, 0),
    ...(typeof r.description === 'string' && r.description.trim() ? { description: r.description.trim().slice(0, 200) } : {}),
    pads, numbers,
    volume: Math.max(0, Math.min(2, num(r.volume, 0.9))),
    keys: r.keys !== false, midi: r.midi !== false,
    channel: Math.max(0, Math.min(16, Math.round(num(r.channel, 0)))),
    baseNote: Math.max(0, Math.min(127, Math.round(num(r.baseNote, 36)))),
    grid: r.grid !== false,
    ...(fx && fx.effects.length ? { fx } : {}),
  };
}

export function loadDrumKits(kv: ListKV = localList): DrumKit[] {
  return readList(kv).flatMap(x => { const k = parseDrumKit(x); return k ? [k] : []; });
}

/** The layer as a kit (not yet saved): its pads, numbers, settings and effect chain. */
export function kitFromLayer(l: DrumPadLayer, fx: PlayAudioFx | undefined, name: string, id = newId()): DrumKit {
  const numbers: Record<string, number> = {};
  const count = Math.max(DP_PADS, l.pads.length);
  for (let i = 0; i < count; i++) if (padHasSound(l.pads[i])) for (const p of SM_PARAMS) {
    const k = dpKey(i, p.key);
    const v = l[k as `pad${number}_${string}`];
    if (typeof v === 'number' && Number.isFinite(v) && v !== p.value) numbers[k] = v;
  }
  const chain = fx?.chains[layerChainId(l.id)];
  const kit = parseDrumKit({
    id, name, savedAt: Date.now(),
    pads: Array.from({ length: count }, (_, i) => l.pads[i] ?? emptyDrumPad()), numbers,
    volume: l.volume, keys: l.keys, midi: l.midi, channel: l.channel, baseNote: l.baseNote, grid: l.grid,
    ...(chain && chain.effects.length ? { fx: chain } : {}),
  });
  return kit!;
}

/** Save the layer as a kit. One with the same name is replaced (keeping its id). */
export function saveDrumKit(name: string, l: DrumPadLayer, fx: PlayAudioFx | undefined, kv: ListKV = localList): { result: FileResult; kit: DrumKit | null } {
  const n = name.trim().slice(0, 60);
  if (!n) return { result: { ok: false, error: 'A kit needs a name.' }, kit: null };
  const list = loadDrumKits(kv);
  const had = list.find(k => k.name === n);
  const kit = kitFromLayer(l, fx, n, had?.id);
  return { result: writeList(kv, [...list.filter(k => k.name !== n), kit]), kit };
}

export function renameDrumKit(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A kit needs a name.' };
  return writeList(kv, loadDrumKits(kv).map(k => (k.id === id ? { ...k, name: n } : k)));
}

export function deleteDrumKit(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, loadDrumKits(kv).filter(k => k.id !== id));
}

/** Put a kit (from a file, an import) into the list as it is; one with the same id is replaced. */
export function installDrumKits(kits: DrumKit[], kv: ListKV = localList): FileResult {
  const ids = new Set(kits.map(k => k.id));
  return writeList(kv, [...loadDrumKits(kv).filter(k => !ids.has(k.id)), ...kits]);
}

/** The library ids of the samples a kit's pads use (generated drums need none). */
export function kitSampleIds(kit: Pick<DrumKit, 'pads'>): string[] {
  return [...new Set(kit.pads.map(p => p.sampleId).filter(Boolean))];
}

export type KitLoadMode = 'replace' | 'merge';

/**
 * The layer (and the setup's effects) after loading a kit.
 *   replace   every pad, every number, the kit's settings, Volume and its effect chain
 *   merge     the kit's pads that play something land on the layer's empty pads (with
 *             their numbers); the layer's other pads, settings and effects stay
 * Loaded effects get new ids, so they never collide with the layer's controls.
 */
export function applyDrumKit(l: DrumPadLayer, fx: PlayAudioFx | undefined, kit: DrumKit, mode: KitLoadMode): { layer: DrumPadLayer; fx: PlayAudioFx | undefined; filled: number } {
  const numbersOf = (i: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const p of SM_PARAMS) { const k = dpKey(i, p.key); out[k] = kit.numbers[k] ?? padDefault(p.key); }
    return out;
  };
  if (mode === 'replace') {
    const numbers: Record<string, number> = {};
    kit.pads.forEach((p, i) => { if (padHasSound(p)) Object.assign(numbers, numbersOf(i)); });
    // The layer's own pad numbers go: the kit's pads bring theirs.
    const kept = Object.fromEntries(Object.entries(l).filter(([k]) => !/^pad\d+_/.test(k))) as unknown as DrumPadLayer;
    const layer: DrumPadLayer = {
      ...kept, ...numbers, view: 'drum', pads: kit.pads.map(p => ({ ...p })),
      volume: kit.volume, keys: kit.keys, midi: kit.midi, channel: kit.channel, baseNote: kit.baseNote, grid: kit.grid,
    };
    const chainId = layerChainId(l.id);
    const chains = { ...(fx?.chains ?? {}) };
    if (kit.fx) chains[chainId] = { on: kit.fx.on, effects: kit.fx.effects.map(e => ({ ...JSON.parse(JSON.stringify(e)), id: audioFxId(e.kind) })) };
    else delete chains[chainId];
    const nextFx: PlayAudioFx | undefined = Object.keys(chains).length || fx?.analyse ? { ...(fx ?? {}), chains } : undefined;
    return { layer, fx: nextFx, filled: kit.pads.filter(p => p.sampleId || p.synth).length };
  }
  const pads = Array.from({ length: Math.max(l.pads.length, kit.pads.length) }, (_, i) => l.pads[i] ?? emptyDrumPad());
  const patch: Record<string, number> = {};
  let filled = 0;
  for (let i = 0; i < kit.pads.length; i++) {
    const mine = pads[i], theirs = kit.pads[i];
    if (mine.sampleId || mine.synth || !(theirs.sampleId || theirs.synth)) continue;
    pads[i] = { ...theirs };
    Object.assign(patch, numbersOf(i));
    filled++;
  }
  return { layer: { ...l, ...patch, pads }, fx, filled };
}

/** How many of a kit's sample pads this device lacks (their names), given which library ids are here. */
export function kitMissing(kit: Pick<DrumKit, 'pads'>, has: (sampleId: string) => boolean): string[] {
  return kit.pads.filter(p => p.sampleId && !has(p.sampleId)).map(p => p.name || p.fileName || p.sampleId);
}

/** "12 pads · 3 samples · Filter → Reverb" */
export function kitSummary(kit: DrumKit, fxLabel: (kind: string) => string): string {
  const playing = kit.pads.filter(p => p.sampleId || p.synth).length;
  const samples = kitSampleIds(kit).length;
  const parts = [`${playing} pad${playing === 1 ? '' : 's'}`, samples ? `${samples} sample${samples === 1 ? '' : 's'}` : 'generated drums'];
  if (kit.fx?.effects.length) parts.push(kit.fx.effects.map(e => fxLabel(e.kind)).join(' → '));
  return parts.join(' · ');
}

// ── Built-in kits ───────────────────────────────────────────────────────────

type Synth = DpSynth | '';
function builtinKit(id: string, name: string, description: string, synths: Synth[], numbers: Record<string, number> = {}, extra: Partial<DrumKit> = {}): DrumKit {
  const pads = Array.from({ length: DP_PADS }, (_, i) => ({ ...emptyDrumPad(), synth: synths[i] ?? '' }));
  return parseDrumKit({ id, name, description, savedAt: 0, pads, numbers, volume: 0.9, keys: true, midi: true, channel: 0, baseNote: 36, grid: true, ...extra })!;
}

const n = (pad: number, key: string, v: number): [string, number] => [dpKey(pad, key), v];
const numbers = (...xs: Array<[string, number]>) => Object.fromEntries(xs);

/** Kits made from the generated drums: they need no files and sound the same everywhere. */
export const BUILTIN_KITS: readonly DrumKit[] = [
  builtinKit('builtin:808', '808-ish', 'A drum machine: long kick, snappy snare, tight hats',
    ['kick', 'snare', 'hat', 'openhat', 'clap', 'tom', 'rim', 'cowbell', 'kick', 'snare', 'hat', 'openhat', 'tom', 'tom', 'clap', 'cowbell'],
    numbers(n(0, 'pitch', -3), n(0, 'decay', 0.6), n(8, 'pitch', -7), n(8, 'decay', 1.2), n(2, 'decay', 0.06), n(2, 'sustain', 0), n(10, 'pitch', 5), n(10, 'decay', 0.05), n(10, 'sustain', 0),
      n(12, 'pitch', -5), n(13, 'pitch', 4), n(9, 'pitch', 3), n(14, 'pitch', -4), n(15, 'pitch', 6))),
  builtinKit('acoustic', 'Acoustic-ish', 'Softer hits, a little room: kick, snare, toms and hats',
    ['kick', 'snare', 'hat', 'openhat', 'tom', 'tom', 'tom', 'rim', 'kick', 'snare', 'hat', 'openhat', 'clap', 'rim', 'cowbell', 'tom'],
    numbers(n(0, 'attack', 0.004), n(1, 'attack', 0.003), n(1, 'pitch', -2), n(4, 'pitch', -6), n(5, 'pitch', -2), n(6, 'pitch', 3), n(8, 'pitch', 2), n(8, 'vel', 1), n(9, 'pitch', 2), n(9, 'volume', 0.6),
      n(2, 'volume', 0.6), n(3, 'volume', 0.65), n(15, 'pitch', -9)),
    { fx: { on: true, effects: [afNewEffect('reverb', 'fx_reverb')] } }),
  builtinKit('percussion', 'Percussion', 'Rims, cowbells, claps and toms at many pitches',
    ['rim', 'rim', 'cowbell', 'cowbell', 'clap', 'clap', 'tom', 'tom', 'tom', 'tom', 'hat', 'openhat', 'rim', 'cowbell', 'clap', 'kick'],
    numbers(n(1, 'pitch', 5), n(3, 'pitch', 7), n(5, 'pitch', -4), n(6, 'pitch', -8), n(7, 'pitch', -3), n(8, 'pitch', 2), n(9, 'pitch', 7), n(12, 'pitch', 12), n(13, 'pitch', -5), n(14, 'pitch', 6), n(15, 'pitch', 8), n(15, 'decay', 0.15))),
].map(k => ({ ...k, id: k.id.startsWith('builtin:') ? k.id : `builtin:${k.id}` }));

export const isBuiltinKit = (kit: Pick<DrumKit, 'id'>) => kit.id.startsWith('builtin:');
