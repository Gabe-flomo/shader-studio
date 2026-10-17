/**
 * Bounds and Glitch (nodes/definitions/bounds.ts, glitch.ts): the emitted GLSL run on the CPU
 * (glslEval.ts) for each Bounds behaviour on numbers and vectors, the type following the pills,
 * and every Glitch mode for texture and colour inputs (swap exact, Amount 0 untouched); their
 * examples compile.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import { getNodeDefinition } from '../../nodes/definitions';
import { retypeBounds } from '../../nodes/definitions/bounds';
import { retypeGlitch } from '../../nodes/definitions/glitch';
import { VECTORIZABLE_NODES } from '../../nodes/definitions/math';
import { socketsAs } from '../../components/NodeGraph/wireFit';
import { n } from '../../store/graphBuilder';
import { buildPictureExamples } from '../../store/pictureExamples';
import { buildBoundsExamples } from '../../store/boundsExamples';
import { runGlsl, type Val } from './glslEval';

const step = (e: Val, x: Val): Val => (Array.isArray(x) || Array.isArray(e)
  ? (Array.isArray(x) ? x : (e as number[]).map(() => x as number)).map((xi, i) => (xi >= (Array.isArray(e) ? e[i] : e as number) ? 1 : 0))
  : ((x as number) >= (e as number) ? 1 : 0));
const cross = (a: Val, b: Val): Val => { const [x, y, z] = a as number[], [u, v, w] = b as number[]; return [y * w - z * v, z * u - x * w, x * v - y * u]; };
const fract = (x: number) => x - Math.floor(x);
/** rfiHash as the GLSL writes it (randomFromId.ts). */
const rfiHash = (id: Val, seed: Val): Val => {
  const s = seed as number, k = [1.618, 2.718, 3.142], d = [12.9898, 78.233, 37.719];
  const q = (id as number[]).map((x, i) => x + s * k[i]);
  return fract(Math.sin(q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) * 43758.5453);
};

function run(type: string, params: Record<string, unknown>, inputs: Record<string, string>, env: Record<string, Val | ((...a: Val[]) => Val)> = {}) {
  const node = n(type, 'N', 0, 0, params);
  const { code, outputVars } = getNodeDefinition(type)!.generateGLSL(node, inputs);
  const out = runGlsl(code, { step, cross, rfiHash, ...env });
  return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, (out[v] as Val | undefined) ?? evalExpr(v, out)])) as Record<string, Val>;
}
function evalExpr(e: string, env: Record<string, unknown>): Val {
  // An output that is an expression (Inside of a vector, a broadcast 1): declared as whatever it is.
  const r = runGlsl(`    vec4 probe_ = vec4(${e});\n`, { ...env } as never).probe_ as number[];
  return /^(vec2|vec3)\(1\.0\)$/.test(e) ? (r.slice(0, e.startsWith('vec2') ? 2 : 3)) : r[0];
}

const lit = (x: number[] | number) => (Array.isArray(x) ? `vec${x.length}(${x.map(v => v.toFixed(6)).join(', ')})` : `${x.toFixed(6)}`);

/** JS mirror of each behaviour, per axis. */
function mirror(mode: string, x: number, lo: number, hi: number, soft = 0.3): { v: number; d: number; ins: number } {
  const sz = Math.max(hi - lo, 1e-6);
  const mod = (a: number, b: number) => a - b * Math.floor(a / b);
  if (mode === 'clip') return { v: Math.min(Math.max(x, lo), hi), d: 1, ins: x >= lo && x <= hi ? 1 : 0 };
  if (mode === 'wrap') return { v: lo + mod(x - lo, sz), d: 1, ins: x >= lo && x <= hi ? 1 : 0 };
  if (mode === 'bounce') { const m = mod(x - lo, 2 * sz); return { v: hi - Math.abs(m - sz), d: m >= sz ? -1 : 1, ins: x >= lo && x <= hi ? 1 : 0 }; }
  const k = Math.max(soft * 0.5 * sz, 1e-6);
  const ov = Math.max(x - (hi - k), 0), un = Math.max(lo + k - x, 0);
  return { v: Math.min(Math.max(x, lo + k), hi - k) + k * (Math.exp(-un / k) - Math.exp(-ov / k)), d: 1, ins: Math.exp(-(Math.max(lo - x, 0) + Math.max(x - hi, 0)) / k) };
}

describe('Bounds', () => {
  const xs = [-37.3, -2.5, -1, -0.2, 0, 0.3, 0.999, 1, 1.4, 2, 3.7, 1000.25];
  it.each(['clip', 'wrap', 'bounce', 'soft'])('%s on a number: negative values, large overshoots, Inside and Direction', mode => {
    for (const x of xs) {
      const r = run('bounds', { behaviour: mode, min: -0.5, max: 1.5 }, { value: lit(x) });
      const m = mirror(mode, x, -0.5, 1.5);
      expect(r.value as number, `${mode} ${x}`).toBeCloseTo(m.v, 3);
      expect(r.inside as number, `${mode} ${x} inside`).toBeCloseTo(m.ins, 5);
      expect(r.direction as number, `${mode} ${x} direction`).toBe(m.d);
    }
  });
  it('the bounded value always stays inside', () => {
    for (const mode of ['clip', 'wrap', 'bounce', 'soft']) for (const x of xs) {
      const v = run('bounds', { behaviour: mode, min: -0.5, max: 1.5 }, { value: lit(x) }).value as number;
      expect(v).toBeGreaterThanOrEqual(-0.5 - 1e-4);
      expect(v).toBeLessThanOrEqual(1.5 + 1e-4);
    }
  });
  it('Bounce ping-pongs: forward, back at the wall (Direction −1), forward again', () => {
    const at = (x: number) => run('bounds', { behaviour: 'bounce', min: 0, max: 1 }, { value: lit(x) });
    expect(at(0.25).value).toBeCloseTo(0.25, 6); expect(at(0.25).direction).toBe(1);
    expect(at(1.25).value).toBeCloseTo(0.75, 6); expect(at(1.25).direction).toBe(-1);
    expect(at(2.25).value).toBeCloseTo(0.25, 6); expect(at(2.25).direction).toBe(1);
    expect(at(-0.25).value).toBeCloseTo(0.25, 6); expect(at(-0.25).direction).toBe(-1);
    expect(at(-1.75).value).toBeCloseTo(0.25, 6); expect(at(-1.75).direction).toBe(1);
    // A velocity × Direction flips at each wall: the bounded position's slope matches it.
    for (const x of [0.4, 1.6, 2.3, -0.6, 57.31]) {
      const a = at(x), b = at(x + 1e-3);
      expect(((b.value as number) - (a.value as number)) / 1e-3).toBeCloseTo(a.direction as number, 2);
    }
  });
  it('Wrap comes back in on the other side; Clip stops; Soft eases (identity in the middle, never past the edge)', () => {
    expect(run('bounds', { behaviour: 'wrap', min: 0, max: 1 }, { value: '-0.25' }).value).toBeCloseTo(0.75, 6);
    expect(run('bounds', { behaviour: 'wrap', min: 0, max: 1 }, { value: '7.5' }).value).toBeCloseTo(0.5, 6);
    expect(run('bounds', { behaviour: 'clip', min: 0, max: 1 }, { value: '-3.0' }).value).toBe(0);
    expect(run('bounds', { behaviour: 'soft', min: 0, max: 1, softness: 0.4 }, { value: '0.5' }).value).toBeCloseTo(0.5, 9);
    const far = run('bounds', { behaviour: 'soft', min: 0, max: 1, softness: 0.4 }, { value: '50.0' }).value as number;
    expect(far).toBeLessThanOrEqual(1); expect(far).toBeGreaterThan(0.999);
  });
  it('vec2 and vec3 work per axis with the per-axis sliders; Inside is every axis; a wired Min / Max wins', () => {
    const p3 = { outputType: 'vec3', behaviour: 'bounce', minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -0.5, maxZ: 0.5 };
    const r = run('bounds', p3, { value: 'vec3(1.5, -0.5, 0.25)' });
    expect((r.value as number[])[0]).toBeCloseTo(0.5, 6);
    expect((r.value as number[])[1]).toBeCloseTo(0.5, 6);
    expect((r.value as number[])[2]).toBeCloseTo(0.25, 6);
    expect(r.direction).toEqual([-1, -1, 1]);
    expect(r.inside).toBe(0);
    expect(run('bounds', p3, { value: 'vec3(0.5, 1.0, 0.0)' }).inside).toBe(1);
    const r2 = run('bounds', { outputType: 'vec2', behaviour: 'clip' }, { value: 'vec2(3.0, -3.0)', min: 'vec2(0.0, -1.0)', max: 'vec2(2.0, 1.0)' });
    expect(r2.value).toEqual([2, -1]);
    expect(run('bounds', { outputType: 'vec2', behaviour: 'wrap' }, { value: 'vec2(1.5, -1.25)' }).value).toEqual([-0.5, 0.75]);
  });
  it('the type follows the pills (Value, Min, Max, Value and Direction) and wires that no longer fit come off', () => {
    expect(VECTORIZABLE_NODES.bounds).toMatchObject({ primaryInput: 'value', primaryOutput: 'value', alsoOutputs: ['direction'] });
    const def = getNodeDefinition('bounds')!;
    const as = socketsAs('bounds', def.inputs, def.outputs, 'vec3');
    expect([as.inputs.value.type, as.inputs.min.type, as.inputs.max.type, as.outputs.value.type, as.outputs.direction.type, as.outputs.inside.type]).toEqual(['vec3', 'vec3', 'vec3', 'vec3', 'vec3', 'float']);
    const node = n('bounds', 'b', 0, 0, {}, { value: ['x', 'y'] });
    expect(node.inputs.value.type).toBe('float');
    const v2 = retypeBounds({ ...node, params: { ...node.params, outputType: 'vec2' } });
    expect(v2.inputs.value).toMatchObject({ type: 'vec2', connection: undefined });
    expect(v2.outputs.direction.type).toBe('vec2');
    expect(n('bounds', 'c', 0, 0, { outputType: 'vec3' }, { value: ['x', 'p'] }).inputs.value).toMatchObject({ type: 'vec3', connection: { nodeId: 'x', outputKey: 'p' } });
  });
  it('compiles in a graph as a vec2 (uniforms on)', () => {
    const nodes = [
      n('uv', 'uv', 0, 0),
      n('bounds', 'bd', 200, 0, { outputType: 'vec2', behaviour: 'bounce' }, { value: ['uv', 'uv'] }),
      n('length', 'len', 400, 0, { outputType: 'vec2' }, { input: ['bd', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['len', 'output'] }),
    ];
    nodes[2].inputs.input.type = 'vec2';
    const r = compileGraph({ nodes }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
  });
});

// ── Glitch ────────────────────────────────────────────────────────────────────

/** Two "pictures": A is a red ramp across x, B a blue ramp up y (texture2D(sampler, st)). */
const picA = (st: number[]) => [fract(st[0] * 1.7) * 0.9 + 0.05, 0.2, 0.6, 1];
const picB = (st: number[]) => [0.1, 0.8, fract(st[1] * 1.3) * 0.9 + 0.05, 1];
const texEnv = { u_resolution: [2, 1], u_time: 3.3, TA: 1, TB: 2, texture2D: (s: Val, st: Val) => ((s as number) === 1 ? picA : picB)(st as number[]) };
const MODES = ['swap', 'channels', 'displace', 'bits', 'slices'];

function glitchAt(params: Record<string, unknown>, uv: [number, number], kinds: { a: 'texture' | 'colour'; b: 'texture' | 'colour' } = { a: 'texture', b: 'texture' }) {
  const node = retypeGlitch(n('glitch', 'G', 0, 0, { aIs: kinds.a, bIs: kinds.b, ...params }));
  const ins = { a: kinds.a === 'texture' ? 'TA' : 'vec3(0.9, 0.3, 0.1)', b: kinds.b === 'texture' ? 'TB' : 'vec3(0.1, 0.4, 0.8)', uv: `vec2(${uv[0]}, ${uv[1]})` };
  const { code, outputVars } = getNodeDefinition('glitch')!.generateGLSL(node, ins);
  const out = runGlsl(code, { step, cross, rfiHash, ...texEnv }) as Record<string, Val>;
  const val = (e: string) => out[e] ?? runGlsl(`    float probe_ = ${e};\n`, { ...out }).probe_;
  return { a: out.G_a as number[], b: out.G_b as number[], oa: val(outputVars.outA) as number[], ob: val(outputVars.outB) as number[], hit: val(outputVars.hit) as number };
}
const grid: Array<[number, number]> = [];
for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) grid.push([-1.7 + i * 0.41, -0.95 + j * 0.31]);

describe('Glitch', () => {
  it('Swap blocks is exact: A′ = B and B′ = A in a hit block, both untouched elsewhere', () => {
    let hits = 0;
    for (const uv of grid) {
      const g = glitchAt({ mode: 'swap', amount: 0.5, blocks: 6 }, uv);
      if (g.hit === 1) { hits++; expect(g.oa).toEqual(g.b); expect(g.ob).toEqual(g.a); }
      else { expect(g.oa).toEqual(g.a); expect(g.ob).toEqual(g.b); }
    }
    expect(hits).toBeGreaterThan(5);
    expect(hits).toBeLessThan(grid.length - 5);
  });
  it.each(MODES)('%s: Amount 0 leaves A and B untouched; Amount 1 changes something', mode => {
    for (const kinds of [{ a: 'texture', b: 'texture' }, { a: 'colour', b: 'colour' }, { a: 'texture', b: 'colour' }] as const) {
      let changed = 0;
      for (const uv of grid) {
        const g0 = glitchAt({ mode, amount: 0 }, uv, kinds);
        expect(g0.oa).toEqual(g0.a);
        expect(g0.ob).toEqual(g0.b);
        expect(g0.hit).toBe(0);
        const g1 = glitchAt({ mode, amount: 1, reach: 0.4, bits: '3' }, uv, kinds);
        if (g1.oa.some((x, i) => Math.abs(x - g1.a[i]) > 1e-4) || g1.ob.some((x, i) => Math.abs(x - g1.b[i]) > 1e-4)) changed++;
      }
      expect(changed, `${mode} ${kinds.a}/${kinds.b}`).toBeGreaterThan(0);
    }
  });
  it('Channel cross takes each channel from one or the other; Bit flips land on the N-bit levels', () => {
    for (const uv of grid) {
      const g = glitchAt({ mode: 'channels', amount: 0.5 }, uv);
      for (let i = 0; i < 3; i++) {
        expect([g.a[i], g.b[i]].some(x => Math.abs(x - g.oa[i]) < 1e-9)).toBe(true);
        expect(Math.abs(g.oa[i] + g.ob[i] - g.a[i] - g.b[i])).toBeLessThan(1e-9);
      }
      const b = glitchAt({ mode: 'bits', amount: 1, bits: '3' }, uv);
      for (const x of [...b.oa, ...b.ob]) expect(Math.abs(x * 7 - Math.round(x * 7))).toBeLessThan(1e-9);
    }
  });
  it('the blocks are re-dealt as Time steps at Rate (and hold between steps)', () => {
    const deal = (t: number) => grid.map(uv => {
      const node = n('glitch', 'G', 0, 0, { mode: 'swap', amount: 0.5, rate: 2 });
      const { code, outputVars } = getNodeDefinition('glitch')!.generateGLSL(node, { a: 'TA', b: 'TB', uv: `vec2(${uv[0]}, ${uv[1]})`, time: t.toFixed(3) });
      return runGlsl(code, { step, cross, rfiHash, ...texEnv })[outputVars.hit] as number;
    }).join('');
    expect(deal(1.1)).toBe(deal(1.4));
    expect(deal(1.1)).not.toBe(deal(1.6));
  });
  it.each(MODES)('%s compiles to valid GLSL for textures, colours and a mix (and the sockets follow A is / B is)', mode => {
    const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };
    for (const [aIs, bIs] of [['texture', 'texture'], ['colour', 'colour'], ['colour', 'texture']]) {
      const pa = n('textureInput', 'pa', 0, 0), pb = n('textureInput', 'pb', 0, 200);
      const ca = n('colorPicker', 'ca', 0, 400), cb = n('colorPicker', 'cb', 0, 600);
      const gl = n('glitch', 'gl', 300, 0, { mode, aIs, bIs }, {
        a: aIs === 'texture' ? ['pa', 'texture'] : ['ca', 'rgb'], b: bIs === 'texture' ? ['pb', 'texture'] : ['cb', 'rgb'],
      });
      expect(gl.inputs.a.type).toBe(aIs === 'texture' ? 'texture' : 'vec3');
      expect(gl.inputs.b.type).toBe(bIs === 'texture' ? 'texture' : 'vec3');
      const add = n('add', 'sum', 600, 0, { outputType: 'vec3' }, { a: ['gl', 'outA'], b: ['gl', 'outB'] });
      add.inputs.a.type = 'vec3'; add.inputs.b.type = 'vec3'; add.outputs.result.type = 'vec3';
      const r = compileGraph({ nodes: [pa, pb, ca, cb, gl, add, n('output', 'out', 900, 0, {}, { color: ['sum', 'result'] })] }) as CompilationResult;
      expect(r.errors ?? [], `${mode} ${aIs}/${bIs}`).toEqual([]);
      expect(parses(r.fragmentShader), `${mode} ${aIs}/${bIs}`).toBeNull();
    }
  });
  it('switching A is to Colour retypes the socket and drops the texture wire', () => {
    const g = n('glitch', 'g', 0, 0, {}, { a: ['pa', 'texture'] });
    const c = retypeGlitch({ ...g, params: { ...g.params, aIs: 'colour' } });
    expect(c.inputs.a).toMatchObject({ type: 'vec3', connection: undefined });
    expect(c.inputs.b.type).toBe('texture');
  });
});

describe('the examples', () => {
  it('Glitch (Pictures) and Bounds compile, and every node has a note', () => {
    const g = { glitch: buildPictureExamples().picGlitch, bounds: buildBoundsExamples().boundsBouncingCopies };
    for (const [k, ex] of Object.entries(g)) {
      expect(ex, k).toBeDefined();
      const r = compileGraph({ nodes: ex.nodes }) as CompilationResult;
      expect(r.errors ?? [], k).toEqual([]);
      for (const nd of ex.nodes) expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, nd.id).toBe(true);
    }
    expect(g.glitch.nodes.some(nd => nd.type === 'glitch')).toBe(true);
    expect(g.bounds.nodes.find(nd => nd.type === 'bounds')?.params.behaviour).toBe('bounce');
  });
});
