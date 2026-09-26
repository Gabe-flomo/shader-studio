/**
 * The Script layer: its saved form round-trips (code, declared sliders and
 * their p_ values), the sliders it declares become numeric props a control
 * can drive, the declaration parser reads a params object leniently, and
 * the status store only notifies on change.
 */
import { describe, expect, it } from 'vitest';
import { defaultLayer, parseLayer, layerNumericProps, LAYER_NUMERIC_PROPS, DEFAULT_SCRIPT_PARAMS, type ScriptLayer } from '../../types/playLayers';
import { extractScriptParams, SCRIPT_EXAMPLES } from '../../components/play/layers/scriptExamples';
import { setScriptStatus, scriptStatusVersion } from '../scriptStatus';

describe('script layer', () => {
  it('starts with the starter sketch and its three sliders', () => {
    const l = defaultLayer('script', 's1', 'Script') as ScriptLayer;
    expect(l.code).toContain('function draw(s)');
    expect(l.paramDefs.map(d => d.key)).toEqual(['count', 'size', 'speed']);
    expect(l.clear).toBe(true);
  });

  it('round-trips through the schema, keeping p_ values and dropping junk declarations', () => {
    const raw = {
      id: 's2', kind: 'script', label: 'Mine', code: 'function draw(s) {}', clear: false, readPicture: true, opacity: 0.5, blend: 'screen',
      paramDefs: [{ key: 'speed', label: 'Speed', value: 2, min: 0, max: 4, step: 0.1 }, { key: 'bad key', label: 'x', value: 1, min: 0, max: 1 }, 'nope'],
      p_speed: 3, p_stale: 0.25, p_bad: 'no', other: 1,
    };
    const l = parseLayer(raw) as ScriptLayer;
    expect(l.kind).toBe('script');
    expect(l.paramDefs).toEqual([{ key: 'speed', label: 'Speed', value: 2, min: 0, max: 4, step: 0.1 }]);
    expect(l.p_speed).toBe(3);
    expect((l as unknown as Record<string, unknown>).p_stale).toBe(0.25);
    expect((l as unknown as Record<string, unknown>).p_bad).toBeUndefined();
    expect((l as unknown as Record<string, unknown>).other).toBeUndefined();
    expect(l.readPicture).toBe(true);
  });

  it('declared sliders are numeric props (p_<key>) ahead of the kind’s own', () => {
    const l = defaultLayer('script', 's3', 'Script') as ScriptLayer;
    const props = layerNumericProps(l);
    expect(props.map(p => p.key)).toEqual(['p_count', 'p_size', 'p_speed', 'opacity']);
    expect(props[0]).toMatchObject({ label: 'Dots', min: 1, max: 200, step: 1 });
    expect(LAYER_NUMERIC_PROPS.script.map(p => p.key)).toEqual(['opacity']);
    // Other kinds are unchanged.
    expect(layerNumericProps(defaultLayer('null', 'n', 'Null'))).toBe(LAYER_NUMERIC_PROPS.null);
  });

  it('reads a params object leniently: bare numbers, missing labels, clamped values', () => {
    const r = extractScriptParams(`const params = { a: 3, b: { value: 9, min: 0, max: 5, label: 'Bee', step: 0.5 }, 'not ok': 1 };\nfunction draw(s) {}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.defs).toEqual([
      { key: 'a', label: 'a', value: 1, min: 0, max: 1 },
      { key: 'b', label: 'Bee', value: 5, min: 0, max: 5, step: 0.5 },
    ]);
    expect(extractScriptParams('function draw(s) {}')).toEqual({ ok: true, defs: [] });
    const bad = extractScriptParams('function draw(s) { oops(');
    expect(bad.ok).toBe(false);
  });

  it('every starter example declares parseable sliders and a draw function', () => {
    for (const ex of SCRIPT_EXAMPLES) {
      const r = extractScriptParams(ex.code);
      expect(r.ok, ex.name).toBe(true);
      expect(ex.code).toContain('function draw(s)');
    }
    const dots = extractScriptParams(SCRIPT_EXAMPLES[0].code);
    if (dots.ok) expect(dots.defs).toEqual(DEFAULT_SCRIPT_PARAMS);
  });

  it('status store notifies only on change', () => {
    const v0 = scriptStatusVersion();
    setScriptStatus('x', null);
    expect(scriptStatusVersion()).toBe(v0);
    setScriptStatus('x', 'Compile: boom');
    setScriptStatus('x', 'Compile: boom');
    expect(scriptStatusVersion()).toBe(v0 + 1);
    setScriptStatus('x', null);
    expect(scriptStatusVersion()).toBe(v0 + 2);
  });
});

import { klSketchHelpers, klCompileSketch, KL_SKETCH_NAMES } from '../kit/layers.js';
import { findNumericDeclaration, makeSlider, sliderCandidate, guessRange, declaredParams } from '../../components/play/layers/scriptTools';

describe('sketch helpers and compiler', () => {
  const fakeCtx = () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' ? (...a: unknown[]) => { calls.push(`${k}(${a.map(v => typeof v === 'number' ? +v.toFixed(2) : String(v)).join(',')})`); } : undefined),
      set: (_t, k, v) => { calls.push(`${String(k)}=${String(v)}`); return true; },
    });
    return { ctx, calls };
  };

  it('helpers draw on the current frame’s canvas with p5 colour forms and state', () => {
    const { ctx, calls } = fakeCtx();
    const s = { ctx: ctx as unknown as CanvasRenderingContext2D, width: 200, height: 100, mouse: { x: 5, y: 6, down: true }, frame: 3, dt: 0.016, time: 2 };
    const P = klSketchHelpers(() => s) as Record<string, (...a: unknown[]) => unknown>;
    P.fill(255, 128, 0); P.noStroke(); P.circle(10, 20, 8);
    expect(calls).toContain('arc(10,20,4,0,6.28)');
    expect(calls).toContain('fillStyle=rgb(255, 128, 0)');
    expect(calls).toContain('fill()');
    expect(calls).not.toContain('stroke()');
    expect(P.map(5, 0, 10, 0, 100)).toBe(50);
    expect(P.color(20)).toBe('rgb(20, 20, 20)');
    expect(P.color(1, 2, 3, 127.5)).toBe('rgba(1, 2, 3, 0.5)');
    expect(P.hsl(200, 80, 60)).toBe('hsl(200 80% 60%)');
    expect(P.width).toBe(200); expect(P.mouseX).toBe(5); expect(P.mouseIsPressed).toBe(true); expect(P.frameCount).toBe(3);
    const n = P.noise(1.5, 2.5) as number; expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1);
    expect(P.noise(1.5, 2.5)).toBe(n);
    expect(KL_SKETCH_NAMES).toContain('circle');
  });

  it('compiles a sketch inside the helper scope: helpers are plain names, the sketch’s own names win, params come back', () => {
    const { ctx, calls } = fakeCtx();
    const s = { ctx: ctx as unknown as CanvasRenderingContext2D, width: 10, height: 10, mouse: { x: 0, y: 0, down: false }, frame: 0, dt: 0, time: 0 };
    const P = klSketchHelpers(() => s);
    const r = klCompileSketch(`const params = { size: { value: 3, min: 0, max: 9 } };\nlet size = 3;\nfunction noise() { return 42; }\nfunction draw(s) { fill(255); circle(1, 2, size); s.state.n = noise(); }`, P);
    expect(r.params).toEqual({ size: { value: 3, min: 0, max: 9 } });
    expect(r.has('size')).toBe(true);
    expect(r.has('nothing')).toBe(false);
    expect(r.has('width')).toBe(false); // a helper name, not the sketch’s variable
    r.set('size', 7);
    const state: Record<string, unknown> = {};
    r.draw!({ ...s, state });
    expect(calls).toContain('arc(1,2,3.5,0,6.28)'); // diameter 7 → radius 3.5: the slider drove the let
    expect(state.n).toBe(42);
  });
});

describe('make a slider', () => {
  const code = `let count = 60;\nconst wobble = 0.35;\nfunction draw(s) { circle(1, 1, count); }`;
  it('finds top-level numeric declarations and guesses a range', () => {
    expect(findNumericDeclaration(code, 'count')).toMatchObject({ value: 60, keyword: 'let' });
    expect(findNumericDeclaration(code, 'wobble')).toMatchObject({ value: 0.35, keyword: 'const' });
    expect(findNumericDeclaration(code, 'draw')).toBeNull();
    expect(guessRange(60)).toEqual({ min: 0, max: 240, step: 1 });
    expect(guessRange(0.35)).toEqual({ min: 0, max: 1.4, step: 0.001 });
    expect(guessRange(0)).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(sliderCandidate(code, ' count ')?.name).toBe('count');
    expect(sliderCandidate(code, 'count + 1')).toBeNull();
  });
  it('adds the entry to params (creating it), keeps the variable and makes const a let', () => {
    const a = makeSlider(code, 'wobble')!;
    expect(a.code.startsWith('const params = {\n  wobble: { value: 0.35, min: 0, max: 1.4, step: 0.001 },\n};\n')).toBe(true);
    expect(a.code).toContain('let wobble = 0.35;');
    expect(declaredParams(a.code)).toEqual(['wobble']);
    const b = makeSlider(a.code, 'count')!;
    expect(declaredParams(b.code)).toEqual(['wobble', 'count']);
    expect(b.code).toContain('  count: { value: 60, min: 0, max: 240, step: 1 },\n};');
    expect(sliderCandidate(b.code, 'count')).toBeNull(); // already a slider
    expect(extractScriptParams(b.code).ok).toBe(true);
  });
});
