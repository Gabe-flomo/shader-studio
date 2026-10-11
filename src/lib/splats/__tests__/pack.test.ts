import { describe, expect, it } from 'vitest';
import { PACK_WIDTH, SH_WIDTH, packSplats, sortScratch, sortSplats, splatInfo, thumbnailPixels, toHalf, unpackSplat } from '../pack';
import { covariance3d } from '../math';
import { ringScan } from './fixtures';

describe('packing for the GPU', () => {
  it('half floats as packHalf2x16 makes them', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(0)).toBe(0);
  });

  it('two texels a splat: centre bits, colour bytes, covariance halves (×4)', () => {
    const ring = ringScan(1030);
    const p = packSplats(ring);
    expect(p.rows).toBe(2);
    expect(p.data.length).toBe(PACK_WIDTH * 2 * 4);
    for (const i of [0, 7, 1029]) {
      const u = unpackSplat(p, i);
      expect(u.pos).toEqual([ring.positions[i * 3], ring.positions[i * 3 + 1], ring.positions[i * 3 + 2]]);
      expect(u.rgba).toEqual([...ring.colors.subarray(i * 4, i * 4 + 4)]);
      const c = covariance3d([ring.scales[i * 3], ring.scales[i * 3 + 1], ring.scales[i * 3 + 2]], [ring.rotations[i * 4], ring.rotations[i * 4 + 1], ring.rotations[i * 4 + 2], ring.rotations[i * 4 + 3]]);
      c.forEach((v, k) => expect(Math.abs(u.cov[k] - v)).toBeLessThan(Math.abs(v) * 2e-3 + 1e-7));
    }
  });

  it('caps at Max splats, and harmonics go in their own texture as bytes', () => {
    const ring = ringScan(50, 1, [0, 0, 0], 3);
    const p = packSplats(ring, 20, 2);
    expect(p.count).toBe(20);
    expect(p.shDegree).toBe(2);
    expect(p.sh!.length).toBe(SH_WIDTH * p.shRows! * 4);
    const bytes = new Uint8Array(p.sh!.buffer);
    // Splat 3, coefficient 5, channel 1, at 2 texels (32 bytes) a splat.
    expect(bytes[3 * 32 + 5 * 3 + 1]).toBe(Math.round(ring.sh![(3 * 15 + 5) * 3 + 1] * 128 + 128));
    expect(packSplats(ring, 50, 0).sh).toBeUndefined();
  });
});

describe('the back-to-front sort', () => {
  it('orders far to near along the axis, every splat once', () => {
    const n = 5000;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n * 3; i++) pos[i] = rnd() * 20 - 10;
    const axis = [0.3, -0.5, 0.81];
    const order = sortSplats(pos, n, axis);
    expect(new Set(order).size).toBe(n);
    const depth = (i: number) => pos[i * 3] * axis[0] + pos[i * 3 + 1] * axis[1] + pos[i * 3 + 2] * axis[2];
    // 16-bit keys: neighbours may swap within one bucket (range / 65 535).
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, depth(i)); hi = Math.max(hi, depth(i)); }
    const bucket = (hi - lo) / 65535;
    for (let k = 1; k < n; k++) expect(depth(order[k])).toBeLessThanOrEqual(depth(order[k - 1]) + bucket);
  });

  it('reuses its scratch and sorts only the first n', () => {
    const pos = new Float32Array([0, 0, 1, 0, 0, 3, 0, 0, 2, 0, 0, 9]);
    const s = sortScratch(4);
    expect([...sortSplats(pos, 3, [0, 0, 1], s)]).toEqual([1, 2, 0]);
    expect(sortScratch(3, s)).toBe(s);
    expect([...sortSplats(pos, 4, [0, 0, -1], s)]).toEqual([0, 2, 1, 3]);
  });

  it('a million splats sort in well under a second here', () => {
    const n = 1_000_000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = Math.sin(i * 12.9898) * 43758.5453 % 10;
    const s = sortScratch(n);
    sortSplats(pos, n, [0, 0, 1], s);
    const t0 = performance.now();
    sortSplats(pos, n, [0.2, 0.3, 0.93], s);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});

describe('what the card shows', () => {
  it('bounds, the core box without stray splats, centre and radius', () => {
    const ring = ringScan(200, 2, [1, 0, -1]);
    const info = splatInfo(ring);
    expect(info.count).toBe(200);
    expect(info.min[0]).toBeCloseTo(-1, 5);
    expect(info.max[0]).toBeCloseTo(3, 5);
    expect(info.center[0]).toBeCloseTo(1, 1);
    expect(info.radius).toBeGreaterThan(2.5);
    const px = thumbnailPixels(ring, 32, 18, info);
    expect(px.length).toBe(32 * 18 * 4);
  });
});
