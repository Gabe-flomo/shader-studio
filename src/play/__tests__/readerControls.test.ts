/**
 * Every audio reader is a control (play/readerControls.ts): a reader comes
 * with a 0..1 control in a group named after what the readers listen to and
 * a reader → control mapping; renaming, deleting and re-pointing the readers
 * carry the control along; new readers are named by their band; older
 * setups get a one-time offer; the app engine and the web runtime read the
 * control the same way.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import runtimeSource from '../runtime/play-runtime.js?raw';
import {
  addMissingReaderControls, addReader, autoReaderName, bandName, isAutoReaderName, isReaderControl, newReader, patchReader, readerControlOf, readerGroupName,
  readersWithoutControls, regroupReaderControls, removeReader, renameReader, setReaderInput,
} from '../readerControls';
import { formatHz } from '../audioReaders';
import { readControlValue, bakeControlValues, controlExists, locateTarget } from '../playControls';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, parseReaderTarget, readerControlTarget, type AudioReader, type PlayRecord } from '../../types/play';
import { newRack } from '../../types/playAudioEngine';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { audioReaderBank } from '../../lib/audioReaderBank';

const rd = (id: string, hz: number, over: Partial<AudioReader> = {}): AudioReader => ({ id, name: formatHz(hz), hz, width: 1 / 3, gain: 20, attack: 0, release: 0, colour: [1, 0.5, 0.2], ...over });
const empty = (): PlayRecord => emptyPlayRecord();

afterEach(() => {
  vi.restoreAllMocks();
  audioReaderBank.clearPlayback();
  audioReaderBank.setConfig(undefined);
  playEngine.setRecord(emptyPlayRecord());
});

describe('band names', () => {
  it('names a reader by the band its centre sits in', () => {
    expect([30, 59.9, 60, 120, 249, 250, 499, 500, 1000, 1999, 2000, 3999, 4000, 9999, 10000, 16000].map(bandName))
      .toEqual(['Sub', 'Sub', 'Lows', 'Lows', 'Lows', 'Low mids', 'Low mids', 'Mids', 'Mids', 'Mids', 'High mids', 'High mids', 'Highs', 'Highs', 'Air', 'Air']);
  });

  it('numbers a band that already has a reader: Lows, Lows 2, Lows 3', () => {
    const a = newReader('a', 120, -30);
    expect(a.name).toBe('Lows');
    const b = newReader('b', 200, -30, [a]);
    expect(b.name).toBe('Lows 2');
    expect(newReader('c', 80, -30, [a, b]).name).toBe('Lows 3');
    // A gap is filled; the reader being renamed doesn't count against itself.
    expect(autoReaderName(100, [a, { ...b, name: 'Lows 3' }])).toBe('Lows 2');
    expect(autoReaderName(100, [a, b], 'b')).toBe('Lows 2');
    // Different bands, no numbers.
    expect(newReader('d', 8000, -30, [a, b]).name).toBe('Highs');
  });

  it('knows an automatic name from a custom one (old frequency names count as automatic)', () => {
    for (const n of ['Sub', 'Lows 2', 'High mids', 'Air 12', '120 Hz', '1.3 kHz', '8 kHz']) expect(isAutoReaderName(n)).toBe(true);
    for (const n of ['Kick', 'Lows kick', 'lows', 'Hat 2', '']) expect(isAutoReaderName(n)).toBe(false);
    expect(isAutoReaderName(formatHz(1250), 1250)).toBe(true);
  });
});

describe('a reader comes with a control', () => {
  it('adds a 0–1 control in "Audio readers · Live" and a reader → control mapping', () => {
    const r = newReader('k', 60, -30);
    const p = addReader(empty(), r);
    expect(p.audioReaders).toEqual({ input: '', readers: [r] });
    expect(p.controls).toHaveLength(1);
    const c = p.controls[0];
    expect(c).toMatchObject({ target: readerControlTarget('k'), kind: 'float', label: 'Lows', min: 0, max: 1, group: 'Audio readers · Live' });
    expect(parseReaderTarget(c.target)).toEqual({ readerId: 'k' });
    expect(isReaderControl(c)).toBe(true);
    expect(p.mappings).toHaveLength(1);
    expect(p.mappings[0]).toMatchObject({ controlId: c.id, source: { kind: 'reader', readerId: 'k' }, outMin: 0, outMax: 1, smoothMs: 0, enabled: true });
    expect(readerControlOf(p, 'k')).toBe(c);
  });

  it('groups by what the readers listen to: a rack, a video layer, drum pads, a song', () => {
    const rack = { ...newRack('r1', []), name: 'Bass rack' };
    const base: PlayRecord = { ...empty(), layers: [defaultLayer('video', 'v1', 'Clip'), defaultLayer('drumpad', 'd1', 'Kit')], audioEngine: { racks: [rack] } };
    const on = (input: string, songLabel?: (id: string) => string | undefined) => readerGroupName({ ...base, audioReaders: { input, readers: [] } }, songLabel);
    expect(on('')).toBe('Audio readers · Live');
    expect(on('engine:r1')).toBe('Audio readers · Bass rack');
    expect(on('video:v1')).toBe('Audio readers · Clip');
    expect(on('pads:d1')).toBe('Audio readers · Kit');
    expect(on('node_7', id => (id === 'node_7' ? 'Song A' : undefined))).toBe('Audio readers · Song A');
    expect(on('node_7')).toBe('Audio readers · Song');
    expect(on('engine:gone')).toBe('Audio readers · Rack');
    const p = addReader({ ...base, audioReaders: { input: 'engine:r1', readers: [] } }, newReader('k', 60, -30));
    expect(p.controls[0].group).toBe('Audio readers · Bass rack');
  });

  it('renaming the reader renames the control', () => {
    let p = addReader(empty(), newReader('k', 60, -30));
    p = renameReader(p, 'k', '  Kick ');
    expect(p.audioReaders!.readers[0].name).toBe('Kick');
    expect(p.controls[0].label).toBe('Kick');
    // A blank name is ignored.
    expect(renameReader(p, 'k', '   ')).toBe(p);
  });

  it('moving a reader to another band renames it (and its control) only while its name is automatic', () => {
    let p = addReader(empty(), newReader('k', 60, -30));
    p = patchReader(p, 'k', { hz: 8000 });
    expect(p.audioReaders!.readers[0]).toMatchObject({ hz: 8000, name: 'Highs' });
    expect(p.controls[0].label).toBe('Highs');
    // Within the band, nothing changes.
    p = patchReader(p, 'k', { hz: 5000 });
    expect(p.audioReaders!.readers[0].name).toBe('Highs');
    // Numbered when the band is taken.
    p = addReader(p, newReader('h', 12000, -30, p.audioReaders!.readers));
    expect(p.audioReaders!.readers[1].name).toBe('Air');
    p = patchReader(p, 'h', { hz: 6000 });
    expect(p.audioReaders!.readers[1].name).toBe('Highs 2');
    // A custom name sticks.
    p = renameReader(p, 'k', 'Snare');
    p = patchReader(p, 'k', { hz: 100 });
    expect(p.audioReaders!.readers[0]).toMatchObject({ hz: 100, name: 'Snare' });
    expect(p.controls[0].label).toBe('Snare');
    // So does an old frequency name: it follows the band on the first move.
    p = addReader(p, rd('o', 120));
    p = patchReader(p, 'o', { hz: 3000 });
    expect(p.audioReaders!.readers[2].name).toBe('High mids');
    // Other fields don't touch the name.
    p = patchReader(p, 'k', { gain: 10 });
    expect(p.audioReaders!.readers[0].name).toBe('Snare');
    expect(patchReader(p, 'missing', { hz: 1 })).toBe(p);
  });

  it('deleting a reader deletes its control, the mappings on it and the ones reading it', () => {
    let p = addReader(empty(), newReader('k', 60, -30));
    p = addReader(p, newReader('h', 8000, -30, p.audioReaders!.readers));
    const kCtl = readerControlOf(p, 'k')!, hCtl = readerControlOf(p, 'h')!;
    p = {
      ...p,
      controls: [...p.controls, { id: 'r', target: 'n::radius', kind: 'float', label: 'R', min: 0, max: 1 }],
      mappings: [
        ...p.mappings,
        { id: 'via', controlId: 'r', source: { kind: 'control', controlId: kCtl.id }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'lfo', controlId: kCtl.id, source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'trig', controlId: 'r', source: { kind: 'trigger', trigger: { on: 'reader', readerId: 'k', threshold: 0.5, hysteresis: 0.1 }, mode: 'envelope', attack: 5, decay: 100, sustain: 0, release: 50, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
      actions: [{ id: 'a', trigger: { on: 'reader', readerId: 'k', threshold: 0.55, hysteresis: 0.2 }, do: 'burst', layerId: 'p', amount: 30, enabled: true }],
    };
    const out = removeReader(p, 'k');
    expect(out.audioReaders!.readers.map(r => r.id)).toEqual(['h']);
    expect(out.controls.map(c => c.id)).toEqual([hCtl.id, 'r']);
    expect(out.mappings.map(m => m.controlId)).toEqual([hCtl.id]);
    expect(out.actions).toBeUndefined();
    // The last reader: the key goes.
    expect(removeReader(out, 'h').audioReaders).toBeUndefined();
  });

  it('pointing the readers elsewhere moves their controls to the new group', () => {
    const rack = { ...newRack('r1', []), name: 'Rack 1' };
    let p: PlayRecord = { ...empty(), audioEngine: { racks: [rack] } };
    p = addReader(p, newReader('k', 60, -30));
    p = setReaderInput(p, 'engine:r1');
    expect(p.audioReaders!.input).toBe('engine:r1');
    expect(p.controls[0].group).toBe('Audio readers · Rack 1');
    expect(setReaderInput(p, 'engine:r1')).toBe(p);
    // A renamed rack: regrouped on demand.
    p = { ...p, audioEngine: { racks: [{ ...rack, name: 'Drums' }] } };
    expect(regroupReaderControls(p).controls[0].group).toBe('Audio readers · Drums');
    expect(regroupReaderControls(regroupReaderControls(p))).toEqual(regroupReaderControls(p));
    // Other controls keep their groups.
    p = { ...p, controls: [...p.controls, { id: 'x', target: 'n::a', kind: 'float', label: 'A', min: 0, max: 1, group: 'Mine' }] };
    expect(regroupReaderControls(p).controls[1].group).toBe('Mine');
  });
});

describe('older setups', () => {
  const old: PlayRecord = {
    ...empty(),
    controls: [{ id: 'c', target: 'n::radius', kind: 'float', label: 'R', min: 0, max: 1 }],
    mappings: [{ id: 'm1', controlId: 'c', source: { kind: 'reader', readerId: 'kick' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    audioReaders: { input: '', readers: [rd('kick', 60, { name: 'Kick' }), rd('hat', 8000)] },
  };

  it('are left as saved: the readers have no controls until the offer is taken', () => {
    expect(readersWithoutControls(old).map(r => r.id)).toEqual(['kick', 'hat']);
    const p = addMissingReaderControls(old);
    expect(readersWithoutControls(p)).toEqual([]);
    expect(p.controls.map(c => c.label)).toEqual(['R', 'Kick', '8 kHz']);
    expect(p.controls.slice(1).every(c => c.group === 'Audio readers · Live')).toBe(true);
    // The old mapping stays; each reader got its own.
    expect(p.mappings.map(m => m.controlId)).toEqual(['c', p.controls[1].id, p.controls[2].id]);
    expect(addMissingReaderControls(p)).toBe(p);
    // The offer knows a partial setup too.
    expect(readersWithoutControls(removeReader(p, 'hat'))).toEqual([]);
    expect(readersWithoutControls({ ...p, controls: p.controls.filter(c => c.label !== 'Kick') }).map(r => r.id)).toEqual(['kick']);
  });

  it('a file keeps a control’s group, and drops a reader control whose reader is gone', () => {
    const p = addReader(old, newReader('snare', 200, -30, old.audioReaders!.readers));
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    const gone = JSON.parse(JSON.stringify(p)) as { audioReaders: { readers: AudioReader[] }; controls: unknown[]; mappings: unknown[] };
    gone.audioReaders.readers = gone.audioReaders.readers.filter(r => r.id !== 'snare');
    const parsed = parsePlayRecord(gone);
    expect(parsed.controls.map(c => c.id)).toEqual(['c']);
    expect(parsed.mappings.map(m => m.id)).toEqual(['m1']);
    // A blank group is no group.
    expect(parsePlayRecord({ ...empty(), controls: [{ id: 'g', target: 'n::a', label: 'A', min: 0, max: 1, group: '  ' }] }).controls[0].group).toBeUndefined();
  });
});

describe('in the engine', () => {
  it('the control has a base of 0, exists while its reader does, and is never baked or relinked', () => {
    const p = addReader(empty(), newReader('k', 60, -30));
    const c = p.controls[0];
    expect(readControlValue([], c.target, p)).toBe(0);
    expect(controlExists([], c, p)).toBe(true);
    expect(controlExists([], c, { ...p, audioReaders: undefined })).toBe(false);
    expect(locateTarget([], c.target)).toEqual({ status: 'ok' });
    expect(bakeControlValues([], p, new Map([[c.id, 0.7]]))).toEqual([]);
  });

  it('shows the reader’s level on the control, which another mapping reads as "Another control"', () => {
    let p = addReader(empty(), newReader('k', 60, -30));
    const kCtl = p.controls[0];
    p = {
      ...p,
      controls: [...p.controls, { id: 'r', target: 'n::radius', kind: 'float', label: 'R', min: 0.2, max: 1.2 }],
      mappings: [...p.mappings, { id: 'via', controlId: 'r', source: { kind: 'control', controlId: kCtl.id }, outMin: 0.2, outMax: 1.2, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    playEngine.setRecord(p);
    playEngine.setBaseValues(new Map([[kCtl.id, 0], ['r', 0.5]]));
    const writes = new Map<string, number | number[]>();
    audioReaderBank.setPlayback('k', 0.75);
    let t = 1;
    // The reader's mapping runs first (list order), so the control reading it sees this frame's value.
    for (let i = 0; i < 3; i++) inputBus.tick(1 / 60, (t += 1 / 60));
    expect(playEngine.liveValue(kCtl.id)).toBeCloseTo(0.75);
    expect(playEngine.liveValue('r')).toBeCloseTo(0.2 + 0.75);
    // Conditions read the control too.
    expect(playEngine.readValue(`ctl:${kCtl.id}`)).toBeCloseTo(0.75);
    // No uniform was written for the reader control: it has none.
    inputBus.tick(1 / 60, (t += 1 / 60));
    for (const [k] of writes) expect(k.startsWith('reader:')).toBe(false);
    // The input off: the reader reads null, the control goes back to its base, the follower to its own.
    audioReaderBank.clearPlayback();
    inputBus.tick(1 / 60, (t += 1 / 60));
    inputBus.tick(1 / 60, (t += 1 / 60));
    expect(playEngine.liveValue(kCtl.id)).toBeUndefined();
    expect(playEngine.liveValue('r')).toBeCloseTo(0.2);
  });
});

describe('on a website', () => {
  it('the runtime knows the target and keeps the control’s live value without a uniform', () => {
    const win: Record<string, unknown> = { addEventListener() {} };
    const fn = new Function('window', 'document', 'navigator', runtimeSource);
    fn(win, { getElementById: () => null }, {});
    const I = (win.ShaderStudioPlay as { internals: { readerTarget: (t: string) => { readerId: string } | null } }).internals;
    expect(I.readerTarget(readerControlTarget('k'))).toEqual(parseReaderTarget(readerControlTarget('k')));
    expect(I.readerTarget('n::radius')).toBeNull();
    expect(I.readerTarget('layer:x::y')).toBeNull();
    // The runtime's mapping loop treats a reader control like a layer property: live only, no uniform write.
    expect(runtimeSource).toContain("if (readerTarget(c.target) || grainsTarget(c.target)) { live.set(c.id, v); driven.add(c.id); return; }");
    expect(runtimeSource).toContain('else if (readerTarget(c.target)) base.set(c.id, 0);');
  });
});
