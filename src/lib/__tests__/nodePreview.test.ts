import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import {
  arrowCellPx, DEFAULT_DETAIL, DETAIL_LEVELS, detailFor, gridDensity,
  defaultShowAs, MAX_PREFS, pickPreviewOutput, prefKey, prefOf, primaryInput, showAsFor, useNodePreviewPrefs, withPref,
} from '../nodePreview/showAs';
import {
  ARROW_DOT_BELOW, ARROW_FILL, arrowKey, arrowStrength, gridColor,
  arrowGrid, arrowLength, arrowSamples, constantLabel, DIVERGING, divergingColor, fieldStats, formatValue, greyColor,
  isDiverging, niceStep, paintField, rangeColor, rangeLabel, sliceAxis, sliceRow, sliceRowIndex, valueKey, wheelColor,
  type ValueField,
} from '../nodePreview/valueField';
import { buildDisplayShader, buildValueShader } from '../nodePreview/previewGlsl';
import { valueTargetSize, VALUE_TEXELS } from '../nodePreview/valuePreviewRunner';

type Outs = Record<string, { type: string; label: string }>;
const mk = (type: string, outputs: Outs, inputs: GraphNode['inputs'] = {}, id = 'n1'): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, params: {}, inputs, outputs } as GraphNode);
const wired = (type: string, from: string) => ({ type, label: type, connection: { nodeId: from, outputKey: 'out' } }) as GraphNode['inputs'][string];
const loose = (type: string) => ({ type, label: type }) as GraphNode['inputs'][string];

/** A field from a per-texel function (row 0 at the bottom, as WebGL reads it). */
function field(w: number, h: number, type: 'float' | 'vec2', fn: (x: number, y: number) => [number, number], hasInput = false): ValueField {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [a, b] = fn(x, y);
    const o = (y * w + x) * 4;
    data[o] = a; data[o + 1] = b; data[o + 3] = 1;
  }
  return { data, w, h, type, hasInput };
}

describe('Show as: defaults', () => {
  it('floats default to the auto range', () => {
    expect(defaultShowAs(mk('multiply', { result: { type: 'float', label: 'Result' } }), 'float', 'result')).toBe('auto');
    expect(defaultShowAs(mk('fbm', { value: { type: 'float', label: 'Value' } }), 'float')).toBe('auto');
  });
  it('space / UV vec2s default to the grid', () => {
    expect(defaultShowAs(mk('swirlSpace', { output: { type: 'vec2', label: 'Swirled UV' } }), 'vec2', 'output')).toBe('grid');
    expect(defaultShowAs(mk('uv', { uv: { type: 'vec2', label: 'UV' } }), 'vec2', 'uv')).toBe('grid');
    expect(defaultShowAs(mk('rotate2d', { output: { type: 'vec2', label: 'Rotated' } }), 'vec2', 'output')).toBe('grid');
  });
  it('directions, flows, gradients and forces default to arrows', () => {
    const edges = mk('edgesTexture', { edges: { type: 'float', label: 'Edges' }, direction: { type: 'vec2', label: 'Direction' }, color: { type: 'vec3', label: 'Color' } });
    expect(defaultShowAs(edges, 'vec2', 'direction')).toBe('arrows');
    expect(defaultShowAs(mk('vectorField', { dir: { type: 'vec2', label: 'Direction' } }), 'vec2', 'dir')).toBe('arrows');
    expect(defaultShowAs(mk('custom', { flowVel: { type: 'vec2', label: 'Flow velocity' } }), 'vec2', 'flowVel')).toBe('arrows');
    expect(defaultShowAs(mk('custom', { g: { type: 'vec2', label: 'Gradient' } }), 'vec2', 'g')).toBe('arrows');
    expect(defaultShowAs(mk('angleToVec2', { v: { type: 'vec2', label: 'Vec2' } }), 'vec2', 'v')).toBe('arrows');
    // "direction" inside another word isn't a match on its own ("Redirected UV")
    expect(defaultShowAs(mk('custom', { uv: { type: 'vec2', label: 'Redirected UV' } }), 'vec2', 'uv')).toBe('grid');
  });
  it('a remembered pick wins over the default', () => {
    const n = mk('swirlSpace', { output: { type: 'vec2', label: 'Swirled UV' } }, {}, 'pick-1');
    expect(showAsFor(n, 'vec2', 'output', {})).toBe('grid');
    expect(showAsFor(n, 'vec2', 'output', { [prefKey(n)]: { vec2: 'wheel' } })).toBe('wheel');
    // The float pick doesn't leak into the vec2 one
    expect(showAsFor(n, 'vec2', 'output', { [prefKey(n)]: { float: 'slice' } })).toBe('grid');
  });
});

describe('Show as: which output', () => {
  it('colours first, then the node\'s main float / vec2 in its own order', () => {
    expect(pickPreviewOutput(mk('x', { a: { type: 'float', label: 'A' }, c: { type: 'vec3', label: 'C' } }))).toEqual(['c', 'vec3']);
    expect(pickPreviewOutput(mk('x', { a: { type: 'float', label: 'A' }, v: { type: 'vec2', label: 'V' } }))).toEqual(['a', 'float']);
    expect(pickPreviewOutput(mk('fbm', { uv: { type: 'vec2', label: 'UV (pass-through)' }, value: { type: 'float', label: 'Value' } }))).toEqual(['value', 'float']);
  });
  it('honours a pick that still exists and can be drawn', () => {
    const edges = mk('edgesTexture', { edges: { type: 'float', label: 'Edges' }, direction: { type: 'vec2', label: 'Direction' }, color: { type: 'vec3', label: 'Color' } });
    expect(pickPreviewOutput(edges)).toEqual(['color', 'vec3']);
    expect(pickPreviewOutput(edges, 'direction')).toEqual(['direction', 'vec2']);
    expect(pickPreviewOutput(edges, 'gone')).toEqual(['color', 'vec3']);
    expect(pickPreviewOutput(mk('m', { m: { type: 'mat2', label: 'M' }, f: { type: 'float', label: 'F' } }), 'm')).toEqual(['f', 'float']);
  });
});

describe('Show as: the slice plot\'s input', () => {
  it('a single-input transform overlays its first wired float input', () => {
    const n = mk('multiply', { result: { type: 'float', label: 'R' } }, { a: wired('float', 'up'), b: loose('float') });
    expect(primaryInput(n)).toEqual({ key: 'a', nodeId: 'up', outputKey: 'out' });
    const sm = mk('smoothstep', { result: { type: 'float', label: 'R' } }, { edge0: loose('float'), edge1: loose('float'), x: wired('float', 'up') });
    expect(primaryInput(sm)?.key).toBe('x');
  });
  it('any other node only when exactly one float input is wired', () => {
    expect(primaryInput(mk('custom', {}, { t: wired('float', 'u') }))?.key).toBe('t');
    expect(primaryInput(mk('custom', {}, { t: wired('float', 'u'), s: wired('float', 'v') }))).toBeNull();
    expect(primaryInput(mk('custom', {}, { uv: wired('vec2', 'u') }))).toBeNull();
    expect(primaryInput(mk('sin', {}, { input: loose('float') }))).toBeNull();
  });
});

describe('auto-range maths', () => {
  it('finds the range, the input\'s range and the share of finite texels', () => {
    const f = field(4, 2, 'float', (x, y) => [x - 1.5 + y * 4, x * 10], true);
    const s = fieldStats(f);
    expect(s.min).toBeCloseTo(-1.5); expect(s.max).toBeCloseTo(5.5);
    expect(s.inMin).toBe(0); expect(s.inMax).toBe(30);
    expect(s.constant).toBe(false);
    expect(s.finite).toBe(8);
  });
  it('detects a constant despite float noise, and labels it', () => {
    const f = field(8, 8, 'float', (x) => [3 + (x % 2) * 1e-7, 0]);
    const s = fieldStats(f);
    expect(s.constant).toBe(true);
    expect(valueKey(s, 'float', 'auto')).toBe('= 3.0 everywhere');
    expect(fieldStats(field(8, 8, 'float', (x) => [3 + x * 1e-3, 0])).constant).toBe(false);
    expect(constantLabel([0.5, -0.25])).toBe('= (0.50, −0.25) everywhere');
    expect(constantLabel(-2)).toBe('= −2.0 everywhere');
  });
  it('skips NaN / ∞ and says so', () => {
    const f = field(4, 1, 'float', (x) => [x === 0 ? NaN : x === 1 ? Infinity : x, 0]);
    const s = fieldStats(f);
    expect(s.min).toBe(2); expect(s.max).toBe(3); expect(s.finite).toBe(2);
    expect(valueKey(s, 'float', 'auto')).toBe('2.0 … 3.0 · 50% NaN/∞');
    expect(valueKey(fieldStats(field(2, 1, 'float', () => [NaN, 0])), 'float', 'auto')).toBe('NaN or ∞ everywhere');
  });
  it('vec2 stats: per-component ranges and the longest vector', () => {
    const s = fieldStats(field(3, 1, 'vec2', (x) => [x, -x * 2]));
    expect(s.minX).toBe(0); expect(s.maxX).toBe(2); expect(s.minY).toBe(-4); expect(s.maxY).toBeCloseTo(0);
    expect(s.maxMag).toBeCloseTo(Math.hypot(2, 4));
  });
  it('formats the key', () => {
    expect(rangeLabel(-2.4, 7.1)).toBe('−2.4 … 7.1');
    expect(rangeLabel(0.0003, 0.67)).toBe('0 … 0.67');
    expect(formatValue(1234.5)).toBe('1235');
    expect(formatValue(25000)).toBe('2.5e4');
    expect(formatValue(0.999999)).toBe('1.0');
    expect(formatValue(-0)).toBe('0');
  });
});

describe('colour maps', () => {
  it('diverging: grey at 0, blue at the most negative, warm at the most positive', () => {
    expect(isDiverging(-1, 3)).toBe(true);
    expect(isDiverging(0, 3)).toBe(false);
    expect(divergingColor(0, -1, 3)).toEqual(DIVERGING.zero);
    divergingColor(-1, -1, 3).forEach((c, i) => expect(c).toBeCloseTo(DIVERGING.negEnd[i]));
    divergingColor(3, -1, 3).forEach((c, i) => expect(c).toBeCloseTo(DIVERGING.posEnd[i]));
    // Each side scales to its own extreme: half way down the negative side is the blue midpoint
    divergingColor(-0.5, -1, 3).forEach((c, i) => expect(c).toBeCloseTo(DIVERGING.negMid[i]));
    // Blue below zero, warm above
    const neg = divergingColor(-0.3, -1, 3), pos = divergingColor(1, -1, 3);
    expect(neg[2]).toBeGreaterThan(neg[0]);
    expect(pos[0]).toBeGreaterThan(pos[2]);
  });
  it('grey without negatives: the lowest near black, the highest near white', () => {
    expect(rangeColor(2, 2, 6)).toEqual(greyColor(2, 2, 6));
    expect(greyColor(2, 2, 6)[0]).toBeCloseTo(0.04);
    expect(greyColor(6, 2, 6)[0]).toBeCloseTo(0.96);
    expect(greyColor(4, 4, 4)[0]).toBeCloseTo(0.5);
  });
  it('colour wheel: hue by angle, brightness by length', () => {
    const right = wheelColor(1, 0, 1);
    expect(right[0]).toBeCloseTo(1); expect(right[2]).toBeLessThan(0.3);
    expect(Math.max(...wheelColor(0, 0, 1))).toBe(0);
    expect(Math.max(...wheelColor(0.5, 0, 1))).toBeCloseTo(0.5);
  });
  it('nice contour steps', () => {
    expect(niceStep(0, 1)).toBeCloseTo(0.1);
    expect(niceStep(-2.4, 7.1)).toBe(1);
    expect(niceStep(0, 0.67)).toBeCloseTo(0.05);
    expect(niceStep(3, 3)).toBe(1);
  });
});

describe('slice sampling', () => {
  const f = field(5, 3, 'float', (x, y) => [x + y * 10, -x], true);
  it('reads the row through the line (0 bottom … 1 top)', () => {
    expect(sliceRowIndex(3, 0)).toBe(0);
    expect(sliceRowIndex(3, 0.5)).toBe(1);
    expect(sliceRowIndex(3, 1)).toBe(2);
    expect(sliceRowIndex(3, 7)).toBe(2);
    expect(Array.from(sliceRow(f, 0.5))).toEqual([10, 11, 12, 13, 14]);
    expect(Array.from(sliceRow(f, 1))).toEqual([20, 21, 22, 23, 24]);
    // The primary input rides in the second channel
    expect(Array.from(sliceRow(f, 0.5, 1))).toEqual([-0, -1, -2, -3, -4]);
  });
  it('one axis for output and input, with room; a flat line gets a span', () => {
    const ax = sliceAxis([0, 10], [-10, 0]);
    expect(ax.lo).toBeLessThan(-10); expect(ax.hi).toBeGreaterThan(10);
    expect(sliceAxis([2, 2, 2])).toEqual({ lo: 1, hi: 3 });
    expect(sliceAxis([NaN])).toEqual({ lo: -1, hi: 1 });
  });
});

describe('arrow grid', () => {
  it('square cells, centred, row-major from the bottom', () => {
    const g = arrowGrid(256, 144, 16);
    expect(g.cols).toBe(16);
    expect(g.rows).toBe(9);
    expect(g.centers).toHaveLength(144);
    expect(g.centers[0]).toEqual([0.5 / 16, 0.5 / 9]);
    expect(g.centers[16]).toEqual([0.5 / 16, 1.5 / 9]);
    expect(arrowGrid(100, 10, 40).rows).toBe(4);
    expect(arrowGrid(10, 10, 0).cols).toBe(1);
  });
  it('each cell shows its strongest vector; lengths scale against the longest', () => {
    // Zero everywhere but one texel per cell pointing up: a sparse field (edge directions)
    const f = field(8, 8, 'vec2', (x, y) => (x % 4 === 3 && y % 4 === 1 ? [0, x === 3 ? 1 : 2] : [0, 0]));
    const a = arrowSamples(f, 2);
    expect(a.cols).toBe(2); expect(a.rows).toBe(2);
    expect(Array.from(a.vecs)).toEqual([0, 1, 0, 2, 0, 1, 0, 2]);
    expect(a.maxMag).toBe(2);
    expect(arrowLength(2, 2, 40)).toBeCloseTo(36);
    expect(arrowLength(1, 2, 40)).toBeCloseTo(18);
    expect(arrowLength(1, 0, 40)).toBe(0);
  });
  it('the value target keeps about the same texel count at any aspect', () => {
    for (const [w, h] of [[1600, 900], [600, 860], [3000, 300]]) {
      const [tw, th] = valueTargetSize(w, h);
      expect(Math.abs(tw * th - VALUE_TEXELS) / VALUE_TEXELS).toBeLessThan(0.05);
      expect(Math.abs(tw / th - w / h) / (w / h)).toBeLessThan(0.05);
    }
  });
});

describe('CPU painter (node card)', () => {
  it('auto range paints the lowest dark and the highest bright', () => {
    const f = field(2, 1, 'float', (x) => [x * 5, 0]);
    const out = new Uint8ClampedArray(2 * 1 * 4);
    paintField(out, 2, 1, f, { mode: 'auto', stats: fieldStats(f) });
    expect(out[0]).toBeLessThan(30);
    expect(out[4]).toBeGreaterThan(225);
  });
  it('raw clips to 0–1 grey; vec2 raw is red = x, green = y', () => {
    const f = field(2, 1, 'float', (x) => [x * 5, 0]);
    const out = new Uint8ClampedArray(8);
    paintField(out, 2, 1, f, { mode: 'raw', stats: fieldStats(f) });
    expect(out[4]).toBe(255);
    const v = field(1, 1, 'vec2', () => [1, 0.5]);
    const o2 = new Uint8ClampedArray(4);
    paintField(o2, 1, 1, v, { mode: 'raw', stats: fieldStats(v) });
    expect([o2[0], o2[1], o2[2]]).toEqual([255, 128, 0]);
  });
});

describe('preview programs', () => {
  const fs = 'uniform float u_time;\nvarying vec2 vUv;\nfloat f(float x) { return x; }\nvoid main() {\n  float n_1 = vUv.x;\n  gl_FragColor = vec4(vec3(n_1), 1.0);\n}';
  it('the value program writes the raw value (and the input) last', () => {
    const v = buildValueShader(fs, 'n_1', 'float', 'n_0')!;
    expect(v.trim().endsWith('gl_FragColor = vec4(n_1, float(n_0), 0.0, 1.0);\n}')).toBe(true);
    expect(buildValueShader(fs, 'p', 'vec2')!).toContain('gl_FragColor = vec4(p, 0.0, 1.0);');
  });
  it('the display program puts its helpers before main and ends in the mode map', () => {
    const d = buildDisplayShader(fs, 'n_1', 'float')!;
    expect(d.indexOf('uniform float u_pvMode;')).toBeLessThan(d.indexOf('void main'));
    expect(d.indexOf('float f(float x)')).toBeLessThan(d.indexOf('vec4 pvz_showF'));
    expect(d.trim().endsWith('gl_FragColor = pvz_showF(n_1);\n}')).toBe(true);
    expect(buildDisplayShader('no main here', 'x', 'vec2')).toBeNull();
  });
});

describe('per-node choice', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('merges a patch, newest last, trimmed to the cap', () => {
    let prefs = {};
    for (let i = 0; i < MAX_PREFS + 5; i++) prefs = withPref(prefs, `n${i}|multiply`, { float: 'slice' });
    expect(Object.keys(prefs)).toHaveLength(MAX_PREFS);
    expect(Object.keys(prefs)[0]).toBe('n5|multiply');
    prefs = withPref(prefs, 'n5|multiply', { sliceY: 0.2 });
    expect(prefs['n5|multiply' as keyof typeof prefs]).toEqual({ float: 'slice', sliceY: 0.2 });
    expect(Object.keys(prefs).at(-1)).toBe('n5|multiply');
  });

  it('is keyed by id and type, and kept in localStorage', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } });
    const n = mk('multiply', { result: { type: 'float', label: 'R' } }, {}, 'node_7');
    useNodePreviewPrefs.getState().set(n, { float: 'contours' });
    expect(prefOf(n)).toEqual({ float: 'contours' });
    expect(showAsFor(n, 'float', 'result')).toBe('contours');
    // Another node type under the same id starts from its own default
    expect(showAsFor(mk('add', { result: { type: 'float', label: 'R' } }, {}, 'node_7'), 'float', 'result')).toBe('auto');
    // Saved, and read back by a fresh load (a reload of the app)
    expect(JSON.parse(mem.get('playfield.nodePreviewPrefs.v1')!)['node_7|multiply']).toEqual({ float: 'contours' });
    vi.resetModules();
    const again = await import('../nodePreview/showAs');
    expect(again.prefOf(n)).toEqual({ float: 'contours' });
  });
});

describe('arrows: length is strength against the global max', () => {
  it('strength is magnitude / the largest magnitude in view, capped at 1', () => {
    expect(arrowStrength(2.4, 2.4)).toBe(1);
    expect(arrowStrength(1.2, 2.4)).toBeCloseTo(0.5);
    expect(arrowStrength(5, 2.4)).toBe(1);
    expect(arrowStrength(1, 0)).toBe(0);
    expect(arrowStrength(NaN, 1)).toBe(0);
    expect(arrowLength(1.2, 2.4, 30)).toBeCloseTo(0.5 * 30 * ARROW_FILL);
  });
  it('normalises against the global max, not per cell and not to unit length', () => {
    // Left cell holds short vectors (0.6), right cell long ones (2.4): one max for both
    const f = field(8, 4, 'vec2', (x) => (x < 4 ? [0.6, 0] : [0, 2.4]));
    const a = arrowSamples(f, 2);
    expect(a.maxMag).toBeCloseTo(2.4);
    const mags = [0, 1].map(i => Math.hypot(a.vecs[i * 2], a.vecs[i * 2 + 1]));
    expect(arrowStrength(mags[0], a.maxMag)).toBeCloseTo(0.25);
    expect(arrowStrength(mags[1], a.maxMag)).toBe(1);
    // Direction is the vector's own: not rounded or normalised
    expect(a.vecs[0]).toBeCloseTo(0.6); expect(a.vecs[1]).toBe(0);
    expect(a.vecs[3]).toBeCloseTo(2.4);
  });
  it('very weak vectors draw as dots; the key names the full arrow', () => {
    expect(ARROW_DOT_BELOW).toBeCloseTo(0.03);
    expect(arrowStrength(0.05, 2.4) < ARROW_DOT_BELOW).toBe(true);
    expect(arrowStrength(0.1, 2.4) < ARROW_DOT_BELOW).toBe(false);
    expect(arrowKey(2.4)).toBe('full arrow = 2.4 (strongest)');
    expect(valueKey(fieldStats(field(2, 1, 'vec2', (x) => [x * 2.4, 0])), 'vec2', 'arrows')).toBe('full arrow = 2.4 (strongest)');
  });
});

describe('Detail', () => {
  afterEach(() => { useNodePreviewPrefs.setState({ prefs: {} }); });
  it('maps levels to grid density: finer each step, lines on square edges, Medium finer than before', () => {
    const g = DETAIL_LEVELS.map(l => gridDensity(l.value));
    for (let i = 1; i < g.length; i++) expect(g[i].checks).toBeGreaterThan(g[i - 1].checks);
    for (const d of g) expect(d.checks % d.lines).toBe(0);
    expect(DEFAULT_DETAIL).toBe('medium');
    expect(gridDensity('medium').checks).toBeGreaterThan(8); // the first version's 8 squares a unit
  });
  it('maps levels to arrow cells: denser each step, Medium denser than before', () => {
    for (const where of ['eye', 'card'] as const) {
      const px = DETAIL_LEVELS.map(l => arrowCellPx(l.value, where));
      for (let i = 1; i < px.length; i++) expect(px[i]).toBeLessThan(px[i - 1]);
    }
    expect(arrowCellPx('medium', 'eye')).toBeLessThan(36);
    expect(arrowCellPx('medium', 'card')).toBeLessThan(22);
    expect(arrowCellPx('veryfine', 'card')).toBeGreaterThanOrEqual(10); // still readable on the card
  });
  it('density changes the grid picture (the uniform the shader reads mirrors it)', () => {
    const p = [0.13, 0.02] as const;
    expect(gridColor(p[0], p[1], 0.001, 0.001, 4, 1)).not.toEqual(gridColor(p[0], p[1], 0.001, 0.001, 24, 4));
    expect(buildDisplayShader('void main() {\n  vec2 v = vec2(0.0);\n}', 'v', 'vec2')).toContain('uniform vec2 u_pvGrid;');
  });
  it('is remembered per node, defaults to Medium, and is not a mode', () => {
    const n = mk('swirlSpace', { output: { type: 'vec2', label: 'Swirled UV' } }, {}, 'd1');
    expect(detailFor(n)).toBe('medium');
    useNodePreviewPrefs.getState().set(n, { detail: 'veryfine' });
    expect(detailFor(n)).toBe('veryfine');
    expect(showAsFor(n, 'vec2', 'output')).toBe('grid');
    expect(detailFor(mk('rotate2d', {}, {}, 'd1'))).toBe('medium');
    expect(detailFor(n, { [prefKey(n)]: { detail: 'bogus' as never } })).toBe('medium');
  });
});
