/**
 * The engine side of the new triggers (lib/audioTools/engine.ts, docs/audio-tools.md): a File source's band triggers
 * and a Hit wired to it fire from the file analysed ahead, when playback is *heard* reaching each kick (the output
 * latency and the Sync offset added), even with the live analyser silent; Mute keeps them firing (only what you hear
 * goes quiet); Restart cues the trim's In; Learn noise sets a Gate over a quiet stretch. Old graphs migrate: a band's or
 * Hit's Sensitivity becomes a Threshold, and a stem picked with the retired Separate loads as the full mix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

/** The fake audio clock: the render clock (`ctx`), how far behind the speakers are, and the decoded kick track. */
const clock = vi.hoisted(() => ({ ctx: 0, latency: 0, buffer: null as null | { numberOfChannels: number; length: number; sampleRate: number; duration: number; getChannelData: () => Float32Array }, token: 1 }));
const fakes = vi.hoisted(() => {
  const silent = {
    fftSize: 2048, smoothingTimeConstant: 0, connect() {}, disconnect() {},
    getFloatFrequencyData(a: Float32Array) { a.fill(-200); },
    getFloatTimeDomainData(a: Float32Array) { a.fill(0); },
  };
  const ctx = { sampleRate: 48000, state: 'running', createAnalyser: () => ({ ...silent, context: ctx }), createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {}, context: ctx }), resume: () => Promise.resolve() };
  const loaded = new Set<string>(), playing = new Set<string>();
  const audioEngine = {
    loadAudio: vi.fn(async (id: string) => { loaded.add(id); }),
    isLoaded: (id: string) => loaded.has(id), duration: () => clock.buffer?.duration ?? 0, isMasterPaused: () => false,
    startAudio: (id: string) => { playing.add(id); }, stopAudio: (id: string) => { playing.delete(id); }, removeAudio: (id: string) => { loaded.delete(id); playing.delete(id); },
    isPlaying: (id: string) => playing.has(id), getFileName: () => 'kicks.wav',
    getAnalyser: (id: string) => (playing.has(id) ? { ...silent, context: ctx } : null),
    buffer: () => clock.buffer, context: () => ctx, connectOutside: () => () => {},
    // The song started at ctx 0 from its start, no trim: its position at a context time is that time.
    position: () => clock.ctx, positionAt: (_id: string, t: number) => t,
    heardTime: () => clock.ctx - clock.latency, outputLatency: () => clock.latency, playToken: () => clock.token,
    setVolume: vi.fn(), seek: vi.fn(),
  };
  return { audioEngine, loaded, playing };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fakes.audioEngine, trackChainId: (id: string) => `node:${id}` }));

import { n } from '../../../store/graphBuilder';
import { audioToolsEngine } from '../engine';
import { migrateNodeParams, type GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';
import { bandsOf } from '../bands';
import { listenerSpecOf } from '../../../nodes/definitions/audioTools';

const SR = 48000;
const KICKS = [0.4, 0.9, 1.45, 2.0];
function kickTrack(times: readonly number[], seconds: number): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  let seed = 5;
  for (let i = 0; i < s.length; i++) { seed = (seed * 16807) % 2147483647; s[i] = ((seed / 2147483647) * 2 - 1) * 0.01; }
  for (const t0 of times) {
    const a = Math.round(t0 * SR);
    for (let i = 0; i < 0.15 * SR && a + i < s.length; i++) s[a + i] += 0.8 * Math.exp(-i / SR / 0.06) * Math.sin((2 * Math.PI * 60 * i) / SR);
  }
  return s;
}
const track = kickTrack(KICKS, 2.5);
clock.buffer = { numberOfChannels: 1, length: track.length, sampleRate: SR, duration: track.length / SR, getChannelData: () => track };

const host = { setTexture: () => {}, requestRender: () => {} };
const KICK_BAND = { id: 'k', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, threshold: 0.5, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldown: 120 };
const graph = (extra: Record<string, unknown> = {}): GraphNode[] => [
  n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands: [KICK_BAND], ...extra }),
  n('audioHit', 'hit', 300, 0, { sound: 'kick', threshold: 0.5, gate: 0.1, cooldown: 120 }, { audio: ['src', 'audio'] }),
];

async function ready(nodes: GraphNode[]) {
  audioToolsEngine.setHost(host);
  audioToolsEngine.sync(nodes);
  await audioToolsEngine.loadFile('src', Object.assign(new Blob([new Uint8Array(4)]), { name: 'kicks.wav' }));
  // The first frame asks for the band's range; the analysis runs (inline here: no Worker in tests).
  clock.ctx = 0;
  audioToolsEngine.tickInputs(1 / 60, 0, () => {});
  for (let i = 0; i < 40 && audioToolsEngine.sourceView('src')?.ahead !== 'ready'; i++) await new Promise(r => setTimeout(r, 20));
  expect(audioToolsEngine.sourceView('src')?.ahead).toBe('ready');
}

/** Play `seconds` of frames at 60 fps from ctx 0: the context times at which `key` read 1. */
function playFrames(seconds: number, key: string): number[] {
  const fired: number[] = [];
  for (let f = 0; f <= seconds * 60; f++) {
    clock.ctx = f / 60;
    audioToolsEngine.tickInputs(1 / 60, clock.ctx, (k, v) => { if (k === key && v === 1) fired.push(clock.ctx); });
  }
  return fired;
}

afterEach(() => { audioToolsEngine.sync([]); audioToolsEngine.setHost(null); clock.latency = 0; clock.token++; });

describe('a File\'s triggers fire from the file analysed ahead, when they are heard', () => {
  it('each kick once, the frame its sound reaches the speakers (latency and Sync offset added), with the live analyser silent', async () => {
    await ready(graph({ syncOffset: 30 }));
    clock.latency = 0.12; // a Bluetooth-ish output
    clock.token++;
    const fired = playFrames(2.4, 'src::k_t');
    expect(fired.length).toBe(KICKS.length);
    // The onset is found ~10 ms early at most (the window is centred on it); heard 120 ms + 30 ms after.
    fired.forEach((t, i) => {
      const due = KICKS[i] + 0.12 + 0.03;
      expect(t).toBeGreaterThanOrEqual(due - 0.02 - 1e-9);
      expect(t - due).toBeLessThanOrEqual(1 / 60 + 1e-9);
    });
    // The Hit wired straight to it fires the same way.
    clock.token++;
    const hit = playFrames(2.4, 'hit::trigger');
    expect(hit.length).toBe(KICKS.length);
  });

  it('Mute keeps triggering: only what you hear goes quiet', async () => {
    await ready(graph({ muted: true, volume: 0.6 }));
    expect(fakes.audioEngine.setVolume).toHaveBeenLastCalledWith('src', 0.6, true);
    clock.token++;
    expect(playFrames(2.4, 'src::k_t').length).toBe(KICKS.length);
    expect(audioToolsEngine.status('src')).toMatch(/\(muted\)/);
  });

  it('Restart cues the trim\'s In; Learn noise puts the Gate just over a quiet stretch', async () => {
    await ready(graph({ trimIn: 0.3 }));
    audioToolsEngine.restart('src');
    expect(fakes.audioEngine.seek).toHaveBeenCalledWith('src', 0.3);
    const quiet = audioToolsEngine.learnNoise('src', 'k', { from: 0.0, to: 0.3 });
    expect('gate' in quiet).toBe(true);
    if ('gate' in quiet) {
      expect(quiet.gate).toBeGreaterThan(quiet.floor);
      expect(quiet.gate).toBeLessThan(0.5); // under the kicks' Threshold
    }
  });
});

describe('old graphs', () => {
  it('a band\'s and a Hit\'s Sensitivity become a fixed Threshold', () => {
    const src = migrateNodeParams(n('audioSource', 'src', 0, 0, {
      bands: [{ id: 'k', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, sensitivity: 0.75, cooldown: 150 }, { id: 'b', name: 'Bass', lo: 60, hi: 250, value: true, sensitivity: 0.5 }],
    }), getNodeDefinition);
    const [k, b] = bandsOf(src.params);
    expect([k.threshold, k.gate, k.cooldown]).toEqual([0.4, 0.1, 150]);
    expect([b.threshold, b.gate]).toEqual([0.5, 0]); // a Value band keeps reading as before (no Gate)
    expect(JSON.stringify(src.params.bands)).not.toMatch(/sensitivity/);
    // As saved before (no Threshold, no version stamp).
    const hit = migrateNodeParams({ ...n('audioHit', 'h', 0, 0), params: { sound: 'snare', sensitivity: 0.25, cooldown: 90, decay: 0.3 } }, getNodeDefinition);
    expect(hit.params.sensitivity).toBeUndefined();
    expect(listenerSpecOf(hit)).toMatchObject({ threshold: 0.6, releaseAt: 0.8, cooldown: 90 });
    // Not saved since (no version): bandsOf and Hit read a Sensitivity the same way.
    expect(bandsOf({ bands: [{ id: 'x', lo: 30, hi: 150, trigger: true, sensitivity: 1 }] })[0].threshold).toBe(0.3);
  });

  it('a stem picked with the retired Separate loads as the full mix and still plays and triggers', async () => {
    const old = n('audioSource', 'src', 0, 0, {
      _fileName: 'kicks.wav', bands: [KICK_BAND], stem: 'drums', hear: 'stem',
      stems: { model: 'htdemucs', revision: 'x', of: 'song1', tracks: [{ stem: 'drums', sampleId: 'stem_1', type: 'audio/webm', bytes: 10 }] },
    });
    const migrated = migrateNodeParams(old, getNodeDefinition);
    expect(['stem', 'hear', 'stems'].filter(k => k in migrated.params)).toEqual([]);
    await ready([migrated]);
    clock.token++;
    expect(playFrames(2.4, 'src::k_t').length).toBe(KICKS.length);
    // Even unmigrated, the stem params are ignored.
    audioToolsEngine.sync([old]);
    expect(audioToolsEngine.sourceView('src')?.loaded).toBe(true);
  });
});
