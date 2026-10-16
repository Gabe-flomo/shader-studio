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
    const texKey = Object.keys(def.inputs).find(k => def.inputs[k].type === 'texture')!;
    const out = Object.keys(def.outputs)[0];
    for (const wire of [{ [vecKey]: ['v4', 'xyzw'] as [string, string] }, { [texKey]: ['tx', 'texture'] as [string, string] }]) {
      const r = compileGraph({ nodes: [
        n('makeVec4', 'v4', 0, 0, {}), n('textureInput', 'tx', 0, 200, {}),
        n(type, 'c', 300, 0, {}, wire),
        n('output', 'o', 600, 0, {}, { color: ['c', out] }),
      ] });
      expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
    }
  });
});
