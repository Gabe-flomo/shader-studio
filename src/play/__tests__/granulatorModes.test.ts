/**
 * Granulator's Emit and Spectral modes (docs/granulator.md): Emit's travelling
 * spawn points (forward, backward, alternate, and what they do at the ends:
 * wrap, bounce, respawn), Spectral's analysis (peaks at the right bins), band
 * selection measured by zero crossings, Shift, the readouts (band, energy,
 * spawn points), bit-exact renders for a seed, and the AudioWorklet getting
 * the analysis from the main thread (node-web-audio-api, rendered into
 * buffers only). Nothing here reaches a speaker.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AudioWorkletNode as NodeWorkletNode, OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import { GR_MODES, GR_SIDES, GR_SPEC_GRAINS, grAnalyse, grParam, grCreate, grLoadWorklet, grMakeEngine, grNewStats, grReadStats, grRender, grSettings, grSpectrumImage, grSummary, type GrStats } from '../kit/granulator.js';
import { AE_INST, parseAudioEngine } from '../../types/playAudioEngine';

const SR = 48000;
beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = NodeWorkletNode;
});

/** Sines at these frequencies (each at amplitude `a`), `secs` long. */
function tones(freqs: number[], secs = 2, a = 0.4): Float32Array {
  const out = new Float32Array(Math.round(secs * SR));
  for (let i = 0; i < out.length; i++) for (const f of freqs) out[i] += a * Math.sin(2 * Math.PI * f * i / SR);
  return out;
}
function crossingsHz(d: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (d[i - 1] <= 0 && d[i] > 0) n++;
  return n / ((to - from) / SR);
}
function rms(d: Float32Array, from: number, to: number): number { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)); }
/** Where `hz` sits on the Band axis (log, 20 Hz to half the rate). */
const bandOf = (hz: number) => Math.log(hz / 20) / Math.log(SR / 2 / 20);
const quiet = (over: Record<string, number> = {}) => ({ ...grSettings(undefined), panRand: 0, spray: 0, attack: 0, decay: 0, sustain: 1, release: 0.05, drone: 1, ...over });

/** A drone for `secs`, returning the spawn points (and the stats) at the end. */
function heads(over: Record<string, number>, secs: number, seed = 5): { heads: number[]; st: GrStats } {
  const e = grMakeEngine()(SR, seed);
  e.set(quiet(over));
  e.reset(seed);
  e.setBuffer([tones([220])], SR);
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let f = 0; f < secs * SR; f += 128) e.process(L, R, 128);
  const st = e.stats(grNewStats());
  return { heads: Array.from(st.heads.slice(0, st.headCount)), st };
}

describe('Emit', () => {
  it('is a mode, beside Classic, Flux and Cloud', () => {
    expect(GR_MODES).toEqual(['Classic', 'Flux', 'Cloud', 'Emit', 'Spectral']);
  });
  it('spawn points travel at Speed sample lengths a second, forward or backward', () => {
    const fwd = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitDir: 0 }, 0.25);
    expect(fwd.st.headAxis).toBe(1);
    expect(fwd.heads).toHaveLength(8);
    for (const h of fwd.heads) expect(h).toBeCloseTo(0.75, 2);
    const back = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitDir: 1 }, 0.25);
    for (const h of back.heads) expect(h).toBeCloseTo(0.25, 2);
    // Both · alternate: every other one goes the other way.
    const both = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 0.4, emitDir: 2 }, 0.25);
    both.heads.forEach((h, i) => expect(h).toBeCloseTo(i % 2 ? 0.4 : 0.6, 2));
  });
  it('at the end: Wrap carries on from the other end, Bounce turns back, Respawn jumps (seeded)', () => {
    const wrap = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitEdge: 0 }, 0.75);
    for (const h of wrap.heads) expect(h).toBeCloseTo(0.25, 2);
    const bounce = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitEdge: 1 }, 0.75);
    for (const h of bounce.heads) expect(h).toBeCloseTo(0.75, 2);
    // After bouncing it heads back down.
    const later = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitEdge: 1 }, 0.85);
    for (const h of later.heads) expect(h).toBeCloseTo(0.65, 2);
    const a = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitEdge: 2 }, 0.75);
    const b = heads({ mode: 3, position: 0.5, emitSpread: 0, emitSpeed: 1, emitEdge: 2 }, 0.75);
    expect(a.heads).toEqual(b.heads);
    expect(a.heads.some(h => Math.abs(h - 0.25) > 0.02)).toBe(true);
    // Each respawned point went somewhere of its own, then travelled 0.25.
    expect(new Set(a.heads.map(h => h.toFixed(3))).size).toBeGreaterThan(4);
  });
  it('Spread: 0 shoots every grain from Position in one line; 1 scatters the spawn points over the sample', () => {
    const tight = heads({ mode: 3, position: 0.3, emitSpread: 0, emitSpeed: 0 }, 0.1);
    expect(Math.max(...tight.heads) - Math.min(...tight.heads)).toBeLessThan(1e-9);
    const wide = heads({ mode: 3, position: 0.5, emitSpread: 1, emitSpeed: 0 }, 0.1);
    expect(Math.max(...wide.heads) - Math.min(...wide.heads)).toBeGreaterThan(0.7);
    // The grains read where the spawn points are.
    const e = grMakeEngine()(SR, 3);
    e.set(quiet({ mode: 3, position: 0.3, emitSpread: 0, emitSpeed: 0, density: 50, size: 60 }));
    e.reset(3);
    e.setBuffer([tones([220])], SR);
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let f = 0; f < 0.3 * SR; f += 128) e.process(L, R, 128);
    const st = e.stats(grNewStats());
    expect(st.count).toBeGreaterThan(0);
    for (let i = 0; i < st.count; i++) expect(Math.abs(st.pos[i] - 0.3)).toBeLessThan(0.1);
  });
  it('a take renders bit for bit the same with one seed, and differently with another', () => {
    const r = (seed: number) => grRender({ channels: [tones([220, 330])], frames: SR, settings: quiet({ mode: 3, emitSpeed: 1.3, emitEdge: 2, emitDir: 3, emitSpread: 0.4, spray: 0.02, seed }), seed });
    expect(Array.from(r(4).left)).toEqual(Array.from(r(4).left));
    expect(Array.from(r(4).left)).not.toEqual(Array.from(r(5).left));
  });
});

describe('Spectral', () => {
  it('analyses a sample into peaks at the right frequencies, strongest first', () => {
    const sp = grAnalyse([tones([440, 3000], 1)], 2048);
    expect(sp.size).toBe(2048);
    expect(sp.hop).toBe(512);
    const f = Math.floor(sp.frames / 2), o = f * sp.peaks;
    expect(sp.count[f]).toBeGreaterThanOrEqual(2);
    const hz = [sp.bins[o], sp.bins[o + 1]].map(b => b * SR / 2048).sort((a, b) => a - b);
    expect(hz[0]).toBeCloseTo(440, -1);
    expect(hz[1]).toBeCloseTo(3000, -1);
    // Amplitudes come out as the sines'.
    expect(sp.amps[o]).toBeGreaterThan(0.3);
    expect(sp.amps[o]).toBeLessThan(0.5);
    // The same sample gives the same analysis.
    expect(Array.from(grAnalyse([tones([440, 3000], 1)], 2048).bins)).toEqual(Array.from(sp.bins));
    const img = grSpectrumImage(sp, 40, 24, SR);
    expect(img.length).toBe(40 * 24);
    expect(Math.max(...img)).toBeCloseTo(1, 5);
  });
  it('plays the band it is pointed at: low band → the low tone, high band → the high one', () => {
    const sample = tones([220, 3520]);
    const play = (band: number, over: Record<string, number> = {}) =>
      grRender({ channels: [sample], frames: SR, settings: quiet({ mode: 4, band, bandWidth: 0.08, bandSpread: 0, size: 200, density: 30, pitchRand: 0, ...over }), seed: 1 }).left;
    const low = play(bandOf(220)), high = play(bandOf(3520));
    const from = Math.floor(0.3 * SR);
    expect(rms(low, from, SR)).toBeGreaterThan(0.02);
    expect(crossingsHz(low, from, SR)).toBeCloseTo(220, -1);
    expect(crossingsHz(high, from, SR)).toBeGreaterThan(3400);
    expect(crossingsHz(high, from, SR)).toBeLessThan(3650);
    // Pitch multiplies, Shift adds hertz.
    expect(crossingsHz(play(bandOf(220), { pitch: 12 }), from, SR)).toBeCloseTo(440, -1);
    expect(crossingsHz(play(bandOf(220), { shift: 100 }), from, SR)).toBeCloseTo(320, -1);
    // A band with nothing in it is silent.
    expect(rms(play(bandOf(1000), { bandWidth: 0.02 }), from, SR)).toBe(0);
  });
  it('reads back each grain’s band and energy, and travels along the frequency axis', () => {
    const e = grMakeEngine()(SR, 2);
    e.set(quiet({ mode: 4, band: 0.4, bandSpread: 0, bandWidth: 1, density: 40 }));
    e.reset(2);
    e.setBuffer([tones([220, 880])], SR);
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let f = 0; f < 0.4 * SR; f += 128) e.process(L, R, 128);
    const st = e.stats(grNewStats());
    expect(st.count).toBeGreaterThan(0);
    for (let i = 0; i < st.count; i++) { expect(st.band[i]).toBeCloseTo(0.4, 5); expect(st.energy[i]).toBeGreaterThanOrEqual(0); }
    expect(Math.max(...Array.from(st.energy.slice(0, st.count)))).toBeGreaterThan(0);
    const sum = grSummary(st);
    expect(sum.band).toBeCloseTo(0.4, 5);
    expect(sum.energy).toBeGreaterThan(0);
    expect(st.headAxis).toBe(2);
    // Travel: the bands move up the spectrum and bounce at the top (the default edge).
    const moving = heads({ mode: 4, band: 0.5, bandSpread: 0, bandSpeed: 1, bandDir: 0 }, 0.75);
    for (const h of moving.heads) expect(h).toBeCloseTo(0.75, 2);
    expect(moving.st.headAxis).toBe(2);
  });
  it('the same seed resynthesises the same samples, bit for bit; another seed does not', () => {
    const r = (seed: number) => grRender({ channels: [tones([220, 660, 1500])], frames: SR, settings: quiet({ mode: 4, band: 0.45, bandSpread: 0.3, bandSpeed: 0.7, bandDir: 3, bandEdge: 2, spray: 0.2, pitchRand: 2, seed }), seed }).left;
    const a = r(9), b = r(9), c = r(10);
    expect(rms(a, 0, SR)).toBeGreaterThan(0.005);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
  it('the AudioWorklet gets the analysis from the main thread and posts band and energy back', async () => {
    const ctx = new NodeOffline(2, SR, SR) as unknown as OfflineAudioContext;
    expect(await grLoadWorklet(ctx)).toBe(true);
    const g = grCreate(ctx, { seed: 1 });
    g.output.connect(ctx.destination);
    const data = tones([220]);
    const b = ctx.createBuffer(1, data.length, SR);
    b.getChannelData(0).set(data);
    g.setBuffer(b);
    g.set(quiet({ mode: 4, drone: 0, band: bandOf(220), bandWidth: 0.1, bandSpread: 0, size: 150, density: 30 }));
    expect(g.spectrum()?.frames).toBeGreaterThan(0);
    g.noteOn(60, 1, 0.1);
    for (let i = 0; i < 200 && !g.kind; i++) await new Promise(r => setTimeout(r, 10));
    expect(g.kind).toBe('worklet');
    const out = (await ctx.startRendering()).getChannelData(0);
    expect(rms(out, Math.floor(0.3 * SR), SR)).toBeGreaterThan(0.01);
    expect(crossingsHz(out, Math.floor(0.3 * SR), SR)).toBeCloseTo(220, -1);
    await new Promise(r => setTimeout(r, 30));
    expect(g.stats().maxCount).toBeGreaterThan(0);
    g.dispose();
  });
  it('the worklet’s packed readouts unpack to the same numbers', () => {
    const st = grNewStats();
    const c = 2, d = new Float32Array(12 + c * 5);
    d[0] = c; d[1] = 7; d[2] = 8; d[3] = 2;
    for (let h = 0; h < 8; h++) d[4 + h] = h / 10;
    d.set([0.1, 0.2], 12); d.set([0.5, 0.6], 14); d.set([1, -1], 16); d.set([0.3, 0.4], 18); d.set([0.05, 0.07], 20);
    grReadStats(d, st);
    expect(st.count).toBe(2);
    expect(st.maxCount).toBe(7);
    expect(st.headCount).toBe(8);
    expect(st.headAxis).toBe(2);
    expect(st.heads[3]).toBeCloseTo(0.3, 6);
    expect(Array.from(st.band.slice(0, 2))).toEqual([Math.fround(0.3), Math.fround(0.4)]);
    expect(Array.from(st.energy.slice(0, 2))).toEqual([Math.fround(0.05), Math.fround(0.07)]);
  });
});

describe('Spectral grains: on the line, emitted, spread', () => {
  const SAMPLE_SECS = 2;
  /** A spectral drone for `secs` on a two-tone sample; the grains' file positions at the end, and the stats. */
  function spec(over: Record<string, number>, secs: number, seed = 3): { pos: number[]; st: GrStats } {
    const e = grMakeEngine()(SR, seed);
    e.set(quiet({ mode: 4, band: 0.4, bandWidth: 1, bandSpread: 0, density: 60, size: 150, ...over }));
    e.reset(seed);
    e.setBuffer([tones([220, 880], SAMPLE_SECS)], SR);
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let f = 0; f < secs * SR; f += 128) e.process(L, R, 128);
    const st = e.stats(grNewStats());
    return { pos: Array.from(st.pos.slice(0, st.count)), st };
  }
  const render = (over: Record<string, number>, seed = 4) =>
    grRender({ channels: [tones([220, 660, 1500])], frames: SR, settings: quiet({ mode: 4, band: 0.45, bandWidth: 0.6, bandSpread: 0.2, size: 120, density: 40, spray: 0, ...over }), seed }).left;

  it('is a list setting that starts On the line, so older saves sound as they did', () => {
    expect(GR_SPEC_GRAINS).toEqual(['On the line', 'Emit', 'Spread']);
    expect(GR_SIDES).toEqual(['Both', 'Ahead', 'Behind']);
    expect(grParam('specGrains')).toMatchObject({ addr: 49, kind: 'list', value: 0 });
    expect(grParam('specArea')).toMatchObject({ addr: 50, min: 0, max: 1 });
    expect(grParam('specSide')).toMatchObject({ addr: 51, kind: 'list', value: 0 });
    expect(grSettings(undefined).specGrains).toBe(0);
    // No setting and an explicit "On the line" are the same samples (Area and Side mean nothing there).
    const a = render({}), b = render({ specGrains: 0, specArea: 0.9, specSide: 2 });
    expect(Array.from(a)).toEqual(Array.from(b));
    // On the line: every grain reads where Position is.
    const line = spec({ position: 0.3 }, 0.4);
    expect(line.pos.length).toBeGreaterThan(3);
    for (const p of line.pos) expect(p).toBeCloseTo(0.3, 4);
    expect(line.st.theadCount).toBe(0);
  });

  it('Spread: grains land inside the Area around Position, either side, ahead or behind', () => {
    const both = spec({ position: 0.5, specGrains: 2, specArea: 0.4, specSide: 0 }, 0.5);
    expect(both.pos.length).toBeGreaterThan(5);
    for (const p of both.pos) { expect(p).toBeGreaterThanOrEqual(0.3 - 1e-6); expect(p).toBeLessThanOrEqual(0.7 + 1e-6); }
    expect(both.pos.some(p => p < 0.45)).toBe(true);
    expect(both.pos.some(p => p > 0.55)).toBe(true);
    const ahead = spec({ position: 0.5, specGrains: 2, specArea: 0.4, specSide: 1 }, 0.5);
    for (const p of ahead.pos) { expect(p).toBeGreaterThanOrEqual(0.5 - 1e-6); expect(p).toBeLessThanOrEqual(0.9 + 1e-6); }
    const behind = spec({ position: 0.5, specGrains: 2, specArea: 0.4, specSide: 2 }, 0.5);
    for (const p of behind.pos) { expect(p).toBeGreaterThanOrEqual(0.1 - 1e-6); expect(p).toBeLessThanOrEqual(0.5 + 1e-6); }
    // Area 0 is the line again.
    for (const p of spec({ position: 0.5, specGrains: 2, specArea: 0 }, 0.3).pos) expect(p).toBeCloseTo(0.5, 4);
  });

  it('Emit: grains leave from spawn points travelling from Position, and travel on themselves', () => {
    // One line (Emit spread 0), forward at 1 sample length a second: after 0.25 s the spawn points are at 0.5,
    // and every live grain, riding on at the same speed, is there too.
    const fwd = spec({ position: 0.25, specGrains: 1, emitSpread: 0, emitSpeed: 1, emitDir: 0, size: 100 }, 0.25);
    expect(fwd.st.theadCount).toBe(8);
    for (let i = 0; i < 8; i++) expect(fwd.st.theads[i]).toBeCloseTo(0.5, 2);
    // The bands' spawn points are still posted on their own axis.
    expect(fwd.st.headAxis).toBe(2);
    expect(fwd.pos.length).toBeGreaterThan(2);
    for (const p of fwd.pos) expect(p).toBeCloseTo(0.5, 2);
    const back = spec({ position: 0.75, specGrains: 1, emitSpread: 0, emitSpeed: 1, emitDir: 1, size: 100 }, 0.25);
    for (const p of back.pos) expect(p).toBeCloseTo(0.5, 2);
    // A grain moves while it sounds: 0.5 sample lengths a second for 0.1 s.
    const e = grMakeEngine()(SR, 3);
    e.set(quiet({ mode: 4, band: 0.4, bandWidth: 1, bandSpread: 0, density: 5, size: 400, position: 0.2, specGrains: 1, emitSpread: 0, emitSpeed: 0.5 }));
    e.reset(3);
    e.setBuffer([tones([220, 880], SAMPLE_SECS)], SR);
    const L = new Float32Array(128), R = new Float32Array(128);
    e.process(L, R, 128);
    const first = e.stats(grNewStats());
    expect(first.count).toBe(1);
    const p0 = first.pos[0];
    for (let f = 0; f < 0.1 * SR; f += 128) e.process(L, R, 128);
    expect(e.stats(grNewStats()).pos[0] - p0).toBeCloseTo(0.05, 2);
  });

  it('each way sounds different from the line, and each renders bit for bit for a seed', () => {
    const line = render({ specGrains: 0 });
    const emit = render({ specGrains: 1, emitSpeed: 0.6, emitSpread: 0.3, emitDir: 2 });
    const spread = render({ specGrains: 2, specArea: 0.8 });
    for (const d of [line, emit, spread]) expect(rms(d, Math.floor(0.2 * SR), SR)).toBeGreaterThan(0.005);
    expect(Array.from(emit)).not.toEqual(Array.from(line));
    expect(Array.from(spread)).not.toEqual(Array.from(line));
    expect(Array.from(spread)).not.toEqual(Array.from(emit));
    expect(Array.from(render({ specGrains: 1, emitSpeed: 0.6, emitSpread: 0.3, emitDir: 2 }))).toEqual(Array.from(emit));
    expect(Array.from(render({ specGrains: 2, specArea: 0.8 }))).toEqual(Array.from(spread));
  });

  it('the worklet posts Spectral · Emit’s places in the sample after the grains (an older pack reads as none)', () => {
    const st = grNewStats();
    const c = 1, d = new Float32Array(12 + c * 7 + 9);
    d[0] = c; d[2] = 8; d[3] = 2;
    d[12 + 7] = 8;
    for (let t = 0; t < 8; t++) d[12 + 7 + 1 + t] = t / 8;
    grReadStats(d, st);
    expect(st.theadCount).toBe(8);
    expect(st.theads[4]).toBeCloseTo(0.5, 6);
    grReadStats(new Float32Array(12 + c * 7), st);
    expect(st.theadCount).toBe(0);
  });

  it('the record keeps the new settings, clamped', () => {
    const raw = { racks: [{ id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false,
      instrument: { id: AE_INST, kind: 'granulator', params: { 0: 4, 49: 7, 50: 0.35, 51: 1 } } }] };
    expect(parseAudioEngine(raw)!.racks[0].instrument!.params).toEqual({ 0: 4, 49: 2, 50: 0.35, 51: 1 });
    const settings = grSettings({ 0: 4, 49: 1.4, 50: -1, 51: 2 });
    expect(settings.specGrains).toBe(1);
    expect(settings.specArea).toBe(0);
    expect(settings.specSide).toBe(2);
  });
});
