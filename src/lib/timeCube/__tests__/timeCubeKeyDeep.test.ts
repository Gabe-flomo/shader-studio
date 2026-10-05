/**
 * The colour key's card line and swatches (lib/timeCube/keyInfo.ts), the key's Animate switch, and
 * 16-bit atlases (lib/timeCube/deep.ts, order.ts combineFramesFloat, plan.ts): docs/time-cube.md.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import * as THREE from 'three';
import { keySettingsOf, keyShare, mainColours, shareText } from '../keyInfo';
import { deepTexture, reorderDeep } from '../deep';
import { combineFrames, combineFramesFloat } from '../order';
import { planFrameStack, stackSettingsOf } from '../plan';
import { keyAnimOn } from '../../../nodes/definitions/timeCube';
import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';

const px = (...cols: number[][]) => new Uint8ClampedArray(cols.flatMap(c => [c[0], c[1], c[2], 255]));

describe('what the key keeps', () => {
  const red = [220, 30, 30], blue = [40, 80, 200], grey = [90, 90, 90];
  it('the share of pixels that match, and how the card says it', () => {
    const img = px(red, blue, grey, grey);
    const k = keySettingsOf({ keyMode: 'color', keyColor: [220 / 255, 30 / 255, 30 / 255], keyTolerance: 0.05, keySoftness: 0.01 });
    expect(keyShare(img, k)).toBeCloseTo(0.25, 2);
    expect(keyShare(img, { ...k, mode: 'off' })).toBe(0);
    expect(shareText(0.25)).toBe('about 25%');
    expect(shareText(0.004)).toBe('under 1%');
    expect(shareText(0)).toBe('none');
  });
  it('Shift the colour turns the key colour round the wheel, as the shader does', () => {
    const k = keySettingsOf({ keyMode: 'hue', keyColor: [1, 0, 0], keyHueShift: 1 / 3 });
    expect(k.color[1]).toBeGreaterThan(0.9); // red turned a third of the way round: green
    expect(keyShare(px([0, 230, 0]), { ...k, tolerance: 0.05, softness: 0.02 })).toBeGreaterThan(0.9);
  });
  it('the main colours of a frame: most common first, colourful ones favoured, no near-duplicates', () => {
    const img = px(...Array(50).fill(grey), ...Array(30).fill(red), ...Array(30).fill([222, 32, 31]), ...Array(10).fill(blue));
    const cols = mainColours(img, 6);
    expect(cols.length).toBe(3);
    expect(cols[0][0]).toBeGreaterThan(0.8); // the red (60 pixels, counted six times) before the grey
    expect(cols.some(c => c[2] > 0.7)).toBe(true);
  });
});

describe('the key\'s Animate switch', () => {
  it('off leaves the pulse, lightning and drift out of the shader; old saves that animate count as on', () => {
    expect(keyAnimOn({ keyAnimate: false, pulse: 1 })).toBe(false);
    expect(keyAnimOn({ keyAnimate: true })).toBe(true);
    expect(keyAnimOn({ pulse: 1 })).toBe(true);
    expect(keyAnimOn({})).toBe(false);
    const code = (params: Record<string, unknown>) => compileGraph({ nodes: [
      n('timeCube', 'src', 0, 0), n('timeCubeView', 'v', 300, 0, { keyMode: 'hue', ...params }, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ] });
    const off = code({ pulse: 1 });
    expect(off.fragmentShader).toMatch(/_pls = 0\.0;/);
    expect(off.paramBindings['v::pulse']).toBeUndefined();
    const on = code({ keyAnimate: true });
    expect(on.paramBindings['v::pulse']).toBeTruthy();
    expect(on.paramBindings['v::lightning']).toBeTruthy();
  });
});

describe('16-bit atlases', () => {
  it('an average keeps its in-between shades unrounded; the 8-bit one rounds them', () => {
    const a = new Uint8ClampedArray([10, 0, 0, 255]), b = new Uint8ClampedArray([11, 0, 0, 255]);
    expect(combineFramesFloat([a, b], 'average')[0]).toBe(10.5);
    expect(combineFrames([a, b], 'average')[0]).toBe(11);
  });
  it('Precision 16-bit only when combining frames, at twice the memory (the cap counts it)', () => {
    const meta = { width: 640, height: 360, duration: 4 };
    const p8 = planFrameStack(meta, stackSettingsOf({ combine: 'average' }));
    const p16 = planFrameStack(meta, stackSettingsOf({ combine: 'average', precision: '16' }));
    expect(p16.bytes).toBe(2 * p8.bytes);
    expect(planFrameStack(meta, stackSettingsOf({ precision: '16' })).bytes).toBe(p8.bytes);
    const big = planFrameStack({ width: 1920, height: 1080, duration: 60 }, stackSettingsOf({ combine: 'average', precision: '16', frames: 256, frameWidth: '512' }));
    expect(big.capped).toBe('memory');
    expect(big.frames * big.tileW * big.tileH * 8).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
  it('the half-float texture: rows bottom up (as a canvas texture flips them), 0–1, its 8-bit canvas kept for exports', () => {
    const w = 2, h = 2, f = new Float32Array([255, 0, 0, 255, 0, 0, 0, 255, /* row 1 */ 0, 127.5, 0, 255, 0, 0, 0, 255]);
    const tex = deepTexture(f, w, h, null);
    expect(tex.type).toBe(THREE.HalfFloatType);
    const d = tex.image.data as Uint16Array;
    expect(THREE.DataUtils.fromHalfFloat(d[0 * 4 + 1])).toBeCloseTo(0.5, 2); // canvas row 1 is texture row 0
    expect(THREE.DataUtils.fromHalfFloat(d[(1 * w) * 4 + 0])).toBeCloseTo(1, 3);
    expect('canvas8' in tex.userData).toBe(true);
  });
  it('reordering a float atlas moves whole tiles, as the canvas reorder does', () => {
    const plan = { cols: 2, tileW: 1, tileH: 1, atlasW: 2, frames: 2 };
    const out = reorderDeep(new Float32Array([1, 1, 1, 1, 2, 2, 2, 2]), plan, [1, 0]);
    expect(Array.from(out)).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });
});
