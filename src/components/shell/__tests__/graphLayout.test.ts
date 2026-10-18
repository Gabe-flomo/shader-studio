// @vitest-environment jsdom
/**
 * The Studio split: the default preview width leaves the graph room at 1440, a dragged width is
 * remembered, and Maximize graph is a remembered toggle with a shortcut. Build frames the graph.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { defaultPreviewWidth, rememberedPreviewWidth, rememberPreviewWidth, useGraphMaximize } from '../graphLayout';
import { DEFAULT_ACTIONS, normaliseCombo } from '../../../hooks/useShortcuts';
import { buildStaying } from '../../../builders/finish';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';

describe('preview width', () => {
  it('at 1440 the preview leaves the graph about 640 beside a 320 node list and the rail', () => {
    const p = defaultPreviewWidth(1440, 'desktop-lg');
    expect(p).toBe(432);
    expect(1440 - p - 320 - 50).toBeGreaterThanOrEqual(620);
  });

  it('wide windows keep the larger preview', () => {
    expect(defaultPreviewWidth(2400, 'desktop-lg')).toBe(912);
  });

  it('a dragged width is remembered, and ignored when it no longer fits the window', () => {
    expect(rememberedPreviewWidth(1440, 200, 600)).toBeNull();
    rememberPreviewWidth(510.4);
    expect(rememberedPreviewWidth(1440, 200, 600)).toBe(510);
    expect(rememberedPreviewWidth(1000, 200, 600)).toBeNull();
  });
});

describe('Maximize graph', () => {
  it('toggles, is remembered, and has ⇧⌘G', () => {
    expect(useGraphMaximize.getState().on).toBe(false);
    useGraphMaximize.getState().toggle();
    expect(useGraphMaximize.getState().on).toBe(true);
    expect(localStorage.getItem('playfield.graphMaximized')).toBe('1');
    useGraphMaximize.getState().toggle();
    expect(localStorage.getItem('playfield.graphMaximized')).toBeNull();
    expect(normaliseCombo(DEFAULT_ACTIONS.find(a => a.id === 'maximizeGraph')!.defaultCombo)).toBe('cmd+shift+g');
  });
});

describe('Build frames the graph', () => {
  afterEach(() => { vi.useRealTimers(); useNodeGraphStore.setState({ _fitViewCallback: null }); });

  it('a Build that worked fits the whole graph (never past 100%); a cancelled one does not', async () => {
    vi.useFakeTimers();
    const fit = vi.fn();
    useNodeGraphStore.setState({ _fitViewCallback: fit });
    expect(await buildStaying({ label: 'x', build: () => true })).toBe(true);
    vi.runAllTimers();
    expect(fit).toHaveBeenCalledWith(undefined, { maxZoom: 1 });
    fit.mockClear();
    expect(await buildStaying({ label: 'x', build: () => null })).toBe(false);
    vi.runAllTimers();
    expect(fit).not.toHaveBeenCalled();
  });
});
