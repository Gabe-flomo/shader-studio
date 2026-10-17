/**
 * Audio → audio (docs/audio-tools.md, "Audio → audio"): the Filter's biquad maths and how its settings reach Web Audio,
 * the Resonator bank's tuning and the energies a tone leaves in it, the Spectral worklet's frames (freeze, blur, gate)
 * on synthetic sound, what is heard (the hearing rule), chains through groups in the walk and the engine, live edits,
 * and the page's copy of all of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

/** A fake Web Audio context: every node records what it was connected to and what its params were set to. */
const fake = vi.hoisted(() => {
  type Node = { kind: string; to: Node[]; connect(n: Node): void; disconnect(n?: Node): void; context: unknown; [k: string]: unknown };
  const param = (v: number) => ({ value: v, setTargetAtTime(x: number) { this.value = x; }, setValueAtTime(x: number) { this.value = x; } });
  const frame = { freq: new Float32Array(1024).fill(-200), wave: new Float32Array(2048) };
  const made: Node[] = [];
  const ctx: Record<string, unknown> = { sampleRate: 48000, currentTime: 0, state: 'running' };
  const node = (kind: string, extra: Record<string, unknown> = {}): Node => {
    const n: Node = {
      kind, to: [], context: ctx, ...extra,
      connect(m: Node) { this.to.push(m); },
      disconnect(m?: Node) { this.to = m ? this.to.filter(x => x !== m) : []; },
    };
    made.push(n);
    return n;
  };
  const analyser = () => node('analyser', {
    fftSize: 2048, smoothingTimeConstant: 0,
    getFloatFrequencyData(a: Float32Array) { a.set(frame.freq.subarray(0, a.length)); },
    getFloatTimeDomainData(a: Float32Array) { a.set(frame.wave.subarray(frame.wave.length - a.length)); },
  });
  Object.assign(ctx, {
    createGain: () => node('gain', { gain: param(1) }),
    createAnalyser: analyser,
    createBiquadFilter: () => node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
    createMediaElementSource: () => node('media'),
  });
  const loaded = new Set<string>();
  const playing = new Set<string>();
  const analysers = new Map<string, Node>();
  const outside: Node[] = [];
  const audioEngine = {
    loadAudio: async (id: string) => { loaded.add(id); },
    isLoaded: (id: string) => loaded.has(id), duration: () => 4, isMasterPaused: () => false,
    startAudio: (id: string) => { playing.add(id); }, stopAudio: (id: string) => { playing.delete(id); }, removeAudio: (id: string) => { loaded.delete(id); playing.delete(id); },
    isPlaying: (id: string) => playing.has(id), position: () => 0, getFileName: () => 'loop.wav',
    getAnalyser: (id: string) => { if (!loaded.has(id)) return null; if (!analysers.has(id)) analysers.set(id, analyser()); return analysers.get(id)!; },
    buffer: () => null, context: () => ctx,
    connectOutside: (n: Node) => { outside.push(n); return () => { outside.splice(outside.indexOf(n), 1); }; },
  };
  return { ctx, frame, made, audioEngine, outside, analysers };
});
vi.mock('../../audioEngine', () => ({ audioEngine: fake.audioEngine, trackChainId: (id: string) => `node:${id}` }));

import { GROUP_PORT_SENTINEL, type GraphNode } from '../../../types/nodeGraph';
import { group, n } from '../../../store/graphBuilder';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { compileGraph } from '../../../compiler/graphCompiler';
import { audioFxHost } from '../../audioFx';
import { inputBus } from '../../inputBus';
import { audioHearing, collectAudioNodes } from '../graphWalk';
import { audioToolsEngine } from '../engine';
import { audioToolsForWeb } from '../webExport';
import { effectSpecOf } from '../../../nodes/definitions/audioTools';
import { buildPlayHtml, kitScript, type PlayHtmlInput } from '../../../play/exportHtml';
import { emptyPlayRecord } from '../../../types/play';
import {
  AC_SPECTRAL_CORE, acBankOf, acBiquadCoeffs, acBiquadMag, acBuild, acLoudest, acMidiHz, acNoteName, acResonatorEnergies, acResonatorHz,
  acResonatorNotes, acResonatorQ, type AcSpec,
} from '../../../play/kit/audioChain.js';

const db = (x: number) => 20 * Math.log10(x);
const SR = 48000;
const sine = (hz: number, seconds: number, amp = 0.5, sr = SR) => Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sr));
const rms = (x: ArrayLike<number>, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const spec = (o: Partial<AcSpec>): AcSpec => ({
  type: 'audioFilter', filterType: 'lowpass', frequency: 1000, q: 0.707, gain: 6, count: 8, root: 45, scale: 'minor', decay: 1, brightness: 0.5, mix: 1,
  mode: 'freeze', freeze: false, amount: 0.8, threshold: -50, ...o,
});

afterEach(() => { audioToolsEngine.sync([]); audioToolsEngine.setHost(null); });

describe('Filter: the biquad', () => {
  it('low-pass passes the bass, cuts the highs, and Q rings at the cutoff', () => {
    const c = acBiquadCoeffs('lowpass', 1000, 0.707, 0, SR);
    expect(db(acBiquadMag(c, 50, SR))).toBeCloseTo(0, 1);
    expect(db(acBiquadMag(c, 1000, SR))).toBeCloseTo(-3, 0);
    expect(db(acBiquadMag(c, 10000, SR))).toBeLessThan(-35);
    // Q 8: about +18 dB right at the cutoff.
    expect(db(acBiquadMag(acBiquadCoeffs('lowpass', 1000, 8, 0, SR), 1000, SR))).toBeCloseTo(18, 0);
  });
  it('high-pass mirrors it; band-pass is 1 at its centre; notch 0; peak adds Gain dB', () => {
    const hp = acBiquadCoeffs('highpass', 1000, 0.707, 0, SR);
    expect(db(acBiquadMag(hp, 50, SR))).toBeLessThan(-45);
    expect(db(acBiquadMag(hp, 15000, SR))).toBeCloseTo(0, 1);
    expect(acBiquadMag(acBiquadCoeffs('bandpass', 2000, 5, 0, SR), 2000, SR)).toBeCloseTo(1, 4);
    expect(acBiquadMag(acBiquadCoeffs('notch', 2000, 5, 0, SR), 2000, SR)).toBeLessThan(1e-6);
    expect(db(acBiquadMag(acBiquadCoeffs('peaking', 2000, 2, 9, SR), 2000, SR))).toBeCloseTo(9, 3);
    expect(db(acBiquadMag(acBiquadCoeffs('peaking', 2000, 2, 9, SR), 50, SR))).toBeCloseTo(0, 1);
  });
  it('reaches Web Audio as its spec says: a low-pass\'s Q in dB, the others plain; numbers move without a rebuild', () => {
    const fx = acBuild(fake.ctx as unknown as BaseAudioContext, spec({ filterType: 'lowpass', frequency: 600, q: 4 }));
    const bq = fake.made.filter(x => x.kind === 'biquad').pop() as unknown as { type: string; frequency: { value: number }; Q: { value: number } };
    expect(bq.type).toBe('lowpass');
    expect(bq.frequency.value).toBe(600);
    expect(bq.Q.value).toBeCloseTo(db(4), 6);
    const count = fake.made.length;
    fx.update(spec({ filterType: 'bandpass', frequency: 2500, q: 4 }));
    expect(fake.made.length).toBe(count);
    expect(bq.type).toBe('bandpass');
    expect(bq.frequency.value).toBe(2500);
    expect(bq.Q.value).toBe(4);
    fx.dispose();
  });
});

describe('Resonator bank: tuning', () => {
  it('notes follow the scale from the root, as Hz', () => {
    expect(acMidiHz(69)).toBe(440);
    expect(acMidiHz(57)).toBeCloseTo(220, 9);
    expect(acNoteName(45)).toBe('A2');
    expect(acNoteName(60)).toBe('C4');
    expect(acResonatorNotes(45, 'minor', 8)).toEqual([45, 47, 48, 50, 52, 53, 55, 57]);
    expect(acResonatorNotes(48, 'major', 8)).toEqual([48, 50, 52, 53, 55, 57, 59, 60]);
    expect(acResonatorNotes(48, 'pentatonic', 6)).toEqual([48, 50, 52, 55, 57, 60]);
    expect(acResonatorNotes(48, 'minorChord', 5)).toEqual([48, 51, 55, 60, 63]);
    expect(acResonatorNotes(36, 'fifths', 4)).toEqual([36, 43, 50, 57]);
    const h = acResonatorHz(45, 'harmonic', 5, SR);
    for (let k = 0; k < 5; k++) expect(h[k]).toBeCloseTo(110 * (k + 1), 6);
    // Too high for the sample rate: down by octaves.
    expect(acResonatorHz(127, 'minor', 1, 8000)[0]).toBeLessThan(3600);
  });
  it('Decay sets the Q (T60 = ln(1000)·Q / (π·f)); Count 4–12', () => {
    const q = acResonatorQ(440, 2);
    expect(Math.log(1000) * q / (Math.PI * 440)).toBeCloseTo(2, 6);
    expect(acBankOf({ root: 45, scale: 'minor', count: 12, decay: 1, brightness: 0.5 }, SR).hz).toHaveLength(12);
    expect(acBankOf({ root: 45, scale: 'minor', count: 40, decay: 1, brightness: 0.5 }, SR).hz).toHaveLength(12);
  });
  it('a tone at one resonator\'s note rings that resonator most', () => {
    const bank = { root: 45, scale: 'minor' as const, count: 8, decay: 0.6, brightness: 0.5 };
    const hz = acResonatorHz(bank.root, bank.scale, bank.count, SR);
    for (let k = 0; k < hz.length; k++) {
      const e = acResonatorEnergies(sine(hz[k], 1.5, 0.05), SR, bank);
      expect(acLoudest(e, e.length), `note ${k}`).toBe(k);
      const others = e.filter((_, j) => j !== k);
      expect(e[k] - Math.max(...others), `note ${k} stands out`).toBeGreaterThan(0.1);
    }
    // Silence rings nothing.
    expect(Math.max(...acResonatorEnergies(new Float32Array(4800), SR, bank))).toBe(0);
  });
});

describe('Spectral: the worklet\'s frames', () => {
  type Core = {
    acStftNew(n: number, hop: number): { n: number; hop: number };
    acStftProcess(st: unknown, input: Float32Array | null, output: Float32Array, o: { mode: number; freeze: boolean; amount: number; threshold: number; mix: number }): void;
  };
  const core = new Function(`${AC_SPECTRAL_CORE}\nreturn { acStftNew, acStftProcess };`)() as Core;
  const run = (input: Float32Array, o: { mode: number; freeze: boolean; amount?: number; threshold?: number; mix?: number }, st = core.acStftNew(1024, 256)) => {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 128) core.acStftProcess(st, input.subarray(i, i + 128), out.subarray(i, i + 128), { amount: 0.8, threshold: -300, mix: 1, ...o });
    return { out, st };
  };

  it('passing everything gives the sound back, 1024 samples (one frame) late (what Mix lines the dry sound up with)', () => {
    let seed = 1;
    const noise = Float32Array.from({ length: 16384 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    const { out } = run(noise, { mode: 2, freeze: false });
    let err = 0;
    for (let i = 4096; i < noise.length; i++) err = Math.max(err, Math.abs(out[i] - noise[i - 1024]));
    expect(err).toBeLessThan(1e-3);
    // Mix 0 is the dry sound, on the same clock.
    const dry = run(noise, { mode: 2, freeze: false, mix: 0 }).out;
    for (let i = 4096; i < noise.length; i += 97) expect(dry[i]).toBeCloseTo(noise[i - 1024], 6);
  });

  it('Freeze holds the sound: a tone keeps sounding after the input goes silent, and stops when Freeze is off', () => {
    const tone = sine(440, 0.5, 0.4);
    const st = run(tone, { mode: 0, freeze: false }).st;
    const silence = new Float32Array(24000);
    const held = run(silence, { mode: 0, freeze: true }, st).out;
    expect(rms(held, 4096)).toBeGreaterThan(0.15);
    // Its pitch: still 440 Hz (zero crossings over the last half second).
    let zc = 0;
    for (let i = 4097; i < held.length; i++) if ((held[i - 1] < 0) !== (held[i] < 0)) zc++;
    expect(zc / 2 / ((held.length - 4097) / SR)).toBeCloseTo(440, -1);
    const off = run(silence, { mode: 0, freeze: false }, st).out;
    expect(rms(off, 4096)).toBeLessThan(1e-4);
    // Without Freeze the tone dies with its input.
    const plain = run(silence, { mode: 0, freeze: false }, run(tone, { mode: 0, freeze: false }).st).out;
    expect(rms(plain, 4096)).toBeLessThan(1e-4);
  });

  it('Gate silences the quiet frequencies and keeps the loud ones', () => {
    let seed = 7;
    const quiet = Float32Array.from({ length: 24000 }, () => 0.01 * ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    const tone = sine(1000, 0.5, 0.4);
    const mixed = tone.map((v, i) => v + quiet[i]);
    const gated = run(mixed, { mode: 2, freeze: false, threshold: -40 }).out;
    // What is left is the tone (delayed): the noise is gone.
    let resid = 0, k = 0;
    for (let i = 4096; i < mixed.length; i++) { resid += (gated[i] - tone[i - 1024]) ** 2; k++; }
    expect(Math.sqrt(resid / k)).toBeLessThan(rms(quiet) * 0.5);
    expect(rms(run(quiet, { mode: 2, freeze: false, threshold: -40 }).out, 4096)).toBeLessThan(rms(quiet) * 0.05);
  });

  it('Blur smears: after a burst it lingers, longer with more Amount', () => {
    const burst = new Float32Array(24000);
    burst.set(sine(660, 0.1, 0.4), 0);
    const tail = (amount: number) => rms(run(burst, { mode: 1, freeze: false, amount }).out, 9000, 14000);
    expect(tail(0)).toBeLessThan(1e-4);
    expect(tail(0.9)).toBeGreaterThan(1e-3);
    expect(tail(0.97)).toBeGreaterThan(tail(0.9));
  });
});

describe('what is heard', () => {
  const kinds = (m: Record<string, string>) => (id: string) => m[id] ?? null;
  it('the last effect with Listen on in each chain plays; its source goes quiet; a Mic chain never plays', () => {
    const nodes = [
      n('audioSource', 'src', 0, 0),
      n('audioFilter', 'f1', 0, 0, { listen: true }, { audio: ['src', 'audio'] }),
      n('audioResonator', 'r1', 0, 0, { listen: true }, { audio: ['f1', 'audio'] }),
      n('audioSpectral', 's1', 0, 0, { listen: false }, { audio: ['r1', 'audio'] }),
      n('audioFilter', 'f2', 0, 0, { listen: true }, { audio: ['src', 'audio'] }),
      n('audioSource', 'mic', 0, 0, { source: 'mic' }),
      n('audioFilter', 'fm', 0, 0, { listen: true }, { audio: ['mic', 'audio'] }),
      n('audioSource', 'dry', 0, 0),
      n('audioFilter', 'fd', 0, 0, { listen: false }, { audio: ['dry', 'audio'] }),
    ];
    const h = audioHearing(collectAudioNodes(nodes), kinds({ src: 'file', mic: 'mic', dry: 'file' }));
    expect([...h.heard].sort()).toEqual(['f2', 'r1']);
    expect([...h.dryMuted]).toEqual(['src']);
    expect(h.rootOf.get('s1')).toBe('src');
    expect(h.rootOf.get('fm')).toBe('mic');
  });
});

/** Source → a group holding Filter → Resonator bank, and Hit listening to the bank; out: Hit's envelope plus an energy. */
function chainInGroup(): GraphNode[] {
  return [
    n('audioSource', 'src', 0, 0),
    group('grp', 300, 0, {
      label: 'Chain', iterations: 1,
      inputs: [{ key: 'snd', type: 'audio', label: 'Audio', from: ['src', 'audio'] }],
      outputs: [{ key: 'v', type: 'float', label: 'Value', from: ['sum', 'result'] }, { key: 'a', type: 'audio', label: 'Audio', from: ['gres', 'audio'] }],
      nodes: [
        n('audioFilter', 'gfilt', 0, 0, { filterType: 'highpass', frequency: 200 }, { audio: [GROUP_PORT_SENTINEL, 'snd'] }),
        n('audioResonator', 'gres', 200, 0, { count: '5' }, { audio: ['gfilt', 'audio'] }),
        n('audioHit', 'ghit', 400, 0, {}, { audio: ['gres', 'audio'] }),
        n('splitVec4', 'ex', 400, 100, {}, { v: ['gres', 'energies'] }),
        n('add', 'sum', 600, 0, {}, { a: ['ghit', 'envelope'], b: ['ex', 'x'] }),
      ],
    }),
    n('audioSpectrum', 'spec', 700, 200, {}, { audio: ['grp', 'a'] }),
    n('add', 'tot', 900, 0, {}, { a: ['grp', 'v'], b: ['spec', 'value'] }),
    n('output', 'out', 1100, 0, {}, { color: ['tot', 'result'] }),
  ];
}

describe('chains through groups', () => {
  it('the walk follows each node to the sound it takes, through the group\'s ports both ways', () => {
    const refs = collectAudioNodes(chainInGroup());
    const by = Object.fromEntries(refs.map(r => [r.node.id, r.sourceId]));
    expect(by).toEqual({ src: 'src', gfilt: 'src', gres: 'gfilt', ghit: 'gres', spec: 'gres' });
    expect(audioHearing(refs, id => (id === 'src' ? 'file' : null)).rootOf.get('gres')).toBe('src');
  });

  it('compiles: the energies are live uniforms bound to the inner node, the bank a texture', () => {
    const r = compileGraph({ nodes: chainInGroup() });
    expect(r.errors ?? []).toEqual([]);
    for (const ch of ['e0', 'e1', 'e4', 'loudest', 'level']) expect(Object.values(r.liveUniforms), ch).toContain(`gres::${ch}`);
    expect(Object.values(r.textureUniforms)).toContain('gres');
  });

  it('the engine builds the chain in the source\'s context, feeds each node from the one before, plays the last listening one, and quiets the file', async () => {
    const nodes = chainInGroup();
    const textures = new Map<string, unknown>();
    audioToolsEngine.setHost({ setTexture: (id, t) => { textures.set(id, t); }, requestRender: () => {} });
    audioToolsEngine.sync(nodes);
    expect(await audioToolsEngine.loadFile('src', new File([new Uint8Array(8)], 'loop.wav'))).toBeNull();
    const slots = audioToolsEngine.slots();
    expect(slots.effects.map(e => [e.id, e.upstreamId, e.rootId, e.heard])).toEqual([['gfilt', 'src', 'src', false], ['gres', 'gfilt', 'src', true]]);
    expect(slots.listeners.find(l => l.id === 'ghit')?.sourceId).toBe('gres');
    expect(slots.dryMuted).toEqual(['src']);
    expect(textures.get('gres')).toBeTruthy();

    // A loud tone at the bank's third note, on every analyser.
    const hz = acResonatorHz(45, 'minor', 5, SR);
    fake.frame.wave.set(sine(hz[2], 2048 / SR, 0.5));
    fake.frame.freq.fill(-30);
    const written = new Map<string, number>();
    for (let i = 0; i < 4; i++) audioToolsEngine.tickInputs(1 / 60, 0, (k, v) => { written.set(k, v as number); });
    const src = fake.audioEngine.getAnalyser('src')!;
    const filt = fake.made.find(x => x.kind === 'biquad' && (x as unknown as { type: string }).type === 'highpass')!;
    expect(src.to.some(x => x.kind === 'gain' && x.to.includes(filt))).toBe(true);
    // The bank is heard (through the master volume), the filter before it isn't; the file's own chain is diverted.
    expect(fake.outside).toHaveLength(1);
    expect(audioFxHost.isDiverted('node:src')).toBe(true);
    // Every channel the compiler reads is written; the level moves.
    const r = compileGraph({ nodes });
    for (const ch of Object.values(r.liveUniforms)) expect(written.has(ch), ch).toBe(true);
    expect(written.get('gfilt::level')).toBeGreaterThan(0.5);
    expect(written.get('gres::e0')).toBeGreaterThan(0);

    // Listen off on the bank: the filter is the last listening one now.
    audioToolsEngine.sync(nodes.map(x => x.id !== 'grp' ? x : { ...x, params: { ...x.params, subgraph: {
      ...(x.params.subgraph as object), nodes: (x.params.subgraph as { nodes: GraphNode[] }).nodes.map(m => m.id === 'gres' ? { ...m, params: { ...m.params, listen: false } } : m),
    } } }));
    audioToolsEngine.tickInputs(1 / 60, 0, () => {});
    expect(audioToolsEngine.slots().effects.map(e => e.heard)).toEqual([true, false]);
    expect(fake.outside).toHaveLength(1);
    // Removed: the slots go, the file plays as it is again.
    audioToolsEngine.sync([nodes[0]]);
    audioToolsEngine.tickInputs(1 / 60, 0, () => {});
    expect(audioToolsEngine.slots().effects).toEqual([]);
    expect(fake.outside).toHaveLength(0);
    expect(audioFxHost.isDiverted('node:src')).toBe(false);
  });

  it('a Play control driving a number wins over the card\'s value', () => {
    const node = n('audioFilter', 'f', 0, 0, { frequency: 500 });
    expect(effectSpecOf(node).frequency).toBe(500);
    expect(effectSpecOf(node, k => (k === 'frequency' ? 3000 : undefined)).frequency).toBe(3000);
    // Through the input bus: a param channel written this frame.
    const off = inputBus.addSource({ tickInputs: (_dt, _t, write) => write('param:f::frequency', 2200), wantsTick: () => true });
    inputBus.tick(1 / 60, 0);
    expect(inputBus.paramValue('f::frequency')).toBe(2200);
    off();
    inputBus.tick(1 / 60, 0); inputBus.tick(1 / 60, 0);
    expect(inputBus.paramValue('f::frequency')).toBeUndefined();
  });
});

describe('editing an effect', () => {
  it('is live: its numbers and its type change without a compile; a bank\'s Count compiles', () => {
    const st = () => useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: [
      n('audioSource', 'src', 0, 0),
      n('audioResonator', 'res', 0, 0, { count: '8' }, { audio: ['src', 'audio'] }),
      n('output', 'out', 0, 0, {}, { color: ['res', 'peak'] }),
    ], activeGroupPath: [], activeGroupId: null });
    st().compile();
    const compile = vi.spyOn(st(), 'compile');
    st().updateNodeParams('res', { decay: 3 }, { immediate: true });
    st().updateNodeParams('res', { scale: 'major' });
    st().updateNodeParams('res', { listen: false });
    expect(compile).not.toHaveBeenCalled();
    expect(st().nodes.find(x => x.id === 'res')!.params).toMatchObject({ decay: 3, scale: 'major', listen: false });
    // Its numbers are uniforms too (Play and pages read them): kept current.
    const u = st().paramBindings['res::decay'];
    expect(u).toBeTruthy();
    expect(st().paramUniforms[u]).toBe(3);
    st().updateNodeParams('res', { count: '12' }, { immediate: true });
    expect(compile).toHaveBeenCalled();
    compile.mockRestore();
  });
});

describe('on a page', () => {
  it('carries the effects, what is heard and the uniforms that drive them; the kit builds the same graph', () => {
    const nodes = [
      n('audioSource', 'src', 0, 0),
      n('audioFilter', 'filt', 0, 0, { frequency: 900 }, { audio: ['src', 'audio'] }),
      n('audioSpectral', 'spx', 0, 0, { mode: 'gate' }, { audio: ['filt', 'audio'] }),
      n('audioHit', 'hit', 0, 0, {}, { audio: ['spx', 'audio'] }),
      n('add', 'sum', 0, 0, {}, { a: ['hit', 'envelope'], b: ['filt', 'level'] }),
      n('output', 'out', 0, 0, {}, { color: ['sum', 'result'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const tools = audioToolsForWeb({ nodes, liveUniforms: r.liveUniforms, textureUniforms: r.textureUniforms, videoUniforms: {}, paramBindings: r.paramBindings, mediaOf: () => null })!;
    expect(tools.sources[0].quiet).toBe(true);
    expect(tools.effects!.map(e => [e.id, e.upstreamId, e.rootId, e.heard, e.spec.type])).toEqual([
      ['filt', 'src', 'src', false, 'audioFilter'], ['spx', 'filt', 'src', true, 'audioSpectral'],
    ]);
    expect(tools.effects![0].drive.frequency).toBe(r.paramBindings['filt::frequency']);
    expect(tools.listeners.map(l => [l.id, l.sourceId])).toEqual([['hit', 'spx']]);
    expect(Object.values(tools.textures)).toContain('spx');

    const SSKit = new Function(`${kitScript(new Set(['audioTools']))}\nreturn SSKit;`)() as { audioTools: { chain: { build: typeof acBuild } } };
    const fx = SSKit.audioTools.chain.build(fake.ctx as unknown as BaseAudioContext, tools.effects![0].spec);
    expect(fx.type).toBe('audioFilter');
    expect((fake.made.filter(x => x.kind === 'biquad').pop() as unknown as { frequency: { value: number } }).frequency.value).toBe(900);

    const html = buildPlayHtml({
      title: 'Chain', fragmentShader: r.fragmentShader, uniforms: {}, paramBindings: r.paramBindings, play: emptyPlayRecord(), aspect: 'free',
      media: { textures: {}, videos: {}, audio: [], audioTools: tools },
    } as unknown as PlayHtmlInput);
    expect(html).toContain('function acStepEffect');
    expect(html).toContain('registerProcessor(\'ac-spectral\'');
  });
});
