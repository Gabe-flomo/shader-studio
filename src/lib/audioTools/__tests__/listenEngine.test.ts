/**
 * The engine side of a band's Listen (lib/audioTools/engine.ts listenBand, docs/audio-tools.md "Listen"): a File's
 * band plays through the same filters Solo uses at the mix's band gain, a click goes on the audio clock at each hit the
 * file analysed ahead holds (where playback reaches it), one band listens at a time, Solo / Hear hovered take the
 * sound back, stopping takes back the clicks not played yet; the Mic's band goes to its own context, clicks only by
 * default, and its clicks come from the live detector.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

const clock = vi.hoisted(() => ({ ctx: 0, buffer: null as null | { numberOfChannels: number; length: number; sampleRate: number; duration: number; getChannelData: () => Float32Array }, token: 1 }));
const fakes = vi.hoisted(() => {
  type Param = { value: number; setTargetAtTime(v: number): void };
  const param = (v: number): Param => ({ value: v, setTargetAtTime(x: number) { this.value = x; } });
  const silent = {
    fftSize: 2048, smoothingTimeConstant: 0, connect() {}, disconnect() {},
    getFloatFrequencyData(a: Float32Array) { a.fill(-200); },
    getFloatTimeDomainData(a: Float32Array) { a.fill(0); },
  };
  /** Every node made, with what it was connected to; every click (buffer source) with its start time and whether it was stopped. */
  const made = { gains: [] as Array<{ gain: Param; to: unknown[] }>, filters: [] as Array<{ type: string; frequency: Param; Q: Param; to: unknown[]; ctx: unknown }>, clicks: [] as Array<{ at: number; stopped: boolean }> };
  const mkCtx = (name: string) => {
    const ctx: Record<string, unknown> = { name, sampleRate: 48000, state: 'running', destination: { name: `${name}.destination` }, resume: () => Promise.resolve() };
    Object.defineProperty(ctx, 'currentTime', { get: () => clock.ctx });
    const node = <T extends object>(o: T) => { const to: unknown[] = []; return Object.assign(o, { context: ctx, to, connect(x: unknown) { to.push(x); }, disconnect(x?: unknown) { if (x === undefined) to.length = 0; else { const i = to.indexOf(x); if (i >= 0) to.splice(i, 1); } } }); };
    ctx.createAnalyser = () => ({ ...silent, context: ctx });
    ctx.createGain = () => { const g = node({ gain: param(1) }); made.gains.push(g); return g; };
    ctx.createBiquadFilter = () => { const f = node({ type: 'bandpass', frequency: param(350), Q: param(1) }); made.filters.push({ ...f, get to() { return f.to; }, ctx }); return f; };
    ctx.createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) });
    ctx.createBufferSource = () => { const c = { at: NaN, stopped: false }; made.clicks.push(c); return node({ buffer: null, onended: null, start(t: number) { c.at = t; }, stop() { c.stopped = true; } }); };
    return ctx;
  };
  const ctx = mkCtx('songs'), micCtx = mkCtx('mic');
  const loaded = new Set<string>(), playing = new Set<string>();
  const outside: unknown[] = [];
  const audioEngine = {
    loadAudio: vi.fn(async (id: string) => { loaded.add(id); }),
    isLoaded: (id: string) => loaded.has(id), duration: () => clock.buffer?.duration ?? 0, isMasterPaused: () => false,
    startAudio: (id: string) => { playing.add(id); }, stopAudio: (id: string) => { playing.delete(id); }, removeAudio: (id: string) => { loaded.delete(id); playing.delete(id); },
    isPlaying: (id: string) => playing.has(id), getFileName: () => 'kicks.wav',
    getAnalyser: (id: string) => (playing.has(id) ? { ...silent, context: ctx } : null),
    buffer: () => clock.buffer, context: () => ctx,
    connectOutside: (n: unknown) => { outside.push(n); return () => { const i = outside.indexOf(n); if (i >= 0) outside.splice(i, 1); }; },
    position: () => clock.ctx,
    // Started at ctx 0 from the song's start, looping the whole song.
    positionAt: (_id: string, t: number) => { const d = clock.buffer?.duration ?? 0; return d > 0 ? ((t % d) + d) % d : t; },
    playInfo: (id: string) => (playing.has(id) ? { token: clock.token, startedAt: 0, startOff: 0, win: { start: 0, end: clock.buffer?.duration ?? 0 }, loop: true } : null),
    heardTime: () => clock.ctx, outputLatency: () => 0, playToken: () => clock.token,
    setVolume: vi.fn(), seek: vi.fn(),
  };
  const micTap = { ...silent, context: micCtx, to: [] as unknown[], connect(x: unknown) { this.to.push(x); }, disconnect(x?: unknown) { if (x === undefined) this.to.length = 0; else this.to = this.to.filter(y => y !== x); } };
  const liveAudio = { tapNode: () => micTap, isOn: () => true, getStatus: () => 'on', getLabel: () => 'test mic', start: async () => {}, stop: () => {}, onChange: () => () => {}, subscribe: () => () => {} };
  return { audioEngine, made, outside, ctx, micCtx, micTap, liveAudio, loaded, playing };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fakes.audioEngine, trackChainId: (id: string) => `node:${id}` }));
vi.mock('../../liveAudio', () => ({ liveAudio: fakes.liveAudio }));

import { n } from '../../../store/graphBuilder';
import { audioToolsEngine } from '../engine';
import { audioFxHost } from '../../audioFx';
import { listenMix } from '../listen';
import type { GraphNode } from '../../../types/nodeGraph';

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
const KICK = { id: 'k', name: 'Kick', lo: 40, hi: 130, value: false, trigger: true, preset: 'kick', sensitivity: 0.5 };
const SNARE = { id: 's', name: 'Snare', lo: 150, hi: 400, value: false, trigger: true, preset: 'snare', sensitivity: 0.5 };
const fileGraph = (): GraphNode[] => [n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands: [KICK, SNARE] })];

async function ready(nodes: GraphNode[]) {
  audioToolsEngine.setHost(host);
  audioToolsEngine.sync(nodes);
  await audioToolsEngine.loadFile('src', Object.assign(new Blob([new Uint8Array(4)]), { name: 'kicks.wav' }));
  clock.ctx = 0;
  audioToolsEngine.tickInputs(1 / 60, 0, () => {});
  for (let i = 0; i < 40 && audioToolsEngine.sourceView('src')?.ahead !== 'ready'; i++) await new Promise(r => setTimeout(r, 20));
  expect(audioToolsEngine.sourceView('src')?.ahead).toBe('ready');
}

const frames = (from: number, to: number) => { for (let f = Math.round(from * 60); f <= to * 60; f++) { clock.ctx = f / 60; audioToolsEngine.tickInputs(1 / 60, clock.ctx, () => {}); } };
const live = () => fakes.made.clicks.filter(c => !c.stopped).map(c => c.at);

afterEach(() => {
  audioToolsEngine.stopListen();
  audioToolsEngine.sync([]); audioToolsEngine.setHost(null);
  fakes.made.clicks.length = 0; fakes.made.gains.length = 0; fakes.made.filters.length = 0;
  clock.token++;
});

describe('Listen on a File', () => {
  it('plays the band through Solo\'s filters at the band gain, and a click on the clock at each hit picked ahead', async () => {
    await ready(fileGraph());
    expect(audioToolsEngine.listenBand('src', 'k', 0.5)).toBe(true);
    expect(audioToolsEngine.listeningTo()).toEqual({ nodeId: 'src', bandId: 'k' });
    // The track's chain goes into the band's filters (the audition), not the mix.
    expect(audioFxHost.isDiverted('node:src')).toBe(true);
    frames(0, 2.4);
    const v = audioToolsEngine.listenView();
    expect(v?.mode).toBe('ahead');
    const times = v && v.mode === 'ahead' ? Array.from(v.times) : [];
    expect(times.length).toBe(KICKS.length);
    // One click per hit (started at ctx 0 from the song's start: the hit's song time), sample-exact, none twice.
    const at = live().filter(t => t < 2.45);
    expect(at.length).toBe(times.length);
    at.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(128 / SR));
    // Each was on the clock before it played (a quarter of a second ahead at most).
    // Round the loop: the next pass's first kick is on the clock too.
    frames(2.4, 2.9);
    expect(live().some(t => Math.abs(t - (clock.buffer!.duration + times[0])) < 128 / SR)).toBe(true);
  });

  it('the mix sets the band and clicks gains; Solo or Hear hovered takes the sound back; stopping takes back the clicks not played', async () => {
    await ready(fileGraph());
    audioToolsEngine.listenBand('src', 'k', 0.25);
    const clickOut = fakes.outside.find(x => fakes.made.gains.some(g => g === x && g.gain.value === listenMix(0.25).clicks));
    expect(clickOut).toBeTruthy();
    // The audition's out gain: band at 1.
    const outs = fakes.made.gains.filter(g => fakes.outside.includes(g));
    expect(outs.map(g => g.gain.value).sort()).toEqual([0.5, 1]);
    audioToolsEngine.setListenMix(1);
    expect(outs.map(g => g.gain.value).sort()).toEqual([0, 1]);
    audioToolsEngine.setListenMix(0);
    expect(outs.map(g => g.gain.value).sort()).toEqual([0, 1]);
    // Clicks a quarter second ahead, then stop before the first one plays: it is taken back.
    clock.ctx = 0.2;
    audioToolsEngine.setListenMix(0.5);
    frames(0.2, 0.25);
    expect(live().length).toBe(1);
    audioToolsEngine.stopListen();
    expect(live().length).toBe(0);
    expect(audioToolsEngine.listeningTo()).toBeNull();
    expect(audioFxHost.isDiverted('node:src')).toBe(false);
    expect(fakes.outside).toHaveLength(0);
    // Solo (a 'hear' audition) takes the sound from a Listen.
    audioToolsEngine.listenBand('src', 'k', 0.5);
    audioToolsEngine.auditionBand('src', 100, 200);
    expect(audioToolsEngine.listeningTo()).toBeNull();
    // …and a Listen takes it from Solo; Solo stopping then leaves the Listen be.
    audioToolsEngine.listenBand('src', 'k', 0.5);
    audioToolsEngine.stopAudition();
    expect(audioFxHost.isDiverted('node:src')).toBe(true);
    audioToolsEngine.stopListen();
    expect(audioFxHost.isDiverted('node:src')).toBe(false);
  });

  it('one band at a time: listening to another switches, its filters follow the band', async () => {
    await ready(fileGraph());
    audioToolsEngine.listenBand('src', 'k', 0.5);
    audioToolsEngine.listenBand('src', 's', 0.5);
    expect(audioToolsEngine.listeningTo()).toEqual({ nodeId: 'src', bandId: 's' });
    // One click bus and one band out on the mix.
    expect(fakes.outside).toHaveLength(2);
    // Moving the band glides its filter.
    audioToolsEngine.sync([n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands: [KICK, { ...SNARE, lo: 300, hi: 900 }] })]);
    const before = fakes.made.filters.at(-1)!.frequency.value;
    frames(0, 0.05);
    expect(fakes.made.filters.at(-1)!.frequency.value).toBeGreaterThan(before);
    // The band removed: it stops.
    audioToolsEngine.sync([n('audioSource', 'src', 0, 0, { _fileName: 'kicks.wav', bands: [KICK] })]);
    frames(0.05, 0.1);
    expect(audioToolsEngine.listeningTo()).toBeNull();
  });
});

describe('Listen on the Mic', () => {
  it('the band goes to the Mic\'s own speakers at its gain (0 at clicks only); the clicks come from the live detector\'s queue', () => {
    audioToolsEngine.setHost(host);
    audioToolsEngine.sync([n('audioSource', 'src', 0, 0, { source: 'mic', bands: [KICK] })]);
    expect(audioToolsEngine.listenBand('src', 'k', 1)).toBe(true);
    frames(0, 0.05);
    const out = fakes.made.gains.find(g => g.to.includes(fakes.micCtx.destination));
    expect(out?.gain.value).toBe(0);
    const intoFilters = () => fakes.micTap.to.filter(x => typeof x === 'object' && x !== null && 'Q' in x).length;
    expect(intoFilters()).toBe(1);
    audioToolsEngine.setListenMix(0.5);
    expect(out?.gain.value).toBe(1);
    // A live hit the detector queues (to fire 50 ms from now) clicks on the clock then.
    expect(audioToolsEngine.listenView()?.mode).toBe('live');
    const run = (audioToolsEngine as unknown as { sources: Map<string, { runs: Map<string, { hit: { queued?: number[] } }> }> }).sources.get('src')!.runs.get('k')!;
    expect(Array.isArray(run.hit.queued)).toBe(true);
    clock.ctx = 1;
    run.hit.queued!.push(performance.now() / 1000 + 0.05);
    audioToolsEngine.tickInputs(1 / 60, 1, () => {});
    expect(live()).toHaveLength(1);
    expect(live()[0]).toBeGreaterThan(1.03);
    expect(live()[0]).toBeLessThan(1.051);
    audioToolsEngine.stopListen();
    expect(intoFilters()).toBe(0);
    expect(out?.to).toHaveLength(0);
  });
});
