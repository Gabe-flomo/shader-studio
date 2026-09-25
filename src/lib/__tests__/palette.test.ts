import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (globalThis as unknown as { __ps?: Map<string, string> }).__ps?.get(k) ?? null,
    setItem: (k: string, v: string) => { (globalThis as unknown as { __ps?: Map<string, string> }).__ps?.set(k, v); },
    removeItem: () => {}, key: () => null, length: 0, clear: () => {},
  });
});
(globalThis as unknown as { __ps?: Map<string, string> }).__ps = store;

import { parsePaletteText, rgbToHex, cosineColor, cosineToStops, loadPalettePresets, savePalettePreset, deletePalettePreset } from '../palette';

const hexes = (text: string) => {
  const r = parsePaletteText(text);
  if (!r.ok) throw new Error(r.error);
  return r.colors.map(rgbToHex);
};

describe('parsePaletteText', () => {
  it('reads hex codes in any layout, with or without #, 3 or 6 digits', () => {
    expect(hexes('#264653 #2a9d8f #E9C46A')).toEqual(['#264653', '#2a9d8f', '#e9c46a']);
    expect(hexes('264653, 2a9d8f\ne9c46a;f4a261')).toEqual(['#264653', '#2a9d8f', '#e9c46a', '#f4a261']);
    expect(hexes('["#fff", "#000", "#f80"]')).toEqual(['#ffffff', '#000000', '#ff8800']);
    expect(hexes('0xff0000 0x00ff00')).toEqual(['#ff0000', '#00ff00']);
    expect(hexes('#11223344 #aabbccdd')).toEqual(['#112233', '#aabbcc']);   // alpha dropped
  });

  it('reads a coolors.co link', () => {
    const r = parsePaletteText('https://coolors.co/264653-2a9d8f-e9c46a-f4a261-e76f51');
    expect(r.ok && r.format).toBe('coolors.co link');
    expect(hexes('https://coolors.co/palette/264653-2a9d8f-e9c46a')).toEqual(['#264653', '#2a9d8f', '#e9c46a']);
  });

  it('reads CSS rgb() / rgba() / hsl() and GLSL vec3()', () => {
    expect(hexes('rgb(255, 0, 0) rgba(0,255,0,0.5) rgb(0 0 255)')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(hexes('rgb(100%, 50%, 0%)')).toEqual(['#ff8000']);
    expect(hexes('hsl(120, 100%, 50%), hsl(0 100% 25%)')).toEqual(['#00ff00', '#800000']);
    expect(hexes('vec3(1.0, 0.5, 0.0), vec3(0.2)')).toEqual(['#ff8000', '#333333']);
  });

  it('reads JSON lists of triples (0–255 or 0–1) and objects', () => {
    expect(hexes('[[255, 128, 0], [0, 0, 255]]')).toEqual(['#ff8000', '#0000ff']);
    expect(hexes('[[1, 0.5, 0], [0, 0, 1]]')).toEqual(['#ff8000', '#0000ff']);
    expect(hexes('{"colors": [{"hex": "#123456"}, {"r": 255, "g": 0, "b": 0}]}')).toEqual(['#123456', '#ff0000']);
  });

  it('reads GIMP / Lospec style lines of "R G B"', () => {
    expect(hexes('GIMP Palette\nName: test\n#\n255 128   0\tOrange\n  0   0 255\tBlue')).toEqual(['#ff8000', '#0000ff']);
  });

  it('keeps reading order across formats and explains when it finds nothing', () => {
    expect(hexes('first #ff0000 then rgb(0,255,0) then #0000ff')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(parsePaletteText('   ').ok).toBe(false);
    const none = parsePaletteText('just some words');
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/coolors|hex/);
  });
});

describe('cosine palette → stops', () => {
  const rainbow = { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0, 0.33, 0.67] } as const;
  it('samples one trip evenly, matching the node formula', () => {
    const stops = cosineToStops({ ...rainbow, offset: [...rainbow.offset], amplitude: [...rainbow.amplitude], freq: [...rainbow.freq], phase: [...rainbow.phase] }, 4);
    expect(stops).toHaveLength(4);
    const expected = cosineColor({ offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0, 0.33, 0.67] }, 0.25);
    stops[1].forEach((v, i) => expect(v).toBeCloseTo(Math.max(0, Math.min(1, expected[i])), 6));
    // t = 0 of a (0.5, 0.5, 1, 0) red channel is 1.0
    expect(stops[0][0]).toBeCloseTo(1, 6);
  });
});

describe('palette presets', () => {
  beforeEach(() => store.clear());
  it('saves, replaces by name and kind, and deletes', () => {
    expect(loadPalettePresets()).toEqual([]);
    expect(savePalettePreset({ name: 'Sea', kind: 'stops', stops: [[0, 0, 1], [0, 1, 1]] }).ok).toBe(true);
    expect(savePalettePreset({ name: 'Sea', kind: 'cosine', cosine: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0, 0.1, 0.2] } }).ok).toBe(true);
    expect(savePalettePreset({ name: 'Sea', kind: 'stops', stops: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }).ok).toBe(true);
    const list = loadPalettePresets();
    expect(list).toHaveLength(2);
    expect(list.find(p => p.kind === 'stops')!.stops).toHaveLength(3);
    deletePalettePreset(list[0].id);
    expect(loadPalettePresets()).toHaveLength(1);
  });
});
