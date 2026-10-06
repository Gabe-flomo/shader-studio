/**
 * Output-aware suggestions (suggestions/outputRules.ts): the preview's readback → findings →
 * fixes, only when the finding is confident.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { n } from '../../store/graphBuilder';
import { fieldStats, type ValueField } from '../../lib/nodePreview/valueField';
import { measureField, outputSuggestions } from '../outputRules';
import { rankMoves } from '../rank';
import { CoTable } from '../usage';

const W = 64, H = 36;
function field(type: ValueField['type'], f: (u: number, v: number) => number[]): ValueField {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = f(x / (W - 1), y / (H - 1));
    data.set([v[0], v[1] ?? 0, v[2] ?? 0, 1], (y * W + x) * 4);
  }
  return { data, w: W, h: H, type, hasInput: false };
}
const measure = (nodeId: string, key: string, fl: ValueField) => measureField(nodeId, key, fl, fieldStats(fl));
const ids = (node: ReturnType<typeof n>, fl: ValueField, key: string) => outputSuggestions(node, measure(node.id, key, fl)).map(s => s.moveId);

describe('output rules', () => {
  it('clipping → Tone Map (with the share), and lower intensity on a node that has one', () => {
    const bloom = n('bloom', 'b', 0, 0, { intensity: 2 });
    const fl = field('vec3', u => [u * 1.5, u * 1.5, u * 1.5]); // the right third is past 1
    const s = outputSuggestions(bloom, measure('b', 'result', fl));
    expect(s.map(x => x.moveId)).toEqual(['tone-map', 'dimmer']);
    expect(s[0].why).toMatch(/^clips \d+% to white/);
  });

  it('SDF Glow clipping → a higher Falloff', () => {
    const glow = n('light', 'g', 0, 0, { brightness: 4 });
    const fl = field('float', u => [u < 0.5 ? 3 : 0.2]);
    const s = outputSuggestions(glow, measure('g', 'glow', fl));
    expect(s[0].moveId).toBe('dimmer');
    expect(s[0].why).toMatch(/higher Falloff/);
  });

  it('mostly black → brighten a colour, remap a number to its own range', () => {
    const pal = n('palette', 'p', 0, 0);
    expect(ids(pal, field('vec3', u => [u > 0.95 ? 0.5 : 0, 0, 0]), 'color')).toContain('brighten');
    const mul = n('multiply', 'm', 0, 0, { b: 0.01 });
    const s = outputSuggestions(mul, measure('m', 'result', field('float', u => [u * 0.004])));
    const remap = s.find(x => x.moveId === 'remap')!;
    expect(remap.args).toEqual({ inMin: 0, inMax: 0.004 });
  });

  it('flat → wire UV in (an unwired space input), else a gradient or noise', () => {
    const fbm = n('fbm', 'f', 0, 0);
    expect(ids(fbm, field('float', () => [0.4]), 'value')).toEqual(['feed-uv']);
    const ramp = n('colorRamp', 'r', 0, 0);
    expect(ids(ramp, field('vec3', () => [0.2, 0.3, 0.4]), 'color')).toEqual(['add-gradient']);
  });

  it('a hard 0/1 edge → soft edge; a smooth one says nothing', () => {
    const cmp = n('smoothstep', 's', 0, 0);
    expect(ids(cmp, field('float', u => [u > 0.5 ? 1 : 0]), 'result')).toEqual(['soft-edge']);
    expect(ids(cmp, field('float', u => [Math.min(1, Math.max(0, (u - 0.4) * 5))]), 'result')).toEqual([]);
  });

  it('banding → grain on a colour, Jitter on a march loop', () => {
    const steps = (u: number) => Math.floor(u * 8) / 8;
    expect(ids(n('palette', 'p', 0, 0), field('vec3', u => [steps(u), steps(u), steps(u)]), 'color')).toContain('grain');
    const loop = n('marchLoopGroup', 'l', 0, 0, { jitter: 0 });
    expect(ids(loop, field('vec3', u => [steps(u) * 0.8, steps(u) * 0.8, steps(u) * 0.8]), 'color')).toContain('jitter');
    // A smooth gradient doesn't band.
    expect(ids(n('palette', 'p', 0, 0), field('vec3', u => [u * 0.9, u * 0.9, u * 0.9]), 'color')).toEqual([]);
  });

  it('only when confident: a field of mostly NaN, or a node meant to step, says nothing', () => {
    const pal = n('palette', 'p', 0, 0);
    expect(ids(pal, field('vec3', u => [u < 0.9 ? NaN : 2, 0, 0]), 'color')).toEqual([]);
    expect(ids(n('posterize', 'q', 0, 0), field('vec3', u => [Math.floor(u * 4) / 4, 0, 0]), 'color')).toEqual([]);
  });

  it('a confident finding ranks its fix first, with the measurement as the why', () => {
    const bloom = n('bloom', 'b', 0, 0, { intensity: 2 });
    const m = measure('b', 'result', field('vec3', u => [u * 1.5, u * 1.5, u * 1.5]));
    const t = new CoTable();
    const r = rankMoves(bloom, [bloom], { table: t, personal: t, prior: t }, { measurement: m });
    expect(r[0].move.id).toBe('tone-map');
    expect(r[0].reason).toBe('output');
    expect(r[0].why).toMatch(/clips/);
  });
});
