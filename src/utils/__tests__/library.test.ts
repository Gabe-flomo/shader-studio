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
  it('takes only what Playfield owns', () => {
    const s = takeSnapshot(memKV(SAMPLE));
    expect(Object.keys(s.items)).not.toContain('someone-elses-key');
    expect(describeSnapshot(s)).toEqual({ graphs: 2, presets: 2, nodes: 1, presentations: 0, other: 4 });
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

describe('downloading one kind of thing', async () => {
  const { buildSetZip, countInSet, snapshotOfKinds, kindOfKey } = await import('../library');
  const kv = memKV({ ...SAMPLE, 'shader-studio:glsl-shaders': JSON.stringify([{ id: 's1', name: 'Rings', code: 'void main(){}', group: 'Tests', note: 'broken on\nline 2' }, { id: 's2', name: 'Plain', code: 'void main(){ gl_FragColor = vec4(1.0); }' }]) });
  const snap = takeSnapshot(kv);
  it('classifies keys the way the statistics do', () => {
    expect(kindOfKey('shader-studio:Sunset', SAMPLE['shader-studio:Sunset'])).toBe('graphs');
    expect(kindOfKey('shader-studio:cfp:f1', '{}')).toBe('functions');
    expect(kindOfKey('shader-studio:glsl-shaders', '[]')).toBe('glsl shaders');
    expect(kindOfKey('shader-studio:theme', '"dark"')).toBe('settings');
  });
  it('counts what a set holds', () => {
    expect(countInSet(snap, 'graphs')).toBe(2);
    expect(countInSet(snap, 'glsl')).toBe(2);
    expect(countInSet(snap, 'functions')).toBe(1);
    expect(countInSet(snap, 'nodes')).toBe(1);
    expect(countInSet(snap, 'presets')).toBe(2); // one group preset + one palette
  });
  it('writes saved shaders as plain .glsl files, notes as a leading comment', () => {
    const files = readableFiles(snap);
    expect(files['glsl shaders/Tests/Rings.glsl']).toBe('// Rings\n// broken on\n// line 2\n\nvoid main(){}');
    expect(files['glsl shaders/Plain.glsl']).toBe('void main(){ gl_FragColor = vec4(1.0); }');
  });
  it('a set ZIP holds only that kind, importable, folders kept', () => {
    const { bytes, name } = buildSetZip(snap, 'graphs');
    expect(name).toMatch(/^Shader Studio graphs \d{4}-\d{2}-\d{2}\.zip$/);
    const paths = Object.keys(unzipSync(bytes)).map(p => p.split('/').slice(1).join('/'));
    expect(paths).toContain('graphs/Skies/Sunset.json');
    expect(paths).toContain('graphs/Skies/Sunset (versions)/v1.json');
    expect(paths).toContain('graphs/Loose.json');
    expect(paths.some(p => p.startsWith('functions/') || p.startsWith('glsl shaders'))).toBe(false);
    expect(paths).not.toContain('settings.json');
    const lib = JSON.parse(strFromU8(unzipSync(bytes)[Object.keys(unzipSync(bytes)).find(p => p.endsWith('library.json'))!]));
    expect(Object.keys(lib.items).sort()).toEqual(['assetbrowser_folders', 'shader-studio-versions:Sunset', 'shader-studio:Loose', 'shader-studio:Sunset']);
    const glsl = buildSetZip(snap, 'glsl');
    expect(glsl.name).toMatch(/^Shader Studio GLSL shaders /);
    expect(Object.keys(unzipSync(glsl.bytes)).filter(p => p.endsWith('.glsl'))).toHaveLength(2);
    expect(Object.keys(snapshotOfKinds(snap, ['functions']).items)).toEqual(['shader-studio:cfp:f1', 'assetbrowser_folders']);
  });
});

describe('presentations in the library', async () => {
  const { buildSetZip, countInSet } = await import('../library');
  const { emptyPresentation, PRESENTATION_FILE_KIND } = await import('../../types/presentation');
  const pres = (title: string, text = 'hello') => {
    const p = emptyPresentation(title, 1000);
    p.steps[0].blocks.push({ type: 'text', id: 'b1', markdown: text });
    return JSON.stringify(p);
  };
  const KEY = 'shader-studio-presentation:';
  const withPres = {
    ...SAMPLE,
    [`${KEY}Intro`]: pres('Intro'),
    [`${KEY}Loose talk`]: pres('Loose talk'),
    assetbrowser_folders: JSON.stringify({ ...JSON.parse(SAMPLE.assetbrowser_folders), presentations: { folders: [{ id: 'pf', label: 'Talks' }], membership: { Intro: 'pf' } } }),
  };

  it('goes into the full ZIP as .present.json files in their folders, and comes back out exactly', () => {
    const s = takeSnapshot(memKV(withPres));
    expect(describeSnapshot(s).presentations).toBe(2);
    const zip = buildLibraryZip(s, 'lib');
    const files = unzipSync(zip);
    const intro = JSON.parse(strFromU8(files['lib/presentations/Talks/Intro.present.json']));
    expect(intro.kind).toBe(PRESENTATION_FILE_KIND);
    expect(intro.steps[0].blocks[0].markdown).toBe('hello');
    expect(files['lib/presentations/Loose talk.present.json']).toBeDefined();
    expect(readLibrary(zip).items).toEqual(s.items);
    // Into an empty library: both arrive, the folder with them.
    const fresh = memKV();
    const r = importLibrary(readLibrary(zip), fresh);
    expect(fresh.data.get(`${KEY}Intro`)).toBeDefined();
    expect(fresh.data.get(`${KEY}Loose talk`)).toBeDefined();
    expect(JSON.parse(fresh.data.get('assetbrowser_folders')!).presentations.membership.Intro).toBe('pf');
    expect(r.renamedPresentations).toEqual([]);
  });

  it('a clashing name comes in as (2), then (3); the same one twice adds nothing; broken ones are left out', () => {
    const mine = memKV({ [`${KEY}Intro`]: pres('Intro', 'mine') });
    const theirs = takeSnapshot(memKV({ [`${KEY}Intro`]: pres('Intro', 'theirs'), [`${KEY}Broken`]: '{"title":"Broken"}' }));
    const r = importLibrary(theirs, mine);
    expect(r.renamedPresentations).toEqual(['Intro (2)']);
    expect(r.skipped).toBe(1);
    expect(JSON.parse(mine.data.get(`${KEY}Intro`)!).steps[0].blocks[0].markdown).toBe('mine');
    const two = JSON.parse(mine.data.get(`${KEY}Intro (2)`)!);
    expect(two.title).toBe('Intro (2)');
    expect(two.steps[0].blocks[0].markdown).toBe('theirs');
    expect(mine.data.has(`${KEY}Broken`)).toBe(false);
    // Again: already here as "Intro (2)", so nothing new.
    const again = importLibrary(theirs, mine);
    expect(again.renamedPresentations).toEqual([]);
    expect(again.same).toBe(1);
    // A third, different "Intro" gets (3).
    const third = importLibrary(takeSnapshot(memKV({ [`${KEY}Intro`]: pres('Intro', 'a third') })), mine);
    expect(third.renamedPresentations).toEqual(['Intro (3)']);
  });

  it('downloads on their own, and a lone .present.json or a ZIP of them reads as a library', () => {
    const s = takeSnapshot(memKV(withPres));
    expect(countInSet(s, 'presentations')).toBe(2);
    const { bytes, name } = buildSetZip(s, 'presentations');
    expect(name).toMatch(/^Shader Studio presentations /);
    const paths = Object.keys(unzipSync(bytes)).map(p => p.split('/').slice(1).join('/'));
    expect(paths.filter(p => p.endsWith('.present.json')).sort()).toEqual(['presentations/Loose talk.present.json', 'presentations/Talks/Intro.present.json']);
    expect(paths.some(p => p.startsWith('graphs/'))).toBe(false);
    expect(Object.keys(readLibrary(bytes).items).filter(k => k.startsWith(KEY)).sort()).toEqual([`${KEY}Intro`, `${KEY}Loose talk`]);

    const file = JSON.stringify({ kind: PRESENTATION_FILE_KIND, ...JSON.parse(pres('Solo')) });
    expect(Object.keys(readLibrary(strToU8(file)).items)).toEqual([`${KEY}Solo`]);
    const loose = zipSync({ 'a/Solo.present.json': strToU8(file), 'b/Solo.present.json': strToU8(file) });
    expect(Object.keys(readLibrary(loose).items).sort()).toEqual([`${KEY}Solo`, `${KEY}Solo (2)`]);
  });
});
