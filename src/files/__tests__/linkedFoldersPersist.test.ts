/**
 * Linked folders are kept: any number of them, linked from anywhere (the Files
 * page's "Link a folder…", a picker's — the Audio engine's), across restarts,
 * in the browser (IndexedDB, one record per folder) and the desktop app (the
 * app's data folder through lf_store_*, faked here like the Rust side). A list
 * read earlier (another window, a link before the list was read) never writes
 * over folders linked elsewhere; the older single-array list is moved over; a
 * folder that isn't there stays in the list as missing.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
});

// The desktop side, as src-tauri/src/linked.rs does it: a list on disk changed one folder at a time.
const disk = vi.hoisted(() => ({ file: null as null | string, roots: [] as string[], present: new Set<string>(), picks: [] as string[], fail: false }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    const read = (): Array<Record<string, unknown>> => (disk.file ? JSON.parse(disk.file).folders : []);
    const write = (l: unknown[]) => { disk.file = JSON.stringify({ version: 1, folders: l }); };
    switch (cmd) {
      case 'lf_store_list': return read();
      case 'lf_store_put': {
        if (disk.fail) throw 'Couldn’t save the linked folders list: disk full';
        const f = args.folder as Record<string, unknown>;
        const l = read();
        const i = l.findIndex(x => x.id === f.id);
        if (i >= 0) l[i] = f; else l.push(f);
        write(l);
        return null;
      }
      case 'lf_store_remove': write(read().filter(x => x.id !== args.id)); return null;
      case 'lf_set_roots': disk.roots = args.roots as string[]; return null;
      case 'lf_probe': return disk.present.has(args.root as string) && disk.roots.includes(args.root as string) ? 'ok' : 'gone';
      case 'lf_watch': case 'lf_unwatch': return null;
      default: throw new Error(`no ${cmd}`);
    }
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => disk.picks.shift() ?? null }));

import {
  addLinkedFolder, desktopListStore, idbListStore, linkFolder, linkedDb, loadLinkedFolders, refreshLinkedFolders, relocateLinkedFolder,
  renameLinkedFolder, resetLinkedForTests, setLinkedListStore, unlinkFolder, useLinkedFolders, type LinkedListStore,
} from '../linkedFolders';

const names = () => useLinkedFolders.getState().folders.map(f => f.name);
const statusOf = (name: string) => { const s = useLinkedFolders.getState(); return s.status[s.folders.find(f => f.name === name)!.id]; };
/** A restart: everything in memory goes; what's saved stays. */
const restart = async () => { resetLinkedForTests(); setLinkedListStore(null); await loadLinkedFolders(); };
const putLegacy = async (list: unknown[]) => {
  const db = (await linkedDb())!;
  await new Promise<void>((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(list, 'folders'); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
};
const getKv = async (key: string) => {
  const db = (await linkedDb())!;
  return new Promise<unknown>((res, rej) => { const t = db.transaction('kv', 'readonly'); const r = t.objectStore('kv').get(key); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); });
};
const desktopFolder = (id: string, name: string, path: string) => ({ id, name, kind: 'samples' as const, backend: 'desktop' as const, path, addedAt: 1 });

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  disk.file = null; disk.roots = []; disk.present = new Set(); disk.picks = []; disk.fail = false;
  resetLinkedForTests();
  setLinkedListStore(null);
});
afterEach(() => { delete g.__TAURI_INTERNALS__; });

describe('browser list (IndexedDB, one record per folder)', () => {
  it('keeps every folder across a restart, and a missing one stays listed', async () => {
    await loadLinkedFolders();
    for (const [n, p] of [['Drums', '/a/Drums'], ['Textures', '/a/Textures'], ['Clips', '/a/Clips']]) await addLinkedFolder({ name: n, backend: 'desktop', path: p });
    await restart();
    expect(names()).toEqual(['Drums', 'Textures', 'Clips']);
    // Not reachable here (no desktop app): listed as missing, not dropped.
    expect(statusOf('Clips')).toBe('missing');
  });

  it('a link made before the list was read joins it instead of replacing it', async () => {
    await loadLinkedFolders();
    await addLinkedFolder({ name: 'One', backend: 'desktop', path: '/one' });
    await addLinkedFolder({ name: 'Two', backend: 'desktop', path: '/two' });
    resetLinkedForTests(); // a fresh start; nothing read yet
    await addLinkedFolder({ name: 'Three', backend: 'desktop', path: '/three' });
    expect(names()).toEqual(['One', 'Two', 'Three']);
    await restart();
    expect(names()).toEqual(['One', 'Two', 'Three']);
  });

  it('a window that read the list earlier doesn’t write over a folder another window linked', async () => {
    await loadLinkedFolders();
    await addLinkedFolder({ name: 'Files page', backend: 'desktop', path: '/files' });
    // Another window (or tab) links one: straight to storage, this window doesn't know.
    await idbListStore().put(desktopFolder('lf_other_abcd', 'Other window', '/other'));
    // This window links one more, and renames its first.
    await addLinkedFolder({ name: 'Audio engine', backend: 'desktop', path: '/engine', kind: 'samples' });
    await renameLinkedFolder(useLinkedFolders.getState().folders[0].id, 'Files page (renamed)');
    await restart();
    expect(names().sort()).toEqual(['Audio engine', 'Files page (renamed)', 'Other window']);
  });

  it('reading the list again picks up other windows’ changes', async () => {
    await loadLinkedFolders();
    await addLinkedFolder({ name: 'Mine', backend: 'desktop', path: '/mine' });
    await idbListStore().put(desktopFolder('lf_other_abcd', 'Theirs', '/theirs'));
    await refreshLinkedFolders();
    expect(names().sort()).toEqual(['Mine', 'Theirs']);
    await idbListStore().remove('lf_other_abcd');
    await refreshLinkedFolders();
    expect(names()).toEqual(['Mine']);
  });

  it('moves the older single-array list over, once', async () => {
    await putLegacy([desktopFolder('lf_a_0001', 'Old A', '/old/a'), desktopFolder('lf_b_0002', 'Old B', '/old/b'), { junk: true }]);
    await restart();
    expect(names()).toEqual(['Old A', 'Old B']);
    expect(await getKv('folders')).toBeUndefined();
    // Unlinked stays unlinked (the old array can't bring it back).
    await unlinkFolder('lf_a_0001');
    await restart();
    expect(names()).toEqual(['Old B']);
  });

  it('opens the database again when its connection was closed', async () => {
    await loadLinkedFolders();
    (await linkedDb())!.close();
    await addLinkedFolder({ name: 'After close', backend: 'desktop', path: '/after' });
    await restart();
    expect(names()).toEqual(['After close']);
  });

  it('a folder that couldn’t be saved stays for the session and is saved on the next try', async () => {
    const real = idbListStore();
    let broken = true;
    const flaky: LinkedListStore = { list: () => real.list(), put: f => (broken ? Promise.reject(new Error('quota')) : real.put(f)), remove: id => real.remove(id) };
    setLinkedListStore(flaky);
    await loadLinkedFolders();
    await addLinkedFolder({ name: 'Unlucky', backend: 'desktop', path: '/unlucky' });
    await refreshLinkedFolders(); // still failing: still listed
    expect(names()).toEqual(['Unlucky']);
    broken = false;
    await refreshLinkedFolders();
    await restart();
    expect(names()).toEqual(['Unlucky']);
  });
});

describe('desktop list (the app’s data folder)', () => {
  beforeEach(() => { g.__TAURI_INTERNALS__ = {}; });

  it('keeps folders linked from the Files page and from the Audio engine across restarts', async () => {
    disk.present = new Set(['/Volumes/pockyun/Kit', '/Users/me/Textures', '/Users/me/Loops']);
    await loadLinkedFolders();
    disk.picks = ['/Volumes/pockyun/Kit', '/Users/me/Textures', '/Users/me/Loops'];
    const a = await linkFolder();                      // Files page: Link a folder…
    const b = await linkFolder({ kind: 'samples' });   // Audio engine picker: Link a folder…
    const c = await linkFolder({ kind: 'samples' });
    expect([a, b, c].every(Boolean)).toBe(true);
    expect(JSON.parse(disk.file!).folders).toHaveLength(3);
    await restart();
    expect(names()).toEqual(['Kit', 'Textures', 'Loops']);
    expect(disk.roots.sort()).toEqual(['/Users/me/Loops', '/Users/me/Textures', '/Volumes/pockyun/Kit']);
    expect(statusOf('Kit')).toBe('connected');
    // The same folder again is the same linked folder.
    disk.picks = ['/Users/me/Loops'];
    expect((await linkFolder())!.id).toBe(c!.id);
    expect(JSON.parse(disk.file!).folders).toHaveLength(3);
  });

  it('moves the list WebKit kept over to the data folder, and drops it there', async () => {
    await putLegacy([desktopFolder('lf_mul2dwch0_kkd6', 'Analogpitch', '/Volumes/pockyun/A'), desktopFolder('lf_mul5e7vy0_qn6l', 'Workshop', '/Volumes/pockyun/B')]);
    disk.present = new Set(['/Volumes/pockyun/B']);
    await restart();
    expect(names()).toEqual(['Analogpitch', 'Workshop']);
    expect(JSON.parse(disk.file!).folders.map((f: { id: string }) => f.id)).toEqual(['lf_mul2dwch0_kkd6', 'lf_mul5e7vy0_qn6l']);
    expect(await getKv('folders')).toBeUndefined();
    // The drive's folder that isn't there is kept, missing, and can be pointed elsewhere (same id).
    expect(statusOf('Analogpitch')).toBe('missing');
    expect(statusOf('Workshop')).toBe('connected');
    disk.present.add('/Volumes/other/A');
    expect(await relocateLinkedFolder('lf_mul2dwch0_kkd6', { backend: 'desktop', path: '/Volumes/other/A' })).toBe(true);
    await restart();
    expect(statusOf('Analogpitch')).toBe('connected');
    expect(useLinkedFolders.getState().folders.find(f => f.id === 'lf_mul2dwch0_kkd6')!.path).toBe('/Volumes/other/A');
  });

  it('a save the disk refused keeps the folder for now and saves it on the next try', async () => {
    disk.present = new Set(['/x']);
    await loadLinkedFolders();
    disk.fail = true;
    disk.picks = ['/x'];
    await linkFolder();
    expect(names()).toEqual(['x']);
    expect(disk.file).toBeNull();
    disk.fail = false;
    await refreshLinkedFolders();
    expect(JSON.parse(disk.file!).folders).toHaveLength(1);
  });

  it('the desktop store on its own: one folder per change', async () => {
    const calls: string[] = [];
    let list: unknown[] = [];
    const s = desktopListStore((async (cmd: string, args?: Record<string, unknown>) => {
      calls.push(cmd);
      if (cmd === 'lf_store_list') return list;
      if (cmd === 'lf_store_put') { list = [...list.filter(f => (f as { id: string }).id !== (args!.folder as { id: string }).id), args!.folder]; return null; }
      return null;
    }) as never);
    await s.put({ ...desktopFolder('a', 'A', '/a'), handle: {} as never });
    expect(list).toEqual([desktopFolder('a', 'A', '/a')]); // no handle on desktop
    expect(calls).toEqual(['lf_store_put']);
  });
});
