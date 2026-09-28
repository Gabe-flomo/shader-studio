/** The page canvas's state (pageCanvasStore.ts): layout per page, the Convert view and wipe, remembered on this device. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import { DEFAULT_PAGE_CANVAS, MIN_BESIDE_PX, MIN_CANVAS_PX, PAGE_CANVAS_KEY, SPLIT_MAX, SPLIT_MIN, clampCanvasWidth, clampSplit, hostsCanvas, parsePageCanvasPrefs, usePageCanvas } from '../pageCanvasStore';

describe('page canvas prefs', () => {
  it('fall back to the defaults for nothing, junk or odd values', () => {
    expect(parsePageCanvasPrefs(null)).toEqual(DEFAULT_PAGE_CANVAS);
    expect(parsePageCanvasPrefs('not json')).toEqual(DEFAULT_PAGE_CANVAS);
    expect(parsePageCanvasPrefs('7')).toEqual(DEFAULT_PAGE_CANVAS);
    expect(parsePageCanvasPrefs(JSON.stringify({ layout: { convert: 'huge', glsl: 3 }, width: { convert: 'wide', glsl: -4 }, view: 'both', split: 'half' }))).toEqual(DEFAULT_PAGE_CANVAS);
  });

  it('keep what was saved, with the wipe in range', () => {
    expect(parsePageCanvasPrefs(JSON.stringify({ layout: { convert: 'full' }, width: { glsl: 640.4 }, view: 'split', split: 0.3 })))
      .toEqual({ layout: { convert: 'full', glsl: 'small' }, width: { convert: 0, glsl: 640 }, view: 'split', split: 0.3 });
    expect(parsePageCanvasPrefs(JSON.stringify({ split: 1.5 })).split).toBe(SPLIT_MAX);
    expect(parsePageCanvasPrefs(JSON.stringify({ split: -1 })).split).toBe(SPLIT_MIN);
  });

  it('never return the shared default objects', () => {
    const a = parsePageCanvasPrefs(null);
    a.layout.convert = 'full';
    expect(DEFAULT_PAGE_CANVAS.layout.convert).toBe('small');
  });
});

describe('clamps', () => {
  it('keep the wipe away from the edges and finite', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0)).toBe(SPLIT_MIN);
    expect(clampSplit(2)).toBe(SPLIT_MAX);
    expect(clampSplit(NaN)).toBe(0.5);
  });

  it('give the canvas half the room until a width is chosen, and keep both sides their minimum', () => {
    expect(clampCanvasWidth(0, 1000)).toBe(500);
    expect(clampCanvasWidth(700, 1000)).toBe(700);
    expect(clampCanvasWidth(900, 1000)).toBe(1000 - MIN_BESIDE_PX);
    expect(clampCanvasWidth(10, 1000)).toBe(MIN_CANVAS_PX);
    // Too small for both: half.
    expect(clampCanvasWidth(400, MIN_CANVAS_PX + MIN_BESIDE_PX - 20)).toBe(Math.round((MIN_CANVAS_PX + MIN_BESIDE_PX - 20) / 2));
    // No room measured yet: what was asked for, never below the minimum.
    expect(clampCanvasWidth(0, 0)).toBe(MIN_CANVAS_PX);
    expect(clampCanvasWidth(480, 0)).toBe(480);
  });
});

describe('the store', () => {
  beforeEach(() => {
    store.clear();
    usePageCanvas.setState({ layout: { convert: 'small', glsl: 'small' }, width: { convert: 0, glsl: 0 }, view: 'converted', split: 0.5 });
  });

  it('starts small on both pages showing the converted graph, so nothing changes until asked', () => {
    const s = usePageCanvas.getState();
    expect(s.layout).toEqual({ convert: 'small', glsl: 'small' });
    expect(s.view).toBe('converted');
    expect(s.split).toBe(0.5);
  });

  it('toggles the layout per page and remembers it', () => {
    usePageCanvas.getState().toggleLayout('convert');
    expect(usePageCanvas.getState().layout).toEqual({ convert: 'full', glsl: 'small' });
    expect(JSON.parse(store.get(PAGE_CANVAS_KEY)!).layout).toEqual({ convert: 'full', glsl: 'small' });
    usePageCanvas.getState().toggleLayout('convert');
    expect(usePageCanvas.getState().layout.convert).toBe('small');
    usePageCanvas.getState().setLayout('glsl', 'full');
    expect(usePageCanvas.getState().layout.glsl).toBe('full');
    expect(parsePageCanvasPrefs(store.get(PAGE_CANVAS_KEY)!).layout).toEqual({ convert: 'small', glsl: 'full' });
  });

  it('keeps the view and the wipe, clamped, and writes them out', () => {
    usePageCanvas.getState().setView('split');
    usePageCanvas.getState().setSplit(0.25);
    expect(usePageCanvas.getState().view).toBe('split');
    expect(usePageCanvas.getState().split).toBe(0.25);
    usePageCanvas.getState().setSplit(1.2);
    expect(usePageCanvas.getState().split).toBe(SPLIT_MAX);
    const saved = parsePageCanvasPrefs(store.get(PAGE_CANVAS_KEY)!);
    expect(saved.view).toBe('split');
    expect(saved.split).toBe(SPLIT_MAX);
  });

  it('rounds the width to whole pixels per page', () => {
    usePageCanvas.getState().setWidth('glsl', 512.6);
    expect(usePageCanvas.getState().width).toEqual({ convert: 0, glsl: 513 });
    expect(parsePageCanvasPrefs(store.get(PAGE_CANVAS_KEY)!).width.glsl).toBe(513);
  });

  it('says which pages host the canvas, only when full', () => {
    const layout = { convert: 'full', glsl: 'small' } as const;
    expect(hostsCanvas('convert', layout)).toBe(true);
    expect(hostsCanvas('glsl', layout)).toBe(false);
    expect(hostsCanvas('studio', layout)).toBe(false);
    expect(hostsCanvas('play', { convert: 'full', glsl: 'full' })).toBe(false);
  });
});
