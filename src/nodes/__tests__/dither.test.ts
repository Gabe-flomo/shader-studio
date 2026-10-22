/**
 * Dither (nodes/definitions/dither.ts, docs/dither.md): the pattern functions, run on the CPU
 * (compiler/__tests__/glslEval.ts), give every threshold of a Bayer matrix once per tile; the emitted code, run on
 * a tile, dithers a grey to the right share of on pixels; every Pattern and Mode compiles, with live sliders.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import { compileGraph } from '../../compiler/graphCompiler';
import { DITHER_GLSL, getNodeDefinition } from '../definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';

const def = () => getNodeDefinition('dither')!;

/** The pattern functions of DITHER_GLSL as CPU functions (each body run by glslEval, calling the others). */
function patternEnv(): Env {
  const env: Env = {};
  for (const m of DITHER_GLSL.matchAll(/^float (\w+)\(vec2 a\) \{\n([\s\S]*?)\n\}/gm)) {
    const body = m[2].replace(/return /, 'float __r = ');
    env[m[1]] = (a: Val) => runGlsl(body, { ...env, a: (a as number[]).slice() }).__r as number;
  }
  return env;
}
const call = (env: Env, f: string, x: number, y: number) => (env[f] as (a: Val) => Val)([x, y]) as number;

describe('Dither patterns', () => {
  const env = patternEnv();
  it('Bayer 2×2 is the classic 0 2 / 3 1 matrix, and repeats every 2 pixels', () => {
    expect([call(env, 'ditherBayer2', 0, 0), call(env, 'ditherBayer2', 1, 0), call(env, 'ditherBayer2', 0, 1), call(env, 'ditherBayer2', 1, 1)])
      .toEqual([0, 0.5, 0.75, 0.25]);
    expect(call(env, 'ditherBayer2', 3, 5)).toBeCloseTo(call(env, 'ditherBayer2', 1, 1), 9);
  });
  for (const [f, size] of [['ditherBayer4', 4], ['ditherBayer8', 8]] as const) {
    it(`${f}: every one of the ${size * size} thresholds once per tile, and it tiles`, () => {
      const seen: number[] = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) seen.push(Math.round(call(env, f, x, y) * size * size));
      expect(seen.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: size * size }, (_, i) => i));
      expect(call(env, f, 2 + size, 3 + 2 * size)).toBeCloseTo(call(env, f, 2, 3), 9);
    });
  }
  it('blue noise, white noise and lines stay within 0..1', () => {
    for (const f of ['ditherIGN', 'ditherWhite', 'ditherLines']) {
      for (let i = 0; i < 40; i++) {
        const v = call(env, f, i * 7 + 3, i * 13 + 1);
        expect(v, f).toBeGreaterThanOrEqual(0); expect(v, f).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Dither on the CPU', () => {
  /** The node's code at each pixel of a size × size tile; returns the Mask values. */
  function tile(params: Record<string, unknown>, grey: number, size: number) {
    const { code, outputVars } = def().generateGLSL(n('dither', 'D', 0, 0, params), { color: 'IN', position: 'PX' });
    const masks: number[] = [];
    const colours: number[][] = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const out = runGlsl(code, { ...patternEnv(), IN: [grey, grey, grey], PX: [x + 0.5, y + 0.5] });
      masks.push(out[outputVars.mask] as number);
      colours.push(out[outputVars.color] as number[]);
    }
    return { masks, colours };
  }
  it('1-bit Bayer 8×8: a grey of 0.25 lights exactly a quarter of the pixels', () => {
    const { masks } = tile({ pattern: 'bayer8', mode: 'mono', levels: 2 }, 0.25, 8);
    expect(masks.every(m => m === 0 || m === 1)).toBe(true);
    expect(masks.filter(m => m === 1).length).toBe(16);
  });
  it('Strength 0 is plain rounding (flat bands, as Posterize)', () => {
    const { masks } = tile({ pattern: 'bayer4', mode: 'mono', levels: 2, strength: 0 }, 0.4, 4);
    expect(new Set(masks)).toEqual(new Set([0]));
  });
  it('Pixel size makes each dot a block of pixels', () => {
    const { masks } = tile({ pattern: 'bayer2', mode: 'mono', levels: 2, pixelSize: 2 }, 0.5, 4);
    // Pixels (0,0) (1,0) (0,1) (1,1) share one cell.
    expect(new Set([masks[0], masks[1], masks[4], masks[5]]).size).toBe(1);
  });
  it('Two colours maps the dots to Dark and Light; Four colours picks from four', () => {
    const two = tile({ pattern: 'bayer4', mode: 'two', levels: 2, darkColour: [1, 0, 0], lightColour: [0, 0, 1] }, 0.5, 4);
    expect(two.colours.every(c => (c[0] === 1 && c[2] === 0) || (c[0] === 0 && c[2] === 1))).toBe(true);
    const pal = [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0], [1, 0, 0]];
    const four = tile({ pattern: 'bayer4', mode: 'four', colour1: pal[0], colour2: pal[1], colour3: pal[2], colour4: pal[3] }, 0.5, 4);
    expect(four.colours.every(c => pal.some(p => p[0] === c[0]))).toBe(true);
    // Brightness 0.5 sits between the 2nd and 3rd colours: both appear.
    expect(new Set(four.colours.map(c => c[0]))).toEqual(new Set([0.25, 0.5]));
  });
});

describe('Dither compiles', () => {
  const graph = (params: Record<string, unknown>, out = 'color') => [
    n('uv', 'uv', 0, 0),
    n('fbm', 'f', 200, 0, {}, { uv: ['uv', 'uv'] }),
    n('palette', 'pal', 400, 0, {}, { value: ['f', 'value'] }),
    n('dither', 'd', 600, 0, params, { color: ['pal', 'color'] }),
    n('output', 'o', 800, 0, {}, { color: ['d', out] }),
  ];
  it('every Pattern × Mode, with its pattern function declared once', () => {
    const FN: Record<string, string> = { bayer2: 'ditherBayer2', bayer4: 'ditherBayer4', bayer8: 'ditherBayer8', blue: 'ditherIGN', white: 'ditherWhite', lines: 'ditherLines' };
    for (const [pattern, fn] of Object.entries(FN)) {
      for (const mode of ['colour', 'mono', 'two', 'four']) {
        const r = compileGraph({ nodes: graph({ pattern, mode }) });
        expect(r.errors ?? [], `${pattern} / ${mode}`).toEqual([]);
        expect(r.fragmentShader.match(new RegExp(`^float ${fn}\\(vec2 a\\)`, 'gm')), `${pattern} / ${mode}`).toHaveLength(1);
        expect(r.fragmentShader).toContain('gl_FragCoord.xy');
      }
    }
    // Bayer 8×8 calls the smaller ones: they are kept, and declared before it.
    const fs = compileGraph({ nodes: graph({ pattern: 'bayer8' }) }).fragmentShader;
    const at = (f: string) => fs.search(new RegExp(`^float ${f}\\(`, 'm'));
    expect(at('ditherBayer2')).toBeGreaterThan(-1);
    expect(at('ditherBayer2')).toBeLessThan(at('ditherBayer4'));
    expect(at('ditherBayer4')).toBeLessThan(at('ditherBayer8'));
  });
  it('two Dither nodes share the functions; the Mask output compiles; the sliders are live', () => {
    const r = compileGraph({ nodes: [
      ...graph({ pattern: 'blue' }).slice(0, 4),
      n('dither', 'd2', 600, 200, { pattern: 'white', mode: 'mono' }, { color: ['d', 'color'] }),
      n('output', 'o', 800, 0, {}, { color: ['d2', 'mask'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader.match(/^float ditherIGN\(vec2 a\)/gm)).toHaveLength(1);
    for (const k of ['levels', 'pixelSize', 'strength']) expect(r.paramBindings[`d::${k}`], k).toMatch(/^u_p_/);
  });
});
