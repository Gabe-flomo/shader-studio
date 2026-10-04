/**
 * Water (a Look effect that simulates a water surface): the solver (stable at the step it picks,
 * energy kept undamped and lost when damped, open edges letting waves out), its clock-driven plan
 * (the same ticks at any frame rate, flat on a render's first frame, deterministic rain), the sources'
 * stamps, the record, the Splash action and the example. The GPU runs the same plan and maths
 * (FN_WATER_STEP); fnWaterCpu is its twin.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import {
  FN_EFFECTS, FN_KINDS, FN_WATER, FN_SPLASH_AT, fnAnimated, fnBuildFinal, fnDefaultEffect, fnLookAct, fnLookNew, fnLookStep, fnLookValue, fnMapKeys, fnMapLayers,
  fnWaterCpu, fnWaterDamp, fnWaterDecay, fnWaterDrop, fnWaterEnergy, fnWaterFrame, fnWaterGrid, fnWaterLimit, fnWaterPlan, fnWaterPress, fnWaterRain, fnWaterState, fnWaterStep, fnWaterTick,
  type FnEffect, type FnWaterGridState,
} from '../kit/finish.js';
import { parseFinish, parseFinishEffect } from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, parseTake, type PlayRecord } from '../../types/play';
import { sgReactions } from '../kit/signals.js';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { doChoices, lookDefaults, reactionText } from '../../components/play/rules/reactionChoices';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { PLAY_EXAMPLE_GRAPHS } from '../../store/playExamples';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); playEngine.resetLooks(); });

const fx = (kind: Parameters<typeof fnDefaultEffect>[0], patch: Record<string, unknown> = {}): FnEffect => ({ ...fnDefaultEffect(kind, kind), ...patch });
const DEF = Object.fromEntries(FN_EFFECTS.water.params.map(p => [p.key, p.value])) as Record<string, number>;
const grid = (w: number, h: number, fill: (i: number, j: number) => number): FnWaterGridState => {
  const now = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) now[j * w + i] = fill(i, j);
  return { w, h, now, prev: Float32Array.from(now) };
};
const bump = (w: number, h: number, r = 4) => grid(w, h, (i, j) => fnWaterDrop(Math.hypot(i - w / 2, j - h / 2), r));
const maxAbs = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('declaration', () => {
  it('is a new Warp effect beside Ripple, which keeps its formula and settings', () => {
    expect(FN_KINDS.indexOf('water')).toBe(FN_KINDS.indexOf('ripple') + 1);
    expect(FN_EFFECTS.water.group).toBe('Warp');
    expect(FN_EFFECTS.ripple.params.map(p => p.key)).toEqual(['amount', 'wavelength', 'speed', 'decay', 'cx', 'cy']);
    expect(fnBuildFinal([fx('ripple')]).src).toContain('ripple_wavelength');
    for (const k of ['speed', 'damping', 'size', 'strength', 'bob', 'refraction', 'highlights', 'light', 'x', 'y', 'rain', 'drop', 'edges']) {
      const p = FN_EFFECTS.water.params.find(x => x.key === k);
      expect(p, k).toBeDefined();
      expect(p!.hint.length, `${k} has a hint`).toBeGreaterThan(20);
    }
  });

  it('has Pond (its defaults), Rain on glass, Boat wake, Ripple tank and Shockwave; presets may set its Source and Shape', () => {
    const pr = FN_EFFECTS.water.presets!;
    expect(pr.map(p => p.name)).toEqual(['Pond', 'Rain on glass', 'Boat wake', 'Ripple tank', 'Shockwave']);
    for (const [k, v] of Object.entries(pr[0].values)) expect(DEF[k], k).toBe(v);
    expect(pr.find(p => p.name === 'Ripple tank')!.set).toEqual({ shape: 'twin', source: 'xy' });
    expect(pr.find(p => p.name === 'Rain on glass')!.set).toEqual({ source: 'none' });
    expect(pr.find(p => p.name === 'Rain on glass')!.values.rain).toBeGreaterThan(5);
  });

  it('starts on the pointer, with a point, at medium detail; keeps its choices in the record and falls back on odd ones', () => {
    const d = fnDefaultEffect('water', 'w');
    expect(d).toEqual(expect.objectContaining({ source: 'pointer', shape: 'point', detail: 'medium', sourceLayer: '', layerId: '' }));
    const e = parseFinishEffect({ id: 'w', kind: 'water', source: 'layer', sourceLayer: 'n1', shape: 'layer', layerId: 'txt', detail: 'high', rain: 99, where: 'waves' })!;
    expect(e).toEqual(expect.objectContaining({ source: 'layer', sourceLayer: 'n1', shape: 'layer', layerId: 'txt', detail: 'high', rain: 60, where: 'waves' }));
    const odd = parseFinishEffect({ id: 'w', kind: 'water', source: 'mouse', shape: 'star', detail: 'ultra' })!;
    expect(odd).toEqual(expect.objectContaining({ source: 'pointer', shape: 'point', detail: 'medium' }));
    // A stack saved before Water (Ripple with a Where) reads as it did.
    const old = parseFinish({ on: true, effects: [{ id: 'r', kind: 'ripple', amount: 0.4, where: 'picture' }] })!;
    expect(old.effects[0]).toEqual(expect.objectContaining({ kind: 'ripple', amount: 0.4, where: 'picture' }));
  });

  it('keeps drawing (the waves move by themselves) and asks for a Layer shape’s layer drawn alone', () => {
    expect(fnAnimated({ on: true, effects: [fx('water')] })).toBe(true);
    expect(fnMapKeys([fx('water', { shape: 'layer', layerId: 'txt' })])).toEqual(['layer:txt']);
    expect(fnMapLayers({ on: true, effects: [fx('water', { shape: 'point', layerId: 'txt' })] })).toEqual([]);
    expect(fnMapLayers({ on: true, effects: [fx('water', { shape: 'layer', layerId: 'txt' })] })).toEqual(['txt']);
  });

  it('bends the picture by the surface’s slope and lights it, in the first pass; Where → waves reads the surface', () => {
    const b = fnBuildFinal([fx('water')]);
    expect(b.water).toBe(true);
    expect(b.src).toContain('uniform sampler2D uWater');
    expect(b.src).toContain('q -= fnWaterSlope(q) * water_refraction');
    expect(b.src).toContain('fnWaterCurve(p)');
    // Another effect shown only where the water moves.
    const w = fnBuildFinal([fx('water'), fx('vignette', { where: 'waves' })]);
    expect(w.src).toMatch(/float fnW1\(vec2 p\) \{ float m = clamp\(fnWaves\(p\)/);
    // Without a Water effect there is no surface: it shows nowhere.
    const none = fnBuildFinal([fx('vignette', { where: 'waves' })]);
    expect(none.water).toBe(false);
    expect(none.src).toMatch(/float fnW0\(vec2 p\) \{ float m = clamp\(0\.0/);
    expect(none.src).not.toContain('uWater');
  });
});

describe('the solver', () => {
  it('picks enough substeps that a wave crosses at most maxC cells in one, at the speed asked', () => {
    for (const rows of Object.values(FN_WATER.detail)) {
      for (const speed of [0.05, 0.2, 0.35, 0.7, 1, 1.5, 2]) {
        const p = fnWaterPlan(speed, rows);
        expect(p.c).toBeLessThanOrEqual(FN_WATER.maxC + 1e-12);
        expect(p.c).toBeLessThan(Math.SQRT1_2);
        expect(p.sub).toBeLessThanOrEqual(FN_WATER.maxSub);
        // The speed it gives (cells a substep × substeps a second / rows): the one asked, unless past maxSub.
        const got = p.c * p.sub * FN_WATER.rate / rows;
        if (speed * rows / FN_WATER.rate <= FN_WATER.maxC * FN_WATER.maxSub) expect(got).toBeCloseTo(speed, 9);
        else expect(got).toBeLessThan(speed);
      }
    }
  });

  it('is stable at the Courant number it uses: noise stays bounded and keeps its energy (and the test bites past 1/√2)', () => {
    const run = (c: number) => {
      let g = grid(40, 30, (i, j) => Math.sin(i * 12.9898 + j * 78.233) * 0.5);
      const e0 = fnWaterEnergy(g, c * c);
      for (let n = 0; n < 1500; n++) g = fnWaterStep(g, { c2: c * c, damp: 1, edges: 0 });
      return { e: fnWaterEnergy(g, c * c) / e0, max: maxAbs(g.now) };
    };
    const ok = run(FN_WATER.maxC);
    expect(ok.max).toBeLessThan(3);
    expect(Math.abs(ok.e - 1)).toBeLessThan(1e-3);
    const past = run(0.75).max;
    expect(Number.isFinite(past) ? past : Infinity).toBeGreaterThan(1e3);
  });

  it('keeps a wave’s energy undamped, and loses it at the Damping rate (twice it, as energy is height squared)', () => {
    const c2 = 0.25, steps = 600, dt = 1 / 240;
    let g = bump(60, 60);
    const e0 = fnWaterEnergy(g, c2);
    for (let n = 0; n < steps; n++) g = fnWaterStep(g, { c2, damp: 1, edges: 0 });
    expect(fnWaterEnergy(g, c2) / e0).toBeCloseTo(1, 3);
    for (const damping of [0.1, 0.3, 0.6]) {
      const damp = fnWaterDamp(damping, dt);
      let h = bump(60, 60);
      const es: number[] = [];
      for (let n = 1; n <= steps; n++) { h = fnWaterStep(h, { c2, damp, edges: 0 }); if (n % 100 === 0) es.push(fnWaterEnergy(h, c2)); }
      for (let i = 1; i < es.length; i++) expect(es[i]).toBeLessThan(es[i - 1]);
      const expected = Math.exp(-2 * fnWaterDecay(damping) * steps * dt);
      // On a log scale (the rate itself), within 10 %.
      expect(Math.abs(Math.log(es[es.length - 1] / e0) / Math.log(expected) - 1)).toBeLessThan(0.1);
    }
    // More damping, less left.
    expect(fnWaterDecay(0)).toBeLessThan(fnWaterDecay(0.5));
    expect(fnWaterDecay(0.5)).toBeLessThan(fnWaterDecay(1));
  });

  it('damps the finest ripples with its viscosity, hardly the waves', () => {
    const c2 = 0.25;
    const run = (g: FnWaterGridState) => { const e0 = fnWaterEnergy(g, c2); for (let n = 0; n < 240; n++) g = fnWaterStep(g, { c2, damp: 1, visc: FN_WATER.visc, edges: 0 }); return fnWaterEnergy(g, c2) / e0; };
    const fine = run(grid(32, 32, (i, j) => ((i + j) % 2 ? 0.1 : -0.1)));
    const long = run(grid(32, 32, (i, j) => 0.1 * Math.cos(Math.PI * i / 16) * Math.cos(Math.PI * j / 16)));
    expect(fine).toBeLessThan(0.01);
    expect(long).toBeGreaterThan(0.8);
  });

  it('lets waves out through open edges (Mur’s boundary) and bounces them back from closed ones', () => {
    const run = (edges: number) => {
      let g = bump(80, 80, 3);
      for (let n = 0; n < 900; n++) g = fnWaterStep(g, { c2: 0.25, damp: 1, edges });
      return rms(g.now);
    };
    const start = rms(bump(80, 80, 3).now);
    expect(run(0) / start).toBeGreaterThan(0.2);
    expect(run(1) / start).toBeLessThan(0.03);
  });

  it('stamps move the surface without setting it moving or adding water', () => {
    // A stamp shifts both heights: a still pool with a dimple pressed in stays a dimple at rest, not a kick.
    const g = grid(20, 20, () => 0);
    const force = new Float32Array(400); force[210] = -0.5;
    const s = fnWaterStep(g, { c2: 0.25, damp: 1, edges: 0, force });
    expect(s.now[210]).toBeCloseTo(-0.5, 6);
    expect(s.prev[210]).toBeCloseTo(-0.5, 6);
    // A point's dimple and a drop each come with a rim of the water they push aside: about none added.
    let press = 0, drop = 0, dip = 0;
    for (let j = -200; j <= 200; j++) for (let i = -200; i <= 200; i++) {
      press += fnWaterPress('point', i / 400, j / 400, 0.04, 0, 0, 400);
      dip += Math.max(0, -fnWaterPress('point', i / 400, j / 400, 0.04, 0, 0, 400) * -1) + Math.max(0, fnWaterPress('point', i / 400, j / 400, 0.04, 0, 0, 400));
      drop += fnWaterDrop(Math.hypot(i, j) / 400, 0.02);
    }
    expect(Math.abs(press) / dip).toBeLessThan(0.01);
    expect(Math.abs(drop)).toBeLessThan(0.01 * 400 * 400 * 0.02 * 0.02 * 6.3);
    // A bobbing dimple breathes water in and out (that is what sends rings).
    expect(fnWaterPress('point', 0, 0, 0.04, 0, 0, 400, 2)).toBeGreaterThan(fnWaterPress('point', 0, 0, 0.04, 0, 0, 400, 0) + 1.5);
    // A source keeping pace with its own crest stops piling it up.
    expect(fnWaterLimit(-0.1, -0.5, 1)).toBeCloseTo(-0.05, 9);
    expect(fnWaterLimit(-0.1, -1.2, 1)).toBe(-0);
    expect(fnWaterLimit(-0.1, 0.5, 1)).toBe(-0.1);
  });

  it('a moving source leaves a wake behind it; one holding still makes no waves; a bobbing one rings', () => {
    const W = 96, H = 54, val = (o: Record<string, number> = {}) => (k: string) => (k in o ? o[k] : DEF[k]);
    const run = (path: (t: number) => { x: number; y: number } | null, o: Record<string, number> = {}) => {
      const sim = fnWaterCpu(W, H);
      for (let f = 0; f <= 90; f++) sim.frame({ time: f / 60, first: f === 0, value: val(o), point: path(f / 60) });
      return sim.grid;
    };
    const still = run(() => ({ x: 0.5, y: 0.5 }));
    expect(maxAbs(still.now)).toBeLessThan(1e-6);
    const moving = run(t => ({ x: 0.15 + 0.5 * t, y: 0.5 }));
    // Behind the source (left of where it ended, x 0.9) the water is moving; well ahead of it, it isn't yet.
    const col = (x: number) => { let m = 0; for (let j = 0; j < H; j++) m = Math.max(m, Math.abs(moving.now[j * W + Math.round(x * W)])); return m; };
    expect(col(0.55)).toBeGreaterThan(0.02);
    expect(col(0.97)).toBeLessThan(col(0.55) / 4);
    const bob = run(() => ({ x: 0.5, y: 0.5 }), { bob: 2 });
    expect(maxAbs(bob.now)).toBeGreaterThan(0.05);
  });
});

describe('the clock, renders and rain', () => {
  it('counts ticks from the clock: the same steps at 30, 60 or 144 frames a second', () => {
    const steps = (fps: number) => {
      const st = fnWaterState();
      let n = 0;
      for (let f = 0; f <= 2 * fps; f++) n += fnWaterFrame(st, { time: f / fps, first: f === 0, speed: 0.5, rows: 270, point: null, bob: 0, strength: 1, rain: 0, drop: 0.01 }).steps.length;
      return n;
    };
    expect(steps(30)).toBe(steps(60));
    expect(steps(60)).toBe(steps(144));
    expect(steps(60)).toBe(fnWaterTick(2) * fnWaterPlan(0.5, 270).sub);
  });

  it('starts flat on a render’s first frame, when the clock goes back, and catches up only so far after a stall', () => {
    const st = fnWaterState();
    const f = (time: number, first = false) => fnWaterFrame(st, { time, first, speed: 0.35, rows: 270, point: null, bob: 0, strength: 1, rain: 0, drop: 0.01 });
    expect(f(5, true)).toEqual(expect.objectContaining({ reset: true, ticks: 0 }));
    expect(f(5 + 1 / 60).ticks).toBe(1);
    expect(f(4).reset).toBe(true);
    expect(f(10).ticks).toBe(FN_WATER.maxTicks);
  });

  it('plays a moving source the same every time, and the same at 30 and 60 frames a second', () => {
    const run = (fps: number) => {
      const sim = fnWaterCpu(64, 36);
      for (let k = 0; k <= 2 * fps; k++) {
        const t = k / fps;
        sim.frame({ time: t, first: k === 0, value: key => ({ ...DEF, rain: 6 })[key] ?? 0, point: { x: 0.1 + 0.4 * t, y: 0.4 + 0.1 * t } });
      }
      return sim.grid.now;
    };
    const a = run(30), b = run(30), c = run(60);
    expect(Array.from(a)).toEqual(Array.from(b));
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - c[i]));
    expect(d).toBeLessThan(1e-4);
    expect(maxAbs(a)).toBeGreaterThan(0.01);
  });

  it('rains at its rate on average, at places that are the same every render', () => {
    let n = 0;
    for (let t = 0; t < 600; t++) n += fnWaterRain(12, t).length;
    expect(n / 10).toBeGreaterThan(10.5);
    expect(n / 10).toBeLessThan(13.5);
    expect(fnWaterRain(12, 77)).toEqual(fnWaterRain(12, 77));
    expect(fnWaterRain(0, 77)).toEqual([]);
    for (const [x, y] of fnWaterRain(60, 5)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(1); }
  });

  it('sizes its grid by Detail and the frame’s shape, never past the frame', () => {
    expect(fnWaterGrid('medium', 1920, 1080)).toEqual({ w: 480, h: 270 });
    expect(fnWaterGrid('high', 1920, 1080)).toEqual({ w: 720, h: 405 });
    expect(fnWaterGrid('low', 1080, 1920).h).toBe(180);
    expect(fnWaterGrid(undefined, 400, 200)).toEqual({ w: 400, h: 200 });
  });
});

describe('Splash', () => {
  it('is a Look action: its time, place and size, kept half a second', () => {
    expect(FN_SPLASH_AT).toEqual(['source', 'pointer', 'random', 'point']);
    const st = fnLookNew();
    fnLookStep(st, 3);
    expect(fnLookAct(st, { do: 'splash', layerId: 'finish:w', key: 'point', x: 0.2, y: 0.9, value: 0.08 }, 3)).toBe(true);
    expect(['splashT', 'splashX', 'splashY', 'splashSize'].map(k => fnLookValue(st, 'finish:w', k))).toEqual([3, 0.2, 0.9, 0.08]);
    fnLookAct(st, { do: 'splash', layerId: 'finish:v', key: 'random' }, 3);
    expect(fnLookValue(st, 'finish:v', 'splashX')).toBe(-2);
    expect(fnLookValue(st, 'finish:v', 'splashSize')).toBe(0.06);
    fnLookAct(st, { do: 'splash', layerId: 'finish:u', key: 'pointer' }, 3);
    expect(fnLookValue(st, 'finish:u', 'splashX')).toBe(-3);
    fnLookAct(st, { do: 'splash', layerId: 'finish:s' }, 3);
    expect(fnLookValue(st, 'finish:s', 'splashX')).toBe(-1);
    fnLookStep(st, 3.6);
    expect(fnLookValue(st, 'finish:w', 'splashT')).toBeUndefined();
  });

  it('drops once per splash, at its place (the source, the pointer, a point, or a random place the same every time)', () => {
    const st = fnWaterState();
    const base = { speed: 0.35, rows: 100, bob: 0, strength: 1, rain: 0, drop: 0.01 };
    fnWaterFrame(st, { ...base, time: 1, first: true, point: { x: 0.3, y: 0.6 } });
    const sp = { t: 1, x: -1, y: -1, size: 0.05 };
    const a = fnWaterFrame(st, { ...base, time: 1 + 1 / 60, point: { x: 0.3, y: 0.6 }, splash: sp });
    expect(a.steps[0].drops).toEqual([[0.3, 0.6, 0.05, FN_WATER.dropPush * FN_WATER.splash]]);
    // The same splash still showing the next frame: not again.
    const b = fnWaterFrame(st, { ...base, time: 1 + 2 / 60, point: { x: 0.3, y: 0.6 }, splash: sp });
    expect(b.steps.every(s => s.drops.length === 0)).toBe(true);
    const c = fnWaterFrame(st, { ...base, time: 1 + 3 / 60, point: null, pointer: { x: 0.7, y: 0.2 }, splash: { t: 1.04, x: -3, y: -1, size: 0.1 } });
    expect(c.steps[0].drops[0].slice(0, 2)).toEqual([0.7, 0.2]);
    const d = fnWaterFrame(st, { ...base, time: 1 + 4 / 60, point: null, splash: { t: 1.06, x: 0.9, y: 0.1, size: 0.1 } });
    expect(d.steps[0].drops[0].slice(0, 2)).toEqual([0.9, 0.1]);
    const r1 = fnWaterFrame(st, { ...base, time: 1 + 5 / 60, point: null, splash: { t: 1.08, x: -2, y: -1, size: 0.1 } }).steps[0].drops[0];
    const st2 = fnWaterState();
    fnWaterFrame(st2, { ...base, time: 1, first: true, point: null });
    const r2 = fnWaterFrame(st2, { ...base, time: 1 + 1 / 60, point: null, splash: { t: 1.08, x: -2, y: -1, size: 0.1 } }).steps[0].drops[0];
    expect(r1).toEqual(r2);
    expect(r1[0]).toBeGreaterThan(0.05);
    expect(r1[0]).toBeLessThan(0.95);
  });

  const splashRecord = (): PlayRecord => ({
    ...emptyPlayRecord(),
    finish: { on: true, effects: [fx('water', { id: 'w' }) as never] },
    signals: [{
      id: 'go', name: 'Go',
      inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:src', cmp: 'crossUp', threshold: 0.5, hysteresis: 0, tolerance: 0 } }],
      do: [{ id: 'r1', do: 'splash', layerId: 'finish:w', amount: 1, enabled: true, key: 'point', x: 0.25, y: 0.75, value: 0.1 }],
    }],
    controls: [{ id: 'src', target: 'n::src', kind: 'float', label: 'src', min: 0, max: 1 }],
  });

  it('keeps its place and size in the record, in takes and for the action runner', () => {
    const rec = parsePlayRecord(JSON.parse(JSON.stringify(splashRecord())));
    expect(rec.signals![0].do![0]).toEqual(expect.objectContaining({ do: 'splash', key: 'point', x: 0.25, y: 0.75, value: 0.1 }));
    expect(sgReactions(rec.signals!)[0]).toEqual(expect.objectContaining({ do: 'splash', key: 'point', x: 0.25, y: 0.75, value: 0.1 }));
    const t = parseTake({ id: 't', name: 'T', from: 0, length: 2, tracks: [], events: [{ t: 0.5, do: 'splash', layerId: 'finish:w', amount: 1, key: 'point', x: 0.4, y: 2, value: 0.05 }] });
    expect(t!.events[0]).toEqual(expect.objectContaining({ do: 'splash', key: 'point', x: 0.4, y: 1, value: 0.05 }));
    // Its effect gone, it goes too.
    const gone = parsePlayRecord({ ...JSON.parse(JSON.stringify(splashRecord())), finish: { on: true, effects: [fx('vignette', { id: 'v' })] } });
    expect(gone.signals![0].do).toBeUndefined();
  });

  it('fires live through the engine (the renderer reads splashT through layerValue)', () => {
    playEngine.setRecord(splashRecord());
    let t = 50;
    const step = (v: number) => { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(0.1, (t += 0.1)); };
    step(0);
    expect(playEngine.layerValue('finish:w', 'splashT', -1)).toBe(-1);
    step(1);
    expect(playEngine.layerValue('finish:w', 'splashT', -1)).toBeCloseTo(t, 6);
    expect(playEngine.layerValue('finish:w', 'splashX', -1)).toBe(0.25);
  });

  it('is in the Do menu for Water, starting at the source, and reads in words', () => {
    const play = splashRecord();
    expect(doChoices(play).filter(c => c.do === 'splash').map(c => c.label)).toEqual(['Splash · Water']);
    expect(lookDefaults('splash', 'finish:w', play)).toEqual({ key: 'source', value: 0.06 });
    const r = play.signals![0].do![0];
    expect(reactionText(r, play)).toBe('Splash at 0.25, 0.75, size 0.1 · Water');
    expect(reactionText({ ...r, key: 'pointer' }, play)).toBe('Splash under the pointer, size 0.1 · Water');
    expect(reactionText({ ...r, key: 'random' }, play)).toBe('Splash somewhere random, size 0.1 · Water');
  });
});

describe('the example and the exported page', () => {
  it('has a commented Play example: a null sails, Water follows it with rain, and rules splash', () => {
    const ex = PLAY_EXAMPLE_GRAPHS.finishWater;
    expect(ex).toBeDefined();
    const play = parsePlayRecord(JSON.parse(JSON.stringify(ex.play)));
    const water = play.finish!.effects.find(e => e.kind === 'water')!;
    expect(water).toEqual(expect.objectContaining({ source: 'layer', sourceLayer: 'boat' }));
    expect(water.rain).toBeGreaterThan(0);
    expect(play.layers.find(l => l.id === 'boat')?.kind).toBe('null');
    expect(play.finish!.effects.find(e => e.kind === 'chroma')?.where).toBe('waves');
    expect(play.signals!.flatMap(s => s.do ?? []).map(r => r.do)).toEqual(['splash', 'splash']);
    // Every layer, control and rule is described in the notes.
    for (const w of ['Boat', 'Wave speed', 'Damping', 'Rain', 'Refraction', 'Highlights', 'Splash where you click', 'Big splash (Space)', 'Where the water moves']) expect(play.notes, w).toContain(w);
  });

  it('carries the same solver to exported pages, which hand it the pointer and layers’ positions', () => {
    const k = kitScript();
    for (const name of ['function fnWaterFrame(', 'function fnWaterPlan(', 'function fnWaterRain(', 'const FN_WATER_STEP']) expect(k).toContain(name);
    expect(runtimeSource).toContain('layerPoint: id => (K && K.layerPoint ? K.layerPoint(id) : null)');
    expect(runtimeSource).toMatch(/pointer: \{ x: mouse\.x, y: mouse\.y, over: !!mouse\.over/);
  });
});
