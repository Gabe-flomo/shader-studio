/**
 * Curves and Threshold (nodes/definitions/curves.ts, docs/curves.md): the monotone cubic, the lookup
 * table, the presets, the emitted GLSL run on the CPU (glslEval.ts) against the JS mirror (Master,
 * then each channel), the points as live uniforms (a drag is no recompile), and Threshold's soft edge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import { getNodeDefinition } from '../../nodes/definitions';
import {
  CURVES_PRESETS, applyCurves, bakeCurveLut, curvePatch, curvePoints, curveTangents, curvesParams, curvesPresetParams, evalCurve, readLut,
  thresholdMask, type CurvePoint,
} from '../../nodes/definitions/curves';
import { patchNodeParamsForUniforms } from '../uniformPatcher';
import { n } from '../../store/graphBuilder';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { runGlsl, type Val } from './glslEval';

const smoothstep = (a: Val, b: Val, x: Val) => { const t = Math.min(Math.max(((x as number) - (a as number)) / ((b as number) - (a as number)), 0), 1); return t * t * (3 - 2 * t); };
const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

const S: CurvePoint[] = [[0, 0], [0.25, 0.17], [0.75, 0.84], [1, 1]];

describe('the monotone cubic', () => {
  it('passes through every point and holds the end heights past them', () => {
    const pts: CurvePoint[] = [[0.1, 0.2], [0.3, 0.25], [0.6, 0.9], [0.8, 0.95]];
    for (const [x, y] of pts) expect(evalCurve(pts, x)).toBeCloseTo(y, 9);
    expect(evalCurve(pts, 0)).toBeCloseTo(0.2, 9);
    expect(evalCurve(pts, 1)).toBeCloseTo(0.95, 9);
  });
  it('never overshoots: monotone between monotone points, and inside each pair where they turn back', () => {
    // Steep then flat: a plain Catmull-Rom spline rises above 0.9 here
    const steep: CurvePoint[] = [[0, 0], [0.1, 0.85], [0.2, 0.9], [1, 0.92]];
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const y = evalCurve(steep, i / 1000);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(y).toBeLessThanOrEqual(0.92 + 1e-12);
      prev = y;
    }
    const zig: CurvePoint[] = [[0, 0.2], [0.3, 0.9], [0.5, 0.1], [1, 0.6]];
    for (let k = 0; k < zig.length - 1; k++) {
      const lo = Math.min(zig[k][1], zig[k + 1][1]), hi = Math.max(zig[k][1], zig[k + 1][1]);
      for (let i = 0; i <= 100; i++) {
        const x = zig[k][0] + (zig[k + 1][0] - zig[k][0]) * i / 100;
        const y = evalCurve(zig, x);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
    // Flat where the points turn back
    expect(curveTangents(zig)[1]).toBe(0);
    expect(curveTangents(zig)[2]).toBe(0);
  });
  it('the diagonal stays the diagonal; Linear joins the points with straight lines', () => {
    for (const x of [0, 0.13, 0.5, 0.97, 1]) expect(evalCurve([[0, 0], [1, 1]], x)).toBeCloseTo(x, 9);
    expect(evalCurve([[0, 0], [0.5, 1], [1, 0]], 0.25, true)).toBeCloseTo(0.5, 9);
  });
});

describe('the lookup table', () => {
  it('samples the curve evenly from 0 to 1, and reads back between samples', () => {
    const lut = bakeCurveLut(S, false, 64);
    expect(lut.length).toBe(64);
    expect(lut[0]).toBeCloseTo(0, 6);
    expect(lut[63]).toBeCloseTo(1, 6);
    for (const x of [0.1, 0.33, 0.5, 0.8]) expect(readLut(lut, x)).toBeCloseTo(evalCurve(S, x), 2);
    expect(readLut(bakeCurveLut(S, false, 256), 0.25)).toBeCloseTo(0.17, 3);
  });
});

describe('params and presets', () => {
  it('a curve is stored as sorted [x, y, slope] points; removed points are cleared', () => {
    const p = curvePatch('r', [[0.75, 0.84], [0, 0], [1, 1], [0.25, 0.17]], false, 6);
    expect(p.cr0).toEqual([0, 0, expect.any(Number)]);
    expect((p.cr1 as number[]).slice(0, 2)).toEqual([0.25, 0.17]);
    expect(p.cr4).toBeUndefined();
    expect('cr4' in p && 'cr5' in p).toBe(true);
    expect(p.crLin).toBe(0);
    expect(curvePoints({ ...p }, 'r')).toEqual(S);
  });
  it('every preset sets all five curves; Invert, Posterize and Cross-process do what they say', () => {
    for (const pr of CURVES_PRESETS) {
      const params = curvesPresetParams(pr.value)!;
      for (const c of ['m', 'r', 'g', 'b', 'a']) expect(params[`c${c}0`]).toBeDefined();
    }
    const inv = curvesPresetParams('invert')!;
    expect(applyCurves(inv, [0.2, 0.5, 0.9, 1]).map(v => +v.toFixed(6))).toEqual([0.8, 0.5, 0.1, 1]);
    const post = curvesPresetParams('posterize')!;
    expect(post.cmLin).toBe(1);
    for (const [x, y] of [[0.1, 0], [0.4, 1 / 3], [0.6, 2 / 3], [0.9, 1]]) expect(applyCurves(post, [x, 0, 0, 1])[0]).toBeCloseTo(y, 6);
    const cross = applyCurves(curvesPresetParams('cross')!, [0.5, 0.5, 0.5, 1]);
    expect(new Set(cross.slice(0, 3).map(v => v.toFixed(3))).size).toBe(3);
    const s = applyCurves(curvesPresetParams('contrast')!, [0.2, 0.5, 0.8, 1]);
    expect(s[0]).toBeLessThan(0.2); expect(s[2]).toBeGreaterThan(0.8);
  });
});

/** Curves' emitted GLSL run on the CPU, baked (vec3 literals) or with the points as uniforms. */
function runCurves(params: Record<string, unknown>, inputs: Record<string, string>, uniforms = false) {
  const def = getNodeDefinition('curves')!;
  let node = n('curves', 'N', 0, 0, params);
  let env: Record<string, Val> = {};
  if (uniforms) {
    const r = patchNodeParamsForUniforms(node, def);
    node = r.patchedNode;
    env = r.uniforms as Record<string, Val>;
  }
  const { code, outputVars } = def.generateGLSL(node, inputs);
  const out = runGlsl(code, env);
  const get = (v: string) => (out[v] ?? runGlsl(`    float probe_ = ${v};\n`, { ...env, ...out }).probe_) as Val;
  return { color: get(outputVars.color) as number[], value: get(outputVars.value) as number, alpha: get(outputVars.alpha) as number };
}

describe('Curves GLSL', () => {
  const params = curvesParams(
    { m: [[0, 0], [0.45, 0.62], [1, 1]], r: [[0, 1], [1, 0]], g: S, a: [[0, 0], [1, 0.5]] },
  );
  for (const uniforms of [false, true]) {
    it(`matches the JS curves: Master first, then each channel (${uniforms ? 'uniforms' : 'baked'})`, () => {
      const c: [number, number, number, number] = [0.2, 0.6, 0.85, 1];
      const r = runCurves(params, { color: `vec3(${c[0]}, ${c[1]}, ${c[2]})` }, uniforms);
      const want = applyCurves(params, c);
      r.color.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
      // Red: invert(brighten(x)), not brighten(invert(x))
      const bright = (x: number) => evalCurve([[0, 0], [0.45, 0.62], [1, 1]], x);
      expect(r.color[0]).toBeCloseTo(1 - bright(0.2), 6);
      expect(r.color[0]).not.toBeCloseTo(bright(1 - 0.2), 3);
      expect(r.alpha).toBeCloseTo(0.5, 6);
      expect(r.value).toBeCloseTo(0.299 * want[0] + 0.587 * want[1] + 0.114 * want[2], 6);
    });
  }
  it('a plain Value is shaped by Master alone', () => {
    const r = runCurves(params, { value: '0.3' });
    expect(r.value).toBeCloseTo(evalCurve([[0, 0], [0.45, 0.62], [1, 1]], 0.3), 6);
  });
  it('Linear and points past the ends', () => {
    const lin = curvesParams({ m: [[0.2, 0.1], [0.8, 0.9]] }, { m: true });
    const r = runCurves(lin, { color: 'vec3(0.05, 0.5, 0.95)' }, true);
    expect(r.color[0]).toBeCloseTo(0.1, 6);
    expect(r.color[1]).toBeCloseTo(0.5, 6);
    expect(r.color[2]).toBeCloseTo(0.9, 6);
  });
  it('compiles from a texture into a valid shader', () => {
    const r = compileGraph({ nodes: [n('textureInput', 'tx', 0, 0, {}), n('curves', 'cu', 300, 0, curvesParams({ m: S }), { texture: ['tx', 'texture'] }), n('output', 'o', 600, 0, {}, { color: ['cu', 'color'] })] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(parses(r.fragmentShader)).toBeNull();
  });
});

describe('Curves points are live uniforms', () => {
  const st = () => useNodeGraphStore.getState();
  const graph = (params: Record<string, unknown>) => [
    n('uv', 'uv', 0, 0),
    n('splitVec2', 'sp', 200, 0, {}, { v: ['uv', 'uv'] }),
    n('curves', 'cu', 400, 0, params, { value: ['sp', 'x'] }),
    n('output', 'o', 700, 0, {}, { color: ['cu', 'color'] }),
  ];
  beforeEach(() => st().replaceGraph(graph(curvesParams({ m: S }))));

  it('every point and Linear switch is bound to a uniform', () => {
    for (const k of ['cm0', 'cm1', 'cm2', 'cm3', 'cmLin', 'cr0', 'cr1', 'caLin']) expect(st().paramBindings[`cu::${k}`], k).toMatch(/^u_p_\w+$/);
    expect(st().paramUniforms[st().paramBindings['cu::cm1']]).toEqual([0.25, 0.17, expect.any(Number)]);
  });
  it('dragging a point (and Linear) writes uniforms; the shader text stays the same', () => {
    const before = st().fragmentShader;
    const moved = curvePatch('m', [[0, 0], [0.3, 0.05], [0.75, 0.84], [1, 1]], false, 4);
    st().updateNodeParams('cu', moved, { immediate: true });
    expect(st().fragmentShader).toBe(before);
    expect((st().paramUniforms[st().paramBindings['cu::cm1']] as number[]).slice(0, 2)).toEqual([0.3, 0.05]);
    st().updateNodeParams('cu', curvePatch('m', [[0, 0], [0.3, 0.05], [0.75, 0.84], [1, 1]], true, 4), { immediate: true });
    expect(st().paramUniforms[st().paramBindings['cu::cmLin']]).toBe(1);
    expect(st().fragmentShader).toBe(before);
  });
  it('adding a point recompiles with one more', () => {
    const before = st().fragmentShader;
    st().updateNodeParams('cu', curvePatch('m', [...S, [0.5, 0.5]], false, 4), { immediate: true });
    expect(st().fragmentShader).not.toBe(before);
    expect(st().paramBindings['cu::cm4']).toBeDefined();
  });
});

describe('Threshold', () => {
  const run = (params: Record<string, unknown>, inputs: Record<string, string>) => {
    const def = getNodeDefinition('threshold')!;
    const { code, outputVars } = def.generateGLSL(n('threshold', 'T', 0, 0, params), inputs);
    const out = runGlsl(code, { smoothstep });
    return { mask: out[outputVars.mask] as number, color: out[outputVars.color] as number[] };
  };
  it('a soft edge Softness wide, centred on Level', () => {
    const at = (v: number) => run({ level: 0.5, softness: 0.2 }, { value: String(v.toFixed(4)) }).mask;
    expect(at(0.39)).toBe(0);
    expect(at(0.5)).toBeCloseTo(0.5, 6);
    expect(at(0.61)).toBe(1);
    expect(at(0.45)).toBeCloseTo(thresholdMask(0.45, 0.5, 0.2), 6);
    expect(at(0.45)).toBeGreaterThan(0); expect(at(0.45)).toBeLessThan(0.5);
  });
  it('Softness 0 is a hard cut; Invert, a channel, and the two Color outs', () => {
    expect(run({ level: 0.5, softness: 0 }, { value: '0.4999' }).mask).toBe(0);
    expect(run({ level: 0.5, softness: 0 }, { value: '0.5001' }).mask).toBe(1);
    expect(run({ level: 0.5, softness: 0, invert: true }, { value: '0.7' }).mask).toBe(0);
    const red = run({ mode: 'red', level: 0.5, softness: 0 }, { color: 'vec3(0.9, 0.1, 0.1)' });
    expect(red.mask).toBe(1);
    expect(red.color).toEqual([0.9, 0.1, 0.1]);
    expect(run({ level: 0.5, softness: 0, colorOut: 'bw' }, { color: 'vec3(0.9, 0.9, 0.9)' }).color).toEqual([1, 1, 1]);
    expect(run({ mode: 'blue', level: 0.5, softness: 0 }, { color: 'vec3(0.9, 0.1, 0.1)' }).color).toEqual([0, 0, 0]);
  });
});
