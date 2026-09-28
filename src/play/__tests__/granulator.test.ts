/**
 * Granulator (docs/granulator.md): the settings and their addresses, the pure
 * grain engine (the cap is never passed, the three modes differ, pitch shift
 * and MIDI notes measured by zero crossings, the same seed and notes give the
 * same samples), the real AudioWorklet in an OfflineAudioContext
 * (node-web-audio-api, rendered into buffers only), an offline mix placing a
 * take's note on its sample, the record (parse, targets, sensors, readout
 * controls and nulls), and the web export's kit and carried sample.
 * Nothing here reaches a speaker.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AudioWorkletNode as NodeWorkletNode, OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import {
  GR_MAX_GRAINS, GR_PARAMS, grCreate, grFromDefaults, grFromPoints, type GrThing, grLoadWorklet, grMakeEngine, grNewStats, grParam, grRender, grSettings, grSummary, grSynthData, grWorkletSource,
} from '../kit/granulator.js';
import {
  AE_INST, auTarget, auTargetExists, controlsKeptFor, grainsTarget, parseAudioEngine, parseGrainsTarget, readAuValue, type AeRack, type PlayAudioEngine,
} from '../../types/playAudioEngine';
import { parsePlayRecord, sensorKey, type PlayRecord } from '../../types/play';
import { rackChainId, isChainId } from '../../types/playAudioFx';
import { grainTracks, mixBuffers, padHitsOf } from '../../lib/recordingAudio';
import { addGrainNulls, addGrainReadouts } from '../grainControls';
import { kitScript, leftBehind, playBundle, type PlayHtmlInput } from '../exportHtml';
import { audioEngineHost } from '../../lib/audioEngineHost';
import { usePlan } from '../../lib/plan';
import { grainLog } from '../../lib/grainFrom';
import { parseGrainFrom } from '../../types/playAudioEngine';

const SR = 48000;
beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = NodeWorkletNode;
});

/** Settings by key: the defaults with `over` on top, randomness off unless asked. */
const quiet = (over: Record<string, number> = {}) => ({ ...grSettings(undefined), panRand: 0, spray: 0, attack: 0, decay: 0, sustain: 1, release: 0.05, ...over });
/** Positive-going zero crossings a second in d[from..to]. */
function crossingsHz(d: Float32Array, from: number, to: number, rate = SR): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (d[i - 1] <= 0 && d[i] > 0) n++;
  return n / ((to - from) / rate);
}
function rms(d: Float32Array, from: number, to: number): number { from = Math.floor(from); to = Math.floor(to); let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)); }
const sine = grSynthData('sine', SR); // 220 Hz, 2 s

/** Run the engine in 128-frame blocks, noting the grain count after each. */
function runCounting(settings: Record<string, number>, seconds: number, notes: Array<[number, number]> = [[60, 1]]) {
  const e = grMakeEngine()(SR, 7);
  e.set(settings);
  e.reset(7);
  e.setBuffer([sine], SR);
  for (const [n, v] of notes) e.noteOn(n, v, 0);
  const L = new Float32Array(128), R = new Float32Array(128), st = grNewStats(), counts: number[] = [];
  for (let f = 0; f < seconds * SR; f += 128) { e.process(L, R, 128); counts.push(e.stats(st).count); }
  return { counts, maxCount: st.maxCount };
}

describe('settings', () => {
  it('every setting has its own address, a default inside its range, and the ones asked for', () => {
    const addrs = GR_PARAMS.map(p => p.addr);
    expect(new Set(addrs).size).toBe(addrs.length);
    for (const p of GR_PARAMS) expect(p.value >= p.min && p.value <= p.max, p.key).toBe(true);
    for (const k of ['mode', 'position', 'spray', 'size', 'density', 'pitch', 'spread', 'pitchRand', 'fmRate', 'fmAmount', 'filter', 'cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release', 'window', 'scan', 'lfoRate', 'lfoDepth', 'freeze', 'cap', 'voices']) {
      expect(grParam(k), k).not.toBeNull();
    }
    expect(grParam('cap')!.max).toBe(GR_MAX_GRAINS);
    expect(GR_MAX_GRAINS).toBe(64);
  });
  it('reads the record by address, clamps, and lets a mapping drive a value', () => {
    const s = grSettings({ 1: 0.7, 29: 500, 0: 1.6 }, (a, base) => (a === '3' ? 42 : base));
    expect(s.position).toBe(0.7);
    expect(s.cap).toBe(64);
    expect(s.mode).toBe(2);
    expect(s.size).toBe(42);
    expect(s.density).toBe(grParam('density')!.value);
  });
});

describe('the engine', () => {
  it('never has more grains than the cap, and reaches it when pushed', () => {
    const dense = quiet({ mode: 2, density: 200, size: 2000 });
    for (const cap of [64, 10, 1]) {
      const r = runCounting({ ...dense, cap }, 1.5, [[60, 1], [64, 1], [67, 1]]);
      expect(Math.max(...r.counts), `cap ${cap}`).toBeLessThanOrEqual(cap);
      expect(r.maxCount, `cap ${cap}`).toBe(cap);
    }
    // The render reports the same.
    expect(grRender({ channels: [sine], sampleRate: SR, frames: SR, settings: { ...dense, cap: 12 }, events: [{ t: 0, note: 60, vel: 1 }] }).maxCount).toBe(12);
  });

  it('Classic keeps two grains overlapping; Flux follows Density regularly; Cloud scatters them', () => {
    const base = quiet({ size: 100, density: 50 });
    const classic = runCounting({ ...base, mode: 0 }, 1).counts.slice(20);
    const flux = runCounting({ ...base, mode: 1 }, 1).counts.slice(20);
    const cloud = runCounting({ ...base, mode: 2 }, 1).counts.slice(20);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const variance = (a: number[]) => { const m = mean(a); return mean(a.map(x => (x - m) ** 2)); };
    expect(Math.max(...classic)).toBeLessThanOrEqual(3);
    expect(mean(classic)).toBeGreaterThan(1.5);
    // Flux: 50 grains a second of 100 ms each is about 5 at once.
    expect(mean(flux)).toBeGreaterThan(4);
    expect(mean(flux)).toBeLessThan(6);
    // Cloud: the same rate on average, but at random moments, so the count wanders more.
    expect(mean(cloud)).toBeGreaterThan(3);
    expect(variance(cloud)).toBeGreaterThan(variance(flux) * 2);
    // And they sound different.
    const out = (mode: number) => grRender({ channels: [sine], sampleRate: SR, frames: SR / 2, settings: { ...base, mode }, events: [{ t: 0, note: 60, vel: 1 }] }).left;
    const a = out(0), b = out(1), c = out(2);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
  });

  it('shifts pitch by semitones, and a note plays from the root note', () => {
    const at = (settings: Record<string, number>, note = 60) => {
      const r = grRender({ channels: [sine], sampleRate: SR, frames: SR, settings: quiet({ mode: 0, size: 200, ...settings }), events: [{ t: 0, note, vel: 1 }] });
      return crossingsHz(r.left, SR / 4, SR);
    };
    expect(at({})).toBeGreaterThan(215);
    expect(at({})).toBeLessThan(225);
    expect(at({ pitch: 12 })).toBeGreaterThan(430);
    expect(at({ pitch: 12 })).toBeLessThan(450);
    expect(at({ pitch: -12 })).toBeGreaterThan(105);
    expect(at({ pitch: -12 })).toBeLessThan(115);
    // MIDI: C5 over a C4 root is an octave up; G4 a fifth.
    expect(at({}, 72)).toBeGreaterThan(430);
    expect(at({}, 72)).toBeLessThan(450);
    expect(at({}, 67) / at({}, 60)).toBeCloseTo(1.498, 1);
    // Another root: C5 is now the sample's own pitch.
    expect(at({ root: 72 }, 72)).toBeLessThan(225);
  });

  it('the same seed and notes make the same samples; another seed does not', () => {
    const job = (seed: number) => grRender({
      channels: [sine], sampleRate: SR, frames: SR, events: [{ t: 0.1, note: 60, vel: 0.8 }, { t: 0.3, note: 67, vel: 0.6 }, { t: 0.7, note: 60, vel: 0 }],
      settings: { ...grSettings(undefined), mode: 2, density: 80, spray: 0.3, pitchRand: 5, spread: 7, panRand: 1, levelRand: 0.5, reverse: 0.3, fmRate: 5, fmAmount: 0.5, filter: 1, cutoff: 3000, seed },
    });
    const a = job(3), b = job(3), c = job(4);
    expect(Array.from(a.left)).toEqual(Array.from(b.left));
    expect(Array.from(a.right)).toEqual(Array.from(b.right));
    expect(a.left).not.toEqual(c.left);
  });

  it('a note lands on its exact sample, and silence before it', () => {
    const r = grRender({ channels: [sine], sampleRate: SR, frames: SR / 2, settings: quiet({ window: 3 }), events: [{ t: 0.1, note: 60, vel: 1 }] });
    const first = r.left.findIndex(v => Math.abs(v) > 1e-6);
    expect(first).toBeGreaterThanOrEqual(0.1 * SR);
    expect(first).toBeLessThan(0.1 * SR + 4);
  });

  it('Drone plays with no key; Hold keeps a note after its key goes up; Freeze stops the scan', () => {
    const drone = grRender({ channels: [sine], sampleRate: SR, frames: SR / 2, settings: quiet({ drone: 1 }) });
    expect(rms(drone.left, SR / 4, SR / 2)).toBeGreaterThan(0.01);
    const off = [{ t: 0, note: 60, vel: 1 }, { t: 0.1, note: 60, vel: 0 }];
    const held = grRender({ channels: [sine], sampleRate: SR, frames: SR / 2, settings: quiet({ hold: 1 }), events: off });
    const let_ = grRender({ channels: [sine], sampleRate: SR, frames: SR / 2, settings: quiet({ hold: 0 }), events: off });
    expect(rms(held.left, 0.3 * SR, 0.5 * SR)).toBeGreaterThan(0.01);
    expect(rms(let_.left, 0.3 * SR, 0.5 * SR)).toBeLessThan(1e-4);
    // Scan moves the grains through the file; Freeze keeps them where they started.
    const where = (freeze: number) => {
      const e = grMakeEngine()(SR, 1);
      e.set(quiet({ scan: 1, position: 0.1, freeze }));
      e.setBuffer([sine], SR);
      e.noteOn(60, 1, 0);
      const L = new Float32Array(128), R = new Float32Array(128);
      for (let f = 0; f < SR / 2; f += 128) e.process(L, R, 128);
      return grSummary(e.stats(grNewStats())).mean;
    };
    expect(where(0)).toBeGreaterThan(0.25); // half a second into a two-second file, from 10%
    expect(where(1)).toBeLessThan(0.16);
  });

  it('keeps to the voice count, stealing the oldest', () => {
    const e = grMakeEngine()(SR, 1);
    e.set(quiet({ voices: 2 }));
    e.setBuffer([sine], SR);
    for (const n of [60, 62, 64, 65]) e.noteOn(n, 1, 0);
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let f = 0; f < SR / 4; f += 128) e.process(L, R, 128);
    expect(e.voicesOn()).toBe(2);
  });
});

describe('grains from a layer', () => {
  const thing = (id: number, x: number, y: number, o: Partial<GrThing> = {}): GrThing => ({ id, x, y, vx: 0, vy: 0, age: 0.5, size: 0.5, bright: 0.5, born: false, ...o });
  const settings = grSettings(undefined);

  it('links set each thing’s grains; the closest to the centre first, up to the cap', () => {
    const cfg = grFromDefaults();
    const p = grFromPoints([thing(1, 0.9, 0.5), thing(2, 0.5, 1, { vx: 0.5 }), thing(3, 0.1, 0, { age: 0 })], 0.5, 0.5, cfg, settings);
    expect(p.n).toBe(3);
    const row = (i: number) => Array.from(p.data.subarray(i * 8, i * 8 + 8));
    // Closest to the centre first: thing 1 (0.4 away), then 2 (0.5), then 3 (about 0.64).
    expect(row(0)[0]).toBe(1);
    expect(row(0)[1]).toBeCloseTo(0.9); // X → file position
    expect(row(1)[0]).toBe(2);
    expect(row(1)[2]).toBeCloseTo(12); // Y 1 → pitch +12
    expect(row(1)[3]).toBeCloseTo(300); // speed 1 → 300 ms
    expect(row(2)[4]).toBeCloseTo(1); // age 0 → full level
    expect(row(2)[2]).toBeCloseTo(-12);
    const capped = grFromPoints(Array.from({ length: 100 }, (_, i) => thing(i, i / 100, 0.5)), 0.5, 0.5, cfg, { ...settings, cap: 10 });
    expect(capped.n).toBe(10);
    const ids = Array.from({ length: 10 }, (_, i) => capped.data[i * 8]);
    expect(ids.every(id => Math.abs(id / 100 - 0.5) <= 0.06)).toBe(true);
    // Cutoff is one filter: the things' mean.
    const cut = grFromPoints([thing(1, 0, 0, { bright: 0 }), thing(2, 1, 1, { bright: 1 })], 0.5, 0.5, { births: true, links: [{ prop: 'bright', target: 'cutoff', on: true, min: 1000, max: 3000 }] }, settings);
    expect(cut.cutoff).toBeCloseTo(2000);
  });

  it('density follows the number of things inside; a thing just born plays at once', () => {
    const count = (n: number, born = false, secs = 1) => {
      const e = grMakeEngine()(SR, 3);
      e.set(quiet({ fromRate: 10, size: 20 }));
      e.setBuffer([sine], SR);
      const p = grFromPoints(Array.from({ length: n }, (_, i) => thing(i, 0.2 + i * 0.01, 0.5, { born })), 0.5, 0.5, grFromDefaults(), settings);
      e.points(p.data, p.n, p.cutoff);
      const L = new Float32Array(128), R = new Float32Array(128), st = grNewStats();
      let spawned = 0, prev = 0;
      for (let f = 0; f < secs * SR; f += 128) { e.process(L, R, 128); const c = e.stats(st).count; if (c > prev) spawned += c - prev; prev = c; }
      return { spawned, first: (() => { const e2 = grMakeEngine()(SR, 3); e2.set(quiet({ fromRate: 1 })); e2.setBuffer([sine], SR); e2.points(p.data, p.n, NaN); const l = new Float32Array(4096), r = new Float32Array(4096); e2.process(l, r, 4096); return l.findIndex(v => Math.abs(v) > 1e-7); })() };
    };
    const one = count(1).spawned, four = count(4).spawned;
    expect(one).toBeGreaterThan(7);
    expect(four).toBeGreaterThan(one * 3);
    // Born: the first grain starts on the first frames; not: somewhere in its first interval.
    expect(count(3, true).first).toBeGreaterThanOrEqual(0);
    expect(count(3, true).first).toBeLessThan(4);
    const later = count(3, false).first;
    expect(later === -1 || later > 4).toBe(true);
  });

  it('a render replays the logged things, the same twice; the record keeps the setup', () => {
    grainLog.clear();
    const p = grFromPoints([thing(1, 0.3, 0.5), thing(2, 0.6, 0.8)], 0.5, 0.5, grFromDefaults(), settings);
    grainLog.put('gr', { t: 0, pts: p, inside: 2 });
    grainLog.put('gr', { t: 0.5, pts: { data: new Float32Array(0), n: 0, cutoff: NaN }, inside: 0 });
    expect(grainLog.at('gr', 0.25)?.n).toBe(2);
    expect(grainLog.at('gr', 0.75)?.n).toBe(0);
    const run = () => grRender({ channels: [sine], sampleRate: SR, frames: SR, settings: quiet({ fromRate: 20 }), pointsAt: t => grainLog.at('gr', t) }).left;
    const a = run(), b = run();
    expect(rms(a, 0.05 * SR, 0.45 * SR)).toBeGreaterThan(0.01);
    expect(rms(a, 0.8 * SR, SR)).toBe(0);
    expect(Array.from(a)).toEqual(Array.from(b));
    grainLog.clear();
    const from = { ...grFromDefaults(), source: 'parts', boundary: 'circle' };
    expect(parseGrainFrom(JSON.parse(JSON.stringify(from)))).toEqual(from);
    expect(parseGrainFrom({ source: '' })).toBeUndefined();
    expect(parseGrainFrom({ source: 'p', links: [{ prop: 'nope', target: 'pitch' }, { prop: 'x', target: 'pan', min: -1, max: 1 }] })!.links).toEqual([{ prop: 'x', target: 'pan', on: true, min: -1, max: 1 }]);
  });
});

describe('in Web Audio (node-web-audio-api, offline)', () => {
  it('the AudioWorklet plays notes at their time, at their pitch, and posts its grains', async () => {
    const ctx = new NodeOffline(2, SR, SR) as unknown as OfflineAudioContext;
    expect(await grLoadWorklet(ctx)).toBe(true);
    const g = grCreate(ctx, { seed: 1 });
    g.output.connect(ctx.destination);
    const b = ctx.createBuffer(1, sine.length, SR);
    b.getChannelData(0).set(sine);
    g.setBuffer(b);
    g.set(quiet({ mode: 0, size: 200, pitch: 12, cap: 16 }));
    g.noteOn(60, 1, 0.25);
    for (let i = 0; i < 200 && !g.kind; i++) await new Promise(r => setTimeout(r, 10));
    expect(g.kind).toBe('worklet');
    const out = (await ctx.startRendering()).getChannelData(0);
    expect(rms(out, 0, Math.floor(0.24 * SR))).toBe(0);
    expect(rms(out, Math.floor(0.4 * SR), SR)).toBeGreaterThan(0.01);
    const hz = crossingsHz(out, Math.floor(0.4 * SR), SR);
    expect(hz).toBeGreaterThan(430);
    expect(hz).toBeLessThan(450);
    await new Promise(r => setTimeout(r, 30));
    expect(g.stats().maxCount).toBeGreaterThan(0);
    expect(g.stats().maxCount).toBeLessThanOrEqual(16);
    g.dispose();
  });

  it('the worklet module carries the engine’s own source', () => {
    const src = grWorkletSource();
    expect(src).toContain('registerProcessor(\'pf-granulator\'');
    expect(src).toContain('mulberry');
  });

  it('an offline mix plays a take’s note into a Granulator rack on its sample, the same twice', async () => {
    const ctx = new NodeOffline(2, SR, SR) as unknown as OfflineAudioContext;
    const b = ctx.createBuffer(1, sine.length, SR);
    b.getChannelData(0).set(sine);
    const rack: AeRack = { id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false, instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'sine', name: 'Sine' }, params: { 3: 80, 9: 0, 2: 0, 17: 0, 21: 3 } } };
    const tracks = grainTracks([rack], () => b);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].chain).toBe(rackChainId('gr'));
    const take = { from: 0, events: [{ t: 0.5, do: 'pad', layerId: 'ae:gr', amount: 61, vel: 1 }] };
    const mix = () => mixBuffers(tracks, [], 1, 0, SR, { fx: undefined, padHits: padHitsOf(take, 0) });
    const a = (await mix())!.getChannelData(0), c = (await mix())!.getChannelData(0);
    const first = a.findIndex(v => Math.abs(v) > 1e-6);
    expect(first).toBeGreaterThanOrEqual(0.5 * SR);
    expect(first).toBeLessThan(0.5 * SR + 4);
    expect(rms(a, 0.55 * SR, 0.9 * SR)).toBeGreaterThan(0.01);
    expect(Array.from(a)).toEqual(Array.from(c));
    // A muted rack isn't a track.
    expect(grainTracks([{ ...rack, mute: true }], () => b)).toHaveLength(0);
  });
});

describe('the host', () => {
  it('runs a Granulator rack in Web Audio, plays its notes, and reports its grains as sensors', async () => {
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
    audioEngineHost.resetForTests();
    const ctx = new NodeOffline(2, SR / 2, SR) as unknown as AudioContext;
    const sensors = new Map<string, number>();
    audioEngineHost.configure({ invoke: null, webAudio: { ctx: () => ctx, connect: n => { n.connect(ctx.destination); return () => {}; } }, sensor: (k, v) => sensors.set(k, v), act: null });
    const rack: AeRack = { id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: 'off', channel: 0, volume: 1, mute: false, instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'sine', name: 'Sine' }, params: { 17: 0, 9: 0 } } };
    audioEngineHost.frame({ racks: [rack] }, []);
    await audioEngineHost.settled();
    const g = audioEngineHost.granulator('gr');
    expect(g).not.toBeNull();
    for (let i = 0; i < 200 && !g!.engineKind(); i++) await new Promise(r => setTimeout(r, 10));
    expect(g!.engineKind()).toBe('worklet');
    audioEngineHost.onPad({ layerId: 'ae:gr', amount: 61, vel: 1 });
    await new Promise(r => setTimeout(r, 10));
    audioEngineHost.frame({ racks: [rack] }, [], (_id, _k, base) => base);
    const out = (await (ctx as unknown as OfflineAudioContext).startRendering()).getChannelData(0);
    expect(rms(out, SR / 8, SR / 2)).toBeGreaterThan(0.01);
    await new Promise(r => setTimeout(r, 30));
    audioEngineHost.frame({ racks: [rack] }, [], (_id, _k, base) => base);
    expect(sensors.has('ae:gr::grains')).toBe(true);
    expect(sensors.has('ae:gr::grainPos16')).toBe(true);
    expect(audioEngineHost.spectrum('gr')).not.toBeUndefined();
    audioEngineHost.resetForTests();
    expect(audioEngineHost.granulator('gr')).toBeNull();
  });
});

describe('the record', () => {
  const rack = (over: Partial<AeRack> = {}): AeRack => ({
    id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false,
    instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'vowel', name: 'Vowel' }, params: { 1: 0.4, 0: 2 } }, ...over,
  });
  const ae = (): PlayAudioEngine => ({ racks: [rack()] });

  it('parses a granulator (its settings clamped, unknown addresses and samples dropped)', () => {
    const raw = { racks: [rack({ instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'nope', name: 'x' }, params: { 1: 3, 999: 1, 3: 50 } } })] };
    const p = parseAudioEngine(raw)!;
    expect(p.racks[0].instrument).toEqual({ id: AE_INST, kind: 'granulator', params: { 1: 1, 3: 50 } });
    const lib = parseAudioEngine({ racks: [rack({ instrument: { id: AE_INST, kind: 'granulator', sample: { sampleId: 'snd_1', name: 'Voice' } } })] })!;
    expect(lib.racks[0].instrument!.sample).toEqual({ sampleId: 'snd_1', name: 'Voice' });
    expect(parseAudioEngine(ae())).toEqual(ae());
  });

  it('every setting is a target; its value reads back (the default when unset)', () => {
    expect(auTargetExists(ae(), auTarget('gr', AE_INST, '1'))).toBe(true);
    expect(auTargetExists(ae(), auTarget('gr', AE_INST, '999'))).toBe(false);
    expect(readAuValue(ae(), auTarget('gr', AE_INST, '1'))).toBe(0.4);
    expect(readAuValue(ae(), auTarget('gr', AE_INST, '3'))).toBe(grParam('size')!.value);
  });

  it('grain readouts: targets, sensors on the rack, kept only while the rack is a granulator', () => {
    expect(parseGrainsTarget(grainsTarget('gr', 'grainMean'))).toEqual({ rackId: 'gr', read: 'grainMean' });
    expect(parseGrainsTarget('grains:gr::nope')).toBeNull();
    expect(sensorKey({ layerId: 'ae:gr', read: 'grainPos', otherId: '3' })).toBe('ae:gr::grainPos3');
    expect(sensorKey({ layerId: 'ae:gr', read: 'grains' })).toBe('ae:gr::grains');
    const base: PlayRecord = { version: 1, controls: [], mappings: [], layers: [], audioEngine: ae() };
    const p = addGrainReadouts(base, 'gr');
    expect(p.controls.map(c => c.target)).toEqual([grainsTarget('gr', 'grains'), grainsTarget('gr', 'grainMean'), grainsTarget('gr', 'grainSpread')]);
    expect(p.mappings.every(m => m.source.kind === 'sensor' && m.source.layerId === 'ae:gr')).toBe(true);
    expect(addGrainReadouts(p, 'gr')).toBe(p);
    // A file keeps them (and their sensor mappings) while the rack is there…
    const kept = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(kept.controls).toHaveLength(3);
    expect(kept.mappings).toHaveLength(3);
    // …and drops them with it.
    const gone = parsePlayRecord(JSON.parse(JSON.stringify({ ...p, audioEngine: { racks: [rack({ id: 'other' })] } })));
    expect(gone.controls).toHaveLength(0);
    expect(gone.mappings).toHaveLength(0);
    expect(controlsKeptFor(p.controls, { racks: [] })).toHaveLength(0);
  });

  it('Grains → nulls: null layers whose x and y follow grains 1..n', () => {
    const base: PlayRecord = { version: 1, controls: [], mappings: [], layers: [], audioEngine: ae() };
    const p = addGrainNulls(base, 'gr', 4);
    expect(p.layers.filter(l => l.kind === 'null')).toHaveLength(4);
    expect(p.controls).toHaveLength(8);
    const reads = p.mappings.map(m => (m.source.kind === 'sensor' ? `${m.source.read}${m.source.otherId}` : ''));
    expect(reads).toEqual(['grainPos1', 'grainAmp1', 'grainPos2', 'grainAmp2', 'grainPos3', 'grainAmp3', 'grainPos4', 'grainAmp4']);
    expect(parsePlayRecord(JSON.parse(JSON.stringify(p))).mappings).toHaveLength(8);
  });

  it('the rack has its own Sound chain', () => {
    expect(isChainId(rackChainId('gr'))).toBe(true);
  });
});

describe('web export', () => {
  const rack: AeRack = { id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false, instrument: { id: AE_INST, kind: 'granulator', sample: { sampleId: 'snd_1', name: 'voice.wav' } } };
  const input = (src: string | null): PlayHtmlInput => ({
    title: 'T', fragmentShader: '', uniforms: {}, paramBindings: {}, aspect: '16:9' as never,
    play: { version: 1, controls: [], mappings: [], layers: [], audioEngine: { racks: [rack] } },
    media: { rackSamples: { gr: { label: 'Grains · Granulator', name: 'voice.wav', src, bytes: src ? src.length : 0 } } },
  });
  it('carries a Library sample in the rack, and says when it stayed out', () => {
    const b = playBundle(input('data:audio/wav;base64,AAAA'));
    expect((b.play.audioEngine!.racks[0].instrument!.sample as { src?: string }).src).toBe('data:audio/wav;base64,AAAA');
    expect(leftBehind(input('data:audio/wav;base64,AAAA').play, input('data:audio/wav;base64,AAAA').media).some(x => x.what.includes('voice.wav'))).toBe(false);
    expect(leftBehind(input(null).play, input(null).media).some(x => x.what.includes('voice.wav'))).toBe(true);
  });
  it('the page’s kit has the same granulator', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { granulator: { params: typeof GR_PARAMS; settings: typeof grSettings; summary: typeof grSummary } };
    expect(SSKit.granulator.params.length).toBe(GR_PARAMS.length);
    expect(SSKit.granulator.settings({ 1: 0.5 }).position).toBe(0.5);
  });
});
