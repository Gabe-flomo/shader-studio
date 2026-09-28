/**
 * playAudioEngine.ts — the Play record's Audio engine (`play.audioEngine`,
 * docs/audio-engine.md): racks, each an instrument (an Audio Unit synth on
 * the desktop app, or the sample player) followed by effects (Audio Units),
 * played from MIDI and the computer keyboard. Each rack's output has a
 * spectrum the audio readers can listen to (`engine:<rackId>`).
 *
 * An Audio Unit's parameters are control targets
 * `au:<rackId>:<slotId>::<address>` (the instrument's slot id is `inst`); the
 * mapping engine keeps their driven values under the prop id
 * `au:<rackId>:<slotId>` like the audio effects' numbers.
 *
 * A granulator (docs/granulator.md) keeps its settings the same way, by
 * GR_PARAMS address, so each one is a target like an Audio Unit parameter.
 *
 * Pure: types, parsing, targets and record edits. lib/audioEngineHost.ts runs it.
 */
import { RACK_CONTROLS_MAX } from './playArrangement';
import { GR_FROM_LINKS_MAX, GR_FROM_PROPS, GR_FROM_TARGETS, GR_SYNTHS, GR_SYNTH_NAMES, grParam } from '../play/kit/granulator.js';


/** An Audio Unit, by its component description (four-char codes as numbers), with its names for showing. */
export interface AeUnitRef {
  type: number;
  subtype: number;
  manufacturer: number;
  name: string;
  vendor: string;
}

/** A sample player zone: a library sound played for notes lo..hi, at its own pitch on `root`. */
export interface AeZone {
  /**
   * A kept sound's id (lib/backgroundLibrary.ts, the Library's Sounds). Named like a drum pad's
   * sample, so the Library's "used by", clean-up and .playfile bundling find it (lib/videoUsage.ts).
   */
  sampleId: string;
  name: string;
  lo: number;
  hi: number;
  root: number;
  /** 0..2. */
  gain: number;
}

/** The instrument's slot id. */
export const AE_INST = 'inst';

/**
 * A granulator's sample (docs/granulator.md): a kept sound from the Library
 * (`sampleId`, named like a zone's so the Library's "used by", clean-up and
 * bundling find it), or a generated one (`synth`: play/kit/granulator.js GR_SYNTHS).
 */
export interface AeGrainSample {
  sampleId?: string;
  synth?: string;
  name: string;
}

export interface AeSlot {
  /** `inst` for the instrument; an effect's own id. */
  id: string;
  kind: 'au' | 'sampler' | 'granulator';
  /** kind 'au'. */
  unit?: AeUnitRef;
  /** An effect passed straight through. */
  bypass?: boolean;
  /** Parameter values set on the card (address → value), restored when the unit loads. */
  params?: Record<string, number>;
  /** The unit's whole state (its preset) as base64, kept with "Keep the plug-in's settings". */
  state?: string;
  /** kind 'sampler'. */
  zones?: AeZone[];
  /** kind 'granulator': its sample (its settings are `params`, by GR_PARAMS address). */
  sample?: AeGrainSample;
  /** kind 'granulator': "Grains from" a layer: each thing inside the boundary plays grains (docs/granulator.md). */
  from?: AeGrainFrom;
  /**
   * Rack controls (docs/arrangement.md, Configure): up to RACK_CONTROLS_MAX
   * parameter addresses, in the strip's order. Each is a Play control on
   * `au:<rack>:<slot>::<address>` in the group "<rack> · <slot name>"
   * (play/rackControls.ts); the tape records their automation.
   */
  controls?: string[];
}

/** One link: a thing's prop (GR_FROM_PROPS) sets a grain setting (GR_FROM_TARGETS) between min (at 0) and max (at 1). */
export interface AeGrainLink { prop: string; target: string; on: boolean; min: number; max: number }
/**
 * A layer drives the grains: `source` a particles, bodies, null or
 * Relationship layer; `boundary` a shape layer (only things inside it play;
 * '' is the whole picture); `births` a thing just born plays a grain at once.
 */
export interface AeGrainFrom { source: string; boundary: string; births: boolean; links: AeGrainLink[] }

export interface AeRack {
  id: string;
  name: string;
  instrument: AeSlot | null;
  effects: AeSlot[];
  /** The computer keyboard plays it, DAW-style (lib/rackKeyboard.ts): at most one rack at a time; off by default. */
  keyboard: boolean;
  /** Which MIDI input plays it: '' any (the MIDI file and the keyboard stand-in too), 'off' none, else the device's name. */
  midi: string;
  /** MIDI channel 1..16, or 0 for all. */
  channel: number;
  /** 0..2 (1 = as is). */
  volume: number;
  mute: boolean;
  /** Drum pad hits from this layer play the rack (pad N → note 36 + N), set by "Play these pads in the Audio engine". */
  pads?: string;
  /**
   * A web sound sent through the rack's effects instead of an instrument
   * (desktop): 'master' (everything the page plays) or a chain id (a layer's
   * song or video sound, an Audio Input node: types/playAudioFx.ts). The
   * sound leaves the page's output and plays through the engine (docs/audio-engine.md).
   */
  source?: string;
  /** The track's colour in the Arrangement (`#rrggbb`); absent: the palette's, by position (engineView.ts trackColor). */
  color?: string;
}

export interface PlayAudioEngine {
  racks: AeRack[];
  /**
   * Where the Listener device sits in the chain of the rack the audio readers
   * listen to (docs/audio-engine.md, "Listeners"): after this many of its
   * effects (0: straight after the instrument). Absent: after the whole chain.
   */
  listenAt?: number;
  /**
   * The rack locked as the lead (docs/audio-engine.md, "The lead rack"): it
   * takes the MIDI notes, the computer keyboard and pad hits that no rack's
   * own routing claims, whichever card is selected. Absent: the selected
   * card's rack leads (session state), else the first rack.
   */
  lock?: string;
}

/** Where a note from a rack's input goes: `ae:<rackId>` pad actions (so a take records it). */
export const RACK_ACT_PREFIX = 'ae:';

/** A send's source: the master bus, or a chain id. */
export const isSendSource = (s: string) => /^(master|layer:[A-Za-z0-9_-]{1,64}|node:[A-Za-z0-9_-]{1,64})$/.test(s);

/** Racks a setup makes (docs/arrangement.md: up to 8 racks, each an instrument and up to 8 effects). */
export const AE_RACKS_MAX = 8;
export const AE_EFFECTS_MAX = 8;
/** A file made before those limits keeps up to this many (nothing it has is dropped on opening). */
const AE_RACKS_KEEP = 16;
const AE_EFFECTS_KEEP = 12;
export const AE_ZONES_MAX = 64;
/** Pad N of a following drum pad layer plays this note + N. */
export const AE_PAD_BASE_NOTE = 36;

// ── Four-char codes ─────────────────────────────────────────────────────────

/** 'aumu' → its number. */
export function fourCC(s: string): number {
  const t = (s + '    ').slice(0, 4);
  return ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0;
}

/** A number → its four chars ('?' for ones that don't print). */
export function fourCCText(n: number): string {
  let out = '';
  for (const shift of [24, 16, 8, 0]) {
    const c = (n >>> shift) & 0xff;
    out += c >= 32 && c <= 126 ? String.fromCharCode(c) : '?';
  }
  return out;
}

/** A unit's stable key: "aumu/dls /appl". */
export const unitKey = (u: Pick<AeUnitRef, 'type' | 'subtype' | 'manufacturer'>) => `${fourCCText(u.type)}/${fourCCText(u.subtype)}/${fourCCText(u.manufacturer)}`;

export const AU_INSTRUMENT_TYPE = fourCC('aumu');

// ── Control targets ─────────────────────────────────────────────────────────

export const AU_TARGET_PREFIX = 'au:';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function auTarget(rackId: string, slotId: string, address: string): string {
  return `${AU_TARGET_PREFIX}${rackId}:${slotId}::${address}`;
}

export function parseAuTarget(target: string): { rackId: string; slotId: string; address: string } | null {
  if (!target.startsWith(AU_TARGET_PREFIX)) return null;
  const rest = target.slice(AU_TARGET_PREFIX.length);
  const i = rest.indexOf('::');
  if (i <= 0) return null;
  const head = rest.slice(0, i), address = rest.slice(i + 2);
  const j = head.indexOf(':');
  if (j <= 0) return null;
  const rackId = head.slice(0, j), slotId = head.slice(j + 1);
  if (!ID.test(rackId) || !ID.test(slotId) || !/^\d{1,20}$/.test(address)) return null;
  return { rackId, slotId, address };
}

/** The id the mapping engine keeps a slot's driven parameters under. */
export const auPropId = (rackId: string, slotId: string) => `${AU_TARGET_PREFIX}${rackId}:${slotId}`;

export function aeRack(ae: PlayAudioEngine | undefined, rackId: string): AeRack | undefined {
  return ae?.racks.find(r => r.id === rackId);
}

export function aeSlot(rack: AeRack | undefined, slotId: string): AeSlot | undefined {
  if (!rack) return undefined;
  return slotId === AE_INST ? rack.instrument ?? undefined : rack.effects.find(e => e.id === slotId);
}

/** Does a target name a slot the record has (an Audio Unit one, or a granulator's setting)? */
export function auTargetExists(ae: PlayAudioEngine | undefined, target: string): boolean {
  const t = parseAuTarget(target);
  const s = t ? aeSlot(aeRack(ae, t.rackId), t.slotId) : undefined;
  if (s?.kind === 'granulator') return !!grParam(t!.address);
  return !!s && s.kind === 'au';
}

/** A target's value as the record keeps it, or undefined (never set on the card, or gone). A granulator's unset setting reads its default. */
export function readAuValue(ae: PlayAudioEngine | undefined, target: string): number | undefined {
  const t = parseAuTarget(target);
  if (!t) return undefined;
  const s = aeSlot(aeRack(ae, t.rackId), t.slotId);
  const v = s?.params?.[t.address];
  if (typeof v === 'number') return v;
  return s?.kind === 'granulator' ? grParam(t.address)?.value : undefined;
}

/** The instrument's name: "Sample player", "Granulator", or the Audio Unit's. */
export function aeSlotName(slot: AeSlot): string {
  return slot.kind === 'sampler' ? 'Sample player' : slot.kind === 'granulator' ? 'Granulator' : slot.unit?.name ?? 'Audio Unit';
}

/** "Rack 1 · Juno · Cutoff" style labels: the rack and the slot's name. */
export function aeSlotLabel(rack: AeRack, slot: AeSlot): string {
  return `${rack.name} · ${aeSlotName(slot)}`;
}

/** Is this rack's instrument a granulator? */
export const isGranulatorRack = (r: AeRack | undefined): boolean => r?.instrument?.kind === 'granulator';

// ── Grain readouts (docs/granulator.md) ────────────────────────────────────

/**
 * A granulator rack reports its grains as sensors on `ae:<rackId>` (so a
 * mapping's Sensor source reads them): GRAIN_READS, and per grain
 * `grainPos<N>` / `grainAmp<N>` / `grainBand<N>` / `grainEnergy<N>` (N 1..GRAIN_EACH).
 */
export const GRAIN_READS = ['grains', 'grainMean', 'grainSpread', 'grainLevel', 'grainPitch', 'grainBandMean', 'grainEnergySum'] as const;
export type GrainRead = (typeof GRAIN_READS)[number];
export const GRAIN_EACH = 16;
export const grainSensorLayer = (rackId: string) => `${RACK_ACT_PREFIX}${rackId}`;
/** The rack a sensor's layer id names (`ae:<rackId>`), or ''. */
export const rackOfSensorLayer = (layerId: string) => (layerId.startsWith(RACK_ACT_PREFIX) ? layerId.slice(RACK_ACT_PREFIX.length) : '');
export const GRAIN_READ_LABELS: Record<GrainRead, string> = { grains: 'Grain count', grainMean: 'Grain position (mean)', grainSpread: 'Grain spread', grainLevel: 'Grain level', grainPitch: 'Grain pitch', grainBandMean: 'Grain band (mean)', grainEnergySum: 'Grain energy' };

/**
 * Control target of a grain readout's control (`grains:<rackId>::<read>`).
 * It writes nothing: a sensor → control mapping drives it, so the readout
 * shows on the Controls tab and other mappings can read it as a control.
 */
export const GRAINS_TARGET_PREFIX = 'grains:';
export const grainsTarget = (rackId: string, read: GrainRead) => `${GRAINS_TARGET_PREFIX}${rackId}::${read}`;
export function parseGrainsTarget(target: string): { rackId: string; read: GrainRead } | null {
  if (!target.startsWith(GRAINS_TARGET_PREFIX)) return null;
  const rest = target.slice(GRAINS_TARGET_PREFIX.length), i = rest.indexOf('::');
  if (i <= 0) return null;
  const read = rest.slice(i + 2) as GrainRead;
  return GRAIN_READS.includes(read) && ID.test(rest.slice(0, i)) ? { rackId: rest.slice(0, i), read } : null;
}

// ── Record edits ────────────────────────────────────────────────────────────

export function emptyAudioEngine(): PlayAudioEngine {
  return { racks: [] };
}

export function newRack(id: string, existing: readonly AeRack[]): AeRack {
  let n = existing.length + 1;
  const names = new Set(existing.map(r => r.name));
  while (names.has(`Rack ${n}`)) n++;
  return { id, name: `Rack ${n}`, instrument: null, effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false };
}

/** Give the computer keyboard to one rack (and to no other), or take it away. */
export function setRackKeyboard(ae: PlayAudioEngine | undefined, rackId: string, on: boolean): PlayAudioEngine {
  return { ...ae, racks: (ae?.racks ?? []).map(r => ({ ...r, keyboard: on && r.id === rackId })) };
}

/** The rack the computer keyboard plays, if any. */
export function keyboardRack(ae: PlayAudioEngine | undefined): AeRack | undefined {
  return ae?.racks.find(r => r.keyboard);
}

export function patchRack(ae: PlayAudioEngine | undefined, rackId: string, patch: Partial<AeRack> | ((r: AeRack) => AeRack)): PlayAudioEngine {
  const racks = (ae?.racks ?? []).map(r => (r.id === rackId ? (typeof patch === 'function' ? patch(r) : { ...r, ...patch }) : r));
  return { ...ae, racks };
}

export function patchSlot(ae: PlayAudioEngine | undefined, rackId: string, slotId: string, patch: Partial<AeSlot>): PlayAudioEngine {
  return patchRack(ae, rackId, r => (slotId === AE_INST
    ? { ...r, instrument: r.instrument ? { ...r.instrument, ...patch } : r.instrument }
    : { ...r, effects: r.effects.map(e => (e.id === slotId ? { ...e, ...patch } : e)) }));
}

/** Move an effect by one place (−1 earlier, +1 later). */
export function moveEffect(ae: PlayAudioEngine | undefined, rackId: string, slotId: string, by: -1 | 1): PlayAudioEngine {
  return patchRack(ae, rackId, r => {
    const i = r.effects.findIndex(e => e.id === slotId), j = i + by;
    if (i < 0 || j < 0 || j >= r.effects.length) return r;
    const effects = [...r.effects];
    [effects[i], effects[j]] = [effects[j], effects[i]];
    return { ...r, effects };
  });
}

/** The record's controls without the ones on slots that are gone (a removed rack, effect or instrument). */
export function controlsKeptFor<T extends { target: string }>(controls: readonly T[], ae: PlayAudioEngine | undefined): T[] {
  return controls.filter(c => {
    const g = parseGrainsTarget(c.target);
    if (g) return isGranulatorRack(aeRack(ae, g.rackId));
    return !parseAuTarget(c.target) || auTargetExists(ae, c.target);
  });
}

/** The zone a note plays (the last one covering it, as the native sample player picks), or undefined. */
export function zoneForNote(zones: readonly AeZone[], note: number): AeZone | undefined {
  let hit: AeZone | undefined;
  for (const z of zones) if (note >= z.lo && note <= z.hi) hit = z;
  return hit;
}

/** Zones for sounds dropped on the sample player: one key each from `from` (drum style), or one sound across every key. */
export function zonesFor(sounds: ReadonlyArray<{ id: string; name: string }>, mode: 'keys' | 'pitched', from = AE_PAD_BASE_NOTE): AeZone[] {
  if (mode === 'pitched') return sounds.slice(0, 1).map(s => ({ sampleId: s.id, name: s.name, lo: 0, hi: 127, root: 60, gain: 1 }));
  return sounds.slice(0, AE_ZONES_MAX).map((s, i) => {
    const n = Math.min(127, from + i);
    return { sampleId: s.id, name: s.name, lo: n, hi: n, root: n, gain: 1 };
  });
}

// ── MIDI routing ────────────────────────────────────────────────────────────

/** Does the rack name its own MIDI input (a device, or a channel)? Then it plays what that sends, lead or not. */
export const hasOwnRouting = (r: Pick<AeRack, 'midi' | 'channel'>) => (r.midi !== '' && r.midi !== 'off') || r.channel !== 0;

/**
 * The lead rack (docs/audio-engine.md, "The lead rack"): the one locked as
 * lead, else the selected card's (`selected`, session state), else the first.
 * '' when there are no racks.
 */
export function leadRackId(ae: PlayAudioEngine | undefined, selected = ''): string {
  const racks = ae?.racks ?? [];
  if (ae?.lock && racks.some(r => r.id === ae.lock)) return ae.lock;
  if (selected && racks.some(r => r.id === selected)) return selected;
  return racks[0]?.id ?? '';
}

/**
 * Does a note from `device` on `channel` play this rack? A rack with its own
 * routing (a device or a channel) plays what that sends, as rackHears says;
 * one on "any MIDI input" plays only while it's the lead. 'No MIDI' never.
 */
export function rackPlays(r: Pick<AeRack, 'id' | 'midi' | 'channel'>, lead: string, device: string, channel: number): boolean {
  if (r.midi === 'off') return false;
  if (hasOwnRouting(r)) return rackHears(r, device, channel);
  return r.id === lead;
}

/** Lock a rack as the lead (or unlock: ''). */
export function setLeadLock(ae: PlayAudioEngine | undefined, rackId: string): PlayAudioEngine {
  const out: PlayAudioEngine = { ...ae, racks: ae?.racks ?? [] };
  if (rackId && out.racks.some(r => r.id === rackId)) out.lock = rackId; else delete out.lock;
  return out;
}

/**
 * Does a message from `device` on `channel` (1..16) play this rack? A rack on
 * "any MIDI input" hears every device, the MIDI file and the keyboard stand-in
 * (device ''); one limited to a device hears that device only. The rack's
 * own computer keyboard doesn't come through here (lib/rackKeyboard.ts sends
 * to the rack directly).
 */
export function rackHears(r: Pick<AeRack, 'midi' | 'channel'>, device: string, channel: number): boolean {
  if (r.channel && channel !== r.channel) return false;
  if (r.midi === 'off') return false;
  return r.midi === '' || r.midi === device;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const num = (v: unknown, fb: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb);
const u32 = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);
const text = (v: unknown, fb: string, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : fb);

function parseUnit(raw: unknown): AeUnitRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = u32(o.type), subtype = u32(o.subtype), manufacturer = u32(o.manufacturer);
  if (type === null || subtype === null || manufacturer === null || !type) return null;
  return { type, subtype, manufacturer, name: text(o.name, fourCCText(subtype), 120), vendor: text(o.vendor, fourCCText(manufacturer), 120) };
}

function parseParams(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 512) break;
    if (/^\d{1,20}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) { out[k] = v; n++; }
  }
  return n ? out : undefined;
}

function parseZones(raw: unknown): AeZone[] {
  const out: AeZone[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= AE_ZONES_MAX) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.sampleId !== 'string' || !ID.test(o.sampleId)) continue;
    const lo = Math.round(num(o.lo, 60, 0, 127)), hi = Math.round(num(o.hi, lo, 0, 127));
    out.push({ sampleId: o.sampleId, name: text(o.name, 'Sound', 120), lo: Math.min(lo, hi), hi: Math.max(lo, hi), root: Math.round(num(o.root, lo, 0, 127)), gain: num(o.gain, 1, 0, 2) });
  }
  return out;
}

function parseSlot(raw: unknown, id?: string): AeSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const sid = id ?? (typeof o.id === 'string' && ID.test(o.id) && o.id !== AE_INST ? o.id : null);
  if (!sid) return null;
  if (o.kind === 'sampler') {
    if (sid !== AE_INST) return null; // the sample player is an instrument
    return { id: sid, kind: 'sampler', zones: parseZones(o.zones) };
  }
  if (o.kind === 'granulator') {
    if (sid !== AE_INST) return null; // an instrument too
    const slot: AeSlot = { id: sid, kind: 'granulator' };
    const params = parseParams(o.params);
    if (params) {
      const kept: Record<string, number> = {};
      for (const [a, v] of Object.entries(params)) { const p = grParam(a); if (p) kept[a] = Math.max(p.min, Math.min(p.max, v)); }
      if (Object.keys(kept).length) slot.params = kept;
    }
    const from = parseGrainFrom(o.from);
    if (from) slot.from = from;
    const rc = parseRackControls(o.controls, a => !!grParam(a));
    if (rc) slot.controls = rc;
    const sm = o.sample && typeof o.sample === 'object' ? o.sample as Record<string, unknown> : null;
    if (sm) {
      if (typeof sm.sampleId === 'string' && ID.test(sm.sampleId)) slot.sample = { sampleId: sm.sampleId, name: text(sm.name, 'Sound', 120) };
      else if (typeof sm.synth === 'string' && GR_SYNTHS.includes(sm.synth)) slot.sample = { synth: sm.synth, name: text(sm.name, GR_SYNTH_NAMES[sm.synth] ?? sm.synth, 120) };
    }
    return slot;
  }
  const unit = parseUnit(o.unit);
  if (!unit) return null;
  const slot: AeSlot = { id: sid, kind: 'au', unit };
  if (o.bypass === true) slot.bypass = true;
  const params = parseParams(o.params);
  if (params) slot.params = params;
  if (typeof o.state === 'string' && o.state.length <= 2_000_000 && /^[A-Za-z0-9+/=]+$/.test(o.state)) slot.state = o.state;
  const rc = parseRackControls(o.controls, () => true);
  if (rc) slot.controls = rc;
  return slot;
}

/** A slot's rack controls: distinct parameter addresses, at most RACK_CONTROLS_MAX. */
function parseRackControls(raw: unknown, ok: (address: string) => boolean): string[] | undefined {
  const out: string[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (out.length >= RACK_CONTROLS_MAX) break;
    if (typeof a === 'string' && /^\d{1,20}$/.test(a) && !out.includes(a) && ok(a)) out.push(a);
  }
  return out.length ? out : undefined;
}

/** A granulator's "Grains from", or undefined when it names no source. */
export function parseGrainFrom(raw: unknown): AeGrainFrom | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.source !== 'string' || !ID.test(o.source)) return undefined;
  const links: AeGrainLink[] = [];
  for (const x of Array.isArray(o.links) ? o.links : []) {
    if (links.length >= GR_FROM_LINKS_MAX || !x || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    const t = typeof l.target === 'string' ? GR_FROM_TARGETS[l.target] : undefined;
    if (!t || typeof l.prop !== 'string' || !GR_FROM_PROPS.includes(l.prop)) continue;
    const lo = Math.min(t.min, -48, 0), hi = Math.max(t.max, 20000);
    links.push({ prop: l.prop, target: l.target as string, on: l.on !== false, min: num(l.min, t.min, lo, hi), max: num(l.max, t.max, lo, hi) });
  }
  return { source: o.source, boundary: typeof o.boundary === 'string' && ID.test(o.boundary) ? o.boundary : '', births: o.births !== false, links };
}

/** The engine from a file, or undefined when it has no racks. */
export function parseAudioEngine(raw: unknown): PlayAudioEngine | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const racks: AeRack[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(a.racks) ? a.racks : []) {
    if (racks.length >= AE_RACKS_KEEP) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    const effects: AeSlot[] = [];
    const fxIds = new Set<string>();
    for (const e of Array.isArray(o.effects) ? o.effects : []) {
      if (effects.length >= AE_EFFECTS_KEEP) break;
      const s = parseSlot(e);
      if (s && !fxIds.has(s.id)) { fxIds.add(s.id); effects.push(s); }
    }
    const rack: AeRack = {
      id: o.id,
      name: text(o.name, `Rack ${racks.length + 1}`, 60),
      instrument: parseSlot(o.instrument, AE_INST),
      effects,
      keyboard: o.keyboard === true,
      midi: typeof o.midi === 'string' ? o.midi.slice(0, 120) : '',
      channel: Math.round(num(o.channel, 0, 0, 16)),
      volume: num(o.volume, 1, 0, 2),
      mute: o.mute === true,
    };
    if (typeof o.pads === 'string' && ID.test(o.pads)) rack.pads = o.pads;
    if (typeof o.source === 'string' && isSendSource(o.source)) rack.source = o.source;
    if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) rack.color = o.color;
    racks.push(rack);
  }
  if (!racks.length) return undefined;
  const lock = typeof a.lock === 'string' && racks.some(r => r.id === a.lock) ? a.lock : undefined;
  const out: PlayAudioEngine = lock ? { racks, lock } : { racks };
  if (typeof a.listenAt === 'number' && Number.isInteger(a.listenAt) && a.listenAt >= 0 && a.listenAt <= AE_EFFECTS_KEEP) out.listenAt = a.listenAt;
  return out;
}

/** The record's engine with only what `plugins` allows: without Audio Units, AU slots are left out (the sample player stays). */
export function engineWithoutPlugins(ae: PlayAudioEngine): PlayAudioEngine {
  return {
    ...ae,
    racks: ae.racks.map(r => ({ ...r, instrument: r.instrument?.kind === 'au' ? null : r.instrument, effects: [] })),
  };
}

export function isAudioEngineEmpty(ae: PlayAudioEngine | undefined): boolean {
  return !ae || ae.racks.length === 0;
}
