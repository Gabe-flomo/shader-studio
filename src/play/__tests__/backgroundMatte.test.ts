/**
 * The Background matted by a layer (docs/mattes-and-masks.md): the record
 * (a usable layer, clamped feather and opacity outside, dropped when the
 * layer goes), the edits (mattes.ts), the mask maths (invert, opacity
 * outside), and the kit compositing it onto the picture even when the plain
 * shader would otherwise show straight off the GL canvas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLayer, emptyPlayRecord, isPlayRecordEmpty, parsePlayRecord, type PlayLayer, type PlayRecord } from '../../types/play';
import { backgroundMatteCandidates, backgroundMatteSummary, patchBackgroundMatte, setBackgroundMatte } from '../mattes';
import { removeLayer } from '../../components/play/layerOps';
import { kmBackgroundMatteValue } from '../kit/mattes.js';
import { createLayerKit } from '../kit/kit.js';

const L = (kind: PlayLayer['kind'], id: string, over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, id, id), ...over } as PlayLayer);
const rec = (layers: PlayLayer[]): PlayRecord => ({ ...emptyPlayRecord(), layers });

describe('the mask maths (invert, opacity outside)', () => {
  it('a plain cut: 0 outside the matte, the matte value inside', () => {
    expect(kmBackgroundMatteValue(1, false, 0)).toBe(1);
    expect(kmBackgroundMatteValue(0, false, 0)).toBe(0);
    expect(kmBackgroundMatteValue(0.5, false, 0)).toBeCloseTo(0.5);
  });
  it('invert swaps inside and outside', () => {
    expect(kmBackgroundMatteValue(1, true, 0)).toBe(0);
    expect(kmBackgroundMatteValue(0, true, 0)).toBe(1);
  });
  it('opacity outside dims instead of hiding: outside + (1 - outside) · inside', () => {
    expect(kmBackgroundMatteValue(0, false, 0.3)).toBeCloseTo(0.3);
    expect(kmBackgroundMatteValue(1, false, 0.3)).toBeCloseTo(1);
    expect(kmBackgroundMatteValue(0.5, false, 0.4)).toBeCloseTo(0.4 + 0.6 * 0.5);
    // Invert applies before the outside opacity: what's inside becomes what's outside.
    expect(kmBackgroundMatteValue(1, true, 0.3)).toBeCloseTo(0.3);
  });
  it('clamps a matte value and an opacity outside outside 0..1', () => {
    expect(kmBackgroundMatteValue(2, false, 0)).toBe(1);
    expect(kmBackgroundMatteValue(-1, false, 0)).toBe(0);
    expect(kmBackgroundMatteValue(1, false, 5)).toBe(1);
  });
});

describe('the record', () => {
  it('accepts a matte on a usable layer, clamped', () => {
    const p = { ...rec([L('shape', 'a')]), backgroundMatte: { id: 'a', mode: 'luma', invert: true, feather: 999, opacityOutside: 5 } };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(back.backgroundMatte).toEqual({ id: 'a', mode: 'luma', invert: true, feather: 200, opacityOutside: 1 });
  });

  it('drops it when the layer is missing, a null, or the Background layer', () => {
    expect(parsePlayRecord({ ...rec([]), backgroundMatte: { id: 'gone', mode: 'alpha' } }).backgroundMatte).toBeUndefined();
    expect(parsePlayRecord({ ...rec([L('null', 'n')]), backgroundMatte: { id: 'n', mode: 'alpha' } }).backgroundMatte).toBeUndefined();
    expect(parsePlayRecord({ ...rec([L('background', 'bg', { sources: [] })]), backgroundMatte: { id: 'bg', mode: 'alpha' } }).backgroundMatte).toBeUndefined();
  });

  it('leaves out feather and opacityOutside when they are 0, and invert when false', () => {
    const back = parsePlayRecord(rec([L('shape', 'a')]) as unknown as Record<string, unknown> as never);
    expect(back.backgroundMatte).toBeUndefined();
    const withMatte = parsePlayRecord({ ...rec([L('shape', 'a')]), backgroundMatte: { id: 'a', mode: 'alpha', invert: false, feather: 0, opacityOutside: 0 } });
    expect(withMatte.backgroundMatte).toEqual({ id: 'a', mode: 'alpha' });
  });

  it('counts toward isPlayRecordEmpty', () => {
    const p: PlayRecord = { ...emptyPlayRecord(), layers: [L('shape', 'a')], backgroundMatte: { id: 'a', mode: 'alpha' } };
    expect(isPlayRecordEmpty(p)).toBe(false);
    expect(isPlayRecordEmpty(emptyPlayRecord())).toBe(true);
  });
});

describe('the edits (mattes.ts)', () => {
  it('candidates exclude nulls, the Background layer, and drum pads / relationships', () => {
    const layers = [L('shape', 'a'), L('null', 'n'), L('background', 'bg', { sources: [] }), L('drumpad', 'd'), L('image', 'i')];
    expect(backgroundMatteCandidates(layers).map(l => l.id)).toEqual(['a', 'i']);
  });

  it('setBackgroundMatte hides the layer the first time it is used, not on a no-op re-pick', () => {
    let p = rec([L('shape', 'a'), L('image', 'img')]);
    p = setBackgroundMatte(p, 'a');
    expect(p.backgroundMatte).toEqual({ id: 'a', mode: 'alpha' });
    expect(p.layers.find(l => l.id === 'a')!.visible).toBe(false);
    // Shown again by hand, then the same matte re-picked (patchBackgroundMatte's path): it stays shown.
    p = { ...p, layers: p.layers.map(l => (l.id === 'a' ? { ...l, visible: true } : l)) };
    p = setBackgroundMatte(p, 'a');
    expect(p.layers.find(l => l.id === 'a')!.visible).toBe(true);
  });

  it('refuses the Background layer and an unknown id', () => {
    let p = rec([L('background', 'bg', { sources: [] })]);
    expect(setBackgroundMatte(p, 'bg')).toBe(p);
    expect(setBackgroundMatte(p, 'nope')).toBe(p);
  });

  it('patchBackgroundMatte changes mode, invert, feather, opacity outside; drops falsy ones', () => {
    let p = setBackgroundMatte(rec([L('shape', 'a')]), 'a');
    p = patchBackgroundMatte(p, { mode: 'luma', invert: true, feather: 12, opacityOutside: 0.4 });
    expect(p.backgroundMatte).toEqual({ id: 'a', mode: 'luma', invert: true, feather: 12, opacityOutside: 0.4 });
    p = patchBackgroundMatte(p, { invert: false, feather: 0, opacityOutside: 0 });
    expect(p.backgroundMatte).toEqual({ id: 'a', mode: 'luma' });
  });

  it('the summary line', () => {
    let p = setBackgroundMatte(rec([L('shape', 'Hand path 1')]), 'Hand path 1');
    expect(backgroundMatteSummary(p)).toBe('Matted by Hand path 1');
    p = patchBackgroundMatte(p, { invert: true, feather: 12 });
    expect(backgroundMatteSummary(p)).toBe('Matted by Hand path 1 · inverted · 12 px');
  });

  it('removing the matte layer drops the matte', () => {
    let p = setBackgroundMatte(rec([L('shape', 'a')]), 'a');
    p = removeLayer(p, 'a');
    expect(p.backgroundMatte).toBeUndefined();
  });
});

// ── The kit composites it onto the picture ──────────────────────────────────

type Call = { fn: string; op: string; src?: FakeCanvas };
interface FakeCanvas { width: number; height: number; calls: Call[]; canvas?: FakeCanvas; getContext: () => unknown }
function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const fc: FakeCanvas = { width: 0, height: 0, calls, getContext: () => ctx };
  const ctx: unknown = new Proxy(state, {
    get(t, k: string) {
      if (k === 'canvas') return fc;
      if (k in t) return t[k];
      if (k === 'getImageData' || k === 'createImageData') return (...a: number[]) => { const w = a.length > 2 ? a[2] : a[0], h = a.length > 2 ? a[3] : a[1]; return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'isPointInStroke' || k === 'isPointInPath') return () => false;
      return (...args: unknown[]) => { calls.push({ fn: k, op: String(t.globalCompositeOperation), src: args[0] as FakeCanvas }); };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return fc;
}

describe('the kit composites the Background matte', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, Path2D: g.Path2D };
  beforeAll(() => {
    g.document = { createElement: () => fakeCanvas() };
    g.Path2D = class { moveTo() {} lineTo() {} arcTo() {} closePath() {} };
  });
  afterAll(() => { g.document = saved.document; g.Path2D = saved.Path2D; });

  const shape = (id: string, over: Record<string, unknown> = {}) => L('shape', id, { action: 'none', fillOpacity: 1, strokeWidth: 0, ...over });

  it('paints the plain shader onto the overlay (normally skipped) so there is something to cut, then cuts it', () => {
    const kit = createLayerKit();
    const main = fakeCanvas();
    const p = setBackgroundMatte(rec([shape('a', { visible: false })]), 'a');
    const env: Partial<KitEnvLike> = {
      gl: fakeCanvas(), W: 64, H: 36, dpr: 1, time: 0, dt: 1 / 60, value: (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k],
      pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
      audio: null, camera: null, image: () => null, sensor: () => {}, override: () => {},
    };
    kit.frame(main.getContext() as CanvasRenderingContext2D, p, env as never);
    const blits = main.calls.filter(c => c.fn === 'drawImage');
    // The raw shader copied onto ctx (the plain-shader fix), then the matte cut.
    expect(blits.length).toBeGreaterThanOrEqual(2);
    expect(blits.some(c => c.op === 'destination-in')).toBe(true);
  });

  it('without a backgroundMatte the plain shader is left to the GL canvas underneath (no draw)', () => {
    const kit = createLayerKit();
    const main = fakeCanvas();
    const env: Partial<KitEnvLike> = {
      gl: fakeCanvas(), W: 64, H: 36, dpr: 1, time: 0, dt: 1 / 60, value: () => 0,
      pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
      audio: null, camera: null, image: () => null, sensor: () => {}, override: () => {},
    };
    kit.frame(main.getContext() as CanvasRenderingContext2D, rec([shape('a')]), env as never);
    expect(main.calls.some(c => c.fn === 'drawImage' && c.src === env.gl)).toBe(false);
  });
});

// A loose shape for the env objects above (kit.d.ts's KitEnv is fuller than the test needs).
interface KitEnvLike { gl: unknown; W: number; H: number; dpr: number; time: number; dt: number; value: (l: PlayLayer, k: string) => number; pointer: { x: number; y: number; over: boolean; down: boolean }; markers: boolean; editing: boolean; hidden: boolean; backdrop: [number, number, number]; audio: null; camera: null; image: () => null; sensor: () => void; override: () => void }
