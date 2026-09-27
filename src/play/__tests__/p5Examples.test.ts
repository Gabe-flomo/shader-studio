/**
 * The p5 Play examples: each project in p5Examples.ts, put through the
 * importer, gives exactly what p5ExampleSketches.ts ships; nothing in it is
 * unsupported; its DOM controls become the layer's controls; and the built
 * layer compiles and runs a few frames.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { strToU8 } from 'fflate';
import { analyzeProject, buildP5Layer, mapDomControls, projectFromEntries } from '../p5import';
import { klSketchCompile, klSketchStep } from '../kit/layers.js';
import { kp5Lcg } from '../kit/p5.js';
import { extractScriptParams } from '../../components/play/layers/scriptExamples';
import { P5_EXAMPLE_PROJECTS } from '../../store/p5Examples';
import { P5_EXAMPLE_SKETCHES } from '../../store/p5ExampleSketches';
import { PLAY_EXAMPLE_GRAPHS } from '../../store/playExamples';

function importProject(key: string) {
  const p = P5_EXAMPLE_PROJECTS[key];
  const project = projectFromEntries(p.files.map(f => ({ path: f.path, bytes: strToU8(f.text) })));
  const files = [...project.files.map(f => ({ name: f.name, code: f.code })), { name: 'sketch.js', code: project.main.code }];
  const analysis = analyzeProject(files);
  const rewrite = mapDomControls(files);
  return { project, analysis, rewrite, built: buildP5Layer(project, analysis, rewrite) };
}

/** A 2D context that records nothing and answers what a sketch reads back. */
function fakeCanvas(w: number, h: number) {
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif', imageSmoothingEnabled: true };
  const canvas: Record<string, unknown> = { width: w, height: h };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'canvas') return canvas;
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'getImageData') return (_x: number, _y: number, ww: number, hh: number) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh });
      return () => {};
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  canvas.getContext = () => ctx;
  return canvas as { width: number; height: number; getContext: () => CanvasRenderingContext2D };
}

const W = 800, H = 450;
function run(key: string, frames: number, params: Record<string, unknown> = {}) {
  const sk = P5_EXAMPLE_SKETCHES[key];
  const r = extractScriptParams(sk.code, sk.files);
  if (!r.ok) throw new Error(r.error);
  const st = sk.mode === '3d'
    ? klSketchCompile(sk.code, { mode: '3d', three: THREE, files: sk.files, p5: true, log: () => {} })
    : klSketchCompile(sk.code, { files: sk.files, p5: true, makeCanvas: fakeCanvas, log: () => {} });
  expect(st.error).toBeNull();
  const layer = fakeCanvas(W, H);
  const errors: Array<string | null> = [];
  for (let i = 0; i < frames; i++) {
    const values = Object.fromEntries(r.defs.map(d => [d.key, d.value]));
    const s = {
      ctx: sk.mode === '3d' ? null : layer.getContext(), width: W, height: H, dpr: 1, time: i / 60, dt: 1 / 60, frame: i,
      params: { ...values, ...params }, state: st.state, mouse: { x: 400, y: 200, over: true, down: i === 2 },
      picture: { brightness: () => 0, texture: null }, null: () => null, random: kp5Lcg(7),
    } as Record<string, unknown>;
    errors.push(klSketchStep(st, s as never, r.defs, false));
  }
  return { st, errors, defs: r.defs };
}

const KEYS = ['p5FlowField', 'p5MultiFile', 'p5Webgl'];

describe('p5 example projects', () => {
  it('has the three projects, each with an index.html that loads p5 and its scripts', () => {
    expect(Object.keys(P5_EXAMPLE_PROJECTS)).toEqual(KEYS);
    expect(Object.keys(P5_EXAMPLE_SKETCHES)).toEqual(KEYS);
    for (const key of KEYS) {
      const html = P5_EXAMPLE_PROJECTS[key].files.find(f => f.path === 'index.html')!.text;
      expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/p5@[\d.]+\/lib\/p5\.min\.js"><\/script>/);
      expect(html).toContain('<script src="sketch.js"></script>');
    }
  });

  for (const key of KEYS) {
    describe(key, () => {
      const { project, analysis, built } = importProject(key);

      it('imports to exactly what p5ExampleSketches.ts ships', () => {
        const sk = P5_EXAMPLE_SKETCHES[key];
        expect({ label: built.patch.label, code: built.patch.code, files: built.patch.files, mode: built.patch.mode, p5: built.patch.p5, startAt: built.startAt })
          .toEqual({ label: sk.label, code: sk.code, files: sk.files, mode: sk.mode, p5: sk.p5, startAt: sk.startAt });
        expect(built.patch.clear).toBe(false);
        expect(built.patch.assets).toEqual([]);
      });

      it('has nothing unsupported, no syntax errors and no warnings', () => {
        expect(analysis.syntaxErrors).toEqual([]);
        expect(analysis.items.filter(i => i.status === 'unsupported')).toEqual([]);
        expect(analysis.items.filter(i => i.severity === 'error')).toEqual([]);
        expect(built.report.warnings).toBe(0);
        expect(project.warnings).toEqual([]);
        // Only p5 itself is left out.
        expect(project.skipped.map(s => s.reason)).toEqual([expect.stringMatching(/p5 itself/)]);
      });

      it('runs a few frames without an error', () => {
        const { errors, st } = run(key, 6);
        expect(errors).toEqual(errors.map(() => null));
        expect(st.error).toBeNull();
        expect(st.p5!.frameCount).toBeGreaterThan(0);
      });

      it('is a Play example whose layer carries the imported sketch', () => {
        const ex = PLAY_EXAMPLE_GRAPHS[key];
        expect(ex).toBeTruthy();
        const layers = (ex.play as unknown as { layers: Array<Record<string, unknown>> }).layers;
        const layer = layers.find(l => l.kind === 'script')!;
        const sk = P5_EXAMPLE_SKETCHES[key];
        expect(layer.code).toBe(sk.code);
        expect(layer.files ?? []).toEqual(sk.files);
        expect(layer.mode).toBe(sk.mode);
        expect(layer.p5).toBe(true);
        expect(layer.clear).toBe(false);
        for (const [k, v] of Object.entries(sk.startAt)) expect(layer[`p_${k}`]).toBe(v);
      });
    });
  }
});

describe('DOM controls become the layer’s controls', () => {
  const defsOf = (key: string) => {
    const sk = P5_EXAMPLE_SKETCHES[key];
    const r = extractScriptParams(sk.code, sk.files);
    if (!r.ok) throw new Error(r.error);
    return Object.fromEntries(r.defs.map(d => [d.key, d]));
  };

  it('flow field: count (restart), noise scale, trails and palette', () => {
    const d = defsOf('p5FlowField');
    expect(Object.keys(d)).toEqual(['count', 'noiseScale', 'trails', 'palette']);
    expect(d.count).toMatchObject({ value: 1200, min: 100, max: 3000, step: 100, restart: true });
    expect(d.count.kind).toBeUndefined();
    expect(d.noiseScale).toMatchObject({ value: 0.006, min: 0.001, max: 0.02 });
    expect(d.noiseScale.restart).toBeUndefined();
    expect(d.trails).toMatchObject({ kind: 'toggle', value: 1 });
    expect(d.palette).toMatchObject({ kind: 'choice', value: 0, options: ['Ocean', 'Ember', 'Moss'] });
    const code = P5_EXAMPLE_SKETCHES.p5FlowField.code;
    expect(code).not.toMatch(/createSlider|createCheckbox|createSelect/);
    expect(code).toContain("countSlider = control('count');");
  });

  it('fountain: gravity, declared in sketch.js while the class and forces live in their own tabs', () => {
    const sk = P5_EXAMPLE_SKETCHES.p5MultiFile;
    expect(sk.files.map(f => f.name)).toEqual(['particle.js', 'forces.js']);
    const d = defsOf('p5MultiFile');
    expect(Object.keys(d)).toEqual(['gravity']);
    expect(d.gravity).toMatchObject({ value: 0.12, min: 0, max: 0.4, step: 0.01 });
    expect(d.gravity.restart).toBeUndefined();
  });

  it('shapes in orbit: speed, on a 3D layer', () => {
    expect(P5_EXAMPLE_SKETCHES.p5Webgl.mode).toBe('3d');
    const d = defsOf('p5Webgl');
    expect(Object.keys(d)).toEqual(['speed']);
    expect(d.speed).toMatchObject({ value: 1, min: 0, max: 3, step: 0.1 });
  });

  it('moving the count asks the sketch to start over; the other controls do not', () => {
    const { st, defs } = run('p5FlowField', 1, { count: 300 });
    const layer = fakeCanvas(W, H);
    const step = (i: number, params: Record<string, unknown>) => klSketchStep(st, {
      ctx: layer.getContext(), width: W, height: H, dpr: 1, time: i / 60, dt: 1 / 60, frame: i,
      params: { ...Object.fromEntries(defs.map(d => [d.key, d.value])), count: 300, ...params }, state: st.state,
      mouse: { x: 0, y: 0, over: false, down: false }, picture: { brightness: () => 0 }, null: () => null, random: kp5Lcg(1),
    } as never, defs, false);
    expect(step(1, { noiseScale: 0.015, trails: 0, palette: 2 })).toBeNull();
    expect(st.wantRestart).toBe(false);
    step(2, { count: 500 });
    expect(st.wantRestart).toBe(true);
  });
});
