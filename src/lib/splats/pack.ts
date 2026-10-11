/**
 * pack.ts — a scan laid out for the GPU, its back-to-front sort, and what the card says about it
 * (docs/splat-scene.md "How it draws"). Pure: the worker (worker.ts) and the tests use it.
 *
 * GPU layout (an RGBA32UI texture, 2048 texels wide, two texels a splat, so 1024 splats a row):
 *  - texel 0: the centre's x, y, z as float bits, and the colour as RGBA bytes (alpha = opacity);
 *  - texel 1: the 3D covariance (times 4, as antimatter15's viewer packs it) as three pairs of half floats: xx|xy,
 *    xz|yy, yz|zz; the fourth word is spare.
 * Spherical harmonics past degree 0 go in a second RGBA32UI texture, as bytes (c · 128 + 128, SPZ's quantisation),
 * [coefficient][channel], 1, 2 or 3 texels a splat for degree 1, 2 or 3 (TEXELS_PER_SH).
 *
 * The sort: a counting sort on 16-bit depth keys (65 536 buckets), one pass over the splats to bucket, one to place:
 * linear time, about 10 ms for a million in a worker. Far first, so the over-blend runs back to front.
 */
import { shCoeffs, type SplatData } from './format';

export const PACK_WIDTH = 2048;
export const SPLATS_PER_ROW = PACK_WIDTH / 2;
/** RGBA32UI texels per splat for the harmonics of degree 1, 2, 3 (3, 8, 15 coefficients × 3 bytes, in 16-byte texels). */
export const TEXELS_PER_SH = [0, 1, 2, 3] as const;
/** The SH texture's width: a multiple of 1, 2 and 3 texels, so a splat never straddles a row. */
export const SH_WIDTH = 2046;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const floatBits = (x: number) => { f32[0] = x; return u32[0]; };

/** IEEE half from a float (round to nearest), as WebGL's packHalf2x16. */
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >>> (1 - e);
    if (m & 0x1000) m += 0x2000;
    return sign | (m >>> 13);
  }
  if (m & 0x1000) { m += 0x2000; if (m & 0x800000) { m = 0; e++; if (e >= 31) return sign | 0x7c00; } }
  return sign | (e << 10) | (m >>> 13);
}
const packHalf2 = (a: number, b: number) => (toHalf(a) | (toHalf(b) << 16)) >>> 0;

export interface PackedSplats {
  count: number;
  /** RGBA32UI, PACK_WIDTH × rows. */
  data: Uint32Array;
  rows: number;
  shDegree: number;
  /** RGBA32UI, SH_WIDTH × shRows (degree > 0). */
  sh?: Uint32Array;
  shRows?: number;
}

/** The GPU layout for the first `limit` splats (all when absent). */
export function packSplats(d: SplatData, limit = d.count, shDegree = d.shDegree): PackedSplats {
  const n = Math.max(0, Math.min(limit, d.count));
  const rows = Math.max(1, Math.ceil(n / SPLATS_PER_ROW));
  const data = new Uint32Array(PACK_WIDTH * rows * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    data[o] = floatBits(d.positions[i * 3]);
    data[o + 1] = floatBits(d.positions[i * 3 + 1]);
    data[o + 2] = floatBits(d.positions[i * 3 + 2]);
    data[o + 3] = (d.colors[i * 4] | (d.colors[i * 4 + 1] << 8) | (d.colors[i * 4 + 2] << 16) | (d.colors[i * 4 + 3] << 24)) >>> 0;
    // Σ = (R S)(R S)ᵀ, inline (math.ts covariance3d says the same, allocating).
    const w = d.rotations[i * 4], x = d.rotations[i * 4 + 1], y = d.rotations[i * 4 + 2], z = d.rotations[i * 4 + 3];
    const sx = d.scales[i * 3], sy = d.scales[i * 3 + 1], sz = d.scales[i * 3 + 2];
    const m00 = (1 - 2 * (y * y + z * z)) * sx, m01 = 2 * (x * y - w * z) * sy, m02 = 2 * (x * z + w * y) * sz;
    const m10 = 2 * (x * y + w * z) * sx, m11 = (1 - 2 * (x * x + z * z)) * sy, m12 = 2 * (y * z - w * x) * sz;
    const m20 = 2 * (x * z - w * y) * sx, m21 = 2 * (y * z + w * x) * sy, m22 = (1 - 2 * (x * x + y * y)) * sz;
    data[o + 4] = packHalf2(4 * (m00 * m00 + m01 * m01 + m02 * m02), 4 * (m00 * m10 + m01 * m11 + m02 * m12));
    data[o + 5] = packHalf2(4 * (m00 * m20 + m01 * m21 + m02 * m22), 4 * (m10 * m10 + m11 * m11 + m12 * m12));
    data[o + 6] = packHalf2(4 * (m10 * m20 + m11 * m21 + m12 * m22), 4 * (m20 * m20 + m21 * m21 + m22 * m22));
  }
  const deg = Math.min(shDegree, d.shDegree);
  if (deg <= 0 || !d.sh) return { count: n, data, rows, shDegree: 0 };
  const K = shCoeffs(deg), Kf = shCoeffs(d.shDegree);
  const per = TEXELS_PER_SH[deg];
  const perRow = SH_WIDTH / per;
  const shRows = Math.max(1, Math.ceil(n / perRow));
  const sh = new Uint32Array(SH_WIDTH * shRows * 4);
  const bytes = new Uint8Array(sh.buffer);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = (i % perRow) * per;
    const base = (row * SH_WIDTH + col) * 16;
    for (let j = 0; j < K; j++) for (let ch = 0; ch < 3; ch++) {
      const v = d.sh[(i * Kf + j) * 3 + ch];
      bytes[base + j * 3 + ch] = Math.max(0, Math.min(255, Math.round(v * 128 + 128)));
    }
  }
  return { count: n, data, rows, shDegree: deg, sh, shRows };
}

/** Read back one splat's centre, colour and covariance from the GPU layout (for tests). */
export function unpackSplat(p: PackedSplats, i: number): { pos: [number, number, number]; rgba: [number, number, number, number]; cov: number[] } {
  const o = i * 8, d = p.data;
  const fl = (b: number) => { u32[0] = b; return f32[0]; };
  const half = (h: number) => {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    return e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15);
  };
  const pair = (w: number) => [half(w & 0xffff) / 4, half(w >>> 16) / 4];
  return {
    pos: [fl(d[o]), fl(d[o + 1]), fl(d[o + 2])],
    rgba: [d[o + 3] & 255, (d[o + 3] >>> 8) & 255, (d[o + 3] >>> 16) & 255, d[o + 3] >>> 24],
    cov: [...pair(d[o + 4]), ...pair(d[o + 5]), ...pair(d[o + 6])],
  };
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/** Scratch kept between sorts (a million-splat scan sorts every few frames). */
export interface SortScratch { keys: Uint16Array; counts: Uint32Array; out: Uint32Array; depth: Float32Array }

export function sortScratch(n: number, prev?: SortScratch): SortScratch {
  if (prev && prev.keys.length >= n) return prev;
  return { keys: new Uint16Array(n), counts: new Uint32Array(65536), out: new Uint32Array(n), depth: new Float32Array(n) };
}

/**
 * Splat indices far to near along `axis` (each splat's depth is dot(position, axis)), for the first `n` splats.
 * A counting sort on 16-bit keys: splats closer than 1/65 536 of the scan's depth range apart may come in either
 * order, which doesn't show.
 */
export function sortSplats(positions: Float32Array, n: number, axis: readonly number[], scratch = sortScratch(n)): Uint32Array {
  const { keys, counts, out, depth } = scratch;
  let lo = Infinity, hi = -Infinity;
  const [ax, ay, az] = axis;
  for (let i = 0; i < n; i++) {
    const d = positions[i * 3] * ax + positions[i * 3 + 1] * ay + positions[i * 3 + 2] * az;
    depth[i] = d;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  counts.fill(0);
  const span = hi - lo;
  const k = span > 0 ? 65535 / span : 0;
  // Far first: the key counts down from the far end.
  for (let i = 0; i < n; i++) { const key = Math.min(65535, ((hi - depth[i]) * k) | 0); keys[i] = key; counts[key]++; }
  for (let b = 0, sum = 0; b < 65536; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
  const result = out.length === n ? out : out.subarray(0, n);
  for (let i = 0; i < n; i++) result[counts[keys[i]]++] = i;
  return result;
}

// ── What the card says ──────────────────────────────────────────────────────

export interface SplatInfo {
  count: number;
  shDegree: number;
  format: string;
  /** Every splat's box. */
  min: [number, number, number];
  max: [number, number, number];
  /** The box without the farthest 1% each way (scans have stray splats far out): for framing. */
  coreMin: [number, number, number];
  coreMax: [number, number, number];
  center: [number, number, number];
  /** Half the core box's diagonal. */
  radius: number;
}

export function splatInfo(d: SplatData): SplatInfo {
  const n = d.count;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = d.positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  // The 1st and 99th percentiles per axis, from up to 20 000 evenly spaced splats.
  const step = Math.max(1, Math.floor(n / 20000));
  const coreMin: [number, number, number] = [0, 0, 0], coreMax: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i += step) vals.push(d.positions[i * 3 + k]);
    vals.sort((a, b) => a - b);
    coreMin[k] = vals.length ? vals[Math.floor((vals.length - 1) * 0.01)] : 0;
    coreMax[k] = vals.length ? vals[Math.ceil((vals.length - 1) * 0.99)] : 0;
  }
  if (!n) for (let k = 0; k < 3; k++) { min[k] = max[k] = 0; }
  const center: [number, number, number] = [0, 1, 2].map(k => (coreMin[k] + coreMax[k]) / 2) as [number, number, number];
  const radius = 0.5 * Math.hypot(coreMax[0] - coreMin[0], coreMax[1] - coreMin[1], coreMax[2] - coreMin[2]);
  return { count: n, shDegree: d.shDegree, format: d.format, min, max, coreMin, coreMax, center, radius };
}

/**
 * A small picture of the scan for the card and the library: up to 60 000 splats as dots, seen from the front
 * (−z, y down as 3DGS scans are), far first. RGBA, top-down.
 */
export function thumbnailPixels(d: SplatData, w: number, h: number, info = splatInfo(d)): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = 20; px[i * 4 + 1] = 22; px[i * 4 + 2] = 28; px[i * 4 + 3] = 255; }
  const n = d.count;
  if (!n) return px;
  const step = Math.max(1, Math.floor(n / 60000));
  const ids: number[] = [];
  for (let i = 0; i < n; i += step) ids.push(i);
  // Front view: looking along +z (3DGS cameras look down +z), far (big z) first.
  ids.sort((a, b) => d.positions[b * 3 + 2] - d.positions[a * 3 + 2]);
  const span = Math.max(info.coreMax[0] - info.coreMin[0], (info.coreMax[1] - info.coreMin[1]) * (w / h), 1e-6) * 1.1;
  const sc = w / span;
  for (const i of ids) {
    const x = Math.round((d.positions[i * 3] - info.center[0]) * sc + w / 2);
    const y = Math.round((d.positions[i * 3 + 1] - info.center[1]) * sc + h / 2);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const a = d.colors[i * 4 + 3] / 255, o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) px[o + k] = px[o + k] * (1 - a) + d.colors[i * 4 + k] * a;
  }
  return px;
}
