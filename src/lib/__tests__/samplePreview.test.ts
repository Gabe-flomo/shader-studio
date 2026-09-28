// @vitest-environment jsdom
/**
 * samplePreview.ts — the dedicated preview player every sample browser
 * shares (docs/linked-folders.md, docs/drum-pads.md): one sample previews at
 * a time (a later call for a different id cancels a slower one in flight),
 * play/pause/restart/skip act on whatever is currently loaded, and
 * auto-preview is remembered across sessions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  previewSample, resetSamplePreviewForTests, restartPreview, setAutoPreview, skipPreview, stopPreview, togglePlayPause, useSamplePreviewStore,
} from '../samplePreview';

function fakeAudio(duration = 8) {
  const el = {
    paused: true,
    currentTime: 0,
    duration,
    volume: 1,
    preload: '',
    src: '',
    play: vi.fn(async () => { el.paused = false; }),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return el as unknown as HTMLAudioElement;
}

describe('samplePreview', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSamplePreviewForTests(fakeAudio());
  });

  it('loads and plays a sample by id', async () => {
    await previewSample('kick', async () => 'blob:kick');
    const s = useSamplePreviewStore.getState();
    expect(s.id).toBe('kick');
    expect(s.playing).toBe(true);
    expect(s.loading).toBe(false);
  });

  it('only one preview plays at a time: a later call wins over a slower earlier one', async () => {
    let resolveA!: (v: string) => void;
    const slow = new Promise<string>(r => { resolveA = r; });
    const first = previewSample('snare', () => slow);
    await previewSample('kick', async () => 'blob:kick'); // fast, finishes first
    expect(useSamplePreviewStore.getState().id).toBe('kick');
    resolveA('blob:snare');
    await first; // the stale load resolves after, but must not clobber state
    expect(useSamplePreviewStore.getState().id).toBe('kick');
    expect(useSamplePreviewStore.getState().playing).toBe(true);
  });

  it('togglePlayPause pauses and resumes the current sample', async () => {
    await previewSample('kick', async () => 'blob:kick');
    togglePlayPause();
    expect(useSamplePreviewStore.getState().playing).toBe(false);
    togglePlayPause();
    await Promise.resolve(); // play() resolves on a microtask
    expect(useSamplePreviewStore.getState().playing).toBe(true);
  });

  it('restartPreview seeks back to the start', async () => {
    await previewSample('kick', async () => 'blob:kick');
    skipPreview(3);
    expect(useSamplePreviewStore.getState().position).toBe(3);
    restartPreview();
    expect(useSamplePreviewStore.getState().position).toBe(0);
  });

  it('skipPreview clamps to [0, duration]', async () => {
    await previewSample('kick', async () => 'blob:kick');
    skipPreview(-100);
    expect(useSamplePreviewStore.getState().position).toBe(0);
    skipPreview(1000);
    expect(useSamplePreviewStore.getState().position).toBe(8);
    skipPreview(-2);
    expect(useSamplePreviewStore.getState().position).toBe(6);
  });

  it('stopPreview unloads and resets state', async () => {
    await previewSample('kick', async () => 'blob:kick');
    stopPreview();
    const s = useSamplePreviewStore.getState();
    expect(s.id).toBeNull();
    expect(s.playing).toBe(false);
    expect(s.position).toBe(0);
  });

  it('a null source leaves an error instead of throwing', async () => {
    await previewSample('missing', async () => null);
    const s = useSamplePreviewStore.getState();
    expect(s.id).toBe('missing');
    expect(s.playing).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('auto-preview is remembered across a reset (localStorage)', () => {
    expect(useSamplePreviewStore.getState().autoPreview).toBe(true);
    setAutoPreview(false);
    expect(localStorage.getItem('shader-studio:sample-preview:auto')).toBe('0');
    resetSamplePreviewForTests(fakeAudio());
    expect(useSamplePreviewStore.getState().autoPreview).toBe(false);
    setAutoPreview(true);
    resetSamplePreviewForTests(fakeAudio());
    expect(useSamplePreviewStore.getState().autoPreview).toBe(true);
  });
});
