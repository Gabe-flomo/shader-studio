/**
 * recordingAudio.ts — the sound that goes into a recording.
 *
 * Only songs already in Playfield: a song loaded into a Play audio layer
 * (it follows the graph clock), a Video layer's sound when its Sound is Play
 * (it follows the clock as its picture does: start + t × speed, looped or
 * stopping at the end; Listen layers are analysed, never heard, so never
 * mixed), and an Audio Input node's file while it plays. Never the
 * microphone: live input is for performing, and what a recording animates
 * should be baked in, not coming in while it records.
 *
 *   real time (the browser's recorder)  the songs as they play, tapped from
 *                                       the audio engine's record bus
 *   frame by frame (FFmpeg)             the same songs mixed offline for the
 *                                       export's length, from the clock's 0,
 *                                       as a WAV FFmpeg muxes in
 *
 * Drum pad layers are heard when something hits them: real time takes them
 * off the record bus like any sound, and a frame-by-frame render of a take
 * plays its recorded hits at the exact moment each landed (`padHits`),
 * through the same sampler (play/kit/drumPads.js), numbers from the take.
 *
 * Both carry the audio effects: real time taps the mix after the master
 * chain (audioEngine.ts), and the offline mix builds the same chains
 * (audioFxOffline.ts), following a take's recorded numbers when it has them.
 *
 * The Audio engine's racks (desktop) are tracks too (`engine:<rack>`): a
 * frame-by-frame render of a take has them rendered offline natively
 * (engineRender.ts) and put straight under the mix (`MixFx.engine`; live,
 * the engine goes to its own output, past the page's master chain); a
 * real-time recording gets them from the engine's tap, muxed in afterwards
 * (ExportModal). A rack fed by a web sound (a send) takes that sound out of
 * the mix (`sentTracks`): it's heard through the rack instead.
 *
 * Granulator racks (docs/granulator.md) run in Web Audio, so real time
 * records them off the record bus, and a frame-by-frame render replays the
 * take's notes and mapped settings into the kit's pure grain engine
 * (grRender: seeded, every note on its exact sample), through the rack's
 * Sound chain (`rack:<id>`), its volume and the master chain (`grainTracks`).
 */
import { audioEngine, trackChainId } from './audioEngine';
import type { PlayRecord } from '../types/play';
import { layerChainId, MASTER_CHAIN, type PlayAudioFx } from '../types/playAudioFx';
import { AE_INST, RACK_ACT_PREFIX, auPropId, isGranulatorRack, type AeRack, type AeSlot, type PlayAudioEngine, type RackMacro } from '../types/playAudioEngine';
import { macroValueAt } from '../play/rackMacros';
import { rackChainId } from '../types/playAudioFx';
import { grRender, grSettings } from '../play/kit/granulator.js';
import { grainBuffer } from './webGranulator';
import { grainLog } from './grainFrom';
import { placeEngineRender, type EngineRender } from './engineRender';
import { offlineFx, type ValueAt } from './audioFxOffline';
import type { GraphNode } from '../types/nodeGraph';
import { videoLayerTimeAt, type VideoLayer } from '../types/playLayers';
import { videoSound } from './videoSound';
import { padSound } from './padSound';
import { dpCreateSampler, dpHitNumbers, dpKey } from '../play/kit/drumPads.js';
import type { DrumPad, DrumPadLayer } from '../types/playLayers';

export interface RecordingTrack {
  key: string;
  label: string;
  /** Follows the graph clock (a Play song, a video layer) or plays from its start (an Audio Input node). */
  clock: boolean;
  /** A Video layer's sound: its file and how it plays (else the track is a song in the audio engine, by `key`). */
  video?: VideoTrack;
  /** The effect chain it goes through (types/playAudioFx.ts); absent: straight to the master chain. */
  chain?: string;
  /** A Drum pad layer: its pads and their samples (it sounds only where a take hits it). */
  pads?: PadTrack;
  /** An Audio engine rack (desktop): rendered natively, or tapped in real time; never mixed here itself. */
  engine?: { rackId: string; source?: string };
  /** A Granulator rack: its settings when the export starts and its decoded sample (it sounds from a take's notes, or its Drone). */
  grain?: GrainTrack;
}

export interface GrainTrack {
  rackId: string; slot: AeSlot; buffer: AudioBuffer; volume: number;
  /** The rack's macros: a take's macro tracks turn the settings they target (docs/audio-engine.md, "Macros"). */
  macros?: RackMacro[];
}

/** Granulator racks as tracks, when their sample is decoded here (a muted one is left out). */
export function grainTracks(racks: readonly AeRack[] | undefined, bufferOf: (r: AeRack) => AudioBuffer | null = r => grainBuffer(r.instrument?.sample)): RecordingTrack[] {
  const out: RecordingTrack[] = [];
  for (const r of racks ?? []) {
    if (!isGranulatorRack(r) || r.source || r.mute) continue;
    const buffer = bufferOf(r);
    if (buffer) out.push({ key: `grain:${r.id}`, label: `Audio engine · ${r.name}`, clock: true, chain: rackChainId(r.id), grain: { rackId: r.id, slot: r.instrument!, buffer, volume: r.volume, ...(r.macros ? { macros: r.macros } : {}) } });
  }
  return out;
}

/** The Audio engine's racks as tracks: each with an instrument or a send (`native`: the desktop engine runs). */
export function engineTracks(racks: readonly AeRack[] | undefined, native: boolean): RecordingTrack[] {
  if (!native) return [];
  // Granulators are mixed on the web side (grainTracks), never rendered natively.
  return (racks ?? []).filter(r => r.source || (r.instrument && !isGranulatorRack(r))).map(r => ({
    key: `engine:${r.id}`, label: `Audio engine · ${r.name}`, clock: true, engine: { rackId: r.id, ...(r.source ? { source: r.source } : {}) },
  }));
}

/**
 * Split the tracks by the sends: `direct` are mixed as they are; `sent` maps
 * a sending rack to the tracks it takes (a 'master' send takes every track;
 * a chain send the tracks on that chain). A sent track isn't heard directly.
 */
export function sentTracks(tracks: readonly RecordingTrack[]): { direct: RecordingTrack[]; sent: Map<string, RecordingTrack[]> } {
  const sends = tracks.filter(t => t.engine?.source).map(t => t.engine!);
  const web = tracks.filter(t => !t.engine);
  const sent = new Map<string, RecordingTrack[]>();
  const taken = new Set<RecordingTrack>();
  for (const s of sends) {
    const mine = web.filter(t => (s.source === MASTER_CHAIN ? true : (t.chain ?? MASTER_CHAIN) === s.source));
    sent.set(s.rackId, mine);
    for (const t of mine) taken.add(t);
  }
  return { direct: tracks.filter(t => !taken.has(t)), sent };
}

/** The effects for a send's own mix: a chain send keeps its chain's effects but not the master chain's (the send leaves before it). */
export function sendFx(fx: PlayAudioFx | undefined, source: string): PlayAudioFx | undefined {
  if (!fx || source === MASTER_CHAIN) return fx;
  const chains = { ...fx.chains };
  delete chains[MASTER_CHAIN];
  return { ...fx, chains };
}

/** A Drum pad layer in a mix: its settings when the export starts, and each pad's decoded sample. */
export interface PadTrack {
  layerId: string;
  layer: Pick<DrumPadLayer, 'volume' | 'pads'> & Record<string, unknown>;
  buffers: ReadonlyArray<AudioBuffer | null>;
}

/** A drum pad hit in a mix: `t` seconds into it, pad 0-based, velocity (0 lets a gate pad go). */
export interface PadHit { layerId: string; pad: number; vel: number; t: number }

/** A take's pad hits as seconds into a mix starting at clock time `from`. */
export function padHitsOf(take: { from: number; events: ReadonlyArray<{ t: number; do: string; layerId: string; amount: number; vel?: number }> } | null | undefined, from: number, length = Infinity): PadHit[] {
  if (!take) return [];
  return take.events
    .filter(e => e.do === 'pad')
    .map(e => ({ layerId: e.layerId, pad: Math.round(e.amount) - 1, vel: e.vel ?? 1, t: take.from + e.t - from }))
    .filter(h => h.t >= 0 && h.t < length && h.pad >= 0);
}

/** A Drum pad layer as a track, when any of its pads has a sample open here. */
export function padTrackOf(l: DrumPadLayer, bufferOf: (p: DrumPad) => AudioBuffer | null): RecordingTrack | null {
  if (!l.visible) return null;
  const buffers = l.pads.map(p => bufferOf(p));
  if (!buffers.some(Boolean)) return null;
  return { key: `dpad:${l.id}`, label: l.label, clock: true, chain: layerChainId(l.id), pads: { layerId: l.id, layer: l as unknown as PadTrack['layer'], buffers } };
}

/** The audio effects for an offline mix: the record's chains, and each number through the mix (default: the record's). */
export interface MixFx {
  fx: PlayAudioFx | undefined;
  valueAt?: ValueAt;
  /** Drum pad hits (a take's), in mix seconds. */
  padHits?: readonly PadHit[];
  /** The Audio engine's racks, rendered natively for this span (engineRender.ts): put straight under the mix. */
  engine?: EngineRender | null;
}

/** How a Video layer's sound plays against the clock (its layer's settings when the export starts). */
export interface VideoTrack {
  layerId: string;
  file: Blob;
  /** The video's length in seconds (0 while unknown: the sound's own length is used). */
  duration: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  start: number;
  volume: number;
}

/** A video layer's sound as a track, when it's heard (Sound: Play) and its file is open here. */
export function videoTrackOf(l: VideoLayer, file: { blob: Blob; duration: number } | null): RecordingTrack | null {
  if (l.sound !== 'play' || !file) return null;
  return {
    key: `vlayer:${l.id}`, label: l.fileName || l.label, clock: true, chain: layerChainId(l.id),
    video: { layerId: l.id, file: file.blob, duration: file.duration, playing: l.playing, loop: l.loop, speed: l.speed, start: l.start, volume: Math.max(0, Math.min(1, l.volume)) },
  };
}

/**
 * Where a video layer's sound goes in a mix `length` seconds long starting at
 * clock time `from`: the offset into its sound, the rate, the gain, whether
 * it loops (and where), and when it stops (seconds into the mix; null: it
 * runs to the end). Null when it makes no sound in that span (paused: the
 * layer holds its start frame; past the end without Loop; silent).
 */
export function videoTrackPlan(v: Pick<VideoTrack, 'duration' | 'playing' | 'loop' | 'speed' | 'start' | 'volume'>, soundLength: number, from: number, length: number):
  { offset: number; rate: number; gain: number; loop: boolean; loopEnd: number; stopAt: number | null } | null {
  if (!v.playing || !(v.volume > 0) || !(soundLength > 0) || !(length > 0)) return null;
  const d = v.duration > 0 && Number.isFinite(v.duration) ? v.duration : soundLength;
  const end = Math.min(d, soundLength);
  const rate = v.speed > 0 ? v.speed : 1;
  let offset = videoLayerTimeAt(Math.max(0, from), d, rate, v.loop, v.start);
  if (v.loop) { offset %= end; return { offset, rate, gain: v.volume, loop: true, loopEnd: end, stopAt: null }; }
  if (offset >= end - 0.001) return null;
  const stopAt = (end - offset) / rate;
  return { offset, rate, gain: v.volume, loop: false, loopEnd: end, stopAt: stopAt < length ? stopAt : null };
}

/** A video file's sound, decoded once per file (null when it has none this browser can decode). */
const decoded = new WeakMap<Blob, Promise<AudioBuffer | null>>();
function decodeVideoSound(file: Blob, sampleRate: number): Promise<AudioBuffer | null> {
  let p = decoded.get(file);
  if (!p) {
    p = file.arrayBuffer()
      .then(buf => new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(buf))
      .catch(() => null);
    decoded.set(file, p);
  }
  return p;
}

/** The songs (and heard video layers) a recording would carry right now. */
export function recordingTracks(play: PlayRecord, nodes: readonly GraphNode[]): RecordingTrack[] {
  const out: RecordingTrack[] = [];
  for (const l of play.layers) {
    // A video layer is heard hidden too (it keeps running while its sound is on).
    if (l.kind === 'video') { const t = videoTrackOf(l, videoSound.file(l.id)); if (t) out.push(t); continue; }
    if (l.kind === 'drumpad') { const t = padTrackOf(l, p => padSound.buffer(p)); if (t) out.push(t); continue; }
    if (l.kind !== 'audio' || !l.visible || (l as { input?: string }).input !== 'file') continue;
    const key = `layer:${l.id}`;
    if (audioEngine.isLoaded(key)) out.push({ key, label: audioEngine.getFileName(key) || l.label, clock: true, chain: trackChainId(key) });
  }
  for (const n of nodes) {
    if (n.type !== 'audioInput' || !audioEngine.isPlaying(n.id)) continue;
    out.push({ key: n.id, label: audioEngine.getFileName(n.id) || 'Audio Input', clock: false, chain: trackChainId(n.id) });
  }
  return out;
}

/**
 * The tracks mixed for `duration` seconds starting at clock time `from`:
 * clock songs at that point in the song (looped), others from their start,
 * each through its effect chain and all through the master chain (`fx`).
 * Null when there's nothing to mix.
 */
export async function mixdown(tracks: readonly RecordingTrack[], duration: number, from = 0, sampleRate = 48000, fx?: MixFx): Promise<AudioBuffer | null> {
  const songs = tracks.filter(t => !t.video && !t.pads && !t.engine).map(t => ({ t, b: audioEngine.buffer(t.key) })).filter((x): x is { t: RecordingTrack; b: AudioBuffer } => !!x.b);
  return mixBuffers(tracks.filter(t => t.video || t.pads || t.grain), songs, duration, from, sampleRate, fx);
}

/** mixdown with the songs' buffers in hand (tests give a generated tone); `tracks` are the Video layers' sounds and the Drum pad layers. */
export async function mixBuffers(tracks: readonly RecordingTrack[], buffers: ReadonlyArray<{ t: RecordingTrack; b: AudioBuffer }>, duration: number, from = 0, sampleRate = 48000, fx?: MixFx): Promise<AudioBuffer | null> {
  const videos: Array<{ b: AudioBuffer; plan: NonNullable<ReturnType<typeof videoTrackPlan>>; chain?: string }> = [];
  for (const t of tracks) {
    if (!t.video || duration <= 0) continue;
    const b = await decodeVideoSound(t.video.file, sampleRate);
    const plan = b ? videoTrackPlan(t.video, b.duration, from, duration) : null;
    if (b && plan) videos.push({ b, plan, chain: t.chain });
  }
  const pads = tracks.filter(t => t.pads && duration > 0);
  const grains = tracks.filter(t => t.grain && duration > 0);
  const engine = fx?.engine && fx.engine.frames > 0 ? fx.engine : null;
  if ((!buffers.length && !videos.length && !pads.length && !grains.length && !engine) || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const chains = await offlineFx(ctx, fx?.fx, duration, fx?.valueAt);
  // The Audio engine's racks: rendered already, past the page's chains (as live: the engine has its own output).
  if (engine) placeEngineRender(ctx, engine, ctx.destination);
  for (const { b, plan, chain } of videos) {
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = plan.rate;
    if (plan.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = plan.loopEnd; }
    const gain = ctx.createGain();
    gain.gain.value = plan.gain;
    // The sound → its chain → the layer's volume → the master chain, as live (videoLayers.ts).
    src.connect(chains.input(chain ?? 'master', gain));
    src.start(0, plan.offset);
    if (plan.stopAt !== null) src.stop(plan.stopAt);
  }
  for (const t of pads) { const vol = ctx.createGain(); playPadHits(ctx, chains.input(t.chain ?? 'master', vol), vol, t.pads!, fx?.padHits ?? [], fx?.valueAt); }
  for (const t of grains) {
    const vol = ctx.createGain();
    vol.gain.value = t.grain!.volume;
    const src = ctx.createBufferSource();
    src.buffer = renderGrains(ctx, t.grain!, fx?.padHits ?? [], ctx.length, fx?.valueAt, from);
    src.connect(chains.input(t.chain ?? 'master', vol));
    src.start(0);
  }
  for (const { t, b } of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(chains.input(t.chain ?? 'master'));
    const off = t.clock && b.duration > 0 ? ((from % b.duration) + b.duration) % b.duration : 0;
    src.start(0, off);
  }
  return ctx.startRendering();
}

/**
 * A Drum pad layer's hits in an offline mix, each at its exact moment (sample
 * accurate), into `input` (its chain, which ends in `volume`): the same
 * sampler as live, the pads' numbers where the take had them at each hit.
 */
export function playPadHits(ctx: BaseAudioContext, input: AudioNode, volume: GainNode | null, track: PadTrack, hits: readonly PadHit[], valueAt?: ValueAt): void {
  const l = track.layer;
  const num = (key: string, t: number) => {
    const base = typeof l[key] === 'number' ? l[key] as number : undefined;
    return valueAt && base !== undefined ? valueAt(track.layerId, key, base, t) : base;
  };
  if (volume) volume.gain.value = Math.max(0, num('volume', 0) ?? 1);
  const sampler = dpCreateSampler(ctx);
  sampler.output.connect(input);
  for (const h of [...hits].filter(x => x.layerId === track.layerId).sort((a, b) => a.t - b.t)) {
    const p = l.pads[h.pad];
    if (!p) continue;
    if (h.vel <= 0) { sampler.release(h.pad, h.t); continue; }
    const buffer = track.buffers[h.pad];
    if (!buffer) continue;
    sampler.hit(h.pad, { ...dpHitNumbers(key => num(dpKey(h.pad, key), h.t)), buffer, mode: p.mode, loop: p.loop, reverse: p.reverse, choke: p.choke, velocity: h.vel }, h.t);
  }
}

/**
 * A Granulator rack's sound for an offline mix: the take's notes for it
 * (`ae:<rack>` pad hits: note + 1 as the pad, velocity) at their exact
 * samples, its settings where the take had them every 128 frames, through the
 * kit's pure engine (the same grains as live, seeded, so two renders match).
 */
export function renderGrains(ctx: BaseAudioContext, g: GrainTrack, hits: readonly PadHit[], frames: number, valueAt?: ValueAt, from = 0): AudioBuffer {
  const layerId = `${RACK_ACT_PREFIX}${g.rackId}`, prop = auPropId(g.rackId, AE_INST);
  // Macros turning its settings: their tracks read through each target's curve and range.
  if (valueAt && g.macros?.some(m => m.targets.length)) valueAt = macroValueAt({ racks: [{ id: g.rackId, name: '', instrument: g.slot, effects: [], keyboard: false, midi: '', channel: 0, volume: g.volume, mute: false, macros: g.macros }] } as PlayAudioEngine, valueAt);
  const events = hits.filter(h => h.layerId === layerId).map(h => ({ t: h.t, note: h.pad, vel: h.vel }));
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, g.buffer.numberOfChannels); c++) channels.push(g.buffer.getChannelData(c));
  const out = grRender({
    channels, bufferRate: g.buffer.sampleRate, sampleRate: ctx.sampleRate, frames, events,
    settings: grSettings(g.slot.params), step: 256,
    settingsAt: valueAt ? t => grSettings(g.slot.params, (a, base) => valueAt(prop, a, base, t)) : undefined,
    // "Grains from" a layer: the things as this render's frames left them (lib/grainFrom.ts), `from` seconds on.
    pointsAt: g.slot.from?.source && grainLog.has(g.rackId) ? t => grainLog.at(g.rackId, t + from) : undefined,
  });
  const b = ctx.createBuffer(2, Math.max(1, frames), ctx.sampleRate);
  b.getChannelData(0).set(out.left);
  b.getChannelData(1).set(out.right);
  return b;
}

/** 16-bit PCM WAV bytes of an AudioBuffer (stereo stays stereo; more channels are cut to two). */
export function wavBytes(buf: AudioBuffer): Uint8Array {
  const ch = Math.min(2, buf.numberOfChannels), n = buf.length, rate = buf.sampleRate;
  const data = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(data);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(data);
}
