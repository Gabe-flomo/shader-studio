/**
 * Splat scans in the library (lib/splats/library.ts): kept in the videos store under their own type, left out of
 * video lists, found by a graph's `videoId` so .playfile bundles carry them, round-tripped through a library ZIP; plus
 * the worker's load / pack / sort on this thread, and a saved graph reloaded with its scan reference.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { importVideoFiles, listVideos, resetBackgroundCache, videoExt, videoZipFiles } from '../../backgroundLibrary';
import { addSplatFile, getSplatFile, listSplats, splatFileProblem, MAX_SPLAT_FILE_BYTES } from '../library';
import { writePly, writeSplat } from '../format';
import { videoIdsIn } from '../../../playfile/bundle';
import { handleSplatRequest, type SplatRequest } from '../workerCore';
import { ringScan } from './fixtures';
import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';

function freshBrowser() {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
}
beforeEach(freshBrowser);

const file = (data: Uint8Array, name: string) => Object.assign(new Blob([data.slice().buffer as ArrayBuffer]), { name });

describe('splat files in the library', () => {
  it('keeps a scan by reference with its own type, out of the video lists', async () => {
    const meta = await addSplatFile(file(writePly(ringScan(30)), 'Ring.ply'));
    expect(meta.type).toBe('model/x-splat-ply');
    expect(meta.id.startsWith('splat_')).toBe(true);
    expect(meta.thumb).toBe('');
    expect((await listSplats()).map(m => m.id)).toEqual([meta.id]);
    expect(await listVideos()).toEqual([]);
    expect((await listVideos({ withSplats: true })).map(m => m.id)).toEqual([meta.id]);
    const back = await getSplatFile(meta.id);
    expect(back!.bytes).toBe(meta.bytes);
    expect(videoExt(meta.type)).toBe('ply');
  });

  it('the same file again reuses its record', async () => {
    const a = await addSplatFile(file(writeSplat(ringScan(10)), 'r.splat'));
    const b = await addSplatFile(file(writeSplat(ringScan(10)), 'r.splat'));
    expect(b.id).toBe(a.id);
  });

  it('refuses what it can’t read, with a sentence, before storing anything', async () => {
    expect(await splatFileProblem(file(new Uint8Array(0), 'a.splat'))).toMatch(/empty/);
    expect(await splatFileProblem(file(new Uint8Array(8), 'a.obj'))).toMatch(/isn’t a splat scan/);
    expect(await splatFileProblem(file(new Uint8Array(8), 'a.ksplat'))).toMatch(/ksplat/);
    const huge = { size: MAX_SPLAT_FILE_BYTES + 1, name: 'big.ply', slice: () => new Blob([]) } as unknown as Blob & { name: string };
    expect(await splatFileProblem(huge)).toMatch(/takes up to/);
    await expect(addSplatFile(file(new Uint8Array(8), 'a.obj'))).rejects.toThrow(/isn’t a splat scan/);
    expect(await listSplats()).toEqual([]);
  });

  it('travels in a library ZIP and comes back under the same id and type', async () => {
    const meta = await addSplatFile(file(writeSplat(ringScan(12)), 'Ring.splat'));
    const zip = await videoZipFiles([meta.id]);
    expect(Object.keys(zip).some(k => k.endsWith('.splat'))).toBe(true);
    freshBrowser();
    const r = await importVideoFiles(zip);
    expect(r.added).toBe(1);
    const again = await listSplats();
    expect(again[0]).toMatchObject({ id: meta.id, type: 'model/x-splat-splat' });
  });

  it('a graph names its scan by videoId, so a .playfile carries the file', async () => {
    const meta = await addSplatFile(file(writeSplat(ringScan(12)), 'Ring.splat'));
    const scan = n('splatScene', 'scan', 0, 0, { videoId: meta.id, fileName: 'Ring.splat', bytes: meta.bytes });
    const graph = { nodes: [scan, n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] })] };
    const text = JSON.stringify(graph);
    expect(videoIdsIn([{ kind: 'graph', name: 'g', data: text }])).toEqual([meta.id]);
    // Saved and loaded: the same reference, and it compiles.
    const loaded = JSON.parse(text) as typeof graph;
    expect(loaded.nodes[0].params.videoId).toBe(meta.id);
    expect(compileGraph(loaded).success).toBe(true);
  });
});

describe('the worker’s work (on this thread)', () => {
  const ask = (m: SplatRequest) => new Promise<Record<string, unknown>>(res => handleSplatRequest(m, msg => res(msg as Record<string, unknown>)));

  it('loads, lays out up to Max splats, sorts, re-packs and drops', async () => {
    const ring = ringScan(500, 1, [0, 0, 0], 2);
    const bytes = writePly(ring);
    const r = await ask({ op: 'load', id: 1, key: 'k', bytes: bytes.buffer as ArrayBuffer, name: 'r.ply', max: 200, sh: 1 });
    expect(r.ok).toBe(true);
    expect((r.info as { count: number }).count).toBe(500);
    expect((r.packed as { count: number; shDegree: number }).count).toBe(200);
    expect((r.packed as { shDegree: number }).shDegree).toBe(1);
    expect((r.thumb as Uint8ClampedArray).length).toBe(160 * 90 * 4);
    const s = await ask({ op: 'sort', id: 2, key: 'k', axis: [0, 0, 1] });
    expect((s.order as Uint32Array).length).toBe(200);
    const p = await ask({ op: 'pack', id: 3, key: 'k', max: 1000, sh: 0 });
    expect((p.packed as { count: number; shDegree: number })).toMatchObject({ count: 500, shDegree: 0 });
    await ask({ op: 'drop', id: 4, key: 'k' });
    const gone = await ask({ op: 'sort', id: 5, key: 'k', axis: [0, 0, 1] });
    expect(gone.ok).toBe(false);
  });

  it('a broken file comes back as a plain error', async () => {
    const r = await ask({ op: 'load', id: 1, key: 'bad', bytes: new Uint8Array(33).buffer, name: 'x.splat', max: 10, sh: 0 });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/32-byte/);
  });
});
