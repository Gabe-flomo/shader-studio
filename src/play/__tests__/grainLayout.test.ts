/**
 * Where a grain is drawn (docs/granulator.md): straight, not an arc. The pure
 * layout helpers grIdHash / grGrainRow / grGrainSpan / grGrainOpacity, used by
 * the card's waveform pills, its spectral pills, and Grains → nulls' y.
 */
import { describe, expect, it } from 'vitest';
import { grGrainOpacity, grGrainRow, grGrainSpan, grIdHash, grMakeEngine, grNewStats, grReadStats, grSettings } from '../kit/granulator.js';

const SR = 48000;

describe('grIdHash', () => {
  it('is stable for the same id', () => {
    expect(grIdHash(7)).toBe(grIdHash(7));
    expect(grIdHash(41)).toBe(grIdHash(41));
  });
  it('lands in 0..1', () => {
    for (let id = 0; id < 64; id++) {
      const h = grIdHash(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
  it('differs across most ids (a spread, not one bucket)', () => {
    const vals = new Set<number>();
    for (let id = 0; id < 64; id++) vals.add(Math.round(grIdHash(id) * 1000));
    expect(vals.size).toBeGreaterThan(40);
  });
});

describe('grGrainRow', () => {
  it('is pan-based when hasPan: straight across, so the layout means something', () => {
    expect(grGrainRow(0, -1, true)).toBeCloseTo(0, 5);
    expect(grGrainRow(0, 1, true)).toBeCloseTo(1, 5);
    expect(grGrainRow(3, -0.6, true)).toBeCloseTo(0.2, 5);
    expect(grGrainRow(3, 0.6, true)).toBeCloseTo(0.8, 5);
  });
  it('clamps pan outside -1..1', () => {
    expect(grGrainRow(0, -5, true)).toBeCloseTo(0, 5);
    expect(grGrainRow(0, 5, true)).toBeCloseTo(1, 5);
  });
  it('clears dead centre a little either way', () => {
    const row = grGrainRow(1, 0, true); // pan 0 maps to the exact centre, 0.5
    expect(row).not.toBeCloseTo(0.5, 2);
    expect(Math.abs(row - 0.5)).toBeGreaterThan(0.01);
  });
  it('falls back to a hash of the id when pan is off, stable per id', () => {
    const a = grGrainRow(9, 0, false), b = grGrainRow(9, 0.7, false); // pan ignored when !hasPan
    expect(a).toBe(b);
    expect(grGrainRow(9, 0, false)).toBe(grGrainRow(9, 0, false));
  });
  it('spreads different ids over the height when pan is off', () => {
    const rows = new Set<number>();
    for (let id = 0; id < 32; id++) rows.add(Math.round(grGrainRow(id, 0, false) * 100));
    expect(rows.size).toBeGreaterThan(20);
  });
});

describe('grGrainSpan', () => {
  it('is pos ± half the grain size', () => {
    expect(grGrainSpan(0.5, 0.1)).toEqual([0.45, 0.55]);
    expect(grGrainSpan(0.2, 0)).toEqual([0.2, 0.2]);
  });
  it('treats a negative size as zero', () => {
    expect(grGrainSpan(0.5, -1)).toEqual([0.5, 0.5]);
  });
});

describe('grGrainOpacity', () => {
  it('follows the envelope amplitude, never fully gone, never past opaque', () => {
    expect(grGrainOpacity(0)).toBeCloseTo(0.15, 5);
    expect(grGrainOpacity(1)).toBeCloseTo(1, 5);
    expect(grGrainOpacity(0.5)).toBeCloseTo(0.575, 5);
  });
  it('clamps amplitude outside 0..1', () => {
    expect(grGrainOpacity(-2)).toBeCloseTo(0.15, 5);
    expect(grGrainOpacity(9)).toBeCloseTo(1, 5);
  });
});

describe('a live grain’s stats carry its pill (size, row)', () => {
  const buf = new Float32Array(SR); // 1 s of silence: only positions matter here
  it('size is the grain in sample time, and row is stable while a grain sounds', () => {
    const e = grMakeEngine()(SR, 1);
    e.setBuffer([buf], SR);
    e.set(grSettings(undefined, (addr, v) => (addr === '3' ? 200 : v))); // Grain size 200 ms
    e.noteOn(60, 1, 0);
    const L = new Float32Array(128), R = new Float32Array(128), st = grNewStats();
    let sizes: number[] = [], rows: number[] = [];
    for (let f = 0; f < SR; f += 128) {
      e.process(L, R, 128);
      e.stats(st);
      if (st.count) { sizes = Array.from(st.size.slice(0, st.count)); rows = Array.from(st.row.slice(0, st.count)); break; }
    }
    expect(sizes.length).toBeGreaterThan(0);
    // 200 ms of a 1 s sample is ~0.2 of its own duration.
    for (const s of sizes) expect(s).toBeGreaterThan(0.15);
    for (const s of sizes) expect(s).toBeLessThan(0.3);
    for (const r of rows) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); }
  });

  it('the worklet’s packed readouts round-trip size and row', () => {
    const e = grMakeEngine()(SR, 1);
    e.setBuffer([buf], SR);
    e.noteOn(60, 1, 0);
    const L = new Float32Array(128), R = new Float32Array(128), st = grNewStats();
    for (let f = 0; f < SR; f += 128) { e.process(L, R, 128); e.stats(st); if (st.count) break; }
    const c = st.count;
    expect(c).toBeGreaterThan(0);
    const out = new Float32Array(12 + c * 7);
    out[0] = c; out[1] = st.maxCount; out[2] = st.headCount; out[3] = st.headAxis;
    for (let h = 0; h < 8; h++) out[4 + h] = st.heads[h];
    for (let i = 0; i < c; i++) {
      out[12 + i] = st.pos[i]; out[12 + c + i] = st.amp[i]; out[12 + 2 * c + i] = st.pitch[i];
      out[12 + 3 * c + i] = st.band[i]; out[12 + 4 * c + i] = st.energy[i];
      out[12 + 5 * c + i] = st.size[i]; out[12 + 6 * c + i] = st.row[i];
    }
    const back = grReadStats(out, grNewStats());
    expect(back.count).toBe(c);
    for (let i = 0; i < c; i++) {
      expect(back.size[i]).toBeCloseTo(st.size[i], 6);
      expect(back.row[i]).toBeCloseTo(st.row[i], 6);
    }
  });
});
