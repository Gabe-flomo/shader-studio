import { describe, it, expect } from 'vitest';
import { lumaKey } from '../overlay';

describe('black turns clear', () => {
  it('makes black transparent, keeps full-bright colour opaque, and un-darkens glow', () => {
    const px = new Uint8Array([0, 0, 0, 255, 255, 128, 0, 255, 64, 32, 0, 255]);
    lumaKey(px);
    expect(px[3]).toBe(0);                          // black: gone
    expect([...px.slice(4, 8)]).toEqual([255, 128, 0, 255]); // bright orange: as it was
    expect([...px.slice(8, 12)]).toEqual([255, 128, 0, 64]);  // dim orange: the same hue, a quarter opaque
  });
});
