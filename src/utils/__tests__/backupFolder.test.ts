/**
 * The backup folder: kept up to date with the library, and never replaced
 * by an empty library (that's when it's needed for Restore).
 */
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

import { backupStatus, backupTesting, backupNow, restoreFromFolder, type Target } from '../backupFolder';

function memFolder(): Target & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files, label: 'mem',
    write: async (p, t) => { files.set(p, t); },
    read: async p => files.get(p) ?? null,
    remove: async p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(`${p}/`)) files.delete(k); },
    list: async d => [...new Set([...files.keys()].filter(k => k.startsWith(`${d}/`)).map(k => k.slice(d.length + 1).split('/')[0]))],
  };
}
const graph = (label: string) => JSON.stringify({ nodes: [{ id: 'n', type: 'output' }], label });

beforeEach(() => store.clear());

describe('backup folder', () => {
  it('writes the library, a daily copy and the readable files, and removes what was deleted', async () => {
    store.set('shader-studio:Sunset', graph('s'));
    store.set('shader-studio:Dawn', graph('d'));
    const folder = memFolder();
    await backupTesting.connect(folder);
    expect(JSON.parse(folder.files.get('library.json')!).items['shader-studio:Sunset']).toBe(graph('s'));
    expect([...folder.files.keys()].some(k => /^history\/library-\d{4}-\d{2}-\d{2}\.json$/.test(k))).toBe(true);
    expect(folder.files.has('graphs/Dawn.json')).toBe(true);
    expect(folder.files.has('README.txt')).toBe(true);
    store.delete('shader-studio:Dawn');
    await backupNow();
    expect(folder.files.has('graphs/Dawn.json')).toBe(false);
    expect(backupStatus().lastBackup).not.toBeNull();
  });

  it('never replaces a backup with an empty library, and restores from it', async () => {
    store.set('shader-studio:Sunset', graph('s'));
    const folder = memFolder();
    await backupTesting.connect(folder);
    const before = folder.files.get('library.json');
    store.clear(); // the browser's data was cleared
    await backupNow(true);
    expect(folder.files.get('library.json')).toBe(before);
    expect(backupStatus().canRestore).toBe(true);
    await restoreFromFolder();
    expect(store.get('shader-studio:Sunset')).toBe(graph('s'));
  });
});
