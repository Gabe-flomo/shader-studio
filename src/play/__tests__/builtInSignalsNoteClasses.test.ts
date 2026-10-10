/**
 * Wave 7 (docs/plan-2026-10-10.md, items 18 and 19): the built-in signals
 * (Signals: count, active, active share) and MIDI note classes (octaves
 * wrapped, so C in any octave hits the same target), with the "Map 12 notes
 * → 12 targets" quick setup. In the kit, the file, the engine and the web
 * runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { kmClassMask, kmClassName, kmClassUnit, kmPitchClass, kmWrapRead } from '../kit/midi.js';
import { sgBuiltIn, sgBuiltInUnit, sgParseValueRef } from '../kit/signals.js';
import { noteKeys, triggerKey } from '../triggers';
import { classOf, LAYER_REST, mapNoteClasses, withNoteWrap, type NoteTarget } from '../noteClassMap';
import { noteClassesLabel, sourceFromType, sourceLabel, sourceType, triggerLabel, valueRefLabel } from '../playSources';
import { valueRange } from '../conditionRange';
import { conditionRanges } from '../conditionRange';
import { sourcePickerSections } from '../../components/play/sourcePickerSections';
import { playEngine } from '../../lib/playEngine';
import { midiEngine } from '../../lib/midiEngine';
import { inputBus } from '../../lib/inputBus';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { BUILT_IN_SIGNALS, defaultLayer, emptyPlayRecord, parsePlayRecordAsSaved, type PlayControl, type PlayLayer, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); inputBus.setParamBindings({}); });

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const above = (value: string, threshold = 0.5): TriggerSpec => ({ on: 'value', value, cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });
const follows = (id: string, value: string): PlaySignal => ({ id, name: id.toUpperCase(), when: { kind: 'trigger', trigger: above(value) } });

let clock = 1;
function tick(src: number, src2: number) {
  playEngine.setBaseValues(new Map([['src', src], ['src2', src2]]));
  inputBus.tick(1 / 60, (clock += 1 / 60));
}

// ── Built-in signals ────────────────────────────────────────────────────────

describe('built-in signals', () => {
  it('the kit reads them raw for conditions and 0..1 for sources', () => {
    expect(sgParseValueRef('sigs:count')).toEqual({ kind: 'builtin', read: 'count' });
    expect(sgParseValueRef('sigs:active')).toEqual({ kind: 'builtin', read: 'active' });
    expect(sgParseValueRef('sigs:share')).toEqual({ kind: 'builtin', read: 'share' });
    expect(sgParseValueRef('sigs:other')).toBeNull();
    expect([sgBuiltIn('count', 4, 1), sgBuiltIn('active', 4, 1), sgBuiltIn('share', 4, 1), sgBuiltIn('share', 0, 0)]).toEqual([4, 1, 0.25, 0]);
    expect([sgBuiltInUnit('count', 4, 1, 8), sgBuiltInUnit('active', 4, 3, 2), sgBuiltInUnit('share', 4, 2, 99)]).toEqual([0.5, 1, 0.5]);
  });

  it('count follows the signals as they are added or removed, active and share follow what is on', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('src2')], signals: [follows('a', 'ctl:src'), follows('b', 'ctl:src2'), { id: 'c', name: 'Sent only' }] };
    playEngine.setRecord(rec);
    const read = () => ['sigs:count', 'sigs:active', 'sigs:share'].map(r => playEngine.readValue(r));
    tick(0, 0);
    expect(read()).toEqual([3, 0, 0]);
    tick(0.9, 0);
    expect(read()).toEqual([3, 1, 1 / 3]);
    tick(0.9, 0.9);
    expect(read()).toEqual([3, 2, 2 / 3]);
    expect(playEngine.builtInSignals()).toEqual({ count: 3, active: 2, share: 2 / 3 });
    // A signal added: the count moves at once.
    playEngine.setRecord({ ...rec, signals: [...rec.signals!, { id: 'd', name: 'D' }] });
    tick(0.9, 0.9);
    expect(read()).toEqual([4, 2, 0.5]);
    // Removed: the count drops, and the removed signal's level no longer counts.
    playEngine.setRecord({ ...rec, signals: [follows('a', 'ctl:src')] });
    tick(0.9, 0.9);
    expect(read()).toEqual([1, 1, 1]);
    tick(0, 0.9);
    expect(read()).toEqual([1, 0, 0]);
    // As a source: the share as it is, a count over its "full at".
    playEngine.setRecord(rec);
    tick(0.9, 0.9);
    expect(playEngine.readSource({ kind: 'signals', read: 'share' })).toBeCloseTo(2 / 3);
    expect(playEngine.readSource({ kind: 'signals', read: 'active', max: 4 })).toBe(0.5);
    expect(playEngine.readSource({ kind: 'signals', read: 'count' })).toBe(3 / 8);
  });

  it('a sent signal counts as active in its frame', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('src2')], signals: [{ id: 'ping', name: 'Ping' }],
      actions: [{ id: 'send', trigger: { ...above('ctl:src'), cmp: 'crossUp' } as TriggerSpec, do: 'signal', layerId: '', signal: 'ping', amount: 1, enabled: true }],
    };
    playEngine.setRecord(rec);
    const seen: number[] = [];
    for (const v of [0, 0.9, 0.9, 0.9]) { tick(v, 0); seen.push(playEngine.readValue('sigs:active')!); }
    // Sent on frame 2 after the levels were worked out: counted on frame 3, for one frame.
    expect(seen).toEqual([0, 0, 1, 0]);
  });

  it('they are built in: not signals of the record, always offered, and nothing can delete them', () => {
    const empty = emptyPlayRecord();
    expect(BUILT_IN_SIGNALS.map(b => b.label)).toEqual(['Signals: count', 'Signals: active', 'Signals: active share']);
    // Offered with no signals at all, in the Source picker…
    const items = sourcePickerSections([], false, []).flatMap(s => s.items.map(i => i.value));
    expect(items).toEqual(expect.arrayContaining(['signals:count', 'signals:active', 'signals:share']));
    // …and readable as values: a record without signals counts 0.
    playEngine.setRecord(empty);
    expect(playEngine.readValue('sigs:count')).toBe(0);
    // A file can't hold one as a signal to delete: a signal with a built-in's name is an ordinary signal, and the built-ins stay.
    const rec = parsePlayRecordAsSaved({ version: 1, layers: [], controls: [], mappings: [], signals: [{ id: 'sigs:count', name: 'Signals: count' }] })!;
    playEngine.setRecord(rec);
    tick(0, 0);
    expect(playEngine.readValue('sigs:count')).toBe(1);
    // Removing every signal leaves the built-ins reading 0, still valid paths.
    playEngine.setRecord({ ...rec, signals: [] });
    expect(['sigs:count', 'sigs:active', 'sigs:share'].map(r => playEngine.readValue(r))).toEqual([0, 0, 0]);
    expect(valueRefLabel('sigs:active')).toBe('Signals: active');
  });

  it('a built-in source round-trips through the file and the picker; its ranges follow the record', () => {
    const rec = parsePlayRecordAsSaved({ version: 1, layers: [], controls: [control('out')], mappings: [
      { id: 'm', controlId: 'out', source: { kind: 'signals', read: 'active', max: 3 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'bad', controlId: 'out', source: { kind: 'signals', read: 'nope' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ] })!;
    expect(rec.mappings.map(m => m.source)).toEqual([{ kind: 'signals', read: 'active', max: 3 }]);
    expect(sourceType({ kind: 'signals', read: 'share' })).toBe('signals:share');
    expect(sourceFromType('signals:count', { kind: 'mouse', axis: 'x' })).toEqual({ kind: 'signals', read: 'count' });
    expect(sourceLabel({ kind: 'signals', read: 'count' })).toBe('Signals: count');
    const two = { ...emptyPlayRecord(), signals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    expect(valueRange(two, 'sigs:active')).toEqual([0, 2]);
    expect(valueRange(two, 'sigs:share')).toEqual([0, 1]);
  });
});

// ── Note classes (octaves wrapped) ──────────────────────────────────────────

describe('note classes in the kit', () => {
  it('names and masks pitch classes', () => {
    expect([kmPitchClass(60), kmPitchClass(61), kmPitchClass(36), kmPitchClass(-1)]).toEqual([0, 1, 0, 11]);
    expect([kmClassName(0), kmClassName(13), kmClassName(71)]).toEqual(['C', 'C#', 'B']);
    expect(kmClassMask(null)).toBe(0xfff);
    expect(kmClassMask([36, 40])).toBe(0b11111); // C–E
    expect(kmClassMask([47, 49])).toBe((1 << 11) | 0b11); // B–C#, across an octave line
    expect(kmClassMask([30, 60])).toBe(0xfff);
  });

  it('reads the latest note of the classes in any octave', () => {
    const seq = new Float64Array(128), vel = new Uint8Array(128);
    const held = new Set<number>();
    seq[38] = 1; vel[38] = 50; // D2
    seq[74] = 2; vel[74] = 90; held.add(74); // D5
    seq[61] = 3; vel[61] = 70; // C#4
    expect(kmWrapRead(seq, vel, held, [62, 62])).toEqual({ note: 74, vel: 90, gate: true }); // D in any octave
    expect(kmWrapRead(seq, vel, held, [60, 60])).toEqual({ note: -1, vel: 0, gate: false }); // no C yet
    expect(kmWrapRead(seq, vel, held, null).note).toBe(61);
    expect([kmClassUnit(null, 60), kmClassUnit(null, 71), kmClassUnit([62, 66], 76), kmClassUnit([62, 62], 50)]).toEqual([0, 1, 0.5, 1]);
  });

  it('a wrapped note trigger counts under its class, which every octave presses', () => {
    const t: TriggerSpec = { on: 'note', channel: 0, note: 0, wrap: true };
    expect(triggerKey(t)).toBe('note:0:c0');
    for (const n of [24, 36, 48, 60, 72, 84]) expect(noteKeys(1, n)).toContain('note:0:c0');
    expect(noteKeys(1, 61)).not.toContain('note:0:c0');
    expect(noteKeys(3, 64)).toEqual(['note:0:*', 'note:0:64', 'note:0:c4', 'note:3:*', 'note:3:64', 'note:3:c4']);
    // An unwrapped trigger keeps its old key.
    expect(triggerKey({ on: 'note', channel: 2, note: 60 })).toBe('note:2:60');
    expect(triggerLabel(t)).toBe('C (any octave)');
    expect(triggerLabel({ on: 'note', channel: 0, note: 61 })).toBe('C#4');
  });

  it('the file keeps wrap and stores the class; switching wrap keeps the note name', () => {
    const rec = parsePlayRecordAsSaved({ version: 1, layers: [], controls: [control('out')], mappings: [
      { id: 'a', controlId: 'out', source: { kind: 'trigger', trigger: { on: 'note', channel: 0, note: 62, wrap: true }, mode: 'envelope', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'b', controlId: 'out', source: { kind: 'midi', signal: 'gate', channel: 0, range: [48, 50], wrap: true }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'c', controlId: 'out', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 3, wrap: true }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ] })!;
    expect(rec.mappings[0].source).toMatchObject({ trigger: { on: 'note', note: 2, wrap: true } });
    expect(rec.mappings[1].source).toEqual({ kind: 'midi', signal: 'gate', channel: 0, range: [48, 50], wrap: true });
    expect(rec.mappings[2].source).toEqual({ kind: 'midi', signal: 'cc', channel: 0, cc: 3 });
    expect(sourceLabel(rec.mappings[1].source)).toBe('Gate C–D (any octave)');
    expect(noteClassesLabel(undefined)).toBe('class (any octave)');
    expect(withNoteWrap({ on: 'note', channel: 0, note: 64 }, true)).toEqual({ on: 'note', channel: 0, note: 4, wrap: true });
    expect(withNoteWrap({ on: 'note', channel: 0, note: 4, wrap: true }, false)).toEqual({ on: 'note', channel: 0, note: 64 });
    expect(withNoteWrap({ on: 'note', channel: 0, note: -1 }, true).note).toBe(-1);
    // A wrapped choice carries over between note, velocity and gate.
    expect(sourceFromType('midi:velocity', { kind: 'midi', signal: 'gate', channel: 2, wrap: true })).toEqual({ kind: 'midi', signal: 'velocity', channel: 2, wrap: true });
  });
});

describe('note classes in the engine (injected MIDI)', () => {
  const noteOn = (n: number, v = 100) => midiEngine.handleBytes(0x90, n, v);
  const noteOff = (n: number) => midiEngine.handleBytes(0x80, n, 0);

  it('a wrapped gate or note source hears its class in any octave', () => {
    const gate = { kind: 'midi' as const, signal: 'gate' as const, channel: 0, range: [60, 60] as [number, number], wrap: true };
    noteOn(36); // C2
    expect(playEngine.readSource(gate)).toBe(1);
    noteOff(36);
    expect(playEngine.readSource(gate)).toBe(0);
    noteOn(84); // C6
    expect(playEngine.readSource(gate)).toBe(1);
    noteOff(84);
    noteOn(50); // D3
    expect(playEngine.readSource({ kind: 'midi', signal: 'note', channel: 0, wrap: true })).toBeCloseTo(2 / 11);
    // Unwrapped, the same range hears only C4, which hasn't been played.
    expect(playEngine.readSource({ kind: 'midi', signal: 'gate', channel: 0, range: [60, 60] })).toBeNull();
    noteOff(50);
  });

  it('an action on a wrapped note fires on that note in every octave, and only on it', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), layers: [{ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' } as PlayLayer],
      actions: [{ id: 'onE', trigger: { on: 'note', channel: 0, note: 4, wrap: true }, do: 'burst', layerId: 'p', amount: 1, enabled: true }],
    };
    playEngine.setRecord(rec);
    tick(0, 0);
    const fired: number[] = [];
    const off = playEngine.onAction(a => { if (a.id === 'onE') fired.push(1); });
    for (const n of [40, 52, 64, 76, 65, 63]) { noteOn(n); tick(0, 0); noteOff(n); tick(0, 0); }
    off();
    expect(fired.length).toBe(4); // E2, E3, E4, E5; not F4 or D#4
  });

  it('Map 12 notes → 12 targets: each class lights its own target, in every octave', () => {
    const controls = Array.from({ length: 12 }, (_, i) => control(`t${i}`));
    const base: PlayRecord = { ...emptyPlayRecord(), controls };
    const { play, sourceIds, skipped } = mapNoteClasses(base, controls.map(c => ({ kind: 'control', id: c.id }) as NoteTarget));
    expect(sourceIds).toHaveLength(12);
    expect(skipped).toEqual([]);
    expect(play.sources!.map(s => s.label)).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(n => `Note ${n} (any octave)`));
    expect(play.sources![3].source).toMatchObject({ kind: 'trigger', trigger: { on: 'note', channel: 0, note: 3, wrap: true } });
    expect(play.sources![3].outputs[0].routes[0]).toMatchObject({ to: 't3', mode: 'replace', outMin: 0, outMax: 1 });
    playEngine.setRecord(play);
    // The controls are bound to the shader (as on the Play page), so the bus ticks the engine.
    inputBus.setParamBindings(Object.fromEntries(controls.map(c => [c.target, `u_${c.id}`])));
    tick(0, 0);
    const lit = () => controls.map(c => ((playEngine.liveValue(c.id) as number | undefined) ?? 0) > 0.3);
    for (const octave of [2, 3, 4, 5, 6]) {
      for (let pc = 0; pc < 12; pc++) {
        const n = (octave + 1) * 12 + pc;
        noteOn(n);
        tick(0, 0); tick(0, 0);
        const on = lit();
        expect(on.map((x, i) => (x ? i : -1)).filter(i => i >= 0)).toEqual([pc]);
        // Its envelope keeps the picture drawing (a record source, not only an old mapping).
        expect(playEngine.isAnimating()).toBe(true);
        noteOff(n);
        for (let k = 0; k < 60; k++) tick(0, 0); // let the release fade
      }
    }
  });

  it('the quick setup takes picks in order, starts on any note, lights layers through their opacity and skips what it can’t drive', () => {
    const layers = ['a', 'b'].map(id => defaultLayer('shape', id, `Circle ${id}`) as PlayLayer);
    const base: PlayRecord = { ...emptyPlayRecord(), layers, controls: [control('k'), { ...control('tint'), kind: 'color' }] };
    const picks: NoteTarget[] = [{ kind: 'layer', id: 'b' }, { kind: 'control', id: 'k' }, { kind: 'control', id: 'tint' }, { kind: 'layer', id: 'gone' }, { kind: 'layer', id: 'a' }];
    const { play, skipped } = mapNoteClasses(base, picks, { first: 9, channel: 2 });
    expect(skipped).toEqual([{ kind: 'control', id: 'tint' }, { kind: 'layer', id: 'gone' }]);
    expect(play.sources).toHaveLength(3);
    // A (9) for the first pick, A# for the second; the fifth pick keeps its place in the order (D).
    expect(play.sources!.map(s => s.label)).toEqual(['Note A (any octave)', 'Note A# (any octave)', 'Note C# (any octave)']);
    expect([classOf(0, 9), classOf(3, 9), classOf(4, 9)]).toEqual([9, 0, 1]);
    // A shape is lit through its fill (it has no opacity of its own).
    const opacity = play.controls.find(c => c.target === 'layer:b::fillOpacity')!;
    expect(opacity).toMatchObject({ kind: 'float', min: 0, max: 1, label: 'Circle b · Fill' });
    expect(play.sources![0].outputs[0].routes[0]).toMatchObject({ to: opacity.id, outMin: LAYER_REST, outMax: 1 });
    expect(play.sources![0].source).toMatchObject({ trigger: { channel: 2 } });
    // Running it again reuses the layer's opacity control.
    const again = mapNoteClasses(play, [{ kind: 'layer', id: 'b' }]);
    expect(again.play.controls.filter(c => c.target === 'layer:b::fillOpacity')).toHaveLength(1);
    // At most twelve.
    expect(mapNoteClasses({ ...emptyPlayRecord(), controls: Array.from({ length: 14 }, (_, i) => control(`c${i}`)) }, Array.from({ length: 14 }, (_, i) => ({ kind: 'control', id: `c${i}` }) as NoteTarget)).sourceIds).toHaveLength(12);
  });
});

// ── The web runtime ─────────────────────────────────────────────────────────

describe('the web runtime', () => {
  it('reads the built-in signals frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('src2'), control('share'), control('many')],
      signals: [follows('a', 'ctl:src'), follows('b', 'ctl:src2')],
      mappings: [
        { id: 'm1', controlId: 'share', source: { kind: 'signals', read: 'active', max: 2 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'many', source: { kind: 'trigger', trigger: above('sigs:active', 1.5), mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    const frames: Array<[number, number]> = [[0, 0], [0.9, 0], [0.9, 0.9], [0.9, 0.9], [0, 0.9], [0, 0], [0.9, 0.9]];
    playEngine.setRecord(rec);
    const app = frames.map(([a, b]) => { tick(a, b); return ['share', 'many'].map(id => (playEngine.liveValue(id) as number | undefined) ?? 0); });
    const web = runtimeRun(rec, frames, ['share', 'many']).map(r => r.map(v => v ?? 0));
    expect(web).toEqual(app);
    expect(app.map(r => r[0])).toContain(1);
    expect(app.some(r => r[1] === 1)).toBe(true); // two on at once toggled it
  });

  it('carries the pitch-class keys and the wrapped read', () => {
    expect(runtimeSource).toContain("'note:0:' + pcKey");
    expect(runtimeSource).toContain("t.wrap ? 'c' + (t.note % 12)");
    expect(runtimeSource).toContain('function wrapRead(ch, range)');
  });
});

class El {
  tagName: string; children: El[] = []; style: Record<string, string> = {}; className = ''; textContent = ''; innerHTML = ''; parentElement: El | null = null;
  width = 300; height = 150; clientWidth = 400; clientHeight = 300; value = ''; disabled = false; dataset = {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: El[]) { for (const e of c) { e.parentElement = this; this.children.push(e); } }
  appendChild(c: El) { this.append(c); return c; }
  prepend(...c: El[]) { this.append(...c); }
  replaceChildren(...c: El[]) { this.children = []; this.append(...c); }
  remove() {} setAttribute() {} removeAttribute() {} addEventListener() {} removeEventListener() {} setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return new Proxy({}, { get: (_t, k: string) => (/^[A-Z0-9_]+$/.test(k) ? 1 : k === 'getShaderParameter' || k === 'getProgramParameter' ? () => true : k === 'checkFramebufferStatus' ? () => 1 : k === 'getExtension' ? () => ({}) : () => ({})) });
  }
}

function runtimeRun(play: PlayRecord, frames: Array<[number, number]>, read: string[]) {
  const rafs: ((t: number) => void)[] = [];
  const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { set(id: string, v: number): void; get(id: string): { value: number; driven: boolean } | null } };
  const bindings = Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`]));
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, { type: 'float', value: 0 }]));
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: { ...play, condRanges: conditionRanges(play) }, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return frames.map(([a, b]) => {
    h.set('src', a); h.set('src2', b);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}
