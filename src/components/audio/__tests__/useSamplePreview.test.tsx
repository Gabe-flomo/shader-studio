// @vitest-environment jsdom
/**
 * useSamplePreview — the list-navigation half of Splice-style auditioning
 * (docs/linked-folders.md, docs/drum-pads.md): ↑/↓ move the highlight (and,
 * with auto-preview on, play it), ← restarts, → skips 3 s, Space toggles,
 * Enter picks, Esc stops and closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSamplePreview } from '../useSamplePreview';
import { resetSamplePreviewForTests, setAutoPreview, useSamplePreviewStore } from '../../../lib/samplePreview';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeAudio(duration = 10) {
  const el = {
    paused: true, currentTime: 0, duration, volume: 1, preload: '', src: '',
    play: vi.fn(async () => { el.paused = false; }),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  return el as unknown as HTMLAudioElement;
}

type Item = { id: string };
const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

let mounted: { root: Root; host: HTMLElement } | null = null;
function mount(apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null }, opts: { onPick: (i: Item) => void; onClose: () => void }) {
  function Harness() {
    apiRef.current = useSamplePreview<Item>({ items, getSource: async (i) => `blob:${i.id}`, onPick: opts.onPick, onClose: opts.onClose });
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  mounted = { root, host };
}

const key = (k: string) => ({ key: k, preventDefault: () => {} });

describe('useSamplePreview', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSamplePreviewForTests(fakeAudio());
    setAutoPreview(true);
  });
  afterEach(() => {
    if (mounted) { act(() => mounted!.root.unmount()); mounted!.host.remove(); mounted = null; }
  });

  it('ArrowDown highlights and (auto-preview on) plays the first, then the next item', async () => {
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick: () => {}, onClose: () => {} });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); });
    expect(apiRef.current!.highlight).toBe('a');
    await act(async () => { await Promise.resolve(); }); // let the preview load settle
    expect(useSamplePreviewStore.getState().id).toBe('a');
    expect(useSamplePreviewStore.getState().playing).toBe(true);

    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); });
    await act(async () => { await Promise.resolve(); });
    expect(apiRef.current!.highlight).toBe('b');
    expect(useSamplePreviewStore.getState().id).toBe('b');
  });

  it('ArrowUp moves the highlight back, not past the first item', async () => {
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick: () => {}, onClose: () => {} });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); await Promise.resolve(); });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); await Promise.resolve(); });
    expect(apiRef.current!.highlight).toBe('b');
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowUp')); await Promise.resolve(); });
    expect(apiRef.current!.highlight).toBe('a');
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowUp')); await Promise.resolve(); });
    expect(apiRef.current!.highlight).toBe('a'); // clamped
  });

  it('does not auto-play when auto-preview is off, but still highlights', async () => {
    setAutoPreview(false);
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick: () => {}, onClose: () => {} });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); await Promise.resolve(); });
    expect(apiRef.current!.highlight).toBe('a');
    expect(useSamplePreviewStore.getState().id).toBeNull();
  });

  it('Enter picks the highlighted item', async () => {
    const onPick = vi.fn();
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick, onClose: () => {} });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); await Promise.resolve(); });
    await act(async () => { apiRef.current!.onKeyDown(key('Enter')); });
    expect(onPick).toHaveBeenCalledWith({ id: 'a' });
  });

  it('Escape stops the preview and closes', async () => {
    const onClose = vi.fn();
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick: () => {}, onClose });
    await act(async () => { apiRef.current!.onKeyDown(key('ArrowDown')); await Promise.resolve(); });
    expect(useSamplePreviewStore.getState().id).toBe('a');
    await act(async () => { apiRef.current!.onKeyDown(key('Escape')); });
    expect(useSamplePreviewStore.getState().id).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('double-click picks; a plain click only highlights (and previews)', async () => {
    const onPick = vi.fn();
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick, onClose: () => {} });
    await act(async () => { apiRef.current!.onRowClick({ id: 'b' }); await Promise.resolve(); });
    expect(onPick).not.toHaveBeenCalled();
    expect(apiRef.current!.highlight).toBe('b');
    expect(useSamplePreviewStore.getState().id).toBe('b');
    act(() => { apiRef.current!.onRowDoubleClick({ id: 'b' }); });
    expect(onPick).toHaveBeenCalledWith({ id: 'b' });
  });

  it('tap-to-preview, tap again to pick (phone)', async () => {
    const onPick = vi.fn();
    const apiRef: { current: ReturnType<typeof useSamplePreview<Item>> | null } = { current: null };
    mount(apiRef, { onPick, onClose: () => {} });
    await act(async () => { apiRef.current!.onRowTap({ id: 'c' }); await Promise.resolve(); });
    expect(onPick).not.toHaveBeenCalled();
    expect(apiRef.current!.highlight).toBe('c');
    act(() => { apiRef.current!.onRowTap({ id: 'c' }); });
    expect(onPick).toHaveBeenCalledWith({ id: 'c' });
  });
});
