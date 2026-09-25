/**
 * layerAudio.ts — songs loaded into Play audio layers. Each layer gets its
 * own track in the shared audio engine (key `layer:<id>`), so it plays
 * through the master volume like an Audio Input node's track, and the layer
 * kit reads its waveform and spectrum like the live input's.
 *
 * Tracks live for the session only (a song is too big to save with the
 * graph); the layer keeps the file's name so it can ask for it again.
 *
 * A song follows the graph clock (followClock, every frame): its position is
 * the clock's time, looped at its length, and a paused clock pauses it. So
 * the preview's ↺, pause, and the song's scrubber (which seeks the clock)
 * move the song, the MIDI file, beats and keyframes together, and a
 * recording lines up with the song.
 */
import { audioEngine } from './audioEngine';

type Raw = { wave: Float32Array; freq: Float32Array; sampleRate: number };

const key = (layerId: string) => `layer:${layerId}`;
/** How far the song may drift from the clock before it's moved back in line (s). */
const DRIFT = 0.25;
const buffers = new Map<string, { wave: Float32Array<ArrayBuffer>; freq: Float32Array<ArrayBuffer>; at: number }>();
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };

export const layerAudio = {
  /** Load a song; the clock starts over so it plays from the top. */
  async load(layerId: string, file: File): Promise<void> {
    await audioEngine.loadAudio(key(layerId), await file.arrayBuffer(), file.name);
    window.dispatchEvent(new CustomEvent('reset-time'));
    audioEngine.startAudio(key(layerId), 0);
    changed();
  },
  duration: (layerId: string) => audioEngine.duration(key(layerId)),
  /** Seconds into the song now, or null when none is loaded. */
  position: (layerId: string) => audioEngine.position(key(layerId)),
  peaks: (layerId: string, n: number) => audioEngine.peaks(key(layerId), n),
  /**
   * Keep the songs of these layers on the graph clock: at `time` (looped) while
   * the clock plays, stopped while it's paused. Called every frame.
   */
  followClock(layerIds: readonly string[], time: number, playing: boolean): void {
    for (const id of layerIds) {
      const k = key(id);
      if (!audioEngine.isLoaded(k)) continue;
      const dur = audioEngine.duration(k);
      if (dur <= 0) continue;
      const want = ((time % dur) + dur) % dur;
      const on = audioEngine.isPlaying(k);
      if (!playing) { if (on) { audioEngine.stopAudio(k); changed(); } continue; }
      if (!on) { audioEngine.startAudio(k, want); changed(); continue; }
      const pos = audioEngine.position(k) ?? want;
      const drift = Math.abs(pos - want);
      if (Math.min(drift, dur - drift) > DRIFT) audioEngine.startAudio(k, want);
    }
  },
  isLoaded: (layerId: string) => audioEngine.isLoaded(key(layerId)),
  isPlaying: (layerId: string) => audioEngine.isPlaying(key(layerId)),
  fileName: (layerId: string) => audioEngine.getFileName(key(layerId)),
  play(layerId: string) { audioEngine.startAudio(key(layerId)); changed(); },
  stop(layerId: string) { audioEngine.stopAudio(key(layerId)); changed(); },
  remove(layerId: string) { audioEngine.removeAudio(key(layerId)); buffers.delete(layerId); changed(); },
  /** Waveform and spectrum right now, or null while nothing is playing. */
  raw(layerId: string): Raw | null {
    if (!audioEngine.isPlaying(key(layerId))) return null;
    const an = audioEngine.getAnalyser(key(layerId));
    if (!an) return null;
    let b = buffers.get(layerId);
    if (!b || b.freq.length !== an.frequencyBinCount) { b = { wave: new Float32Array(an.fftSize), freq: new Float32Array(an.frequencyBinCount), at: 0 }; buffers.set(layerId, b); }
    const now = performance.now();
    if (now - b.at > 8) { b.at = now; an.getFloatTimeDomainData(b.wave); an.getFloatFrequencyData(b.freq); }
    return { wave: b.wave, freq: b.freq, sampleRate: an.context.sampleRate };
  },
  /** Called when a track loads, plays or stops. Returns an unsubscribe. */
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
