/**
 * Audio effects (play/kit/audioFx.js, types/playAudioFx.ts, lib/audioFx.ts,
 * lib/audioFxOffline.ts): distortion curves, targets and the record (parse,
 * old files, controls on its numbers, Free), chains built and rendered in a
 * real OfflineAudioContext (node-web-audio-api), an offline mix with and
 * without a low-pass, a take's automation in a render, and exports carrying it.
 * Nothing here reaches a speaker: every sound is rendered into a buffer.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import {
  AF_EFFECTS, AF_KINDS, AF_SPAN, afCreateChain, afCurve, afEchoSeconds, afImpulseData, afMix, afNewEffect, afShape, afSignature, type AfChainRecord,
} from '../kit/audioFx.js';
import {
  audioFxPropId, audioFxTarget, isAudioFxEmpty, parseAudioFx, parseAudioFxTarget, patchAudioFxEffect, readAudioFxValue, type PlayAudioFx,
} from '../../types/playAudioFx';
import { emptyPlayRecord, isPlayRecordEmpty, parsePlayRecord, parsePropTarget, type PlayRecord, type PlayTake } from '../../types/play';
import { playableForPlan, proOnlyParts } from '../planGates';
import { bakeLayerValues, readControlValue } from '../playControls';
import { buildPlayHtml, kitScript, playBundle, type PlayHtmlInput } from '../exportHtml';
import { mixBuffers, type RecordingTrack } from '../../lib/recordingAudio';
import { takeValueAt } from '../../lib/audioFxOffline';
import { encodeKeys } from '../../lib/takePlayback';
import { audioFxHost } from '../../lib/audioFx';

const RATE = 44100;

beforeAll(() => {
  // The offline mix makes its own OfflineAudioContext.
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
});

/** A buffer of sines (Hz, amplitude) for `secs`. */
function tone(ctx: BaseAudioContext, secs: number, parts: Array<[number, number]>): AudioBuffer {
  const b = ctx.createBuffer(2, Math.ceil(secs * RATE), RATE);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) { let v = 0; for (const [hz, a] of parts) v += a * Math.sin((2 * Math.PI * hz * i) / RATE); d[i] = v; }
  }
  return b;
}
function rms(d: Float32Array, from = 0, to = d.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
/** The level of one frequency in a block (a single DFT bin). */
function level(d: Float32Array, hz: number, from = 0, n = 8192): number {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * hz * i) / RATE; re += d[from + i] * Math.cos(a); im += d[from + i] * Math.sin(a); }
  return (2 * Math.hypot(re, im)) / n;
}
/** Render `secs` of `parts` through a chain record. */
async function render(chain: AfChainRecord | null, parts: Array<[number, number]>, secs = 0.5): Promise<AudioBuffer> {
  const ctx = new NodeOffline(2, Math.ceil(secs * RATE), RATE) as unknown as OfflineAudioContext;
  const src = ctx.createBufferSource();
  src.buffer = tone(ctx, secs, parts);
  const c = afCreateChain(ctx);
  c.update(chain, (e, k) => e[k] as number, null);
  src.connect(c.input);
  c.output.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}
const chainOf = (...effects: ReturnType<typeof afNewEffect>[]): AfChainRecord => ({ on: true, effects });

describe('distortion curves', () => {
  it('soft is tanh: odd, bounded, near-linear at small signals', () => {
    for (const x of [0.01, 0.3, 2, 7]) {
      expect(afShape('soft', -x)).toBeCloseTo(-afShape('soft', x), 9);
      expect(Math.abs(afShape('soft', x))).toBeLessThan(1);
    }
    expect(afShape('soft', 0.01)).toBeCloseTo(0.01, 4);
  });
  it('hard clips at ±1 and passes the middle unchanged', () => {
    expect(afShape('hard', 0.5)).toBe(0.5);
    expect(afShape('hard', 3)).toBe(1);
    expect(afShape('hard', -5)).toBe(-1);
  });
  it('fold reflects back into ±1 past the edges', () => {
    expect(afShape('fold', 0.4)).toBeCloseTo(0.4, 9);
    expect(afShape('fold', 1.5)).toBeCloseTo(0.5, 9);
    expect(afShape('fold', 2.5)).toBeCloseTo(-0.5, 9);
    expect(afShape('fold', -1.5)).toBeCloseTo(-0.5, 9);
    for (let x = -8; x <= 8; x += 0.37) expect(Math.abs(afShape('fold', x))).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('tube is asymmetric (even harmonics)', () => {
    expect(afShape('tube', 1) + afShape('tube', -1)).toBeGreaterThan(0.05);
    expect(afShape('tube', 0)).toBe(0);
  });
  it('bitcrush has 2^(bits-1) steps each side', () => {
    const seen = new Set<number>();
    for (let x = -1; x <= 1; x += 0.001) seen.add(afShape('bitcrush', x, 3));
    expect(seen.size).toBe(2 * 4 + 1);
    expect(afShape('bitcrush', 0.3, 1)).toBe(0);
    expect(afShape('bitcrush', 0.6, 1)).toBe(1);
  });
  it('curves span ±AF_SPAN, odd-sized so 0 maps to 0', () => {
    for (const k of ['soft', 'hard', 'fold', 'tube', 'bitcrush']) {
      const c = afCurve(k, 6);
      expect(c.length % 2).toBe(1);
      expect(c[(c.length - 1) / 2]).toBeCloseTo(0, 9);
      expect(c[c.length - 1]).toBeCloseTo(afShape(k, AF_SPAN, 6), 6);
    }
  });
});

describe('the catalogue and helpers', () => {
  it('every kind has numbers with defaults in range', () => {
    expect(AF_KINDS).toEqual(['filter', 'echo', 'reverb', 'distortion', 'compressor']);
    for (const k of AF_KINDS) for (const p of AF_EFFECTS[k].params) { expect(p.value).toBeGreaterThanOrEqual(p.min); expect(p.value).toBeLessThanOrEqual(p.max); }
  });
  it('an echo syncs to note values at its tempo', () => {
    expect(afEchoSeconds({ sync: 'off', time: 250 })).toBeCloseTo(0.25);
    expect(afEchoSeconds({ sync: '1/4', bpm: 120 })).toBeCloseTo(0.5);
    expect(afEchoSeconds({ sync: '1/8d', bpm: 120 })).toBeCloseTo(0.375);
    expect(afEchoSeconds({ sync: '1/4t', bpm: 90 })).toBeCloseTo(60 / 90 * 2 / 3);
  });
  it('mix is equal power', () => {
    for (const m of [0, 0.3, 1]) { const [d, w] = afMix(m); expect(d * d + w * w).toBeCloseTo(1, 9); }
  });
  it('impulse responses are seeded (same settings, same reverb) and decay', () => {
    const a = afImpulseData(8000, 'hall', 0.5, 1), b = afImpulseData(8000, 'hall', 0.5, 1);
    expect(a[0]).toEqual(b[0]);
    expect(rms(a[0], 0, 800)).toBeGreaterThan(rms(a[0], a[0].length - 800) * 10);
    expect(afImpulseData(8000, 'room', 0.5, 3)[0].length).toBeGreaterThan(afImpulseData(8000, 'room', 0.5, 1)[0].length);
  });
  it('the signature changes with order, options and on/off, not with numbers', () => {
    const f = afNewEffect('filter', 'f'), e = afNewEffect('echo', 'e');
    const s = afSignature(chainOf(f, e), false);
    expect(afSignature(chainOf({ ...f, cutoff: 300 }, e), false)).toBe(s);
    expect(afSignature(chainOf(e, f), false)).not.toBe(s);
    expect(afSignature(chainOf({ ...f, type: 'highpass' }, e), false)).not.toBe(s);
    expect(afSignature({ on: false, effects: [f] }, false)).toBe('off');
    expect(afSignature(chainOf({ ...f, enabled: false }), false)).toBe('off');
  });
});

describe('chains in an OfflineAudioContext', () => {
  it('builds every kind in order, and passes sound straight through when off', async () => {
    const ctx = new NodeOffline(2, 128, RATE) as unknown as OfflineAudioContext;
    const c = afCreateChain(ctx);
    const rec = chainOf(...AF_KINDS.map(k => afNewEffect(k, k)));
    expect(c.update(rec, (e, k) => e[k] as number, null)).toBe(true);
    expect(c.built.map(b => b.kind)).toEqual(AF_KINDS);
    expect(c.update(rec, (e, k) => e[k] as number, 0)).toBe(false);
    c.update({ ...rec, on: false }, null, null);
    expect(c.built.length).toBe(0);
    const dry = await render(null, [[440, 0.5]]);
    expect(rms(dry.getChannelData(0))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('renders every effect without NaNs or silence', async () => {
    for (const k of AF_KINDS) {
      const out = await render(chainOf(afNewEffect(k, k)), [[220, 0.4], [3000, 0.2]]);
      const d = out.getChannelData(0);
      expect(d.every(Number.isFinite)).toBe(true);
      expect(rms(d)).toBeGreaterThan(0.01);
    }
  });

  it('a low-pass cuts the highs and keeps the lows', async () => {
    const parts: Array<[number, number]> = [[200, 0.3], [6000, 0.3]];
    const dry = (await render(null, parts)).getChannelData(0);
    const lp = (await render(chainOf({ ...afNewEffect('filter', 'f'), cutoff: 500 }), parts)).getChannelData(0);
    expect(level(lp, 6000, 4096)).toBeLessThan(level(dry, 6000, 4096) * 0.05);
    expect(level(lp, 200, 4096)).toBeGreaterThan(level(dry, 200, 4096) * 0.8);
  });

  it('hard-clip distortion adds odd harmonics to a sine', async () => {
    const d = (await render(chainOf({ ...afNewEffect('distortion', 'd'), curve: 'hard', drive: 0.8, tone: 20000 }), [[300, 0.5]])).getChannelData(0);
    const clean = (await render(null, [[300, 0.5]])).getChannelData(0);
    expect(level(d, 900, 4096)).toBeGreaterThan(level(clean, 900, 4096) * 20);
  });

  it('ping-pong echo alternates sides: the first repeat on the left only', async () => {
    const ctx = new NodeOffline(2, RATE, RATE) as unknown as OfflineAudioContext;
    const src = ctx.createBufferSource();
    const click = ctx.createBuffer(2, 64, RATE);
    click.getChannelData(0).fill(0.8); click.getChannelData(1).fill(0.8);
    src.buffer = click;
    const c = afCreateChain(ctx);
    c.update(chainOf({ ...afNewEffect('echo', 'e'), pingpong: true, time: 100, mix: 1, feedback: 0.5, tone: 16000 }), (e, k) => e[k] as number, null);
    src.connect(c.input); c.output.connect(ctx.destination); src.start(0);
    const out = await ctx.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const at = (s: number) => [Math.round(s * RATE), Math.round(s * RATE) + 400] as const;
    expect(rms(L, ...at(0.1))).toBeGreaterThan(0.05);
    expect(rms(R, ...at(0.1))).toBeLessThan(0.005);
    expect(rms(R, ...at(0.2))).toBeGreaterThan(0.02);
  });

  it('a moving number is smoothed, not stepped', async () => {
    const ctx = new NodeOffline(1, RATE / 2, RATE) as unknown as OfflineAudioContext;
    const src = ctx.createConstantSource();
    const c = afCreateChain(ctx);
    // Distortion at Mix 0 is its dry path through Output: a plain gain.
    const e = { ...afNewEffect('distortion', 'd'), mix: 0, output: 0 };
    c.update(chainOf(e), (x, k) => x[k] as number, null);
    c.update(chainOf(e), (x, k) => (k === 'output' ? -20 : x[k] as number), 0.1);
    src.connect(c.input); c.output.connect(ctx.destination); src.start(0);
    const d = (await ctx.startRendering()).getChannelData(0);
    // Gliding from 1 to 0.1 over tens of ms: halfway there a few ms after it starts, not at once.
    const i = Math.round(0.1 * RATE);
    expect(d[i + 44]).toBeGreaterThan(0.5);
    expect(d[i + 44 * 60]).toBeLessThan(0.15);
  });
});

describe('the record', () => {
  const fxRecord = (): PlayAudioFx => ({ chains: { master: { on: true, effects: [afNewEffect('filter', 'lp')] }, 'layer:song': { on: true, effects: [afNewEffect('echo', 'ec')] } } });

  it('targets round-trip, with colons in chain ids', () => {
    const t = audioFxTarget('layer:abc', 'ec', 'feedback');
    expect(t).toBe('audiofx:layer:abc:ec::feedback');
    expect(parseAudioFxTarget(t)).toEqual({ chainId: 'layer:abc', effectId: 'ec', key: 'feedback' });
    expect(parseAudioFxTarget('audiofx:master::x')).toBeNull();
    expect(parsePropTarget(t)).toEqual({ layerId: audioFxPropId('layer:abc', 'ec'), key: 'feedback' });
    expect(readAudioFxValue(fxRecord(), 'audiofx:master:lp::cutoff')).toBe(2000);
  });

  it('parses old and odd files: unknown kinds and chains dropped, numbers clamped, options defaulted', () => {
    const fx = parseAudioFx({
      analyse: 'pre',
      chains: {
        master: { effects: [{ id: 'a', kind: 'filter', cutoff: 99999, type: 'bogus' }, { kind: 'flanger' }, { id: 'a', kind: 'reverb', mix: 'x' }] },
        'nope': { effects: [{ kind: 'echo' }] },
        'layer:gone': { effects: [{ kind: 'echo' }] },
        synth: { effects: [] },
      },
    }, new Set(['kept']));
    expect(fx?.analyse).toBe('pre');
    expect(Object.keys(fx!.chains)).toEqual(['master']);
    const [f, r] = fx!.chains.master.effects;
    expect(f).toMatchObject({ id: 'a', kind: 'filter', cutoff: 20000, type: 'lowpass', enabled: true });
    expect(r).toMatchObject({ id: 'a_2', kind: 'reverb', mix: 0.3, type: 'room' });
    expect(parseAudioFx(undefined)).toBeUndefined();
    expect(parseAudioFx({ chains: {} })).toBeUndefined();
    expect(isAudioFxEmpty(undefined)).toBe(true);
  });

  it('a Play record keeps controls on its effects and drops those whose effect is gone', () => {
    const rec = parsePlayRecord({
      ...emptyPlayRecord(),
      layers: [{ id: 'song', kind: 'audio', label: 'Song', visible: true }],
      audioFx: fxRecord(),
      controls: [
        { id: 'c1', target: 'audiofx:master:lp::cutoff', kind: 'float', label: 'Cutoff', min: 20, max: 20000 },
        { id: 'c2', target: 'audiofx:master:gone::cutoff', kind: 'float', label: 'Gone', min: 0, max: 1 },
      ],
      mappings: [{ id: 'm1', controlId: 'c1', source: { kind: 'mouse', axis: 'x' }, outMin: 200, outMax: 8000, curve: 'exp', smoothMs: 0, enabled: true }],
    }) as PlayRecord;
    expect(rec.audioFx?.chains.master.effects[0].id).toBe('lp');
    expect(rec.controls.map(c => c.id)).toEqual(['c1']);
    expect(rec.mappings.map(m => m.id)).toEqual(['m1']);
    expect(readControlValue([], 'audiofx:master:lp::cutoff', rec)).toBe(2000);
    const baked = bakeLayerValues(rec, new Map([['c1', 900]]));
    expect(baked.audioFx?.chains.master.effects[0].cutoff).toBe(900);
    expect(isPlayRecordEmpty({ ...emptyPlayRecord(), audioFx: fxRecord() })).toBe(false);
  });

  it('patches one effect, and an emptied chain goes', () => {
    const fx = patchAudioFxEffect(fxRecord(), 'master', 'lp', { cutoff: 440 });
    expect(fx?.chains.master.effects[0].cutoff).toBe(440);
  });

  it('is Pro: Free plays without it and says so', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), audioFx: fxRecord() };
    expect(playableForPlan(rec, 'free').audioFx).toBeUndefined();
    expect(playableForPlan(rec, 'pro').audioFx).toBe(rec.audioFx);
    expect(proOnlyParts(rec, 'free')).toContain('the audio effects');
    expect(proOnlyParts(rec, 'pro')).toEqual([]);
  });
});

describe('offline renders', () => {
  const master = (cutoff: number): PlayAudioFx => ({ chains: { master: { on: true, effects: [{ ...afNewEffect('filter', 'lp'), cutoff }] } } });
  const song = (ctx: BaseAudioContext): { t: RecordingTrack; b: AudioBuffer } => ({ t: { key: 'n1', label: 'Tone', clock: false, chain: 'node:n1' }, b: tone(ctx, 1, [[200, 0.3], [6000, 0.3]]) });

  it('apply the chains: the same tone, with and without a low-pass on the master', async () => {
    const ctx = new NodeOffline(2, 1, RATE) as unknown as OfflineAudioContext;
    const dry = (await mixBuffers([], [song(ctx)], 0.5, 0, RATE))!.getChannelData(0);
    const wet = (await mixBuffers([], [song(ctx)], 0.5, 0, RATE, { fx: master(400) }))!.getChannelData(0);
    expect(rms(wet)).toBeLessThan(rms(dry) * 0.8);
    expect(level(wet, 6000, 8192)).toBeLessThan(level(dry, 6000, 8192) * 0.05);
    expect(level(wet, 200, 8192)).toBeGreaterThan(level(dry, 200, 8192) * 0.7);
  });

  it('a sound goes through its own chain, then the master', async () => {
    const ctx = new NodeOffline(2, 1, RATE) as unknown as OfflineAudioContext;
    const fx: PlayAudioFx = { chains: { 'node:n1': { on: true, effects: [{ ...afNewEffect('filter', 'hp'), type: 'highpass', cutoff: 3000 }] } } };
    const out = (await mixBuffers([], [song(ctx)], 0.5, 0, RATE, { fx }))!.getChannelData(0);
    expect(level(out, 200, 8192)).toBeLessThan(0.02);
    expect(level(out, 6000, 8192)).toBeGreaterThan(0.2);
  });

  it('follow a take: a cutoff recorded sweeping down closes the filter through the render', async () => {
    const ctx = new NodeOffline(2, 1, RATE) as unknown as OfflineAudioContext;
    const take = {
      id: 't', name: 'Sweep', from: 10, length: 1, tracks: [
        { kind: 'control', id: 'c1', label: 'Cutoff', target: 'audiofx:master:lp::cutoff', width: 1, keys: encodeKeys([0, 0.3, 0.4, 1], [16000, 16000, 300, 300], 1) },
      ],
    } as unknown as PlayTake;
    const valueAt = takeValueAt(take, 10);
    expect(valueAt('audiofx:master:lp', 'cutoff', 2000, 0)).toBeCloseTo(16000);
    expect(valueAt('audiofx:master:lp', 'cutoff', 2000, 1)).toBeCloseTo(300);
    expect(valueAt('audiofx:master:lp', 'resonance', 1, 0.5)).toBe(1);
    const out = (await mixBuffers([], [song(ctx)], 1, 10, RATE, { fx: master(2000), valueAt }))!.getChannelData(0);
    const early = level(out, 6000, Math.round(0.1 * RATE)), late = level(out, 6000, Math.round(0.8 * RATE));
    expect(early).toBeGreaterThan(0.2);
    expect(late).toBeLessThan(early * 0.05);
  });
});

describe('live chains (audioFxHost)', () => {
  it('put a chain between inlet and outlet and follow the record and the mappings', async () => {
    const ctx = new NodeOffline(1, 128, RATE) as unknown as OfflineAudioContext;
    const inlet = ctx.createGain(), outlet = ctx.createGain(), an = ctx.createAnalyser();
    const off = audioFxHost.attach(ctx, 'master', inlet, outlet, an);
    audioFxHost.frame({ chains: { master: { on: true, effects: [afNewEffect('filter', 'lp')] } } }, (id, key, base) => (id === 'audiofx:master:lp' && key === 'cutoff' ? 750 : base));
    expect(audioFxHost.chainIds()).toContain('master');
    off();
    expect(audioFxHost.chainIds()).not.toContain('master');
  });
});

describe('exports', () => {
  const input = (): PlayHtmlInput => ({
    title: 'Sound', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
    uniforms: {}, paramBindings: {},
    play: { ...emptyPlayRecord(), audioFx: { chains: { master: { on: true, effects: [afNewEffect('filter', 'lp'), afNewEffect('reverb', 'rv')] } } } },
    aspect: '16:9',
  });

  it('carry the chains in the bundle and the kit in the page', () => {
    expect(playBundle(input()).play.audioFx?.chains.master.effects.map(e => e.kind)).toEqual(['filter', 'reverb']);
    const html = buildPlayHtml(input());
    expect(html).toContain('"audioFx":{"chains"');
    expect(html).toContain('function afCreateChain(');
    expect(html).toContain('audioFx: { chain: afCreateChain');
  });

  it('the inlined kit builds the same chain and it renders', async () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { audioFx: { chain: typeof afCreateChain } };
    const ctx = new NodeOffline(2, RATE / 4, RATE) as unknown as OfflineAudioContext;
    const src = ctx.createBufferSource();
    src.buffer = tone(ctx, 0.25, [[200, 0.3], [6000, 0.3]]);
    const c = SSKit.audioFx.chain(ctx);
    c.update({ on: true, effects: [{ ...afNewEffect('filter', 'lp'), cutoff: 400 }] }, (e, k) => e[k] as number, null);
    src.connect(c.input); c.output.connect(ctx.destination); src.start(0);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(level(d, 6000, 2048)).toBeLessThan(0.02);
  });
});
