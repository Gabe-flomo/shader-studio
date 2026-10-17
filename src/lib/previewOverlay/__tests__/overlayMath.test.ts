import { describe, expect, it } from 'vitest';
import {
  blendFields, edgeLabels, formatLevel, gridLines, gridStep, isoSegments, locateValue, padComponent, plainUvField, type Field2,
} from '../overlayMath';
import { buildOverlayShader } from '../overlayRunner';

/** A field from a function of the texel's screen point (u, v). */
function fieldOf(w: number, h: number, fn: (u: number, v: number) => [number, number]): Field2 {
  const data = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [x, y] = fn((i + 0.5) / w, (j + 0.5) / h);
    data[(j * w + i) * 2] = x; data[(j * w + i) * 2 + 1] = y;
  }
  return { data, w, h };
}

describe('gridStep', () => {
  it('picks 1 / 2.5 / 5 × 10ⁿ for UV-sized ranges', () => {
    expect(gridStep(-1.78, 1.78, 8)).toBe(0.5);
    expect(gridStep(-1, 1, 8)).toBe(0.25);
    expect(gridStep(0, 1, 10)).toBeCloseTo(0.1);
    expect(gridStep(0, 10, 10)).toBe(1);
  });
  it('picks 10 / 50 / 100 for pixel spaces', () => {
    expect(gridStep(0, 1920, 8)).toBe(500);
    expect(gridStep(0, 1080, 10)).toBe(100);
    expect(gridStep(0, 400, 8)).toBe(50);
    expect(gridStep(0, 80, 8)).toBe(10);
  });
  it('falls back to 1 for an empty range', () => {
    expect(gridStep(3, 3)).toBe(1);
  });
  it('formats levels without float noise', () => {
    expect(formatLevel(0.25, 0.25)).toBe('0.25');
    expect(formatLevel(-1.5, 0.5)).toBe('−1.5');
    expect(formatLevel(300, 50)).toBe('300');
    expect(formatLevel(0.30000000000000004, 0.1)).toBe('0.3');
  });
});

describe('iso-lines (marching squares)', () => {
  it('plain UV: x = const lines are straight and vertical at the right screen position', () => {
    const asp = 16 / 9;
    const f = plainUvField(96, 54, asp);
    const p = padComponent(f, 0);
    const segs = isoSegments(p, 0.5);
    expect(segs.length).toBeGreaterThan(0);
    // x = 0.5 at u = 0.5 + 0.5 / (2 · asp)
    const u = 0.5 + 0.5 / (2 * asp);
    for (let k = 0; k < segs.length; k += 2) expect(segs[k]).toBeCloseTo(u, 5);
    // The line runs the full height, edge to edge
    const vs = segs.filter((_, k) => k % 2 === 1);
    expect(Math.min(...vs)).toBeCloseTo(0, 5);
    expect(Math.max(...vs)).toBeCloseTo(1, 5);
  });

  it('plain UV: the grid spans −aspect…aspect by −1…1 with labels at the edges', () => {
    const asp = 16 / 9;
    const { lines, sx, sy, range } = gridLines(plainUvField(96, 54, asp), 8);
    expect(range.minX).toBeLessThan(-1.7); expect(range.maxX).toBeGreaterThan(1.7);
    expect(range.minY).toBeLessThan(-0.95); expect(range.maxY).toBeGreaterThan(0.95);
    const xs = lines.filter(l => l.axis === 'x').map(l => l.level);
    const ys = lines.filter(l => l.axis === 'y').map(l => l.level);
    expect(xs).toContain(-1.5); expect(xs).toContain(1.5); expect(xs).not.toContain(2);
    expect(ys).toContain(-0.5); expect(ys).toContain(0.5);
    expect(lines.filter(l => l.major).map(l => l.axis).sort()).toEqual(['x', 'y']);
    const labels = edgeLabels(lines, sx, sy);
    const x15 = labels.find(l => l.axis === 'x' && l.text === '1.5');
    expect(x15?.edge).toBe('bottom');
    const y05 = labels.find(l => l.axis === 'y' && l.text === '0.5');
    expect(y05?.edge).toBe('left');
    expect(y05?.v).toBeCloseTo(0.75, 5);
  });

  it('a rotated field gives rotated lines', () => {
    const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    const f = fieldOf(80, 80, (u, v) => { const x = u * 2 - 1, y = v * 2 - 1; return [c * x + s * y, -s * x + c * y]; });
    const segs = isoSegments(padComponent(f, 0), 0.2);
    expect(segs.length).toBeGreaterThan(8);
    // Every point on the line satisfies c·x + s·y = 0.2 (the direction is rotated by 30°)
    for (let k = 0; k < segs.length; k += 2) {
      const x = segs[k] * 2 - 1, y = segs[k + 1] * 2 - 1;
      expect(c * x + s * y).toBeCloseTo(0.2, 4);
    }
    const dx = segs[segs.length - 2] - segs[0], dy = segs[segs.length - 1] - segs[1];
    expect(Math.abs(Math.atan2(dy, dx))).toBeCloseTo(Math.PI / 2 + a, 1);
  });

  it('skips a fract() seam instead of drawing lines along it', () => {
    const f = fieldOf(40, 10, u => [(u * 4) % 1, 0]);
    const segs = isoSegments(padComponent(f, 0), 0.5, 0.75);
    // 4 cells → 4 crossings of 0.5, each vertical; nothing along the 3 seams
    const us = new Set<number>();
    for (let k = 0; k < segs.length; k += 2) us.add(Math.round(segs[k] * 1000));
    expect(us.size).toBe(4);
  });
});

describe('warp blend', () => {
  it('interpolates between the plain UV and the space', () => {
    const plain = plainUvField(4, 2, 2);
    const space = fieldOf(4, 2, () => [10, 20]);
    expect(Array.from(blendFields(plain, space, 0).data)).toEqual(Array.from(plain.data));
    expect(Array.from(blendFields(plain, space, 1).data)).toEqual(Array.from(space.data));
    const mid = blendFields(plain, space, 0.5);
    expect(mid.data[0]).toBeCloseTo((plain.data[0] + 10) / 2, 6);
    expect(mid.data[1]).toBeCloseTo((plain.data[1] + 20) / 2, 6);
  });
});

describe('position lookup', () => {
  it('finds a point in plain UV exactly, between texels', () => {
    const asp = 16 / 9;
    const f = plainUvField(96, 54, asp);
    const r = locateValue(f, [0.3, -0.4]);
    expect(r.found).toBe(true); expect(r.onScreen).toBe(true);
    expect(r.u).toBeCloseTo(0.5 + 0.3 / (2 * asp), 4);
    expect(r.v).toBeCloseTo(0.5 - 0.4 / 2, 4);
  });
  it('places an off-screen point outside 0…1 by extrapolation', () => {
    const r = locateValue(plainUvField(96, 54, 16 / 9), [0, 1.5]);
    expect(r.found).toBe(true); expect(r.onScreen).toBe(false);
    expect(r.v).toBeCloseTo(1.25, 3);
  });
  it('finds a point in a warped field', () => {
    const warp = (u: number, v: number): [number, number] => {
      const x = u * 2 - 1, y = v * 2 - 1;
      return [x + 0.2 * Math.sin(3 * y), y + 0.2 * Math.sin(3 * x)];
    };
    const f = fieldOf(96, 54, warp);
    const r = locateValue(f, [0.1, 0.25]);
    expect(r.found).toBe(true); expect(r.onScreen).toBe(true);
    const back = warp(r.u, r.v);
    expect(back[0]).toBeCloseTo(0.1, 2);
    expect(back[1]).toBeCloseTo(0.25, 2);
  });
});

describe('overlay shader', () => {
  it('scales gl_FragCoord to the canvas and ends in vec4(space, point)', () => {
    const fs = 'precision highp float;\nuniform vec2 u_resolution;\nvoid main() {\n  vec2 n1_coord = gl_FragCoord.xy;\n  gl_FragColor = vec4(1.0);\n}';
    const out = buildOverlayShader(fs, 'n1_coord', 'n2_uv')!;
    expect(out).toContain('uniform vec2 u_ovScale;\nuniform vec2 u_resolution;');
    expect(out).toContain('vec2 n1_coord = (gl_FragCoord * vec4(u_ovScale, 1.0, 1.0)).xy;');
    expect(out.trim().endsWith('gl_FragColor = vec4(vec2(n1_coord), vec2(n2_uv));\n}')).toBe(true);
  });
});
