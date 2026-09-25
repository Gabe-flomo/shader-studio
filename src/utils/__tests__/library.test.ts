/**
 * The library: everything the app keeps, exported as one ZIP (library.json
 * plus readable folders) and imported back without overwriting anything.
 */
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildLibraryZip, formatSize, libraryStats, describeSnapshot, importLibrary, mergeJson, readableFiles, readLibrary, takeSnapshot, type KV } from '../library';

function memKV(init: Record<string, string> = {}): KV & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, keys: () => [...data.keys()], get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}
const graph = (label: string) => JSON.stringify({ nodes: [{ id: 'n1', type: 'output' }], label });

const SAMPLE = {
  'shader-studio:Sunset': graph('sunset v2'),
  'shader-studio-versions:Sunset': JSON.stringify([{ version: 1, savedAt: 1, payload: graph('sunset v1') }]),
  'shader-studio:Loose': graph('loose'),
  'shader-studio:gp:g1': JSON.stringify({ id: 'g1', label: 'Glow stack' }),
  'shader-studio:cfp:f1': JSON.stringify({ id: 'f1', label: 'Wobble' }),
  'shader-studio:un:u1': JSON.stringify({ id: 'u1', label: 'My node' }),
  'shader-studio:palette-presets': JSON.stringify([{ id: 'p1', name: 'Warm' }]),
  'shader-studio:theme': '"dark"',
  'nodepalette_favorites': JSON.stringify(['noise']),
  'assetbrowser_folders': JSON.stringify({ graphs: { folders: [{ id: 'fa', label: 'Skies' }], membership: { Sunset: 'fa' } } }),
  'someone-elses-key': 'not ours',
};

describe('library export', () => {
  it('takes only what Shader Studio owns', () => {
    const s = takeSnapshot(memKV(SAMPLE));
    expect(Object.keys(s.items)).not.toContain('someone-elses-key');
    expect(describeSnapshot(s)).toEqual({ graphs: 2, presets: 2, nodes: 1, other: 4 });
  });

  it('lays graphs out in their folders with their versions, and the rest by kind', () => {
    const files = readableFiles(takeSnapshot(memKV(SAMPLE)));
    expect(Object.keys(files).sort()).toEqual([
      'functions/Wobble.json', 'graphs/Loose.json', 'graphs/Skies/Sunset (versions)/v1.json', 'graphs/Skies/Sunset.json',
      'group presets/Glow stack.json', 'palettes.json', 'published nodes/My node.json', 'settings.json',
    ]);
    expect(JSON.parse(files['graphs/Skies/Sunset (versions)/v1.json']).label).toBe('sunset v1');
  });

  it('round-trips through the ZIP exactly', () => {
    const s = takeSnapshot(memKV(SAMPLE));
    const zip = buildLibraryZip(s, 'lib');
    expect(Object.keys(unzipSync(zip))).toContain('lib/library.json');
    expect(readLibrary(zip).items).toEqual(s.items);
  });
});

describe('library import', () => {
  it('adds what is new, renames a clashing graph, keeps your presets and settings, merges lists', () => {
    const mine = memKV({
      'shader-studio:Sunset': graph('my own sunset'),
      'shader-studio:gp:g1': JSON.stringify({ id: 'g1', label: 'Glow stack (edited)' }),
      'shader-studio:theme': '"light"',
      'shader-studio:palette-presets': JSON.stringify([{ id: 'p0', name: 'Mine' }]),
      'assetbrowser_folders': JSON.stringify({ graphs: { folders: [{ id: 'fm', label: 'Mine' }], membership: {} } }),
    });
    const r = importLibrary(takeSnapshot(memKV(SAMPLE)), mine);
    expect(mine.data.get('shader-studio:Sunset')).toBe(graph('my own sunset'));
    expect(mine.data.get('shader-studio:Sunset (imported)')).toBe(SAMPLE['shader-studio:Sunset']);
    expect(mine.data.get('shader-studio-versions:Sunset (imported)')).toBe(SAMPLE['shader-studio-versions:Sunset']);
    expect(r.renamed).toEqual(['Sunset (imported)']);
    expect(mine.data.get('shader-studio:Loose')).toBe(SAMPLE['shader-studio:Loose']);
    expect(JSON.parse(mine.data.get('shader-studio:gp:g1')!).label).toBe('Glow stack (edited)');
    expect(mine.data.get('shader-studio:theme')).toBe('"light"');
    expect(JSON.parse(mine.data.get('shader-studio:palette-presets')!).map((p: { id: string }) => p.id)).toEqual(['p0', 'p1']);
    const folders = JSON.parse(mine.data.get('assetbrowser_folders')!);
    expect(folders.graphs.folders.map((f: { id: string }) => f.id)).toEqual(['fm', 'fa']);
    expect(folders.graphs.membership['Sunset (imported)']).toBe('fa');
    expect(r.kept).toBe(2);
    // Importing the same library again adds nothing new.
    const again = importLibrary(takeSnapshot(memKV(SAMPLE)), mine);
    expect(again.added).toBe(0);
  });

  it('reads a ZIP from the old Backup button', () => {
    const old = zipSync({
      'backup_2026-01-01/graphs/Skies/Dusk.json': strToU8(graph('dusk')),
      'backup_2026-01-01/presets/Glow.json': strToU8(JSON.stringify({ id: 'g9', label: 'Glow' })),
      'backup_2026-01-01/functions/Fn.json': strToU8(JSON.stringify({ id: 'f9', label: 'Fn' })),
    });
    const lib = readLibrary(old);
    expect(Object.keys(lib.items).sort()).toEqual(['shader-studio:Dusk', 'shader-studio:cfp:f9', 'shader-studio:gp:g9']);
  });

  it('refuses a file that is not a library', () => {
    expect(() => readLibrary(strToU8('{"nodes": []}'))).toThrow(/Not a Shader Studio library/);
    expect(strFromU8(strToU8('ok'))).toBe('ok');
  });

  it('merges lists by id and maps key by key, yours winning', () => {
    expect(mergeJson([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b' }])).toEqual([{ id: 'a', v: 1 }, { id: 'b' }]);
    expect(mergeJson({ x: 1, y: { a: 1 } }, { x: 2, y: { b: 2 }, z: 3 })).toEqual({ x: 1, y: { a: 1, b: 2 }, z: 3 });
  });
});

describe('library stats', () => {
  it('counts each kind and adds up the size', () => {
    const st = libraryStats(takeSnapshot(memKV(SAMPLE)));
    expect(st.kinds.graphs.count).toBe(2);
    expect(st.kinds.versions.count).toBe(1);
    expect(st.kinds['published nodes'].count).toBe(1);
    expect(st.kinds.palettes.count).toBe(1);
    const sum = Object.values(st.kinds).reduce((n, k) => n + k.size, 0);
    expect(st.total).toBe(sum);
    expect(st.total).toBeGreaterThan(0);
  });

  it('writes sizes the way people read them', () => {
    expect(formatSize(512)).toMatch(/B$/);
    expect(formatSize(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });
});
