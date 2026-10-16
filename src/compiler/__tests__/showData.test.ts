/**
 * Show data (nodes/definitions/showData.ts, docs/show-data.md): Heat maps Low → High through the Turbo
 * colours and flags what is outside; Direction is a hue by angle, brightness by length; Channels shows
 * channel 1–4 in the four quarters; Auto picks by what is wired; each compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { showDataMode } from '../../nodes/definitions/showData';
import { runGlsl, type Val } from './glslEval';

/** Turbo, as the GLSL computes it (the same polynomial), for expected colours. */
function turbo(x: number): number[] {
  x = Math.min(Math.max(x, 0), 1);
  const v4 = [1, x, x * x, x * x * x], v2 = [v4[2] * v4[2], v4[3] * v4[2]];
  const d4 = (k: number[]) => k.reduce((s, c, i) => s + c * v4[i], 0), d2 = (k: number[]) => k[0] * v2[0] + k[1] * v2[1];
  return [
    d4([0.13572138, 4.61539260, -42.66032258, 132.13108234]) + d2([-152.94239396, 59.28637943]),
    d4([0.09140261, 2.19418839, 4.84296658, -14.18503333]) + d2([4.27729857, 2.82956604]),
    d4([0.10667330, 12.64194608, -60.58204836, 110.36276771]) + d2([-89.90310912, 27.34824973]),
  ];
}
const sdTurbo = (x: Val) => turbo(x as number);
const step = (e: Val, x: Val) => (x as number[]).map((v, i) => (v < (e as number[])[i] ? 0 : 1));
function show(params: Record<string, unknown>, inputs: Record<string, string>, env: Record<string, Val> = {}) {
  const node = n('showData', 'D', 0, 0, params);
  const { code, outputVars } = getNodeDefinition('showData')!.generateGLSL(node, inputs);
  return runGlsl(code, { sdTurbo, step, u_resolution: [800, 800], ...env })[outputVars.color] as number[];
}

describe('Show data', () => {
  it('Heat: Low → High through Turbo; above High white, below Low darker', () => {
    show({ low: 0, high: 10, mode: 'heat' }, { value: '5.0' }).forEach((c, i) => expect(c).toBeCloseTo(turbo(0.5)[i], 5));
    expect(show({ low: 0, high: 10, mode: 'heat' }, { value: '12.0' })).toEqual([1, 1, 1]);
    show({ low: 0, high: 10, mode: 'heat' }, { value: '-3.0' }).forEach((c, i) => expect(c).toBeCloseTo(turbo(0)[i] * 0.4, 5));
  });
  it('Direction: hue by angle, brightness by length × Scale', () => {
    const right = show({ mode: 'direction', scale: 1 }, { vector: 'vec2(1.0, 0.0)' });
    right.forEach((c, i) => expect(c).toBeCloseTo(0.5 + 0.5 * Math.cos([0, -2.0943951, 2.0943951][i]), 5));
    const half = show({ mode: 'direction', scale: 0.5 }, { vector: 'vec2(1.0, 0.0)' });
    half.forEach((c, i) => expect(c).toBeCloseTo(right[i] * 0.5, 5));
  });
  it('Channels: channel 1 top left, 2 top right, 3 bottom left, 4 bottom right', () => {
    const at = (uv: number[]) => show({ mode: 'channels', low: 0, high: 4, flag: false }, { channels: 'vec4(1.0, 2.0, 3.0, 4.0)' }, { g_uv: uv });
    expect(at([-0.5, 0.5])).toEqual(turbo(0.25));
    expect(at([0.5, 0.5])).toEqual(turbo(0.5));
    expect(at([-0.5, -0.5])).toEqual(turbo(0.75));
    expect(at([0.5, -0.5])).toEqual(turbo(1));
  });
  it('Auto picks by what is wired', () => {
    const node = n('showData', 'D', 0, 0, {});
    expect(showDataMode(node, { vector: 'v' })).toBe('direction');
    expect(showDataMode(node, { texture: 't' })).toBe('channels');
    expect(showDataMode(node, { value: 'x' })).toBe('heat');
  });
  it('compiles from a number, a vector, a Trail-like vec4 and a texture', () => {
    for (const [key, src] of [['value', ['nz', 'value']], ['vector', ['uvn', 'uv']], ['channels', ['v4', 'xyzw']], ['texture', ['tx', 'texture']]] as const) {
      const r = compileGraph({ nodes: [
        n('noiseFloat', 'nz', 0, 0, {}), n('uv', 'uvn', 0, 100, {}), n('makeVec4', 'v4', 0, 200, {}), n('textureInput', 'tx', 0, 300, {}),
        n('showData', 'sd', 300, 0, {}, { [key]: [src[0], src[1]] }),
        n('output', 'o', 600, 0, {}, { color: ['sd', 'color'] }),
      ] });
      expect(r.errors, `${key}: ${JSON.stringify(r.errors)}`).toBeUndefined();
    }
  });
});
