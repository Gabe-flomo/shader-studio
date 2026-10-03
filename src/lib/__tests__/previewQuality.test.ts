/** The preview's resolution: chosen, remembered, and held at Full while exporting. */
import { describe, it, expect, vi } from 'vitest';
const store: Record<string, string> = {};
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: (k: string) => (globalThis as { __pq?: Record<string, string> }).__pq?.[k] ?? null, setItem: (k: string, v: string) => { ((globalThis as { __pq?: Record<string, string> }).__pq ??= {})[k] = v; }, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { PREVIEW_QUALITIES, effectivePreviewQuality, usePreviewQuality } from '../previewQuality';

describe('preview resolution', () => {
  it('offers Full, Half, Third and Quarter; remembers the choice', () => {
    void store;
    expect(PREVIEW_QUALITIES.map(q => q.label)).toEqual(['Full', 'Half', 'Third', 'Quarter']);
    usePreviewQuality.getState().setScale(1 / 3);
    expect(usePreviewQuality.getState().scale).toBeCloseTo(1 / 3);
    expect(localStorage.getItem('shader-studio:preview-quality')).toBe(String(1 / 3));
  });

  it('is held at Full while anything (an export) holds it, then goes back', () => {
    usePreviewQuality.getState().setScale(1 / 4);
    const a = usePreviewQuality.getState().hold();
    const b = usePreviewQuality.getState().hold();
    expect(effectivePreviewQuality()).toBe(1);
    a(); a();
    expect(effectivePreviewQuality()).toBe(1);
    b();
    expect(effectivePreviewQuality()).toBe(1 / 4);
  });
});
