/**
 * The Video layer's follow-ups (docs/video-layer.md): the library's videos
 * (posters, rename, delete with undo, which setups use them), in library
 * ZIPs, the Files page, the workspace folder and the backup folder; the
 * offline mix of a video layer's sound; and files dropped on the preview or
 * the Layers panel becoming layers.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';

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
  addVideoFile, findVideosManifest, getVideo, importVideoFiles, listVideos, removeVideo, renameVideo, resetBackgroundCache, videoExt, videoMimeOf, videoZipFiles,
  VIDEOS_MANIFEST,
} from '../../lib/backgroundLibrary';
import { countVideoRefs, describeVideoUses, videoUses } from '../../lib/videoUsage';
import { askVideosInZip, videoFilesForZip } from '../../utils/libraryVideos';
import { buildLibraryZip, takeSnapshot } from '../../utils/library';
import { buildInventory } from '../../files/inventory';
import { localMutableKV } from '../../files/mutate';
import { listExternal } from '../../files/sources';
import { cleanupSuggestions } from '../../files/cleanup';
import { removalWarnings } from '../../files/mutate';
import { videosSource } from '../../files/videosSource';
import { decodeAreas, encodeTree, type ImageMeta, type ImageStore } from '../../workspace/layout';
import { memoryFs } from '../../workspace/fs';
import { newState, SyncEngine } from '../../workspace/engine';
import { memoryKV } from '../../files/mutate';
import { backupTesting, restoreFromFolder, type Target } from '../../utils/backupFolder';
import { videoTrackOf, videoTrackPlan } from '../../lib/recordingAudio';
import { defaultLayer, emptyPlayRecord, type PlayRecord, type VideoLayer } from '../../types/play';
import { dropPlaces, mediaFiles, mediaKind } from '../layerDrop';
import { layerNameOf, layersFromFiles, type DropMakers } from '../../components/play/dropLayers';

const webm = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'video/webm' });
const POSTER = { thumb: 'data:image/jpeg;base64,AA==', width: 640, height: 360, duration: 4.5 };

function freshBrowser() {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
}
beforeEach(freshBrowser);

const video = (over: Partial<VideoLayer> = {}): VideoLayer => ({ ...(defaultLayer('video', 'v1', 'Clip') as VideoLayer), ...over });
const setupWith = (layers: VideoLayer[]): string => JSON.stringify({ nodes: [{ id: 'o', type: 'output' }], version: 1, savedAt: 1, play: { ...emptyPlayRecord(), layers } });

describe('the library’s videos', () => {
  it('keeps a poster, size and length with each; renames; deletes with undo', async () => {
    const a = await addVideoFile(webm(1, 2, 3), { name: 'Waves.webm', poster: POSTER });
    expect(a).toMatchObject({ name: 'Waves.webm', type: 'video/webm', bytes: 3, ...POSTER });
    await renameVideo(a.id, 'Big waves');
    expect((await listVideos())[0].name).toBe('Big waves');
    const undo = await removeVideo(a.id);
    expect(await listVideos()).toEqual([]);
    await undo!();
    expect(await getVideo(a.id)).toMatchObject({ name: 'Big waves', thumb: POSTER.thumb });
    expect(await removeVideo('vid_nope')).toBeNull();
  });

  it('knows a video’s type from its name when the file doesn’t say, and its extension from the type', async () => {
    const m = await addVideoFile(Object.assign(new Blob([new Uint8Array([1])]), { name: 'clip.MOV' }));
    expect(m.type).toBe('video/quicktime');
    expect(videoMimeOf('a.m4v')).toBe('video/x-m4v');
    expect(videoExt('video/webm;codecs=vp9')).toBe('webm');
    expect(videoExt('video/who-knows')).toBe('mp4');
  });

  it('says which setups use a video: saved graphs, presentations and the open graph', async () => {
    const a = await addVideoFile(webm(1), { name: 'A' });
    const b = await addVideoFile(webm(2, 2), { name: 'B' });
    store.set('shader-studio:Sea', setupWith([video({ id: 'l1', videoId: a.id }), video({ id: 'l2', videoId: a.id })]));
    store.set('shader-studio-presentation:Talk', JSON.stringify({ title: 'Talk', sources: [{ bundle: { play: { layers: [{ kind: 'video', videoId: a.id }] } } }] }));
    store.set('shader-studio:Open one', setupWith([video({ videoId: b.id })]));
    const kv = { keys: () => [...store.keys()], get: (k: string) => store.get(k) ?? null };
    // The open graph counts as it is on screen (here: no longer using B).
    const uses = videoUses([a.id, b.id], kv, { name: 'Open one', layers: [video({ id: 'l9', videoId: a.id })] });
    expect(uses.get(a.id)).toEqual([
      { kind: 'open', label: 'Open one', layers: 1 },
      { kind: 'graph', label: 'Sea', layers: 2 },
      { kind: 'presentation', label: 'Talk', layers: 1 },
    ]);
    expect(uses.get(b.id)).toEqual([]);
    expect(describeVideoUses(uses.get(a.id)!)).toBe('4 Video layers in the open graph (“Open one”), “Sea”, the presentation “Talk” use it.');
    expect(countVideoRefs(store.get('shader-studio:Sea')!, a.id)).toBe(2);
  });
});

describe('videos in ZIPs', () => {
  it('a library ZIP carries them and an import brings them back with their ids', async () => {
    const a = await addVideoFile(webm(1, 2, 3), { name: 'Waves.webm', poster: POSTER });
    await addVideoFile(webm(4), { name: 'Waves' });
    store.set('shader-studio:Sea', setupWith([video({ videoId: a.id })]));
    const got = await videoFilesForZip(await askVideosInZip());
    expect(got!.count).toBe(2);
    expect(Object.keys(got!.files).sort()).toEqual([VIDEOS_MANIFEST, 'backgrounds/videos/Waves (2).webm', 'backgrounds/videos/Waves.webm'].sort());
    const zip = buildLibraryZip(takeSnapshot(), undefined, got!.files);
    freshBrowser();
    const files = unzipSync(zip);
    expect(await importVideoFiles(files)).toEqual({ added: 2, same: 0, skipped: 0 });
    const back = await getVideo(a.id);
    expect(back).toMatchObject({ name: 'Waves.webm', bytes: 3, ...POSTER });
    expect([...new Uint8Array(await back!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(await importVideoFiles(files)).toEqual({ added: 0, same: 2, skipped: 0 });
  });

  it('asks before putting big videos in a ZIP: include, leave out, or call it off', async () => {
    await addVideoFile(webm(1, 2, 3, 4), { name: 'Big' });
    expect(await askVideosInZip(async () => 'x', 100)).toBe('all');
    const ask = vi.fn(async (title: string) => (title ? 'none' : null));
    expect(await askVideosInZip(ask, 2)).toBe('none');
    expect(ask.mock.calls[0]?.[0]).toBe('Include 1 video (4 B)?');
    expect(await videoFilesForZip('none')).toEqual({ files: {}, count: 0 });
    expect(await askVideosInZip(async () => null, 2)).toBeNull();
    expect(await videoFilesForZip(null)).toBeNull();
  });

  it('names files by id for folders written again and again, and finds the manifest under a ZIP’s root folder', async () => {
    const a = await addVideoFile(webm(7), { name: 'Clip' });
    const files = await videoZipFiles(null, { naming: 'id' });
    expect(Object.keys(files)).toContain(`backgrounds/videos/${a.id}.webm`);
    const nested = Object.fromEntries(Object.entries(files).map(([p, b]) => [`Library 2026/${p}`, b]));
    expect(findVideosManifest(nested)?.root).toBe('Library 2026/backgrounds/');
    freshBrowser();
    expect((await importVideoFiles(nested)).added).toBe(1);
  });
});

describe('videos on the Files page', () => {
  it('lists them under Backgrounds → Videos, knows the layers that use one (removing it breaks them), and offers the unused for clean-up', async () => {
    const a = await addVideoFile(webm(1, 2), { name: 'Used', poster: POSTER });
    const b = await addVideoFile(webm(3), { name: 'Spare' });
    store.set('shader-studio:Sea', setupWith([video({ videoId: a.id })]));
    const inv = await buildInventory(localMutableKV, { external: await listExternal([videosSource]) });
    const used = inv.byId.get(`ext:videos:${a.id}`)!;
    expect(used).toMatchObject({ size: 2, detail: '640×360 · 0:05 · WebM', thumb: POSTER.thumb });
    expect(used.usedBy).toEqual([{ id: 'graph:Sea', label: 'Sea', where: 'A Video layer in its Play setup', breaks: true }]);
    expect(removalWarnings([used]).breaks).toEqual(['“Sea” (A Video layer in its Play setup) loses “Used”']);
    expect(inv.byId.get(`ext:videos:${b.id}`)!.unused).toBe('No saved Play setup or presentation uses it');
    expect(cleanupSuggestions(inv).find(g => g.kind === 'unused')!.items.map(s => s.label)).toEqual(['Spare']);
  });

  it('carries chosen videos in a ZIP, previews and installs them, and removes with undo', async () => {
    const a = await addVideoFile(webm(1, 2), { name: 'One' });
    await addVideoFile(webm(3), { name: 'Two' });
    const files = await videosSource.zipFiles([a.id]);
    expect(JSON.parse(strFromU8(files[VIDEOS_MANIFEST])).videos.map((v: { id: string }) => v.id)).toEqual([a.id]);
    expect(await videosSource.preview(files)).toEqual([{ id: a.id, label: 'One', size: 2, status: 'same' }]);
    const undo = await videosSource.remove([a.id]);
    expect((await listVideos()).map(v => v.name)).toEqual(['Two']);
    await undo();
    expect((await listVideos()).length).toBe(2);
    expect(await videosSource.install(files, 'replace')).toEqual({ added: 1, same: 0 });
    expect((await listVideos()).map(v => v.name)).toEqual(['One']);
  });
});

function memoryVideos(init: Array<[ImageMeta, Uint8Array]> = []): ImageStore & { data: Map<string, { meta: ImageMeta; bytes: Uint8Array }> } {
  const data = new Map(init.map(([m, b]) => [m.id, { meta: { ...m, bytes: b.length }, bytes: b }]));
  return {
    data,
    async list() { return [...data.values()].map(x => x.meta); },
    async read(id) { return data.get(id)?.bytes ?? null; },
    async put(meta, bytes) { data.set(meta.id, { meta: { ...meta, bytes: bytes.length }, bytes }); },
    async rename(id, name) { const x = data.get(id); if (x) x.meta = { ...x.meta, name }; },
    async remove(id) { data.delete(id); },
  };
}
const vid = (id: string, name: string, n = 3): [ImageMeta, Uint8Array] => [{ id, name, type: 'video/mp4', width: 1280, height: 720, createdAt: 1, bytes: n, duration: 2 }, new Uint8Array(n).fill(5)];

describe('videos in the workspace folder', () => {
  it('are real files beside a list, and come back the same', async () => {
    const videos = memoryVideos([vid('vid_1', 'Waves')]);
    const enc = await encodeTree(memoryKV({}), null, undefined, videos);
    expect([...enc.tree.keys()].sort()).toEqual(['backgrounds/videos.json', 'backgrounds/videos/vid_1.mp4']);
    expect(JSON.parse(enc.tree.get('backgrounds/videos.json')!.text!)).toEqual({ kind: 'shader-studio-videos', version: 1, videos: [{ id: 'vid_1', name: 'Waves', file: 'videos/vid_1.mp4', type: 'video/mp4', width: 1280, height: 720, duration: 2, createdAt: 1 }] });
    const ch = decodeAreas(['backgrounds'], enc.tree, memoryKV({}), { keys: new Map(), images: new Map(), videos: new Map() });
    expect(ch.videos.put.map(p => p.meta)).toEqual([{ id: 'vid_1', name: 'Waves', type: 'video/mp4', width: 1280, height: 720, duration: 2, createdAt: 1, bytes: 0 }]);
    expect(ch.images.put).toEqual([]);
    // An app without a video store leaves the folder's videos alone.
    expect(decodeAreas(['backgrounds'], enc.tree, memoryKV({}), { keys: new Map(), images: new Map() }).videos.put).toEqual([]);
  });

  it('sync both ways: a video dropped in the folder comes in, one deleted here goes', async () => {
    const kv = memoryKV({});
    const videos = memoryVideos([vid('vid_1', 'Waves')]);
    const fs = memoryFs();
    const e = new SyncEngine({ kv, fs, images: null, videos, state: newState('w1'), saveState: async () => {}, now: () => fs.clock.now });
    await e.sync();
    expect(fs.files.has('backgrounds/videos/vid_1.mp4')).toBe(true);
    fs.put('backgrounds/videos/Holiday.mov', new Uint8Array([9, 9]));
    await e.sync();
    expect(videos.data.get('Holiday')?.meta).toMatchObject({ name: 'Holiday', type: 'video/quicktime', bytes: 2 });
    await videos.remove('vid_1');
    await e.sync();
    expect(fs.files.has('backgrounds/videos/vid_1.mp4')).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('backgrounds/videos.json')!.data)).videos.map((x: { id: string }) => x.id)).toEqual(['Holiday']);
  });
});

describe('videos in the backup folder', () => {
  function memFolder(): Target & { files: Map<string, string | Uint8Array> } {
    const files = new Map<string, string | Uint8Array>();
    return {
      files, label: 'mem',
      write: async (p, t) => { files.set(p, t); },
      read: async p => { const v = files.get(p); return typeof v === 'string' ? v : null; },
      remove: async p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(`${p}/`)) files.delete(k); },
      list: async d => [...new Set([...files.keys()].filter(k => k.startsWith(`${d}/`)).map(k => k.slice(d.length + 1).split('/')[0]))],
      writeBytes: async (p, b) => { files.set(p, b); },
      readBytes: async p => { const v = files.get(p); return v == null ? null : typeof v === 'string' ? new TextEncoder().encode(v) : v; },
    };
  }

  it('writes each video once, by id, and restores them', async () => {
    store.set('shader-studio:Sea', setupWith([]));
    const a = await addVideoFile(webm(1, 2, 3), { name: 'Waves' });
    const folder = memFolder();
    await backupTesting.connect(folder);
    expect(folder.files.get(`backgrounds/videos/${a.id}.webm`)).toEqual(new Uint8Array([1, 2, 3]));
    expect(JSON.parse(folder.files.get(VIDEOS_MANIFEST) as string).videos[0]).toMatchObject({ id: a.id, file: `videos/${a.id}.webm` });
    freshBrowser();
    store.set('shader-studio:Sea', setupWith([]));
    await restoreFromFolder();
    expect((await listVideos()).map(v => v.id)).toEqual([a.id]);
  });
});

describe('a video layer’s sound in an offline render', () => {
  const layer = (over: Partial<VideoLayer> = {}) => video({ sound: 'play', videoId: 'vid_1', volume: 0.5, ...over });
  const file = { blob: webm(1), duration: 10 };

  it('only Play layers with an open file are mixed (Listen is analysed, never heard)', () => {
    expect(videoTrackOf(layer(), file)).toMatchObject({ key: 'vlayer:v1', clock: true, video: { volume: 0.5, duration: 10, playing: true, loop: true } });
    expect(videoTrackOf(layer({ sound: 'listen' }), file)).toBeNull();
    expect(videoTrackOf(layer({ sound: 'off' }), file)).toBeNull();
    expect(videoTrackOf(layer(), null)).toBeNull();
  });

  it('starts where the picture is at the export’s first frame, at the layer’s speed', () => {
    const v = { duration: 10, playing: true, loop: true, speed: 2, start: 1, volume: 0.8 };
    // Clock 3 s: 1 + 3 × 2 = 7 s into the video.
    expect(videoTrackPlan(v, 10, 3, 5)).toEqual({ offset: 7, rate: 2, gain: 0.8, loop: true, loopEnd: 10, stopAt: null });
    // Looping past the end wraps.
    expect(videoTrackPlan(v, 10, 6, 5)!.offset).toBeCloseTo(3);
  });

  it('without Loop it stops at the video’s end; paused or silent, nothing', () => {
    const v = { duration: 10, playing: true, loop: false, speed: 1, start: 0, volume: 1 };
    expect(videoTrackPlan(v, 10, 8, 5)).toEqual({ offset: 8, rate: 1, gain: 1, loop: false, loopEnd: 10, stopAt: 2 });
    expect(videoTrackPlan(v, 10, 2, 5)!.stopAt).toBeNull();
    expect(videoTrackPlan(v, 10, 12, 5)).toBeNull();
    expect(videoTrackPlan({ ...v, playing: false }, 10, 0, 5)).toBeNull();
    expect(videoTrackPlan({ ...v, volume: 0 }, 10, 0, 5)).toBeNull();
    // A sound shorter than the picture ends with the sound.
    expect(videoTrackPlan(v, 4, 1, 5)).toMatchObject({ offset: 1, stopAt: 3, loopEnd: 4 });
  });
});

describe('dropping files onto Play', () => {
  const f = (name: string, type: string) => new File([new Uint8Array([1])], name, { type });

  it('takes images and videos, by type or by name', () => {
    expect(mediaKind(f('a.png', 'image/png'))).toBe('image');
    expect(mediaKind(f('a.webm', ''))).toBe('video');
    expect(mediaKind(f('a.mov', 'application/octet-stream'))).toBe('video');
    expect(mediaKind(f('notes.txt', 'text/plain'))).toBeNull();
    expect(mediaFiles([f('a.png', 'image/png'), f('b.txt', 'text/plain'), f('c.mp4', 'video/mp4')]).map(x => x.name)).toEqual(['a.png', 'c.mp4']);
  });

  it('places several a little apart from the drop point, inside the picture', () => {
    expect(dropPlaces(3, { x: 0.2, y: 0.8 })).toEqual([{ x: 0.2, y: 0.8 }, { x: 0.24, y: 0.76 }, { x: 0.28, y: 0.72 }]);
    expect(dropPlaces(1, null)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(dropPlaces(2, { x: 0.99, y: 0.01 })[1]).toEqual({ x: 0.98, y: 0.02 });
    expect(layerNameOf('My holiday clip.final.mp4', 'Video')).toBe('My holiday clip.final');
  });

  it('makes an Image layer per image and a Video layer per video, where they landed', async () => {
    const make: DropMakers = {
      imageSrc: async file => (file.name === 'broken.png' ? null : 'data:image/png;base64,AA=='),
      video: async file => ({ videoId: 'vid_9', fileName: file.name, bytes: file.size, kept: false }),
    };
    const r = await layersFromFiles([f('sky.png', 'image/png'), f('readme.txt', 'text/plain'), f('waves.webm', 'video/webm'), f('broken.png', 'image/png')], { x: 0.3, y: 0.6 }, make);
    expect(r.failed).toEqual(['broken.png']);
    expect(r.sessionOnly).toBe(1);
    expect(r.layers.map(l => [l.kind, l.label])).toEqual([['image', 'sky'], ['video', 'waves']]);
    expect(r.layers[0]).toMatchObject({ src: 'data:image/png;base64,AA==', x: 0.3, y: 0.6 });
    expect(r.layers[1]).toMatchObject({ videoId: 'vid_9', fileName: 'waves.webm', bytes: 1, x: 0.34, y: 0.56, sound: 'off' });
    const next: PlayRecord = { ...emptyPlayRecord(), layers: r.layers };
    expect(next.layers).toHaveLength(2);
  });
});

// A ZIP made elsewhere (only the videos part) reads the same way.
describe('a ZIP of just videos', () => {
  it('imports from zipSync output', async () => {
    const a = await addVideoFile(webm(1), { name: 'Only' });
    const files = await videoZipFiles();
    freshBrowser();
    const zip = unzipSync(zipSync(files));
    expect((await importVideoFiles(zip)).added).toBe(1);
    expect((await listVideos())[0].id).toBe(a.id);
  });
});
