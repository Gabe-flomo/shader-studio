/**
 * videoSoundUi.ts — what the Audio readers panel and a Video layer's card say
 * about a video's sound: its state, kept current, and the note for it.
 */
import { useSyncExternalStore } from 'react';
import { videoSound, type VideoSoundState } from '../../lib/videoSound';

/** A video layer's sound state, kept current ('gone' for no id). */
export function useVideoSoundState(layerId: string): VideoSoundState {
  return useSyncExternalStore(videoSound.subscribe, () => (layerId ? videoSound.state(layerId) : 'gone'));
}

/** Why the readers hear nothing from a video layer, or '' when they hear it. */
export function readerVideoNote(label: string, state: VideoSoundState): string {
  switch (state) {
    case 'gone': return 'That Video layer has been deleted. Pick another input.';
    case 'off': return `${label}’s Sound is Off. On the layer, set Sound to Listen (analysed, not heard) or Play (heard too).`;
    case 'no-file': return `${label} has no video in this browser yet. Pick one on the layer.`;
    case 'loading': return `${label} is opening its video…`;
    case 'paused': return `${label} is paused. Start the clock (or press Play on the layer) to hear it here.`;
    case 'playing': return '';
  }
}
