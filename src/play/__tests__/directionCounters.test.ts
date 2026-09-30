/**
 * Direction and counters (simplification plan, phase 4): rising, falling,
 * changing and steady from a fast average against a slow one (one noise
 * dial, frame-rate independent), and triggers that count (every Nth, N
 * within T seconds on the setup's clock) — in the kit, the engine and the
 * web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { sgCondNew, sgCondRewind, sgCondStep, sgDirGate, sgDirStep } from '../kit/signals.js';
import { newFireState, stepFire } from '../triggers';
import { conditionLabel, fireLabel, ordinal } from '../playSources';
import { conditionRanges } from '../conditionRange';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type CondCmp, type FireSpec, type PlayAction, type PlayControl, type PlayLayer, type PlayRecord, type TriggerSpec, type ValueCondition } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const dir = (cmp: CondCmp, over: Partial<ValueCondition> = {}): ValueCondition => ({ value: 'ctl:src', cmp, threshold: 0.01, hysteresis: 0.005, tolerance: 0, window: 0.5, noise: 0.3, ...over });
/** Run a condition over a function of time at `fps`, returning whether it is met at each frame. */
function run(c: ValueCondition, f: (t: number) => number, seconds: number, fps: number): boolean[] {
  const st = sgCondNew(), dt = 1 / fps, out: boolean[] = [];
  for (let i = 0; i <= Math.round(seconds * fps); i++) { sgCondStep(st, f(i * dt), c, null, dt); out.push(st.open); }
  return out;
}
const firstAt = (xs: boolean[], fps: number) => { const i = xs.indexOf(true); return i < 0 ? Infinity : i / fps; };

describe('direction', () => {
  it('a ramp up is rising and not falling; a flat value is steady', () => {
    const ramp = (t: number) => (t < 1 ? 0 : t - 1);
    const rising = run(dir('rising'), ramp, 3, 60);
    expect(rising.slice(0, 55).some(Boolean)).toBe(false);
    expect(rising[rising.length - 1]).toBe(true);
    expect(run(dir('falling'), ramp, 3, 60).some(Boolean)).toBe(false);
    expect(run(dir('steady'), () => 0.4, 1, 60).every(Boolean)).toBe(true);
  });

  it('falls back to steady once the value stops, and changing ends', () => {
    const stop = (t: number) => Math.min(t, 1);
    const changing = run(dir('changing'), stop, 4, 60);
    expect(changing[60]).toBe(true);
    expect(changing[changing.length - 1]).toBe(false);
  });

  it('does not depend on the frame rate', () => {
    const ramp = (t: number) => (t < 0.5 ? 0 : (t - 0.5) * 0.2);
    const at30 = firstAt(run(dir('rising'), ramp, 2, 30), 30), at120 = firstAt(run(dir('rising'), ramp, 2, 120), 120);
    expect(Math.abs(at30 - at120)).toBeLessThan(0.05);
  });

  it('the noise dial rejects jitter: fewer flips with more filtering', () => {
    // A slow rise with jitter bigger than the rise per frame.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const samples = Array.from({ length: 600 }, (_, i) => i * 0.0005 + rnd() * 0.02);
    const flips = (noise: number) => {
      const xs = run(dir('rising', { noise, threshold: 0.002, hysteresis: 0.001 }), t => samples[Math.min(599, Math.round(t * 60))], 10, 60);
      let n = 0; for (let i = 1; i < xs.length; i++) if (xs[i] !== xs[i - 1]) n++;
      return n;
    };
    expect(flips(0.9)).toBeLessThan(flips(0));
  });

  it('holds while the clock is paused, and starts over on a rewind', () => {
    const st = sgCondNew();
    sgDirStep(st, 0, 0.5, 0.3, 1 / 60);
    sgDirStep(st, 1, 0.5, 0.3, 1 / 60);
    const before = st.fast;
    expect(sgDirStep(st, 5, 0.5, 0.3, 0)).toBe(before - st.slow);
    sgCondRewind(st);
    expect(Number.isNaN(st.fast)).toBe(true);
    expect(sgDirGate(false, 0.02, 'falling', 0.01, 0)).toBe(false);
    expect(sgDirGate(true, 0.004, 'rising', 0.01, 0.005)).toBe(false);
    expect(sgDirGate(true, 0.006, 'rising', 0.01, 0.005)).toBe(true);
  });

  it('reads and saves its window and noise, and says what it means', () => {
    const t = { on: 'value', ...dir('rising', { window: 2, noise: 1.5 }) };
    const rec = parsePlayRecord({ version: 1, layers: [defaultLayer('particles', 'p', 'P')], controls: [], mappings: [], actions: [{ id: 'a', trigger: t, do: 'burst', layerId: 'p', amount: 1, enabled: true }] });
    expect(rec?.actions?.[0].trigger).toMatchObject({ cmp: 'rising', window: 2, noise: 1 });
    expect(conditionLabel(dir('falling'), { controls: [{ id: 'src', label: 'Radius' }] })).toBe('Radius is falling');
  });
});

describe('counters', () => {
  const fire = (mode: FireSpec['mode'], every: number, window?: number): FireSpec => ({ mode, every, unit: mode === 'within' ? 'seconds' : 'frames', ...(window ? { window } : {}) });

  it('every Nth fires on the 4th, the 8th…', () => {
    const st = newFireState();
    let presses = 0;
    const out = Array.from({ length: 9 }, () => stepFire(st, fire('nth', 4), ++presses, false, 1 / 60));
    expect(out).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    // Several presses in one frame count every one.
    expect(stepFire(st, fire('nth', 4), presses + 7, false, 1 / 60)).toBe(2);
  });

  it('N within T fires when the presses land close enough, then needs fresh ones', () => {
    const st = newFireState();
    const at = (presses: number, now: number) => stepFire(st, fire('within', 3, 1), presses, false, 1 / 60, now);
    expect([at(1, 0), at(2, 0.4), at(3, 0.9)]).toEqual([0, 0, 1]);
    expect([at(4, 1.0), at(5, 1.2)]).toEqual([0, 0]);
    // Too slow: the first of the three is more than a second before the last.
    expect([at(6, 3), at(7, 3.6), at(8, 4.2)]).toEqual([0, 0, 0]);
    // The clock went back (a rewind): what was counted is forgotten.
    expect([at(9, 0.1), at(10, 0.2), at(11, 0.3)]).toEqual([0, 0, 1]);
    expect(fireLabel({ on: 'key', code: 'Space', fire: fire('within', 3, 1) })).toBe('3 times within 1 s');
    expect(fireLabel({ on: 'key', code: 'Space', fire: fire('nth', 2) })).toBe('Every 2nd time');
    expect([ordinal(1), ordinal(3), ordinal(11), ordinal(22)]).toEqual(['1st', '3rd', '11th', '22nd']);
  });

  it('are kept in the file with their defaults clamped', () => {
    const rec = parsePlayRecord({ version: 1, layers: [defaultLayer('particles', 'p', 'P')], controls: [], mappings: [], actions: [
      { id: 'a', trigger: { on: 'key', code: 'Space', fire: { mode: 'nth', every: 1 } }, do: 'burst', layerId: 'p', amount: 1, enabled: true },
      { id: 'b', trigger: { on: 'key', code: 'Space', fire: { mode: 'within', every: 3, window: 500 } }, do: 'burst', layerId: 'p', amount: 1, enabled: true },
    ] });
    expect(rec?.actions?.map(a => a.trigger.fire)).toEqual([{ mode: 'nth', every: 2, unit: 'frames' }, { mode: 'within', every: 3, unit: 'seconds', window: 60 }]);
  });
});

// ── The engine and the website ───────────────────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'burst', layerId: 'p', amount: 1, enabled: true, ...over });
const toggleOn = (trigger: TriggerSpec) => ({ id: 'mt', controlId: 'flag', source: { kind: 'trigger' as const, trigger, mode: 'toggle' as const, attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear' as const, smoothMs: 0, enabled: true });

function drive<T>(values: number[], read: () => T, from = 1): T[] {
  let t = from;
  return values.map(v => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); return read(); });
}

describe('in the engine', () => {
  it('a rising condition fires an action as the value starts to climb, and not while it is flat', () => {
    const rising: TriggerSpec = { on: 'value', ...dir('rising', { threshold: 0.005, hysteresis: 0.002 }) };
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], actions: [act('up', rising)] });
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    const values = [...Array(30).fill(0.2), ...Array.from({ length: 30 }, (_, i) => 0.2 + i * 0.01)];
    const open = drive(values, () => playEngine.conditionOpen(rising));
    off();
    expect(open.slice(0, 30).some(Boolean)).toBe(false);
    expect(open[open.length - 1]).toBe(true);
    expect(fired).toEqual(['up']);
  });

  it('N within T on a chained signal times the presses by the setup’s clock', () => {
    // Every frame: the value is above, which sends S; the action on S wants 3 within 0.05 s (three frames take 0.033 s).
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], signals: [{ id: 's', name: 'S' }],
      actions: [
        act('count', { on: 'signal', signal: 's', fire: { mode: 'within', every: 3, unit: 'seconds', window: 0.05 } }),
        act('send', { on: 'value', ...dir('above', { threshold: 0.5, hysteresis: 0 }), fire: { mode: 'held', every: 1, unit: 'frames' } }, { do: 'signal', layerId: '', signal: 's' }),
      ],
    };
    playEngine.setRecord(rec);
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(a.id));
    drive(Array(10).fill(0.9), () => 0);
    off();
    // Frames 1–3, 4–6, 7–9: three fires in ten frames, each needing three fresh signals.
    expect(fired).toEqual(['count', 'count', 'count']);
  });
});

describe('the web runtime', () => {
  it('matches the app on a falling condition and an every-Nth counter', () => {
    const falling: TriggerSpec = { on: 'value', ...dir('falling', { threshold: 0.004, hysteresis: 0.002 }) };
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('flag'), control('flag2')], layers: [sparks()],
      mappings: [toggleOn({ ...falling }), { ...toggleOn({ on: 'value', ...dir('crossUp', { threshold: 0.5, hysteresis: 0.05 }), fire: { mode: 'nth', every: 2, unit: 'frames' } }), id: 'mt2', controlId: 'flag2' }],
    };
    const values = [...Array(20).fill(0.8), ...Array.from({ length: 25 }, (_, i) => 0.8 - i * 0.02), 0.2, 0.7, 0.2, 0.7, 0.2, 0.7];
    playEngine.setRecord(rec);
    const app = drive(values, () => ['flag', 'flag2'].map(id => playEngine.liveValue(id) as number | undefined));
    const web = runtimeRun(rec, values, ['flag', 'flag2']);
    for (let i = 0; i < app.length; i++) for (let j = 0; j < 2; j++) expect(web[i][j] ?? 0, `frame ${i} #${j}`).toBeCloseTo(app[i][j] ?? 0, 3);
    expect(app.some(r => (r[0] ?? 0) >= 0.5)).toBe(true);
    expect(app[app.length - 1][1]).toBe(1);
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
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}
