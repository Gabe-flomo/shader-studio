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
 */
import { audioEngine } from './audioEngine';
import type { PlayRecord } from '../types/play';
import type { GraphNode } from '../types/nodeGraph';
import { videoLayerTimeAt, type VideoLayer } from '../types/playLayers';
import { videoSound } from './videoSound';

export interface RecordingTrack {
  key: string;
  label: string;
  /** Follows the graph clock (a Play song, a video layer) or plays from its start (an Audio Input node). */
  clock: boolean;
  /** A Video layer's sound: its file and how it plays (else the track is a song in the audio engine, by `key`). */
  video?: VideoTrack;
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
    key: `vlayer:${l.id}`, label: l.fileName || l.label, clock: true,
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
    if (l.kind !== 'audio' || !l.visible || (l as { input?: string }).input !== 'file') continue;
    const key = `layer:${l.id}`;
    if (audioEngine.isLoaded(key)) out.push({ key, label: audioEngine.getFileName(key) || l.label, clock: true });
  }
  for (const n of nodes) {
    if (n.type !== 'audioInput' || !audioEngine.isPlaying(n.id)) continue;
    out.push({ key: n.id, label: audioEngine.getFileName(n.id) || 'Audio Input', clock: false });
  }
  return out;
}

/**
 * The tracks mixed for `duration` seconds starting at clock time `from`:
 * clock songs at that point in the song (looped), others from their start.
 * Null when there's nothing to mix.
 */
export async function mixdown(tracks: readonly RecordingTrack[], duration: number, from = 0, sampleRate = 48000): Promise<AudioBuffer | null> {
  const buffers = tracks.filter(t => !t.video).map(t => ({ t, b: audioEngine.buffer(t.key) })).filter((x): x is { t: RecordingTrack; b: AudioBuffer } => !!x.b);
  const videos: Array<{ b: AudioBuffer; plan: NonNullable<ReturnType<typeof videoTrackPlan>> }> = [];
  for (const t of tracks) {
    if (!t.video || duration <= 0) continue;
    const b = await decodeVideoSound(t.video.file, sampleRate);
    const plan = b ? videoTrackPlan(t.video, b.duration, from, duration) : null;
    if (b && plan) videos.push({ b, plan });
  }
  if ((!buffers.length && !videos.length) || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  for (const { b, plan } of videos) {
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = plan.rate;
    if (plan.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = plan.loopEnd; }
    const gain = ctx.createGain();
    gain.gain.value = plan.gain;
    src.connect(gain).connect(ctx.destination);
    src.start(0, plan.offset);
    if (plan.stopAt !== null) src.stop(plan.stopAt);
  }
  for (const { t, b } of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(ctx.destination);
    const off = t.clock && b.duration > 0 ? ((from % b.duration) + b.duration) % b.duration : 0;
    src.start(0, off);
  }
  return ctx.startRendering();
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
