import { describe, expect, it } from 'vitest';
import { bandUniforms, inBand } from '../histogramBand';

describe('the histogram band', () => {
  it('off when none is picked; channels number 1–4', () => {
    expect(bandUniforms(null).ch).toBe(0);
    expect(bandUniforms({ channel: 'luma', lo: 0.5, hi: 0.6 }).ch).toBe(1);
    expect(bandUniforms({ channel: 'b', lo: 0.6, hi: 0.5 })).toEqual({ ch: 4, lo: 0.5, hi: 0.6 });
  });
  it('a pixel is in when its channel is from lo up to (not including) hi; the top band takes 1.0', () => {
    const g = { channel: 'g' as const, lo: 0.25, hi: 0.5 };
    expect(inBand(g, [0.9, 0.3, 0.9])).toBe(true);
    expect(inBand(g, [0.3, 0.5, 0.3])).toBe(false);
    expect(inBand(g, [0.3, 0.2, 0.3])).toBe(false);
    expect(inBand({ channel: 'luma', lo: 0.9, hi: 1 }, [1, 1, 1])).toBe(true);
    // Luma weighs the channels like the histogram does
    expect(inBand({ channel: 'luma', lo: 0.29, hi: 0.31 }, [1, 0, 0])).toBe(true);
  });
});
