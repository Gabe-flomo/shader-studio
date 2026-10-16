/**
 * Random (from ID) (nodes/definitions/randomFromId.ts): the same ID gives the same number, neighbours
 * unrelated ones, From/To set the range, Seed another set; a 2D ID or a number works too; it compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Val } from './glslEval';

const fract = (x: number) => x - Math.floor(x);
const hash = (id: number[], seed: number) => fract(Math.sin((id[0] + seed * 1.618) * 12.9898 + (id[1] + seed * 2.718) * 78.233 + (id[2] + seed * 3.142) * 37.719) * 43758.5453);
const rfiHash = (id: Val, seed: Val) => hash(id as number[], seed as number);
function rand(params: Record<string, unknown>, inputs: Record<string, string>) {
  const { code, outputVars } = getNodeDefinition('randomFromId')!.generateGLSL(n('randomFromId', 'R', 0, 0, params), inputs);
  const out = runGlsl(code, { rfiHash });
  return { value: out[outputVars.value] as number, colour: out[outputVars.colour] as number[] };
}

describe('Random (from ID)', () => {
  it('is steady per ID, different for a neighbour, and runs From → To', () => {
    const a = rand({}, { id: 'vec3(3.0, 1.0, 2.0)' }).value;
    expect(rand({}, { id: 'vec3(3.0, 1.0, 2.0)' }).value).toBe(a);
    expect(rand({}, { id: 'vec3(4.0, 1.0, 2.0)' }).value).not.toBeCloseTo(a, 3);
    expect(a).toBeCloseTo(hash([3, 1, 2], 0), 6);
    expect(rand({ from: 2, to: 4 }, { id: 'vec3(3.0, 1.0, 2.0)' }).value).toBeCloseTo(2 + 2 * a, 6);
    expect(rand({ seed: 5 }, { id: 'vec3(3.0, 1.0, 2.0)' }).value).toBeCloseTo(hash([3, 1, 2], 5), 6);
  });
  it('a 2D ID or a number is padded with zeros; Random colour is three numbers 0–1', () => {
    expect(rand({}, { id2: 'vec2(3.0, 1.0)' }).value).toBeCloseTo(hash([3, 1, 0], 0), 6);
    expect(rand({}, { n: '7.0' }).value).toBeCloseTo(hash([7, 0, 0], 0), 6);
    const c = rand({}, { id: 'vec3(1.0, 2.0, 3.0)' }).colour;
    c.forEach(x => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
  });
  it('compiles from Grid Layout\'s Cell ID', () => {
    const r = compileGraph({ nodes: [
      n('uv', 'uv', 0, 0, {}), n('gridLayout', 'grid', 200, 0, {}, { uv: ['uv', 'uv'] }),
      n('randomFromId', 'rnd', 400, 0, {}, { id2: ['grid', 'cellID'] }),
      n('output', 'o', 600, 0, {}, { color: ['rnd', 'colour'] }),
    ] });
    expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  });
});

describe('Jump flood (texture) plumbing', () => {
  const jf = (inputs: Record<string, string>, params: Record<string, unknown> = {}) =>
    getNodeDefinition('jumpFloodTexture')!.generateGLSL(n('jumpFloodTexture', 'J', 0, 0, params), { texture: 'u_tex', ...inputs }).code;
  it('works its reach out from the Pass\'s Step and Steps; a wired Reach wins', () => {
    expect(jf({ step: 'st', steps: 'sn' })).toContain('exp2(sn - st)');
    expect(jf({ step: 'st', steps: 'sn', reach: 'rr' })).not.toContain('exp2');
    expect(jf({}, { reach: 4 })).not.toContain('exp2');
  });
  it('gives Start on step 0 and the flood after it', () => {
    expect(jf({ step: 'st', steps: 'sn', start: 'seeds' })).toContain('J_seed = st < 0.5 ? seeds : J_seed;');
    expect(jf({ start: 'seeds' })).not.toContain('seeds');
  });
});
