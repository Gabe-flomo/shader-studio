import { describe, expect, it } from 'vitest';
import { BAND_MAX_HZ, BAND_MIN_HZ, bandsOf, newBand } from '../../../lib/audioTools/bands';
import {
  MAX_WIDTH_OCT, MIN_WIDTH_OCT, bandRange, bandResponse, bandView, dragFreq, dragWidth, hzToX, newBandAt, noteName, qToWidth,
  wheelSlope, wheelWidth, widthToQ, withFreq, withShape, withWidth, xToHz,
} from '../bandEq';

describe('band shape migration', () => {
  it('reads a band saved before shapes as a Band spanning its lo–hi, 24 dB/oct', () => {
    const [b] = bandsOf({ bands: [{ id: 'b1', name: 'Kick', lo: 30, hi: 150, trigger: true }] });
    expect(b).toMatchObject({ shape: 'band', slope: 24, lo: 30, hi: 150, trigger: true });
  });
  it('keeps a valid shape and slope, and drops odd ones', () => {
    const bs = bandsOf({ bands: [
      { id: 'a', lo: 200, hi: 900, shape: 'lowcut', slope: 48 },
      { id: 'b', lo: 200, hi: 900, shape: 'highcut', slope: 12 },
      { id: 'c', lo: 200, hi: 900, shape: 'notch', slope: 7 },
    ] });
    expect(bs[0]).toMatchObject({ shape: 'lowcut', slope: 48, lo: 200, hi: BAND_MAX_HZ });
    expect(bs[1]).toMatchObject({ shape: 'highcut', slope: 12, lo: BAND_MIN_HZ, hi: 900 });
    expect(bs[2]).toMatchObject({ shape: 'band', slope: 24, lo: 200, hi: 900 });
  });
  it('gives a new band the Band shape', () => {
    expect(newBand([], 'kick')).toMatchObject({ shape: 'band', slope: 24, lo: 30, hi: 150 });
  });
});

describe('the curve', () => {
  const band = { lo: 250, hi: 1000, shape: 'band' as const, slope: 24 as const };
  it('a Band passes all at its centre, about −3 dB at its edges, little far away', () => {
    expect(bandResponse(band, 500)).toBeCloseTo(1, 6);
    for (const edge of [250, 1000]) {
      const r = bandResponse(band, edge);
      expect(r).toBeGreaterThan(0.6);
      expect(r).toBeLessThan(0.8);
    }
    expect(bandResponse(band, 30)).toBeLessThan(0.01);
    expect(bandResponse(band, 12000)).toBeLessThan(0.01);
  });
  it('a steeper slope falls faster outside the band', () => {
    expect(bandResponse({ ...band, slope: 48 }, 2000)).toBeLessThan(bandResponse({ ...band, slope: 12 }, 2000));
  });
  it('a Low cut lets through what is above its corner', () => {
    const lc = { lo: 1000, hi: BAND_MAX_HZ, shape: 'lowcut' as const, slope: 24 as const };
    expect(bandResponse(lc, 1000)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(bandResponse(lc, 10000)).toBeGreaterThan(0.99);
    expect(bandResponse(lc, 100)).toBeLessThan(0.001);
  });
  it('a High cut lets through what is below its corner', () => {
    const hc = { lo: BAND_MIN_HZ, hi: 1000, shape: 'highcut' as const, slope: 12 as const };
    expect(bandResponse(hc, 1000)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(bandResponse(hc, 100)).toBeGreaterThan(0.99);
    expect(bandResponse(hc, 10000)).toBeLessThan(0.02);
  });
});

describe('view ↔ lo / hi', () => {
  it('maps 20 Hz – 20 kHz across 0–1 on a log scale, both ways', () => {
    expect(hzToX(20)).toBeCloseTo(0, 6);
    expect(hzToX(20000)).toBeCloseTo(1, 6);
    expect(hzToX(632.456)).toBeCloseTo(0.5, 4);
    for (const hz of [20, 55, 440, 1234, 9000, 20000]) expect(xToHz(hzToX(hz))).toBeCloseTo(hz, 3);
    expect(dragFreq(0.5)).toBeCloseTo(632.456, 2);
  });
  it('a Band is its geometric centre and its width in octaves', () => {
    const v = bandView({ lo: 250, hi: 1000, shape: 'band' });
    expect(v.freq).toBeCloseTo(500, 6);
    expect(v.width).toBeCloseTo(2, 6);
    expect(bandRange('band', 500, 2)).toEqual({ lo: 250, hi: 1000 });
  });
  it('moving keeps the width; widening keeps the centre', () => {
    const b = { lo: 250, hi: 1000, shape: 'band' as const };
    expect(withFreq(b, 1000)).toEqual({ lo: 500, hi: 2000 });
    expect(withWidth(b, 1)).toEqual({ lo: 354, hi: 707 });
  });
  it('a band slides inside the range instead of squashing at an end', () => {
    const r = bandRange('band', 25, 2);
    expect(r.lo).toBe(BAND_MIN_HZ);
    expect(Math.log2(r.hi / r.lo)).toBeCloseTo(2, 1);
  });
  it('a cut is its corner; changing shape keeps the handle where it is', () => {
    expect(bandView({ lo: 800, hi: BAND_MAX_HZ, shape: 'lowcut' }).freq).toBe(800);
    expect(bandView({ lo: BAND_MIN_HZ, hi: 800, shape: 'highcut' }).freq).toBe(800);
    expect(withShape({ lo: 250, hi: 1000, shape: 'band' }, 'lowcut')).toEqual({ shape: 'lowcut', lo: 500, hi: BAND_MAX_HZ });
    expect(withShape({ lo: 500, hi: BAND_MAX_HZ, shape: 'lowcut' }, 'band')).toEqual({ shape: 'band', lo: 354, hi: 707 });
    expect(newBandAt(1000)).toEqual({ lo: 707, hi: 1414 });
  });
});

describe('drag and wheel', () => {
  it('dragging up narrows a Band, down widens it, within limits', () => {
    expect(dragWidth(2, 0)).toBe(2);
    expect(dragWidth(2, -80)).toBeCloseTo(1, 6);
    expect(dragWidth(2, 80)).toBeCloseTo(4, 6);
    expect(dragWidth(2, -10000)).toBe(MIN_WIDTH_OCT);
    expect(dragWidth(2, 10000)).toBe(MAX_WIDTH_OCT);
  });
  it('scrolling up narrows (a higher Q), down widens', () => {
    expect(wheelWidth(1, -400)).toBeCloseTo(0.5, 6);
    expect(wheelWidth(1, 400)).toBeCloseTo(2, 6);
    expect(widthToQ(wheelWidth(1, -100))).toBeGreaterThan(widthToQ(1));
  });
  it('scrolling over a cut steps its slope', () => {
    expect(wheelSlope(24, -100)).toBe(48);
    expect(wheelSlope(24, 100)).toBe(12);
    expect(wheelSlope(48, -100)).toBe(48);
    expect(wheelSlope(12, 100)).toBe(12);
  });
  it('width ↔ Q', () => {
    expect(widthToQ(1)).toBeCloseTo(1.414, 3);
    for (const w of [0.3, 1, 2.5]) expect(qToWidth(widthToQ(w))).toBeCloseTo(w, 6);
  });
  it('names the note under a frequency', () => {
    expect(noteName(440)).toBe('A4');
    expect(noteName(261.63)).toBe('C4');
    expect(noteName(55)).toBe('A1');
  });
});
