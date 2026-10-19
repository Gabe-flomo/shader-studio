// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BAND_MAX_HZ, BAND_MIN_HZ, bandsOf, newBand } from '../../../lib/audioTools/bands';
import { bandSections, webAudioQ } from '../../../lib/audioTools/bandFilter';
import { modalOpen } from '../../../lib/modalOpen';
import {
  MAX_WIDTH_OCT, MIN_WIDTH_OCT, bandGains, bandRange, bandResponse, bandView, dragFreq, dragWidth, hzToX, isBandDeleteKey, newBandAt,
  noteName, qToWidth, wheelSlope, wheelWidth, widthToQ, withFreq, withShape, withWidth, xToHz,
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
    expect(newBand([], 'kick')).toMatchObject({ shape: 'band', slope: 24, lo: 40, hi: 130 });
  });
});

describe('the curve: the filters the band is heard through', () => {
  const SR = 48000;
  const db = (b: Parameters<typeof bandResponse>[0], hz: number) => 20 * Math.log10(bandResponse(b, hz, SR));
  const SLOPES = [12, 24, 48] as const;
  const BANDS = [
    { lo: 1141, hi: 1223 }, // 0.1 oct, Q 14.4 (the user's band)
    { lo: 250, hi: 1000 },
    { lo: 40, hi: 90 },
    { lo: 200, hi: 2000 },
    { lo: 6000, hi: 16000 }, // near Nyquist: the pre-warp keeps lo / hi at −3 dB
  ];
  it('a Band is 0 dB at its centre and −3 dB (±0.2) at its lo and hi, at every slope', () => {
    for (const r of BANDS) for (const slope of SLOPES) {
      const b = { ...r, shape: 'band' as const, slope };
      const f0 = bandSections(b, SR)[0].freq;
      expect(db(b, f0)).toBeCloseTo(0, 4);
      // The geometric centre (the handle): 0 dB, a hair under near Nyquist (−0.11 dB for 6–16 kHz at 48 kHz).
      expect(Math.abs(db(b, bandView(b).freq))).toBeLessThan(0.15);
      expect(db(b, r.lo)).toBeGreaterThan(-3.2); expect(db(b, r.lo)).toBeLessThan(-2.8);
      expect(db(b, r.hi)).toBeGreaterThan(-3.2); expect(db(b, r.hi)).toBeLessThan(-2.8);
      // Inside lo–hi it passes more than −3 dB; outside, less.
      expect(db(b, r.lo * 1.01)).toBeGreaterThan(-3.01);
      expect(db(b, r.lo / 1.01)).toBeLessThan(-2.99);
    }
  });
  /** The width in octaves where a band is `level` dB down (bisection either side of its centre). */
  const widthAt = (b: Parameters<typeof bandResponse>[0], level: number) => {
    const c = bandSections(b, SR)[0].freq;
    const edge = (dir: 1 | -1) => {
      let a = 0, z = 8;
      for (let i = 0; i < 60; i++) { const m = (a + z) / 2; if (db(b, c * 2 ** (dir * m)) > level) a = m; else z = m; }
      return a;
    };
    return edge(1) + edge(-1);
  };
  it('a Q-14 band is a narrow spike: narrower than a Q-1 band at −12 dB by the ratio a band-pass gives', () => {
    const q14 = bandRange('band', 1000, qToWidth(14)), q1 = bandRange('band', 1000, qToWidth(1));
    const b14 = { ...q14, shape: 'band' as const, slope: 12 as const }, b1 = { ...q1, shape: 'band' as const, slope: 12 as const };
    // Analogue band-pass: −12 dB where Q·(Ω − 1/Ω) = √(10^1.2 − 1); its width there 2·log2 Ω_hi.
    const expected = (q: number) => { const u = Math.sqrt(10 ** 1.2 - 1) / q; return 2 * Math.log2((u + Math.sqrt(u * u + 4)) / 2); };
    const w14 = widthAt(b14, -12), w1 = widthAt(b1, -12);
    expect(w14).toBeCloseTo(expected(widthToQ(bandView(b14).width)), 2);
    // (Its −12 dB points reach 4 kHz, where the digital filter is a little narrower than the analogue one.)
    expect(w1).toBeCloseTo(expected(widthToQ(bandView(b1).width)), 1);
    expect(w1 / w14).toBeGreaterThan(0.95 * (expected(1) / expected(14)));
    expect(w1 / w14).toBeLessThan(1.05 * (expected(1) / expected(14)));
    expect(w1 / w14).toBeGreaterThan(5);
    // And at −3 dB it is exactly its width.
    expect(widthAt(b14, -3)).toBeCloseTo(bandView(b14).width, 2);
  });
  it('a steeper slope falls faster outside the band', () => {
    const band = { lo: 250, hi: 1000, shape: 'band' as const };
    expect(db({ ...band, slope: 48 }, 4000)).toBeLessThan(db({ ...band, slope: 24 }, 4000));
    expect(db({ ...band, slope: 24 }, 4000)).toBeLessThan(db({ ...band, slope: 12 }, 4000));
  });
  it('a Low cut is −3 dB at its corner, flat above, and falls at its slope well below', () => {
    for (const slope of SLOPES) {
      const lc = { lo: 1000, hi: BAND_MAX_HZ, shape: 'lowcut' as const, slope };
      expect(db(lc, 1000)).toBeCloseTo(-3.01, 1);
      expect(db(lc, 8000)).toBeGreaterThan(-0.1);
      const perOct = db(lc, 1000 / 8) - db(lc, 1000 / 16);
      expect(perOct).toBeGreaterThan(slope - 0.5); expect(perOct).toBeLessThan(slope + 0.5);
    }
  });
  it('a High cut is −3 dB at its corner, flat below, and falls at its slope well above', () => {
    for (const slope of SLOPES) {
      const hc = { lo: BAND_MIN_HZ, hi: 200, shape: 'highcut' as const, slope };
      expect(db(hc, 200)).toBeCloseTo(-3.01, 1);
      expect(db(hc, 25)).toBeGreaterThan(-0.1);
      const perOct = db(hc, 1600) - db(hc, 3200);
      expect(perOct).toBeGreaterThan(slope - 0.5); expect(perOct).toBeLessThan(slope + 1);
    }
  });
  it('what is heard: the sections Solo plays, with WebAudio\'s dB Q for a low- / high-pass', () => {
    const b = { lo: 1141, hi: 1223, shape: 'band' as const, slope: 12 as const };
    const [s] = bandSections(b, SR);
    expect(s.type).toBe('bandpass');
    // Q 14.4, the panel's, within the pre-warp's 0.5%.
    expect(Math.abs(s.q / widthToQ(bandView(b).width) - 1)).toBeLessThan(0.005);
    expect(webAudioQ(s)).toBe(s.q);
    expect(bandSections({ ...b, slope: 48 }, SR)).toHaveLength(4);
    const lp = bandSections({ lo: BAND_MIN_HZ, hi: 500, shape: 'highcut', slope: 12 }, SR);
    expect(lp).toEqual([{ type: 'lowpass', freq: 500, q: expect.closeTo(Math.SQRT1_2, 6) }]);
    expect(webAudioQ(lp[0])).toBeCloseTo(-3.0103, 3);
    expect(bandSections({ lo: 500, hi: BAND_MAX_HZ, shape: 'lowcut', slope: 24 }, SR).map(x => +x.q.toFixed(4))).toEqual([0.5412, 1.3066]);
  });
  it('the curve is the same whichever way it is asked for', () => {
    const b = { lo: 200, hi: 2000, shape: 'band' as const, slope: 24 as const };
    const hz = [50, 200, 632, 2000, 9000];
    const g = bandGains(b, hz, SR);
    hz.forEach((f, i) => expect(g[i]).toBeCloseTo(bandResponse(b, f, SR), 6));
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
    expect(widthToQ(0.1)).toBeCloseTo(14.42, 2);
    expect(widthToQ(2)).toBeCloseTo(2 / 3, 6);
    for (const w of [0.1, 0.3, 1, 2.5, 8]) expect(qToWidth(widthToQ(w))).toBeCloseTo(w, 6);
    for (const q of [0.1, 0.7071, 1, 4, 14.41, 30]) expect(widthToQ(qToWidth(q))).toBeCloseTo(q, 6);
    // Q is the centre over the −3 dB bandwidth: f0 / (hi − lo).
    const b = bandRange('band', 1181, 0.1), v = bandView({ ...b, shape: 'band' });
    expect(widthToQ(v.width)).toBeCloseTo(v.freq / (b.hi - b.lo), 6);
  });
  it('names the note under a frequency', () => {
    expect(noteName(440)).toBe('A4');
    expect(noteName(261.63)).toBe('C4');
    expect(noteName(55)).toBe('A1');
  });
});

describe('deleting a band (the window owns Delete)', () => {
  const el = (tag: string, type?: string) => { const e = document.createElement(tag); if (type) (e as HTMLInputElement).type = type; return e; };
  it('Delete or Backspace removes the selected band, unless typing in a field or with a modifier', () => {
    expect(isBandDeleteKey({ key: 'Delete', target: document.body })).toBe(true);
    expect(isBandDeleteKey({ key: 'Backspace', target: el('div') })).toBe(true);
    expect(isBandDeleteKey({ key: 'Delete', target: el('button') })).toBe(true);
    expect(isBandDeleteKey({ key: 'Delete', target: el('input', 'color') })).toBe(true);
    expect(isBandDeleteKey({ key: 'Backspace', target: el('input', 'text') })).toBe(false);
    expect(isBandDeleteKey({ key: 'Delete', target: el('textarea') })).toBe(false);
    expect(isBandDeleteKey({ key: 'Backspace', metaKey: true, target: document.body })).toBe(false);
    expect(isBandDeleteKey({ key: 'a', target: document.body })).toBe(false);
  });
  it('while a modal window is open the graph keeps its Delete to itself (the selected node behind it stays)', () => {
    expect(modalOpen()).toBe(false);
    const d = document.createElement('div');
    d.setAttribute('aria-modal', 'true');
    document.body.appendChild(d);
    expect(modalOpen()).toBe(true);
    d.setAttribute('aria-modal', 'false');
    expect(modalOpen()).toBe(false);
    d.remove();
  });
});
