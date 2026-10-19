import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { audioEngine } from '../audioEngine';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { syncPauseWithTime } from '../syncPauseWithTime';

describe('Space pauses the music with the picture', () => {
  it('pausing time pauses the audio engine; playing resumes it; no double calls', () => {
    const pause = vi.spyOn(audioEngine, 'pauseAll');
    const resume = vi.spyOn(audioEngine, 'resumeAll');
    useNodeGraphStore.getState().setTimePlaying(true);
    const off = syncPauseWithTime();
    useNodeGraphStore.getState().setTimePlaying(false);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(audioEngine.isMasterPaused()).toBe(true);
    useNodeGraphStore.getState().setTimePlaying(false);
    expect(pause).toHaveBeenCalledTimes(1);
    useNodeGraphStore.getState().setTimePlaying(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(audioEngine.isMasterPaused()).toBe(false);
    off();
  });
});
