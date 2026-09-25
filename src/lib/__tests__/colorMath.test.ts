import { describe, expect, it } from 'vitest';
import { hexToRgb, hsvToRgb, rgbToGlsl, rgbToHex, rgbToHsv, toRgb } from '../colorMath';

describe('colorMath', () => {
  it('hex round-trips', () => {
    expect(rgbToHex([1, 0.5, 0])).toBe('#ff8000');
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('f80')).toEqual([1, 136 / 255, 0]);
    expect(hexToRgb('#xyz')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });
  it('hsv round-trips through the primaries and greys', () => {
    for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0.2, 0.2, 0.2], [0.96, 0.55, 0.2]] as [number, number, number][]) {
      const back = hsvToRgb(rgbToHsv(rgb));
      back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 6));
    }
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual([0, 0, 0.5]);
    expect(rgbToHsv([0, 0, 1])[0]).toBeCloseTo(2 / 3);
  });
  it('coerces params and formats GLSL', () => {
    expect(toRgb([2, -1, 0.5])).toEqual([1, 0, 0.5]);
    expect(toRgb('nope', [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(rgbToGlsl([0.96, 0.55, 0.2])).toBe('vec3(0.96, 0.55, 0.20)');
  });
});
