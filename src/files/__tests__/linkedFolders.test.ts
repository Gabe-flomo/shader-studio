/**
 * Linked folders (docs/linked-folders.md): references, a memory folder
 * standing in for a disk one, resolving (cached, re-read when changed), the
 * missing / disconnected / permission states and relinking, picker filtering,
 * and a .playfile export that carries a linked file's bytes (the import keeps
 * it as library media under the same id).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
});
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
} as Storage;

import { cleanPath, firstFiles, isLinkedRef, linkedName, linkedRef, matchesFilter, mediaKindOf, parseLinkedRef, pickerEntries } from '../linkedRefs';
import {
  addLinkedFolder, linkedProblem, listLinked, memoryLinkedFs, onLinkedChange, reconnectLinkedFolder, recheckLinked, resetLinkedForTests, resolveLinked,
  searchLinked, unlinkFolder, useLinkedFolders, type MemoryLinkedFs,
} from '../linkedFolders';
import { getVideo, hasLibraryVideo, hasVideo, importVideoFiles, listVideos, resetBackgroundCache, videoZipFiles } from '../../lib/backgroundLibrary';
import { videoIdsIn, videoItemsFrom } from '../../playfile/bundle';

const wav = (n: number) => new Uint8Array([0x52, 0x49, 0x46, 0x46, n]);

let fs: MemoryLinkedFs;
let folderId: string;

beforeEach(async () => {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
  resetLinkedForTests();
  fs = memoryLinkedFs({
    'Kicks/kick 10.wav': wav(10),
    'Kicks/kick 2.wav': wav(2),
    'Kicks/notes.txt': 'not a sample',
    'snare.wav': wav(3),
    'Loops/Clip.mp4': wav(4),
    'cover.png': wav(5),
  });
  folderId = (await addLinkedFolder({ name: 'Drum samples', backend: 'memory' }, fs)).id;
});

describe('references', () => {
  it('round-trips a folder and a path, and refuses anything that could leave the folder', () => {
    const ref = linkedRef('lf_abc_12', 'Kicks/808 kick.wav');
    expect(ref).toBe('linked:lf_abc_12/Kicks/808 kick.wav');
    expect(isLinkedRef(ref)).toBe(true);
    expect(parseLinkedRef(ref)).toEqual({ folderId: 'lf_abc_12', path: 'Kicks/808 kick.wav' });
    expect(linkedName(ref)).toBe('808 kick.wav');
    for (const bad of ['linked:lf/../etc/passwd', 'linked:lf//x.wav', 'linked:/x.wav', 'linked:lf', 'linked:l f/x.wav', 'vid_123', 'linked:lf/a\\b.wav', 'linked:lf/./x.wav']) {
      expect(parseLinkedRef(bad), bad).toBeNull();
    }
    expect(() => linkedRef('lf', '../x')).toThrow();
    expect(cleanPath('a/b/c.wav')).toBe('a/b/c.wav');
    expect(cleanPath('a/../c')).toBeNull();
    expect(isLinkedRef('snd_1')).toBe(false);
  });

  it('knows what a file is by its name, for the pickers', () => {
    expect(mediaKindOf('Kick.WAV')).toBe('audio');
    expect(mediaKindOf('clip.mov')).toBe('video');
    expect(mediaKindOf('Inter.woff2')).toBe('font');
    expect(mediaKindOf('photo.jpeg')).toBe('image');
    expect(mediaKindOf('readme.md')).toBeNull();
    expect(matchesFilter('a.png', 'image')).toBe(true);
    expect(matchesFilter('a.png', 'audio')).toBe(false);
    expect(matchesFilter('a.png', 'any')).toBe(true);
    expect(matchesFilter('a.txt', 'any')).toBe(false);
  });
});

describe('browsing a linked folder', () => {
  it('lists one level at a time, folders first, in Finder order', async () => {
    const top = await listLinked(folderId);
    expect(top.map(e => e.name)).toEqual(['Kicks', 'Loops', 'cover.png', 'snare.wav']);
    const kicks = await listLinked(folderId, 'Kicks');
    expect(kicks.map(e => e.path)).toEqual(['Kicks/kick 2.wav', 'Kicks/kick 10.wav', 'Kicks/notes.txt']);
    expect(useLinkedFolders.getState().status[folderId]).toBe('connected');
  });

  it('filters what a picker shows by its type and a search', async () => {
    const top = await listLinked(folderId);
    expect(pickerEntries(top, 'audio').map(e => e.name)).toEqual(['Kicks', 'Loops', 'snare.wav']);
    expect(pickerEntries(top, 'image').map(e => e.name)).toEqual(['Kicks', 'Loops', 'cover.png']);
    expect(pickerEntries(top, 'audio', 'SNA').map(e => e.name)).toEqual(['snare.wav']);
    const found = await searchLinked(folderId, 'kick', 'audio');
    expect(found.complete).toBe(true);
    expect(found.files.map(f => f.path).sort()).toEqual(['Kicks/kick 10.wav', 'Kicks/kick 2.wav']);
    expect((await searchLinked(folderId, '', 'video')).files.map(f => f.path)).toEqual(['Loops/Clip.mp4']);
  });

  it('picks the first sixteen sounds of a folder alphabetically for the pads', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ name: `hit ${20 - i}.wav`, dir: false })).concat([{ name: 'Sub', dir: true }, { name: 'art.png', dir: false }]);
    const got = firstFiles(entries, 'audio', 16);
    expect(got).toHaveLength(16);
    expect(got[0].name).toBe('hit 1.wav');
    expect(got[15].name).toBe('hit 16.wav');
  });
});

describe('resolving a linked file', () => {
  it('reads it from the folder, keeps it for the session, and reads again when it changed', async () => {
    const ref = linkedRef(folderId, 'snare.wav');
    const a = await resolveLinked(ref);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.name).toBe('snare.wav');
    expect(a.type).toBe('audio/wav');
    expect([...new Uint8Array(await a.blob.arrayBuffer())]).toEqual([...wav(3)]);
    const b = await resolveLinked(ref);
    expect(b.ok && b.blob).toBe(a.blob); // the same copy

    const seen: (string[] | null)[] = [];
    const off = onLinkedChange(r => seen.push(r));
    fs.put('snare.wav', wav(33));
    expect(await recheckLinked()).toEqual([ref]);
    expect(seen).toContainEqual([ref]);
    const c = await resolveLinked(ref);
    expect(c.ok && [...new Uint8Array(await c.blob.arrayBuffer())]).toEqual([...wav(33)]);
    off();
  });

  it('tells a missing file from a disconnected folder and a folder that needs permission', async () => {
    const ref = linkedRef(folderId, 'snare.wav');
    fs.remove('snare.wav');
    expect(await resolveLinked(ref)).toEqual({ ok: false, reason: 'file' });
    expect(linkedProblem(ref)).toBe('file');
    fs.put('snare.wav', wav(3));
    fs.setGone(true);
    expect(await resolveLinked(ref)).toEqual({ ok: false, reason: 'folder' });
    expect(useLinkedFolders.getState().status[folderId]).toBe('missing');
    fs.setGone(false);
    fs.setPermission(false);
    expect(await resolveLinked(ref)).toEqual({ ok: false, reason: 'permission' });
    expect(useLinkedFolders.getState().status[folderId]).toBe('permission');
    // Relink: one click to allow it again.
    expect(await reconnectLinkedFolder(folderId)).toBe('connected');
    expect((await resolveLinked(ref)).ok).toBe(true);
    expect(linkedProblem(ref)).toBeNull();
    expect(await resolveLinked('linked:lf_nope/x.wav')).toEqual({ ok: false, reason: 'folder' });
    expect(await resolveLinked('linked:bad')).toEqual({ ok: false, reason: 'bad' });
  });

  it('unlinking leaves the disk alone and has an undo', async () => {
    const ref = linkedRef(folderId, 'snare.wav');
    const undo = await unlinkFolder(folderId);
    expect(useLinkedFolders.getState().folders).toEqual([]);
    expect(await resolveLinked(ref)).toEqual({ ok: false, reason: 'folder' });
    expect(fs.files.has('snare.wav')).toBe(true);
    await undo!();
    expect((await resolveLinked(ref)).ok).toBe(true);
  });
});

describe('the library reads linked ids without copying them', () => {
  it('getVideo and hasVideo read the folder; nothing lands in the library', async () => {
    const ref = linkedRef(folderId, 'Loops/Clip.mp4');
    const v = await getVideo(ref);
    expect(v).toMatchObject({ id: ref, name: 'Clip.mp4', type: 'video/mp4', bytes: 5 });
    expect(await hasVideo(ref)).toBe(true);
    expect(await hasLibraryVideo(ref)).toBe(false);
    expect(await listVideos()).toEqual([]);
    fs.remove('Loops/Clip.mp4');
    expect(await getVideo(ref)).toBeNull();
    expect(await hasVideo(ref)).toBe(false);
  });

  it('a .playfile export carries the bytes; the import keeps them as library media under the same id', async () => {
    const ref = linkedRef(folderId, 'Kicks/kick 2.wav');
    const setup = JSON.stringify({ layers: [{ kind: 'drumpad', pads: [{ sampleId: ref, fileName: 'kick 2.wav' }] }] });
    const ids = videoIdsIn([{ kind: 'play', name: 'Kit', data: setup }]);
    expect(ids).toEqual([ref]);
    const files = await videoZipFiles(ids);
    const items = videoItemsFrom(files);
    expect(items).toHaveLength(1);
    expect(items[0].meta).toMatchObject({ id: ref, type: 'audio/wav' });
    expect([...(items[0].data as Uint8Array)]).toEqual([...wav(2)]);

    // Elsewhere: no such folder. The import keeps the file in the library under the ref.
    await unlinkFolder(folderId);
    expect(await getVideo(ref)).toBeNull();
    const r = await importVideoFiles(files);
    expect(r.added).toBe(1);
    expect(await hasLibraryVideo(ref)).toBe(true);
    const got = await getVideo(ref);
    expect(got && [...new Uint8Array(await got.blob.arrayBuffer())]).toEqual([...wav(2)]);
  });

  it('a library ZIP (every kept video) leaves linked files out: they are references', async () => {
    const files = await videoZipFiles();
    expect(Object.keys(files)).toEqual([]);
  });
});

describe('setups keep linked references', () => {
  it('a Background video and image keep their linked ref; exports find the video', async () => {
    const { parseBackgroundItems } = await import('../../types/playLayers');
    const { parseDisplay } = await import('../../types/play');
    const video = linkedRef('lf_a1', 'Clips/A long folder name/clip one.mp4');
    const items = parseBackgroundItems([
      { id: 's1', kind: 'video', name: 'clip one.mp4', src: '', bytes: 99, libraryId: video },
      { id: 's2', kind: 'image', name: 'Sunset', src: 'data:image/png;base64,AAAA', libraryId: linkedRef('lf_a1', 'Pictures/Sunset.png') },
      { id: 's3', kind: 'video', name: 'x.mp4', src: '', bytes: 1, libraryId: 'vid_123' },
    ]);
    expect(items[0].libraryId).toBe(video);
    expect(items[1].libraryId).toBe('linked:lf_a1/Pictures/Sunset.png');
    expect(items[2].libraryId).toBeUndefined(); // only linked videos name a file this way
    const d = parseDisplay({ source: 'video', video: { name: 'clip one.mp4', src: '', bytes: 99, loop: true, muted: true, rate: 1, libraryId: video } });
    expect(d?.video?.libraryId).toBe(video);

    const setup = JSON.stringify({ display: d, layers: [{ kind: 'background', sources: items }] });
    // Inside a library snapshot the JSON is escaped once more: found there too; the image (embedded) is not.
    expect(videoIdsIn([{ kind: 'play', name: 'A', data: setup }])).toEqual([video]);
    expect(videoIdsIn([{ kind: 'library', name: 'L', data: JSON.stringify({ x: setup }) }])).toEqual([video]);
  });

  it('a Text layer font can be a linked file (the kit reads it through the app)', async () => {
    const { klParseFontUrl } = await import('../../play/kit/fonts.js');
    expect(klParseFontUrl('linked:lf_a1/Fonts/Space Grotesk.woff2')).toEqual({ family: 'SS Space Grotesk', file: 'linked:lf_a1/Fonts/Space Grotesk.woff2' });
    expect(klParseFontUrl('linked:lf_a1/readme.txt')).toBeNull();
  });
});
