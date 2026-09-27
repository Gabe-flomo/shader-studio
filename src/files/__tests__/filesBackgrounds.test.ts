/**
 * The Files page with the backgrounds library: image backgrounds (IndexedDB,
 * fake-indexeddb here) in the inventory with their folders and what uses
 * them, unused ones in clean-up, removed with Undo, downloaded one by one in
 * the library's own ZIP layout, and installed back (merge and replace).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

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

import { addImage, IMAGE_FOLDER_SCOPE, importBackgroundFiles, listImages, resetBackgroundCache } from '../../lib/backgroundLibrary';
import { createFolder, moveItemsToFolder } from '../../utils/assetFolders';
import { readLibrary } from '../../utils/library';
import { buildInventory, type Inventory } from '../inventory';
import { cleanupSuggestions } from '../cleanup';
import { expandRemoval, localMutableKV, removeNodes } from '../mutate';
import { buildProfileZip, everythingSnapshot, externalPart, installMerge, installReplace, installSources, previewInstall, readProfile, selectionSnapshot } from '../profileZip';
import { listExternal, removeExternal } from '../sources';
import { backgroundsSource } from '../backgroundsSource';

const sources = [backgroundsSource];
const png = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/png' });

function freshBrowser() {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
}
beforeEach(freshBrowser);

/** Two images (one in a folder) and a graph whose Play setup embedded the first. */
async function seed() {
  const sky = await addImage(png(1, 2, 3, 4), { name: 'Night sky', width: 1920, height: 1080, thumb: 'data:image/jpeg;base64,AA==' });
  const ink = await addImage(png(9, 9), { name: 'Ink wash', width: 800, height: 600, thumb: 'x' });
  const f = createFolder(IMAGE_FOLDER_SCOPE, 'Skies');
  moveItemsToFolder(IMAGE_FOLDER_SCOPE, [sky.id], f.id);
  localStorage.setItem('shader-studio:Aurora', JSON.stringify({
    nodes: [{ id: 'o', type: 'output' }], version: 1, savedAt: 1,
    play: { version: 1, controls: [], mappings: [], layers: [], display: { picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'Night sky', src: 'data:image/jpeg;base64,AA', libraryId: sky.id } } },
  }));
  localStorage.setItem('shader-studio-backgrounds:palettes', JSON.stringify([{ id: 'pal_1', name: 'Dusk', stops: [{ at: 0, colour: [1, 0, 0] }], style: 'gradient', createdAt: 2 }]));
  return { sky, ink };
}

const build = async () => buildInventory(localMutableKV, { external: await listExternal(sources) });
const node = (i: Inventory, id: string) => { const n = i.byId.get(id); if (!n) throw new Error(`no ${id}`); return n; };

describe('backgrounds in Files', () => {
  it('lists images in their folders with sizes, next to palettes, and knows what uses each', async () => {
    const { sky, ink } = await seed();
    const i = await build();
    const bg = node(i, 'section:backgrounds');
    expect(bg.children!.map(c => c.label)).toEqual(['Images', 'Palettes']);
    const images = node(i, 'section:backgrounds/ext:backgrounds');
    expect(images.children!.map(c => c.label)).toEqual(['Skies', 'Ink wash']);
    const skyNode = node(i, `ext:backgrounds:${sky.id}`);
    expect(skyNode).toMatchObject({ size: 4, detail: '1920×1080 · PNG', membership: { scope: IMAGE_FOLDER_SCOPE, id: sky.id } });
    expect(skyNode.usedBy).toEqual([{ id: 'graph:Aurora', label: 'Aurora', where: 'Its Play setup (a copy)' }]);
    expect(node(i, `ext:backgrounds:${ink.id}`).unused).toBe('No Play setup or presentation uses it');
    expect(i.external).toBe(6);
    const unused = cleanupSuggestions(i).find(g => g.kind === 'unused')!.items;
    expect(unused.map(s => s.label)).toEqual(['Ink wash']);
  });

  it('removes an image with Undo', async () => {
    const { ink } = await seed();
    const i = await build();
    const res = removeNodes(localMutableKV, expandRemoval(i, [`ext:backgrounds:${ink.id}`]));
    expect(res.external).toEqual([{ source: 'backgrounds', id: ink.id }]);
    const undo = await removeExternal(res.external);
    expect((await listImages()).map(m => m.name)).toEqual(['Night sky']);
    await undo();
    expect((await listImages()).map(m => m.name).sort()).toEqual(['Ink wash', 'Night sky']);
  });

  it('downloads just the chosen images, in the library’s layout, which the Library’s import reads too', async () => {
    const { sky } = await seed();
    const i = await build();
    const sel = selectionSnapshot(localMutableKV, i, [`ext:backgrounds:${sky.id}`]);
    expect(sel.external).toEqual([{ source: 'backgrounds', id: sky.id }]);
    const zip = await buildProfileZip(sel.snapshot, { scope: 'selection', external: await externalPart(sel.external, sources) });
    const files = unzipSync(zip.bytes);
    const paths = Object.keys(files).map(p => p.split('/').slice(1).join('/'));
    expect(paths).toEqual(expect.arrayContaining(['backgrounds/images.json', 'backgrounds/images/Skies/Night sky.png', 'manifest.json', 'library.json']));
    expect(paths.filter(p => p.startsWith('backgrounds/images/'))).toHaveLength(1);
    expect(zip.manifest.external).toEqual([{ source: 'backgrounds', section: 'backgrounds', id: sky.id, name: 'Night sky', size: 4 }]);
    expect(JSON.parse(strFromU8(files[Object.keys(files).find(p => p.endsWith('library.json'))!])).items.assetbrowser_folders).toContain('Skies');
    // Into a browser with nothing in it, the way the Library's Import does it.
    freshBrowser();
    expect(await importBackgroundFiles(files)).toMatchObject({ added: 1 });
    expect((await listImages()).map(m => m.name)).toEqual(['Night sky']);
  });

  it('previews and merges images: the same id is already here, a new one comes in', async () => {
    await seed();
    const zip = await buildProfileZip(everythingSnapshot(localMutableKV), { scope: 'everything', external: await externalPart(null, sources) });
    await addImage(png(5), { name: 'Only here', width: 1, height: 1, thumb: 'x' });
    const profile = readProfile(zip.bytes);
    const prev = await previewInstall(profile, localMutableKV, sources);
    expect(prev.rows.filter(r => r.kind === 'background').map(r => r.status)).toEqual(['same', 'same']);
    freshBrowser();
    const prev2 = await previewInstall(profile, localMutableKV, sources);
    expect(prev2.rows.filter(r => r.kind === 'background').map(r => r.status)).toEqual(['new', 'new']);
    const r = await installSources(profile, 'merge', installMerge(profile, localMutableKV), sources);
    expect(r.added).toBeGreaterThanOrEqual(4); // graph, palettes, folders store… and two images
    expect((await listImages()).map(m => m.name).sort()).toEqual(['Ink wash', 'Night sky']);
    const i = await build();
    expect(node(i, 'section:backgrounds/ext:backgrounds').children!.map(c => c.label)).toEqual(['Skies', 'Ink wash']);
    expect(i.byId.get('section:backgrounds/palettes')?.children?.map(c => c.label)).toEqual(['Dusk']);
    expect(readLibrary(zip.bytes).items['shader-studio:Aurora']).toBeTruthy();
  });

  it('replace everything backs up images too, then leaves only the file’s', async () => {
    await seed();
    const theirs = await buildProfileZip(everythingSnapshot(localMutableKV), { scope: 'everything', external: await externalPart(null, sources) });
    freshBrowser();
    await addImage(png(7, 7, 7), { name: 'Mine', width: 1, height: 1, thumb: 'x' });
    let backup: Uint8Array | null = null;
    await installReplace(readProfile(theirs.bytes), localMutableKV, async z => { backup = z.bytes; return true; }, { sources });
    expect((await listImages()).map(m => m.name).sort()).toEqual(['Ink wash', 'Night sky']);
    const b = unzipSync(backup!);
    expect(Object.keys(b).some(p => p.endsWith('backgrounds/images/Mine.png'))).toBe(true);
  });
});
