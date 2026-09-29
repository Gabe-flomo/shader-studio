/**
 * engineRender.ts — the Audio engine's sound in renders and recordings
 * (docs/audio-engine.md, "In renders and recordings"). Pure: no Tauri here
 * (lib/audioEngineHost.ts does the talking).
 *
 * Frame-by-frame renders: a take recorded the racks' notes (`ae:<rack>` pad
 * actions, and drum pad hits a rack follows) and their parameter controls.
 * `engineRenderJob` turns the record's racks and the take into the job the
 * native side renders offline (src-tauri/src/audio_engine/render.rs): each
 * rack as it is (units, presets, values, sample player zones), every note
 * as MIDI bytes at its second, and each automated parameter as steps where
 * it changed. The reply comes back as bytes (`decodeEngineRender`) and goes
 * under the video's other sounds, slid earlier by the latency the units
 * report (`engineRenderLead`).
 *
 * Real-time recordings: the native tap writes the engine's sound to a WAV
 * from the moment the recording starts; `engineTapOffset` says how much
 * later than the picture that file begins, for the mux.
 */
import type { PlayTake } from '../types/play';
import { AE_INST, AE_PAD_BASE_NOTE, RACK_ACT_PREFIX, aeSlot, parseAuTarget, parseMacroTarget, rackMacros, type AeRack, type AeSlot, type PlayAudioEngine } from '../types/playAudioEngine';
import { mcTargetValue } from '../play/kit/macros.js';
import { trackAt } from './takePlayback';

/** Parameter automation is sampled this often (steps only where a value changed). */
export const PARAM_STEP = 1 / 100;

export interface JobZone { sound: string; lo: number; hi: number; root: number; gain: number }
export interface JobSlot {
  id: string;
  unit?: { type: number; subtype: number; manufacturer: number };
  zones?: JobZone[];
  bypass?: boolean;
  state?: string;
  params?: Record<string, number>;
  name: string;
}
export interface JobRack {
  id: string;
  name: string;
  instrument: JobSlot | null;
  effects: JobSlot[];
  volume: number;
  mute: boolean;
  /** Its source is a web sound uploaded before the render (a send), not the instrument. */
  input: boolean;
}
export interface JobNote { t: number; rack: string; bytes: number[] }
export interface JobParam { t: number; rack: string; slot: string; address: string; value: number }

export interface EngineRenderJob {
  sampleRate: number;
  seconds: number;
  racks: JobRack[];
  events: JobNote[];
  params: JobParam[];
}

function jobSlot(s: AeSlot): JobSlot | null {
  if (s.kind === 'sampler') {
    return { id: AE_INST, name: 'Sample player', zones: (s.zones ?? []).map(z => ({ sound: z.sampleId, lo: z.lo, hi: z.hi, root: z.root, gain: z.gain })) };
  }
  if (!s.unit) return null;
  const out: JobSlot = { id: s.id, unit: { type: s.unit.type, subtype: s.unit.subtype, manufacturer: s.unit.manufacturer }, name: s.unit.name };
  if (s.bypass) out.bypass = true;
  if (s.state) out.state = s.state;
  if (s.params && Object.keys(s.params).length) out.params = { ...s.params };
  return out;
}

/** A rack as the render builds it (null: nothing would sound — no instrument and no send). */
export function jobRack(r: AeRack): JobRack | null {
  const input = !!r.source;
  const instrument = !input && r.instrument ? jobSlot(r.instrument) : null;
  if (!input && !instrument) return null;
  return {
    id: r.id, name: r.name, instrument, input,
    effects: r.effects.map(jobSlot).filter((s): s is JobSlot => !!s),
    volume: r.volume, mute: r.mute,
  };
}

/** A note as MIDI bytes: on with its velocity, or off. */
export function noteBytes(note: number, vel: number): number[] | null {
  if (!Number.isFinite(note) || note < 0 || note > 127) return null;
  return vel > 0 ? [0x90, note, Math.max(1, Math.min(127, Math.round(vel * 127)))] : [0x80, note, 0];
}

/**
 * The take's notes for the racks, as seconds into a render that starts at
 * clock time `from` and runs `length`: a rack's own notes (`ae:<rack>` pad
 * actions) and the hits of a drum pad layer it follows (pad N → note 36 + N).
 * Notes before the span are left out (a note held across its start is not
 * heard: the render starts silent).
 */
export function jobNotes(racks: readonly AeRack[], take: Pick<PlayTake, 'from' | 'events'> | null | undefined, from: number, length: number): JobNote[] {
  if (!take) return [];
  const out: JobNote[] = [];
  const ids = new Set(racks.map(r => r.id));
  for (const e of take.events) {
    if (e.do !== 'pad') continue;
    const t = take.from + e.t - from;
    if (!(t >= 0 && t < length)) continue;
    const vel = e.vel ?? 1;
    if (e.layerId.startsWith(RACK_ACT_PREFIX)) {
      const rack = e.layerId.slice(RACK_ACT_PREFIX.length);
      const bytes = ids.has(rack) ? noteBytes(Math.round(e.amount) - 1, vel) : null;
      if (bytes) out.push({ t, rack, bytes });
      continue;
    }
    for (const r of racks) {
      if (r.pads !== e.layerId) continue;
      const bytes = noteBytes(AE_PAD_BASE_NOTE + Math.round(e.amount) - 1, vel);
      if (bytes) out.push({ t, rack: r.id, bytes });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The take's parameter automation (controls on `au:` targets, and on macros:
 * each parameter the macro turns) as steps: the
 * value at 0, then every PARAM_STEP where it changed. Only for racks in `racks`.
 */
export function jobParams(racks: readonly AeRack[], take: Pick<PlayTake, 'from' | 'tracks'> | null | undefined, from: number, length: number): JobParam[] {
  if (!take) return [];
  const out: JobParam[] = [];
  const ids = new Set(racks.map(r => r.id));
  for (const tr of take.tracks) {
    if (tr.kind !== 'control' || !tr.target || !tr.keys) continue;
    // A macro's track (docs/audio-engine.md, "Macros"): each Audio Unit parameter it turns, through its curve and range.
    const mt = parseMacroTarget(tr.target);
    const rack = mt ? racks.find(r => r.id === mt.rackId) : undefined;
    const outs: Array<{ rack: string; slot: string; address: string; value: (v: number) => number }> = [];
    if (mt && rack) {
      for (const x of rackMacros(rack)[mt.n - 1].targets) if (aeSlot(rack, x.slot)?.kind === 'au') outs.push({ rack: rack.id, slot: x.slot, address: x.address, value: v => mcTargetValue(v, x) });
    } else {
      const t = parseAuTarget(tr.target);
      if (!t || !ids.has(t.rackId)) continue;
      outs.push({ rack: t.rackId, slot: t.slotId, address: t.address, value: v => v });
    }
    if (!outs.length) continue;
    let last: number | undefined;
    for (let s = 0; s < length; s += PARAM_STEP) {
      const v = trackAt(tr, from + s - take.from);
      const n = typeof v === 'number' ? v : v[0];
      if (!Number.isFinite(n) || n === last) continue;
      last = n;
      for (const o of outs) out.push({ t: Math.round(s * 1e6) / 1e6, rack: o.rack, slot: o.slot, address: o.address, value: o.value(n) });
    }
  }
  return out;
}

/**
 * The job for a render of `length` seconds from clock time `from`, or null
 * when the engine would be silent: no rack with an instrument or a send, or
 * (without a send) no notes in the span.
 */
export function engineRenderJob(ae: PlayAudioEngine | undefined, take: PlayTake | null | undefined, from: number, length: number, sampleRate = 48000): EngineRenderJob | null {
  const racks = (ae?.racks ?? []).map(jobRack).filter((r): r is JobRack => !!r);
  if (!racks.length || !(length > 0)) return null;
  const src = (ae?.racks ?? []).filter(r => racks.some(j => j.id === r.id));
  const events = jobNotes(src, take, from, length);
  const params = jobParams(src, take, from, length);
  if (!events.length && !racks.some(r => r.input)) return null;
  return { sampleRate, seconds: length, racks, events, params };
}

// ── The reply ────────────────────────────────────────────────────────────────

export interface EngineRender {
  sampleRate: number;
  frames: number;
  left: Float32Array;
  right: Float32Array;
  /** Seconds of latency each rack's units report. */
  latency: Record<string, number>;
  /** What was left out or approximate (a unit that wouldn't load offline…). */
  notes: string[];
  racks: string[];
}

/** The native reply: u32 LE JSON length, the JSON, left f32 LE, right f32 LE. Null when it isn't one. */
export function decodeEngineRender(raw: ArrayBuffer | Uint8Array): EngineRender | null {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.byteLength < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(0, true);
  if (4 + len > bytes.byteLength) return null;
  let info: Record<string, unknown>;
  try { info = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as Record<string, unknown>; } catch { return null; }
  const frames = typeof info.frames === 'number' && Number.isFinite(info.frames) ? Math.max(0, Math.floor(info.frames)) : 0;
  const sampleRate = typeof info.sampleRate === 'number' && info.sampleRate > 0 ? info.sampleRate : 48000;
  if (bytes.byteLength < 4 + len + frames * 8) return null;
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let o = 4 + len;
  for (let i = 0; i < frames; i++, o += 4) left[i] = view.getFloat32(o, true);
  for (let i = 0; i < frames; i++, o += 4) right[i] = view.getFloat32(o, true);
  const latency: Record<string, number> = {};
  if (info.latency && typeof info.latency === 'object') {
    for (const [k, v] of Object.entries(info.latency as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) latency[k] = v;
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { sampleRate, frames, left, right, latency, notes: strings(info.notes), racks: strings(info.racks) };
}

/** How far to slide the rendered sound earlier (seconds): the largest latency a rack reported. */
export function engineRenderLead(r: Pick<EngineRender, 'latency'>): number {
  return Math.max(0, ...Object.values(r.latency));
}

/** The render as an AudioBuffer of `ctx` (resampled by the context when the rates differ). */
export function engineRenderBuffer(ctx: BaseAudioContext, r: EngineRender): AudioBuffer {
  const b = ctx.createBuffer(2, Math.max(1, r.frames), r.sampleRate);
  b.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
  return b;
}

/**
 * Put the render into an offline mix from its start, slid earlier by the units'
 * latency so a note lands where the take heard it. Straight into `into`
 * (the destination: live, the engine goes to its own output, past the page's
 * master chain).
 */
export function placeEngineRender(ctx: BaseAudioContext, r: EngineRender, into: AudioNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = engineRenderBuffer(ctx, r);
  src.connect(into);
  src.start(0, Math.min(engineRenderLead(r), Math.max(0, r.frames / r.sampleRate)));
  return src;
}

/** Interleaved stereo frames of a mixed buffer (mono goes to both sides), for a send's upload. */
export function interleave(b: AudioBuffer): Float32Array {
  const n = b.length;
  const l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[i * 2] = l[i]; out[i * 2 + 1] = r[i]; }
  return out;
}

// ── Real-time recordings ────────────────────────────────────────────────────

export interface TapDone { path: string; frames: number; sampleRate: number; offset: number; lost: number }

/**
 * Seconds the engine's WAV starts later than the recording's picture: the tap
 * was asked for at `tapAt` (ms, performance.now) and its first frame came
 * `offset` seconds after that; the recorder started at `recAt` (ms).
 */
export function engineTapOffset(tapAt: number, offset: number, recAt: number): number {
  const s = (tapAt - recAt) / 1000 + (Number.isFinite(offset) ? Math.max(0, offset) : 0);
  return Math.round(Math.max(-5, Math.min(5, s)) * 1e4) / 1e4;
}
