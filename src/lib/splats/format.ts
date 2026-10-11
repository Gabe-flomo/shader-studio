/**
 * format.ts — Gaussian splat files read into one plain layout (docs/splat-scene.md).
 *
 * Every reader gives the same thing, a `SplatData`, in the 3DGS PLY's own conventions:
 *  - positions in the file's space (3DGS scans are "right, down, forward": y points down; the Splat Scene node's
 *    "Scan is upside down" turns it over);
 *  - scales as lengths (not logs), one per axis;
 *  - rotations as unit quaternions w, x, y, z (the PLY's rot_0 is w);
 *  - colours as bytes: red, green, blue from the zeroth spherical harmonic (0.5 + C0 · f_dc), and opacity
 *    (sigmoid of the PLY's logit) as alpha;
 *  - optional higher spherical harmonics (degrees 1–3) as floats, [splat][coefficient][channel].
 *
 * Formats:
 *  - `.ply`: the 3DGS layout (x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3, optional f_rest_*), binary little or
 *    big endian, any property types. SuperSplat's compressed PLY (a `chunk` element) is recognised and refused with a
 *    clear message for now.
 *  - `.splat`: antimatter15's 32 bytes a splat (position 3 × f32, scale 3 × f32, colour RGBA u8, rotation 4 × u8 as
 *    (q · 128 + 128), w first).
 *  - `.spz`: Niantic's gzipped, quantised layout, versions 1–3 (the 16-byte header; positions 24-bit fixed point,
 *    or half floats in version 1; alpha, colour, scale, rotation and SH bytes). Version 4 (ZSTD streams) is refused
 *    with a clear message. SPZ stores "right, up, back" (three.js); it is turned to "right, down, forward" here, the
 *    same as a PLY of the same scan.
 *  - `.ksplat` is recognised by name and refused for now (a follow-up).
 *
 * Pure functions with no DOM: the parsing worker (worker.ts) and the tests share them.
 */
import { gunzipSync } from 'fflate';

/** The zeroth spherical harmonic's constant: colour = 0.5 + SH_C0 · f_dc. */
export const SH_C0 = 0.28209479177387814;

export type SplatFormat = 'ply' | 'splat' | 'spz' | 'ksplat';

export interface SplatData {
  count: number;
  /** 3 per splat. */
  positions: Float32Array;
  /** 3 per splat, as lengths. */
  scales: Float32Array;
  /** 4 per splat: w, x, y, z, unit length. */
  rotations: Float32Array;
  /** 4 per splat: r, g, b (0.5 + C0 · f_dc) and opacity, as bytes. */
  colors: Uint8Array;
  /** 0 to 3. */
  shDegree: number;
  /** Degree > 0: per splat, `shCoeffs(shDegree)` coefficients × 3 channels (the channel varies fastest). */
  sh?: Float32Array;
  format: SplatFormat;
}

/** Spherical-harmonic coefficients past the zeroth for a degree (1 → 3, 2 → 8, 3 → 15). */
export const shCoeffs = (degree: number): number => (degree <= 0 ? 0 : (degree + 1) * (degree + 1) - 1);

export class SplatFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'SplatFormatError'; }
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const toByte = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255));

/** The format a file name says (by its extension), or null. */
export function formatFromName(name: string): SplatFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'ply' || ext === 'splat' || ext === 'spz' || ext === 'ksplat' ? ext : null;
}

/** The format the bytes say (a PLY header, gzip for SPZ), else the name's, else null. */
export function detectFormat(bytes: Uint8Array, name = ''): SplatFormat | null {
  if (bytes.length >= 4 && bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79 && (bytes[3] === 0x0a || bytes[3] === 0x0d)) return 'ply';
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'spz';
  // An SPZ v4 file starts with the NGSP magic itself (no gzip).
  if (bytes.length >= 4 && readU32(bytes, 0) === SPZ_MAGIC) return 'spz';
  return formatFromName(name);
}

const readU32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Read any supported file. Throws a SplatFormatError with a plain sentence when it can't. */
export function parseSplatFile(bytes: Uint8Array, name = ''): SplatData {
  const format = detectFormat(bytes, name);
  if (format === 'ply') return parsePly(bytes);
  if (format === 'splat') return parseSplat(bytes);
  if (format === 'spz') return parseSpz(bytes);
  if (format === 'ksplat') throw new SplatFormatError('.ksplat files aren’t read yet. Export the scan as .ply, .splat or .spz from the app that made it.');
  throw new SplatFormatError('This isn’t a splat file Playfield knows (.ply, .splat or .spz).');
}

// ── Quaternions and covariance ───────────────────────────────────────────────

/** Normalise a quaternion in place (w, x, y, z at `o`); a zero one becomes the identity. */
function normQuat(q: Float32Array, o: number): void {
  const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]);
  if (l < 1e-12) { q[o] = 1; q[o + 1] = q[o + 2] = q[o + 3] = 0; return; }
  q[o] /= l; q[o + 1] /= l; q[o + 2] /= l; q[o + 3] /= l;
}

// ── .splat (antimatter15) ───────────────────────────────────────────────────

export const SPLAT_ROW_BYTES = 32;

export function parseSplat(bytes: Uint8Array): SplatData {
  if (bytes.length === 0 || bytes.length % SPLAT_ROW_BYTES !== 0) {
    throw new SplatFormatError(`This .splat file is ${bytes.length} bytes, not a whole number of 32-byte splats: it may be cut short, or another format.`);
  }
  const count = bytes.length / SPLAT_ROW_BYTES;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 3), scales = new Float32Array(count * 3), rotations = new Float32Array(count * 4), colors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * SPLAT_ROW_BYTES;
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = dv.getFloat32(o + 4 * k, true);
      scales[i * 3 + k] = dv.getFloat32(o + 12 + 4 * k, true);
    }
    for (let k = 0; k < 4; k++) {
      colors[i * 4 + k] = bytes[o + 24 + k];
      rotations[i * 4 + k] = (bytes[o + 28 + k] - 128) / 128;
    }
    normQuat(rotations, i * 4);
  }
  return { count, positions, scales, rotations, colors, shDegree: 0, format: 'splat' };
}

/** A SplatData as a .splat file (degree 0 only): for tests, and to save a converted scan. */
export function writeSplat(d: SplatData): Uint8Array {
  const out = new Uint8Array(d.count * SPLAT_ROW_BYTES);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < d.count; i++) {
    const o = i * SPLAT_ROW_BYTES;
    for (let k = 0; k < 3; k++) {
      dv.setFloat32(o + 4 * k, d.positions[i * 3 + k], true);
      dv.setFloat32(o + 12 + 4 * k, d.scales[i * 3 + k], true);
    }
    for (let k = 0; k < 4; k++) {
      out[o + 24 + k] = d.colors[i * 4 + k];
      out[o + 28 + k] = Math.max(0, Math.min(255, Math.round(d.rotations[i * 4 + k] * 128 + 128)));
    }
  }
  return out;
}

// ── .ply (3DGS) ─────────────────────────────────────────────────────────────

type PlyType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';
const PLY_TYPES: Record<string, PlyType> = {
  char: 'i8', int8: 'i8', uchar: 'u8', uint8: 'u8', short: 'i16', int16: 'i16', ushort: 'u16', uint16: 'u16',
  int: 'i32', int32: 'i32', uint: 'u32', uint32: 'u32', float: 'f32', float32: 'f32', double: 'f64', float64: 'f64',
};
const PLY_SIZE: Record<PlyType, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8 };

export interface PlyElement { name: string; count: number; props: Array<{ name: string; type: PlyType; list?: boolean }> }
export interface PlyHeader { format: 'binary_little_endian' | 'binary_big_endian' | 'ascii'; elements: PlyElement[]; dataOffset: number }

/** The PLY header (text up to `end_header`). */
export function readPlyHeader(bytes: Uint8Array): PlyHeader {
  // The header is ASCII; look for end_header in the first 64 KB.
  const head = bytes.subarray(0, Math.min(bytes.length, 65536));
  let text = '';
  for (let i = 0; i < head.length; i++) text += String.fromCharCode(head[i]);
  const endAt = text.indexOf('end_header');
  if (endAt < 0) throw new SplatFormatError('This .ply file has no end to its header: it may be cut short.');
  let dataOffset = endAt + 'end_header'.length;
  if (text[dataOffset] === '\r') dataOffset++;
  if (text[dataOffset] === '\n') dataOffset++;
  const lines = text.slice(0, endAt).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new SplatFormatError('This isn’t a .ply file (it doesn’t start with “ply”).');
  let format: PlyHeader['format'] | null = null;
  const elements: PlyElement[] = [];
  for (const line of lines.slice(1)) {
    const w = line.split(/\s+/);
    if (w[0] === 'format') {
      if (w[1] !== 'binary_little_endian' && w[1] !== 'binary_big_endian' && w[1] !== 'ascii') throw new SplatFormatError(`This .ply file’s format (${w[1]}) isn’t one Playfield reads.`);
      format = w[1];
    } else if (w[0] === 'element') {
      elements.push({ name: w[1], count: Number(w[2]) || 0, props: [] });
    } else if (w[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw new SplatFormatError('This .ply file’s header has a property before any element.');
      if (w[1] === 'list') { el.props.push({ name: w[4], type: PLY_TYPES[w[3]] ?? 'u8', list: true }); continue; }
      const type = PLY_TYPES[w[1]];
      if (!type) throw new SplatFormatError(`This .ply file has a property type Playfield doesn’t know (${w[1]}).`);
      el.props.push({ name: w[2], type });
    }
  }
  if (!format) throw new SplatFormatError('This .ply file’s header doesn’t say its format.');
  return { format, elements, dataOffset };
}

function readerFor(dv: DataView, type: PlyType, little: boolean): (o: number) => number {
  switch (type) {
    case 'i8': return o => dv.getInt8(o);
    case 'u8': return o => dv.getUint8(o);
    case 'i16': return o => dv.getInt16(o, little);
    case 'u16': return o => dv.getUint16(o, little);
    case 'i32': return o => dv.getInt32(o, little);
    case 'u32': return o => dv.getUint32(o, little);
    case 'f32': return o => dv.getFloat32(o, little);
    case 'f64': return o => dv.getFloat64(o, little);
  }
}

export function parsePly(bytes: Uint8Array): SplatData {
  const h = readPlyHeader(bytes);
  if (h.format === 'ascii') throw new SplatFormatError('This .ply file is text (ASCII). Splat scans are binary: export it again as a binary .ply.');
  if (h.elements.some(e => e.name === 'chunk')) throw new SplatFormatError('This is a compressed .ply (SuperSplat’s). It isn’t read yet: export it as an uncompressed .ply, .splat or .spz.');
  const little = h.format === 'binary_little_endian';
  let offset = h.dataOffset;
  let vertex: PlyElement | null = null;
  for (const el of h.elements) {
    if (el.name === 'vertex') { vertex = el; break; }
    if (el.props.some(p => p.list)) throw new SplatFormatError(`This .ply file has a list element (${el.name}) before its splats; it isn’t a splat scan.`);
    offset += el.count * el.props.reduce((s, p) => s + PLY_SIZE[p.type], 0);
  }
  if (!vertex) throw new SplatFormatError('This .ply file has no vertex element: no splats in it.');
  if (vertex.props.some(p => p.list)) throw new SplatFormatError('This .ply file’s vertices have lists: it’s a mesh, not a splat scan.');
  const stride = vertex.props.reduce((s, p) => s + PLY_SIZE[p.type], 0);
  const count = vertex.count;
  if (offset + count * stride > bytes.length) throw new SplatFormatError(`This .ply file says it has ${count.toLocaleString()} splats but is too short for them: it may be cut short.`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at: Record<string, { off: number; read: (o: number) => number }> = {};
  let off = 0;
  for (const p of vertex.props) { at[p.name] = { off, read: readerFor(dv, p.type, little) }; off += PLY_SIZE[p.type]; }
  const need = ['x', 'y', 'z'];
  for (const k of need) if (!at[k]) throw new SplatFormatError(`This .ply file’s vertices have no ${k}.`);
  const isSplat = !!(at.scale_0 && at.rot_0 && at.opacity);
  if (!isSplat) throw new SplatFormatError('This .ply file is a point cloud or mesh, not a Gaussian splat scan (it has no scale_0, rot_0 or opacity).');
  // Higher harmonics: f_rest_0 … f_rest_(3K − 1), channel-major (all red, then green, then blue).
  let rest = 0;
  while (at[`f_rest_${rest}`]) rest++;
  const perChannel = Math.floor(rest / 3);
  const shDegree = perChannel >= 15 ? 3 : perChannel >= 8 ? 2 : perChannel >= 3 ? 1 : 0;
  const K = shCoeffs(shDegree);
  const positions = new Float32Array(count * 3), scales = new Float32Array(count * 3), rotations = new Float32Array(count * 4), colors = new Uint8Array(count * 4);
  const sh = K ? new Float32Array(count * K * 3) : undefined;
  const g = (name: string) => at[name];
  const X = g('x'), Y = g('y'), Z = g('z');
  const S = [g('scale_0'), g('scale_1'), g('scale_2')], R = [g('rot_0'), g('rot_1'), g('rot_2'), g('rot_3')];
  const DC = [g('f_dc_0'), g('f_dc_1'), g('f_dc_2')];
  // A scan without f_dc but with red/green/blue bytes (some tools): those are the colour.
  const RGB = [g('red'), g('green'), g('blue')];
  const O = g('opacity');
  const restAt = Array.from({ length: K * 3 }, (_, i) => { const c = i % 3, j = (i - c) / 3; return g(`f_rest_${c * perChannel + j}`); });
  for (let i = 0, base = offset; i < count; i++, base += stride) {
    positions[i * 3] = X.read(base + X.off);
    positions[i * 3 + 1] = Y.read(base + Y.off);
    positions[i * 3 + 2] = Z.read(base + Z.off);
    for (let k = 0; k < 3; k++) scales[i * 3 + k] = S[k] ? Math.exp(S[k].read(base + S[k].off)) : 0.01;
    for (let k = 0; k < 4; k++) rotations[i * 4 + k] = R[k] ? R[k].read(base + R[k].off) : k === 0 ? 1 : 0;
    normQuat(rotations, i * 4);
    for (let k = 0; k < 3; k++) {
      colors[i * 4 + k] = DC[k] ? toByte(0.5 + SH_C0 * DC[k].read(base + DC[k].off)) : RGB[k] ? RGB[k].read(base + RGB[k].off) : 255;
    }
    colors[i * 4 + 3] = toByte(sigmoid(O.read(base + O.off)));
    if (sh) for (let j = 0; j < K * 3; j++) sh[i * K * 3 + j] = restAt[j].read(base + restAt[j].off);
  }
  return { count, positions, scales, rotations, colors, shDegree, ...(sh ? { sh } : {}), format: 'ply' };
}

/**
 * A SplatData as a 3DGS binary PLY (little endian, floats; f_rest_* when it has harmonics): for tests, the
 * sample converter, and to save a scan another tool reads.
 */
export function writePly(d: SplatData): Uint8Array {
  const K = shCoeffs(d.shDegree);
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: K * 3 }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${d.count}\n${props.map(p => `property float ${p}`).join('\n')}\nend_header\n`;
  const hb = new TextEncoder().encode(header);
  const stride = props.length * 4;
  const out = new Uint8Array(hb.length + d.count * stride);
  out.set(hb, 0);
  const dv = new DataView(out.buffer);
  const logit = (a: number) => { const x = Math.min(Math.max(a, 1e-6), 1 - 1e-6); return Math.log(x / (1 - x)); };
  for (let i = 0; i < d.count; i++) {
    let o = hb.length + i * stride;
    const put = (v: number) => { dv.setFloat32(o, v, true); o += 4; };
    put(d.positions[i * 3]); put(d.positions[i * 3 + 1]); put(d.positions[i * 3 + 2]);
    put(0); put(0); put(0);
    for (let k = 0; k < 3; k++) put((d.colors[i * 4 + k] / 255 - 0.5) / SH_C0);
    // f_rest is channel-major in the file: all red coefficients, then green, then blue.
    for (let c = 0; c < 3; c++) for (let j = 0; j < K; j++) put(d.sh ? d.sh[(i * K + j) * 3 + c] : 0);
    put(logit(d.colors[i * 4 + 3] / 255));
    for (let k = 0; k < 3; k++) put(Math.log(Math.max(d.scales[i * 3 + k], 1e-12)));
    for (let k = 0; k < 4; k++) put(d.rotations[i * 4 + k]);
  }
  return out;
}

// ── .spz (Niantic) ──────────────────────────────────────────────────────────

/** "NGSP", little endian. */
export const SPZ_MAGIC = 0x5053474e;
/** SPZ's colour quantisation: byte = (f_dc · 0.15 + 0.5) · 255. */
export const SPZ_COLOR_SCALE = 0.15;
/**
 * Per coefficient, the sign a harmonic takes when y and z flip ("right, up, back" → "right, down, forward"):
 * the product of the flips in its polynomial (degree 1: y, z, x; degree 2: xy, yz, 3z²−1, xz, x²−y²;
 * degree 3: y(3x²−y²), xyz, y(5z²−1), z(5z²−3), x(5z²−1), z(x²−y²), x(x²−3y²)).
 */
export const SH_FLIP_YZ = [-1, -1, 1, -1, 1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1];

const halfToFloat = (h: number): number => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
};

export interface SpzHeader { version: number; count: number; shDegree: number; fractionalBits: number; flags: number }

export function parseSpz(bytes: Uint8Array): SplatData {
  let raw = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { raw = gunzipSync(bytes); } catch { throw new SplatFormatError('This .spz file couldn’t be unpacked (its gzip data is broken).'); }
  }
  if (raw.length < 16 || readU32(raw, 0) !== SPZ_MAGIC) throw new SplatFormatError('This isn’t an .spz file (no NGSP header).');
  const version = readU32(raw, 4);
  if (version >= 4) throw new SplatFormatError(`This .spz file is version ${version}, which packs its data with ZSTD; Playfield reads versions 1–3 for now. Export it as .ply or an older .spz.`);
  if (version < 1) throw new SplatFormatError(`This .spz file’s version (${version}) isn’t one Playfield reads.`);
  const count = readU32(raw, 8);
  const shDegree = raw[12], fractionalBits = raw[13];
  if (shDegree > 3) throw new SplatFormatError(`This .spz file has spherical harmonics of degree ${shDegree}; Playfield reads up to 3.`);
  const K = shCoeffs(shDegree);
  const posBytes = version === 1 ? 6 : 9, rotBytes = version >= 3 ? 4 : 3;
  const need = 16 + count * (posBytes + 1 + 3 + 3 + rotBytes + K * 3);
  if (raw.length < need) throw new SplatFormatError(`This .spz file says it has ${count.toLocaleString()} splats but is too short for them: it may be cut short.`);
  let o = 16;
  const positions = new Float32Array(count * 3), scales = new Float32Array(count * 3), rotations = new Float32Array(count * 4), colors = new Uint8Array(count * 4);
  const sh = K ? new Float32Array(count * K * 3) : undefined;
  // Positions (flipping y and z: SPZ is right, up, back).
  const flip = [1, -1, -1];
  if (version === 1) {
    for (let i = 0; i < count * 3; i++) positions[i] = halfToFloat(raw[o + 2 * i] | (raw[o + 2 * i + 1] << 8)) * flip[i % 3];
  } else {
    const scale = 1 / (1 << fractionalBits);
    for (let i = 0; i < count * 3; i++) {
      let v = raw[o + 3 * i] | (raw[o + 3 * i + 1] << 8) | (raw[o + 3 * i + 2] << 16);
      if (v & 0x800000) v |= ~0xffffff;
      positions[i] = v * scale * flip[i % 3];
    }
  }
  o += count * posBytes;
  for (let i = 0; i < count; i++) colors[i * 4 + 3] = raw[o + i];
  o += count;
  for (let i = 0; i < count * 3; i++) {
    const dc = (raw[o + i] / 255 - 0.5) / SPZ_COLOR_SCALE;
    colors[Math.floor(i / 3) * 4 + (i % 3)] = toByte(0.5 + SH_C0 * dc);
  }
  o += count * 3;
  for (let i = 0; i < count * 3; i++) scales[i] = Math.exp(raw[o + i] / 16 - 10);
  o += count * 3;
  const q = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (rotBytes === 3) {
      const x = raw[o + 3 * i] / 127.5 - 1, y = raw[o + 3 * i + 1] / 127.5 - 1, z = raw[o + 3 * i + 2] / 127.5 - 1;
      q[0] = x; q[1] = y; q[2] = z; q[3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    } else {
      spzSmallestThree(raw, o + 4 * i, q);
    }
    // xyzw → w, x, y, z, with y and z flipped (a 180° turn about x).
    rotations[i * 4] = q[3]; rotations[i * 4 + 1] = q[0]; rotations[i * 4 + 2] = -q[1]; rotations[i * 4 + 3] = -q[2];
    normQuat(rotations, i * 4);
  }
  o += count * rotBytes;
  if (sh) {
    for (let i = 0; i < count; i++) for (let j = 0; j < K; j++) for (let c = 0; c < 3; c++) {
      const idx = (i * K + j) * 3 + c;
      sh[idx] = ((raw[o + idx] - 128) / 128) * SH_FLIP_YZ[j];
    }
  }
  return { count, positions, scales, rotations, colors, shDegree, ...(sh ? { sh } : {}), format: 'spz' };
}

/** SPZ v3's "smallest three" quaternion (4 bytes) into q as x, y, z, w. */
export function spzSmallestThree(b: Uint8Array, o: number, q: number[]): void {
  let comp = readU32(b, o);
  const largest = comp >>> 30;
  const mask = (1 << 9) - 1;
  let sum = 0;
  for (let i = 3; i >= 0; i--) {
    if (i === largest) continue;
    const mag = comp & mask, neg = (comp >>> 9) & 1;
    comp >>>= 10;
    const v = Math.SQRT1_2 * mag / mask;
    q[i] = neg ? -v : v;
    sum += v * v;
  }
  q[largest] = Math.sqrt(Math.max(0, 1 - sum));
}

/**
 * A SplatData as an SPZ (version 2 or 3, gzipped by the caller or not): for tests. Written to the published layout,
 * read back by parseSpz; the quantisation is SPZ's own.
 */
export function writeSpzRaw(d: SplatData, version: 2 | 3 = 2, fractionalBits = 12): Uint8Array {
  const K = shCoeffs(d.shDegree), n = d.count, rotBytes = version === 3 ? 4 : 3;
  const out = new Uint8Array(16 + n * (9 + 1 + 3 + 3 + rotBytes + K * 3));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, SPZ_MAGIC, true); dv.setUint32(4, version, true); dv.setUint32(8, n, true);
  out[12] = d.shDegree; out[13] = fractionalBits;
  let o = 16;
  const flip = [1, -1, -1];
  for (let i = 0; i < n * 3; i++) {
    const v = Math.round(d.positions[i] * flip[i % 3] * (1 << fractionalBits));
    out[o + 3 * i] = v & 0xff; out[o + 3 * i + 1] = (v >> 8) & 0xff; out[o + 3 * i + 2] = (v >> 16) & 0xff;
  }
  o += n * 9;
  for (let i = 0; i < n; i++) out[o + i] = d.colors[i * 4 + 3];
  o += n;
  for (let i = 0; i < n * 3; i++) {
    const dc = (d.colors[Math.floor(i / 3) * 4 + (i % 3)] / 255 - 0.5) / SH_C0;
    out[o + i] = Math.max(0, Math.min(255, Math.round((dc * SPZ_COLOR_SCALE + 0.5) * 255)));
  }
  o += n * 3;
  for (let i = 0; i < n * 3; i++) out[o + i] = Math.max(0, Math.min(255, Math.round((Math.log(d.scales[i]) + 10) * 16)));
  o += n * 3;
  for (let i = 0; i < n; i++) {
    // w, x, y, z → SPZ's x, y, z, w (y and z flipped back), w kept positive.
    let x = d.rotations[i * 4 + 1], y = -d.rotations[i * 4 + 2], z = -d.rotations[i * 4 + 3], w = d.rotations[i * 4];
    if (version === 2) {
      if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
      out[o + 3 * i] = Math.round((x + 1) * 127.5); out[o + 3 * i + 1] = Math.round((y + 1) * 127.5); out[o + 3 * i + 2] = Math.round((z + 1) * 127.5);
    } else {
      const q = [x, y, z, w];
      let largest = 0;
      for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[largest])) largest = k;
      const negate = q[largest] < 0;
      const mask = (1 << 9) - 1;
      let comp = largest;
      for (let k = 0; k < 4; k++) {
        if (k === largest) continue;
        const neg = (q[k] < 0) !== negate ? 1 : 0;
        const mag = Math.round(mask * Math.abs(q[k]) / Math.SQRT1_2);
        comp = (comp << 10) | (neg << 9) | Math.min(mag, mask);
      }
      dv.setUint32(o + 4 * i, comp >>> 0, true);
    }
  }
  o += n * rotBytes;
  if (d.sh) for (let i = 0; i < n; i++) for (let j = 0; j < K; j++) for (let c = 0; c < 3; c++) {
    const idx = (i * K + j) * 3 + c;
    out[o + idx] = Math.max(0, Math.min(255, Math.round(d.sh[idx] * SH_FLIP_YZ[j] * 128 + 128)));
  }
  return out;
}
