/**
 * The audio engine plays a song's stem in step with it (docs/stems.md): both sources start at the same moment, at
 * the same offset, inside the same trim; Hear picks which reaches the speakers; the stem goes with the song.
 */
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const started: Array<{ buffer: unknown; when: number; offset: number; duration?: number; loop: boolean; loopStart: number; loopEnd: number }> = [];
  const gains: Array<{ gain: { value: number } }> = [];
  class Ctx {
    currentTime = 12.5; sampleRate = 48000; state = 'running'; destination = {};
    createGain() { const g = { gain: { value: 1 }, connect() {}, disconnect() {} }; gains.push(g); return g; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 1024, connect() {}, disconnect() {}, getFloatFrequencyData() {} }; }
    createBufferSource() {
      const s = {
        buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, onended: null, connect() {}, disconnect() {}, stop: vi.fn(),
        start(when: number, offset: number, duration?: number) { started.push({ buffer: s.buffer, when, offset, duration, loop: s.loop, loopStart: s.loopStart, loopEnd: s.loopEnd }); },
      };
      return s;
    }
    createMediaStreamDestination() { return { stream: {} }; }
    resume() { return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 10, length: 480000, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => new Float32Array(480000) }); }
  }
  (globalThis as unknown as { window: unknown }).window = Object.assign(globalThis, { AudioContext: Ctx });
  return { started, gains };
});
vi.mock('../mediaSources', () => ({ mediaSource: () => null, rememberMedia: () => {}, restoreMedia: () => {}, forgetMedia: () => {} }));

import { audioEngine } from '../audioEngine';

const buf = (d: number) => ({ duration: d, length: d * 48000, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => new Float32Array(d * 48000) }) as unknown as AudioBuffer;

describe('a song and its stem', () => {
  it('start together, at the same offset and loop, inside the trim; Hear switches the speakers; removing the song takes the stem', async () => {
    await audioEngine.loadAudio('a', new ArrayBuffer(8), 'Song.wav');
    const stem = buf(10);
    audioEngine.setStem('a', stem);
    expect(audioEngine.stemBuffer('a')).toBe(stem);
    expect(audioEngine.stemAnalyser('a')).toBeTruthy();
    fake.started.length = 0;
    audioEngine.startAudio('a', 3, true, { start: 2, end: 6 });
    expect(fake.started).toHaveLength(2);
    const [song, st] = fake.started;
    expect(st.buffer).toBe(stem);
    expect(st.when).toBe(song.when);
    expect(st.offset).toBe(song.offset);
    expect([st.loop, st.loopStart, st.loopEnd]).toEqual([true, 2, 6]);
    expect([song.loopStart, song.loopEnd]).toEqual([2, 6]);
    // Picking a stem while playing restarts both together, where the song was
    fake.started.length = 0;
    audioEngine.setStem('a', buf(10));
    expect(fake.started).toHaveLength(2);
    expect(fake.started[0].when).toBe(fake.started[1].when);
    // Not looping: both stop at the trim's end
    fake.started.length = 0;
    audioEngine.startAudio('a', 3, false, { start: 2, end: 6 });
    expect(fake.started.map(s => s.duration)).toEqual([3, 3]);
    // Stopping stops the stem too; the stem goes away with the song
    audioEngine.stopAudio('a');
    expect(audioEngine.isPlaying('a')).toBe(false);
    audioEngine.setHearStem('a', true);
    audioEngine.setStem('a', null);
    expect(audioEngine.stemAnalyser('a')).toBeNull();
    audioEngine.setStem('a', stem);
    audioEngine.removeAudio('a');
    expect(audioEngine.stemBuffer('a')).toBeNull();
  });
});
