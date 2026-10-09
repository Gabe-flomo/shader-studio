/**
 * The Files page's model: the inventory (sections, sizes, nesting, used by),
 * clean-up rules, removal with Undo, selective ZIPs with their dependencies,
 * install (merge naming, replace with a backup first) and the round trip.
 */
import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildInventory, countLeaves, itemsOf, pathTo, walk, type Inventory } from '../inventory';
import { cleanupSuggestions } from '../cleanup';
import { expandRemoval, memoryKV, removalWarnings, removeFolderKeepItems, removeNodes } from '../mutate';
import { buildProfileZip, everythingSnapshot, freeName, installMerge, installReplace, previewInstall, readProfile, selectionSnapshot } from '../profileZip';
import { importLibrary, readLibrary, type KV } from '../../utils/library';

const IMG = `data:image/png;base64,${'A'.repeat(600)}`;
const IMG2 = `data:image/jpeg;base64,${'B'.repeat(900)}`;

const graph = (o: Record<string, unknown> = {}) => JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }], version: 3, savedAt: 3000, ...o });

function fixture(): Record<string, string> {
  return {
    'shader-studio:Sunset': graph({
      nodes: [{ id: 'n1', type: 'output', params: {} }, { id: 'n2', type: 'un_wobble_x1', params: {} }, { id: 'n3', type: 'data', params: { dataset: 'rain' } }, { id: 'n4', type: 'customFn', params: { body: 'return sin(uv.x * 6.0);' } }],
      play: {
        version: 1, controls: [{ id: 'c1' }], mappings: [],
        layers: [{ id: 'L1', kind: 'image', name: 'Logo', src: IMG }, { id: 'L2', kind: 'script', name: 'Rain', kindId: 'sketch:rain-1' }],
        layerKinds: [{ id: 'sketch:rain-1', name: 'Rain drops', code: 'x' }],
        display: { picture: true, backdrop: [0, 0, 0], source: 'shader', image: { name: 'Old still', src: IMG2 } },
        takes: [{ id: 't1', name: 'Take 1', from: 0, length: 4, tracks: [{}], events: [] }, { id: 't2', name: 'Take 2', from: 0, length: 2, tracks: [], events: [] }],
      },
      datasets: { rain: { id: 'rain', name: 'Rainfall', result: { kind: 'table', rows: 3, columns: [{}] } }, spare: { id: 'spare', name: 'Spare', result: null } },
    }),
    'shader-studio-versions:Sunset': JSON.stringify([1, 2].map(v => ({ version: v, savedAt: v * 1000, payload: graph({ version: v }) }))),
    'shader-studio:Waves': graph({ savedAt: 5000 }),
    'shader-studio:Waves copy': graph({ savedAt: 4000 }),
    'shader-studio-versions:Waves': JSON.stringify([1, 2, 3, 4, 5, 6, 7].map(v => ({ version: v, savedAt: v, payload: graph({ version: v }) }))),
    'shader-studio-presentation:Lesson one': JSON.stringify({
      version: 1, title: 'Lesson one', createdAt: 1, updatedAt: 9000,
      steps: [{ id: 's1', columns: 1, blocks: [{ type: 'text', id: 'b0', markdown: 'hi' }] }, { id: 's2', title: 'Colour', columns: 1, blocks: [] }, { id: 's3', columns: 1, blocks: [{ type: 'render', id: 'b1', source: 'src1' }] }],
      sources: [
        { id: 'src1', title: 'Sunset', from: { kind: 'saved', name: 'Sunset', savedAt: 1 }, bundle: { play: { layers: [{ id: 'L1', kind: 'image', name: 'Logo', src: IMG }] } }, capturedAt: 1, poster: IMG2 },
        { id: 'src2', title: 'Spare play', from: { kind: 'example', key: 'x' }, bundle: { play: { layers: [] } }, capturedAt: 2 },
      ],
    }),
    'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Stripes', inputs: [{ name: 'uv', type: 'vec2' }], outputType: 'float', body: 'return sin(uv.x * 6.0);', glslFunctions: '', savedAt: 10 }),
    'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Glow stack', subgraph: { nodes: [] }, savedAt: 20 }),
    'shader-studio:ep:ep_1': JSON.stringify({ id: 'ep_1', label: 'Pulse', savedAt: 21 }),
    'shader-studio:un:un_wobble_x1': JSON.stringify({ id: 'un_wobble_x1', label: 'Wobble', category: 'Mine', inputs: [], outputs: [{}], savedAt: 30 }),
    'shader-studio:glsl-shaders': JSON.stringify([
      { id: 'g1', name: 'Plasma', code: 'void main(){}\n', group: 'Tests' },
      { id: 'g2', name: 'Plasma again', code: 'void main(){}\n', group: 'Tests' },
      { id: 'g3', name: 'Loose', code: 'x' },
    ]),
    'shader-studio:palette-presets': JSON.stringify([{ id: 'p1', name: 'Warm', kind: 'cosine', savedAt: 1 }]),
    'shader-studio-backgrounds:palettes': JSON.stringify([{ id: 'pal_1', name: 'Dusk', stops: [{ at: 0, colour: [1, 0, 0] }, { at: 1, colour: [0, 0, 1] }], style: 'gradient', createdAt: 5 }]),
    'shader-studio:play:savedScripts': JSON.stringify([{ id: 'sk_1', name: 'Rain', code: 'draw()', mode: '2d', savedAt: 2 }]),
    'shader-studio:play:layerKinds': JSON.stringify([{ id: 'sketch:rain-1', name: 'Rain drops', code: 'x', paramDefs: [] }]),
    'fn_builder_saved_fns_v1': JSON.stringify([{ id: 'f1', name: 'wave', returnType: 'float', body: 'sin(x)' }]),
    'shader-studio:theme': 'dark',
    'shader-studio:discover:learned-roles': JSON.stringify({ a: 'colour' }),
    'shader-studio:kaggle': JSON.stringify({ username: 'me', key: 'secret' }),
    'assetbrowser_folders': JSON.stringify({
      graphs: { folders: [{ id: 'fa', label: 'Skies', createdAt: 1 }, { id: 'fe', label: 'Empty one', createdAt: 2 }], membership: { Sunset: 'fa' } },
      functions: { folders: [{ id: 'ff', label: 'Patterns' }], membership: { cfp_1: 'ff' } },
    }),
    'someone-else': 'x'.repeat(50),
  };
}

const inv = async (kv: KV) => buildInventory(kv);
const labels = (nodes: { label: string }[] | undefined) => (nodes ?? []).map(n => n.label);
const node = (i: Inventory, id: string) => { const n = i.byId.get(id); if (!n) throw new Error(`no ${id}`); return n; };

describe('inventory', () => {
  it('builds the sections with folders and items', async () => {
    const i = await inv(memoryKV(fixture()));
    expect(labels(i.sections)).toEqual(['Graphs', 'Presentations', 'GLSL shaders', 'Functions', 'Presets', 'Published nodes', 'Scripts', 'Backgrounds', 'Settings']);
    const graphs = node(i, 'section:graphs');
    expect(labels(graphs.children)).toEqual(['Empty one', 'Skies', 'Waves', 'Waves copy']);
    expect(labels(node(i, 'section:graphs/folder:fa').children)).toEqual(['Sunset']);
    expect(countLeaves(graphs.children)).toBe(3);
    expect(labels(node(i, 'section:glsl').children)).toEqual(['Tests', 'Loose']);
    expect(labels(node(i, 'section:functions').children)).toEqual(['Custom function presets', 'Function Builder']);
    expect(labels(node(i, 'section:functions/custom').children)).toEqual(['Patterns']);
    expect(labels(node(i, 'section:scripts').children)).toEqual(['Saved sketches', 'Layer kinds']);
    expect(labels(node(i, 'section:settings').children)).toEqual(['Folders', 'Learned parameter roles', 'Sign-ins', 'App settings']);
  });

  it('nests a graph: versions, and its Play setup with takes, datasets, layer kinds and media', async () => {
    const i = await inv(memoryKV(fixture()));
    const g = node(i, 'graph:Sunset');
    expect(labels(g.children)).toEqual(['Earlier versions', 'Play setup']);
    expect(labels(node(i, 'graph:Sunset/versions').children)).toEqual(['Version 1.1', 'Version 1.0']);
    expect(labels(node(i, 'graph:Sunset/play').children)).toEqual(['Takes', 'Datasets', 'Layer kinds', 'Media']);
    expect(labels(node(i, 'graph:Sunset/media').children)).toEqual(['Logo', 'Old still']);
    expect(pathTo(i, 'graph:Sunset/take:t2').map(n => n.label)).toEqual(['Graphs', 'Skies', 'Sunset', 'Play setup', 'Takes', 'Take 2']);
  });

  it('sizes: items are their stored characters (with history), sections their sum, and the total counts only our keys', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    const f = fixture();
    expect(node(i, 'graph:Sunset').size).toBe('shader-studio:Sunset'.length + f['shader-studio:Sunset'].length + 'shader-studio-versions:Sunset'.length + f['shader-studio-versions:Sunset'].length);
    const graphs = node(i, 'section:graphs');
    expect(graphs.size).toBe(graphs.children!.reduce((n, c) => n + c.size, 0));
    expect(i.other).toBe('someone-else'.length + 50);
    const ours = Object.entries(f).filter(([k]) => k !== 'someone-else').reduce((n, [k, v]) => n + k.length + v.length, 0);
    expect(i.total).toBe(ours);
    expect(node(i, 'graph:Sunset').modified).toBe(3000);
  });

  it('knows what uses what', async () => {
    const i = await inv(memoryKV(fixture()));
    expect(node(i, 'node:un_wobble_x1').usedBy).toEqual([{ id: 'graph:Sunset', label: 'Sunset', where: '1 node', breaks: true }]);
    expect(node(i, 'graph:Sunset').uses).toContain('node:un_wobble_x1');
    expect(node(i, 'fn:cfp:cfp_1').usedBy?.[0]).toMatchObject({ label: 'Sunset', where: '1 Custom function node (a copy)' });
    expect(node(i, 'fn:cfp:cfp_1').usedBy?.[0].breaks).toBeFalsy();
    expect(node(i, 'kind:sketch:rain-1').usedBy?.[0]).toMatchObject({ label: 'Sunset', where: '1 layer (a copy)' });
    expect(node(i, 'graph:Sunset').usedBy).toEqual([{ id: 'pres:Lesson one', label: 'Lesson one', where: 'Step 3 (a copy)' }]);
    const media = node(i, 'pres:Lesson one/src:src1').children![0];
    expect(media.usedBy).toEqual([{ id: 'pres:Lesson one', label: 'Lesson one', where: 'Step 3' }]);
    expect(node(i, 'graph:Sunset/dataset:rain').unused).toBeUndefined();
    expect(node(i, 'graph:Sunset/dataset:spare').unused).toBeTruthy();
    expect(node(i, 'pres:Lesson one/src:src2').unused).toBeTruthy();
  });

  it('yields between items when asked', async () => {
    let pauses = 0;
    await buildInventory(memoryKV(fixture()), { pause: () => { pauses++; } });
    expect(pauses).toBeGreaterThan(10);
  });

  it('shows external stores in their section', async () => {
    const i = await buildInventory(memoryKV(fixture()), { external: [{ source: 'bg', section: 'backgrounds', group: 'Images', items: [{ id: 'a', label: 'Sky.jpg', size: 2048 }] }] });
    expect(labels(node(i, 'section:backgrounds').children)).toEqual(['Images', 'Palettes']);
    expect(labels(node(i, 'section:presets').children)).toEqual(['Group presets', 'Expressions', 'Palette node presets']);
    expect(i.external).toBe(2048);
  });
});

describe('clean up', () => {
  it('finds old versions, unused things, duplicates and empty folders, each with a reason', async () => {
    const i = await inv(memoryKV(fixture()));
    const groups = cleanupSuggestions(i, { keepVersions: 5 });
    const by = Object.fromEntries(groups.map(g => [g.kind, g.items]));
    expect(by.versions.map(s => s.label)).toEqual(['Waves']);
    expect(by.versions[0].removeIds).toEqual(['graph:Waves/v:2', 'graph:Waves/v:1']);
    expect(by.versions[0].reason).toMatch(/2 earlier versions \(1\.0–1\.1\) past the newest 5/);
    expect(by.unused.map(s => s.nodeId).sort()).toEqual(['graph:Sunset/dataset:spare', 'graph:Sunset/media:play.display.image.src', 'pres:Lesson one/src:src2']);
    expect(by.duplicate.map(s => s.label).sort()).toEqual(['Plasma again', 'Waves copy'].sort());
    expect(by.duplicate.find(s => s.label === 'Waves copy')!.reason).toBe('Same content as “Waves”, which is newer');
    expect(by.emptyFolder.map(s => s.label)).toEqual(['Empty one']);
  });

  it('lists the biggest things with what makes them big', async () => {
    const f = fixture();
    f['shader-studio:Huge'] = graph({ play: { version: 1, controls: [], mappings: [], layers: [], takes: [{ id: 'big', name: 'Long take', length: 60, tracks: ['x'.repeat(200_000)] }] } });
    const groups = cleanupSuggestions(await inv(memoryKV(f)));
    const big = groups.find(g => g.kind === 'big')!.items;
    expect(big[0].label).toBe('Huge');
    expect(big[0].reason).toMatch(/of the browser’s room · mostly “Long take” \(\d+ KB\)/);
  });
});

describe('remove with undo', () => {
  it('removes a graph with its history and folder membership, and puts it all back', async () => {
    const kv = memoryKV(fixture());
    const before = new Map(kv.data);
    const i = await inv(kv);
    const r = removeNodes(kv, expandRemoval(i, ['graph:Sunset']));
    expect(kv.get('shader-studio:Sunset')).toBeNull();
    expect(kv.get('shader-studio-versions:Sunset')).toBeNull();
    expect(JSON.parse(kv.get('assetbrowser_folders')!).graphs.membership).toEqual({});
    r.undo();
    expect(new Map(kv.data)).toEqual(before);
  });

  it('removes parts inside a key: a take, a dataset, a shader from a list, old versions, unused media', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    removeNodes(kv, expandRemoval(i, ['graph:Sunset/take:t1', 'graph:Sunset/dataset:spare', 'glsl:g2', 'graph:Waves/v:1', 'graph:Waves/v:2', 'graph:Sunset/media:play.display.image.src']));
    const g = JSON.parse(kv.get('shader-studio:Sunset')!);
    expect(g.play.takes.map((t: { id: string }) => t.id)).toEqual(['t2']);
    expect(Object.keys(g.datasets)).toEqual(['rain']);
    expect(g.play.display.image).toBeUndefined();
    expect(g.play.layers).toHaveLength(2);
    expect(JSON.parse(kv.get('shader-studio:glsl-shaders')!).map((s: { id: string }) => s.id)).toEqual(['g1', 'g3']);
    expect(JSON.parse(kv.get('shader-studio-versions:Waves')!).map((v: { version: number }) => v.version)).toEqual([3, 4, 5, 6, 7]);
  });

  it('a whole folder takes its items; a folder alone can go keeping them', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    const going = expandRemoval(i, ['section:graphs/folder:fa']);
    expect(going.map(n => n.id).sort()).toEqual(['graph:Sunset', 'section:graphs/folder:fa']);
    const undo = removeFolderKeepItems(kv, 'graphs', 'fa');
    expect(kv.get('shader-studio:Sunset')).not.toBeNull();
    expect(JSON.parse(kv.get('assetbrowser_folders')!).graphs.folders.map((f: { id: string }) => f.id)).toEqual(['fe']);
    undo();
    expect(kv.get('assetbrowser_folders')).toBe(fixture().assetbrowser_folders);
  });

  it('says what removing something used will break', async () => {
    const i = await inv(memoryKV(fixture()));
    const w = removalWarnings(expandRemoval(i, ['node:un_wobble_x1']));
    expect(w.breaks).toEqual(['“Sunset” (1 node) loses “Wobble”']);
    const w2 = removalWarnings(expandRemoval(i, ['graph:Sunset']));
    expect(w2.breaks).toEqual([]);
    expect(w2.copies).toEqual(['“Lesson one” (Step 3) keeps its own copy of “Sunset”']);
  });
});

describe('download', () => {
  it('a selection holds just the chosen things, their folders, and (optionally) what they need', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    const plain = selectionSnapshot(kv, i, ['graph:Sunset', 'glsl:g3']);
    expect(Object.keys(plain.snapshot.items).sort()).toEqual(['assetbrowser_folders', 'shader-studio:Sunset', 'shader-studio:glsl-shaders']);
    expect(JSON.parse(plain.snapshot.items['shader-studio:glsl-shaders']).map((s: { id: string }) => s.id)).toEqual(['g3']);
    expect(JSON.parse(plain.snapshot.items.assetbrowser_folders)).toEqual({ graphs: { folders: [{ id: 'fa', label: 'Skies', createdAt: 1 }], membership: { Sunset: 'fa' } } });
    const full = selectionSnapshot(kv, i, ['pres:Lesson one'], { versions: true, dependencies: true });
    expect(Object.keys(full.snapshot.items).sort()).toEqual(['assetbrowser_folders', 'shader-studio-presentation:Lesson one', 'shader-studio-versions:Sunset', 'shader-studio:Sunset', 'shader-studio:un:un_wobble_x1']);
    expect(full.dependencies.map(d => d.label)).toEqual(['Sunset', 'Wobble']);
  });

  it('a section or folder stands for everything in it; a part for its item; sign-ins never go', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    expect(itemsOf(i, ['section:glsl']).map(n => n.id)).toEqual(['glsl:g1', 'glsl:g2', 'glsl:g3']);
    expect(itemsOf(i, ['graph:Sunset/take:t1']).map(n => n.id)).toEqual(['graph:Sunset']);
    const s = selectionSnapshot(kv, i, ['section:settings']);
    expect(Object.keys(s.snapshot.items)).not.toContain('shader-studio:kaggle');
    expect(Object.keys(everythingSnapshot(kv).items)).not.toContain('shader-studio:kaggle');
  });

  it('the ZIP is a Library export with a manifest, and both importers read it', async () => {
    const kv = memoryKV(fixture());
    const i = await inv(kv);
    const sel = selectionSnapshot(kv, i, ['section:graphs'], { versions: true });
    const zip = await buildProfileZip(sel.snapshot, { scope: 'selection', external: { files: { 'store/a1.jpg': new Uint8Array([1, 2, 3]) }, items: [{ source: 'bg', section: 'backgrounds', id: 'a1', name: 'Sky.jpg', size: 3 }] } });
    const files = unzipSync(zip.bytes);
    const paths = Object.keys(files).map(p => p.split('/').slice(1).join('/'));
    expect(paths).toEqual(expect.arrayContaining(['library.json', 'manifest.json', 'README.txt', 'graphs/Skies/Sunset.json', 'graphs/Waves.json', 'store/a1.jpg']));
    expect(zip.manifest).toMatchObject({ kind: 'shader-studio-profile', format: 1, scope: 'selection', app: { name: 'Shader Studio' }, sections: { graphs: { count: 3 }, settings: { count: 1 }, backgrounds: { count: 1, size: 3 } }, external: [{ source: 'bg', id: 'a1', name: 'Sky.jpg' }] });
    expect(typeof zip.manifest.app.version).toBe('string');
    // The Library's own import reads it.
    expect(Object.keys(readLibrary(zip.bytes).items)).toContain('shader-studio:Sunset');
    const lib = memoryKV();
    importLibrary(readLibrary(zip.bytes), lib);
    expect(lib.get('shader-studio:Waves')).toBe(fixture()['shader-studio:Waves']);
    // And Install gets the stores' files back, from the ZIP's root.
    const p = readProfile(zip.bytes);
    expect(p.files['store/a1.jpg']).toEqual(new Uint8Array([1, 2, 3]));
    expect(p.manifest?.external).toHaveLength(1);
    expect(strFromU8(files[Object.keys(files).find(f => f.endsWith('manifest.json'))!])).toContain('"external"');
  });
});

describe('install', () => {
  it('names clashes "Name (2)" and counts on from there', () => {
    const taken = new Set(['Sunset', 'Sunset (2)']);
    expect(freeName('Sunset', n => taken.has(n))).toBe('Sunset (3)');
    expect(freeName('Sunset (2)', n => taken.has(n))).toBe('Sunset (3)');
    expect(freeName('Dawn', n => taken.has(n))).toBe('Dawn');
  });

  it('previews and merges: new things come in, the same are skipped, clashes are renamed, yours are kept', async () => {
    const mine = memoryKV(fixture());
    const theirs = memoryKV({
      'shader-studio:Sunset': graph({ nodes: [{ id: 'z', type: 'output' }] }),
      'shader-studio:Waves': fixture()['shader-studio:Waves'],
      'shader-studio:Dawn': graph({ savedAt: 1 }),
      'shader-studio-presentation:Lesson one': JSON.stringify({ version: 1, title: 'Lesson one', steps: [{ id: 's', columns: 1, blocks: [] }], sources: [], createdAt: 1, updatedAt: 1 }),
      'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Stripes', body: 'other', savedAt: 1 }),
      'shader-studio:glsl-shaders': JSON.stringify([{ id: 'g3', name: 'Loose', code: 'changed' }, { id: 'g9', name: 'New one', code: 'y' }]),
      'shader-studio:theme': 'light',
      'assetbrowser_folders': JSON.stringify({ graphs: { folders: [{ id: 'fz', label: 'Theirs' }], membership: { Sunset: 'fz' } } }),
    });
    const zip = await buildProfileZip(everythingSnapshot(theirs), { scope: 'everything' });
    const profile = readProfile(zip.bytes);
    const prev = await previewInstall(profile, mine);
    const row = (label: string) => prev.rows.find(r => r.label === label);
    expect(row('Sunset')).toMatchObject({ status: 'rename', as: 'Sunset (2)' });
    expect(row('Waves')).toMatchObject({ status: 'same' });
    expect(row('Dawn')).toMatchObject({ status: 'new' });
    expect(row('Lesson one')).toMatchObject({ status: 'rename', as: 'Lesson one (2)' });
    expect(row('Stripes')).toMatchObject({ status: 'rename', as: 'Stripes (2)' });
    expect(row('Loose')).toMatchObject({ status: 'rename', as: 'Loose (2)' });
    expect(row('New one')).toMatchObject({ status: 'new' });
    expect(row('Theme')).toMatchObject({ status: 'keep' });
    expect(prev.manifest?.scope).toBe('everything');

    const r = installMerge(profile, mine);
    expect(r.renamed.map(x => x.to).sort()).toEqual(['Loose (2)', 'Lesson one (2)', 'Stripes (2)', 'Sunset (2)'].sort());
    expect(mine.get('shader-studio:Sunset')).toBe(fixture()['shader-studio:Sunset']);
    expect(mine.get('shader-studio:Sunset (2)')).not.toBeNull();
    expect(mine.get('shader-studio:theme')).toBe('dark');
    expect(JSON.parse(mine.get('shader-studio:cfp:cfp_1_2')!).label).toBe('Stripes (2)');
    const folders = JSON.parse(mine.get('assetbrowser_folders')!);
    expect(folders.graphs.membership).toMatchObject({ Sunset: 'fa', 'Sunset (2)': 'fz' });
    expect(JSON.parse(mine.get('shader-studio:glsl-shaders')!).map((s: { name: string }) => s.name)).toEqual(['Plasma', 'Plasma again', 'Loose', 'Loose (2)', 'New one']);
  });

  it('installing the same file twice brings nothing in the second time', async () => {
    const mine = memoryKV(fixture());
    const zip = await buildProfileZip(everythingSnapshot(memoryKV({
      'shader-studio:Sunset': graph({ nodes: [{ id: 'z', type: 'output' }] }),
      'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Stripes', body: 'other', savedAt: 1 }),
      'shader-studio:glsl-shaders': JSON.stringify([{ id: 'g3', name: 'Loose', code: 'changed' }]),
    })), { scope: 'everything' });
    expect(installMerge(readProfile(zip.bytes), mine).renamed.map(r => r.to).sort()).toEqual(['Loose (2)', 'Stripes (2)', 'Sunset (2)']);
    const again = await previewInstall(readProfile(zip.bytes), mine);
    expect(again.rows.map(r => r.status)).toEqual(['same', 'same', 'same']);
  });

  it('replace everything downloads a backup first, and changes nothing when that fails', async () => {
    const mine = memoryKV(fixture());
    const theirs = await buildProfileZip(everythingSnapshot(memoryKV({ 'shader-studio:Dawn': graph() })), { scope: 'everything' });
    const profile = readProfile(theirs.bytes);
    await expect(installReplace(profile, mine, async () => false)).rejects.toThrow(/nothing was replaced/);
    expect(mine.get('shader-studio:Sunset')).not.toBeNull();
    let backup: Uint8Array | null = null;
    const r = await installReplace(profile, mine, async z => { backup = z.bytes; return true; });
    expect(r).toMatchObject({ mode: 'replace', added: 1 });
    expect(mine.get('shader-studio:Sunset')).toBeNull();
    expect(mine.get('shader-studio:Dawn')).not.toBeNull();
    expect(mine.get('shader-studio:kaggle')).not.toBeNull(); // sign-ins stay
    expect(mine.get('someone-else')).not.toBeNull();
    expect(readLibrary(backup!).items['shader-studio:Sunset']).toBe(fixture()['shader-studio:Sunset']);
  });

  it('round trip: everything, installed into empty storage, gives the same inventory', async () => {
    const src = memoryKV(fixture());
    const zip = await buildProfileZip(everythingSnapshot(src), { scope: 'everything' });
    const empty = memoryKV();
    installMerge(readProfile(zip.bytes), empty);
    const a = await inv(src), b = await inv(empty);
    const shape = (i: Inventory) => [...walk(i.sections)].filter(n => !n.private && n.section !== 'settings').map(n => `${n.id}|${n.size}|${n.label}`);
    expect(shape(b)).toEqual(shape(a));
    // Sign-ins are the only thing left behind.
    expect(a.total - b.total).toBe('shader-studio:kaggle'.length + fixture()['shader-studio:kaggle'].length);
  });
});
