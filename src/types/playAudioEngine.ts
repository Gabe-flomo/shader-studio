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
 * Pure: types, parsing, targets and record edits. lib/audioEngineHost.ts runs it.
 */

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

export interface AeSlot {
  /** `inst` for the instrument; an effect's own id. */
  id: string;
  kind: 'au' | 'sampler';
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
}

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
}

export interface PlayAudioEngine {
  racks: AeRack[];
}

export const AE_RACKS_MAX = 16;
export const AE_EFFECTS_MAX = 12;
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

/** Does a target name a slot the record has (an Audio Unit one)? */
export function auTargetExists(ae: PlayAudioEngine | undefined, target: string): boolean {
  const t = parseAuTarget(target);
  const s = t ? aeSlot(aeRack(ae, t.rackId), t.slotId) : undefined;
  return !!s && s.kind === 'au';
}

/** A target's value as the record keeps it, or undefined (never set on the card, or gone). */
export function readAuValue(ae: PlayAudioEngine | undefined, target: string): number | undefined {
  const t = parseAuTarget(target);
  if (!t) return undefined;
  const v = aeSlot(aeRack(ae, t.rackId), t.slotId)?.params?.[t.address];
  return typeof v === 'number' ? v : undefined;
}

/** "Rack 1 · Juno · Cutoff" style labels: the rack and the slot's name. */
export function aeSlotLabel(rack: AeRack, slot: AeSlot): string {
  const what = slot.kind === 'sampler' ? 'Sample player' : slot.unit?.name ?? 'Audio Unit';
  return `${rack.name} · ${what}`;
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
  return { racks: (ae?.racks ?? []).map(r => ({ ...r, keyboard: on && r.id === rackId })) };
}

/** The rack the computer keyboard plays, if any. */
export function keyboardRack(ae: PlayAudioEngine | undefined): AeRack | undefined {
  return ae?.racks.find(r => r.keyboard);
}

export function patchRack(ae: PlayAudioEngine | undefined, rackId: string, patch: Partial<AeRack> | ((r: AeRack) => AeRack)): PlayAudioEngine {
  const racks = (ae?.racks ?? []).map(r => (r.id === rackId ? (typeof patch === 'function' ? patch(r) : { ...r, ...patch }) : r));
  return { racks };
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
  return controls.filter(c => !parseAuTarget(c.target) || auTargetExists(ae, c.target));
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
  const unit = parseUnit(o.unit);
  if (!unit) return null;
  const slot: AeSlot = { id: sid, kind: 'au', unit };
  if (o.bypass === true) slot.bypass = true;
  const params = parseParams(o.params);
  if (params) slot.params = params;
  if (typeof o.state === 'string' && o.state.length <= 2_000_000 && /^[A-Za-z0-9+/=]+$/.test(o.state)) slot.state = o.state;
  return slot;
}

/** The engine from a file, or undefined when it has no racks. */
export function parseAudioEngine(raw: unknown): PlayAudioEngine | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const racks: AeRack[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(a.racks) ? a.racks : []) {
    if (racks.length >= AE_RACKS_MAX) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    const effects: AeSlot[] = [];
    const fxIds = new Set<string>();
    for (const e of Array.isArray(o.effects) ? o.effects : []) {
      if (effects.length >= AE_EFFECTS_MAX) break;
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
    racks.push(rack);
  }
  return racks.length ? { racks } : undefined;
}

/** The record's engine with only what `plugins` allows: without Audio Units, AU slots are left out (the sample player stays). */
export function engineWithoutPlugins(ae: PlayAudioEngine): PlayAudioEngine {
  return {
    racks: ae.racks.map(r => ({ ...r, instrument: r.instrument?.kind === 'au' ? null : r.instrument, effects: [] })),
  };
}

export function isAudioEngineEmpty(ae: PlayAudioEngine | undefined): boolean {
  return !ae || ae.racks.length === 0;
}
