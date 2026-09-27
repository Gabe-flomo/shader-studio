/**
 * Shape SDF's 5-point star (sdStar5) was inverted: positive inside, and its
 * segment projection clamped to the wrong side. It is Inigo Quilez's
 * sdStar5 again: negative inside, zero on the outline, positive outside.
 */
import { describe, it, expect } from 'vitest';
import { SHAPE_SDF_GLSL } from '../definitions/primitives';

/** The GLSL function, one line per line, on plain numbers. */
function sdStar5(px: number, py: number, r: number, rf: number): number {
  const k1 = [0.809016994375, -0.587785252192], k2 = [-0.809016994375, -0.587785252192];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1];
  let p = [Math.abs(px), py];
  let m = 2 * Math.max(dot(k1, p), 0); p = [p[0] - m * k1[0], p[1] - m * k1[1]];
  m = 2 * Math.max(dot(k2, p), 0); p = [p[0] - m * k2[0], p[1] - m * k2[1]];
  p = [Math.abs(p[0]), p[1] - r];
  const ba = [rf * -k1[1], rf * k1[0] - 1];
  const h = Math.min(r, Math.max(0, dot(p, ba) / dot(ba, ba)));
  return Math.hypot(p[0] - ba[0] * h, p[1] - ba[1] * h) * Math.sign(p[1] * ba[0] - p[0] * ba[1]);
}

describe('sdStar5', () => {
  const src = SHAPE_SDF_GLSL.slice(SHAPE_SDF_GLSL.indexOf('float sdStar5('), SHAPE_SDF_GLSL.indexOf('float sdStarN('));

  it('the GLSL clamps and signs the way the reference does', () => {
    expect(src).toContain('float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);');
    expect(src).toContain('return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);');
  });

  it('is negative inside, zero at a tip, positive outside', () => {
    const r = 0.5, rf = 0.5;
    expect(sdStar5(0, 0, r, rf)).toBeLessThan(0);
    expect(Math.abs(sdStar5(0, r, r, rf))).toBeLessThan(1e-9);
    expect(sdStar5(0, 2, r, rf)).toBeCloseTo(1.5, 5);
    expect(sdStar5(1, -1, r, rf)).toBeGreaterThan(0);
    // Between two tips, just inside the inner vertex, is inside; just outside it, outside.
    const inner = r * rf * 0.9, a = Math.PI / 2 + Math.PI / 5;
    expect(sdStar5(inner * Math.cos(a), inner * Math.sin(a), r, rf)).toBeLessThan(0);
    const outer = r * rf * 1.2;
    expect(sdStar5(outer * Math.cos(a), outer * Math.sin(a), r, rf)).toBeGreaterThan(0);
  });
});
