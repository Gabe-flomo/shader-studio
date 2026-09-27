/**
 * videoSound.ts — where the audio readers find a Video layer's sound. The
 * Video layers' host (play/videoLayers.ts) registers itself here; readers,
 * the panel and the layer card ask through it, so they need not load the
 * host (and the backgrounds library behind it) themselves.
 */

/**
 * A video layer's sound, for the readers:
 *   gone      no such video layer (deleted, or not in what plays)
 *   off       its Sound is Off
 *   no-file   no video picked, or its file isn't in this browser
 *   loading   the file is still opening
 *   paused    loaded, not playing (the clock or its own pause)
 *   playing   sounding into the analysis
 */
export type VideoSoundState = 'gone' | 'off' | 'no-file' | 'loading' | 'paused' | 'playing';

export interface VideoSoundHost {
  /** The analyser its sound goes through, or null while its sound is off or it has no element. */
  analyser(layerId: string): AnalyserNode | null;
  state(layerId: string): VideoSoundState;
  /** The layer's open file and its length in seconds (0 while unknown), for mixing its sound offline; null without one. */
  file?(layerId: string): { blob: Blob; duration: number } | null;
}

let host: VideoSoundHost | null = null;
const listeners = new Set<() => void>();

export const videoSound = {
  setHost(h: VideoSoundHost | null): void { host = h; },
  analyser: (layerId: string): AnalyserNode | null => host?.analyser(layerId) ?? null,
  state: (layerId: string): VideoSoundState => host?.state(layerId) ?? 'gone',
  file: (layerId: string): { blob: Blob; duration: number } | null => host?.file?.(layerId) ?? null,
  /** Something the readers show changed (a state, a file). */
  changed(): void { for (const fn of listeners) fn(); },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
