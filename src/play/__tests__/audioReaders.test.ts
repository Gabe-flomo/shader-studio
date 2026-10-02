/**
 * Audio readers: dots on the live spectrum, each reading one band as 0..1.
 * The log axis and the bins, a reader's level with its width, gain and
 * smoothing on synthetic spectra, reader triggers' threshold and hysteresis
 * (through the Play engine), the record round trip, takes, the web runtime's
 * copy, and Learn's pick.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The graph store reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import runtimeSource from '../runtime/play-runtime.js?raw';
import {
  READER_RANGE_DB, bandDb, binToHz, formatHz, gainForTopDb, hzToBin, hzToUnit, newReader, pickLearned, placeLabels, readSpectrum, readerBand, readerGate, readerLevel, readerTopDb,
  smoothLevel, stepReaders, unitToHz,
} from '../audioReaders';
import { triggerKey } from '../triggers';
import { sourceFromType, sourceOptions, sourceType, triggerFromKind } from '../playSources';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { audioEngine } from '../../lib/audioEngine';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { TakeCapture } from '../../lib/takes';
import { trackAt } from '../../lib/takePlayback';
import { defaultLayer, emptyPlayRecord, isPlayRecordEmpty, parsePlayRecordAsSaved, parseTake, type AudioReader, type PlayAction, type PlayRecord } from '../../types/play';
import { removeReader } from '../../components/play/readersPanelUi';

const SR = 48000;
const BINS = 1024; // fftSize 2048
const BIN_HZ = SR / 2 / BINS; // 23.4375

/** A spectrum at `floor` dB with `peaks` (Hz → dB) put in their nearest bins. */
function spectrum(peaks: Record<number, number>, floor = -100): Float32Array {
  const f = new Float32Array(BINS).fill(floor);
  for (const [hz, db] of Object.entries(peaks)) f[Math.round(Number(hz) / BIN_HZ)] = db;
  return f;
}

const rd = (id: string, hz: number, over: Partial<AudioReader> = {}): AudioReader => ({ id, name: formatHz(hz), hz, width: 1 / 3, gain: 20, attack: 0, release: 0, colour: [1, 0.5, 0.2], ...over });

afterEach(() => {
  vi.restoreAllMocks();
  audioReaderBank.clearPlayback();
  audioReaderBank.setConfig(undefined);
  playEngine.setRecord(emptyPlayRecord());
});

describe('the log frequency axis and the FFT bins', () => {
  it('maps 20 Hz – 20 kHz onto 0..1 logarithmically, and back', () => {
    expect(hzToUnit(20)).toBe(0);
    expect(hzToUnit(20000)).toBeCloseTo(1);
    // The middle of a log axis is the geometric mean.
    expect(hzToUnit(Math.sqrt(20 * 20000))).toBeCloseTo(0.5);
    // Each decade is a third of the axis.
    expect(hzToUnit(2000) - hzToUnit(200)).toBeCloseTo(1 / 3);
    for (const hz of [20, 60, 440, 1000, 8000, 19999]) expect(unitToHz(hzToUnit(hz))).toBeCloseTo(hz, 6);
    // Out of range clamps.
    expect(hzToUnit(5)).toBe(0);
    expect(unitToHz(2)).toBeCloseTo(20000);
  });

  it('finds the bin whose centre is a frequency (sampleRate / 2 / bins apart)', () => {
    expect(hzToBin(BIN_HZ * 10, SR, BINS)).toBeCloseTo(10);
    expect(hzToBin(60, SR, BINS)).toBeCloseTo(2.56, 2);
    expect(binToHz(hzToBin(8000, SR, BINS), SR, BINS)).toBeCloseTo(8000);
    // 44.1 kHz and a 4096 FFT: finer bins.
    expect(hzToBin(441, 44100, 2048)).toBeCloseTo(40.96, 2);
  });

  it('spans width octaves around the centre, geometrically', () => {
    const { lo, hi } = readerBand(1000, 2);
    expect(lo).toBeCloseTo(500);
    expect(hi).toBeCloseTo(2000);
    const third = readerBand(60, 1 / 3);
    expect(Math.log2(third.hi / third.lo)).toBeCloseTo(1 / 3);
    expect(Math.sqrt(third.lo * third.hi)).toBeCloseTo(60);
  });
});

describe('band level', () => {
  it('reads a bin exactly when the band covers it alone', () => {
    const f = spectrum({ [BIN_HZ * 10]: -20 });
    expect(bandDb(f, SR, BIN_HZ * 9.6, BIN_HZ * 10.4)).toBeCloseTo(-20, 3);
  });

  it('weights bins by how much of each the band overlaps, so a band narrower than a bin still reads', () => {
    // Bin 2 at −20 dB, bin 3 at −100: a band over 2.2..2.8 overlaps bin 2 by 0.3 and bin 3 by 0.3.
    const f = new Float32Array(BINS).fill(-100);
    f[2] = -20;
    const db = bandDb(f, SR, BIN_HZ * 2.2, BIN_HZ * 2.8);
    expect(db).toBeCloseTo(10 * Math.log10((Math.pow(10, -2) + Math.pow(10, -10)) / 2), 3); // ≈ −23 dB
    // 60 Hz ± a sixth of an octave falls between bins 2 and 3: it still hears a kick in bin 3.
    const kick = spectrum({ 70: -25 });
    expect(bandDb(kick, SR, readerBand(60, 1 / 3).lo, readerBand(60, 1 / 3).hi)).toBeGreaterThan(-30);
  });

  it('dilutes a lone peak as the band widens (mean power)', () => {
    const f = spectrum({ 1000: -20 });
    const narrow = bandDb(f, SR, 990, 1010);
    const wide = bandDb(f, SR, readerBand(1000, 2).lo, readerBand(1000, 2).hi);
    expect(narrow).toBeGreaterThan(wide + 10);
  });

  it('treats silence (−Infinity) as the floor and leaves out the DC bin', () => {
    const f = new Float32Array(BINS).fill(-Infinity);
    f[0] = 0;
    expect(bandDb(f, SR, 1, 30)).toBeLessThan(-150);
  });

  it('turns dB into 0..1 over a 40 dB window whose top the gain sets', () => {
    expect(readerTopDb(0)).toBe(-10);
    expect(readerLevel(-10, 0)).toBe(1);
    expect(readerLevel(-50, 0)).toBe(0);
    expect(readerLevel(-30, 0)).toBeCloseTo(0.5);
    // More gain: the same sound reads higher.
    expect(readerLevel(-50, 20)).toBeCloseTo(0.5);
    expect(readerLevel(-50, 40)).toBe(1);
    expect(READER_RANGE_DB).toBe(40);
    // The dot's height and the gain are one setting.
    expect(readerTopDb(gainForTopDb(-35))).toBeCloseTo(-35);
  });

  it('hears the kick at 60 Hz, not at 8 kHz, and the hi-hat the other way round', () => {
    const kick = spectrum({ 58.6: -22, 82: -30 });
    const hat = spectrum({ 8000: -35, 8200: -38 });
    const k = rd('k', 60, { gain: 20 }), h = rd('h', 8000, { gain: 35, width: 1 });
    expect(readSpectrum(k, kick, SR)).toBeGreaterThan(0.7);
    expect(readSpectrum(h, kick, SR)).toBe(0);
    expect(readSpectrum(h, hat, SR)).toBeGreaterThan(0.3);
    expect(readSpectrum(k, hat, SR)).toBe(0);
  });
});

describe('smoothing', () => {
  it('rises with the attack and falls with the release', () => {
    expect(smoothLevel(0, 1, 1 / 60, 0, 500)).toBe(1);
    expect(smoothLevel(1, 0, 0.1, 0, 100)).toBeCloseTo(Math.exp(-1));
    expect(smoothLevel(0, 1, 0.05, 50, 0)).toBeCloseTo(1 - Math.exp(-1));
    expect(smoothLevel(1, 0, 1 / 60, 50, 0)).toBe(0);
  });

  it('steps every reader from a spectrum, and forgets deleted ones', () => {
    const readers = [rd('k', 60, { attack: 20, release: 200 }), rd('h', 8000)];
    const levels = new Map<string, number>([['gone', 0.5]]);
    const loud = spectrum({ 58.6: -12, 70.3: -12 });
    stepReaders(readers, loud, SR, 1 / 60, levels);
    const first = levels.get('k')!;
    expect(first).toBeGreaterThan(0.3);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 20; i++) stepReaders(readers, loud, SR, 1 / 60, levels);
    expect(levels.get('k')).toBeGreaterThan(0.99);
    expect(levels.get('h')).toBe(0);
    expect(levels.has('gone')).toBe(false);
    // Quiet: it falls slowly (200 ms release), not at once.
    stepReaders(readers, spectrum({}), SR, 1 / 60, levels);
    expect(levels.get('k')).toBeGreaterThan(0.9);
  });
});

describe('reader triggers: threshold and hysteresis', () => {
  it('opens at the threshold and lets go only below threshold − hysteresis', () => {
    const levels = [0.2, 0.59, 0.6, 0.55, 0.45, 0.41, 0.39, 0.5, 0.61];
    const out: boolean[] = [];
    let open = false;
    for (const v of levels) out.push(open = readerGate(open, v, 0.6, 0.2));
    expect(out).toEqual([false, false, true, true, true, true, false, false, true]);
  });

  it('fires actions through the Play engine, once per hit, with each firing mode', () => {
    const readers = [rd('kick', 60)];
    const trig = { on: 'reader' as const, readerId: 'kick', threshold: 0.6, hysteresis: 0.2 };
    const action = (id: string, fire?: PlayAction['trigger']['fire']): PlayAction => ({ id, trigger: fire ? { ...trig, fire } : trig, do: 'burst', layerId: 'p', amount: 10, enabled: true });
    const rec: PlayRecord = {
      ...emptyPlayRecord(),
      layers: [defaultLayer('particles', 'p', 'P')],
      audioReaders: { input: '', readers },
      actions: [action('once'), action('release', { mode: 'release', every: 3, unit: 'frames' }), action('every', { mode: 'every', every: 2, unit: 'frames' })],
    };
    playEngine.setRecord(parsePlayRecordAsSaved(rec));
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    // A kick that rings: up past 0.6, wobbles above 0.4, falls, then a second hit.
    const levels = [0, 0.3, 0.7, 0.9, 0.55, 0.5, 0.45, 0.3, 0.1, 0.65, 0.2];
    let t = 1;
    for (const v of levels) { audioReaderBank.setPlayback('kick', v); inputBus.tick(1 / 60, (t += 1 / 60)); }
    off();
    expect(fired.filter(x => x === 'once')).toHaveLength(2);
    expect(fired.filter(x => x === 'release')).toHaveLength(2);
    // Open for frames 2–6 (5 frames): at the start, then every 2 → 3; the second hit is one frame → 1.
    expect(fired.filter(x => x === 'every')).toHaveLength(4);
  });

  it('keys by reader, threshold and hysteresis', () => {
    expect(triggerKey({ on: 'reader', readerId: 'k', threshold: 0.6, hysteresis: 0.1 })).toBe('reader:k:0.6:0.1');
  });
});

describe('as sources', () => {
  it('lists readers under Live audio in the picker, with the way to the panel', () => {
    const opts = sourceOptions([{ id: 'k', name: 'Kick' }, { id: 'h', name: 'Hi-hat' }]);
    const live = opts.filter(o => o.group === 'Live audio').map(o => o.label);
    expect(live).toEqual(['Band (bass, treble…)', 'Reader · Kick', 'Reader · Hi-hat', 'Spectrum readers…']);
    expect(sourceFromType('reader:k', { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 })).toEqual({ kind: 'reader', readerId: 'k' });
    expect(sourceType({ kind: 'reader', readerId: 'h' })).toBe('reader:h');
    expect(triggerFromKind('reader', { on: 'audio', band: 'bass', threshold: 0.7 }, [], 'k')).toEqual({ on: 'reader', readerId: 'k', threshold: 0.7, hysteresis: 0.1 });
  });

  it('reads a reader through the engine, null while its input is off', () => {
    playEngine.setRecord(parsePlayRecordAsSaved({ ...emptyPlayRecord(), audioReaders: { input: '', readers: [rd('k', 60)] } }));
    expect(playEngine.readSource({ kind: 'reader', readerId: 'k' })).toBeNull();
    audioReaderBank.setPlayback('k', 0.4);
    expect(playEngine.readSource({ kind: 'reader', readerId: 'k' })).toBe(0.4);
  });

  it('reads the song of an Audio Input node through its analyser', () => {
    const f = spectrum({ 8000: -30 });
    const an = { frequencyBinCount: BINS, context: { sampleRate: SR }, getFloatFrequencyData: (b: Float32Array) => b.set(f) } as unknown as AnalyserNode;
    vi.spyOn(audioEngine, 'getAnalyser').mockReturnValue(an);
    vi.spyOn(audioEngine, 'isLoaded').mockReturnValue(true);
    let now = 1e12;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 20));
    audioReaderBank.setConfig({ input: 'song1', readers: [rd('h', 8000, { gain: 40 }), rd('k', 60)] });
    expect(audioReaderBank.inputState()).toBe('song');
    audioReaderBank.update();
    expect(audioReaderBank.value('h')).toBeGreaterThan(0.5);
    expect(audioReaderBank.value('k')).toBe(0);
    expect(audioReaderBank.value('nope')).toBeNull();
  });
});

describe('name tags on the spectrum', () => {
  const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('puts a tag above its dot, inside the view', () => {
    const [t] = placeLabels([{ x: 100, y: 80, w: 40 }], 300, 200);
    expect(t).toEqual({ x: 80, y: 57, w: 40, h: 14 });
    // At the left edge it slides right; at the top it drops inside.
    expect(placeLabels([{ x: 3, y: 4, w: 40 }], 300, 200)[0]!.x).toBe(2);
    expect(placeLabels([{ x: 150, y: 4, w: 40 }], 300, 200)[0]!.y).toBeGreaterThanOrEqual(2);
  });

  it('never overlaps two tags, or a tag and another dot; the first gets the best spot', () => {
    const dots = [{ x: 100, y: 80, w: 44 }, { x: 104, y: 82, w: 44 }, { x: 110, y: 78, w: 44 }, { x: 160, y: 80, w: 44 }];
    const tags = placeLabels(dots, 300, 200);
    expect(tags[0]!.y).toBeLessThan(80);
    const shown = tags.filter((t): t is NonNullable<typeof t> => !!t);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(hit(shown[i], shown[j])).toBe(false);
    tags.forEach((t, i) => { if (t) dots.forEach((d, j) => { if (j !== i) expect(hit(t, { x: d.x - 8, y: d.y - 8, w: 16, h: 16 })).toBe(false); }); });
    // Two readers on one frequency: one above, one below.
    const pair = placeLabels([{ x: 100, y: 80, w: 40 }, { x: 100, y: 80, w: 40 }], 300, 200);
    expect(pair[0]!.y).toBeLessThan(80);
    expect(pair[1]!.y).toBeGreaterThan(80);
  });
});

describe('Learn', () => {
  it('picks what rose most, when it rose enough', () => {
    expect(pickLearned([{ key: 'band:bass', low: 0.2, now: 0.3 }])).toBeNull();
    expect(pickLearned([
      { key: 'reader:k', low: 0.1, now: 0.8 },
      { key: 'band:bass', low: 0.2, now: 0.7 },
      { key: 'band:treble', low: 0.4, now: 0.5 },
    ])).toBe('reader:k');
    expect(pickLearned([{ key: 'reader:k', low: 0.1, now: 0.5 }, { key: 'band:treble', low: 0, now: 0.9 }])).toBe('band:treble');
  });

  it('learns the reader a sound moved, as a source and as a trigger', () => {
    playEngine.setRecord(parsePlayRecordAsSaved({ ...emptyPlayRecord(), audioReaders: { input: '', readers: [rd('k', 60), rd('h', 8000)] } }));
    let got: unknown = null;
    playEngine.startLearn(s => { got = s; });
    let t = 1;
    const step = (k: number, h: number) => { audioReaderBank.setPlayback('k', k); audioReaderBank.setPlayback('h', h); inputBus.tick(1 / 60, (t += 1 / 60)); };
    for (let i = 0; i < 8; i++) step(0.1, 0.1);
    expect(got).toBeNull();
    step(0.15, 0.5);
    step(0.15, 0.8);
    step(0.15, 0.8);
    expect(got).toEqual({ kind: 'reader', readerId: 'h' });

    let trig: unknown = null;
    playEngine.startLearnTrigger(x => { trig = x; });
    for (let i = 0; i < 8; i++) step(0.05, 0.1);
    // The hit rises over a few frames: the threshold sits 60% up to its peak, not its first frame.
    step(0.45, 0.1);
    expect(trig).toBeNull();
    step(0.9, 0.1);
    step(0.85, 0.1);
    expect(trig).toMatchObject({ on: 'reader', readerId: 'k', hysteresis: 0.1 });
    expect((trig as { threshold: number }).threshold).toBeCloseTo(0.56, 2);
  });
});

describe('saved in the Play setup', () => {
  const readers = [rd('kick', 60, { name: 'Kick', gain: 25, attack: 2, release: 160 }), rd('hat', 8000, { name: 'Hi-hat', width: 1 })];
  const rec: PlayRecord = {
    ...emptyPlayRecord(),
    controls: [{ id: 'c', target: 'n::radius', kind: 'float', label: 'R', min: 0, max: 1 }],
    mappings: [
      { id: 'm1', controlId: 'c', source: { kind: 'reader', readerId: 'kick' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm2', controlId: 'c', source: { kind: 'trigger', trigger: { on: 'reader', readerId: 'hat', threshold: 0.5, hysteresis: 0.15, fire: { mode: 'every', every: 4, unit: 'frames' } }, mode: 'envelope', attack: 5, decay: 100, sustain: 0, release: 50, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ],
    layers: [defaultLayer('particles', 'p', 'P')],
    actions: [{ id: 'a', trigger: { on: 'reader', readerId: 'hat', threshold: 0.55, hysteresis: 0.2 }, do: 'burst', layerId: 'p', amount: 30, enabled: true }],
    audioReaders: { input: 'node_7', readers },
  };

  it('round-trips through a file unchanged', () => {
    const once = parsePlayRecordAsSaved(JSON.parse(JSON.stringify(rec)));
    expect(once).toEqual(rec);
    expect(parsePlayRecordAsSaved(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(isPlayRecordEmpty({ ...emptyPlayRecord(), audioReaders: { input: '', readers } })).toBe(false);
  });

  it('leaves old files as they were', () => {
    const old = parsePlayRecordAsSaved({ version: 1, controls: [], mappings: [], layers: [] });
    expect('audioReaders' in old).toBe(false);
    expect(parsePlayRecordAsSaved({ ...emptyPlayRecord(), audioReaders: { input: '', readers: [] } }).audioReaders).toBeUndefined();
  });

  it('drops what reads a reader the file lacks, and clamps the rest', () => {
    const bad = parsePlayRecordAsSaved({
      ...rec,
      audioReaders: { input: 7, readers: [{ id: 'kick', hz: 5, width: 9, gain: 500, attack: -3, colour: 'red' }, { id: 'kick', hz: 100 }, { hz: 50 }] },
    });
    expect(bad.audioReaders!.input).toBe('');
    expect(bad.audioReaders!.readers).toEqual([{ id: 'kick', name: '20 Hz', hz: 20, width: 4, gain: 80, attack: 0, release: 150, colour: [1, 0.6, 0.3] }]);
    // The hi-hat is gone: its trigger mapping and its action go too.
    expect(bad.mappings.map(m => m.id)).toEqual(['m1']);
    expect(bad.actions).toBeUndefined();
  });

  it('keeps at most 16 readers', () => {
    const many = Array.from({ length: 20 }, (_, i) => rd(`r${i}`, 100 + i));
    expect(parsePlayRecordAsSaved({ ...emptyPlayRecord(), audioReaders: { input: '', readers: many } }).audioReaders!.readers).toHaveLength(16);
  });

  it('deleting a reader takes its mappings and actions with it', () => {
    const out = removeReader(rec, 'hat');
    expect(out.audioReaders!.readers.map(r => r.id)).toEqual(['kick']);
    expect(out.mappings.map(m => m.id)).toEqual(['m1']);
    expect(out.actions).toBeUndefined();
  });

  it('names a new reader by its frequency, in the next free colour', () => {
    const a = newReader('a', 120, -30);
    expect(a).toMatchObject({ name: '120 Hz', hz: 120, gain: 20 });
    const b = newReader('b', 8000, -40, [a]);
    expect(b.name).toBe('8 kHz');
    expect(b.colour).not.toEqual(a.colour);
    expect(formatHz(1250)).toBe('1.3 kHz');
  });
});

describe('takes', () => {
  it('record each reader’s level per frame, and keep it through a save', () => {
    const play = parsePlayRecordAsSaved({ ...emptyPlayRecord(), audioReaders: { input: '', readers: [rd('kick', 60, { name: 'Kick' })] } });
    const cap = new TakeCapture(play);
    const vals = [0, 0.2, 0.9, 0.4, 0.1];
    vals.forEach((v, i) => { audioReaderBank.setPlayback('kick', v); cap.sample(1 + i * 0.1); });
    const take = cap.toTake('T')!;
    cap.dispose();
    const tr = take.tracks.find(x => x.kind === 'reader')!;
    expect(tr).toMatchObject({ id: 'kick', label: 'Reader · Kick', width: 1 });
    expect(trackAt(tr, 0.2)).toBeCloseTo(0.9, 2);
    expect(trackAt(tr, 0.35)).toBeCloseTo(0.25, 1);
    const back = parseTake(JSON.parse(JSON.stringify(take)))!;
    expect(back.tracks.find(x => x.kind === 'reader')).toEqual(tr);
  });
});

describe('the web runtime’s copy', () => {
  type Internals = {
    readerBandDb: (f: Float32Array, sr: number, lo: number, hi: number) => number;
    readerRead: (r: AudioReader, f: Float32Array, sr: number) => number;
    readerSmooth: (p: number, t: number, dt: number, a: number, r: number) => number;
    readerGate: (open: boolean, v: number, th: number, hy: number) => boolean;
    triggerKey: (t: unknown) => string;
  };
  const load = (): Internals => {
    const win: Record<string, unknown> = { addEventListener() {} };
    const fn = new Function('window', 'document', 'navigator', runtimeSource);
    fn(win, { getElementById: () => null }, {});
    return (win.ShaderStudioPlay as { internals: Internals }).internals;
  };

  it('reads, smooths and gates exactly as the app does', () => {
    const I = load();
    const f = spectrum({ 58.6: -22, 1000: -40, 8000: -35 });
    for (const [lo, hi] of [[50, 70], [900, 1100], [55, 57], [6000, 12000]]) expect(I.readerBandDb(f, SR, lo, hi)).toBeCloseTo(bandDb(f, SR, lo, hi), 6);
    for (const r of [rd('a', 60), rd('b', 1000, { width: 2, gain: 40 }), rd('c', 8000, { width: 0.1, gain: -5 })]) expect(I.readerRead(r, f, SR)).toBeCloseTo(readSpectrum(r, f, SR), 6);
    expect(I.readerSmooth(0.2, 0.9, 1 / 60, 30, 200)).toBeCloseTo(smoothLevel(0.2, 0.9, 1 / 60, 30, 200), 9);
    expect(I.readerSmooth(0.9, 0.2, 1 / 60, 30, 200)).toBeCloseTo(smoothLevel(0.9, 0.2, 1 / 60, 30, 200), 9);
    for (const [open, v] of [[false, 0.59], [false, 0.6], [true, 0.45], [true, 0.4]] as const) expect(I.readerGate(open, v, 0.6, 0.2)).toBe(readerGate(open, v, 0.6, 0.2));
    const t = { on: 'reader', readerId: 'k', threshold: 0.6, hysteresis: 0.1 } as const;
    expect(I.triggerKey(t)).toBe(triggerKey(t));
  });
});
