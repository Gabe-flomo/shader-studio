/**
 * Channel tools (nodes/definitions/channelTools.ts, docs/channel-tools.md): Channel, Shuffle and Channel
 * Colours, their emitted GLSL run on the CPU (glslEval.ts) on known channels, and each compiling from a
 * Trail-like vec4 and from a texture.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { cleanShuffleExpr, retypeShuffle, shuffleWiresOf } from '../../nodes/definitions/channelTools';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Val } from './glslEval';

const smoothstep = (a: Val, b: Val, x: Val) => { const t = Math.min(Math.max(((x as number) - (a as number)) / ((b as number) - (a as number)), 0), 1); return t * t * (3 - 2 * t); };

function run(type: string, params: Record<string, unknown>, inputs: Record<string, string>, env: Record<string, Val> = {}) {
  const node = n(type, 'N', 0, 0, params);
  const { code, outputVars } = getNodeDefinition(type)!.generateGLSL(node, inputs);
  const out = runGlsl(code, { smoothstep, ...env });
  return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v] ?? runGlsl(`    float probe_ = ${v};\n`, { ...env, ...out }).probe_])) as Record<string, Val>;
}
const C = 'vec4(2.0, 0.5, 4.0, 1.0)';

describe('Channel', () => {
  it('Raw reads one channel; brightness, all four and the largest', () => {
    expect(run('channelPick', { channel: '3', shape: 'raw' }, { channels: C }).value).toBeCloseTo(4, 6);
    expect(run('channelPick', { channel: 'sum', shape: 'raw' }, { channels: C }).value).toBeCloseTo(7.5, 6);
    expect(run('channelPick', { channel: 'max', shape: 'raw' }, { channels: C }).value).toBeCloseTo(4, 6);
    expect(run('channelPick', { channel: 'bright', shape: 'raw' }, { channels: C }).value).toBeCloseTo(0.299 * 2 + 0.587 * 0.5 + 0.114 * 4, 5);
  });
  it('0–1 is 1 − e^(−value × Exposure); Invert flips it', () => {
    expect(run('channelPick', { channel: '1', shape: 'soft', exposure: 0.5 }, { channels: C }).value).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(run('channelPick', { channel: '1', shape: 'soft', exposure: 0.5, invert: true }, { channels: C }).value).toBeCloseTo(Math.exp(-1), 6);
  });
  it('Compare: A − B, A ÷ B, the larger, the smaller; B from Compare with when wired', () => {
    const raw = (compare: string, extra: Record<string, string> = {}) => run('channelPick', { channel: '3', channelB: '1', compare, shape: 'raw' }, { channels: C, ...extra }).value as number;
    expect(raw('minus')).toBeCloseTo(2, 6);
    expect(raw('ratio')).toBeCloseTo(2, 6);
    expect(raw('larger')).toBeCloseTo(4, 6);
    expect(raw('smaller')).toBeCloseTo(2, 6);
    expect(raw('minus', { other: 'vec4(1.5, 0.0, 0.0, 0.0)' })).toBeCloseTo(2.5, 6);
  });
  it('Remap maps one range onto another; Threshold steps at the threshold', () => {
    expect(run('channelPick', { channel: '3', shape: 'remap', inLow: 0, inHigh: 8, outLow: -1, outHigh: 1 }, { channels: C }).value).toBeCloseTo(0, 6);
    expect(run('channelPick', { channel: '2', shape: 'threshold', threshold: 1, softness: 0 }, { channels: C }).value).toBeCloseTo(0, 6);
    expect(run('channelPick', { channel: '1', shape: 'threshold', threshold: 1, softness: 0 }, { channels: C }).value).toBeCloseTo(1, 6);
  });
});

describe('Shuffle', () => {
  it('puts the chosen channels of A and B, or 0 and 1, into red, green, blue and alpha', () => {
    const r = run('channelShuffle', { r: 'a3', g: 'b2', b: '0', a: '1' }, { a: C, b: 'vec4(0.0, 9.0, 0.0, 0.0)' });
    expect(r.channels).toEqual([4, 9, 0, 1]);
    expect(r.color).toEqual([4, 9, 0]);
  });
  it('distort wires change the channel dropped onto, reading the channels as shuffled', () => {
    // R = 2, G = 0.5, B = 4, A = 1. B × R, R + G (R reads B's original too: order doesn't matter), G − A
    const r = run('channelShuffle', { wires: [{ from: 'r', to: 'b', op: 'mul' }, { from: 'g', to: 'r', op: 'add' }, { from: 'a', to: 'g', op: 'sub' }] }, { a: C });
    expect(r.channels).toEqual([2.5, -0.5, 8, 1]);
    // Two into one channel apply in order: B × R, then + A
    expect(run('channelShuffle', { wires: [{ from: 'r', to: 'b', op: 'mul' }, { from: 'a', to: 'b', op: 'add' }] }, { a: C }).channels).toEqual([2, 0.5, 9, 1]);
  });
  it('wires are cleaned: no channel onto itself, no repeats, at most two into one, unknown ops multiply, bad expressions leave it', () => {
    expect(shuffleWiresOf({ wires: [
      { from: 'r', to: 'r', op: 'add' }, { from: 'g', to: 'b', op: 'what' }, { from: 'g', to: 'b', op: 'add' },
      { from: 'r', to: 'b', op: 'add' }, { from: 'a', to: 'b', op: 'add' }, { from: 'x', to: 'b' },
    ] })).toEqual([{ from: 'g', to: 'b', op: 'mul' }, { from: 'r', to: 'b', op: 'add' }]);
    expect(cleanShuffleExpr('v * (1.0 + r)')).toBe('v * (1.0 + r)');
    expect(cleanShuffleExpr('v; discard')).toBe('v');
    expect(cleanShuffleExpr('discard')).toBe('v');
    expect(cleanShuffleExpr('}')).toBe('v');
    expect(cleanShuffleExpr('')).toBe('v');
  });
  it('A and B are each four channels or a texture: the switch retypes the socket, and any mix compiles', () => {
    for (const [aIs, bIs] of [['texture', 'texture'], ['channels', 'texture'], ['texture', 'channels']] as const) {
      const wire = (kind: string) => (kind === 'texture' ? ['tx', 'texture'] : ['v4', 'xyzw']) as [string, string];
      const c = n('channelShuffle', 'c', 300, 0, { aIs, bIs, r: 'a1', g: 'b2' }, { a: wire(aIs), b: wire(bIs) });
      expect(c.inputs.a.type).toBe(aIs === 'texture' ? 'texture' : 'vec4');
      expect(c.inputs.b.type).toBe(bIs === 'texture' ? 'texture' : 'vec4');
      const r = compileGraph({ nodes: [n('makeVec4', 'v4', 0, 0, {}), n('textureInput', 'tx', 0, 200, {}), c, n('output', 'o', 600, 0, {}, { color: ['c', 'color'] })] }) as unknown as { errors?: unknown; fragmentShader: string };
      expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
      expect((r.fragmentShader.match(/texture2D\(/g) ?? []).length).toBeGreaterThanOrEqual(aIs === 'texture' && bIs === 'texture' ? 2 : 1);
    }
  });
  it('an old graph\'s Texture A becomes A switched to Texture, its wire kept; switching back drops a wire that no longer fits', () => {
    const old = { ...n('channelShuffle', 'c', 0, 0, {}), params: { r: 'a1', g: 'a2', b: 'a3', a: 'a4' } };
    old.inputs = { textureA: { type: 'texture' as const, label: 'Texture A', connection: { nodeId: 'tx', outputKey: 'texture' } }, b: { type: 'vec4' as const, label: 'B' } };
    const up = retypeShuffle(old);
    expect(up.params.aIs).toBe('texture');
    expect(up.inputs.textureA).toBeUndefined();
    expect(up.inputs.a).toMatchObject({ type: 'texture', connection: { nodeId: 'tx' } });
    const back = retypeShuffle({ ...up, params: { ...up.params, aIs: 'channels' } });
    expect(back.inputs.a.type).toBe('vec4');
    expect(back.inputs.a.connection).toBeUndefined();
  });
  it('Divide and Expression wires compile', () => {
    const r = compileGraph({ nodes: [
      n('makeVec4', 'v4', 0, 0, {}),
      n('channelShuffle', 'c', 300, 0, { wires: [{ from: 'r', to: 'b', op: 'div' }, { from: 'g', to: 'a', op: 'expr', expr: 'mix(v, g, 0.5) * sin(r * 3.0)' }] }, { a: ['v4', 'xyzw'] }),
      n('output', 'o', 600, 0, {}, { color: ['c', 'color'] }),
    ] }) as unknown as { errors?: unknown; fragmentShader: string };
    expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
    expect(r.fragmentShader).toContain('shufDiv(');
    expect(r.fragmentShader).toContain('mix(v, g, 0.5) * sin(r * 3.0)');
  });
});

describe('Channel Colours', () => {
  const S = 'vec4(1.0, 0.0, 0.0, 0.0)';
  it('Glow adds each channel\'s colour by 1 − e^(−value × Exposure) over the background', () => {
    const r = run('channelColours', { mode: 'glow', background: [0.1, 0.1, 0.1], colour1: [1, 0, 0], exposure1: 1 }, { channels: S });
    const k = 1 - Math.exp(-1);
    (r.color as number[]).forEach((c, i) => expect(c).toBeCloseTo([0.1 + k, 0.1, 0.1][i], 5));
    expect(r.coverage).toBeCloseTo(k, 5);
  });
  it('Paint lays the colour over; Average divides the colour sum by the count', () => {
    const p = run('channelColours', { mode: 'paint', background: [0, 0, 1], colour1: [1, 0, 0], exposure1: 1 }, { channels: S });
    const k = 1 - Math.exp(-1);
    (p.color as number[]).forEach((c, i) => expect(c).toBeCloseTo([k, 0, 1 - k][i], 5));
    const a = run('channelColours', { mode: 'average', background: [0, 0, 0], layers: 100 }, { channels: 'vec4(2.0, 1.0, 0.0, 2.0)' });
    (a.color as number[]).forEach((c, i) => expect(c).toBeCloseTo([1, 0.5, 0][i], 4));
  });
});

describe('Channel tools compile', () => {
  it.each(['channelPick', 'channelShuffle', 'channelColours'])('%s from a Trail-like vec4 and from a texture', type => {
    const def = getNodeDefinition(type)!;
    const vecKey = Object.keys(def.inputs).find(k => def.inputs[k].type === 'vec4')!;
    // Shuffle's A takes a texture when switched to Texture (aIs); the others have a Texture socket of their own
    const texKey = Object.keys(def.inputs).find(k => def.inputs[k].type === 'texture') ?? vecKey;
    const texParams = type === 'channelShuffle' ? { aIs: 'texture' } : {};
    const out = Object.keys(def.outputs)[0];
    for (const [params, wire] of [[{}, { [vecKey]: ['v4', 'xyzw'] as [string, string] }], [texParams, { [texKey]: ['tx', 'texture'] as [string, string] }]] as const) {
      const r = compileGraph({ nodes: [
        n('makeVec4', 'v4', 0, 0, {}), n('textureInput', 'tx', 0, 200, {}),
        n(type, 'c', 300, 0, params, wire),
        n('output', 'o', 600, 0, {}, { color: ['c', out] }),
      ] });
      expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
    }
  });
});
