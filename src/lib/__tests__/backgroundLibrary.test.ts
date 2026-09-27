/**
 * The backgrounds library: image backgrounds in IndexedDB (fake-indexeddb
 * here) and palettes in localStorage — add, list, rename, file, delete with
 * undo — and both through a library ZIP and back. Also the capture's
 * warm-up plan, which makes a capture at a given time the same every time.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

const store = new Map<string, string>();
vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
});
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
} as Storage;

import {
  addImage, allPalettes, backgroundZipFiles, captureName, captureSteps, clampCaptureSize, deleteImage, deletePalette, getImage, getPalette, importBackgroundFiles,
  listImages, listPalettes, moveImage, paletteFill, PALETTE_PRESETS, PALETTES_KEY, renameImage, renamePalette, resetBackgroundCache, savePalette, sizeForAspect, subscribe,
  IMAGE_FOLDER_SCOPE, BACKGROUNDS_MANIFEST,
} from '../backgroundLibrary';
import { createFolder, loadFolders } from '../../utils/assetFolders';
import { buildLibraryZip, buildSetZip, countInSet, importLibrary, readLibrary, takeSnapshot, kindOfKey } from '../../utils/library';
import { PLAY_FILL_STOPS_MAX } from '../../types/play';

const bytes = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/png' });
const img = (name: string, n = 3) => addImage(bytes(...Array.from({ length: n }, (_, i) => i + 1)), { name, width: 1920, height: 1080, thumb: 'data:image/jpeg;base64,AA==' });

/** A browser with nothing in it: new storage, a new IndexedDB. */
function freshBrowser() {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
}

beforeEach(freshBrowser);

describe('image backgrounds', () => {
  it('adds, lists newest first, reads back the same bytes, renames and files', async () => {
    const seen: number[] = [];
    const off = subscribe(() => seen.push(1));
    const a = await img('Sunset · 2 s');
    const b = await addImage(bytes(9, 9), { name: '  Ink   wash ', width: 800, height: 600, thumb: 'x', createdAt: a.createdAt + 10, source: { graph: 'raymarch', kind: 'example', time: 3.25, mode: 'play' } });
    expect(b.name).toBe('Ink wash');
    const list = await listImages();
    expect(list.map(m => m.id)).toEqual([b.id, a.id]);
    expect(list[0].source).toEqual({ graph: 'raymarch', kind: 'example', time: 3.25, mode: 'play' });
    expect(list[1]).toMatchObject({ width: 1920, height: 1080, type: 'image/png', bytes: 3 });
    const full = await getImage(a.id);
    expect([...new Uint8Array(await full!.blob.arrayBuffer())]).toEqual([1, 2, 3]);

    await renameImage(a.id, 'Dusk');
    const f = createFolder(IMAGE_FOLDER_SCOPE, 'Title cards');
    moveImage(a.id, f.id);
    resetBackgroundCache(); // read from the store, not the cache
    const again = await listImages();
    expect(again.find(m => m.id === a.id)).toMatchObject({ name: 'Dusk', folderId: f.id });
    expect(seen.length).toBeGreaterThanOrEqual(4);
    off();
  });

  it('deletes with an undo that puts it back as it was, folder and all', async () => {
    const a = await img('Keep me');
    const f = createFolder(IMAGE_FOLDER_SCOPE, 'F');
    moveImage(a.id, f.id);
    const undo = await deleteImage(a.id);
    expect(undo).toBeTypeOf('function');
    expect(await listImages()).toEqual([]);
    expect(await getImage(a.id)).toBeNull();
    await undo!();
    const back = await listImages();
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: a.id, name: 'Keep me', folderId: f.id });
    expect(await deleteImage('nope')).toBeNull();
  });
});

describe('palettes', () => {
  it('has built-in presets that can’t be deleted, and saves, renames and deletes yours with undo', () => {
    expect(PALETTE_PRESETS.length).toBeGreaterThanOrEqual(7);
    expect(PALETTE_PRESETS.map(p => p.name)).toEqual(expect.arrayContaining(['Dusk', 'Ocean', 'Ink', 'Paper', 'Neon', 'Forest', 'Mono']));
    expect(deletePalette(PALETTE_PRESETS[0].id)).toBeNull();

    const p = savePalette({ name: 'Mine', stops: [{ pos: 1, color: [1, 1, 1] }, { pos: 0, color: [0, 0, 0] }], style: 'bands', angle: 90 });
    expect(p.stops.map(s => s.pos)).toEqual([0, 1]); // sorted
    expect(getPalette(p.id)).toMatchObject({ name: 'Mine', style: 'bands', angle: 90 });
    expect(JSON.parse(store.get(PALETTES_KEY)!)).toHaveLength(1);
    renamePalette(p.id, 'Night');
    expect(listPalettes()[0].name).toBe('Night');
    expect(allPalettes().slice(0, PALETTE_PRESETS.length)).toEqual(PALETTE_PRESETS);

    const undo = deletePalette(p.id)!;
    expect(listPalettes()).toEqual([]);
    undo();
    expect(listPalettes()[0]).toMatchObject({ id: p.id, name: 'Night' });
  });

  it('keeps up to 32 stops in the library and gives Play at most 8, spanning the same colours', () => {
    const stops = Array.from({ length: 40 }, (_, i) => ({ pos: i / 39, color: [i / 39, 0, 1 - i / 39] as [number, number, number] }));
    const p = savePalette({ name: 'Long', stops, style: 'gradient' });
    expect(p.stops).toHaveLength(32);
    const fill = paletteFill(p);
    expect(fill.stops).toHaveLength(PLAY_FILL_STOPS_MAX);
    expect(fill.stops[0].color).toEqual([0, 0, 1]);
    expect(fill.stops[7].color.map(v => Number(v.toFixed(3)))).toEqual([1, 0, 0]);
    expect(fill.paletteId).toBe(p.id);
  });
});

describe('library ZIP', () => {
  it('carries image backgrounds and palettes out and back, with ids and folders', async () => {
    const a = await img('Sunset · 2 s', 5);
    const b = await addImage(bytes(7, 7, 7), { name: 'Ink', width: 10, height: 20, thumb: 't', source: { graph: 'My graph', kind: 'saved', time: 1, mode: 'graph' } });
    const f = createFolder(IMAGE_FOLDER_SCOPE, 'Title cards');
    moveImage(b.id, f.id);
    const pal = savePalette({ name: 'Night', stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [0.2, 0.3, 0.9] }], style: 'gradient', angle: 135 });

    const extra = await backgroundZipFiles();
    expect(Object.keys(extra)).toContain(BACKGROUNDS_MANIFEST);
    expect(Object.keys(extra)).toContain('backgrounds/images/Sunset · 2 s.png');
    expect(Object.keys(extra)).toContain('backgrounds/images/Title cards/Ink.png');
    const zip = buildLibraryZip(takeSnapshot(), 'Lib', extra);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['Lib/library.json', 'Lib/background palettes.json', 'Lib/backgrounds/images.json', 'Lib/backgrounds/images/Title cards/Ink.png']));

    // Another browser, empty.
    freshBrowser();
    expect(await listImages()).toEqual([]);
    importLibrary(readLibrary(zip));
    const r = await importBackgroundFiles(unzipSync(zip));
    expect(r).toEqual({ added: 2, same: 0, skipped: 0 });
    resetBackgroundCache();
    const list = await listImages();
    expect(list.map(m => m.id).sort()).toEqual([a.id, b.id].sort());
    const ink = list.find(m => m.id === b.id)!;
    expect(ink).toMatchObject({ name: 'Ink', width: 10, height: 20, source: { graph: 'My graph', kind: 'saved', time: 1, mode: 'graph' } });
    // Its folder came with library.json's folder store: the same folder, not a second one.
    expect(loadFolders(IMAGE_FOLDER_SCOPE).map(x => x.label)).toEqual(['Title cards']);
    expect(ink.folderId).toBe(loadFolders(IMAGE_FOLDER_SCOPE)[0].id);
    expect([...new Uint8Array(await (await getImage(a.id))!.blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(getPalette(pal.id)).toMatchObject({ name: 'Night', angle: 135 });

    // Importing again adds nothing.
    expect(await importBackgroundFiles(unzipSync(zip))).toEqual({ added: 0, same: 2, skipped: 0 });
  });

  it('makes the folder from the manifest when the ZIP has no folder store (a loose backgrounds download)', async () => {
    const b = await img('Card');
    moveImage(b.id, createFolder(IMAGE_FOLDER_SCOPE, 'Cards').id);
    const set = buildSetZip(takeSnapshot(), 'backgrounds', await backgroundZipFiles());
    expect(set.name).toMatch(/backgrounds/);
    expect(countInSet(takeSnapshot(), 'backgrounds')).toBe(0); // palettes only: images are counted by the caller
    freshBrowser();
    await importBackgroundFiles(unzipSync(set.bytes));
    const [m] = await listImages();
    expect(loadFolders(IMAGE_FOLDER_SCOPE).find(f => f.id === m.folderId)?.label).toBe('Cards');
  });

  it('counts background palettes as backgrounds', () => {
    savePalette({ name: 'A', stops: [{ pos: 0, color: [0, 0, 0] }], style: 'gradient' });
    expect(kindOfKey(PALETTES_KEY, store.get(PALETTES_KEY)!)).toBe('backgrounds');
    expect(countInSet(takeSnapshot(), 'backgrounds')).toBe(1);
  });
});

describe('capturing', () => {
  it('plans the warm-up the same way every time, from 0 up to the moment', () => {
    const a = captureSteps(0.1);
    expect(a).toEqual(captureSteps(0.1));
    expect(a.dt).toBeCloseTo(1 / 60);
    expect(a.steps).toHaveLength(6);
    expect(a.steps[0]).toBe(0);
    expect(Math.max(...a.steps)).toBeLessThan(0.1);
    for (let i = 1; i < a.steps.length; i++) expect(a.steps[i] - a.steps[i - 1]).toBeCloseTo(1 / 60);
    expect(captureSteps(0).steps).toEqual([]);
    expect(captureSteps(-3).steps).toEqual([]);
  });

  it('caps the steps for late moments by making them longer', () => {
    const late = captureSteps(120, { maxSteps: 1800 });
    expect(late.steps).toHaveLength(1800);
    expect(late.dt).toBeCloseTo(120 / 1800);
    expect(late.steps[late.steps.length - 1]).toBeLessThan(120);
    expect(captureSteps(120, { maxSteps: 1800 })).toEqual(late);
  });

  it('names captures after the graph and time, and keeps sizes within 4K', () => {
    expect(captureName('Sunset', 2)).toBe('Sunset · 2 s');
    expect(captureName('Sunset', 3.25)).toBe('Sunset · 3.25 s');
    expect(captureName('Sunset', 12.5)).toBe('Sunset · 12.5 s');
    expect(clampCaptureSize(9000, 10)).toEqual({ w: 3840, h: 16 });
    expect(sizeForAspect(16 / 9)).toEqual({ w: 1920, h: 1080 });
    expect(sizeForAspect(4 / 3)).toEqual({ w: 1440, h: 1080 });
    expect(sizeForAspect(9 / 16)).toEqual({ w: 1080, h: 1920 });
  });
});
