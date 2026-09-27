/**
 * The workspace folder: the layout (every kind as files and back), names that
 * work everywhere, and the sync engine's rules against an in-memory folder —
 * new / changed / changed on both sides / deleted (with tombstones), the
 * waiting changes surviving a restart, a drive pulled out mid-write, two
 * apps editing the same graph, and the first connection merging what's there.
 */
import { describe, it, expect } from 'vitest';
import { memoryKV } from '../../files/mutate';
import { applyMembership, decodeAreas, encodeTree, AREAS, FOLDERS_KEY, type ImageMeta, type ImageStore } from '../layout';
import { conflictPath, labelMatchesBase, nameFor, safeName, splitPath, uniqueName } from '../names';
import { memoryFs, handleFs, type MemoryFs, type DirHandleLike, type FileHandleLike } from '../fs';
import { newState, SyncEngine, type SyncState } from '../engine';

// ── Fixtures ────────────────────────────────────────────────────────────────

const graph = (o: Record<string, unknown> = {}) => JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }], looseGroups: [], layout: 2, savedAt: 3000, version: 3, ...o });
const presentation = (title: string, o: Record<string, unknown> = {}) => JSON.stringify({ version: 1, title, createdAt: 1, updatedAt: 9000, steps: [{ id: 's1', columns: 1, blocks: [{ type: 'text', id: 'b0', markdown: 'hi' }] }], sources: [], ...o });

function folders(scopes: Record<string, Array<[string, string, string[]]>>): string {
  const out: Record<string, { folders: unknown[]; membership: Record<string, string> }> = {};
  for (const [scope, list] of Object.entries(scopes)) {
    out[scope] = { folders: list.map(([id, label]) => ({ id, label, collapsed: false, createdAt: 1 })), membership: {} };
    for (const [id, , items] of list) for (const it of items) out[scope].membership[it] = id;
  }
  return JSON.stringify(out);
}

function fixture(): Record<string, string> {
  return {
    'shader-studio:Sunset': graph({ play: { version: 1, layers: [{ id: 'L1', kind: 'script', kindId: 'k1' }], layerKinds: [{ id: 'k1', name: 'Rain' }], takes: [{ id: 't1', name: 'Take 1', length: 2, tracks: [] }] }, datasets: { rain: { id: 'rain', name: 'Rain' } } }),
    'shader-studio-versions:Sunset': JSON.stringify([1, 2].map(v => ({ version: v, savedAt: v * 1000, payload: graph({ version: v, savedAt: v * 1000 }) }))),
    'shader-studio:a/b: c?': graph(),
    'shader-studio:Foo': graph({ savedAt: 1 }),
    'shader-studio:foo': graph({ savedAt: 2 }),
    'shader-studio-presentation:Lesson one': presentation('Lesson one'),
    'shader-studio:glsl-shaders': JSON.stringify([
      { id: 'g1', name: 'Plasma', code: 'void main(){}', group: 'Warm', note: 'glows' },
      { id: 'g2', name: 'Lines', code: 'void main(){ /* x */ }' },
    ]),
    'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Wobble', inputs: [], outputType: 'float', body: 'sin(x)', glslFunctions: '', savedAt: 5 }),
    'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Stack', nodes: [], savedAt: 6 }),
    'shader-studio:ep:ep_1': JSON.stringify({ id: 'ep_1', label: 'Pulse', expr: 'sin(t)', savedAt: 7 }),
    'shader-studio:tp:tp_1': JSON.stringify({ id: 'tp_1', label: 'Spin', savedAt: 8 }),
    'shader-studio:kfp:kfp_1': JSON.stringify({ id: 'kfp_1', label: 'Ease', savedAt: 9 }),
    'shader-studio:un:un_wobble': JSON.stringify({ label: 'Wobble node', category: 'Custom', inputs: [], outputs: [], savedAt: 10 }),
    'shader-studio:play:savedScripts': JSON.stringify([{ id: 'sk1', name: 'Rain sketch', code: 'draw()', clear: true, readPicture: false, mode: '2d', savedAt: 1 }]),
    'shader-studio:play:layerKinds': JSON.stringify([{ id: 'kind1', name: 'Sparkles', code: 'x', paramDefs: [] }]),
    'fn_builder_saved_fns_v1': JSON.stringify([{ id: 'fn_1', name: 'f1', returnType: 'float', body: 'x' }]),
    'fn_builder_groups_v1': JSON.stringify([{ id: 'grp_1', name: 'Waves', savedAt: 1, tabs: [] }]),
    'shader-studio:palette-presets': JSON.stringify([{ id: 'pp1', name: 'Sunset', kind: 'stops', stops: [[1, 0, 0]], savedAt: 1 }]),
    'shader-studio-backgrounds:palettes': JSON.stringify([{ id: 'bp1', name: 'Dusk', stops: [], style: 'gradient', createdAt: 1 }]),
    [FOLDERS_KEY]: folders({
      graphs: [['f1', 'Tests', ['Sunset']]],
      presentations: [['f2', 'Class', ['Lesson one']]],
      functions: [['f3', 'Mine', ['cfp_1']]],
      layerKinds: [['f4', 'Fx', ['kind1']]],
      'backgrounds:palettes': [['f5', 'Evening', ['bp1']]],
      'backgrounds:images': [['f6', 'Shots', ['img_1']]],
    }),
    // Settings stay with each app.
    'shader-studio:theme': '"dark"',
    'shader-studio:kaggle': '{"user":"x"}',
    'shader-studio:discover:learned-roles': '{}',
    'nodepalette_favorites': '[]',
  };
}

function memoryImages(init: Array<[ImageMeta, Uint8Array]> = []): ImageStore & { data: Map<string, { meta: ImageMeta; bytes: Uint8Array }> } {
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
const img = (id: string, name: string, n = 3): [ImageMeta, Uint8Array] => [{ id, name, type: 'image/png', width: 4, height: 4, createdAt: 1, bytes: n }, new Uint8Array(n).fill(7)];

const parsed = (v: string | null | undefined) => (v == null ? v : JSON.parse(v));
const labelsOf = (kv: { get(k: string): string | null }, scope: string) => {
  const s = parsed(kv.get(FOLDERS_KEY))?.[scope];
  const out: Record<string, string> = {};
  for (const [id, fid] of Object.entries((s?.membership ?? {}) as Record<string, string>)) out[id] = s.folders.find((f: { id: string }) => f.id === fid)?.label;
  return out;
};

function engine(kv: ReturnType<typeof memoryKV>, fs: MemoryFs, state: SyncState, images: ImageStore | null = null, saved?: { s: string }) {
  return new SyncEngine({ kv, fs, images, state, saveState: async s => { if (saved) saved.s = JSON.stringify(s); }, now: () => fs.clock.now });
}

// ── Names ───────────────────────────────────────────────────────────────────

describe('names', () => {
  it('makes names every file system accepts', () => {
    expect(safeName('a/b: c?')).toBe('a-b- c-');
    expect(safeName('  .hidden  ')).toBe('hidden');
    expect(safeName('trailing dots...')).toBe('trailing dots');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('lpt1.txt')).toBe('lpt1.txt_');
    expect(safeName('')).toBe('Untitled');
    expect(safeName('tab\there\nnew')).toBe('tabherenew');
    expect(safeName('é')).toBe('é'); // NFC
    const long = safeName('日本'.repeat(200));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(150);
  });
  it('avoids collisions without case', () => {
    const t = new Set<string>();
    expect(uniqueName('graphs', 'Foo', '.graph.json', t)).toBe('Foo');
    expect(uniqueName('graphs', 'foo', '.graph.json', t)).toBe('foo (2)');
    expect(uniqueName('graphs', 'FOO', '.graph.json', t)).toBe('FOO (3)');
  });
  it('knows a stored name still names its file', () => {
    expect(labelMatchesBase('a/b', 'a-b')).toBe(true);
    expect(labelMatchesBase('a/b', 'a-b (2)')).toBe(true);
    expect(labelMatchesBase('a/b', 'a-b copy')).toBe(false);
    expect(nameFor('a/b', 'a-b')).toBe('a/b');
    expect(nameFor('a/b', 'a-b (conflict, 2026-09-27 14.05)')).toBe('a/b (conflict, 2026-09-27 14.05)');
    expect(nameFor('a/b', 'Renamed in Finder')).toBe('Renamed in Finder');
  });
  it('splits and marks conflict copies', () => {
    expect(splitPath('graphs/T/Foo.graph.json')).toEqual({ dir: 'graphs/T', base: 'Foo', ext: '.graph.json' });
    const p = conflictPath('graphs/Foo.graph.json', new Date(2026, 8, 27, 14, 5).getTime(), new Set());
    expect(p).toBe('graphs/Foo (conflict, 2026-09-27 14.05).graph.json');
  });
});

// ── Layout ──────────────────────────────────────────────────────────────────

describe('layout', () => {
  it('writes every kind where the docs say, and no settings', async () => {
    const kv = memoryKV(fixture());
    const { tree } = await encodeTree(kv, memoryImages([img('img_1', 'Sky')]));
    const paths = [...tree.keys()].sort();
    expect(paths).toEqual(expect.arrayContaining([
      'graphs/Tests/Sunset.graph.json',
      'graphs/.versions/Sunset/v1.graph.json',
      'graphs/.versions/Sunset/v2.graph.json',
      'graphs/a-b- c-.graph.json',
      'graphs/Foo.graph.json',
      'graphs/foo (2).graph.json',
      'presentations/Class/Lesson one.present.json',
      'glsl/Warm/Plasma.glsl', 'glsl/Warm/Plasma.glsl.json', 'glsl/Lines.glsl', 'glsl/Lines.glsl.json',
      'functions/Mine/Wobble.fn.json',
      'functions/Function Builder/f1.builder.json',
      'functions/Function Builder/Waves.builder-group.json',
      'presets/group/Stack.json', 'presets/expressions/Pulse.json', 'presets/transforms/Spin.json', 'presets/keyframes/Ease.json',
      'presets/palettes/Sunset.palette.json',
      'published-nodes/Wobble node.node.json',
      'scripts/sketches/Rain sketch.sketch.json',
      'scripts/layer-kinds/Fx/Sparkles.kind.json',
      'backgrounds/palettes.json', 'backgrounds/images.json', 'backgrounds/images/img_1.png',
    ]));
    expect(paths.some(p => /theme|kaggle|roles|favorites/i.test(p))).toBe(false);
    // A name the file system can't hold is kept inside the file.
    expect(JSON.parse(tree.get('graphs/a-b- c-.graph.json')!.text!).workspaceName).toBe('a/b: c?');
    expect(JSON.parse(tree.get('graphs/foo (2).graph.json')!.text!).workspaceName).toBe('foo');
    expect(JSON.parse(tree.get('graphs/Foo.graph.json')!.text!).workspaceName).toBeUndefined();
    // The GLSL code is the plain file.
    expect(tree.get('glsl/Warm/Plasma.glsl')!.text).toBe('void main(){}');
    // A presentation opens anywhere as a .present.json.
    expect(JSON.parse(tree.get('presentations/Class/Lesson one.present.json')!.text!).kind).toBe('shader-studio-presentation');
  });

  it('round-trips every kind: files back into exactly the same things', async () => {
    const src = memoryKV(fixture());
    const images = memoryImages([img('img_1', 'Sky')]);
    const enc = await encodeTree(src, images);
    // Into an empty cache (settings only).
    const dst = memoryKV({ 'shader-studio:theme': '"light"' });
    const dstImages = memoryImages();
    const ch = decodeAreas(AREAS, enc.tree, dst, { keys: new Map(), images: new Map() });
    for (const [k, v] of ch.set) dst.set(k, v);
    const f = applyMembership(dst, ch.membership, 1);
    if (f) dst.set(FOLDERS_KEY, f);
    for (const { meta, entry } of ch.images.put) await dstImages.put(meta, entry.bytes ?? await entry.load!());
    for (const [k, v] of Object.entries(fixture())) {
      if (k === FOLDERS_KEY || /theme|kaggle|roles|favorites/.test(k)) continue;
      // Lists come back with the same items; their order is the cache's own business.
      const byId = (x: unknown) => (Array.isArray(x) ? [...x].sort((a, b) => String(a.id).localeCompare(String(b.id))) : x);
      expect(byId(parsed(dst.get(k))), k).toEqual(byId(parsed(v)));
    }
    for (const scope of ['graphs', 'presentations', 'functions', 'layerKinds', 'backgrounds:palettes', 'backgrounds:images']) expect(labelsOf(dst, scope), scope).toEqual(labelsOf(src, scope));
    expect(dst.get('shader-studio:theme')).toBe('"light"');
    expect([...dstImages.data.keys()]).toEqual(['img_1']);
    expect(dstImages.data.get('img_1')!.meta.name).toBe('Sky');
    // And the same files again.
    const again = await encodeTree(dst, dstImages);
    expect([...again.tree.keys()].sort()).toEqual([...enc.tree.keys()].sort());
    for (const [p, e] of enc.tree) if (p !== 'backgrounds/images.json') expect(again.tree.get(p)!.hash, p).toBe(e.hash);
  });

  it('reads files made by hand: a new graph, a shader without details, a renamed file', async () => {
    const kv = memoryKV({});
    const tree = new Map([
      ['graphs/Hand made.graph.json', { hash: 'x', text: graph() }],
      ['glsl/Mine/Hello.glsl', { hash: 'y', text: 'void main(){}' }],
      ['functions/Renamed.fn.json', { hash: 'z', text: JSON.stringify({ id: 'cfp_9', label: 'Old name', body: 'x' }) }],
    ]);
    const ch = decodeAreas(AREAS, tree, kv, { keys: new Map(), images: new Map() });
    expect(ch.set.has('shader-studio:Hand made')).toBe(true);
    const sh = JSON.parse(ch.set.get('shader-studio:glsl-shaders')!);
    expect(sh[0]).toMatchObject({ name: 'Hello', group: 'Mine', code: 'void main(){}' });
    expect(JSON.parse(ch.set.get('shader-studio:cfp:cfp_9')!).label).toBe('Renamed');
  });

  it('a presentation new to this app whose Plays run scripts comes in sandboxed; one it had keeps its mark', async () => {
    const withScript = JSON.stringify({ ...JSON.parse(presentation('Scripted')), kind: 'shader-studio-presentation', sources: [{ id: 's1', title: 'P', from: { kind: 'example', key: 'x' }, bundle: { play: { layers: [{ id: 'L', kind: 'script', name: 'S', code: 'x' }] } }, capturedAt: 1 }] });
    const kv = memoryKV({});
    const tree = new Map([['presentations/Scripted.present.json', { hash: 'x', text: withScript }]]);
    const ch = decodeAreas(['presentations'], tree, kv, { keys: new Map(), images: new Map() });
    expect(JSON.parse(ch.set.get('shader-studio-presentation:Scripted')!).origin).toBe('imported');
    const mine = memoryKV({ 'shader-studio-presentation:Scripted': JSON.stringify({ ...JSON.parse(withScript), kind: undefined }) });
    const ch2 = decodeAreas(['presentations'], tree, mine, { keys: new Map([['presentations', new Set(['shader-studio-presentation:Scripted'])]]) as never, images: new Map() });
    expect(JSON.parse(ch2.set.get('shader-studio-presentation:Scripted')!).origin).toBeUndefined();
    // And the mark never goes into the file.
    const enc = await encodeTree(memoryKV({ 'shader-studio-presentation:Scripted': JSON.stringify({ ...JSON.parse(presentation('Scripted')), origin: 'imported' }) }), null);
    expect(JSON.parse(enc.tree.get('presentations/Scripted.present.json')!.text!).origin).toBeUndefined();
  });

  it('never lets a file named like a setting overwrite it', async () => {
    const kv = memoryKV({ 'shader-studio:glsl-shaders': '[]' });
    const tree = new Map([['graphs/glsl-shaders.graph.json', { hash: 'x', text: graph() }]]);
    const ch = decodeAreas(['graphs'], tree, kv, { keys: new Map(), images: new Map() });
    expect(ch.set.has('shader-studio:glsl-shaders')).toBe(false);
    expect(ch.set.has('shader-studio:glsl-shaders (2)')).toBe(true);
  });
});

// ── Sync ────────────────────────────────────────────────────────────────────

describe('sync engine', () => {
  it('first connection writes everything; a second pass has nothing to do', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'), memoryImages([img('img_1', 'Sky')]));
    const r = await e.sync();
    expect(r.wrote).toBeGreaterThan(20);
    expect(fs.files.has('graphs/Tests/Sunset.graph.json')).toBe(true);
    expect(fs.files.has('backgrounds/images/img_1.png')).toBe(true);
    const r2 = await e.sync();
    expect(r2).toMatchObject({ wrote: 0, removed: 0, pulled: 0 });
    expect(await e.pending()).toEqual([]);
  });

  it('brings in new and changed files from the folder, and deletions', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    fs.put('graphs/From Finder.graph.json', graph({ savedAt: 77 }));
    fs.put('graphs/Foo.graph.json', graph({ savedAt: 99 }));
    fs.files.delete('presets/keyframes/Ease.json');
    const r = await e.sync();
    expect(r.pulled).toBe(2);
    expect(parsed(kv.get('shader-studio:From Finder')).savedAt).toBe(77);
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(99);
    expect(kv.get('shader-studio:kfp:kfp_1')).toBeNull();
    expect(r.changedKeys).toEqual(expect.arrayContaining(['shader-studio:From Finder', 'shader-studio:Foo', 'shader-studio:kfp:kfp_1']));
  });

  it('moving a file to another folder in Finder moves it in the app', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    const f = fs.files.get('graphs/Foo.graph.json')!;
    fs.files.delete('graphs/Foo.graph.json');
    fs.put('graphs/Tests/Foo.graph.json', f.data);
    await e.sync();
    expect(kv.get('shader-studio:Foo')).not.toBeNull();
    expect(labelsOf(kv, 'graphs').Foo).toBe('Tests');
    expect((await e.sync()).wrote).toBe(0);
  });

  it('a graph renamed in Finder keeps its earlier versions', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    const f = fs.files.get('graphs/Tests/Sunset.graph.json')!;
    fs.files.delete('graphs/Tests/Sunset.graph.json');
    fs.put('graphs/Tests/Dawn.graph.json', f.data);
    await e.sync();
    expect(kv.get('shader-studio:Sunset')).toBeNull();
    expect(parsed(kv.get('shader-studio-versions:Dawn'))).toHaveLength(2);
    await e.sync();
    expect(fs.files.has('graphs/.versions/Dawn/v1.graph.json')).toBe(true);
    expect(fs.files.has('graphs/.versions/Sunset/v1.graph.json')).toBe(false);
  });

  it('writes local changes and deletions (with a tombstone)', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    kv.set('shader-studio:Foo', graph({ savedAt: 123 }));
    kv.remove('shader-studio:ep:ep_1');
    expect((await e.pending()).map(p => p.action).sort()).toEqual(['delete', 'write']);
    const r = await e.sync();
    expect(r).toMatchObject({ wrote: 1, removed: 1 });
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('graphs/Foo.graph.json')!.data)).savedAt).toBe(123);
    expect(fs.files.has('presets/expressions/Pulse.json')).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('.shader-studio/deleted.json')!.data)).deleted['presets/expressions/Pulse.json']).toBeTruthy();
  });

  it('both sides changed: keeps both, the newer under the name, and resolves', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    kv.set('shader-studio:Foo', graph({ savedAt: 111 }));
    await e.pending(); // seen now
    fs.put('graphs/Foo.graph.json', graph({ savedAt: 222 })); // later
    const r = await e.sync();
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c.kept).toBe('folder');
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(222);
    const copyName = c.copyPath.slice('graphs/'.length, -'.graph.json'.length);
    expect(copyName).toMatch(/^Foo \(conflict, \d{4}-\d\d-\d\d \d\d\.\d\d\)$/);
    expect(parsed(kv.get(`shader-studio:${copyName}`)).savedAt).toBe(111);
    expect(fs.files.has(c.copyPath)).toBe(true);
    expect(e.state.conflicts).toHaveLength(1);
    expect(c.label).toBe('Foo');
    expect(c.copyLabel).toBe(copyName);
    // Keep the other one: it takes the name, the copy goes (here and, next pass, in the folder).
    await e.resolve(c.id, 'other');
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(111);
    expect(kv.get(`shader-studio:${copyName}`)).toBeNull();
    await e.sync();
    expect(fs.files.has(c.copyPath)).toBe(false);
    expect(e.state.conflicts).toHaveLength(0);
  });

  it('keep this / keep both', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    fs.put('presentations/Class/Lesson one.present.json', JSON.stringify({ ...parsed(presentation('Lesson one')), kind: 'shader-studio-presentation', updatedAt: 1 }));
    fs.clock.now += 5000;
    kv.set('shader-studio-presentation:Lesson one', presentation('Lesson one', { updatedAt: 2 }));
    const r = await e.sync();
    expect(r.conflicts[0].kept).toBe('here');
    expect(parsed(kv.get('shader-studio-presentation:Lesson one')).updatedAt).toBe(2);
    const copyKey = [...kv.data.keys()].find(k => k.includes('Lesson one (conflict'))!;
    expect(parsed(kv.get(copyKey)).title).toBe(copyKey.slice('shader-studio-presentation:'.length));
    await e.resolve(r.conflicts[0].id, 'this');
    expect(kv.get(copyKey)).toBeNull();
    // Keep both: nothing changes, the conflict is just no longer listed.
    kv.set('shader-studio:Foo', graph({ savedAt: 5 }));
    await e.pending();
    fs.put('graphs/Foo.graph.json', graph({ savedAt: 6 }));
    const r2 = await e.sync();
    await e.resolve(r2.conflicts[0].id, 'both');
    expect(e.state.conflicts).toHaveLength(0);
    expect([...kv.data.keys()].filter(k => k.startsWith('shader-studio:Foo'))).toHaveLength(2);
  });

  it('edited on one side and deleted on the other: the edit wins', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    kv.set('shader-studio:Foo', graph({ savedAt: 5 }));
    fs.files.delete('graphs/Foo.graph.json');
    await e.sync();
    expect(fs.files.has('graphs/Foo.graph.json')).toBe(true);
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(5);
  });

  it('what waits to sync survives a restart, and nothing is lost while the drive is out', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const saved = { s: '' };
    const e1 = engine(kv, fs, newState('w1'), null, saved);
    await e1.sync();
    fs.setGone(true);
    kv.set('shader-studio:Foo', graph({ savedAt: 42 }));
    await expect(e1.sync()).rejects.toMatchObject({ code: 'gone' });
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(42);
    expect(kv.get('shader-studio:Sunset')).not.toBeNull();
    // Restart: a new engine from the saved state.
    const e2 = engine(kv, fs, JSON.parse(saved.s), null, saved);
    expect((await e2.pending()).map(p => p.path)).toEqual(['graphs/Foo.graph.json']);
    fs.setGone(false);
    const r = await e2.sync();
    expect(r.wrote).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('graphs/Foo.graph.json')!.data)).savedAt).toBe(42);
  });

  it('a drive pulled out mid-write: what was written is kept, the rest waits, then syncs', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const saved = { s: '' };
    const e = engine(kv, fs, newState('w1'), null, saved);
    fs.failWritesAfter(3);
    await expect(e.sync()).rejects.toMatchObject({ code: 'gone' });
    expect(Object.keys(e.state.base)).toHaveLength(3);
    const before = [...kv.data.entries()];
    fs.failWritesAfter(null);
    fs.setGone(false);
    const e2 = engine(kv, fs, JSON.parse(saved.s), null, saved);
    const pending = (await e2.pending()).length;
    expect(pending).toBeGreaterThan(10);
    const r = await e2.sync();
    expect(r.wrote).toBeGreaterThanOrEqual(pending);
    expect(await e2.pending()).toEqual([]);
    expect([...kv.data.entries()]).toEqual(before);
  });

  it('two apps edit the same graph: the second to sync gets a conflict copy, then both have both', async () => {
    const fs = memoryFs();
    const a = memoryKV(fixture()), b = memoryKV({});
    const ea = engine(a, fs, newState('w1'));
    const eb = engine(b, fs, newState('w1'));
    await ea.sync();
    await eb.sync();
    expect(b.get('shader-studio:Sunset')).toBe(a.get('shader-studio:Sunset'));
    a.set('shader-studio:Sunset', graph({ savedAt: 1 }));
    await ea.pending();
    fs.clock.now += 1000;
    b.set('shader-studio:Sunset', graph({ savedAt: 2 }));
    await eb.pending();
    await ea.sync();
    const rb = await eb.sync();
    expect(rb.conflicts).toHaveLength(1);
    await ea.sync();
    const both = (kv: typeof a) => [...kv.data.keys()].filter(k => k.startsWith('shader-studio:Sunset')).sort();
    expect(both(a)).toEqual(both(b));
    expect(both(a)).toHaveLength(2);
  });

  it('first connection to a folder that already has things: merges, never deletes', async () => {
    const fs = memoryFs();
    const other = memoryKV({ 'shader-studio:Elsewhere': graph(), 'shader-studio:Foo': graph({ savedAt: 555 }) });
    await engine(other, fs, newState('w1')).sync();
    const kv = memoryKV(fixture());
    const e = engine(kv, fs, newState('w1'));
    const r = await e.sync();
    expect(kv.get('shader-studio:Elsewhere')).not.toBeNull();
    expect(kv.get('shader-studio:Sunset')).not.toBeNull();
    expect(fs.files.has('graphs/Tests/Sunset.graph.json')).toBe(true);
    // Foo differed: both kept.
    expect(r.conflicts.map(c => c.label)).toEqual(['Foo']);
    expect([...kv.data.keys()].filter(k => k.startsWith('shader-studio:Foo ('))).toHaveLength(1);
    expect(r.removed).toBe(0);
  });

  it('an app that lost its record follows a deletion made elsewhere (tombstone), but a first connection never deletes', async () => {
    const fs = memoryFs();
    const a = memoryKV(fixture()), b = memoryKV(fixture());
    const ea = engine(a, fs, newState('w1'));
    const eb = engine(b, fs, newState('w1'));
    await ea.sync(); await eb.sync();
    a.remove('shader-studio:tp:tp_1');
    await ea.sync();
    // b lost its base but had synced before.
    const lost = { ...newState('w1'), lastSyncAt: 1 };
    await engine(b, fs, lost).sync();
    expect(b.get('shader-studio:tp:tp_1')).toBeNull();
    // A brand-new app with the same thing: kept, and put back in the folder.
    const c = memoryKV({ 'shader-studio:tp:tp_1': fixture()['shader-studio:tp:tp_1'] });
    await engine(c, fs, newState('w1')).sync();
    expect(c.get('shader-studio:tp:tp_1')).not.toBeNull();
    expect(fs.files.has('presets/transforms/Spin.json')).toBe(true);
  });

  it('an unreadable file is skipped: not a deletion, not overwritten', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    fs.put('graphs/Foo.graph.json', '{"nodes": [ half written');
    kv.set('shader-studio:Foo', graph({ savedAt: 8 }));
    const r = await e.sync();
    expect(r.problems.join()).toMatch(/Foo.graph.json/);
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(8);
    expect(new TextDecoder().decode(fs.files.get('graphs/Foo.graph.json')!.data)).toContain('half written');
    fs.put('graphs/Foo.graph.json', graph({ savedAt: 9 }));
    await e.sync();
    expect(parsed(kv.get('shader-studio:Foo')).savedAt).toBe(9);
  });

  it('holds back a mass deletion (an emptied folder) until asked', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    for (const p of [...fs.files.keys()]) if (p !== 'workspace.json') fs.files.delete(p);
    const r = await e.sync();
    expect(r.held).toBeGreaterThan(10);
    expect(kv.get('shader-studio:Sunset')).not.toBeNull();
    const r2 = await e.sync({ allowMassDelete: true });
    expect(r2.held).toBe(0);
    expect(kv.get('shader-studio:Sunset')).toBeNull();
  });

  it('this app’s storage cleared: the folder is never emptied without a yes, and things come back', async () => {
    const kv = memoryKV(fixture());
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'));
    await e.sync();
    const files = fs.files.size;
    for (const k of [...kv.data.keys()]) kv.remove(k);
    const r = await e.sync();
    expect(r.heldHere).toBeGreaterThan(10);
    expect(r.removed).toBe(0);
    expect(fs.files.size).toBe(files);
    await e.restoreFromFolder();
    await e.sync();
    expect(kv.get('shader-studio:Sunset')).not.toBeNull();
    expect(labelsOf(kv, 'graphs').Sunset).toBe('Tests');
    expect(fs.files.size).toBe(files);
  });

  it('syncs background images both ways', async () => {
    const kv = memoryKV({});
    const images = memoryImages([img('img_1', 'Sky')]);
    const fs = memoryFs();
    const e = engine(kv, fs, newState('w1'), images);
    await e.sync();
    fs.put('backgrounds/images/dropped.png', new Uint8Array([1, 2, 3]));
    await e.sync();
    expect(images.data.get('dropped')?.meta.name).toBe('dropped');
    await images.remove('img_1');
    await e.sync();
    expect(fs.files.has('backgrounds/images/img_1.png')).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(fs.files.get('backgrounds/images.json')!.data)).images.map((x: { id: string }) => x.id)).toEqual(['dropped']);
  });
});

// ── The directory-handle backend (what Chrome's picked folder and OPFS give) ──

function fakeDir(name: string): DirHandleLike & { tree: Map<string, unknown> } {
  const tree = new Map<string, unknown>();
  const dir = (m: Map<string, unknown>, n: string): DirHandleLike & { tree: Map<string, unknown> } => ({
    kind: 'directory', name: n, tree: m,
    async getDirectoryHandle(x, o) { let d = m.get(x) as Map<string, unknown> | undefined; if (!d) { if (!o?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); d = new Map(); m.set(x, d); } if (!(d instanceof Map)) throw new Error('not a dir'); return dir(d, x); },
    async getFileHandle(x, o) {
      if (!m.has(x)) { if (!o?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); m.set(x, { data: new Uint8Array(), mtime: Date.now() }); }
      const rec = m.get(x) as { data: Uint8Array; mtime: number };
      const fh: FileHandleLike = {
        kind: 'file', name: x,
        async getFile() { return Object.assign(new Blob([rec.data.slice()]), { lastModified: rec.mtime, name: x }) as unknown as File; },
        async createWritable() { let buf = new Uint8Array(); return { async write(d: BufferSource | Blob | string) { buf = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d as ArrayBuffer); }, async close() { rec.data = buf; rec.mtime = Date.now(); } }; },
      };
      return fh;
    },
    async removeEntry(x) { if (!m.has(x)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); m.delete(x); },
    async *entries() { for (const [k, v] of m) yield [k, v instanceof Map ? dir(v, k) : await this.getFileHandle(k)] as [string, DirHandleLike | FileHandleLike]; },
  });
  return dir(tree, name);
}

describe('directory-handle backend', () => {
  it('writes, lists, reads and removes (tidying empty folders)', async () => {
    const root = fakeDir('Shader Studio');
    const fs = handleFs(root);
    expect(await fs.probe()).toBe('ok');
    await fs.write('graphs/Tests/Foo.graph.json', '{"nodes":[]}');
    await fs.write('workspace.json', '{}');
    const l = await fs.list(['graphs'], ['workspace.json']);
    expect([...l.keys()].sort()).toEqual(['graphs/Tests/Foo.graph.json', 'workspace.json']);
    expect(await fs.readText('graphs/Tests/Foo.graph.json')).toBe('{"nodes":[]}');
    await fs.remove('graphs/Tests/Foo.graph.json');
    expect(root.tree.get('graphs')).toBeInstanceOf(Map);
    expect((root.tree.get('graphs') as Map<string, unknown>).has('Tests')).toBe(false);
    await expect(fs.readText('graphs/Tests/Foo.graph.json')).rejects.toMatchObject({ code: 'gone' });
  });
});
