/**
 * The cheaper conditions of the simplification plan (phase 2): bands
 * (between / outside) with hysteresis, "is not", "has never reached",
 * thresholds as a percent of the value's range, the switch display of a
 * slider, and pulses in Hz — in the kit, the engine and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { sgCondNew, sgCondRewind, sgCondStep, sgGate, sgValueKey } from '../kit/signals.js';
import { conditionRanges, valueRange } from '../conditionRange';
import { conditionLabel } from '../playSources';
import { beatAt, pulseForHz, pulseHz } from '../triggers';
import { conditionBands, withUnit } from '../../components/play/conditionModel';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { kitScript, playBundle } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type CondCmp, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord, type TriggerSpec, type ValueCondition } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const cond = (cmp: CondCmp, threshold: number, over: Partial<ValueCondition> = {}): ValueCondition => ({ value: 'ctl:src', cmp, threshold, hysteresis: 0, tolerance: 0.01, ...over });
const steps = (c: ValueCondition, vs: Array<number | null>, range?: [number, number]) => { const st = sgCondNew(); return vs.map(v => sgCondStep(st, v, c, range)); };

describe('bands and "is not"', () => {
  it('between opens inside the band and holds hysteresis past either edge; edges either way round', () => {
    const c = cond('between', 0.6, { hi: 0.3, hysteresis: 0.05 });
    expect(steps(c, [0.1, 0.35, 0.27, 0.24, 0.5, 0.64, 0.66])).toEqual([null, 'open', null, 'close', 'open', null, 'close']);
  });

  it('outside opens beyond an edge and lets go once hysteresis back inside', () => {
    const c = cond('outside', 0.3, { hi: 0.6, hysteresis: 0.05 });
    expect(steps(c, [0.5, 0.7, 0.58, 0.54, 0.2, 0.33, 0.36])).toEqual([null, 'open', null, 'close', 'open', null, 'close']);
  });

  it('a band narrower than twice the hysteresis still lets go (at its middle)', () => {
    expect(sgGate(true, 0.5, 'outside', 0.45, 0.2, 0, 0.55)).toBe(false);
    expect(sgGate(true, 0.46, 'outside', 0.45, 0.2, 0, 0.55)).toBe(true);
  });

  it('is not is equals turned round, with its hysteresis inside the tolerance', () => {
    const c = cond('not', 0.5, { tolerance: 0.1, hysteresis: 0.04 });
    expect(steps(c, [0.5, 0.65, 0.58, 0.55, 0.3])).toEqual([null, 'open', null, 'close', 'open']);
  });
});

describe('has never reached', () => {
  it('holds while the highest seen is under the threshold, and starts over on a rewind', () => {
    const c = cond('neverAbove', 0.8);
    const st = sgCondNew();
    const run = (vs: number[]) => vs.map(v => sgCondStep(st, v, c));
    expect(run([0.1, 0.5, 0.79])).toEqual(['open', null, null]);
    expect(run([0.85, 0.2])).toEqual(['close', null]);
    sgCondRewind(st);
    expect(run([0.3])).toEqual(['open']);
  });

  it('never dropped to mirrors it, and needs a reading first', () => {
    expect(steps(cond('neverBelow', 0.2), [null, 0.5, 0.25, 0.1])).toEqual([null, 'open', null, 'close']);
  });
});

describe('percent of range', () => {
  it('measures against the range given, so 50% is the middle whatever the range', () => {
    const c = cond('above', 0.5, { unit: 'pct' });
    expect(steps(c, [2, 6, 7], [0, 10])).toEqual([null, 'open', null]);
    expect(steps(c, [60, 120], [0, 200])).toEqual([null, 'open']);
    // A reversed range works too.
    expect(steps(c, [8, 4], [10, 0])).toEqual([null, 'open']);
  });

  it('without a range uses the range seen so far', () => {
    const c = cond('above', 0.9, { unit: 'pct' });
    // 0 then 10: 10 is the top of what it has seen (100%); then 5 is 50%.
    expect(steps(c, [0, 10, 5, 9.5])).toEqual([null, 'open', 'close', 'open']);
  });

  it('a switch between raw and percent keeps the same place', () => {
    const raw = cond('between', 2, { hi: 8, hysteresis: 1, tolerance: 0.5 });
    const p = withUnit(raw, 'pct', { min: 0, max: 10 });
    expect(p).toMatchObject({ unit: 'pct', threshold: 0.2, hi: 0.8, hysteresis: 0.1, tolerance: 0.05 });
    expect(withUnit(p, 'raw', { min: 0, max: 10 })).toEqual(raw);
  });

  it('finds the range of controls, layer properties, mappings and the pointer; none for a distance', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [{ id: 'c', target: 'n::c', kind: 'float', label: 'C', min: 2, max: 12 }], layers: [defaultLayer('particles', 'p', 'P')] };
    expect(valueRange(play, 'ctl:c')).toEqual([2, 12]);
    expect(valueRange(play, 'layer:p::speed')).not.toBeNull();
    expect(valueRange(play, 'mouse:x')).toEqual([0, 1]);
    expect(valueRange(play, 'dist:mouse|p')).toBeNull();
    const withCond = { ...play, actions: [{ id: 'a', trigger: { on: 'value', ...cond('above', 0.5, { value: 'ctl:c', unit: 'pct' }) } as TriggerSpec, do: 'burst', layerId: 'p', amount: 1, enabled: true } as PlayAction] };
    expect(conditionRanges(withCond)).toEqual({ 'ctl:c': [2, 12] });
    // A website export carries the table.
    expect((playBundle({ play: withCond, title: 'T', nodes: [], fragmentShader: '', uniforms: {}, paramBindings: {} } as never).play as { condRanges?: unknown }).condRanges).toEqual({ 'ctl:c': [2, 12] });
  });
});

describe('the file and the words', () => {
  it('keeps a band’s edge and the unit, and only when set (older keys unchanged)', () => {
    const t = { on: 'value', ...cond('between', 0.2, { hi: 0.7, unit: 'pct' }) };
    const rec = parsePlayRecord({ version: 1, layers: [sparks()], controls: [], mappings: [], actions: [{ id: 'a', trigger: t, do: 'burst', layerId: 'p', amount: 1, enabled: true }] });
    expect(rec?.actions?.[0].trigger).toMatchObject({ cmp: 'between', hi: 0.7, unit: 'pct' });
    expect(sgValueKey(cond('above', 0.5))).toBe('val:ctl:src:above:0.5:0:0.01');
    expect(sgValueKey(cond('between', 0.2, { hi: 0.7, unit: 'pct' }))).toBe('val:ctl:src:between:0.2:0:0.01:0.7:pct');
  });

  it('says what it means', () => {
    const ctx = { controls: [{ id: 'src', label: 'Radius' }] };
    expect(conditionLabel(cond('between', 0.7, { hi: 0.2, unit: 'pct' }), ctx)).toBe('Radius between 20% and 70%');
    expect(conditionLabel(cond('neverAbove', 8), ctx)).toBe('Radius has never reached 8');
    expect(conditionLabel(cond('not', 3, { tolerance: 0.5 }), ctx)).toBe('Radius is not 3 ± 0.5');
  });

  it('draws where each is met', () => {
    expect(conditionBands(cond('outside', 0.3, { hi: 0.6 }), 0, 1).met).toEqual([[0, 0.3], [0.6, 1]]);
    expect(conditionBands(cond('neverAbove', 0.4), 0, 1).met).toEqual([[0, 0.4]]);
  });
});

describe('a switch (boolean control)', () => {
  it('is a slider shown as on/off: kept for sliders only', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], mappings: [], controls: [
      { id: 'a', target: 'n::a', kind: 'float', label: 'A', min: 0, max: 1, toggle: true },
      { id: 'b', target: 'n::b', kind: 'color', label: 'B', min: 0, max: 1, toggle: true },
    ] });
    expect(rec?.controls.map(c => c.toggle)).toEqual([true, undefined]);
  });
});

describe('pulses in Hz', () => {
  it('turn a rate into a tempo and back, slow rates waiting more beats', () => {
    expect(pulseForHz(2)).toEqual({ bpm: 120, beats: 1 });
    expect(pulseHz(pulseForHz(0.005))).toBeCloseTo(0.01);
    const p = pulseForHz(4);
    expect(beatAt(p.bpm, p.beats, 1.01).count - beatAt(p.bpm, p.beats, 0.01).count).toBe(4);
  });
});

// ── In the engine, and the same on a website ─────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const flagOn = (trigger: TriggerSpec) => ({ id: `m_${Math.random()}`, controlId: 'flag', source: { kind: 'trigger' as const, trigger, mode: 'envelope' as const, attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear' as const, smoothMs: 0, enabled: true });

function drive<T>(values: number[], read: () => T, from = 1): T[] {
  let t = from;
  return values.map(v => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); return read(); });
}

describe('the engine', () => {
  it('a percent band follows the control’s range, and matches the web runtime frame for frame', () => {
    const band: TriggerSpec = { on: 'value', ...cond('between', 0.25, { hi: 0.5, unit: 'pct', hysteresis: 0.05 }) };
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src', { min: 0, max: 20 }), control('flag')], layers: [sparks()], mappings: [flagOn(band)] };
    playEngine.setRecord(rec);
    // 25%–50% of 0..20 is 5..10, held 1 past either edge.
    const values = [1, 6, 9, 10.5, 11.2, 4.5, 3.9, 7];
    expect(drive(values, () => playEngine.conditionOpen(band))).toEqual([false, true, true, true, false, false, false, true]);
    // Double the range: the same values now sit lower, and 50% moved with it.
    playEngine.setRecord({ ...rec, controls: [control('src', { min: 0, max: 40 }), control('flag')] });
    expect(drive([1, 12, 21, 30], () => playEngine.conditionOpen(band), 3)).toEqual([false, true, true, false]);
    playEngine.setRecord(rec);
    const app = drive(values, () => playEngine.liveValue('flag') as number | undefined, 5);
    const web = runtimeRun(rec, values, ['flag']).map(r => r[0]);
    expect(web.map(v => (v ?? 0) >= 0.5)).toEqual(app.map(v => (v ?? 0) >= 0.5));
    expect(app.some(v => (v ?? 0) >= 0.5)).toBe(true);
  });

  it('on a website, two bands that differ only in their high edge keep apart', () => {
    const narrow: TriggerSpec = { on: 'value', ...cond('between', 0.2, { hi: 0.4 }) };
    const wide: TriggerSpec = { on: 'value', ...cond('between', 0.2, { hi: 0.9 }) };
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('flag'), control('flag2')], layers: [sparks()],
      mappings: [flagOn(narrow), { ...flagOn(wide), controlId: 'flag2' }] };
    const web = runtimeRun(rec, [0.1, 0.3, 0.6, 0.6], ['flag', 'flag2']);
    const on = (v: number | undefined) => (v ?? 0) >= 0.5;
    expect(on(web[3][0])).toBe(false);
    expect(on(web[3][1])).toBe(true);
  });

  it('has never reached starts over when the clock goes back', () => {
    const never: TriggerSpec = { on: 'value', ...cond('neverAbove', 0.7) };
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src'), control('flag')], layers: [sparks()], mappings: [flagOn(never)] });
    const on = () => playEngine.conditionOpen(never);
    expect(drive([0.2, 0.9, 0.1], on, 5)).toEqual([true, false, false]);
    expect(drive([0.2], on, 1)).toEqual([true]);
  });
});

// A minimal DOM for the web runtime (the same harness as conditionsSignals.test.ts), fed the bundle the export writes.
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

function runtimeRun(play: PlayRecord, values: number[], read: string[]) {
  const rafs: ((t: number) => void)[] = [];
  const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { set(id: string, v: number): void; get(id: string): { value: number; driven: boolean } | null } };
  const bindings = Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`]));
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, { type: 'float', value: 0 }]));
  const bundled = { ...play, condRanges: conditionRanges(play) };
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: bundled, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}
