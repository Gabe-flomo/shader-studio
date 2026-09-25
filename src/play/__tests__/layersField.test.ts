/**
 * The Layers node's distance field for things smaller than a cell (particles).
 * A yes/no coverage threshold made a small dot blink in and out as it slid
 * across cells, so a glow on the field flashed; coverage as a disc keeps it.
 */
import { describe, it, expect } from 'vitest';
import { geoFieldAt, geoFieldFromCoverage, geoFieldFromMask } from '../kit/geometry.js';

const GW = 24, GH = 12;

/** Coverage of each cell by a disc at (cx, cy) in cell units, 8×8 supersampled. */
function dot(cx: number, cy: number, r: number): Float32Array {
  const cover = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let hit = 0;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) if (Math.hypot(x + (sx + 0.5) / 8 - cx, y + (sy + 0.5) / 8 - cy) <= r) hit++;
    cover[y * GW + x] = hit / 64;
  }
  return cover;
}

/** The field at the dot's centre, in cells (geoFieldAt takes 0..1 with y up). */
const atCentre = (f: ReturnType<typeof geoFieldFromMask>, cx: number, cy: number) => geoFieldAt(f, cx / GW, 1 - cy / GH) * GH;

describe('Layers field for small things', () => {
  it('a dot sliding across cells keeps a steady distance at its centre', () => {
    const seen: number[] = [];
    for (let t = 0; t <= 20; t++) {
      const cx = 10 + t * 0.1, cy = 6.3;
      seen.push(atCentre(geoFieldFromCoverage(dot(cx, cy, 0.3), GW, GH, 0.04), cx, cy));
    }
    // Always on the dot (never a cell or more away), and never jumping between steps.
    expect(Math.max(...seen)).toBeLessThan(0.45);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(0.2);
  });

  it('the old threshold lost the same dot on some steps (why the glow flashed)', () => {
    const seen: number[] = [];
    for (let t = 0; t <= 20; t++) {
      const cx = 10 + t * 0.1, cy = 6.3;
      const mask = Uint8Array.from(dot(cx, cy, 0.3), a => (a * 255 > 36 ? 1 : 0));
      seen.push(atCentre(geoFieldFromMask(mask, GW, GH), cx, cy));
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.5);
  });

  it('solid shapes come out as before', () => {
    const cover = new Float32Array(GW * GH);
    for (let y = 3; y < 9; y++) for (let x = 6; x < 18; x++) cover[y * GW + x] = 1;
    const a = geoFieldFromCoverage(cover, GW, GH, 0.04), b = geoFieldFromMask(Uint8Array.from(cover), GW, GH);
    for (const [x, y] of [[12, 6], [6, 6], [2, 6], [12, 1]]) expect(atCentre(a, x, y)).toBeCloseTo(atCentre(b, x, y), 5);
  });
});
