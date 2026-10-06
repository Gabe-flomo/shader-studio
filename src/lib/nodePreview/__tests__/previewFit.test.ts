/**
 * The preview picture's fit (draw2d.ts): "contain" at the picture's own aspect inside the panel's
 * width × a height cap, never cropped or stretched; the layout's letterbox and Slice plot strip;
 * and that the field's mapping then covers exactly the whole picture.
 */
import { describe, expect, it } from 'vitest';
import { coverMap, fitContain, previewLayout, previewMaxHeight, PREVIEW_MAX_HEIGHT_FRACTION } from '../draw2d';

const close = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('fitContain', () => {
  it('a wide picture fills the width (the height follows the aspect)', () => {
    const b = fitContain(16 / 9, 800, 500);
    expect(b).toEqual({ w: 800, h: 450 });
  });

  it('a wide picture in a short space is capped by the height and narrowed to keep its aspect', () => {
    const b = fitContain(16 / 9, 1600, 450);
    expect(b.h).toBe(450);
    expect(b.w).toBe(800);
  });

  it('a tall picture is capped by the height and letterboxed at the sides', () => {
    const b = fitContain(9 / 16, 800, 480);
    expect(b.h).toBe(480);
    expect(b.w).toBe(270);
    expect(close(b.w / b.h, 9 / 16)).toBe(true);
  });

  it('a square picture: width-limited or height-limited', () => {
    expect(fitContain(1, 300, 500)).toEqual({ w: 300, h: 300 });
    expect(fitContain(1, 900, 400)).toEqual({ w: 400, h: 400 });
  });

  it('never exceeds the space and keeps the aspect, across many sizes', () => {
    for (const a of [0.3, 0.5625, 1, 1.333, 1.778, 2.35, 5]) {
      for (const [W, H] of [[200, 150], [338, 405], [818, 500], [1400, 300], [120, 900]]) {
        const b = fitContain(a, W, H);
        expect(b.w).toBeLessThanOrEqual(W);
        expect(b.h).toBeLessThanOrEqual(H);
        expect(b.w === W || b.h === H).toBe(true); // as large as fits
        expect(close(b.w / b.h, a, 0.03)).toBe(true);
      }
    }
  });

  it('bad aspects fall back to 16:9', () => {
    expect(fitContain(NaN, 160, 500)).toEqual({ w: 160, h: 90 });
    expect(fitContain(0, 160, 500)).toEqual({ w: 160, h: 90 });
  });
});

describe('height cap', () => {
  it('is ~40% of the window on a wide panel and 1.2× the width on a narrow card', () => {
    expect(PREVIEW_MAX_HEIGHT_FRACTION).toBe(0.4);
    expect(previewMaxHeight(1300, 1000)).toBe(400);
    expect(previewMaxHeight(338, 1400)).toBeCloseTo(405.6);
    expect(previewMaxHeight(50, 100)).toBe(110);
  });
});

describe('layout', () => {
  it('centres a narrower picture (letterbox) and adds a full-width plot strip in Slice mode', () => {
    const box = fitContain(9 / 16, 800, 480);
    const l = previewLayout(800, box, false);
    expect(l.w).toBe(800);
    expect(l.h).toBe(480);
    expect(l.picture).toEqual({ x: 265, y: 0, w: 270, h: 480 });
    expect(l.plot).toBeNull();
    const s = previewLayout(800, box, true);
    expect(s.picture).toEqual(l.picture);
    expect(s.plot!.y).toBeGreaterThanOrEqual(480);
    expect(s.plot!.w).toBe(788);
    expect(s.h).toBe(s.plot!.y + s.plot!.h);
  });

  it('drawn into the fitted rect, the field maps edge to edge: nothing cropped, so overlays line up', () => {
    const field = { w: 144, h: 256 }; // a tall picture's readback
    const box = fitContain(field.w / field.h, 800, 480);
    const pic = previewLayout(800, box, false).picture;
    const m = coverMap(field, pic);
    expect(close(m.toX(0), pic.x, 0.01)).toBe(true);
    expect(close(m.toX(1), pic.x + pic.w, 0.01)).toBe(true);
    expect(close(m.toY(1), pic.y, 0.01)).toBe(true);
    expect(close(m.toY(0), pic.y + pic.h, 0.01)).toBe(true);
  });
});
