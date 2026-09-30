/**
 * Captured values, Set and positions as values (simplification plan,
 * phase 6): a signal samples a number or a position at its rise, its fall or
 * while true; a Set mapping writes the number as it is (stay, go back, go to
 * a value); a layer moves to a captured position through the `sig:<id>`
 * anchor; one axis of a position is a value; the hand's pinch point — in the
 * kit, the engine, the file, the reference walker and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { hdCreate, hdPoint } from '../kit/hands.js';
import { sgParseValueRef } from '../kit/signals.js';
import { mapSignal, mapSource, mapAnchor } from '../playRefs';
import { anchorLabel, sourceLabel, valueRefLabel } from '../playSources';
import { layerSignalListeners } from '../pairs';
import { moveLayerToSignal, setFromSignal } from '../../components/play/signalFlow';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, parseSignalAnchor, type CaptureRelease, type PlayControl, type PlayLayer, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
const above = (value: string, threshold: number): TriggerSpec => ({ on: 'value', value, cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });
const setMap = (id: string, controlId: string, signal: string, release: CaptureRelease = 'stay', rest?: number) => ({ id, controlId, source: { kind: 'captured' as const, signal, release, ...(rest !== undefined ? { rest } : {}) }, outMin: 0, outMax: 1, curve: 'linear' as const, smoothMs: 0, enabled: true });

/** Tick with gate (`g`) and value (`v`) controls set each frame; read after each. */
function drive<T>(frames: Array<[number, number]>, read: () => T, from = 1): T[] {
  let t = from;
  return frames.map(([g, v]) => { playEngine.setBaseValues(new Map([['g', g], ['v', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); return read(); });
}

describe('the pieces', () => {
  it('the pinch point is halfway between the thumb and index tips', () => {
    const st = hdCreate();
    st.right.present = true;
    st.right.pts[12] = 0.2; st.right.pts[13] = 0.4; // thumb tip (4)
    st.right.pts[24] = 0.4; st.right.pts[25] = 0.6; // index tip (8)
    expect(hdPoint(st, 'right', 21)).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.5) });
  });

  it('one axis of a position is a value path', () => {
    expect(sgParseValueRef('ax:y:hand:right:21')).toEqual({ kind: 'axis', axis: 'y', anchor: 'hand:right:21' });
    expect(sgParseValueRef('ax:z:mouse')).toBeNull();
    playEngine.setRecord(emptyPlayRecord());
    expect(playEngine.readValue('ax:x:pt:0.3,0.7')).toBeCloseTo(0.3);
    expect(valueRefLabel('ax:y:hand:right:21')).toBe('Right · Pinch point Y');
  });

  it('the file keeps captures and Set sources; the walker renames them', () => {
    const rec = parsePlayRecord({ version: 1, layers: [defaultLayer('null', 'n', 'Dot')], mappings: [setMap('m', 'c', 's', 'value', 2)], controls: [control('c')], signals: [
      { id: 's', name: 'Pinch', capture: { what: 'pos:hand:right:21', at: 'held' } },
      { id: 't', name: 'Drop', capture: { what: 'layer:n::x', at: 'weird' } },
    ] });
    expect(rec?.signals).toEqual([{ id: 's', name: 'Pinch', capture: { what: 'pos:hand:right:21', at: 'held' } }, { id: 't', name: 'Drop', capture: { what: 'layer:n::x', at: 'rise' } }]);
    expect(rec?.mappings[0].source).toEqual({ kind: 'captured', signal: 's', release: 'value', rest: 2 });
    const f = (_k: string, id: string) => `${id}2`;
    expect(mapSignal(rec!.signals![1], f).capture).toEqual({ what: 'layer:n2::x', at: 'rise' });
    expect(mapSignal({ id: 's', name: 'S', capture: { what: 'pos:n', at: 'rise' } }, f).capture?.what).toBe('pos:n2');
    expect(mapSource(rec!.mappings[0].source, f)).toMatchObject({ signal: 's2' });
    expect(mapAnchor('sig:s:held', f)).toBe('sig:s2:held');
    expect(parseSignalAnchor('sig:abc:held')).toEqual({ id: 'abc', held: true });
    expect(anchorLabel('sig:s')).toContain('position');
  });
});

describe('Set in the engine', () => {
  const rec = (release: CaptureRelease, at: 'rise' | 'fall' | 'held' = 'rise', rest?: number): PlayRecord => ({
    ...emptyPlayRecord(), controls: [control('g', { max: 1 }), control('v'), control('out', { min: 0, max: 100 })],
    signals: [{ id: 's', name: 'Grab', when: { kind: 'trigger', trigger: above('ctl:g', 0.5) }, capture: { what: 'ctl:v', at } }],
    mappings: [setMap('m', 'out', 's', release, rest)],
  });
  const out = () => playEngine.liveValue('out') as number | undefined;

  it('writes the captured number as it is (not through the range), nothing before the first capture, and stays', () => {
    playEngine.setRecord(rec('stay'));
    expect(drive([[0, 3], [1, 3.2], [1, 7], [0, 9], [0, 1]], out)).toEqual([undefined, 3.2, 3.2, 3.2, 3.2]);
    expect(layerSignalListeners(rec('stay'))).toEqual([{ id: 's', label: 'Sets out' }]);
    expect(sourceLabel(rec('back').mappings[0].source)).toContain(', then back');
  });

  it('go back lets the control go when the signal is false; go to rests on a value', () => {
    playEngine.setRecord(rec('back'));
    expect(drive([[1, 4], [1, 5], [0, 5]], out)).toEqual([4, 4, undefined]);
    // Starting earlier on the clock is a rewind: the last capture is forgotten.
    playEngine.setRecord(rec('value', 'rise', 50));
    expect(drive([[0, 4], [1, 6], [0, 6]], out, 0.5)).toEqual([undefined, 6, 50]);
  });

  it('while true follows the value; at the fall takes the value it had then', () => {
    playEngine.setRecord(rec('stay', 'held'));
    expect(drive([[1, 1], [1, 2], [1, 3], [0, 8]], out)).toEqual([1, 2, 3, 3]);
    playEngine.setRecord(rec('stay', 'fall'));
    expect(drive([[1, 1], [1, 2], [0, 6], [0, 7]], out, 0.5)).toEqual([undefined, undefined, 6, 6]);
  });

  it('a rewind forgets the capture', () => {
    playEngine.setRecord(rec('stay'));
    drive([[1, 4]], out, 5);
    expect(playEngine.signalPayload('s')).toBe(4);
    drive([[0, 1]], out, 1);
    expect(playEngine.signalPayload('s')).toBeUndefined();
  });

  it('setFromSignal wires a jumping Set onto a control', () => {
    const r = setFromSignal({ ...emptyPlayRecord(), controls: [control('c')] }, 's', { control: 'c' });
    expect(r.play.mappings[0]).toMatchObject({ controlId: 'c', smoothMs: 0, source: { kind: 'captured', signal: 's', release: 'stay' } });
  });
});

describe('positions', () => {
  it('a layer jumps to a captured position and stays', () => {
    const dot = { ...defaultLayer('null', 'dot', 'Dot'), x: 0.5, y: 0.5 } as PlayLayer;
    const signals: PlaySignal[] = [{ id: 's', name: 'Tap', when: { kind: 'trigger', trigger: above('ctl:g', 0.5) }, capture: { what: 'pos:pt:0.2,0.8', at: 'rise' } }];
    const moved = moveLayerToSignal({ ...emptyPlayRecord(), controls: [control('g', { max: 1 })], layers: [dot], signals }, 'dot', 's');
    expect(moved.ok).toBe(true);
    playEngine.setRecord(moved.play);
    const pair = moved.play.pairs![0];
    const xy = () => [pair.a, pair.b].map(id => playEngine.liveValue(id) as number | undefined);
    const got = drive([[0, 0], [1, 0], [0, 0]], xy);
    expect(got[0]).toEqual([undefined, undefined]);
    expect(got[1][0]).toBeCloseTo(0.2); expect(got[1][1]).toBeCloseTo(0.8);
    expect(got[2][0]).toBeCloseTo(0.2);
    expect(layerSignalListeners(moved.play).map(l => l.label)).toEqual([expect.stringMatching(/^Moves .* to its position$/)]);
  });
});

describe('the web runtime', () => {
  it('captures and sets frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('g', { max: 1 }), control('v'), control('a', { max: 100 }), control('b', { max: 100 })],
      signals: [
        { id: 's', name: 'Grab', when: { kind: 'trigger', trigger: above('ctl:g', 0.5) }, capture: { what: 'ctl:v', at: 'rise' } },
        { id: 'h', name: 'Hold', when: { kind: 'trigger', trigger: above('ctl:g', 0.5) }, capture: { what: 'ctl:v', at: 'held' } },
      ],
      mappings: [setMap('m1', 'a', 's', 'stay'), setMap('m2', 'b', 'h', 'value', 42)],
    };
    const frames: Array<[number, number]> = [[0, 1], [1, 2], [1, 3], [0, 4], [1, 5], [0, 6]];
    playEngine.setRecord(rec);
    const app = drive(frames, () => ['a', 'b'].map(id => playEngine.liveValue(id) as number | undefined));
    const web = runtimeRun(rec, frames, ['a', 'b']);
    expect(web).toEqual(app);
    expect(app[app.length - 1]).toEqual([5, 42]);
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
  return frames.map(([g, v]) => {
    h.set('g', g); h.set('v', v);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const x = h.get(id); return x?.driven ? x.value : undefined; });
  });
}
