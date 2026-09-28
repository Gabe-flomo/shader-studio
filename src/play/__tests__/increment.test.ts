/**
 * Increment mappings (docs/increment-mapping.md): the kit's step logic
 * (play/kit/increment.js), the Play engine running it with its signals, the
 * file format, and the web runtime stepping frame for frame like the app.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The graph store reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { incAdvance, incFold, incGlide, incNew, incRepeat, incStepSize, incThreshold, type IncSpec } from '../kit/increment.js';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { incrementSummary } from '../incrementUi';
import { playableForPlan } from '../planGates';
import { defaultIncrement, emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayIncrement, type PlayMapping, type PlayRecord } from '../../types/play';

afterEach(() => {
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
});

const spec = (over: Partial<PlayIncrement> = {}): IncSpec => ({ ...defaultIncrement(0.5), ...over });

/** Take `n` increments one at a time from `start` in lo..hi, listing the value (glide off) after each. */
function walk(inc: IncSpec, n: number, start = 0, lo = -1e6, hi = 1e6): number[] {
  const st = incNew(start);
  const out: number[] = [];
  for (let i = 0; i < n; i++) { incAdvance(st, inc, lo, hi, 1); out.push(+incGlide(st, inc, lo, hi, 1 / 60).toFixed(6)); }
  return out;
}

// ── Growth ───────────────────────────────────────────────────────────────────

describe('growth modes', () => {
  it('constant adds the step every time', () => {
    expect(walk(spec({ step: 0.5 }), 4)).toEqual([0.5, 1, 1.5, 2]);
  });

  it('compound multiplies the step by the factor each time', () => {
    expect([0, 1, 2, 3].map(n => incStepSize(spec({ growth: 'compound', step: 0.5, factor: 2 }), n, 0))).toEqual([0.5, 1, 2, 4]);
    expect(walk(spec({ growth: 'compound', step: 0.5, factor: 2 }), 4)).toEqual([0.5, 1.5, 3.5, 7.5]);
  });

  it('additive grows the step by the factor each time', () => {
    expect([0, 1, 2].map(n => incStepSize(spec({ growth: 'additive', step: 2, factor: 1 }), n, 0))).toEqual([2, 3, 4]);
    expect(walk(spec({ growth: 'additive', step: 2, factor: 1 }), 3)).toEqual([2, 5, 9]);
  });

  it('proportional steps a percentage of the value, with a minimum step to leave zero', () => {
    const inc = spec({ growth: 'proportional', step: 50, minStep: 1 });
    expect(walk(inc, 4)).toEqual([1, 2, 3, 4.5]);
    expect(walk(inc, 2, 8)).toEqual([12, 18]);
  });

  it('direction − steps down', () => {
    expect(walk(spec({ step: 0.25, direction: -1 }), 3, 1)).toEqual([0.75, 0.5, 0.25]);
  });

  it('a runaway compound step stays a number', () => {
    expect(Number.isFinite(incStepSize(spec({ growth: 'compound', step: 1, factor: 10 }), 400, 0))).toBe(true);
  });
});

// ── Limits ───────────────────────────────────────────────────────────────────

describe('limits', () => {
  it('clamp stops at the edge', () => {
    expect(walk(spec({ step: 0.4, limit: 'clamp' }), 4, 0, 0, 1)).toEqual([0.4, 0.8, 1, 1]);
  });

  it('wrap comes round the other side (the top is the bottom again)', () => {
    expect(walk(spec({ step: 0.4, limit: 'wrap' }), 4, 0, 0, 1)).toEqual([0.4, 0.8, 0.2, 0.6]);
    expect(walk(spec({ step: 0.25, limit: 'wrap' }), 4, 0, 0, 1)).toEqual([0.25, 0.5, 0.75, 0]);
  });

  it('bounce turns back at the edges', () => {
    expect(walk(spec({ step: 0.4, limit: 'bounce' }), 6, 0, 0, 1)).toEqual([0.4, 0.8, 0.8, 0.4, 0, 0.4]);
  });

  it('folding is exact at the edges', () => {
    expect(incFold(1, 0, 1, 'bounce')).toBe(1);
    expect(incFold(-0.25, 0, 1, 'wrap')).toBe(0.75);
    expect(incFold(5, 2, 2, 'wrap')).toBe(2);
  });
});

// ── Wrap back ────────────────────────────────────────────────────────────────

describe('wrap back after K', () => {
  it('snap: the increment after K returns to the start and restarts the growth', () => {
    const inc = spec({ growth: 'compound', step: 1, factor: 2, wrapAfter: 3, wrapBack: 'snap' });
    expect(walk(inc, 8)).toEqual([1, 3, 7, 0, 1, 3, 7, 0]);
    const st = incNew(0);
    expect(incAdvance(st, inc, -10, 10, 4)).toEqual(['step', 'step', 'step', 'reset']);
  });

  it('ping-pong walks back to the start in as many steps', () => {
    const inc = spec({ step: 1, wrapAfter: 3, wrapBack: 'pingpong' });
    expect(walk(inc, 8)).toEqual([1, 2, 3, 2, 1, 0, 1, 2]);
  });

  it('K = 0 never wraps back', () => {
    expect(walk(spec({ step: 1, wrapAfter: 0 }), 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('glide slides each step over its time instead of jumping', () => {
    const inc = spec({ step: 1, glideMs: 100, glideCurve: 'linear' });
    const st = incNew(0);
    incAdvance(st, inc, 0, 10, 1);
    const vs = Array.from({ length: 4 }, () => +incGlide(st, inc, 0, 10, 0.05).toFixed(3));
    expect(vs).toEqual([0.5, 1, 1, 1]);
    // Two steps at once slide on together from where it is.
    incAdvance(st, inc, 0, 10, 1);
    incAdvance(st, inc, 0, 10, 1);
    expect(+incGlide(st, inc, 0, 10, 0.05).toFixed(3)).toBe(2);
    // A step mid-glide slides on from where the glide had got to.
    incAdvance(st, inc, 0, 10, 1);
    expect(+incGlide(st, inc, 0, 10, 0.05).toFixed(3)).toBe(3);
  });

  it('a glide across a wrap goes through the edge, not back across the range', () => {
    const inc = spec({ step: 0.4, limit: 'wrap', glideMs: 100, glideCurve: 'linear' });
    const st = incNew(0.8);
    incAdvance(st, inc, 0, 1, 1);
    expect(+incGlide(st, inc, 0, 1, 0.05).toFixed(3)).toBe(0);
    expect(+incGlide(st, inc, 0, 1, 0.05).toFixed(3)).toBe(0.2);
  });
});

// ── Triggers ─────────────────────────────────────────────────────────────────

describe('threshold and repeat', () => {
  it('fires on the rising edge, re-arms only below threshold − hysteresis', () => {
    const inc = spec({ threshold: 0.5, hysteresis: 0.1 });
    const st = incNew(0);
    const fires = [0.2, 0.55, 0.45, 0.6, 0.41, 0.52, 0.39, 0.7].map(v => incThreshold(st, v, inc));
    expect(fires).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
  });

  it('a value already over it when it starts doesn’t fire; a missing one changes nothing', () => {
    const st = incNew(0);
    expect([0.8, null, 0.9, 0.3, 0.8].map(v => incThreshold(st, v, spec({ threshold: 0.5, hysteresis: 0.1 })))).toEqual([0, 0, 0, 0, 1]);
  });

  it('also on the falling edge', () => {
    const st = incNew(0);
    expect([0.2, 0.6, 0.45, 0.3, 0.6].map(v => incThreshold(st, v, spec({ threshold: 0.5, hysteresis: 0.1, falling: true })))).toEqual([0, 1, 0, 1, 1]);
  });

  it('repeat ticks every N seconds or beats on the clock, only while allowed', () => {
    const st = incNew(0);
    const inc = spec({ every: 1, unit: 'beats', bpm: 120 });
    const times = [0, 0.2, 0.49, 0.5, 0.9, 1.0, 1.6];
    expect(times.map(t => incRepeat(st, t, inc, true))).toEqual([0, 0, 0, 1, 0, 1, 1]);
    const st2 = incNew(0);
    expect([0, 1, 2, 3].map(t => incRepeat(st2, t, spec({ every: 1, unit: 'seconds' }), t !== 2))).toEqual([0, 1, 0, 1]);
  });
});

describe('determinism', () => {
  it('the same inputs step the same way twice', () => {
    const inc = spec({ growth: 'compound', step: 0.1, factor: 1.5, limit: 'bounce', glideMs: 80, wrapAfter: 5, wrapBack: 'glide', every: 0.25, unit: 'seconds' });
    const run = () => {
      const st = incNew(0.2), out: number[] = [];
      for (let f = 0, t = 0; f < 300; f++, t += 1 / 60) { incAdvance(st, inc, 0, 1, incRepeat(st, t, inc, true)); out.push(incGlide(st, inc, 0, 1, 1 / 60)); }
      return out;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a.map(v => v.toFixed(3))).size).toBeGreaterThan(10);
  });
});

// ── Through the engine ───────────────────────────────────────────────────────

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const mapping = (id: string, controlId: string, increment: PlayIncrement, over: Partial<PlayMapping> = {}): PlayMapping => ({
  id, controlId, source: { kind: 'control', controlId: 'src' }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true, increment, ...over,
});

function drive<T>(frames: number, read: () => T, src: (i: number) => number = () => 0, from = 1): T[] {
  let t = from;
  return Array.from({ length: frames }, (_, i) => {
    playEngine.setBaseValues(new Map([['src', src(i)], ['out', 1]]));
    inputBus.tick(1 / 60, (t += 1 / 60));
    return read();
  });
}

describe('increments in the engine', () => {
  it('a repeat steps the control from its value, and its step and reset signals chain another increment', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(),
      controls: [control('src'), control('out', { max: 10 }), control('count', { max: 10 })],
      signals: [{ id: 'step', name: 'out.step' }, { id: 'reset', name: 'out.reset' }],
      mappings: [
        mapping('a', 'out', { ...defaultIncrement(1), every: 0.25, unit: 'seconds', wrapAfter: 3, stepSignal: 'step', resetSignal: 'reset' }),
        mapping('b', 'count', { ...defaultIncrement(1), on: 'trigger', trigger: { on: 'signal', signal: 'step' }, start: 'value', startValue: 0, resetOn: 'reset' }),
      ],
    };
    playEngine.setRecord(rec);
    const out = drive(80, () => [playEngine.liveValue('out'), playEngine.liveValue('count')] as number[]);
    const outs = out.map(o => o[0]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    // From its slider's 1: 2, 3, 4, then back to 1, then 2 again.
    expect(outs).toEqual([1, 2, 3, 4, 1, 2]);
    expect(out.some(o => o[0] === 1 && o[1] === 0)).toBe(true);
    // The chained counter counted the steps and went back to 0 on the reset.
    expect(Math.max(...out.map(o => o[1]))).toBe(3);
    expect(playEngine.incrementNow('a')?.count).toBe(4);
    playEngine.resetIncrement('a');
    expect(playEngine.incrementNow('a')?.count).toBe(0);
  });

  it('a threshold on the source steps once per rise, and a rewind starts it over', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('out', { max: 10 })], mappings: [mapping('a', 'out', { ...defaultIncrement(2), on: 'threshold', threshold: 0.5, hysteresis: 0.1, start: 'value', startValue: 0 })] };
    playEngine.setRecord(rec);
    const vs = [0.2, 0.6, 0.45, 0.7, 0.2, 0.8, 0.9];
    const a = drive(vs.length, () => playEngine.liveValue('out'), i => vs[i], 5);
    expect(a).toEqual([0, 2, 2, 2, 2, 4, 4]);
    // The clock sent back: the same timeline steps the same way again.
    const b = drive(vs.length, () => playEngine.liveValue('out'), i => vs[i], 1);
    expect(b).toEqual(a);
  });

  it('switching it off and on starts over from the value then', () => {
    const m = mapping('a', 'out', { ...defaultIncrement(1), every: 0.1, unit: 'seconds' });
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('out', { max: 10 })], mappings: [m] };
    playEngine.setRecord(rec);
    drive(20, () => 0);
    expect(playEngine.liveValue('out')).toBeGreaterThan(1);
    playEngine.setRecord({ ...rec, mappings: [{ ...m, enabled: false }] });
    playEngine.setRecord(rec);
    expect(playEngine.incrementNow('a')).toBeNull();
  });
});

// ── The file, words and plans ────────────────────────────────────────────────

describe('the file', () => {
  it('round-trips, and old mappings stay as they were', () => {
    const inc: PlayIncrement = { ...defaultIncrement(0.5), on: 'repeat', growth: 'compound', factor: 2, limit: 'bounce', glideMs: 120, glideCurve: 'out', wrapAfter: 8, wrapBack: 'pingpong', when: { value: 'ctl:src', cmp: 'above', threshold: 0.5, hysteresis: 0.05, tolerance: 0.01 }, stepSignal: 's', resetSignal: 'r', resetOn: 'x' };
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('out')], mappings: [mapping('a', 'out', inc), { ...mapping('b', 'out', inc), increment: undefined }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.mappings[0]).toEqual(rec.mappings[0]);
    expect('increment' in back.mappings[1]).toBe(false);
  });

  it('brings bad numbers back in', () => {
    const back = parsePlayRecord({ ...emptyPlayRecord(), controls: [control('src'), control('out')], mappings: [{ ...mapping('a', 'out', defaultIncrement()), increment: { on: 'nope', every: -3, wrapAfter: 2.6, growth: 'x', limit: 'wrap' } }] });
    const inc = back.mappings[0].increment!;
    expect(inc.on).toBe('repeat');
    expect(inc.every).toBe(0.01);
    expect(inc.wrapAfter).toBe(3);
    expect(inc.growth).toBe('constant');
    expect(inc.limit).toBe('wrap');
  });

  it('is Pro', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('src'), control('out')], mappings: [mapping('a', 'out', defaultIncrement(), { source: { kind: 'mouse', axis: 'x' } })] };
    expect(playableForPlan(rec, 'free').mappings).toHaveLength(0);
  });

  it('sums itself up in a line', () => {
    expect(incrementSummary({ ...defaultIncrement(0.5), growth: 'compound', factor: 2, wrapAfter: 8 }, [])).toBe('+0.5 ×2 on beat, wrap 8');
    expect(incrementSummary({ ...defaultIncrement(2), direction: -1, on: 'repeat', unit: 'seconds', every: 0.5, limit: 'bounce' }, [])).toBe('−2 every 0.5 s, bounce');
    expect(incrementSummary({ ...defaultIncrement(10), growth: 'proportional', on: 'trigger', trigger: { on: 'signal', signal: 's' } }, [{ id: 's', name: 'Hit' }])).toBe('+10% on Hit');
    expect(incrementSummary({ ...defaultIncrement(1), growth: 'additive', factor: 1, on: 'threshold', threshold: 0.6, glideMs: 200 }, [])).toBe('+1 +1 at 0.6, glide 200 ms');
  });
});

// ── The web runtime ──────────────────────────────────────────────────────────

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

/** Mount the runtime (with the kit) and step it frame by frame, setting `src` before each. */
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
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 1000 / 60));
    return read.map(id => { const g = h.get(id); return g?.driven ? g.value : undefined; });
  });
}

describe('the web runtime', () => {
  it('steps a threshold increment with glide and bounce, and a chained one, frame for frame like the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(),
      controls: [control('src'), control('out', { max: 10 }), control('count', { max: 10 })],
      signals: [{ id: 'step', name: 'out.step' }],
      mappings: [
        mapping('a', 'out', { ...defaultIncrement(3), on: 'threshold', threshold: 0.5, hysteresis: 0.1, falling: true, limit: 'bounce', glideMs: 50, glideCurve: 'linear', growth: 'additive', factor: 1, start: 'value', startValue: 0, stepSignal: 'step' }),
        mapping('b', 'count', { ...defaultIncrement(1), on: 'trigger', trigger: { on: 'signal', signal: 'step' }, start: 'value', startValue: 0, wrapAfter: 2, wrapBack: 'pingpong' }),
      ],
    };
    const values = [0.2, 0.6, 0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.7, 0.7, 0.7, 0.7, 0.2, 0.2, 0.2, 0.9, 0.9, 0.9, 0.9, 0.9];
    const ids = ['out', 'count'];
    playEngine.setRecord(rec);
    let t = 1;
    const app = values.map(v => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); return ids.map(id => playEngine.liveValue(id) as number | undefined); });
    const web = runtimeRun(rec, values, ids);
    for (let i = 0; i < app.length; i++) for (let j = 0; j < ids.length; j++) {
      const a = app[i][j], w = web[i][j];
      if (a === undefined) expect(w, `${ids[j]} frame ${i}`).toBeUndefined();
      else expect(w, `${ids[j]} frame ${i}`).toBeCloseTo(a, 1);
    }
    // It stepped, glided and chained.
    expect(new Set(app.map(r => r[0])).size).toBeGreaterThan(4);
    expect(app.some(r => (r[1] ?? 0) > 0)).toBe(true);
  });
});
