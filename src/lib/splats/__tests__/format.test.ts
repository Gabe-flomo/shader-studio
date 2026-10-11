import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import { SH_C0, SplatFormatError, detectFormat, parsePly, parseSplat, parseSplatFile, parseSpz, readPlyHeader, writePly, writeSplat, writeSpzRaw, spzSmallestThree, SPZ_MAGIC } from '../format';
import { ringScan } from './fixtures';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(eps);
};

/** Quaternions match up to sign (q and −q are the same rotation). */
const sameRotations = (a: Float32Array, b: Float32Array, eps: number) => {
  for (let i = 0; i < a.length / 4; i++) {
    const d = a[i * 4] * b[i * 4] + a[i * 4 + 1] * b[i * 4 + 1] + a[i * 4 + 2] * b[i * 4 + 2] + a[i * 4 + 3] * b[i * 4 + 3];
    expect(Math.abs(Math.abs(d) - 1)).toBeLessThan(eps);
  }
};

describe('.splat (32 bytes a splat)', () => {
  it('maps every field of a hand-built row', () => {
    const row = new Uint8Array(32);
    const dv = new DataView(row.buffer);
    dv.setFloat32(0, 1.5, true); dv.setFloat32(4, -2, true); dv.setFloat32(8, 0.25, true);
    dv.setFloat32(12, 0.1, true); dv.setFloat32(16, 0.2, true); dv.setFloat32(20, 0.3, true);
    row.set([10, 20, 30, 200], 24);
    // The identity rotation: w = 1 → 255 (q · 128 + 128, clamped), x = y = z = 0 → 128.
    row.set([255, 128, 128, 128], 28);
    const d = parseSplat(row);
    expect(d.count).toBe(1);
    close(d.positions, [1.5, -2, 0.25], 1e-6);
    close(d.scales, [0.1, 0.2, 0.3], 1e-6);
    expect([...d.colors]).toEqual([10, 20, 30, 200]);
    close(d.rotations, [1, 0, 0, 0], 1e-6);
    expect(d.shDegree).toBe(0);
  });

  it('round-trips the ring through writeSplat', () => {
    const ring = ringScan(24);
    const back = parseSplat(writeSplat(ring));
    expect(back.count).toBe(24);
    close(back.positions, ring.positions, 1e-6);
    close(back.scales, ring.scales, 1e-6);
    expect([...back.colors]).toEqual([...ring.colors]);
    sameRotations(back.rotations, ring.rotations, 2e-4);
  });

  it('refuses a file that is not whole rows', () => {
    expect(() => parseSplat(new Uint8Array(33))).toThrow(SplatFormatError);
  });
});

describe('.ply (3DGS)', () => {
  it('reads the header: format, elements, properties', () => {
    const h = readPlyHeader(writePly(ringScan(3)));
    expect(h.format).toBe('binary_little_endian');
    expect(h.elements[0].name).toBe('vertex');
    expect(h.elements[0].count).toBe(3);
    expect(h.elements[0].props.map(p => p.name).slice(0, 9)).toEqual(['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2']);
  });

  it('maps the fields: exp(scale), sigmoid(opacity), 0.5 + C0 · f_dc, rot_0 is w', () => {
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 1\n' +
      ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map(p => `property float ${p}`).join('\n') + '\nend_header\n';
    const hb = new TextEncoder().encode(header);
    const buf = new Uint8Array(hb.length + 14 * 4);
    buf.set(hb);
    const dv = new DataView(buf.buffer);
    const vals = [1, 2, 3, 0, 1, -1, 0, Math.log(0.5), Math.log(0.25), 0, 2, 0, 0, 0];
    vals.forEach((v, i) => dv.setFloat32(hb.length + i * 4, v, true));
    const d = parsePly(buf);
    close(d.positions, [1, 2, 3], 1e-6);
    close(d.scales, [0.5, 0.25, 1], 1e-6);
    // rot (2, 0, 0, 0) normalised: the identity, w first.
    close(d.rotations, [1, 0, 0, 0], 1e-6);
    expect(d.colors[0]).toBe(128); // 0.5 + C0 · 0
    expect(d.colors[1]).toBe(Math.round((0.5 + SH_C0) * 255));
    expect(d.colors[2]).toBe(Math.round((0.5 - SH_C0) * 255));
    expect(d.colors[3]).toBe(128); // sigmoid(0) = 0.5
  });

  it('round-trips the ring, harmonics included (f_rest is channel-major in the file)', () => {
    const ring = ringScan(10, 1, [0, 0, 0], 3);
    const bytes = writePly(ring);
    expect(readPlyHeader(bytes).elements[0].props.filter(p => p.name.startsWith('f_rest_')).length).toBe(45);
    const back = parsePly(bytes);
    expect(back.shDegree).toBe(3);
    close(back.positions, ring.positions, 1e-6);
    close(back.scales, ring.scales, 1e-5);
    sameRotations(back.rotations, ring.rotations, 1e-5);
    for (let i = 0; i < ring.colors.length; i++) expect(Math.abs(back.colors[i] - ring.colors[i])).toBeLessThanOrEqual(1);
    close(back.sh!, ring.sh!, 1e-6);
  });

  it('reads degree 1 from 9 f_rest properties', () => {
    const back = parsePly(writePly(ringScan(4, 1, [0, 0, 0], 1)));
    expect(back.shDegree).toBe(1);
    expect(back.sh!.length).toBe(4 * 3 * 3);
  });

  it('reads big-endian doubles too', () => {
    const header = 'ply\nformat binary_big_endian 1.0\nelement vertex 1\n' + ['x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map(p => `property double ${p}`).join('\n') + '\nend_header\n';
    const hb = new TextEncoder().encode(header);
    const buf = new Uint8Array(hb.length + 11 * 8);
    buf.set(hb);
    const dv = new DataView(buf.buffer);
    [4, 5, 6, 0, 0, 0, 0, 1, 0, 0, 0].forEach((v, i) => dv.setFloat64(hb.length + i * 8, v, false));
    const d = parsePly(buf);
    close(d.positions, [4, 5, 6], 1e-9);
    close(d.scales, [1, 1, 1], 1e-9);
  });

  it('says plainly what it can’t read', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(() => parsePly(enc('ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nend_header\n'))).toThrow(/text/);
    expect(() => parsePly(enc('ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nelement vertex 0\nproperty uint packed_position\nend_header\n'))).toThrow(/compressed/);
    expect(() => parsePly(enc('ply\nformat binary_little_endian 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n'))).toThrow(/point cloud/);
    expect(() => parsePly(enc('ply\nformat binary_little_endian 1.0\nelement vertex 5\n' + ['x', 'y', 'z', 'opacity', 'scale_0', 'rot_0'].map(p => `property float ${p}`).join('\n') + '\nend_header\n'))).toThrow(/cut short/);
  });
});

describe('.spz (Niantic, versions 1–3)', () => {
  it('round-trips the ring at version 2 and 3 within SPZ’s quantisation', () => {
    const ring = ringScan(24, 1, [0.5, -0.25, 2], 1);
    for (const v of [2, 3] as const) {
      const back = parseSpz(gzipSync(writeSpzRaw(ring, v)));
      expect(back.count).toBe(24);
      expect(back.shDegree).toBe(1);
      close(back.positions, ring.positions, 1 / 4096 + 1e-6);
      // log scale in 1/16 steps: within 3.2% of the length.
      for (let i = 0; i < ring.scales.length; i++) expect(Math.abs(back.scales[i] / ring.scales[i] - 1)).toBeLessThan(0.033);
      // colour through f_dc · 0.15 + 0.5 in bytes: within 2 levels.
      for (let i = 0; i < ring.colors.length; i++) expect(Math.abs(back.colors[i] - ring.colors[i])).toBeLessThanOrEqual(2);
      sameRotations(back.rotations, ring.rotations, v === 2 ? 2e-3 : 2e-3);
      close(back.sh!, ring.sh!, 1 / 128 + 1e-6);
    }
  });

  it('turns SPZ’s right-up-back into the PLY’s right-down-forward (y and z flipped)', () => {
    const one = ringScan(1, 0, [1, 2, 3]);
    const raw = writeSpzRaw(one, 2);
    // The stored position is (1, −2, −3).
    const fixed = (o: number) => { let v = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16); if (v & 0x800000) v |= ~0xffffff; return v / 4096; };
    expect([fixed(16), fixed(19), fixed(22)]).toEqual([1, -2, -3]);
    close(parseSpz(raw).positions, [1, 2, 3], 1e-6);
  });

  it('decodes a smallest-three quaternion by hand', () => {
    // Largest index 3 (w); x = +0.5·√½·…: magnitudes 511 (√½), 0, 0 with x first.
    // comp bits (high to low): largest(2) | x: sign 0, mag 511 | y: 0 | z: 0.
    const comp = (3 << 30) | (511 << 20);
    const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, comp >>> 0, true);
    const q = [0, 0, 0, 0];
    spzSmallestThree(b, 0, q);
    close(q, [Math.SQRT1_2, 0, 0, Math.SQRT1_2], 1e-6);
  });

  it('reads an un-gzipped file, refuses version 4 and junk', () => {
    const ring = ringScan(5);
    expect(parseSpz(writeSpzRaw(ring)).count).toBe(5);
    const v4 = new Uint8Array(32); new DataView(v4.buffer).setUint32(0, SPZ_MAGIC, true); new DataView(v4.buffer).setUint32(4, 4, true);
    expect(() => parseSpz(v4)).toThrow(/ZSTD/);
    expect(() => parseSpz(gzipSync(new Uint8Array(20)))).toThrow(/NGSP/);
  });
});

describe('detecting the format', () => {
  it('by the bytes first, then the name', () => {
    expect(detectFormat(writePly(ringScan(1)), 'x.splat')).toBe('ply');
    expect(detectFormat(gzipSync(writeSpzRaw(ringScan(1))), 'scan.bin')).toBe('spz');
    expect(detectFormat(writeSplat(ringScan(1)), 'scan.splat')).toBe('splat');
    expect(detectFormat(new Uint8Array(8), 'a.ksplat')).toBe('ksplat');
    expect(() => parseSplatFile(new Uint8Array(8), 'a.ksplat')).toThrow(/ksplat/);
    expect(() => parseSplatFile(new Uint8Array(8), 'a.obj')).toThrow(SplatFormatError);
  });
});
