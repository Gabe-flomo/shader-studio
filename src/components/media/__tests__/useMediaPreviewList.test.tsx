// @vitest-environment jsdom
/**
 * useMediaPreviewList — the keys every media picker shares: ↑/↓ move (the preview follows),
 * ←/→ restart/skip for sounds and videos (previous/next for pictures), Home/End, Space
 * plays/pauses, Enter picks, Esc stops and closes; a click previews without picking; the
 * listbox points at the highlighted row (aria-activedescendant); and only one preview plays
 * app-wide (a sound stops a video, a video stops the sound), stopping when the list closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMediaPreviewList, type MediaKind } from '../useMediaPreviewList';
import { activeVideoPreview, claimVideoPreview, previewSample, resetSamplePreviewForTests, setAutoPreview, useSamplePreviewStore } from '../../../lib/samplePreview';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeAudio() {
  const el = {
    paused: true, currentTime: 0, duration: 10, volume: 1, preload: '', src: '',
    play: vi.fn(async () => { el.paused = false; }), pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  return el as unknown as HTMLAudioElement;
}
function fakeVideo(duration = 20) {
  const el = {
    paused: true, currentTime: 5, duration,
    play: vi.fn(async () => { el.paused = false; }), pause: vi.fn(() => { el.paused = true; }),
  };
  return el as unknown as Omit<HTMLVideoElement, "paused"> & HTMLVideoElement & { paused: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
}

type Item = { id: string };
const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
type Api = ReturnType<typeof useMediaPreviewList<Item>>;

let mounted: { root: Root; host: HTMLElement } | null = null;
function mount(kind: MediaKind, opts: { onPick?: (i: Item) => void; onClose?: () => void } = {}) {
  const ref: { current: Api | null } = { current: null };
  function Harness() {
    const api = useMediaPreviewList<Item>({ kind, items, label: 'Things', getSource: async i => `blob:${i.id}`, onPick: opts.onPick ?? (() => {}), onClose: opts.onClose });
    ref.current = api;
    return (
      <div {...api.listProps}>
        {items.map(i => <div key={i.id} {...api.optionProps(i)}>{i.id}</div>)}
      </div>
    );
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  mounted = { root, host };
  return ref;
}
const key = (k: string) => ({ key: k, preventDefault: () => {} });
const press = async (ref: { current: Api | null }, k: string) => { await act(async () => { ref.current!.onKeyDown(key(k)); await Promise.resolve(); }); };
const unmount = () => { if (mounted) { act(() => mounted!.root.unmount()); mounted.host.remove(); mounted = null; } };

beforeEach(() => { localStorage.clear(); resetSamplePreviewForTests(fakeAudio()); setAutoPreview(true); });
afterEach(unmount);

describe('useMediaPreviewList: shared keys', () => {
  it('is a listbox whose active descendant is the highlighted option', async () => {
    const ref = mount('image');
    const list = mounted!.host.querySelector('[role="listbox"]')!;
    expect(list.getAttribute('aria-label')).toBe('Things');
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.hasAttribute('aria-activedescendant')).toBe(false);
    await press(ref, 'ArrowDown');
    await press(ref, 'ArrowDown');
    const active = list.getAttribute('aria-activedescendant')!;
    const opt = document.getElementById(active)!;
    expect(opt.textContent).toBe('b');
    expect(opt.getAttribute('aria-selected')).toBe('true');
    expect(mounted!.host.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });

  it('pictures: ↑/↓ and ←/→ move, Home/End jump, Enter picks, nothing plays', async () => {
    const onPick = vi.fn();
    const ref = mount('image', { onPick });
    await press(ref, 'ArrowDown');
    expect(ref.current!.highlight).toBe('a');
    await press(ref, 'ArrowRight');
    expect(ref.current!.highlight).toBe('b');
    await press(ref, 'ArrowLeft');
    expect(ref.current!.highlight).toBe('a');
    await press(ref, 'End');
    expect(ref.current!.highlight).toBe('c');
    await press(ref, 'Home');
    expect(ref.current!.highlight).toBe('a');
    expect(useSamplePreviewStore.getState().id).toBeNull();
    await press(ref, 'Enter');
    expect(onPick).toHaveBeenCalledWith({ id: 'a' });
  });

  it('pictures: a click previews without picking; double-click picks; tap twice picks on a phone', async () => {
    const onPick = vi.fn();
    const ref = mount('image', { onPick });
    act(() => ref.current!.onRowClick({ id: 'c' }));
    expect(ref.current!.highlighted).toEqual({ id: 'c' });
    expect(onPick).not.toHaveBeenCalled();
    act(() => ref.current!.onRowDoubleClick({ id: 'c' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    act(() => ref.current!.onRowTap({ id: 'b' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    act(() => ref.current!.onRowTap({ id: 'b' }));
    expect(onPick).toHaveBeenLastCalledWith({ id: 'b' });
  });

  it('videos: ← back to the start, → skips 3 s, Space plays/pauses the preview element', async () => {
    const ref = mount('video');
    const v = fakeVideo();
    act(() => ref.current!.videoRef(v));
    await press(ref, 'ArrowDown');
    expect(ref.current!.highlight).toBe('a');
    await press(ref, 'ArrowRight');
    expect(v.currentTime).toBe(8);
    await press(ref, 'ArrowLeft');
    expect(v.currentTime).toBe(0);
    expect(v.play).toHaveBeenCalled();
    await press(ref, ' ');
    expect(v.pause).toHaveBeenCalled();
    expect(v.paused).toBe(true);
    await press(ref, ' ');
    expect(v.paused).toBe(false);
    // ←/→ don't move the highlight for a video.
    expect(ref.current!.highlight).toBe('a');
  });

  it('sounds: ↓ plays, Space pauses, Esc stops and closes', async () => {
    const onClose = vi.fn();
    const ref = mount('audio', { onClose });
    await press(ref, 'ArrowDown');
    await act(async () => { await Promise.resolve(); });
    expect(useSamplePreviewStore.getState()).toMatchObject({ id: 'a', playing: true });
    await press(ref, ' ');
    expect(useSamplePreviewStore.getState().playing).toBe(false);
    await press(ref, 'Escape');
    expect(useSamplePreviewStore.getState().id).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('keys typed into a field inside the list are left alone', async () => {
    const ref = mount('image');
    const input = document.createElement('input');
    await act(async () => { ref.current!.onKeyDown({ key: 'ArrowDown', preventDefault: () => {}, target: input }); });
    expect(ref.current!.highlight).toBeNull();
  });
});

describe('useMediaPreviewList: one preview at a time', () => {
  it('a sound preview stops when the list closes', async () => {
    const ref = mount('audio');
    await press(ref, 'ArrowDown');
    await act(async () => { await Promise.resolve(); });
    expect(useSamplePreviewStore.getState().id).toBe('a');
    unmount();
    expect(useSamplePreviewStore.getState().id).toBeNull();
  });

  it('a video preview pauses when its list closes', () => {
    const ref = mount('video');
    const v = fakeVideo();
    act(() => ref.current!.videoRef(v));
    claimVideoPreview(v);
    v.paused = false;
    unmount();
    expect(v.pause).toHaveBeenCalled();
    expect(activeVideoPreview()).toBeNull();
  });

  it('a video starting stops the sound; a sound starting pauses the video', async () => {
    await previewSample('s1', async () => 'blob:s1');
    expect(useSamplePreviewStore.getState().id).toBe('s1');
    const v = fakeVideo();
    claimVideoPreview(v);
    expect(useSamplePreviewStore.getState().id).toBeNull();
    v.paused = false;
    await previewSample('s2', async () => 'blob:s2');
    expect(v.pause).toHaveBeenCalled();
    // A second video preview pauses the first.
    const w = fakeVideo();
    v.pause.mockClear();
    claimVideoPreview(w);
    expect(v.pause).toHaveBeenCalled();
  });
});
