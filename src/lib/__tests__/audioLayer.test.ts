/**
 * Audio layers: the song follows the graph clock, the layer measures its own
 * bands, and "Map…" turns a band into a mapping (and a control) in one step.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const eng = vi.hoisted(() => ({
  loaded: true, playing: false, pos: 0, dur: 10,
  started: [] as number[], stopped: 0,
}));
vi.mock('../audioEngine', () => ({
  audioEngine: {
    isLoaded: () => eng.loaded,
    isPlaying: () => eng.playing,
    duration: () => eng.dur,
    position: () => eng.pos,
    startAudio: (_k: string, at = 0) => { eng.started.push(at); eng.playing = true; eng.pos = at; },
    stopAudio: () => { eng.stopped++; eng.playing = false; },
    getAnalyser: () => null,
  },
}));

import { layerAudio } from '../layerAudio';
import { playEngine } from '../playEngine';
import { defaultLayer, emptyPlayRecord, type PlayRecord } from '../../types/play';
import type { AudioLayer } from '../../types/playLayers';
import { mapSourceTo } from '../../components/play/layerOps';

beforeEach(() => { Object.assign(eng, { loaded: true, playing: false, pos: 0, dur: 10, started: [], stopped: 0 }); });

describe('a song on the clock', () => {
  it('starts where the clock is (looped), follows seeks, and pauses with it', () => {
    vi.stubGlobal('window', { dispatchEvent: () => true });
    layerAudio.followClock(['a'], 12, true);
    expect(eng.started).toEqual([2]);
    eng.pos = 2.1;
    layerAudio.followClock(['a'], 2.1, true);          // in step: left alone
    expect(eng.started).toEqual([2]);
    layerAudio.followClock(['a'], 7, true);            // the clock jumped (a seek): the song follows
    expect(eng.started).toEqual([2, 7]);
    eng.pos = 9.95;
    layerAudio.followClock(['a'], 10.02, true);        // the loop coming round isn't drift
    expect(eng.started).toEqual([2, 7]);
    layerAudio.followClock(['a'], 10.02, false);       // paused clock → paused song
    expect(eng.stopped).toBe(1);
  });
});

describe('audio layer bands', () => {
  it('reads bass from the layer’s own song, scaled by its Gain', () => {
    // 1024 bins at 48 kHz: loud below 150 Hz, quiet elsewhere.
    const freq = new Float32Array(1024).fill(-90);
    for (let i = 1; i < 7; i++) freq[i] = -10;
    const wave = new Float32Array(2048).fill(0.2);
    vi.spyOn(layerAudio, 'raw').mockReturnValue({ wave, freq, sampleRate: 48000 });
    const layer = { ...(defaultLayer('audio', 'song', 'Song') as AudioLayer), input: 'file' as const, gain: 1 };
    const rec: PlayRecord = { ...emptyPlayRecord(), layers: [layer] };
    playEngine.setRecord(rec);
    const read = (r: 'bass' | 'treble' | 'level') => playEngine.readSource({ kind: 'sensor', layerId: 'song', read: r, otherId: '' });
    const bass = read('bass')!, treble = read('treble')!;
    expect(bass).toBeGreaterThan(0.8);
    expect(treble).toBeLessThan(0.1);
    playEngine.setRecord({ ...rec, layers: [{ ...layer, gain: 0.5 }] });
    playEngine.tickInputs(1 / 60, 0, () => {}); // next frame: measured again
    expect(read('bass')!).toBeCloseTo(bass * 0.5, 2);
  });

  it('Map… makes the control when needed, and a mapping across its range', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), layers: [defaultLayer('audio', 'song', 'Song'), { ...defaultLayer('particles', 'p', 'Sparks') }] };
    const src = { kind: 'sensor' as const, layerId: 'song', read: 'bass' as const, otherId: '' };
    const r = mapSourceTo(rec, src, { layerId: 'p', key: 'speed' });
    expect(r.play.controls.map(c => c.target)).toEqual(['layer:p::speed']);
    expect(r.play.mappings[0]).toMatchObject({ controlId: r.control!.id, source: src, outMin: r.control!.min, outMax: r.control!.max });
    const again = mapSourceTo(r.play, { ...src, read: 'treble' }, { control: r.control!.id });
    expect(again.play.controls).toHaveLength(1);
    expect(again.play.mappings).toHaveLength(2);
  });
});
