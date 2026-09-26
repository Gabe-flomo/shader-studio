/**
 * recordingAudio.ts — the sound that goes into a recording.
 *
 * Only songs already in Playfield: a song loaded into a Play audio layer
 * (it follows the graph clock), and an Audio Input node's file while it
 * plays. Never the microphone: live input is for performing, and what a
 * recording animates should be baked in, not coming in while it records.
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

export interface RecordingTrack {
  key: string;
  label: string;
  /** Follows the graph clock (a Play song) or plays from its start (an Audio Input node). */
  clock: boolean;
}

/** The songs a recording would carry right now. */
export function recordingTracks(play: PlayRecord, nodes: readonly GraphNode[]): RecordingTrack[] {
  const out: RecordingTrack[] = [];
  for (const l of play.layers) {
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
  const buffers = tracks.map(t => ({ t, b: audioEngine.buffer(t.key) })).filter((x): x is { t: RecordingTrack; b: AudioBuffer } => !!x.b);
  if (!buffers.length || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
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
