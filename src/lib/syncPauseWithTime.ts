import { useEffect } from 'react';
import { audioEngine } from './audioEngine';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

/**
 * Pausing the picture pauses the music with it: when the canvas's play/pause flips (Space, the preview's
 * pause button, the tape stopping), the audio engine pauses or resumes every sound it was playing.
 * Returns the unsubscribe, for tests.
 */
export function syncPauseWithTime(): () => void {
  return useNodeGraphStore.subscribe((s, prev) => {
    if (s.timePlaying === prev.timePlaying) return;
    if (s.timePlaying) { if (audioEngine.isMasterPaused()) audioEngine.resumeAll(); }
    else if (!audioEngine.isMasterPaused()) audioEngine.pauseAll();
  });
}

export function useSyncPauseWithTime() {
  useEffect(() => syncPauseWithTime(), []);
}
