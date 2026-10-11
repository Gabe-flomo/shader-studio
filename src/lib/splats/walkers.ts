/**
 * walkers.ts — a splat scan as walkers' births (docs/splat-scene.md "Agents as splats"; Emit's Shape: Splat scan).
 * Pure: the agents' scan loader (lib/agentScans.ts) and the tests use it.
 *
 * The scan, thinned to the group's count by the splat worker (Max splats, evenly through the file), is laid out as an
 * RGBA32F texture SCAN_WIDTH wide, two texels a splat (so walker i reads splat i):
 *  - texel 0: its centre in the scan's own size: (p − centre) / radius, turned over when "Up is −Y" (y and z flipped,
 *    as the Splat Scene's placement does), and its size (√ of its covariance's mean variance) / radius;
 *  - texel 1: its colour and opacity, 0–1.
 * `centre` and `radius` are the scan's core box (SplatInfo: without the farthest 1 % each way), so a scan with stray
 * splats far out still fills the Emit's Size. The Emit places walker i at its centre + Size × texel 0's xyz (2D: x, y),
 * its home there, its size Size × texel 0's w, its colour texel 1's.
 */
import type { PackedSplats, SplatInfo } from './pack';

export const SCAN_WIDTH = 2048;
export const SCAN_PER_ROW = SCAN_WIDTH / 2;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const fromBits = (b: number) => { u32[0] = b; return f32[0]; };
const half = (h: number) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 31) return f ? NaN : s * Infinity;
  return e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15);
};

export interface ScanWalkers {
  /** RGBA32F, SCAN_WIDTH × rows. */
  data: Float32Array;
  rows: number;
  count: number;
}

/** The scan laid out for births (see the file's note). `flip`: the scan's y points down (3DGS), so turn it over. */
export function scanWalkerData(p: PackedSplats, info: Pick<SplatInfo, 'center' | 'radius'>, flip: boolean): ScanWalkers {
  const n = p.count;
  const rows = Math.max(1, Math.ceil(n / SCAN_PER_ROW));
  const data = new Float32Array(SCAN_WIDTH * rows * 4);
  const r = info.radius > 1e-9 ? info.radius : 1;
  const [cx, cy, cz] = info.center;
  const sy = flip ? -1 : 1;
  const d = p.data;
  for (let i = 0; i < n; i++) {
    const o = i * 8, q = i * 8;
    const x = (fromBits(d[o]) - cx) / r, y = (fromBits(d[o + 1]) - cy) / r, z = (fromBits(d[o + 2]) - cz) / r;
    // The covariance is packed ×4 as half floats: xx|xy, xz|yy, yz|zz.
    const xx = half(d[o + 4] & 0xffff) / 4, yy = half(d[o + 5] >>> 16) / 4, zz = half(d[o + 6] >>> 16) / 4;
    const size = Math.sqrt(Math.max(0, (xx + yy + zz) / 3)) / r;
    const c = d[o + 3];
    data[q] = x; data[q + 1] = y * sy; data[q + 2] = z * sy; data[q + 3] = Number.isFinite(size) ? size : 0;
    data[q + 4] = (c & 255) / 255; data[q + 5] = ((c >>> 8) & 255) / 255; data[q + 6] = ((c >>> 16) & 255) / 255; data[q + 7] = (c >>> 24) / 255;
  }
  return { data, rows, count: n };
}

/**
 * Where walker `i` is born and what it keeps (the Emit's GLSL does the same): undefined past the scan's end or below
 * `minOpacity`. `centre` and `size` are the Emit's (X, Y, Z and Size); 2D drops z.
 */
export function scanBirth(w: ScanWalkers, i: number, centre: [number, number, number], size: number, minOpacity = 0, d3 = true):
  { pos: [number, number, number]; colour: [number, number, number]; size: number; home: [number, number, number, number] } | undefined {
  if (i < 0 || i >= w.count) return undefined;
  const q = i * 8, D = w.data;
  if (D[q + 7] < minOpacity) return undefined;
  const pos: [number, number, number] = [centre[0] + size * D[q], centre[1] + size * D[q + 1], d3 ? centre[2] + size * D[q + 2] : 0];
  const s = size * D[q + 3];
  return { pos, colour: [D[q + 4], D[q + 5], D[q + 6]], size: s, home: [pos[0], pos[1], pos[2], s] };
}

/** The splats a group of `count` walkers keeps: at most `count`, evenly through the scan (the worker's Max splats). */
export const scanWalkersFor = (splats: number, count: number) => Math.max(0, Math.min(splats, count));
