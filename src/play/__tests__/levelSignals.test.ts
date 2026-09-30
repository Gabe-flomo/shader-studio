/**
 * Level signals and logic (simplification plan, phase 5): a signal is one
 * true/false value with a level, a rise and a fall; one can follow its own
 * trigger or combine others (and, or, not, xor), worked out in dependency
 * order with a loop read a frame late — in the kit, the engine, the file and
 * the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { sgLogic, sgSignalOrder } from '../kit/signals.js';
import { mapSignal } from '../playRefs';
import { layerSignalListeners } from '../pairs';
import { signalDefLabel } from '../../components/play/FullPages';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, usesHands, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

describe('the kit', () => {
  it('combines levels', () => {
    expect([sgLogic('and', [true, true]), sgLogic('and', [true, false]), sgLogic('and', [])]).toEqual([true, false, false]);
    expect([sgLogic('or', [false, true]), sgLogic('or', [])]).toEqual([true, false]);
    expect([sgLogic('not', [false]), sgLogic('not', [true]), sgLogic('not', [false, false])]).toEqual([true, false, true]);
    expect([sgLogic('xor', [true, false]), sgLogic('xor', [true, true])]).toEqual([true, false]);
  });

  it('orders combinations after what they read, and finds loops', () => {
    const s = (id: string, inputs?: string[]) => ({ id, ...(inputs ? { when: { kind: 'logic', inputs } } : {}) });
    const { order, cyclic } = sgSignalOrder([s('c', ['a', 'b']), s('a'), s('b', ['a'])]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    expect([...cyclic]).toEqual([]);
    const loop = sgSignalOrder([s('x', ['y']), s('y', ['x']), s('z')]);
    expect(new Set(loop.cyclic)).toEqual(new Set(['x', 'y']));
    expect(loop.order.sort()).toEqual(['x', 'y', 'z']);
  });
});

describe('the file', () => {
  it('keeps a definition, drops inputs that aren’t signals, and renames through the reference walker', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], controls: [], mappings: [], signals: [
      { id: 'a', name: 'A', when: { kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } } },
      { id: 'b', name: 'B', when: { kind: 'logic', op: 'or', inputs: ['a', 'gone', 'b', 'a'] } },
      { id: 'c', name: 'C', when: { kind: 'nonsense' } },
    ] });
    expect(rec?.signals).toEqual([
      { id: 'a', name: 'A', when: { kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } } },
      { id: 'b', name: 'B', when: { kind: 'logic', op: 'or', inputs: ['a'] } },
      { id: 'c', name: 'C' },
    ]);
    const moved = mapSignal(rec!.signals![1], (_k, id) => `${id}2`);
    expect(moved).toEqual({ id: 'b2', name: 'B', when: { kind: 'logic', op: 'or', inputs: ['a2'] } });
  });

  it('a combination is a listener of what it reads; hands in a definition count as using hands', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), signals: [{ id: 'a', name: 'A' }, { id: 'c', name: 'Both', when: { kind: 'logic', op: 'and', inputs: ['a'] } }] };
    expect(layerSignalListeners(play)).toEqual([{ id: 'a', label: 'Combined into Both' }]);
    expect(signalDefLabel({ kind: 'logic', op: 'and', inputs: ['a'] }, play)).toBe('All of: A');
    expect(usesHands({ ...emptyPlayRecord(), signals: [{ id: 'h', name: 'H', when: { kind: 'trigger', trigger: { on: 'hand', side: 'right', gesture: 'pinch' } } }] })).toBe(true);
  });
});

// ── The engine ───────────────────────────────────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });
const above = (value: string, threshold = 0.5): TriggerSpec => ({ on: 'value', value, cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });
const onSig = (signal: string, mode?: 'held' | 'release'): TriggerSpec => ({ on: 'signal', signal, ...(mode ? { fire: { mode, every: 1, unit: 'frames' as const } } : {}) });

/** Tick with `src` and `src2` set each frame; `read` after each. */
function drive<T>(frames: Array<[number, number]>, read: () => T, from = 1): T[] {
  let t = from;
  return frames.map(([a, b]) => { playEngine.setBaseValues(new Map([['src', a], ['src2', b]])); inputBus.tick(1 / 60, (t += 1 / 60)); return read(); });
}

describe('level signals in the engine', () => {
  const setup = (signals: PlaySignal[], actions: PlayAction[]): PlayRecord => ({ ...emptyPlayRecord(), controls: [control('src'), control('src2')], layers: [sparks()], signals, actions });

  it('a signal that follows a condition is true while it holds: rise, level and fall reach the firing modes', () => {
    playEngine.setRecord(setup([{ id: 's', name: 'High', when: { kind: 'trigger', trigger: above('ctl:src') } }], [
      act('rise', onSig('s')), act('while', onSig('s', 'held')), act('fall', onSig('s', 'release')),
    ]));
    const fired: string[][] = [];
    let now: string[] = [];
    const off = playEngine.onAction(a => now.push(a.id));
    drive([[0.2, 0], [0.8, 0], [0.9, 0], [0.7, 0], [0.1, 0], [0.2, 0]], () => { fired.push(now); now = []; return playEngine.signalLevel('s'); });
    off();
    expect(fired).toEqual([[], ['rise', 'while'], ['while'], ['while'], ['fall'], []]);
  });

  it('hover AND click: a combination of two levels, never of two one-frame pulses landing apart', () => {
    playEngine.setRecord(setup([
      { id: 'hover', name: 'Hover', when: { kind: 'trigger', trigger: above('ctl:src') } },
      { id: 'click', name: 'Click', when: { kind: 'trigger', trigger: above('ctl:src2') } },
      { id: 'both', name: 'Both', when: { kind: 'logic', op: 'and', inputs: ['hover', 'click'] } },
      { id: 'neither', name: 'Neither', when: { kind: 'logic', op: 'not', inputs: ['hover', 'click'] } },
    ], [act('grab', onSig('both'))]));
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    const levels = drive([[0, 0], [0.9, 0], [0.9, 0.9], [0.9, 0.9], [0, 0.9], [0.9, 0.9]], () => [playEngine.signalLevel('both'), playEngine.signalLevel('neither')]);
    off();
    expect(levels.map(l => l[0])).toEqual([false, false, true, true, false, true]);
    expect(levels.map(l => l[1])).toEqual([true, false, false, false, false, false]);
    expect(fired).toEqual(['grab', 'grab']);
  });

  it('a signal sent by an action is true for its frame and a combination can read it', () => {
    playEngine.setRecord(setup([
      { id: 'sent', name: 'Sent' },
      { id: 'hi', name: 'Hi', when: { kind: 'trigger', trigger: above('ctl:src') } },
      { id: 'any', name: 'Any', when: { kind: 'logic', op: 'or', inputs: ['sent', 'hi'] } },
    ], [act('send', { ...above('ctl:src2'), cmp: 'crossUp' } as TriggerSpec, { do: 'signal', layerId: '', signal: 'sent' })]));
    const levels = drive([[0, 0], [0, 0.9], [0, 0.9], [0, 0.9]], () => playEngine.signalLevel('any'));
    // Sent on frame 2 (after the levels were worked out): the combination sees it on frame 3, for one frame.
    expect(levels).toEqual([false, false, true, false]);
  });

  it('a signal that loses its definition lets go', () => {
    const rec = setup([{ id: 's', name: 'S', when: { kind: 'trigger', trigger: above('ctl:src') } }], [act('while', onSig('s', 'held'))]);
    playEngine.setRecord(rec);
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    drive([[0.9, 0], [0.9, 0]], () => 0);
    playEngine.setRecord({ ...rec, signals: [{ id: 's', name: 'S' }] });
    fired.length = 0;
    drive([[0.9, 0], [0.9, 0]], () => 0, 2);
    off();
    expect(fired).toEqual([]);
  });

  it('a loop of combinations reads a frame late and doesn’t hang', () => {
    playEngine.setRecord(setup([
      { id: 'hi', name: 'Hi', when: { kind: 'trigger', trigger: above('ctl:src') } },
      { id: 'x', name: 'X', when: { kind: 'logic', op: 'or', inputs: ['hi', 'y'] } },
      { id: 'y', name: 'Y', when: { kind: 'logic', op: 'and', inputs: ['x'] } },
    ], []));
    expect(playEngine.signalInLoop('x')).toBe(true);
    // Once on, the loop holds itself on: the classic latch.
    const levels = drive([[0, 0], [0.9, 0], [0, 0], [0, 0]], () => playEngine.signalLevel('x'));
    expect(levels).toEqual([false, true, true, true]);
  });
});

describe('the web runtime', () => {
  it('works signals out frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('src2'), control('flag'), control('flag2')], layers: [sparks()],
      signals: [
        { id: 'hover', name: 'Hover', when: { kind: 'trigger', trigger: above('ctl:src') } },
        { id: 'click', name: 'Click', when: { kind: 'trigger', trigger: above('ctl:src2') } },
        { id: 'both', name: 'Both', when: { kind: 'logic', op: 'and', inputs: ['hover', 'click'] } },
      ],
      mappings: [
        { id: 'm1', controlId: 'flag', source: { kind: 'trigger', trigger: onSig('both'), mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'flag2', source: { kind: 'trigger', trigger: onSig('hover', 'release'), mode: 'step', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    const frames: Array<[number, number]> = [[0, 0], [0.9, 0], [0.9, 0.9], [0.9, 0], [0, 0], [0.9, 0.9], [0, 0.9], [0.9, 0.9]];
    playEngine.setRecord(rec);
    const app = drive(frames, () => ['flag', 'flag2'].map(id => (playEngine.liveValue(id) as number | undefined) ?? 0));
    const web = runtimeRun(rec, frames, ['flag', 'flag2']).map(r => r.map(v => v ?? 0));
    expect(web).toEqual(app);
    expect(app[app.length - 1][0]).toBe(1);
    expect(app.some(r => r[1] > 0)).toBe(true);
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
