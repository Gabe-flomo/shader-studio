/** The camera turns off when the last thing that uses it goes away. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { playUsesCamera } from '../cameraKeeper';
import { defaultLayer } from '../../types/playLayers';

describe('camera keeper', () => {
  it('a camera layer, or a layer reading the camera, needs the camera; others do not', () => {
    const cam = defaultLayer('camera', 'c', 'Camera');
    const glyphs = { ...defaultLayer('glyphs', 'g', 'Glyphs'), readFrom: 'camera' } as typeof cam;
    const text = defaultLayer('text', 't', 'Text');
    expect(playUsesCamera({ layers: [cam] })).toBe(true);
    expect(playUsesCamera({ layers: [text, glyphs] })).toBe(true);
    expect(playUsesCamera({ layers: [text] })).toBe(false);
    expect(playUsesCamera({ layers: [] })).toBe(false);
  });
});
