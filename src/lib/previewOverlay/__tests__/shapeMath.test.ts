import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../../types/nodeGraph';
import { plainUvField, sampleBilinear, type Field2 } from '../overlayMath';
import { buildOverlayShader } from '../overlayRunner';
import { overlayKey } from '../overlayStore';
import {
  boundarySegments, fromOrigin, measurePair, primitiveBox, primitiveFor, primitiveInfo, rectOutline, sampleScalar,
  sdfInputSpace, shapeStats, type Field1,
} from '../shapeMath';

const W = 96, H = 54, ASP = 16 / 9;

function fieldOf(fn: (u: number, v: number) => [number, number], w = W, h = H): Field2 {
  const data = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [x, y] = fn((i + 0.5) / w, (j + 0.5) / h);
    data[(j * w + i) * 2] = x; data[(j * w + i) * 2 + 1] = y;
  }
  return { data, w, h };
}
/** An SDF of the space's values at each texel. */
function sdfOf(space: Field2, d: (x: number, y: number) => number): Field1 {
  const data = new Float32Array(space.w * space.h);
  for (let k = 0; k < data.length; k++) data[k] = d(space.data[k * 2], space.data[k * 2 + 1]);
  return { data, w: space.w, h: space.h };
}
const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;
const box = (cx: number, cy: number, hx: number, hy: number) => (x: number, y: number) => {
  const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};

describe('shapeStats', () => {
  const plain = plainUvField(W, H, ASP);

  it('measures a circle in plain UV: box, centre, radius', () => {
    const s = shapeStats(plain, sdfOf(plain, circle(0.2, -0.1, 0.4)));
    expect(s.box).not.toBeNull();
    expect(s.box!.minX).toBeCloseTo(-0.2, 2);
    expect(s.box!.maxX).toBeCloseTo(0.6, 2);
    expect(s.box!.minY).toBeCloseTo(-0.5, 2);
    expect(s.box!.maxY).toBeCloseTo(0.3, 2);
    expect(s.centre![0]).toBeCloseTo(0.2, 2);
    expect(s.centre![1]).toBeCloseTo(-0.1, 2);
    expect(s.circleLike).toBe(true);
    expect(Math.abs(s.inscribed - 0.4)).toBeLessThan(0.006);
    expect(s.clipped).toBe(false);
  });

  it('puts the boundary on d = 0 (every segment end is r from the centre)', () => {
    const segs = boundarySegments(sdfOf(plain, circle(0, 0, 0.5)));
    expect(segs.length).toBeGreaterThan(40);
    for (let k = 0; k < segs.length; k += 2) {
      const [x, y] = sampleBilinear(plain, segs[k], segs[k + 1]);
      expect(Math.abs(Math.hypot(x, y) - 0.5)).toBeLessThan(0.005);
    }
  });

  it('measures a box: not circle-like, its own half sizes', () => {
    const s = shapeStats(plain, sdfOf(plain, box(-0.3, 0.2, 0.5, 0.3)));
    expect(s.box!.minX).toBeCloseTo(-0.8, 2);
    expect(s.box!.maxX).toBeCloseTo(0.2, 2);
    expect(s.box!.minY).toBeCloseTo(-0.1, 2);
    expect(s.box!.maxY).toBeCloseTo(0.5, 2);
    expect(s.circleLike).toBe(false);
    // A square isn't a circle either, though its box is square
    expect(shapeStats(plain, sdfOf(plain, box(0, 0, 0.4, 0.4))).circleLike).toBe(false);
  });

  it('reads sizes in the chosen space: a scaled space scales them', () => {
    const scaled = fieldOf((u, v) => [((u - 0.5) * 2 * ASP) * 3, ((v - 0.5) * 2) * 3]);
    const s = shapeStats(scaled, sdfOf(scaled, circle(0, 0, 1.2)));
    expect(s.box!.maxX - s.box!.minX).toBeCloseTo(2.4, 1);
    expect(s.box!.maxY - s.box!.minY).toBeCloseTo(2.4, 1);
    expect(Math.abs(s.inscribed - 1.2)).toBeLessThan(0.02);
    const b = shapeStats(scaled, sdfOf(scaled, box(0, 0, 1.5, 0.6)));
    expect(b.box!.maxX).toBeCloseTo(1.5, 1);
    expect(b.box!.maxY).toBeCloseTo(0.6, 1);
  });

  it('marks a shape cut by the frame as clipped and finds nothing when all is outside', () => {
    expect(shapeStats(plain, sdfOf(plain, circle(1.7, 0, 0.5))).clipped).toBe(true);
    const none = shapeStats(plain, sdfOf(plain, circle(10, 10, 0.5)));
    expect(none.box).toBeNull();
    expect(none.segs.length).toBe(0);
  });

  it('outlines a space rectangle on screen', () => {
    const runs = rectOutline(plain, { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 }, 4);
    expect(runs.length).toBe(4);
    for (const run of runs) for (const [u, v] of run) {
      const [x, y] = sampleBilinear(plain, u, v);
      expect(Math.abs(Math.abs(x) - 0.5) < 1e-3 || Math.abs(Math.abs(y) - 0.5) < 1e-3).toBe(true);
    }
  });
});

describe('hover lookup', () => {
  it('reads a warped space and the distance between texels (bilinear)', () => {
    const warp = (u: number, v: number): [number, number] => [u * 2 + 0.3 * Math.sin(v * 6), v * 2 + 0.3 * Math.cos(u * 6)];
    const f = fieldOf(warp);
    const sdf = sdfOf(f, circle(1, 1, 0.5));
    for (const [u, v] of [[0.31, 0.62], [0.5, 0.5], [0.77, 0.13]] as const) {
      const p = sampleBilinear(f, u, v), want = warp(u, v);
      expect(p[0]).toBeCloseTo(want[0], 2);
      expect(p[1]).toBeCloseTo(want[1], 2);
      expect(sampleScalar(sdf, u, v)).toBeCloseTo(circle(1, 1, 0.5)(want[0], want[1]), 2);
    }
    // Exact at a texel centre
    expect(sampleScalar(sdf, 10.5 / W, 20.5 / H)).toBeCloseTo(sdf.data[20 * W + 10], 6);
  });
});

describe('distance', () => {
  it('measures plain UV across the full height as 2', () => {
    const plain = plainUvField(W, H, ASP);
    const m = measurePair(plain, [0.5, 0], [0.5, 1]);
    expect(m.dist).toBeCloseTo(2, 5);
    expect(m.pa[1]).toBeCloseTo(-1, 5);
    expect(measurePair(plain, [0, 0.5], [1, 0.5]).dist).toBeCloseTo(2 * ASP, 4);
  });

  it('uses the warped values for a warped space', () => {
    const warp = (u: number, v: number): [number, number] => [u + 0.5 * v * v, v * 3];
    const f = fieldOf(warp);
    const a: [number, number] = [0.2, 0.3], b: [number, number] = [0.8, 0.9];
    const m = measurePair(f, a, b);
    const wa = warp(...a), wb = warp(...b);
    expect(m.dist).toBeCloseTo(Math.hypot(wb[0] - wa[0], wb[1] - wa[1]), 2);
  });

  it('gives the distance and angle from the origin (0° = +x, counter-clockwise)', () => {
    expect(fromOrigin([1, 0])).toEqual({ dist: 1, angle: 0 });
    expect(fromOrigin([0, 2]).angle).toBeCloseTo(90);
    expect(fromOrigin([-1, 0]).angle).toBeCloseTo(180);
    expect(fromOrigin([0, -1]).angle).toBeCloseTo(270);
    const d = fromOrigin([1, 1]);
    expect(d.angle).toBeCloseTo(45);
    expect(d.dist).toBeCloseTo(Math.SQRT2);
  });
});

describe('known primitives', () => {
  const node = (type: string, params: Record<string, unknown>, inputs: GraphNode['inputs'] = {}): GraphNode =>
    ({ id: 'n1', type, position: { x: 0, y: 0 }, inputs, outputs: {}, params });

  it('reads Circle SDF and Box SDF params, dropping wired ones', () => {
    const c = primitiveInfo(node('circleSDF', { radius: 0.25, posX: 0.1, posY: -0.2 }));
    expect(c).toMatchObject({ name: 'Circle', centre: [0.1, -0.2], radius: 0.25 });
    expect(primitiveBox(c)).toEqual({ minX: 0.1 - 0.25, maxX: 0.35, minY: -0.45, maxY: 0.25 - 0.2 });
    const wired = primitiveInfo(node('circleSDF', { radius: 0.25 }, { radius: { type: 'float', label: 'Radius', connection: { nodeId: 'x', outputKey: 'o' } } }));
    expect(wired?.radius).toBeUndefined();
    expect(primitiveBox(wired)).toBeNull();
    expect(primitiveInfo(node('boxSDF', { width: 0.4, height: 0.2 }))?.half).toEqual([0.4, 0.2]);
  });

  it('reads Shape SDF shapes', () => {
    expect(primitiveInfo(node('shapeSDF', { shape: 'roundedBox', rx: 0.3, ry: 0.1 }))).toMatchObject({ name: 'Rounded Box', half: [0.3, 0.1] });
    expect(primitiveInfo(node('shapeSDF', { shape: 'star5', r: 0.5 }))).toMatchObject({ name: 'Star', radius: 0.5, radiusLabel: 'outer r' });
    expect(primitiveBox(primitiveInfo(node('shapeSDF', { shape: 'star5', r: 0.5 })))).toBeNull();
    expect(primitiveInfo(node('noise', {}))).toBeNull();
  });

  it('applies only in the space the SDF is fed', () => {
    const uvIn = { position: { type: 'vec2' as const, label: 'UV', connection: { nodeId: 'w', outputKey: 'uv' } } };
    const n = node('circleSDF', { radius: 0.3 }, uvIn);
    expect(sdfInputSpace(n)).toEqual({ nodeId: 'w', outputKey: 'uv' });
    expect(primitiveFor(n, { nodeId: 'w', outputKey: 'uv' })).not.toBeNull();
    expect(primitiveFor(n, null)).toBeNull();
    const unwired = node('circleSDF', { radius: 0.3 }, { position: { type: 'vec2', label: 'UV' } });
    expect(sdfInputSpace(unwired)).toBeNull();
    expect(primitiveFor(unwired, null)).not.toBeNull();
  });
});

describe('the Shape read', () => {
  it('writes the distance into .z and keys the read by its SDF', () => {
    const fs = 'precision highp float;\nuniform vec2 u_resolution;\nvoid main() {\n  vec2 a_uv = vec2(0.0);\n  float s_d = 1.0;\n  gl_FragColor = vec4(1.0);\n}';
    const src = buildOverlayShader(fs, 'a_uv', null, 's_d')!;
    expect(src).toContain('vec4(vec2(a_uv), float(s_d), 0.0)');
    const base = { space: null, position: null, sdf: { nodeId: 's', outputKey: 'distance' } };
    expect(overlayKey({ ...base, mode: 'shape' })).not.toBe(overlayKey({ ...base, mode: 'shape', sdf: null }));
    expect(overlayKey({ ...base, mode: 'grid' })).toBe(overlayKey({ ...base, mode: 'grid', sdf: null }));
  });
});
