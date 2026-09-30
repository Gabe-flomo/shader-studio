/**
 * Timing and chance on signals, delay on mappings, and the Random front door
 * (simplification plan, phase 9): Hold for, Linger, Delay and a seeded Chance
 * per activation (sgShapeStep), a mapping's value arriving late (sgLagStep),
 * in the kit, the engine and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { sgHash01, sgLagNew, sgLagStep, sgShapeNew, sgShapeStep, sgShaped } from '../kit/signals.js';
import { RANDOM_PRESETS, miniMapperSections, wireMiniMapperPick } from '../../components/play/miniMapperCore';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

/** Step a shape over raw levels at 10 frames a second. */
function shape(raws: boolean[], o: Parameters<typeof sgShapeStep>[3]): boolean[] {
  const st = sgShapeNew();
  return raws.map((r, i) => sgShapeStep(st, r, i * 0.1, o));
}
const T = true, F = false;

describe('the kit', () => {
  it('hold for ignores what doesn’t last; linger keeps it on after', () => {
    expect(shape([T, F, T, T, T, T, F], { hold: 0.2 })).toEqual([F, F, F, F, T, T, F]);
    expect(shape([F, T, F, F, F, F], { linger: 0.25 })).toEqual([F, T, T, T, F, F]);
  });

  it('delay shifts the rise and the fall', () => {
    expect(shape([F, T, T, F, F, F, F], { delay: 0.3 })).toEqual([F, F, F, F, T, T, F]);
  });

  it('chance rolls once per activation, the same way every time for a seed', () => {
    const raws = Array.from({ length: 400 }, (_, i) => i % 4 === 1 || i % 4 === 2); // 100 activations, two frames each
    const a = shape(raws, { chance: 0.5, seed: 7 }), b = shape(raws, { chance: 0.5, seed: 7 });
    expect(a).toEqual(b);
    // Each activation goes out whole (both frames) or not at all.
    for (let i = 1; i < 400; i += 4) expect(a[i]).toBe(a[i + 1]);
    const out = a.filter((_, i) => i % 4 === 1).filter(Boolean).length;
    expect(out).toBeGreaterThan(30); expect(out).toBeLessThan(70);
    expect(shape(raws, { chance: 0.5, seed: 8 })).not.toEqual(a);
    expect(sgHash01(1, 2)).toBe(sgHash01(1, 2));
    expect(sgShaped({ chance: 1 })).toBe(false);
    expect(sgShaped({ delay: 0.1 })).toBe(true);
  });

  it('a delayed value reads between samples, nothing until it has that much, and starts over on a rewind', () => {
    const st = sgLagNew();
    expect(sgLagStep(st, 0, 0, 0.25)).toBeNull();
    expect(sgLagStep(st, 0.1, 1, 0.25)).toBeNull();
    expect(sgLagStep(st, 0.2, 2, 0.25)).toBeNull();
    expect(sgLagStep(st, 0.3, 3, 0.25)).toBeCloseTo(0.5);
    expect(sgLagStep(st, 0.4, 4, 0.25)).toBeCloseTo(1.5);
    expect(sgLagStep(st, 0.05, 9, 0.25)).toBeNull();
  });

  it('the file keeps them within their limits', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], controls: [{ id: 'c', target: 'n::c', kind: 'float', label: 'C', min: 0, max: 1 }], mappings: [{ id: 'm', controlId: 'c', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true, delayMs: 60000 }],
      signals: [{ id: 's', name: 'S', delay: 0.5, hold: 99, linger: -1, chance: 0.01, seed: 3.4 }, { id: 't', name: 'T', chance: 1 }] });
    expect(rec?.signals).toEqual([{ id: 's', name: 'S', delay: 0.5, hold: 10, chance: 0.1, seed: 3 }, { id: 't', name: 'T' }]);
    expect(rec?.mappings[0].delayMs).toBe(10000);
  });
});

describe('the Random front door', () => {
  it('offers Shake, Wander, Hop and Chaos, each the Noise source with no smoothing', () => {
    const s = miniMapperSections({ play: emptyPlayRecord(), midiDevices: [], hasCamera: false }).find(x => x.heading === 'Random');
    expect(s?.items.map(i => i.label)).toEqual(['Shake', 'Wander', 'Hop', 'Chaos']);
    const r = wireMiniMapperPick({ ...emptyPlayRecord(), controls: [{ id: 'c', target: 'n::c', kind: 'float', label: 'C', min: 0, max: 1 }] }, 'random:hop', { control: 'c' });
    expect(r.mapping).toMatchObject({ smoothMs: 0, source: { kind: 'noise', type: 'stepped', rate: 1 } });
    expect(RANDOM_PRESETS.map(p => p.type)).toEqual(['smooth', 'drift', 'stepped', 'random']);
  });
});

// ── Engine and website ───────────────────────────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const above = (value: string, threshold = 0.5): TriggerSpec => ({ on: 'value', value, cmp: 'above', threshold, hysteresis: 0, tolerance: 0.01 });
const onSig = (signal: string): TriggerSpec => ({ on: 'signal', signal });
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });
function drive<T>(values: number[], read: () => T, from = 1): T[] {
  let t = from;
  return values.map(v => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(0.1, (t += 0.1)); return read(); });
}

describe('in the engine', () => {
  it('a delayed signal sets off its reaction later; a sent signal with linger stays true', () => {
    const signals: PlaySignal[] = [
      { id: 'late', name: 'Late', when: { kind: 'trigger', trigger: above('ctl:src') }, delay: 0.3 },
      { id: 'sent', name: 'Sent', linger: 0.25 },
    ];
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], signals, actions: [
      act('go', onSig('late')), act('send', above('ctl:src'), { do: 'signal', layerId: '', signal: 'sent' }),
    ] });
    const fired: string[][] = [];
    let now: string[] = [];
    const off = playEngine.onAction(a => now.push(a.id));
    const levels = drive([0, 1, 1, 0, 0, 0, 0, 0], () => { fired.push(now); now = []; return playEngine.signalLevel('sent'); });
    off();
    // Crossed on frame 2; 0.3 s later is frame 5.
    expect(fired.map(f => f.includes('go'))).toEqual([F, F, F, F, T, F, F, F]);
    // Sent on frame 2 (after the levels were worked out): true from frame 3 for its frame and 0.25 s more.
    expect(levels).toEqual([F, F, T, T, T, F, F, F]);
  });

  it('a mapping’s delay makes it follow the leader', () => {
    // (An action that never fires keeps the engine ticking, as bound uniforms do in the app.)
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('lead'), control('trail')], layers: [sparks()], actions: [act('never', above('ctl:src', 2))], mappings: [
      { id: 'a', controlId: 'lead', source: { kind: 'control', controlId: 'src' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'b', controlId: 'trail', source: { kind: 'control', controlId: 'src' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true, delayMs: 200 },
    ] };
    playEngine.setRecord(rec);
    const got = drive([0, 0.2, 0.4, 0.6, 0.8], () => [playEngine.liveValue('lead'), playEngine.liveValue('trail')] as Array<number | undefined>);
    expect(got.map(g => g[0])).toEqual([0, 0.2, 0.4, 0.6, 0.8].map(v => expect.closeTo(v)));
    expect(got.map(g => g[1])).toEqual([undefined, undefined, expect.closeTo(0), expect.closeTo(0.2), expect.closeTo(0.4)]);
  });
});

describe('the web runtime', () => {
  it('works out timing, chance and delays frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('flag'), control('trail')], layers: [sparks()],
      signals: [{ id: 'd', name: 'D', when: { kind: 'trigger', trigger: above('ctl:src') }, hold: 0.1, linger: 0.2, delay: 0.1, chance: 0.6, seed: 11 }],
      mappings: [
        { id: 'm', controlId: 'flag', source: { kind: 'trigger', trigger: onSig('d'), mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'l', controlId: 'trail', source: { kind: 'control', controlId: 'src' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true, delayMs: 150 },
      ],
    };
    const values = Array.from({ length: 60 }, (_, i) => ((i >> 2) % 2 ? 0.9 : 0.1));
    playEngine.setRecord(rec);
    const app = drive(values, () => ['flag', 'trail'].map(id => playEngine.liveValue(id) as number | undefined));
    const web = runtimeRun(rec, values, ['flag', 'trail']);
    for (let i = 0; i < app.length; i++) for (let j = 0; j < 2; j++) {
      if (app[i][j] === undefined) expect(web[i][j], `frame ${i} #${j}`).toBeUndefined();
      else expect(web[i][j], `frame ${i} #${j}`).toBeCloseTo(app[i][j]!, 3);
    }
    expect(app.some(r => r[0] === 1)).toBe(true);
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
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: { ...play, condRanges: conditionRanges(play) }, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 100));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}
