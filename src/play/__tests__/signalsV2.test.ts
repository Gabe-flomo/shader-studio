/**
 * Signals as rules (implementation guide, phase 2): a signal's inputs — a
 * trigger, or another signal mirrored or taken on its rise or fall after a
 * delay — combined any / all / none / one, and its reactions; the older shape
 * normalised into rules — in the kit, the engine, the file and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { sgPulseLinks, sgReactions, sgSignalPlan } from '../kit/signals.js';
import { mapSignal } from '../playRefs';
import { normalizeRules } from '../rules';
import { playEngine } from '../../lib/playEngine';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { inputBus } from '../../lib/inputBus';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayAction, type PlayControl, type PlayLayer, type PlayReaction, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const control = (id: string): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1 });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const above = (value: string, threshold = 0.5): TriggerSpec => ({ on: 'value', value, cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });
const react = (id: string, over: Partial<PlayReaction> = {}): PlayReaction => ({ id, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });
const setup = (signals: PlaySignal[], actions: PlayAction[] = []): PlayRecord => ({ ...emptyPlayRecord(), controls: [control('src'), control('src2')], layers: [sparks()], signals, actions });
const hi: PlaySignal = { id: 'hi', name: 'Hi', inputs: [{ kind: 'trigger', trigger: above('ctl:src') }] };
const hi2: PlaySignal = { id: 'hi2', name: 'Hi2', inputs: [{ kind: 'trigger', trigger: above('ctl:src2') }] };

function drive<T>(frames: Array<[number, number]>, read: () => T): T[] {
  let t = 1;
  return frames.map(([a, b]) => { playEngine.setBaseValues(new Map([['src', a], ['src2', b]])); inputBus.tick(1 / 60, (t += 1 / 60)); return read(); });
}

describe('the kit', () => {
  it('plans levels from inputs (or the older when), and turns rise/fall inputs into links and reactions into actions', () => {
    const sigs: PlaySignal[] = ([
      hi,
      { id: 'b', inputs: [{ kind: 'signal', signal: 'hi', as: 'mirror' }, { kind: 'signal', signal: 'hi2', as: 'mirror' }], combine: 'one' },
      { id: 'c', inputs: [{ kind: 'signal', signal: 'hi', as: 'fall', delay: 0.5 }], do: [react('r', { fire: { mode: 'held', every: 1, unit: 'frames' } })] },
      { id: 'd', when: { kind: 'logic', op: 'and', inputs: ['hi', 'b'] } },
    ] as unknown[]) as PlaySignal[];
    const plan = sgSignalPlan(sigs);
    expect(plan.map(p => [p.id, p.op, p.level.length])).toEqual([['hi', 'or', 1], ['b', 'xor', 2], ['c', 'or', 0], ['d', 'and', 2]]);
    expect(sgPulseLinks(sigs).find(s => s.id === 'hi')?.links).toEqual([{ to: 'c', delay: 0.5, on: 'fall' }]);
    expect(sgReactions(sigs)).toEqual([{ id: 'r', do: 'burst', layerId: 'p', amount: 1, enabled: true, trigger: { on: 'signal', signal: 'c', fire: { mode: 'held', every: 1, unit: 'frames' } } }]);
  });
});

describe('the file', () => {
  it('keeps inputs and reactions, drops what points nowhere, renames through the walker', () => {
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [sparks()], signals: [
      { id: 'a', name: 'A', inputs: [{ kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } }, { kind: 'trigger', trigger: { on: 'nonsense' } }], combine: 'all',
        do: [react('r1'), react('r2', { layerId: 'gone' })] },
      { id: 'b', name: 'B', inputs: [{ kind: 'signal', signal: 'a', as: 'rise', delay: 0.25 }, { kind: 'signal', signal: 'gone', as: 'mirror' }], combine: 'weird' },
    ] });
    expect(rec?.signals).toEqual([
      { id: 'a', name: 'A', inputs: [{ kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } }], combine: 'all', do: [react('r1')] },
      { id: 'b', name: 'B', inputs: [{ kind: 'signal', signal: 'a', as: 'rise', delay: 0.25 }] },
    ]);
    const moved = mapSignal(rec!.signals![1], (_k, id) => `${id}2`);
    expect(moved.inputs).toEqual([{ kind: 'signal', signal: 'a2', as: 'rise', delay: 0.25 }]);
  });
});

describe('rules in the engine', () => {
  it('combines inputs any / all / none / one', () => {
    playEngine.setRecord(setup([hi, hi2, ...(['any', 'all', 'none', 'one'] as const).map(c => ({ id: c, name: c, combine: c, inputs: [{ kind: 'signal' as const, signal: 'hi', as: 'mirror' as const }, { kind: 'signal' as const, signal: 'hi2', as: 'mirror' as const }] }))]));
    const got = drive([[0, 0], [0.9, 0], [0.9, 0.9], [0, 0.9]], () => ['any', 'all', 'none', 'one'].map(id => playEngine.signalLevel(id)));
    expect(got).toEqual([[false, false, true, false], [true, false, false, true], [true, true, false, false], [true, false, false, true]]);
  });

  it('a rise or fall input arrives after its delay; reactions run with their firing modes', () => {
    playEngine.setRecord(setup([
      { ...hi, do: [react('up'), react('while', { fire: { mode: 'held', every: 1, unit: 'frames' } })] },
      { id: 'late', name: 'Late', inputs: [{ kind: 'signal', signal: 'hi', as: 'fall', delay: 2 / 60 }], do: [react('fell')] },
    ]));
    const fired: string[][] = [];
    let now: string[] = [];
    const off = playEngine.onAction(a => now.push(a.id));
    drive([[0, 0], [0.9, 0], [0.9, 0], [0, 0], [0, 0], [0, 0], [0, 0]], () => { fired.push(now); now = []; return 0; });
    off();
    expect(fired.slice(0, 4)).toEqual([[], ['up', 'while'], ['while'], []]);
    expect(fired.slice(4).flat()).toEqual(['fell']);
  });

  it('a signal with only reactions still listens to what fires it', () => {
    playEngine.setRecord(setup([{ id: 'rule_1', name: 'When high', inputs: [{ kind: 'trigger', trigger: { ...above('ctl:src'), cmp: 'crossUp' } as TriggerSpec }], do: [react('a'), react('b', { amount: 3 })] }]));
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(`${a.id}${a.amount}`));
    drive([[0, 0], [0.9, 0], [0.9, 0], [0, 0], [0.9, 0]], () => 0);
    off();
    expect(fired).toEqual(['a1', 'b3', 'a1', 'b3']);
  });
});

describe('the older shape as rules', () => {
  it('merges actions with the same trigger into one rule, moves actions on a signal into its reactions, turns links into inputs', () => {
    const key: TriggerSpec = { on: 'key', code: 'KeyA' };
    const play = setup([
      { id: 's', name: 'S', when: { kind: 'logic', op: 'not', inputs: ['t'] }, links: [{ to: 't', delay: 0.5, on: 'fall' }] },
      { id: 't', name: 'T' },
    ], [
      { id: 'a1', trigger: key, do: 'burst', layerId: 'p', amount: 1, enabled: true },
      { id: 'a2', trigger: { ...key, fire: { mode: 'held', every: 2, unit: 'frames' } }, do: 'burst', layerId: 'p', amount: 2, enabled: true },
      { id: 'a3', trigger: { on: 'signal', signal: 's' }, do: 'burst', layerId: 'p', amount: 3, enabled: true },
    ]);
    const out = normalizeRules(play);
    expect(out.actions).toBeUndefined();
    expect(out.signals).toEqual([
      { id: 's', name: 'S', inputs: [{ kind: 'signal', signal: 't', as: 'mirror' }], combine: 'none', do: [react('a3', { amount: 3 })] },
      { id: 't', name: 'T', inputs: [{ kind: 'signal', signal: 's', as: 'fall', delay: 0.5 }] },
      { id: 'rule_1', name: expect.stringMatching(/^When /), inputs: [{ kind: 'trigger', trigger: key }], do: [react('a1'), react('a2', { amount: 2, fire: { mode: 'held', every: 2, unit: 'frames' } })] },
    ]);
    expect(normalizeRules(out)).toEqual(out);
  });
});

describe('the web runtime', () => {
  it('works rules out frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...setup([hi, hi2,
        { id: 'one', name: 'One', combine: 'one', inputs: [{ kind: 'signal', signal: 'hi', as: 'mirror' }, { kind: 'signal', signal: 'hi2', as: 'mirror' }] },
        { id: 'late', name: 'Late', inputs: [{ kind: 'signal', signal: 'hi', as: 'rise', delay: 1 / 30 }] },
      ]),
      controls: [control('src'), control('src2'), control('flag'), control('flag2')],
      mappings: [
        { id: 'm1', controlId: 'flag', source: { kind: 'trigger', trigger: { on: 'signal', signal: 'one' }, mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'flag2', source: { kind: 'trigger', trigger: { on: 'signal', signal: 'late' }, mode: 'step', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    const frames: Array<[number, number]> = [[0, 0], [0.9, 0], [0.9, 0.9], [0, 0.9], [0, 0], [0.9, 0], [0.9, 0], [0, 0], [0, 0]];
    playEngine.setRecord(rec);
    const app = drive(frames, () => ['flag', 'flag2'].map(id => (playEngine.liveValue(id) as number | undefined) ?? 0));
    const web = runtimeRun(rec, frames, ['flag', 'flag2']).map(r => r.map(v => v ?? 0));
    expect(web).toEqual(app);
    expect(app.some(r => r[0] > 0)).toBe(true);
    expect(app[app.length - 1][1]).toBeGreaterThan(0);
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
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, 0]));
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: { ...play, condRanges: conditionRanges(play) }, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return frames.map(([a, b]) => {
    h.set('src', a); h.set('src2', b);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}
