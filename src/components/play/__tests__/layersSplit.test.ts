/**
 * The Layers page's list ↔ editor divider (LayersPanel's `split` mode,
 * docs/split-view.md): the ratio clamped to each column's minimum width and
 * remembered across sessions (playUi.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import {
  clampLayersSplitRatio, LAYERS_SPLIT_DEFAULT_RATIO, LAYERS_SPLIT_MIN_EDITOR_PX, LAYERS_SPLIT_MIN_LIST_PX, usePlayUi,
} from '../playUi';

beforeEach(() => {
  store.clear();
  usePlayUi.setState({ layersSplitRatio: LAYERS_SPLIT_DEFAULT_RATIO });
});

describe('clampLayersSplitRatio', () => {
  it('falls back to the default for junk', () => {
    expect(clampLayersSplitRatio(NaN)).toBe(LAYERS_SPLIT_DEFAULT_RATIO);
  });

  it('keeps a plain ratio within the general bounds when no width is known', () => {
    expect(clampLayersSplitRatio(0.5)).toBe(0.5);
    expect(clampLayersSplitRatio(0.01)).toBeGreaterThan(0.01);
    expect(clampLayersSplitRatio(0.99)).toBeLessThan(0.99);
  });

  it('keeps the list and the editor at their minimum widths for a known total', () => {
    const total = 800;
    // Dragged almost to the left: the list stays at its minimum.
    expect(clampLayersSplitRatio(0.01, total)).toBeCloseTo(LAYERS_SPLIT_MIN_LIST_PX / total);
    // Dragged almost to the right: the editor stays at its minimum.
    expect(clampLayersSplitRatio(0.99, total)).toBeCloseTo(1 - LAYERS_SPLIT_MIN_EDITOR_PX / total);
  });

  it('splits evenly when the page is too narrow for both minimums', () => {
    const total = LAYERS_SPLIT_MIN_LIST_PX + LAYERS_SPLIT_MIN_EDITOR_PX - 1;
    expect(clampLayersSplitRatio(0.3, total)).toBe(0.5);
  });
});

describe('usePlayUi layersSplitRatio', () => {
  it('starts at the default and remembers a new ratio across "sessions"', () => {
    expect(usePlayUi.getState().layersSplitRatio).toBe(LAYERS_SPLIT_DEFAULT_RATIO);
    usePlayUi.getState().setLayersSplitRatio(0.55);
    expect(usePlayUi.getState().layersSplitRatio).toBe(0.55);
    expect(store.get('shader-studio:play:layersSplitRatio')).toBe('0.55');
  });

  it('clamps whatever it is asked to remember', () => {
    usePlayUi.getState().setLayersSplitRatio(5);
    expect(usePlayUi.getState().layersSplitRatio).toBeLessThan(1);
    usePlayUi.getState().setLayersSplitRatio(-5);
    expect(usePlayUi.getState().layersSplitRatio).toBeGreaterThan(0);
  });
});
