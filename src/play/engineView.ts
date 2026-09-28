/**
 * engineView.ts — the Audio engine's Arrangement view as data (docs/arrangement.md,
 * "The Arrangement view"): the tracks (one per rack), the clips on each lane
 * and the waveform each draws, the selected track's device chain (with the
 * Listener among its effects), the bar/beat ruler, and the transport's
 * play/pause/stop rules. The components in components/play/engine/ draw what
 * these return; the tests check them without React.
 *
 * Pure.
 */
import { beatSeconds, trackClips, type ArrClip, type ArrTrack, type PlayArrangement } from '../types/playArrangement';
import { AE_INST, aeSlotName, hasOwnRouting, leadRackId, type AeRack, type AeSlot, type PlayAudioEngine } from '../types/playAudioEngine';

// ── Tracks ──────────────────────────────────────────────────────────────────

/** Track colours, by position when a rack has none of its own. */
export const TRACK_COLORS = ['#ff7a59', '#f5a524', '#e8cf3a', '#7ccf4f', '#35c3a4', '#4aa3ff', '#9b82ff', '#ff6fb1'] as const;

export const trackColor = (rack: Pick<AeRack, 'color'>, index: number): string => rack.color ?? TRACK_COLORS[index % TRACK_COLORS.length];

export type TrackInstrument = 'au' | 'sampler' | 'granulator' | 'send' | 'none';

export interface TrackRow {
  id: string;
  name: string;
  color: string;
  instrument: TrackInstrument;
  /** What plays on it: the instrument's name, "A send", "No instrument". */
  instrumentName: string;
  /** Takes the MIDI no rack's own routing claims (docs/audio-engine.md, "The lead rack"). */
  lead: boolean;
  locked: boolean;
  /** Has its own MIDI device or channel. */
  ownRouting: boolean;
  selected: boolean;
  arm: boolean;
  /** Silent: the rack muted (live and on the tape). */
  mute: boolean;
  solo: boolean;
  volume: number;
  clips: number;
  /** The audio readers listen to it (its chain has the Listener). */
  listening: boolean;
}

/** One track per rack, in the racks' order: adding a rack adds a track. */
export function engineTracks(ae: PlayAudioEngine | undefined, arr: PlayArrangement | undefined, selected: string, readersInput = ''): TrackRow[] {
  const racks = ae?.racks ?? [];
  const lead = leadRackId(ae, selected);
  return racks.map((r, i) => {
    const t = arr?.tracks[r.id];
    return {
      id: r.id,
      name: r.name,
      color: trackColor(r, i),
      instrument: r.source ? 'send' : r.instrument ? r.instrument.kind : 'none',
      instrumentName: r.source ? 'A send' : r.instrument ? aeSlotName(r.instrument) : 'No instrument',
      lead: r.id === lead,
      locked: r.id === ae?.lock,
      ownRouting: hasOwnRouting(r),
      selected: r.id === (selected || lead),
      arm: t?.arm !== false,
      mute: r.mute || !!t?.mute,
      solo: !!t?.solo,
      volume: r.volume,
      clips: trackClips(t, arr?.length ?? 0).length,
      listening: readersInput === `engine:${r.id}`,
    };
  });
}

/** Racks after moving `id` to position `to` (tracks reorder by dragging their header). */
export function moveTrack(ae: PlayAudioEngine, id: string, to: number): PlayAudioEngine {
  const i = ae.racks.findIndex(r => r.id === id);
  if (i < 0) return ae;
  const racks = [...ae.racks];
  const [r] = racks.splice(i, 1);
  racks.splice(Math.max(0, Math.min(racks.length, to > i ? to - 1 : to)), 0, r);
  return racks.every((x, k) => x === ae.racks[k]) ? ae : { ...ae, racks };
}

// ── Clips ───────────────────────────────────────────────────────────────────

/** Waveform columns a clip's picture is drawn from. */
export const CLIP_COLUMNS = 160;

export interface ClipWave {
  /** 'audio': the track's rendered sound; 'envelope': drawn from the notes' velocities and density, when the sound isn't available here. */
  kind: 'audio' | 'envelope';
  /** 0..1 per column, drawn mirrored around the middle. */
  peaks: Float32Array;
}

/** A small repeatable noise (0..1) so an envelope has the grain of a sound, not a smooth curve. */
function grain(i: number, seed: number): number {
  let x = (i * 374761393 + seed * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

/**
 * What a clip draws: the track's rendered waveform over the clip's span
 * (`preview`: peaks over [0, previewLength]), or, without one, an envelope
 * shaped like a sound from the notes: each note a quick attack, a decay to a
 * sustain while held and a short release, scaled by its velocity, summed, with
 * a little grain. Never notes as bars: a clip looks like audio.
 */
export function clipWave(track: Pick<ArrTrack, 'notes'> | undefined, clip: ArrClip, columns = CLIP_COLUMNS, preview?: { peaks: Float32Array; length: number } | null): ClipWave {
  const peaks = new Float32Array(Math.max(1, columns));
  const dt = clip.d / peaks.length;
  if (preview && preview.length > 0 && preview.peaks.length) {
    const n = preview.peaks.length;
    // A quiet track is drawn bigger (up to 4×, the loudest peak at 0.9), the same for all its clips.
    const gain = displayGain(preview.peaks);
    for (let c = 0; c < peaks.length; c++) {
      const a = Math.floor(((clip.t + c * dt) / preview.length) * n), b = Math.max(a + 1, Math.floor(((clip.t + (c + 1) * dt) / preview.length) * n));
      let m = 0;
      for (let i = Math.max(0, a); i < Math.min(n, b); i++) m = Math.max(m, preview.peaks[i]);
      peaks[c] = Math.min(1, m * gain);
    }
    return { kind: 'audio', peaks };
  }
  const notes = (track?.notes ?? []).filter(n => n.t < clip.t + clip.d && n.t + n.d + RELEASE > clip.t);
  const seed = Math.round(clip.t * 1000);
  let max = 0;
  for (let c = 0; c < peaks.length; c++) {
    const t = clip.t + (c + 0.5) * dt;
    let e = 0;
    for (const n of notes) e += n.v * noteEnvelope(t - n.t, n.d);
    const v = e > 0 ? Math.tanh(e) * (0.72 + 0.28 * grain(c, seed)) : 0;
    peaks[c] = v;
    max = Math.max(max, v);
  }
  if (max > 0) for (let c = 0; c < peaks.length; c++) peaks[c] = (peaks[c] / max) * 0.92;
  return { kind: 'envelope', peaks };
}

const gains = new WeakMap<Float32Array, number>();
/** How much a track's waveform is scaled for drawing: its loudest peak to 0.9, at most 4×, never down. */
export function displayGain(peaks: Float32Array): number {
  let g = gains.get(peaks);
  if (g === undefined) {
    let m = 0;
    for (const v of peaks) m = Math.max(m, v);
    g = m > 0 ? Math.max(1, Math.min(4, 0.9 / m)) : 1;
    gains.set(peaks, g);
  }
  return g;
}

const ATTACK = 0.006, DECAY = 0.25, SUSTAIN = 0.55, RELEASE = 0.18;

/** A note's loudness `s` seconds after it starts, held `d` seconds (ADSR-like). */
function noteEnvelope(s: number, d: number): number {
  if (s < 0) return 0;
  const held = (x: number) => (x < ATTACK ? x / ATTACK : SUSTAIN + (1 - SUSTAIN) * Math.exp(-(x - ATTACK) / DECAY));
  if (s <= d) return held(s);
  const r = s - d;
  return r > RELEASE * 3 ? 0 : held(d) * Math.exp(-r / RELEASE);
}

// ── The device chain ────────────────────────────────────────────────────────

export type Device =
  /** What plays the track: MIDI input and channel, the computer keyboard, a send, the keys. */
  | { kind: 'input'; key: 'input' }
  /** The instrument (null: none chosen yet). */
  | { kind: 'instrument'; key: 'inst'; slot: AeSlot | null }
  /** A send: a page sound instead of an instrument (desktop). */
  | { kind: 'send'; key: 'send' }
  /** A Granulator's own Sound chain (Finish → Sound, `rack:<id>`). */
  | { kind: 'soundfx'; key: 'soundfx' }
  /** An effect; `heard`: it shapes the sound here (Audio Units play in the desktop app, and not after a Granulator). */
  | { kind: 'effect'; key: string; slot: AeSlot; index: number; heard: boolean }
  /** The audio readers' tap. `at`: after this many effects; `exact`: it reads there (else after the chain, for now). */
  | { kind: 'listener'; key: 'listener'; at: number; exact: boolean };

/** The key the Listener has among the movable devices. */
export const LISTENER = 'listener';

/** Does this effect shape the sound where the engine runs? */
export function effectHeard(rack: Pick<AeRack, 'instrument' | 'source'>, slot: AeSlot, native: boolean): boolean {
  if (slot.bypass || slot.kind !== 'au' || !native) return false;
  return !(rack.instrument?.kind === 'granulator' && !rack.source);
}

/**
 * Where a Listener after `at` effects reads. The engines tap a rack at its
 * end only (the desktop engine's FFT is on the rack's mixer; the browser's
 * analyser after its volume), so a Listener reads exactly where it sits when
 * nothing heard comes after it, and otherwise after the whole chain.
 */
export function listenerExact(rack: Pick<AeRack, 'instrument' | 'source' | 'effects'>, at: number, native: boolean): boolean {
  return rack.effects.slice(Math.max(0, at)).every(e => !effectHeard(rack, e, native));
}

/** A track's devices left to right: input, instrument (or send), a Granulator's Sound chain, the effects, the Listener among them. */
export function deviceChain(rack: AeRack, o: { listening: boolean; listenAt?: number; native: boolean }): Device[] {
  const out: Device[] = [{ kind: 'input', key: 'input' }];
  if (rack.source) out.push({ kind: 'send', key: 'send' });
  else out.push({ kind: 'instrument', key: AE_INST, slot: rack.instrument });
  if (rack.instrument?.kind === 'granulator' && !rack.source) out.push({ kind: 'soundfx', key: 'soundfx' });
  const n = rack.effects.length;
  const at = Math.max(0, Math.min(n, o.listenAt ?? n));
  rack.effects.forEach((slot, index) => {
    if (o.listening && index === at) out.push({ kind: 'listener', key: LISTENER, at, exact: listenerExact(rack, at, o.native) });
    out.push({ kind: 'effect', key: slot.id, slot, index, heard: effectHeard(rack, slot, o.native) });
  });
  if (o.listening && at === n) out.push({ kind: 'listener', key: LISTENER, at, exact: true });
  return out;
}

/** The movable devices' keys in order (effects' ids, and LISTENER where it sits). */
export const chainOrder = (devices: readonly Device[]): string[] => devices.filter(d => d.kind === 'effect' || d.kind === 'listener').map(d => d.key);

/**
 * `order` with `key` dropped before position `to` of the list as it was (to =
 * order.length: at the end). The same array when nothing moves.
 */
export function reorderChain(order: readonly string[], key: string, to: number): string[] {
  const i = order.indexOf(key);
  if (i < 0) return [...order];
  const out = order.filter(k => k !== key);
  out.splice(Math.max(0, Math.min(out.length, to > i ? to - 1 : to)), 0, key);
  return out;
}

/** The engine with a rack's effects in `order`'s order and the Listener where `order` has it. */
export function applyChainOrder(ae: PlayAudioEngine, rackId: string, order: readonly string[]): PlayAudioEngine {
  const rack = ae.racks.find(r => r.id === rackId);
  if (!rack) return ae;
  const byId = new Map(rack.effects.map(e => [e.id, e]));
  const effects = order.filter(k => byId.has(k)).map(k => byId.get(k)!);
  for (const e of rack.effects) if (!effects.includes(e)) effects.push(e);
  const out: PlayAudioEngine = { ...ae, racks: ae.racks.map(r => (r.id === rackId ? { ...r, effects } : r)) };
  const li = order.indexOf(LISTENER);
  if (li >= 0) {
    const at = order.slice(0, li).filter(k => byId.has(k)).length;
    if (at >= effects.length) delete out.listenAt; else out.listenAt = at;
  }
  return out;
}

// ── The ruler ───────────────────────────────────────────────────────────────

export interface RulerTick { t: number; bar: number; beat: number; label: string }

/**
 * Bar and beat lines over [0, span] at `bpm` in 4/4, thinned so labels are
 * at least `minPx` apart on a ruler `width` px wide: every bar labelled
 * ("1", "2"…), beats between them when there's room.
 */
export function rulerTicks(span: number, bpm: number, width: number, minPx = 36): RulerTick[] {
  const beat = beatSeconds(bpm), bar = beat * 4;
  if (!(span > 0) || !(width > 0)) return [];
  const pxBar = (bar / span) * width;
  const every = Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1, minPx / Math.max(1e-6, pxBar))))));
  const beats = pxBar / 4 >= 10 && every === 1;
  const out: RulerTick[] = [];
  const bars = Math.floor(span / bar + 1e-9);
  for (let b = 0; b <= bars; b++) {
    if (b % every === 0) out.push({ t: round6(b * bar), bar: b + 1, beat: 1, label: String(b + 1) });
    if (beats) for (let k = 1; k < 4; k++) { const t = b * bar + k * beat; if (t <= span + 1e-9) out.push({ t: round6(t), bar: b + 1, beat: k + 1, label: '' }); }
  }
  return out;
}

/** Tape seconds as bars.beats.sixteenths (1-based, like a DAW): 0 → "1.1.1". Before 0 (a count-in): "-1.4.1" style, counting back. */
export function barsBeats(t: number, bpm: number): string {
  const s = beatSeconds(bpm) / 4;
  const six = Math.floor(t / s + 1e-6);
  const neg = six < 0;
  const a = Math.abs(neg ? six + 1 : six);
  const bar = Math.floor(a / 16), beat = Math.floor((a % 16) / 4), sx = a % 4;
  return neg ? `-${bar + 1}.${4 - beat}.${4 - sx}` : `${bar + 1}.${beat + 1}.${sx + 1}`;
}

// ── The transport ───────────────────────────────────────────────────────────

export type TransportPhase = 'stopped' | 'playing' | 'counting' | 'recording';
export type TransportCommand = 'toggle' | 'stop' | 'record';

/**
 * What a transport button does (lib/tape.ts runs it):
 *
 *   toggle   stopped → play from the record point; playing or recording →
 *            pause (a recording is kept) where the tape is, so the next play
 *            carries on from there; counting in → cancel, staying put
 *   stop     stops whatever runs (a recording is kept) and goes back to the start
 *   record   as before: stopped → record from the point (after a count-in),
 *            playing → punch in, recording or counting → stop recording
 *
 * `point`: where the record point goes afterwards (null: unchanged).
 */
export function transportPlan(cmd: TransportCommand, s: { phase: TransportPhase; position: number }): { stop: boolean; play: boolean; record: boolean; point: number | null } {
  const running = s.phase !== 'stopped';
  if (cmd === 'stop') return { stop: running, play: false, record: false, point: 0 };
  if (cmd === 'record') return { stop: false, play: false, record: true, point: null };
  if (!running) return { stop: false, play: true, record: false, point: null };
  if (s.phase === 'counting') return { stop: true, play: false, record: false, point: null };
  return { stop: true, play: false, record: false, point: Math.max(0, round6(s.position)) };
}

function round6(v: number): number { return Math.round(v * 1e6) / 1e6 + 0; }
