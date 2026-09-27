/**
 * padSound.ts — where the audio readers find a Drum pad layer's sound. The
 * drum pads' host (play/drumPads.ts) registers itself here, so the readers
 * and the panel need not load it (and the media library behind it).
 */
import type { DrumPad } from '../types/playLayers';

/**
 * A drum pad layer's sound, for the readers:
 *   gone      no such layer
 *   off       the layer is hidden (hidden pads are silent)
 *   no-file   no pad has a sound in this browser yet
 *   paused    ready, nothing sounding right now
 *   playing   a pad is sounding
 */
export type PadSoundState = 'gone' | 'off' | 'no-file' | 'paused' | 'playing';

export interface PadSoundHost {
  analyser(layerId: string): AnalyserNode | null;
  state(layerId: string): PadSoundState;
  /** A pad's decoded sample (offline mixes play it), null while it has none. */
  buffer?(pad: DrumPad): AudioBuffer | null;
}

let host: PadSoundHost | null = null;

export const padSound = {
  setHost(h: PadSoundHost | null): void { host = h; },
  analyser: (layerId: string): AnalyserNode | null => host?.analyser(layerId) ?? null,
  state: (layerId: string): PadSoundState => host?.state(layerId) ?? 'gone',
  buffer: (pad: DrumPad): AudioBuffer | null => host?.buffer?.(pad) ?? null,
};
