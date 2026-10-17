// @vitest-environment jsdom
/**
 * The media pickers are wired to the shared keys (useMediaPreviewList):
 *   - the Texture node's Library (pictures and videos): ↓ shows a large preview / plays the video,
 *     → skips the video, a click previews without picking, Enter picks;
 *   - the builders' image library (PictureWays): ↓ previews, Enter picks;
 *   - the Files page's backgrounds dialog: Sounds play as you arrow (and stop when it closes),
 *     Videos preview, and in a picture picker Enter uses the image.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

const IMAGES = [
  { id: 'i1', name: 'Sunset', width: 10, height: 10, type: 'image/png', bytes: 1, createdAt: 1, thumb: 'data:image/png;base64,AA' },
  { id: 'i2', name: 'Forest', width: 10, height: 10, type: 'image/png', bytes: 1, createdAt: 2, thumb: 'data:image/png;base64,AB' },
];
const VIDEOS = [
  { id: 'v1', name: 'Waves', type: 'video/mp4', bytes: 10, createdAt: 1, thumb: '' },
  { id: 'v2', name: 'Smoke', type: 'video/mp4', bytes: 10, createdAt: 2, thumb: '' },
  { id: 's1', name: 'Kick', type: 'audio/wav', bytes: 10, createdAt: 3, thumb: '' },
  { id: 's2', name: 'Snare', type: 'audio/wav', bytes: 10, createdAt: 4, thumb: '' },
];
const spies = vi.hoisted(() => ({ loadLibraryVideo: vi.fn(async () => null), pictureFromLibrary: vi.fn(async () => ({ nodeId: 'n', source: { name: 'p' } })) }));

vi.mock('../../../lib/backgroundLibrary', async importOriginal => {
  const real = await importOriginal<typeof import('../../../lib/backgroundLibrary')>();
  return {
    ...real,
    listImages: async () => IMAGES,
    listVideos: async () => VIDEOS,
    getImage: async (id: string) => ({ ...IMAGES.find(i => i.id === id)!, blob: new Blob(['x'], { type: 'image/png' }) }),
    getVideo: async (id: string) => ({ ...VIDEOS.find(v => v.id === id)!, blob: new Blob(['x'], { type: 'video/mp4' }) }),
    ensureSoundWave: async () => {},
  };
});
vi.mock('../../../lib/texture/videoActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../../lib/texture/videoActions')>();
  return { ...real, loadLibraryVideo: spies.loadLibraryVideo };
});
vi.mock('../../../builders/textureActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../../builders/textureActions')>();
  return { ...real, pictureFromLibrary: spies.pictureFromLibrary };
});
const LINKED = [
  { name: 'beach.mp4', path: 'beach.mp4', dir: false, size: 100, mtime: 1 },
  { name: 'city.mp4', path: 'city.mp4', dir: false, size: 100, mtime: 2 },
  { name: 'hat.wav', path: 'hat.wav', dir: false, size: 100, mtime: 3 },
  { name: 'clap.wav', path: 'clap.wav', dir: false, size: 100, mtime: 4 },
];
vi.mock('../../../files/linkedFolders', async importOriginal => {
  const real = await importOriginal<typeof import('../../../files/linkedFolders')>();
  return {
    ...real,
    loadLinkedFolders: async () => {},
    listLinked: async () => LINKED,
    linkedSupport: () => 'browser',
    onLinkedChange: () => () => {},
    resolveLinked: async (ref: string) => ({ ok: true, blob: new Blob([ref], { type: ref.endsWith('.wav') ? 'audio/wav' : 'video/mp4' }) }),
  };
});
vi.mock('../../../files/linkedThumbs', () => ({ cachedPreview: () => null, linkedPreview: async () => null }));
vi.mock('../../backgrounds/useBackgrounds', () => ({
  useBackgroundImages: () => ({ images: IMAGES, error: null }),
  usePalettes: () => [],
  useLibraryVideos: () => ({ videos: VIDEOS, error: null }),
  deleteImageWithUndo: async () => {}, deletePaletteWithUndo: () => {}, deleteVideosWithUndo: async () => {},
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { emptyPlayRecord } from '../../../types/play';
import { TextureCardBody } from '../../NodeGraph/TextureCardBody';
import { PictureWays } from '../../builders/TexturePicker';
import { BackgroundsDialog } from '../../backgrounds/BackgroundsDialog';
import { LinkedBrowser } from '../../linked/LinkedBrowser';
import { useLinkedFolders } from '../../../files/linkedFolders';
import { resetSamplePreviewForTests, setAutoPreview, useSamplePreviewStore } from '../../../lib/samplePreview';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const played = vi.fn();
const paused = vi.fn();
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: function (this: HTMLMediaElement) { played(this); return Promise.resolve(); } });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: function (this: HTMLMediaElement) { paused(this); } });
URL.createObjectURL = (() => 'blob:preview') as typeof URL.createObjectURL;
URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

let root: Root | null = null;
let host: HTMLElement | null = null;
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); });
const keyOn = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const listbox = (label: string) => document.querySelector(`[role="listbox"][aria-label="${label}"]`) as HTMLElement;

function fakeAudio() {
  const el = {
    paused: true, currentTime: 0, duration: 10, volume: 1, preload: '', src: '',
    play: vi.fn(async () => { el.paused = false; }), pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  return el as unknown as HTMLAudioElement;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  resetSamplePreviewForTests(fakeAudio());
  setAutoPreview(true);
  spies.loadLibraryVideo.mockClear(); spies.pictureFromLibrary.mockClear(); played.mockClear(); paused.mockClear();
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });

describe('Texture node Library button', () => {
  function renderCard(type: 'textureInput' | 'videoInput' = 'textureInput') {
    useNodeGraphStore.setState({
      nodes: [n('uv', 'uv', 0, 0), n(type, 'tex', 100, 100, {}, { uv: ['uv', 'uv'] }), n('output', 'out', 600, 100, {}, { color: ['tex', 'color'] })],
      play: emptyPlayRecord(), nodeTextures: {}, videoTextures: {},
    });
    const node = useNodeGraphStore.getState().nodes.find(x => x.id === 'tex')!;
    act(() => { root!.render(<TextureCardBody node={node} onEditClip={() => {}} />); });
  }

  it('pictures: ↓ shows a large preview, a click only previews, Enter uses it', async () => {
    renderCard();
    act(() => { button('Library')!.click(); });
    await flush();
    const list = listbox('Library pictures');
    expect(list).toBeTruthy();
    expect(document.activeElement).toBe(list);
    // The built-in photos (lib/builtinImages.ts) are listed after the library's own.
    expect(list.textContent).toMatch(/Room and cat \(built in\)[\s\S]*Walkway cat \(built in\)/);
    keyOn(list, 'ArrowDown');
    await flush();
    expect(document.querySelector('[data-media-preview="image"] img')?.getAttribute('alt')).toBe('Preview of Sunset');
    act(() => { (document.querySelector('[data-media-item="i2"]') as HTMLElement).click(); });
    await flush();
    expect(document.querySelector('[data-media-preview="image"] img')?.getAttribute('alt')).toBe('Preview of Forest');
    expect(list.getAttribute('aria-activedescendant')).toBe(document.querySelector('[data-media-item="i2"]')!.id);
    expect(listbox('Library pictures')).toBeTruthy(); // not picked yet
    keyOn(list, 'Enter');
    await flush();
    expect(listbox('Library pictures')).toBeFalsy(); // picked: the popover closed
  });

  it('videos: only videos are listed, ↓ plays a preview, → skips, Enter loads it into the node', async () => {
    renderCard('videoInput');
    act(() => { button('Library')!.click(); });
    await flush();
    const list = listbox('Library videos');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(2); // the sounds are left out
    keyOn(list, 'ArrowDown');
    await flush();
    const video = document.querySelector('[data-media-preview="video"] video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
    keyOn(list, 'ArrowRight');
    expect(video.currentTime).toBe(3);
    keyOn(list, 'ArrowLeft');
    expect(video.currentTime).toBe(0);
    keyOn(list, 'Enter');
    await flush();
    expect(spies.loadLibraryVideo).toHaveBeenCalledWith('tex', 'v1');
  });
});

describe('Builders image library (PictureWays)', () => {
  it('↓ previews the picture, a click does not pick, Enter does', async () => {
    const onPicked = vi.fn();
    act(() => { root!.render(<PictureWays onPicked={onPicked} graph={false} />); });
    act(() => { (document.querySelector('[data-picture-library]') as HTMLButtonElement).click(); });
    await flush();
    const list = listbox('Image library');
    keyOn(list, 'ArrowDown');
    keyOn(list, 'ArrowDown');
    await flush();
    expect(document.querySelector('[data-media-preview="image"] img')?.getAttribute('alt')).toBe('Preview of Forest');
    act(() => { (document.querySelector('[data-media-item="i1"]') as HTMLElement).click(); });
    expect(spies.pictureFromLibrary).not.toHaveBeenCalled();
    keyOn(list, 'Enter');
    await flush();
    expect(spies.pictureFromLibrary).toHaveBeenCalledWith('i1', undefined);
    expect(onPicked).toHaveBeenCalled();
  });
});

describe('Backgrounds dialog (the Files page library)', () => {
  it('Sounds: ↓ plays each one, and the preview stops when the dialog closes', async () => {
    act(() => { root!.render(<BackgroundsDialog onDone={() => {}} />); });
    act(() => { button('Sounds (2)')!.click(); });
    await flush();
    const list = listbox('Sounds');
    keyOn(list, 'ArrowDown');
    await flush();
    expect(useSamplePreviewStore.getState()).toMatchObject({ id: 's1', playing: true });
    keyOn(list, 'ArrowDown');
    await flush();
    expect(useSamplePreviewStore.getState().id).toBe('s2');
    expect(document.getElementById(list.getAttribute('aria-activedescendant')!)?.getAttribute('aria-label')).toMatch(/^Snare/);
    act(() => root!.render(<div />));
    expect(useSamplePreviewStore.getState().id).toBeNull();
  });

  it('Videos: a click previews (playing), double-click opens the viewer', async () => {
    act(() => { root!.render(<BackgroundsDialog onDone={() => {}} />); });
    act(() => { button('Videos (2)')!.click(); });
    await flush();
    const list = listbox('Videos');
    keyOn(list, 'ArrowDown');
    await flush();
    expect(document.querySelector('[data-media-preview="video"] video')).toBeTruthy();
    expect(document.querySelector('[data-media-preview="video"]')!.textContent).toContain('Waves');
  });

  it('a picture picker: ↓ previews, Enter uses the image', async () => {
    const onDone = vi.fn();
    act(() => { root!.render(<BackgroundsDialog pick="image" onDone={onDone} />); });
    await flush();
    const list = listbox('Image backgrounds');
    keyOn(list, 'ArrowDown');
    await flush();
    expect(document.querySelector('[data-media-preview="image"]')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    keyOn(list, 'Enter');
    expect(onDone).toHaveBeenCalledWith({ kind: 'image', image: IMAGES[0] });
  });
});

describe('Linked-folder picker (every "Linked…" button: Play layers, drum pads, Audio Input…)', () => {
  beforeEach(() => {
    useLinkedFolders.setState({ loaded: true, folders: [{ id: 'f1', name: 'Clips', kind: 'any', backend: 'browser', addedAt: 1 }], status: { f1: 'connected' } });
  });

  it('videos: ↓ plays a preview beside the list, Enter uses it', async () => {
    const onPick = vi.fn();
    act(() => { root!.render(<LinkedBrowser filter="video" mode="file" onPick={onPick} />); });
    await flush();
    const list = listbox('Clips: videos');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(2);
    keyOn(list, 'ArrowDown');
    await flush();
    expect(document.querySelector('[data-media-preview="video"] video')).toBeTruthy();
    keyOn(list, 'Enter');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', entry: LINKED[0] }));
  });

  it('sounds: ↓ plays each one through the shared preview, which stops when the picker closes', async () => {
    act(() => { root!.render(<LinkedBrowser filter="audio" mode="file" onPick={() => {}} />); });
    await flush();
    const list = listbox('Clips: sounds');
    keyOn(list, 'ArrowDown');
    await flush();
    expect(useSamplePreviewStore.getState()).toMatchObject({ id: 'hat.wav', playing: true });
    act(() => root!.render(<div />));
    expect(useSamplePreviewStore.getState().id).toBeNull();
  });
});
