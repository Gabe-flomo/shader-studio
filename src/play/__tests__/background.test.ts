/**
 * Play's background (an image, a video or a colour in place of the shader):
 * old display records parse as they always did, the frame plan skips the
 * shader, the layer kit reads the background wherever it reads the picture,
 * and web exports carry (or list as left behind) the background's file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKGROUND_VIDEO_KEEP, backgroundSource, emptyPlayRecord, isPlayRecordEmpty, parseDisplay, parsePlayRecord, pictureHidden, replacesShader, videoTimeAt, type PlayRecord } from '../../types/play';
import { defaultLayer, type ScriptLayer } from '../../types/playLayers';
import { planFrame } from '../background';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { klFitRect } from '../kit/layers.js';
import { buildPlayHtml, leftBehind, mediaCarried, playBundle, type PlayHtmlInput } from '../exportHtml';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';

describe('display records', () => {
  it('reads an old Layers only record as the shader, still hidden', () => {
    const d = parseDisplay({ picture: false, backdrop: [0.1, 0.2, 0.3] });
    expect(d).toEqual({ picture: false, backdrop: [0.1, 0.2, 0.3] });
    expect(backgroundSource(d)).toBe('shader');
    expect(replacesShader(d)).toBe(false);
    expect(pictureHidden(d)).toBe(true);
    // Through the whole record, as a saved graph or a play file loads it.
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], display: { picture: false, backdrop: [0, 0, 0] } });
    expect(rec.display).toEqual({ picture: false, backdrop: [0, 0, 0] });
  });

  it('leaves the defaults out, and junk out', () => {
    expect(parseDisplay(undefined)).toBeUndefined();
    expect(parseDisplay({ picture: true, backdrop: [0, 0, 0] })).toBeUndefined();
    expect(parseDisplay({ picture: true, source: 'shader' })).toBeUndefined();
    expect(parseDisplay({ source: 'hologram' })).toBeUndefined();
    expect(parseDisplay('nope')).toBeUndefined();
  });

  it('keeps an image, a video and their options; drops files that aren’t data URLs', () => {
    const d = parseDisplay({ picture: true, backdrop: [0, 0, 0], source: 'image', fit: 'contain', image: { name: 'sky.png', src: PNG }, video: { name: 'clip.mp4', src: MP4, bytes: 1234, loop: false, muted: false, rate: 0.5 } })!;
    expect(d.source).toBe('image');
    expect(d.fit).toBe('contain');
    expect(d.image).toEqual({ name: 'sky.png', src: PNG });
    expect(d.video).toEqual({ name: 'clip.mp4', src: MP4, bytes: 1234, loop: false, muted: false, rate: 0.5 });
    expect(replacesShader(d)).toBe(true);
    const bad = parseDisplay({ source: 'image', image: { name: 'x', src: 'https://example.com/x.png' }, video: { name: 'y.mov', src: 'javascript:alert(1)', bytes: 9 } })!;
    expect(bad.image).toBeUndefined();
    // A video without a kept file keeps its name and size: the page asks for it again.
    expect(bad.video).toEqual({ name: 'y.mov', src: '', bytes: 9, loop: true, muted: true, rate: 1 });
  });

  it('a colour background is never "hidden", and makes the record worth saving', () => {
    const d = parseDisplay({ picture: false, backdrop: [1, 1, 1], source: 'colour' });
    expect(pictureHidden(d)).toBe(false);
    const rec: PlayRecord = { ...emptyPlayRecord(), display: { picture: true, backdrop: [0, 0, 0], source: 'colour' } };
    expect(isPlayRecordEmpty(rec)).toBe(false);
    expect(isPlayRecordEmpty({ ...emptyPlayRecord(), display: { picture: true, backdrop: [0, 0, 0] } })).toBe(true);
  });

  it('puts a video on the clock: rate, loop, and a hold at the end', () => {
    expect(videoTimeAt(3, 10, 1, true)).toBe(3);
    expect(videoTimeAt(3, 10, 2, true)).toBe(6);
    expect(videoTimeAt(13, 10, 1, true)).toBeCloseTo(3);
    expect(videoTimeAt(13, 10, 1, false)).toBeCloseTo(9.999);
    expect(videoTimeAt(5, NaN, 1, true)).toBe(0);
  });
});

describe('the frame plan', () => {
  it('never draws the shader with a background, even while the graph would move', () => {
    const p = planFrame({ background: true, shaderMoving: true, layersMoving: false, needsRender: false });
    expect(p).toEqual({ layersOnly: false, shader: false, dynamic: false });
    expect(planFrame({ background: true, shaderMoving: true, layersMoving: false, needsRender: true })).toEqual({ layersOnly: true, shader: false, dynamic: false });
    expect(planFrame({ background: true, shaderMoving: false, layersMoving: true, needsRender: false })).toEqual({ layersOnly: true, shader: false, dynamic: true });
  });

  it('draws the shader as before without one', () => {
    expect(planFrame({ background: false, shaderMoving: true, layersMoving: false, needsRender: false })).toEqual({ layersOnly: false, shader: true, dynamic: true });
    expect(planFrame({ background: false, shaderMoving: false, layersMoving: false, needsRender: false })).toEqual({ layersOnly: false, shader: false, dynamic: false });
  });
});

describe('fit', () => {
  it('cover fills and crops, contain fits inside, stretch fills exactly', () => {
    expect(klFitRect('cover', 200, 100, 100, 100)).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(klFitRect('contain', 200, 100, 100, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(klFitRect('stretch', 200, 100, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

// ── The kit reads the background ─────────────────────────────────────────────

/**
 * A stand-in canvas whose every pixel is one colour: fills that cover it and
 * drawImage copy a colour in, getImageData hands it back. Enough to see which
 * picture a layer read.
 */
type RGBA = [number, number, number, number];
class FakeCanvas {
  width = 300; height = 150; colour: RGBA = [0, 0, 0, 0];
  draws: unknown[] = [];
  getContext = () => {
    let fill = 'rgba(0,0,0,1)';
    const target: Record<string, unknown> = {
      canvas: this,
      fillRect: (x: number, y: number, w: number, h: number) => { if (x <= 0 && y <= 0 && w >= this.width && h >= this.height) { const m = /rgba?\((\d+),(\d+),(\d+)/.exec(fill.replace(/\s/g, '')); if (m) this.colour = [+m[1], +m[2], +m[3], 255]; } },
      clearRect: () => { this.colour = [0, 0, 0, 0]; },
      drawImage: (src: { colour?: RGBA }) => { this.draws.push(src); if (src && src.colour) this.colour = [...src.colour] as RGBA; },
      getImageData: (_x: number, _y: number, w: number, h: number) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(this.colour, i); return { data: d }; },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => { this.colour = [img.data[0], img.data[1], img.data[2], img.data[3]]; },
      measureText: () => ({ width: 0 }),
    };
    return new Proxy(target, {
      get: (t, k) => (k === 'fillStyle' ? fill : k in t ? t[k as string] : () => undefined),
      set: (t, k, v) => { if (k === 'fillStyle') fill = v; else t[k as string] = v; return true; },
    });
  };
}

const g = globalThis as unknown as { document?: unknown; __pic?: number };
let savedDocument: unknown;
beforeEach(() => { savedDocument = g.document; g.document = { createElement: () => new FakeCanvas() }; g.__pic = -1; });
afterEach(() => { g.document = savedDocument; delete g.__pic; });

/** One frame of a Script layer that reports s.picture.brightness at the middle. */
function readPicture(background: KitEnv['background'], shaderColour: RGBA = [255, 0, 0, 255]): { brightness: number; out: FakeCanvas } {
  const l = { ...defaultLayer('script', 's', 'Reader'), readPicture: true, paramDefs: [], code: 'function draw(s) { globalThis.__pic = s.picture.brightness(s.width / 2, s.height / 2); }' } as ScriptLayer;
  const record: PlayRecord = { ...emptyPlayRecord(), layers: [l] };
  const gl = new FakeCanvas(); gl.colour = shaderColour;
  const out = new FakeCanvas(); out.width = 320; out.height = 180;
  const env = {
    gl: gl as unknown as HTMLCanvasElement, W: 320, H: 180, dpr: 1, time: 0, dt: 1 / 60,
    value: (layer: unknown, k: string) => (layer as Record<string, number>)[k],
    pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0] as [number, number, number],
    background, audio: null, camera: null, image: () => null, sensor: () => {}, override: () => {},
  } as KitEnv;
  createLayerKit().frame(out.getContext() as unknown as CanvasRenderingContext2D, record, env);
  return { brightness: g.__pic!, out };
}

describe('layers read the background', () => {
  it('the shader when there is no background', () => {
    expect(readPicture(null).brightness).toBeCloseTo(1 / 3, 3);
  });

  it('a flat colour: its brightness everywhere, painted under the layers', () => {
    const { brightness, out } = readPicture({ el: null, fit: 'cover', colour: [1, 1, 1] });
    expect(brightness).toBeCloseTo(1, 3);
    // The first thing on the overlay is the background itself.
    expect((out.draws[0] as FakeCanvas).colour).toEqual([255, 255, 255, 255]);
  });

  it('an image’s pixels, not the shader’s', () => {
    const img = { naturalWidth: 64, naturalHeight: 32, width: 64, height: 32, src: 'x', complete: true, colour: [0, 0, 255, 255] as RGBA };
    expect(readPicture({ el: img as unknown as HTMLImageElement, fit: 'cover', colour: [0, 0, 0] }).brightness).toBeCloseTo(1 / 3, 3);
    const white = { ...img, src: 'y', colour: [255, 255, 255, 255] as RGBA };
    expect(readPicture({ el: white as unknown as HTMLImageElement, fit: 'contain', colour: [0, 0, 0] }).brightness).toBeCloseTo(1, 3);
  });

  it('a video’s current frame, once it has one (the colour until then)', () => {
    const video = { videoWidth: 64, videoHeight: 36, readyState: 2, colour: [128, 128, 128, 255] as RGBA };
    expect(readPicture({ el: video as unknown as HTMLVideoElement, fit: 'cover', colour: [0, 0, 0] }).brightness).toBeCloseTo(128 / 255, 2);
    const loading = { ...video, readyState: 0 };
    expect(readPicture({ el: loading as unknown as HTMLVideoElement, fit: 'cover', colour: [0.2, 0.2, 0.2] }).brightness).toBeCloseTo(51 / 255, 2);
  });
});

// ── Web exports ──────────────────────────────────────────────────────────────

function input(display: PlayRecord['display']): PlayHtmlInput {
  return { title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: { ...emptyPlayRecord(), display }, aspect: 'free' as PlayHtmlInput['aspect'] };
}

describe('web export', () => {
  it('carries the background image in the page, and only the file that shows', () => {
    const inp = input({ picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'sky.png', src: PNG }, video: { name: 'clip.mp4', src: MP4, bytes: 12, loop: true, muted: true, rate: 1 } });
    const b = playBundle(inp);
    expect(b.play.display?.image?.src).toBe(PNG);
    expect(b.play.display?.video).toBeUndefined();
    expect(buildPlayHtml(inp)).toContain(PNG);
    expect(mediaCarried(undefined, inp.play)).toEqual([{ what: 'Background image “sky.png”', bytes: PNG.length }]);
    expect(leftBehind(inp.play)).toEqual([]);
  });

  it('carries a kept video; lists one too big to keep as left behind', () => {
    const kept = input({ picture: true, backdrop: [0, 0, 0], source: 'video', video: { name: 'clip.mp4', src: MP4, bytes: 12, loop: true, muted: true, rate: 1 } });
    expect(buildPlayHtml(kept)).toContain(MP4);
    expect(leftBehind(kept.play)).toEqual([]);
    const big = input({ picture: true, backdrop: [0, 0, 0], source: 'video', video: { name: 'long.mov', src: '', bytes: BACKGROUND_VIDEO_KEEP * 3, loop: true, muted: true, rate: 1 } });
    const left = leftBehind(big.play);
    expect(left).toHaveLength(1);
    expect(left[0].what).toContain('long.mov');
    expect(left[0].why).toMatch(/backdrop colour instead/);
    expect(mediaCarried(undefined, big.play)).toEqual([]);
  });
});
