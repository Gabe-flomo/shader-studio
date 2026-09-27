import { describe, expect, it, vi } from 'vitest';
import { LAYER_KINDS } from '../../types/playLayers';
import { BUILTIN_GROUPS, BUILTIN_LAYERS, builtinGroups, matchesQuery, yourLayers, type KindEntry } from '../../components/play/layers/addLayerCatalog';
import type { FolderEntry } from '../../utils/assetFolders';
import type { LayerKindDef } from '../../types/layerKinds';

const kind = (id: string, name: string, hint = ''): KindEntry => ({
  def: { id, name, hint, icon: 'code', colour: 'mauve', mode: '2d', code: '', paramDefs: [], clear: true, readPicture: false, version: 1 } as LayerKindDef,
  inFile: false,
});
const folder = (id: string, label: string): FolderEntry => ({ id, label, collapsed: false, createdAt: 0 });

describe('Add layer: built-in groups', () => {
  it('offers every layer kind exactly once (variants aside)', () => {
    const offered = builtinGroups().flatMap(g => g.items.filter(i => !i.variant).map(i => i.kind));
    expect([...offered].sort()).toEqual([...LAYER_KINDS].sort());
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('puts every built-in in a group that exists, and leaves no group empty', () => {
    const ids = new Set(BUILTIN_GROUPS.map(g => g.id));
    for (const l of BUILTIN_LAYERS) expect(ids.has(l.group)).toBe(true);
    for (const g of builtinGroups()) expect(g.items.length).toBeGreaterThan(0);
  });

  it('keeps the group order', () => {
    expect(builtinGroups().map(g => g.label)).toEqual(BUILTIN_GROUPS.map(g => g.label));
  });

  it('offers 3D Script and the p5.js importer beside Script, under Code', () => {
    const code = builtinGroups().find(g => g.key === 'builtin:code')!;
    expect(code.items.map(i => [i.label, i.variant ?? null])).toEqual([['Script', null], ['3D Script', 'script3d'], ['Import p5.js sketch…', 'p5import']]);
    expect(builtinGroups('webgl').flatMap(g => g.items.map(i => i.label))).toEqual(['3D Script', 'Import p5.js sketch…']);
  });

  it('drops a new built-in into its group without special cases', () => {
    const extra = [...BUILTIN_LAYERS, { kind: 'null' as const, group: 'code' as const, label: 'Code null', hint: 'A test', icon: 'code' as const }];
    const code = builtinGroups('', extra).find(g => g.key === 'builtin:code')!;
    expect(code.items.map(i => i.label)).toEqual(['Script', '3D Script', 'Import p5.js sketch…', 'Code null']);
  });
});

describe('Add layer: search', () => {
  it('matches every word, in any order and case', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('ASCII pict', 'Glyphs', 'The picture as ASCII')).toBe(true);
    expect(matchesQuery('ascii brush', 'Glyphs', 'The picture as ASCII')).toBe(false);
  });

  it('keeps only groups with a match, by name, hint or group name', () => {
    expect(builtinGroups('webcam').map(g => g.items.map(i => i.kind))).toEqual([['camera']]);
    const effects = builtinGroups('picture effects');
    expect(effects.map(g => g.label)).toEqual(['Picture effects']);
    expect(effects[0].items.length).toBe(effects[0].total);
    expect(builtinGroups('zzz nothing')).toEqual([]);
  });

  it('searches your layers by name, hint and folder name', () => {
    const kinds = [kind('a', 'Rain'), kind('b', 'Snow', 'flakes that drift'), kind('c', 'Grid')];
    const folders = [folder('f1', 'Weather')];
    const membership = { a: 'f1', b: 'f1' };
    expect(yourLayers(kinds, folders, membership, 'drift').folders[0].items.map(k => k.def.id)).toEqual(['b']);
    expect(yourLayers(kinds, folders, membership, 'weather').folders[0].items.map(k => k.def.id)).toEqual(['a', 'b']);
    const grid = yourLayers(kinds, folders, membership, 'grid');
    expect(grid.folders).toEqual([]);
    expect(grid.loose.map(k => k.def.id)).toEqual(['c']);
  });
});

describe('Add layer: folders of your layers', () => {
  const kinds = [kind('a', 'Rain'), kind('b', 'Snow'), kind('c', 'Grid'), kind('d', 'Dots')];

  it('puts each kind in its folder, and the rest loose', () => {
    const r = yourLayers(kinds, [folder('f1', 'Weather'), folder('f2', 'Patterns')], { a: 'f1', b: 'f1', c: 'f2' });
    expect(r.folders.map(g => [g.label, g.items.map(k => k.def.id)])).toEqual([['Weather', ['a', 'b']], ['Patterns', ['c']]]);
    expect(r.loose.map(k => k.def.id)).toEqual(['d']);
    expect(r.looseTotal).toBe(1);
  });

  it('shows empty folders when not searching', () => {
    const r = yourLayers(kinds, [folder('f1', 'Empty')], {});
    expect(r.folders.map(g => g.total)).toEqual([0]);
    expect(r.loose.length).toBe(4);
  });

  it('treats a kind in a deleted folder as loose, and ignores kinds that are gone', () => {
    const r = yourLayers(kinds, [folder('f1', 'Weather')], { a: 'gone', b: 'f1', zz: 'f1' });
    expect(r.folders[0].items.map(k => k.def.id)).toEqual(['b']);
    expect(r.loose.map(k => k.def.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('Add layer: folders stored with the other libraries', () => {
  it('keeps layer kind folders in their own assetFolders scope', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    vi.stubGlobal('window', { dispatchEvent: () => true });
    try {
      const af = await import('../../utils/assetFolders');
      const { LAYER_KIND_FOLDER_SCOPE } = await import('../../components/play/layers/addLayerCatalog');
      const f = af.createFolder(LAYER_KIND_FOLDER_SCOPE, 'Weather');
      af.moveItemsToFolder(LAYER_KIND_FOLDER_SCOPE, ['a'], f.id);
      const kinds = [kind('a', 'Rain'), kind('b', 'Snow')];
      let r = yourLayers(kinds, af.loadFolders(LAYER_KIND_FOLDER_SCOPE), af.getMembership(LAYER_KIND_FOLDER_SCOPE));
      expect(r.folders[0].items.map(k => k.def.id)).toEqual(['a']);
      expect(af.loadFolders('graphs')).toEqual([]);
      af.deleteFolder(LAYER_KIND_FOLDER_SCOPE, f.id);
      r = yourLayers(kinds, af.loadFolders(LAYER_KIND_FOLDER_SCOPE), af.getMembership(LAYER_KIND_FOLDER_SCOPE));
      expect(r.folders).toEqual([]);
      expect(r.loose.map(k => k.def.id)).toEqual(['a', 'b']);
    } finally { vi.unstubAllGlobals(); }
  });
});
