/**
 * audioReaderBank.ts — the setup's audio readers, read from the live input
 * or from an Audio Input node's song, once per frame on the wall clock
 * (sound is real time, whatever the graph clock does).
 *
 * The Play engine reads levels here for reader sources and triggers; the
 * Audio readers panel reads the same spectrum and levels to draw them. A take
 * playing back puts its recorded levels in place of the live ones.
 */
import type { AudioReader, PlayAudioReaders } from '../types/play';
import { stepReaders } from '../play/audioReaders';
import { liveAudio } from './liveAudio';
import { audioEngine } from './audioEngine';

export type ReaderInputState = 'live-on' | 'live-off' | 'song' | 'song-missing';

class AudioReaderBank {
  private cfg: PlayAudioReaders | undefined;
  private levels = new Map<string, number>();
  private last = 0;
  private ok = false;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private bufAt = 0;
  private playback: Map<string, number> | null = null;

  setConfig(cfg: PlayAudioReaders | undefined): void {
    this.cfg = cfg;
  }

  readers(): readonly AudioReader[] { return this.cfg?.readers ?? []; }
  input(): string { return this.cfg?.input ?? ''; }
  name(id: string): string | undefined { return this.cfg?.readers.find(r => r.id === id)?.name; }
  has(): boolean { return !!this.cfg?.readers.length; }

  /** What the readers listen to, and whether it is sounding. */
  inputState(): ReaderInputState {
    const input = this.input();
    if (!input) return liveAudio.isOn() ? 'live-on' : 'live-off';
    return audioEngine.isLoaded(input) ? 'song' : 'song-missing';
  }

  /** The spectrum the readers read now (dB per bin), or null while their input is silent or missing. */
  spectrum(): { freq: Float32Array; sampleRate: number } | null {
    const input = this.input();
    if (!input) {
      const raw = liveAudio.raw();
      return raw ? { freq: raw.freq, sampleRate: raw.sampleRate } : null;
    }
    const an = audioEngine.getAnalyser(input);
    if (!an) return null;
    if (!this.buf || this.buf.length !== an.frequencyBinCount) this.buf = new Float32Array(an.frequencyBinCount);
    const now = performance.now();
    if (now - this.bufAt > 8) { this.bufAt = now; an.getFloatFrequencyData(this.buf); }
    return { freq: this.buf, sampleRate: an.context.sampleRate };
  }

  /** Step the readers (free when called again within a few ms: the engine and the panel both call it). */
  update(): void {
    const now = performance.now();
    if (now >= this.last && now - this.last < 4) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const spec = this.cfg?.readers.length ? this.spectrum() : null;
    this.ok = !!spec;
    if (!spec) { this.levels.clear(); return; }
    stepReaders(this.cfg!.readers, spec.freq, spec.sampleRate, dt, this.levels);
  }

  /** A reader's level 0..1, or null while its input is off (a take playing back gives its recorded level). */
  value(id: string): number | null {
    const p = this.playback?.get(id);
    if (p !== undefined) return p;
    if (!this.ok || !this.cfg?.readers.some(r => r.id === id)) return null;
    return this.levels.get(id) ?? 0;
  }

  /** Is anything to read (the input on, or a take playing back)? */
  live(): boolean { return this.ok || !!this.playback?.size; }

  /** A take playing back: its recorded level for a reader. */
  setPlayback(id: string, v: number): void {
    (this.playback ??= new Map()).set(id, v);
  }
  clearPlayback(): void { this.playback = null; }
}

export const audioReaderBank = new AudioReaderBank();
