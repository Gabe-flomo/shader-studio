/**
 * Drum pads (docs/drum-pads.md): the pad math (pitch → rate, start/end and
 * reverse, the envelope, velocity), the sampler rendered through real Web
 * Audio in Node (node-web-audio-api) into buffers only — hit timing, pitch,
 * reverse, gate release, choke groups — triggering from MIDI notes, keys, the
 * pad grid and actions, an offline mix placing a take's hit on its exact
 * sample, and the record (parse, old files, actions, take events, web export).
 * Nothing here reaches a speaker.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const winListeners = vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  const map = new Map<string, Array<(e: unknown) => void>>();
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = (type: string, fn: (e: unknown) => void) => { map.set(type, [...(map.get(type) ?? []), fn]); };
  g.removeEventListener = (type: string, fn: (e: unknown) => void) => { map.set(type, (map.get(type) ?? []).filter(f => f !== fn)); };
  return map;
});

import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import {
  DP_KEYS, DP_PADS, DP_PARAMS, dpCreateSampler, dpEnvAt, dpEnvPoints, dpKey, dpKeyParts, dpPadOfCell, dpPadOfKey, dpPadOfNote, dpRate, dpRegion, dpSynthData, dpVelGain,
} from '../kit/drumPads.js';
import { actionsForLayer, defaultLayer, parseActionTarget, parseLayer, parsePlayRecord, type PlayRecord } from '../../types/play';
import { layerNumericProps, padsLayerOfInput, padsReaderInput, type DrumPadLayer } from '../../types/playLayers';
import { mixBuffers, padHitsOf, padTrackOf, type PadTrack } from '../../lib/recordingAudio';
import { takeValueAt } from '../../lib/audioFxOffline';
import { encodeKeys } from '../../lib/takePlayback';
import { playDrumPads, type PadAction } from '../drumPads';
import { midiEngine } from '../../lib/midiEngine';
import { playEngine } from '../../lib/playEngine';
import { padGrid } from '../../lib/padGrid';
import { DEFAULT_PAD_GRID } from '../../types/playMidi';
import { readerInputOptions } from '../../components/play/readersPanelUi';
import { leftBehind, mediaCarried, playBundle, kitScript, type PlayHtmlInput } from '../exportHtml';
import { BUILTIN_LAYERS } from '../../components/play/layers/addLayerCatalog';

const RATE = 44100;
beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = NodeOffline;
});

const offline = (secs: number) => new NodeOffline(2, Math.ceil(secs * RATE), RATE) as unknown as OfflineAudioContext;
/** A buffer of `secs` filled by f(i). */
function buf(ctx: BaseAudioContext, secs: number, f: (i: number) => number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(secs * RATE), RATE);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = f(i);
  return b;
}
const firstLoud = (d: Float32Array, over = 1e-3) => d.findIndex(v => Math.abs(v) > over);
const lastLoud = (d: Float32Array, over = 1e-3) => { for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > over) return i; return -1; };
function rms(d: Float32Array, from: number, to: number): number { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)); }
const flat = { attack: 0, decay: 0, sustain: 1, release: 0.05, volume: 1, pan: 0, vel: 0 };
const drums = (over: Record<string, unknown> = {}): DrumPadLayer => ({ ...(defaultLayer('drumpad', 'drums', 'Drums') as DrumPadLayer), ...over });

describe('pad math', () => {
  it('pitch is semitones of playback rate', () => {
    expect(dpRate(0)).toBe(1);
    expect(dpRate(12)).toBeCloseTo(2);
    expect(dpRate(-12)).toBeCloseTo(0.5);
    expect(dpRate(7)).toBeCloseTo(1.4983, 3);
  });
  it('start and end pick the region, either way round, reversed from the end', () => {
    expect(dpRegion(2, 0.25, 0.75, false)).toEqual({ offset: 0.5, length: 1 });
    expect(dpRegion(2, 0.75, 0.25, false)).toEqual({ offset: 0.5, length: 1 });
    // Reversed: the same stretch of sound, read backwards from its end.
    expect(dpRegion(2, 0, 0.25, true)).toEqual({ offset: 1.5, length: 0.5 });
    // Never shorter than a millisecond.
    expect(dpRegion(1, 0.5, 0.5, false).length).toBeCloseTo(0.001);
  });
  it('the envelope: linear attack, decay to sustain, a 3 ms fade at a one-shot’s end', () => {
    expect(dpEnvAt(0, 0.1, 0.2, 0.5)).toBe(0);
    expect(dpEnvAt(0.05, 0.1, 0.2, 0.5)).toBeCloseTo(0.5);
    expect(dpEnvAt(0.1, 0.1, 0.2, 0.5)).toBeCloseTo(1);
    expect(dpEnvAt(0.2, 0.1, 0.2, 0.5)).toBeCloseTo(0.75);
    expect(dpEnvAt(5, 0.1, 0.2, 0.5)).toBeCloseTo(0.5);
    const pts = dpEnvPoints(0.1, 0.2, 0.5, 0.15);
    expect(pts[pts.length - 1]).toEqual([0.15, 0]);
    expect(pts.every(([t]) => t <= 0.15)).toBe(true);
  });
  it('velocity sets the volume as much as the pad says', () => {
    expect(dpVelGain(0.5, 0)).toBe(1);
    expect(dpVelGain(0.5, 1)).toBe(0.5);
    expect(dpVelGain(0.5, 0.5)).toBe(0.75);
  });
  it('keys, notes and grid cells map to pads; pad numbers are layer properties', () => {
    expect(dpPadOfKey('KeyZ')).toBe(0);
    expect(dpPadOfKey('Digit4')).toBe(15);
    expect(dpPadOfKey('KeyP')).toBe(-1);
    expect(DP_KEYS).toHaveLength(DP_PADS);
    expect(dpPadOfNote(36, 36)).toBe(0);
    expect(dpPadOfNote(51, 36)).toBe(15);
    expect(dpPadOfNote(52, 36)).toBe(-1);
    expect(dpPadOfCell(1, 2)).toBe(9);
    expect(dpPadOfCell(4, 0)).toBe(-1);
    expect(dpKey(2, 'pitch')).toBe('pad3_pitch');
    expect(dpKeyParts('pad16_release')).toEqual({ pad: 15, key: 'release' });
    expect(dpKeyParts('pad17_pitch')).toBeNull();
  });
  it('generated drums are short, loud enough and the same every time', () => {
    const a = dpSynthData('kick', RATE), b = dpSynthData('kick', RATE);
    expect(a.length).toBe(Math.round(0.5 * RATE));
    expect(Math.max(...a.map(Math.abs))).toBeCloseTo(0.9, 1);
    expect(a).toEqual(b);
    expect(dpSynthData('hat', RATE).length).toBeLessThan(dpSynthData('openhat', RATE).length);
  });
});

describe('the sampler, rendered', () => {
  it('a hit starts on its sample', async () => {
    const ctx = offline(1);
    const s = dpCreateSampler(ctx);
    s.output.connect(ctx.destination);
    s.hit(0, { ...flat, buffer: buf(ctx, 0.2, () => 0.5) }, 0.25);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(Math.abs(firstLoud(d) - 0.25 * RATE)).toBeLessThanOrEqual(2);
  });
  it('pitch +12 plays it in half the time; start/end play only the region', async () => {
    const ctx = offline(1);
    const s = dpCreateSampler(ctx);
    s.output.connect(ctx.destination);
    s.hit(0, { ...flat, buffer: buf(ctx, 0.4, () => 0.5), pitch: 12 }, 0);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(lastLoud(d) / RATE).toBeCloseTo(0.2, 1);
    const ctx2 = offline(1);
    const s2 = dpCreateSampler(ctx2);
    s2.output.connect(ctx2.destination);
    s2.hit(0, { ...flat, buffer: buf(ctx2, 0.4, () => 0.5), start: 0.5, end: 1 }, 0);
    const d2 = (await ctx2.startRendering()).getChannelData(0);
    expect(lastLoud(d2) / RATE).toBeCloseTo(0.2, 1);
  });
  it('reverse plays from the end back', async () => {
    const ctx = offline(0.5);
    const s = dpCreateSampler(ctx);
    s.output.connect(ctx.destination);
    // A ramp 0 → 1: backwards it starts loud.
    const n = Math.ceil(0.2 * RATE);
    s.hit(0, { ...flat, attack: 0.0005, buffer: buf(ctx, 0.2, i => i / n), reverse: true }, 0);
    const d = (await ctx.startRendering()).getChannelData(0);
    const at = (t: number) => d[Math.round(t * RATE)];
    expect(at(0.01)).toBeGreaterThan(0.85);
    expect(at(0.15)).toBeLessThan(0.3);
  });
  it('a gate pad fades over its release once let go; a one-shot plays on', async () => {
    const render = async (mode: 'gate' | 'oneshot') => {
      const ctx = offline(1);
      const s = dpCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(0, { ...flat, buffer: buf(ctx, 0.9, () => 0.5), mode, release: 0.05 }, 0);
      s.release(0, 0.3);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const gate = await render('gate'), shot = await render('oneshot');
    expect(lastLoud(gate) / RATE).toBeGreaterThan(0.3);
    expect(lastLoud(gate) / RATE).toBeLessThan(0.36);
    expect(lastLoud(shot) / RATE).toBeGreaterThan(0.85);
  });
  it('a gate pad with Loop goes round until let go', async () => {
    const ctx = offline(1);
    const s = dpCreateSampler(ctx);
    s.output.connect(ctx.destination);
    s.hit(0, { ...flat, buffer: buf(ctx, 0.1, () => 0.5), mode: 'gate', loop: true, release: 0.01 }, 0);
    s.release(0, 0.6);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(rms(d, Math.round(0.4 * RATE), Math.round(0.5 * RATE))).toBeGreaterThan(0.3);
    expect(lastLoud(d) / RATE).toBeLessThan(0.62);
  });
  it('a choke group cuts the pad sounding in it', async () => {
    const render = async (choke: number) => {
      const ctx = offline(1);
      const s = dpCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(3, { ...flat, buffer: buf(ctx, 0.9, i => 0.5 * Math.sin(i / 7)), choke }, 0);
      s.hit(2, { ...flat, buffer: buf(ctx, 0.05, () => 0), choke }, 0.2);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const choked = await render(1), open = await render(0);
    expect(rms(choked, Math.round(0.25 * RATE), Math.round(0.5 * RATE))).toBeLessThan(1e-3);
    expect(rms(open, Math.round(0.25 * RATE), Math.round(0.5 * RATE))).toBeGreaterThan(0.2);
  });
  it('velocity and volume scale the hit', async () => {
    const ctx = offline(0.3);
    const s = dpCreateSampler(ctx);
    s.output.connect(ctx.destination);
    s.hit(0, { ...flat, buffer: buf(ctx, 0.2, () => 0.5), volume: 0.8, vel: 1, velocity: 0.5 }, 0);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(d[Math.round(0.1 * RATE)]).toBeCloseTo(0.5 * 0.8 * 0.5, 2);
  });
});

describe('an offline mix of a take', () => {
  const take = {
    from: 10, length: 2, tracks: [{ kind: 'control' as const, id: 'p', target: 'layer:drums::pad1_pitch', label: 'Pitch', width: 1 as const, keys: encodeKeys([0, 1], [12, 12], 1) }],
    events: [{ t: 0.5, do: 'pad' as const, layerId: 'drums', amount: 1, vel: 1 }, { t: 0.7, do: 'burst' as const, layerId: 'x', amount: 5 }],
  };
  it('hits become mix times from the render’s start', () => {
    expect(padHitsOf(take, 10)).toEqual([{ layerId: 'drums', pad: 0, vel: 1, t: 0.5 }]);
    expect(padHitsOf(take, 10.25)[0].t).toBeCloseTo(0.25);
    expect(padHitsOf(take, 11)).toEqual([]);
    expect(padHitsOf(null, 0)).toEqual([]);
  });
  it('a layer number follows the take (a drum pad’s pitch)', () => {
    const at = takeValueAt(take as never, 10);
    expect(at('drums', 'pad1_pitch', 0, 0.5)).toBe(12);
    expect(at('drums', 'pad2_pitch', 3, 0.5)).toBe(3);
  });
  it('the hit lands on its exact sample, through the layer’s chain', async () => {
    const ctx = offline(0.1);
    const l = drums({ volume: 1 });
    const click = buf(ctx, 0.05, () => 0.5);
    const track = padTrackOf(l, () => null);
    expect(track).toBeNull(); // no pad has a sample open
    const withKick = drums({ volume: 1, pads: l.pads.map((p, i) => (i === 0 ? { ...p, synth: 'kick' } : p)), pad1_attack: 0, pad1_vel: 0 });
    const t2 = padTrackOf(withKick, p => (p === withKick.pads[0] ? click : null))!;
    expect(t2.pads).toBeTruthy();
    const out = (await mixBuffers([t2], [], 1, 10, RATE, { fx: undefined, padHits: padHitsOf(take, 10.2) }))!.getChannelData(0);
    expect(Math.abs(firstLoud(out) - Math.round(0.3 * RATE))).toBeLessThanOrEqual(1);
    // Without hits it is silent: pads never play by themselves.
    const quiet = (await mixBuffers([t2], [], 1, 10, RATE, { fx: undefined }))!.getChannelData(0);
    expect(firstLoud(quiet)).toBe(-1);
  });
  it('the take’s pitch reaches the hit', async () => {
    const withKick = drums({ volume: 1, pads: drums().pads.map((p, i) => (i === 0 ? { ...p, synth: 'kick' } : p)), pad1_attack: 0, pad1_vel: 0 });
    const ctx = offline(0.1);
    const long = buf(ctx, 0.4, () => 0.5);
    const tr = padTrackOf(withKick, p => (p === withKick.pads[0] ? long : null))!;
    const out = (await mixBuffers([tr], [], 1, 10, RATE, { fx: undefined, padHits: padHitsOf(take, 10), valueAt: takeValueAt(take as never, 10) }))!.getChannelData(0);
    // Up an octave: 0.4 s of sound in 0.2 s, from 0.5 s.
    expect(lastLoud(out) / RATE).toBeCloseTo(0.7, 1);
    expect((tr.pads as PadTrack).layerId).toBe('drums');
  });
});

describe('triggering', () => {
  const got: PadAction[] = [];
  beforeAll(() => {
    playDrumPads.setActor(a => got.push(a));
    playDrumPads.setRecord({ layers: [drums({ baseNote: 36, channel: 0 })] });
  });
  const take = () => got.splice(0);

  it('MIDI notes from the base note play pads 1–16, with their velocity', () => {
    take();
    midiEngine.handleMessage({ kind: 'noteOn', channel: 1, note: 38, velocity: 127 });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 1, note: 60, velocity: 127 });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 2, note: 36, velocity: 64 });
    const hits = take();
    expect(hits.map(h => [h.amount, Math.round((h.vel ?? 0) * 100) / 100])).toEqual([[3, 1], [1, 0.5]]);
    expect(hits[0].do).toBe('pad');
  });
  it('a channel and a base note of its own', () => {
    playDrumPads.setRecord({ layers: [drums({ baseNote: 48, channel: 10 })] });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 1, note: 48, velocity: 100 });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 10, note: 49, velocity: 100 });
    expect(take().map(h => h.amount)).toEqual([2]);
    playDrumPads.setRecord({ layers: [drums()] });
  });
  it('keys play pads on the Play page (not while typing)', () => {
    playEngine.setPerforming(true);
    const key = (code: string, target: unknown = null) => { for (const fn of winListeners.get('keydown') ?? []) fn({ code, target, repeat: false }); for (const fn of winListeners.get('keyup') ?? []) fn({ code, target }); };
    take();
    key('KeyX');
    key('Digit1');
    key('KeyX', { tagName: 'INPUT' });
    key('KeyP');
    expect(take().map(h => h.amount)).toEqual([2, 13]);
    playEngine.setPerforming(false);
    key('KeyX');
    expect(take()).toEqual([]);
  });
  it('the on-screen pad grid’s lower-left 4 × 4 plays them', () => {
    padGrid.setConfig({ ...DEFAULT_PAD_GRID });
    take();
    padGrid.press(1, 1, 0.9);
    padGrid.press(5, 0, 0.9);
    expect(take().map(h => h.amount)).toEqual([6]);
    padGrid.setConfig(undefined);
  });
  it('hidden kits and layers without MIDI stay quiet', () => {
    playDrumPads.setRecord({ layers: [drums({ visible: false })] });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 1, note: 36, velocity: 100 });
    playDrumPads.setRecord({ layers: [drums({ midi: false })] });
    midiEngine.handleMessage({ kind: 'noteOn', channel: 1, note: 36, velocity: 100 });
    expect(take()).toEqual([]);
    playDrumPads.setRecord({ layers: [drums()] });
  });
  it('a gate pad is let go; a one-shot has nothing to let go', () => {
    const l = drums();
    playDrumPads.setRecord({ layers: [{ ...l, pads: l.pads.map((p, i) => (i === 1 ? { ...p, mode: 'gate' as const } : p)) }] });
    take();
    playDrumPads.letGo('drums', 0);
    playDrumPads.letGo('drums', 1);
    expect(take().map(h => [h.amount, h.vel])).toEqual([[2, 0]]);
    playDrumPads.setRecord({ layers: [drums()] });
  });
  it('an action plays pad N', () => {
    expect(actionsForLayer(drums())).toEqual(['pad']);
    expect(parseActionTarget('act:drums::pad')).toEqual({ layerId: 'drums', do: 'pad' });
  });
});

describe('the record', () => {
  it('a new layer: 16 empty pads, keys, MIDI and grid on, every pad number at its default', () => {
    const l = drums();
    expect(l.pads).toHaveLength(16);
    expect(l.pads.every(p => !p.sampleId && !p.synth && p.mode === 'oneshot')).toBe(true);
    expect(l).toMatchObject({ keys: true, midi: true, grid: true, baseNote: 36, channel: 0 });
    for (const p of DP_PARAMS) expect(l[dpKey(15, p.key) as `pad${number}_${string}`]).toBe(p.value);
    // Pads are copies: one layer's pads aren't another's.
    const other = drums();
    other.pads[0].synth = 'kick';
    expect(drums().pads[0].synth).toBe('');
  });
  it('a file keeps what is valid and falls back for the rest (old files: no pads at all)', () => {
    const l = parseLayer({ id: 'd', kind: 'drumpad', label: 'Kit', pads: [{ sampleId: 'snd_1', fileName: 'kick.wav', bytes: 99, mode: 'gate', loop: true, choke: 42, synth: 'banjo' }, null, 'x'], pad1_pitch: 99, pad2_volume: 0.3, volume: 'loud' }) as DrumPadLayer;
    expect(l.pads).toHaveLength(16);
    expect(l.pads[0]).toMatchObject({ sampleId: 'snd_1', fileName: 'kick.wav', bytes: 99, mode: 'gate', loop: true, choke: 8, synth: '' });
    expect(l.pad1_pitch).toBe(24);
    expect(l.pad2_volume).toBe(0.3);
    expect(l.pad3_decay).toBe(0.2);
    expect(l.volume).toBe(0.9);
    const bare = parseLayer({ id: 'd', kind: 'drumpad', label: 'Kit' }) as DrumPadLayer;
    expect(bare.pads).toHaveLength(16);
    expect(bare.pad16_end).toBe(1);
  });
  it('Play pad actions and pad hits in takes survive a save', () => {
    const rec = parsePlayRecord({
      version: 1, controls: [], mappings: [], layers: [drums()],
      actions: [{ id: 'a', trigger: { on: 'key', code: 'Space' }, do: 'pad', layerId: 'drums', amount: 3, enabled: true }],
      takes: [{ id: 't', name: 'T', from: 0, length: 2, tracks: [], events: [{ t: 0.5, do: 'pad', layerId: 'drums', amount: 2, vel: 0.4 }, { t: 0.6, do: 'pad', layerId: 'drums', amount: 2, vel: 7 }] }],
    }) as PlayRecord;
    expect(rec.actions?.[0]).toMatchObject({ do: 'pad', amount: 3 });
    expect(rec.takes?.[0].events).toEqual([{ t: 0.5, do: 'pad', layerId: 'drums', amount: 2, vel: 0.4 }, { t: 0.6, do: 'pad', layerId: 'drums', amount: 2, vel: 1 }]);
  });
  it('pads with a sound are mapping targets (`pad<N>_<key>`)', () => {
    const l = drums();
    expect(layerNumericProps(l).map(p => p.key)).toEqual(['volume']);
    const k = { ...l, pads: l.pads.map((p, i) => (i === 2 ? { ...p, synth: 'hat' as const } : p)) };
    const keys = layerNumericProps(k).map(p => p.key);
    expect(keys).toContain('pad3_pitch');
    expect(keys).toContain('pad3_start');
    expect(keys).not.toContain('pad1_pitch');
  });
  it('the readers can listen to it', () => {
    expect(padsReaderInput('drums')).toBe('pads:drums');
    expect(padsLayerOfInput('pads:drums')).toBe('drums');
    expect(padsLayerOfInput('video:x')).toBeNull();
    const opts = readerInputOptions('pads:gone', [], [drums()]);
    expect(opts.map(o => o.label)).toContain('Drum pads · Drums');
    expect(opts.map(o => o.label)).toContain('Drum pads · a layer no longer in the setup');
  });
  it('Add layer offers it', () => {
    expect(BUILTIN_LAYERS.some(b => b.kind === 'drumpad')).toBe(true);
  });
});

describe('web export', () => {
  const l = drums();
  const kit: DrumPadLayer = { ...l, pads: l.pads.map((p, i) => (i === 0 ? { ...p, synth: 'kick' } : i === 1 ? { ...p, sampleId: 'snd_1', fileName: 'snare.wav', bytes: 2000 } : i === 2 ? { ...p, sampleId: 'snd_2', fileName: 'huge.wav', bytes: 9e6 } : p)) };
  const input = (): PlayHtmlInput => ({
    title: 'T', fragmentShader: '', uniforms: {}, paramBindings: {}, aspect: '16:9' as never,
    play: { version: 1, controls: [], mappings: [], layers: [kit] },
    media: { layerPads: { drums: { 1: { label: 'Drums · pad 2', name: 'snare.wav', src: 'data:audio/wav;base64,AAAA', bytes: 28 }, 2: { label: 'Drums · pad 3', name: 'huge.wav', src: null, bytes: 9e6 } } } },
  });
  it('carries each sample in its pad, and says which stayed out', () => {
    const b = playBundle(input());
    const pads = (b.play.layers[0] as DrumPadLayer).pads as Array<{ src?: string }>;
    expect(pads[1].src).toBe('data:audio/wav;base64,AAAA');
    expect(pads[0].src).toBe('');
    const left = leftBehind(input().play, input().media);
    expect(left.some(x => x.what.includes('huge.wav'))).toBe(true);
    expect(left.some(x => x.what.includes('snare.wav'))).toBe(false);
    expect(mediaCarried(input().media, undefined, input().play).some(x => x.what.includes('snare.wav'))).toBe(true);
  });
  it('the page’s kit plays pads the same way', async () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { drumPads: { sampler: typeof dpCreateSampler; padOfNote: typeof dpPadOfNote } };
    expect(SSKit.drumPads.padOfNote(40, 36)).toBe(4);
    const ctx = offline(0.5);
    const s = SSKit.drumPads.sampler(ctx);
    s.output.connect(ctx.destination);
    s.hit(0, { ...flat, buffer: buf(ctx, 0.1, () => 0.5) }, 0.1);
    const d = (await ctx.startRendering()).getChannelData(0);
    expect(Math.abs(firstLoud(d) - 0.1 * RATE)).toBeLessThanOrEqual(2);
  });
});
