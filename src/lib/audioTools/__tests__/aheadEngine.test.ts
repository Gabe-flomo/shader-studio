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
const clock = vi.hoisted(() => ({ ctx: 0, latency: 0, wobble: 0, looping: false, buffer: null as null | { numberOfChannels: number; length: number; sampleRate: number; duration: number; getChannelData: () => Float32Array }, token: 1 }));
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
    position: () => clock.ctx,
    positionAt: (_id: string, t: number) => { const d = clock.buffer?.duration ?? 0; return clock.looping && d > 0 ? ((t % d) + d) % d : t; },
    // `wobble`: how far the heard clock steps back on a frame (getOutputTimestamp's estimate against the latencies').
    heardTime: () => clock.ctx - clock.latency - clock.wobble, outputLatency: () => clock.latency, playToken: () => clock.token,
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
import { drumsTest } from './detectSynth';

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
const bufferOf = (m: Float32Array) => ({ numberOfChannels: 1, length: m.length, sampleRate: SR, duration: m.length / SR, getChannelData: () => m });
const kickBuffer = bufferOf(track);
clock.buffer = kickBuffer;

const host = { setTexture: () => {}, requestRender: () => {} };
const KICK_BAND = { id: 'k', name: 'Kick', lo: 40, hi: 130, value: false, trigger: true, preset: 'kick', sensitivity: 0.5 };
const graph = (extra: Record<string, unknown> = {}): GraphNode[] => [
  n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands: [KICK_BAND], ...extra }),
  n('audioHit', 'hit', 300, 0, { sound: 'kick' }, { audio: ['src', 'audio'] }),
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

afterEach(() => { audioToolsEngine.sync([]); audioToolsEngine.setHost(null); clock.latency = 0; clock.wobble = 0; clock.looping = false; clock.buffer = kickBuffer; clock.token++; });

describe('a File\'s triggers fire from the file analysed ahead, when they are heard', () => {
  it('each kick once, the frame its sound reaches the speakers (latency and Sync offset added), with the live analyser silent', async () => {
    await ready(graph({ syncOffset: 30 }));
    clock.latency = 0.12; // a Bluetooth-ish output
    clock.token++;
    const fired = playFrames(2.4, 'src::k_t');
    expect(fired.length).toBe(KICKS.length);
    // Each is stamped where its onset is heard (the decision less AT_DET_LAG: within a few ms of it), then fired the
    // first frame playback is heard passing it: 120 ms + 30 ms after.
    fired.forEach((t, i) => {
      const due = KICKS[i] + 0.12 + 0.03;
      expect(t).toBeGreaterThanOrEqual(due - 0.01 - 1e-9);
      expect(t - due).toBeLessThanOrEqual(0.015 + 1 / 60 + 1e-9);
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

  it('Restart cues the trim\'s In; Learn noise puts the Gate (dBFS) just over a quiet stretch', async () => {
    await ready(graph({ trimIn: 0.3 }));
    audioToolsEngine.restart('src');
    expect(fakes.audioEngine.seek).toHaveBeenCalledWith('src', 0.3);
    const quiet = audioToolsEngine.learnNoise('src', 'k', { from: 0.0, to: 0.3 });
    expect('gateDb' in quiet).toBe(true);
    if ('gateDb' in quiet) {
      expect(quiet.gateDb).toBeGreaterThan(quiet.floorDb);
      expect(quiet.gateDb).toBeLessThan(-30); // well under the kicks (about −10 dBFS in their band)
    }
  });
});

describe('a band\'s preset on a File', () => {
  it('Kick and a Custom band fire each kick from the file analysed ahead; Hats never fires on the noise bed; the scope shows why', async () => {
    const bands = [
      { ...KICK_BAND, id: 'h', name: 'Kick' },
      { ...KICK_BAND, id: 'd', name: 'Custom', preset: 'custom', lo: 30, hi: 150 },
      { ...KICK_BAND, id: 'n', name: 'Hats', preset: 'hats', lo: 6000, hi: 16000 },
    ];
    await ready([n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands })]);
    for (let i = 0; i < 40 && audioToolsEngine.sourceView('src')?.ahead !== 'ready'; i++) await new Promise(r => setTimeout(r, 20));
    clock.token++;
    const fired = { h: [] as number[], d: [] as number[], n: [] as number[] };
    for (let f = 0; f <= 2.4 * 60; f++) {
      clock.ctx = f / 60;
      audioToolsEngine.tickInputs(1 / 60, clock.ctx, (k, v) => { for (const id of ['h', 'd', 'n'] as const) if (k === `src::${id}_t` && v === 1) fired[id].push(clock.ctx); });
    }
    expect(fired.h).toHaveLength(KICKS.length);
    expect(fired.d).toHaveLength(KICKS.length);
    fired.h.forEach((t, i) => expect(Math.abs(t - KICKS[i])).toBeLessThan(0.03));
    // The noise bed up there is steady: no hits once it has started.
    expect(fired.n.filter(t => t > 0.1)).toHaveLength(0);
    const v = audioToolsEngine.sourceView('src')!.bands.get('h')!;
    expect(v.ahead).toBe(true);
    // Hits per pass of the file (not a growing total).
    expect(v.perPass).toBe(KICKS.length);
    // The scope: the onset function spikes over its line at the kicks; the energy line sits over the Gate's.
    const hitAt = Array.from(v.scope.hits).indexOf(1);
    expect(hitAt).toBeGreaterThanOrEqual(0);
    expect(v.scope.vals[hitAt]).toBeGreaterThan(v.scope.line[hitAt]);
    expect(v.scope.db[hitAt]).toBeGreaterThan(v.scope.gate[hitAt]);
  });
});

describe('old graphs', () => {
  it('v1: a band\'s and a Hit\'s Sensitivity carry over to the preset nearest them', () => {
    const src = migrateNodeParams(n('audioSource', 'src', 0, 0, {
      bands: [{ id: 'k', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, sensitivity: 0.75, cooldown: 150 }, { id: 'b', name: 'Bass', lo: 60, hi: 250, value: true, sensitivity: 0.5 }],
    }), getNodeDefinition);
    const [k, b] = bandsOf(src.params);
    expect([k.preset, k.sensitivity, k.lo, k.hi, k.trigger]).toEqual(['kick', 0.75, 30, 150, true]);
    expect([b.preset, b.value, b.trigger]).toEqual(['custom', true, false]);
    expect(JSON.stringify(src.params.bands)).not.toMatch(/cooldown|threshold/);
    // As saved before (no Threshold, no version stamp).
    const hit = migrateNodeParams({ ...n('audioHit', 'h', 0, 0), params: { sound: 'snare', sensitivity: 0.25, cooldown: 90, decay: 0.3 } }, getNodeDefinition);
    expect(hit.params.sensitivity).toBe(0.25);
    expect(listenerSpecOf(hit)).toMatchObject({ preset: 'snare', sensitivity: 0.25, decay: 0.3 });
  });

  it('v2: fixed lines read back to a Sensitivity (Threshold = 0.7 − 0.4 × Sensitivity); a Detect maps to its preset', () => {
    const src = migrateNodeParams({ ...n('audioSource', 'src', 0, 0), version: 2, params: { bands: [
      { id: 'k', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, threshold: 0.3, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldown: 150 },
      { id: 'h', name: 'Hats', lo: 6000, hi: 16000, value: false, trigger: true, detect: 'hits', character: 'noisy', threshold: 0.5 },
    ] } } as GraphNode, getNodeDefinition);
    const [k, h] = bandsOf(src.params);
    expect([k.preset, k.sensitivity]).toEqual(['kick', 1]);
    expect([h.preset, h.sensitivity, h.character]).toEqual(['hats', 0.5, 'noisy']);
    const hit = migrateNodeParams({ ...n('audioHit', 'h', 0, 0), version: 2, params: { sound: 'kick', threshold: 0.6, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldown: 90 } } as GraphNode, getNodeDefinition);
    expect(hit.params.threshold).toBeUndefined();
    expect(listenerSpecOf(hit)).toMatchObject({ preset: 'kick', sensitivity: 0.25 });
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

describe('the user\'s drums-test.wav with their settings (63–134 Hz, Transient, Only noisy at 0.3, Threshold 0.5, Release × 0.8, Gate 0.71, Min 10 ms, Cooldown 120)', () => {
  // As saved by the old window (a Detect and fixed lines): the band upgrades to Kick with the middle Sensitivity.
  const USER = { id: 'u', name: 'Band', lo: 63, hi: 134, value: true, trigger: true, detect: 'transient', character: 'noisy', charAt: 0.3, threshold: 0.5, releaseAt: 0.8, gate: 0.71, minMs: 10, cooldown: 120 };
  const drums = drumsTest();

  it('fires only its own hits, once a pass, while the heard clock steps back a little on some frames', async () => {
    clock.buffer = bufferOf(drums.mono);
    clock.looping = true;
    await ready([n('audioSource', 'src', 0, 0, { _fileName: 'drums-test.wav', bands: [USER] })]);
    for (let i = 0; i < 100 && !audioToolsEngine.sourceView('src')?.bands.get('u')?.ahead; i++) {
      audioToolsEngine.tickInputs(1 / 60, 0, () => {});
      await new Promise(r => setTimeout(r, 20));
    }
    clock.token++;
    const fired: number[] = [];
    // Two passes of the 8 s loop at 60 fps; every 5th frame the heard clock reads 40 ms behind (the latencies' estimate).
    for (let f = 0; f <= 16 * 60; f++) {
      clock.ctx = f / 60;
      clock.wobble = f % 5 === 0 ? 0.04 : 0;
      audioToolsEngine.tickInputs(1 / 60, clock.ctx, (k, v) => { if (k === 'src::u_t' && v === 1) fired.push(clock.ctx); });
    }
    const v = audioToolsEngine.sourceView('src')!.bands.get('u')!;
    expect(v.ahead).toBe(true);
    // The same hits each pass (what the file analysed ahead holds), not thousands: its kicks and the bass's new notes
    // (this band is all bass), and a hat or a snare where they reach down into it.
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThanOrEqual(2 * 24);
    expect(v.perPass).toBeLessThanOrEqual(24);
    expect(v.perPass).toBe(fired.length / 2);
    // None out of nothing: every hit is at something starting (a kick, a snare, a hat, a new note), told on the first
    // 60 fps frame after it is heard — or the kick's falling tail beating through the bass note, within 0.1 s of a kick.
    const starts = [...drums.kicks, ...drums.snares, ...drums.hats, ...Array.from({ length: 16 }, (_, k) => k / 2)];
    const near = (t: number) => starts.some(d => (t % 8) - d > -0.02 && (t % 8) - d < 0.07) || drums.kicks.some(k => (t % 8) - k > 0 && (t % 8) - k < 0.11);
    for (const t of fired) expect(near(t)).toBe(true);
  });
});
