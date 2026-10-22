/**
 * Convolve (nodes/definitions/convolve.ts, docs/convolve.md): the preset kernels are what the docs say; the emitted
 * GLSL, run on the CPU (compiler/__tests__/glslEval.ts) over a field, is the weighted sum of the JS kernel for every
 * preset and size; Custom's weights are live uniforms; a field is called at the offsets, a texture read at texel
 * offsets; every preset × size × source compiles to an Output with no errors.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, getNodeDefinitionFor } from '../definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';
import type { GraphNode } from '../../types/nodeGraph';
import {
  CONVOLVE_PRESETS, cellOffset, convolveKernel, convolveSourceNote, embossKernel, fixedKernel, kernelCells, kernelKey, motionKernel, unsharpKernel,
  type ConvolvePreset,
} from '../definitions/convolve';

const def = () => getNodeDefinition('convolve')!;
const sum = (k: number[]) => k.reduce((a, b) => a + b, 0);
const SIZES = [3, 5] as const;

describe('Convolve\'s kernels are what the docs say', () => {
  it('Sharpen: the 3 × 3 cross with 5 in the middle; both sizes add up to 1', () => {
    const k = fixedKernel('sharpen', 3);
    expect([k[7], k[11], k[12], k[13], k[17]]).toEqual([-1, -1, 5, -1, -1]);
    expect([k[6], k[8], k[16], k[18]]).toEqual([0, 0, 0, 0]);
    for (const s of SIZES) expect(sum(fixedKernel('sharpen', s))).toBeCloseTo(1, 10);
  });
  it('Outline (Laplacian): −1 all round, size² − 1 in the middle, adding up to 0', () => {
    for (const s of SIZES) {
      const k = fixedKernel('outline', s);
      expect(k[12]).toBe(s * s - 1);
      expect(sum(k)).toBe(0);
    }
  });
  it('Edge X / Y (Sobel): the 3 × 3 tables, adding up to 0; X rises to the right, Y upwards', () => {
    const x = fixedKernel('edgeX', 3), y = fixedKernel('edgeY', 3);
    expect([x[6], x[7], x[8], x[11], x[12], x[13], x[16], x[17], x[18]]).toEqual([-1, 0, 1, -2, 0, 2, -1, 0, 1]);
    expect([y[6], y[7], y[8], y[11], y[12], y[13], y[16], y[17], y[18]]).toEqual([1, 2, 1, 0, 0, 0, -1, -2, -1]);
    for (const s of SIZES) for (const p of ['edgeX', 'edgeY'] as const) {
      const k = fixedKernel(p, s);
      expect(sum(k)).toBeCloseTo(0, 12);
      // A ramp of 1 per read (rising right for X, up for Y) reads as 8 through both sizes.
      const ramp = kernelCells(s).reduce((a, i) => a + k[i] * cellOffset(i)[p === 'edgeX' ? 0 : 1], 0);
      expect(ramp).toBeCloseTo(8, 10);
    }
  });
  it('Box and Gaussian blur add up to 1; Box is even, Gaussian peaks in the middle (4/16, 36/256)', () => {
    for (const s of SIZES) {
      expect(sum(fixedKernel('box', s))).toBeCloseTo(1, 12);
      expect(sum(fixedKernel('gaussian', s))).toBeCloseTo(1, 12);
      for (const i of kernelCells(s)) expect(fixedKernel('box', s)[i]).toBeCloseTo(1 / (s * s), 12);
    }
    expect(fixedKernel('gaussian', 3)[12]).toBe(4 / 16);
    expect(fixedKernel('gaussian', 5)[12]).toBe(36 / 256);
  });
  it('Emboss adds up to 1 at any angle; the reads towards the light are negative', () => {
    for (const s of SIZES) for (const a of [0, 45, 135, 200]) expect(sum(embossKernel(s, a))).toBeCloseTo(1, 10);
    const k = embossKernel(3, 135); // light from the top left
    expect(k[6]).toBeLessThan(0); expect(k[18]).toBeGreaterThan(0); expect(k[12]).toBe(1);
  });
  it('Motion blur adds up to 1 and lies along its angle', () => {
    for (const s of SIZES) for (const a of [0, 30, 90, 135]) expect(sum(motionKernel(s, a))).toBeCloseTo(1, 10);
    const k = motionKernel(3, 0);
    expect([k[11], k[12], k[13]].every(w => Math.abs(w - 1 / 3) < 1e-12)).toBe(true);
    expect(k[7]).toBe(0);
  });
  it('Unsharp mask adds up to 1: 1 + Amount in the middle less Amount × a blur', () => {
    for (const s of SIZES) expect(sum(unsharpKernel(s, 1.5, 1))).toBeCloseTo(1, 10);
    expect(sum(unsharpKernel(3, 0, 1).map(Math.abs))).toBeCloseTo(1, 10);
  });
  it('Custom: the params, only the middle 9 for 3 × 3; the default is the picture unchanged', () => {
    const k = convolveKernel({ preset: 'custom', size: '3', k0: 9, k11: 1 });
    expect(k[0]).toBe(0); expect(k[11]).toBe(1); expect(k[12]).toBe(1);
    expect(convolveKernel({ preset: 'custom', size: '5', k0: 9 })[0]).toBe(9);
  });
});

// ── The GLSL on the CPU ─────────────────────────────────────────────────────

/** A colour field on a lattice of reads 0.01 apart (Spacing 1 at a 200-pixel-high picture). */
const h = (q: number[]) => { const i = Math.round(q[0] / 0.01), j = Math.round(q[1] / 0.01); return Math.sin(i * 1.7 + j * 0.9) + 0.3 * i - 0.1 * j * j; };
const field = (q: Val) => { const v = h(q as number[]); return [v, 2 * v, 0.5]; };
const env = (): Env => ({ fieldfn_p_c: field, g_uv: [0.03, -0.02], u_resolution: [200, 200] });

function run(params: Record<string, unknown>) {
  const node = n('convolve', 'N', 0, 0, params);
  const { code, outputVars } = def().generateGLSL(node, { colour: 'fieldfn_p_c' });
  const out = runGlsl(code, env());
  return { colour: out[outputVars.colour] as number[], luma: out[outputVars.luma] as number };
}
function expected(params: Record<string, unknown>) {
  const k = convolveKernel(params);
  let r = 0;
  for (let i = 0; i < 25; i++) { const [x, y] = cellOffset(i); r += k[i] * h([0.03 + x * 0.01, -0.02 + y * 0.01]); }
  return r;
}

describe('Convolve\'s GLSL is the weighted sum of its kernel', () => {
  const cases: Array<Record<string, unknown>> = [];
  for (const preset of CONVOLVE_PRESETS) for (const size of ['3', '5']) cases.push({ preset, size, angle: 30, amount: 1.3, radius: 0.8 });
  cases.push({ preset: 'custom', size: '5', normalize: false, ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [kernelKey(i), (i % 7) - 3])) });
  for (const c of cases) {
    it(`${c.preset} ${c.size} × ${c.size}`, () => {
      const r = run(c);
      const e = expected(c);
      expect(r.colour[0]).toBeCloseTo(e, 6);
      expect(r.colour[1]).toBeCloseTo(2 * e, 6);
    });
  }
  it('Normalize divides Custom by the sum of its weights (not when it is 0)', () => {
    const w = { preset: 'custom', size: '3', k11: 2, k12: 2, k13: 0 };
    expect(run({ ...w, normalize: true }).colour[0]).toBeCloseTo(expected(w) / 4, 6);
    const zero = { preset: 'custom', size: '3', k11: -1, k12: 0, k13: 1 };
    expect(run({ ...zero, normalize: true }).colour[0]).toBeCloseTo(expected(zero), 6);
  });
  it('Absolute value, then Add bias, then Mix with the original; Luma is the result\'s brightness', () => {
    const base = { preset: 'edgeX', size: '3' };
    const e = expected(base);
    const r = run({ ...base, absolute: true, bias: 0.5, mix: 0.25 });
    const orig = h([0.03, -0.02]);
    expect(r.colour[0]).toBeCloseTo(orig + (Math.abs(e) + 0.5 - orig) * 0.25, 6);
    expect(r.luma).toBeCloseTo(r.colour[0] * 0.299 + r.colour[1] * 0.587 + r.colour[2] * 0.114, 6);
  });
});

describe('Convolve\'s sources', () => {
  it('a field: the function is called at each offset, Spacing pixels apart; fixed presets skip the zero weights', () => {
    const { code } = def().generateGLSL(n('convolve', 'N', 0, 0, { preset: 'sharpen', size: '3' }), { colour: 'fieldfn_f_c', uv: 'myUv' });
    expect(code).toContain('vec2 N_q = myUv;');
    expect(code).toContain('float N_e = 1.0 * 2.0 / u_resolution.y;');
    for (const o of ['vec2(1.0, 0.0)', 'vec2(-1.0, 0.0)', 'vec2(0.0, 1.0)', 'vec2(0.0, -1.0)']) expect(code).toContain(`fieldfn_f_c(N_q + ${o} * N_e, vec2(0.0), 1.0, 0.0)`);
    expect(code.split('fieldfn_f_c(').length - 1).toBe(5); // the middle and the four of the cross
  });
  it('a texture: read at texel offsets (its _px uniform × Spacing), before Colour', () => {
    const { code } = def().generateGLSL(n('convolve', 'N', 0, 0, { preset: 'box', size: '5', spacing: 2 }), { texture: 'u_pass_a', colour: 'fieldfn_f_c' });
    expect(code).toContain('vec2 N_d = u_pass_a_px * 2.0;');
    expect(code).toContain('texture2D(u_pass_a, N_st + vec2(-2.0, 2.0) * N_d).rgb');
    expect(code.split('texture2D(').length - 1).toBe(25);
    expect(code).not.toContain('fieldfn_');
  });
  it('a plain value (a chain that can\'t be a function) passes through; nothing wired is black', () => {
    expect(def().generateGLSL(n('convolve', 'N', 0, 0, {}), { colour: 'ec_color' }).code).toContain('vec3 N_out = ec_color;');
    expect(def().generateGLSL(n('convolve', 'N', 0, 0, {}), {}).code).toContain('vec3 N_out = vec3(0.0);');
  });
  it('the card says where the neighbours come from', () => {
    const nz = n('noise', 'nz', 0, 0, {});
    const echo = n('echo', 'ec', 0, 0, {});
    const viaNoise = n('convolve', 'c', 0, 0, {}, { colour: ['nz', 'colour'] });
    const viaEcho = n('convolve', 'c', 0, 0, {}, { colour: ['ec', 'color'] });
    expect(convolveSourceNote(viaNoise, [nz, viaNoise], getNodeDefinitionFor)).toMatch(/again at each neighbour/);
    expect(convolveSourceNote(viaEcho, [echo, viaEcho], getNodeDefinitionFor)).toMatch(/passes through unchanged/);
    expect(convolveSourceNote(n('convolve', 'c', 0, 0, {}), [], getNodeDefinitionFor)).toMatch(/^Wire a Texture/);
  });
});

describe('Convolve compiles', () => {
  const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));
  const sources: Record<string, () => { nodes: GraphNode[]; wire: Record<string, [string, string]> }> = {
    field: () => ({ nodes: [n('uv', 'uv', 0, 0), n('noise', 'nz', 0, 0, { dims: '2d' }, { uv: ['uv', 'uv'] })], wire: { colour: ['nz', 'colour'] } }),
    picture: () => ({ nodes: [n('textureInput', 'tx', 0, 0, {})], wire: { colour: ['tx', 'color'] } }),
    texture: () => ({
      nodes: [n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }), n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }), n('pass', 'pa', 0, 0, {}, { color: ['rgb', 'rgb'] })],
      wire: { texture: ['pa', 'texture'] },
    }),
    previousFrame: () => ({ nodes: [n('echo', 'ec', 0, 0, {})], wire: { colour: ['ec', 'color'] } }),
  };
  for (const [src, make] of Object.entries(sources)) {
    for (const preset of CONVOLVE_PRESETS as readonly ConvolvePreset[]) for (const size of ['3', '5']) {
      it(`${preset} ${size} × ${size} from ${src}`, () => {
        const s = make();
        const r = compileGraph({ nodes: [
          ...s.nodes,
          n('convolve', 'cv', 400, 0, { preset, size, absolute: preset === 'outline', bias: preset === 'emboss' ? 0.5 : 0 }, s.wire),
          n('output', 'o', 700, 0, {}, { color: ['cv', 'colour'] }),
        ] });
        expect(r.errors ?? [], `${preset} ${size} ${src}`).toEqual([]);
        if (src === 'field' || src === 'picture') expect(r.fragmentShader).toMatch(/^vec3 fieldfn_\w+\(vec2 g_uv/m);
        if (src === 'previousFrame') expect(r.fragmentShader).not.toMatch(/fieldfn_/);
        if (src === 'texture') expect(mainOf(r.fragmentShader)).toMatch(/_px \* /);
      });
    }
  }
  it('Custom\'s weights are live uniforms (the middle 9 for 3 × 3), as are the sliders; a preset\'s weights are not', () => {
    const graph = (params: Record<string, unknown>) => compileGraph({ nodes: [
      n('uv', 'uv', 0, 0), n('noise', 'nz', 0, 0, {}, { uv: ['uv', 'uv'] }),
      n('convolve', 'cv', 400, 0, params, { colour: ['nz', 'colour'] }),
      n('output', 'o', 700, 0, {}, { color: ['cv', 'colour'] }),
    ] });
    const r = graph({ preset: 'custom', size: '3' });
    expect(r.errors ?? []).toEqual([]);
    for (const i of kernelCells(3)) expect(r.paramBindings[`cv::${kernelKey(i)}`], `k${i}`).toMatch(/^u_p_/);
    expect(r.paramBindings['cv::k0']).toBeUndefined();
    for (const k of ['spacing', 'mix', 'bias']) expect(r.paramBindings[`cv::${k}`], k).toMatch(/^u_p_/);
    const r5 = graph({ preset: 'custom', size: '5' });
    expect(Object.keys(r5.paramBindings).filter(k => /^cv::k\d+$/.test(k))).toHaveLength(25);
    const sharp = graph({ preset: 'sharpen' });
    expect(Object.keys(sharp.paramBindings).filter(k => /^cv::k\d+$/.test(k))).toHaveLength(0);
    const emb = graph({ preset: 'emboss' });
    expect(emb.paramBindings['cv::angle']).toMatch(/^u_p_/);
    const un = graph({ preset: 'unsharp' });
    for (const k of ['amount', 'radius']) expect(un.paramBindings[`cv::${k}`], k).toMatch(/^u_p_/);
  });
  it('the Luma output compiles too', () => {
    const r = compileGraph({ nodes: [
      n('uv', 'uv', 0, 0), n('noise', 'nz', 0, 0, {}, { uv: ['uv', 'uv'] }),
      n('convolve', 'cv', 400, 0, { preset: 'outline' }, { colour: ['nz', 'colour'] }),
      n('floatToVec3', 'g', 600, 0, {}, { input: ['cv', 'luma'] }),
      n('output', 'o', 700, 0, {}, { color: ['g', 'rgb'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
  });
});
