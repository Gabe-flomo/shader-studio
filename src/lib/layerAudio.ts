/**
 * layerAudio.ts — songs loaded into Play audio layers. Each layer gets its
 * own track in the shared audio engine (key `layer:<id>`), so it plays
 * through the master volume like an Audio Input node's track, and the layer
 * kit reads its waveform and spectrum like the live input's.
 *
 * Tracks live for the session only (a song is too big to save with the
 * graph); the layer keeps the file's name so it can ask for it again.
 */
import { audioEngine } from './audioEngine';

type Raw = { wave: Float32Array; freq: Float32Array; sampleRate: number };

const key = (layerId: string) => `layer:${layerId}`;
const buffers = new Map<string, { wave: Float32Array<ArrayBuffer>; freq: Float32Array<ArrayBuffer>; at: number }>();
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };

export const layerAudio = {
  async load(layerId: string, file: File): Promise<void> {
    await audioEngine.loadAudio(key(layerId), await file.arrayBuffer(), file.name);
    audioEngine.startAudio(key(layerId));
    changed();
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
