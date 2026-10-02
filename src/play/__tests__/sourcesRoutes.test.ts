/**
 * Sources and routes (implementation guide, phase 1): old mappings read as
 * sources (unchanged behaviour: the golden snapshots prove it), and a
 * record's own sources — read once, any number of routes, Replace or Add, a
 * Step output driving several controls, no routes at all — in the kit, the
 * engine, the file and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { rtAddSwing, rtCurve, rtSourcesOf } from '../kit/routes.js';
import { sgParseValueRef } from '../kit/signals.js';
import { mapSourceDef, mapValueRef } from '../playRefs';
import { pauseDrive, playDrivenMap, removeFromPlay } from '../playDriven';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultIncrement, emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayRecord, type PlayRoute, type PlaySourceDef } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); inputBus.setParamBindings({}); });

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const route = (id: string, to: string, over: Partial<PlayRoute> = {}): PlayRoute => ({ id, to, mode: 'replace', outMin: 0, outMax: 10, curve: 'linear', enabled: true, ...over });
const lfo = (id: string, routes: PlayRoute[]): PlaySourceDef => ({ id, enabled: true, source: { kind: 'control', controlId: 'src' }, outputs: [{ kind: 'value', routes }] });

/** Tick with `src` (0..1) set, return the named controls' values. */
function drive(play: PlayRecord, values: number[], read: string[], base: Record<string, number> = {}): Array<Array<number | undefined>> {
  inputBus.setParamBindings(Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`])));
  playEngine.setRecord(play);
  let t = 1;
  return values.map(v => {
    playEngine.setBaseValues(new Map(Object.entries({ ...base, src: v })));
    inputBus.tick(1 / 60, (t += 1 / 60));
    return read.map(id => playEngine.liveValue(id) as number | undefined);
  });
}

describe('the kit', () => {
  it('reads an old mapping as a source with one Replace route (an Increment as a Step output)', () => {
    const m = { id: 'm', controlId: 'c', source: { kind: 'mouse', axis: 'x' } as const, outMin: 1, outMax: 3, curve: 'exp' as const, smoothMs: 40, enabled: true, channel: 2 as const, delayMs: 100 };
    const [s] = rtSourcesOf({ mappings: [m] });
    expect(s).toMatchObject({ id: 'm', enabled: true, outputs: [{ kind: 'value', routes: [{ id: 'm', to: 'c', mode: 'replace', outMin: 1, outMax: 3, curve: 'exp', smoothMs: 40, channel: 2, delayMs: 100 }] }] });
    const [st] = rtSourcesOf({ mappings: [{ ...m, increment: defaultIncrement(1) }] });
    expect(st.outputs[0]).toMatchObject({ kind: 'step', lo: 1, hi: 3 });
    expect(rtCurve(0.5, 'exp')).toBe(0.25);
    expect(rtAddSwing(0, 10)).toEqual({ outMin: -5, outMax: 5 });
  });
});

describe('a record’s own sources in the engine', () => {
  const base = { src: 0, a: 5, b: 2, c: 0 };

  it('one source drives several controls, Replace sets, Add moves from the slider and stays in range', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a'), ctl('b'), ctl('c')], sources: [lfo('s', [
      route('r1', 'a', { mode: 'add', ...rtAddSwing(0, 10) }),
      route('r2', 'b'),
      route('r3', 'c', { curve: 'exp' }),
    ])] };
    const got = drive(play, [0.5, 1, 0, 0.75], ['a', 'b', 'c'], base);
    // a: the slider (5) plus a swing of ±5 around the middle; b: 0..10; c: exp.
    expect(got).toEqual([[5, 5, 2.5], [10, 10, 10], [0, 0, 0], [7.5, 7.5, 5.625]]);
  });

  it('Adds sum on top of a Replace, and clamp to the range', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a')], sources: [
      lfo('s1', [route('r1', 'a', { outMin: 2, outMax: 2 })]),
      lfo('s2', [route('r2', 'a', { mode: 'add', outMin: 0, outMax: 4 })]),
      lfo('s3', [route('r3', 'a', { mode: 'add', outMin: 0, outMax: 6 })]),
    ] };
    expect(drive(play, [0, 0.5, 1], ['a'], base).map(r => r[0])).toEqual([2, 7, 10]);
  });

  it('a source with no routes is still read, and conditions watch it as src:<id>', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 })], sources: [lfo('free', [])],
      actions: [{ id: 'x', trigger: { on: 'value', value: 'src:free', cmp: 'above', threshold: 0.5, hysteresis: 0, tolerance: 0 }, do: 'signal', layerId: '', amount: 1, enabled: true, signal: 's' }], signals: [{ id: 's', name: 'S' }] };
    const heard: string[] = [];
    const off = playEngine.onSignal(id => heard.push(id));
    // Sources are read after the conditions in a frame: a condition sees a source as the frame before left it.
    drive(play, [0.2, 0.8, 0.8], [], base);
    off();
    expect(playEngine.sourceValue('free')).toBe(0.8);
    expect(heard).toEqual(['s']);
    expect(sgParseValueRef('src:free')).toEqual({ kind: 'source', id: 'free' });
  });

  it('a Step output counts in its own range and each route remaps it', () => {
    const step = { ...defaultIncrement(0.25, 120), on: 'trigger' as const, trigger: { on: 'value' as const, value: 'ctl:src', cmp: 'crossUp' as const, threshold: 0.5, hysteresis: 0.1, tolerance: 0 } };
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a'), ctl('b', { min: 0, max: 100 })], sources: [{ id: 'st', enabled: true, source: { kind: 'control', controlId: 'src' },
      outputs: [{ kind: 'step', step: { ...step, start: 'value', startValue: 0 }, lo: 0, hi: 1, routes: [route('ra', 'a'), route('rb', 'b', { outMax: 100 })] }] }] };
    const got = drive(play, [0, 1, 0, 1, 0, 1], ['a', 'b'], base);
    expect(got[got.length - 1]).toEqual([7.5, 75]);
  });

  it('knows which controls its routes drive; pausing or removing a control reaches routes', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a')], sources: [{ ...lfo('s', [route('r1', 'a')]), label: 'Knob' }] };
    playEngine.setRecord(play);
    expect(playEngine.isDriven('a')).toBe(true);
    expect(playDrivenMap(play).get('n::a')?.sources).toEqual(['Knob']);
    expect(pauseDrive(play, 'a').sources?.[0].outputs[0].routes[0].enabled).toBe(false);
    expect(removeFromPlay(play, 'a').sources?.[0].outputs[0].routes).toEqual([]);
  });
});

describe('the file and the walker', () => {
  it('keeps sources and routes to controls of the record; renames them', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], mappings: [], controls: [ctl('a')], sources: [
      { id: 's', source: { kind: 'mouse', axis: 'x' }, outputs: [{ kind: 'value', routes: [{ id: 'r', to: 'a', mode: 'add', outMin: -1, outMax: 1, curve: 'linear', smoothMs: 9e9 }, { id: 'r2', to: 'gone', mode: 'replace', outMin: 0, outMax: 1, curve: 'linear' }] }] },
      { id: 'bad', source: { kind: 'nonsense' } },
      { id: 'free', source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 } },
    ] });
    expect(rec?.sources).toEqual([
      { id: 's', enabled: true, source: { kind: 'mouse', axis: 'x' }, outputs: [{ kind: 'value', routes: [{ id: 'r', to: 'a', mode: 'add', outMin: -1, outMax: 1, curve: 'linear', enabled: true, smoothMs: 5000 }] }] },
      { id: 'free', enabled: true, source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outputs: [{ kind: 'value', routes: [] }] },
    ]);
    const f = (_k: string, id: string) => `${id}2`;
    expect(mapSourceDef(rec!.sources![0], f)).toMatchObject({ id: 's2', outputs: [{ routes: [{ to: 'a2' }] }] });
    expect(mapValueRef('src:s', f)).toBe('src:s2');
  });
});

describe('the web runtime', () => {
  it('runs a record’s sources and routes frame for frame like the app', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [ctl('src', { min: 0, max: 1 }), ctl('a'), ctl('b')], sources: [
      lfo('s1', [route('r1', 'a', { mode: 'add', ...rtAddSwing(0, 10), smoothMs: 50 }), route('r2', 'b', { curve: 'log', delayMs: 50 })]),
    ] };
    const values = [0, 0.3, 0.9, 0.5, 0.1, 1, 1, 0.2];
    const app = drive(play, values, ['a', 'b'], { a: 4, b: 0 });
    const web = runtimeRun(play, values, ['a', 'b'], { a: 4, b: 0 });
    // The same values (each side counts time its own way: a hair of rounding apart).
    for (let i = 0; i < app.length; i++) for (let j = 0; j < 2; j++) {
      if (app[i][j] === undefined) expect(web[i][j], `frame ${i} #${j}`).toBeUndefined();
      else expect(web[i][j], `frame ${i} #${j}`).toBeCloseTo(app[i][j]!, 9);
    }
    expect(app[app.length - 1][0]).toBeGreaterThan(4);
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

function runtimeRun(play: PlayRecord, values: number[], read: string[], base: Record<string, number>) {
  const rafs: ((t: number) => void)[] = [];
  const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { set(id: string, v: number): void; get(id: string): { value: number | number[]; driven: boolean } | null } };
  const bindings = Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`]));
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, base[c.id] ?? 0]));
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: { ...play, condRanges: conditionRanges(play) }, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? (g.value as number) : undefined; });
  });
}
