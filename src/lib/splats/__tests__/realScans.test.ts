/**
 * Real scans, only on a machine that has them (never committed: their licences are unstated). Set
 * PLAYFIELD_SPLAT_SAMPLES to a folder of .splat files, or keep them in ../shader-studio-samples/splats beside the
 * repo; without either, this is skipped.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePly, parseSplat, writePly } from '../format';
import { packSplats, sortScratch, sortSplats, splatInfo } from '../pack';

const candidates = [process.env.PLAYFIELD_SPLAT_SAMPLES, resolve(process.cwd(), '../shader-studio-samples/splats'), '/Users/me/Documents/Apps/shader-studio-samples/splats'].filter(Boolean) as string[];
const dir = candidates.find(d => existsSync(d));
const files = dir ? readdirSync(dir).filter(f => f.endsWith('.splat')) : [];

describe.skipIf(!files.length)('real .splat scans (local only)', () => {
  for (const f of files) {
    it(`${f}: parses, packs, sorts, and survives .splat → .ply → read`, () => {
      const bytes = new Uint8Array(readFileSync(join(dir!, f)));
      const t0 = performance.now();
      const d = parseSplat(bytes);
      const parseMs = performance.now() - t0;
      expect(d.count).toBe(bytes.length / 32);
      const info = splatInfo(d);
      expect(Number.isFinite(info.radius)).toBe(true);
      const t1 = performance.now();
      const packed = packSplats(d);
      const packMs = performance.now() - t1;
      expect(packed.count).toBe(d.count);
      const s = sortScratch(d.count);
      const t2 = performance.now();
      const order = sortSplats(d.positions, d.count, [0, 0, 1], s);
      const sortMs = performance.now() - t2;
      expect(order.length).toBe(d.count);
      // The PLY converter on the first 5000 splats: the same scan back.
      const head = { ...d, count: 5000, positions: d.positions.subarray(0, 15000), scales: d.scales.subarray(0, 15000), rotations: d.rotations.subarray(0, 20000), colors: d.colors.subarray(0, 20000) };
      const back = parsePly(writePly(head));
      for (let i = 0; i < 15000; i++) expect(Math.abs(back.positions[i] - head.positions[i])).toBeLessThan(1e-6);
      for (let i = 0; i < 20000; i++) expect(Math.abs(back.colors[i] - head.colors[i])).toBeLessThanOrEqual(1);
      console.log(`[splats] ${f}: ${d.count.toLocaleString()} splats, parse ${parseMs.toFixed(0)} ms, pack ${packMs.toFixed(0)} ms, sort ${sortMs.toFixed(0)} ms, radius ${info.radius.toFixed(2)}`);
    }, 60000);
  }
});
