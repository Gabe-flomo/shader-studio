/**
 * .playfile exports and imports end to end on a map: what an export bundles
 * (dependencies, sealed nodes kept sealed), the import preview (new, already
 * here, clashes) and keep-both / replace, every kind's round trip, signing
 * on import, links between graphs and presentations, the Free/Pro matrix,
 * and the older formats still opening. Plus a sealed node compiling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { unwrapContainer, wrapContainer } from '../container';
import type { UserNodeDefinition } from '../../types/userNode';
import type { GraphNode } from '../../types/nodeGraph';
import { buildInventory } from '../../files/inventory';
import { memoryKV } from '../../files/mutate';
import { buildProfileZip, installMerge, readProfile } from '../../files/profileZip';
import { isLibraryKey, type LibrarySnapshot } from '../../utils/library';
import { canOn } from '../../lib/plan';
import { buildBundle } from '../bundle';
import { writePlayfile } from '../writer';
import { isPlayfile, readPlayfile } from '../reader';
import { applyImport, planImport, renameNode, type ImportEnv } from '../importer';
import { newSeed, publicKeyOf, signerFromSeed } from '../signing';
import { sealDefinition, unsealDefinition } from '../sealing';
import { compileGraph } from '../../compiler/graphCompiler';
import { exportUserNodes, getUserNode, importUserNodes, redactSealedCode, registerUserNode, resetUserNodesForTests, containsSealedCode } from '../../nodes/userNodes/userNodeRegistry';

const SECRET = 'secretWobbleValue';
const NODE: UserNodeDefinition = {
  id: 'un_wobble_abc', label: 'Wobble', category: 'My Nodes',
  inputs: [{ key: 'uv', type: 'vec2', label: 'UV' }], outputs: [{ key: 'color', type: 'vec3', label: 'Color' }],
  params: [{ key: 'amt', label: 'Amount', min: 0, max: 1, default: 0.5 }],
  fnName: 'un_wobble_abc',
  functionCode: `vec3 un_wobble_abc(vec2 uv, float amt) {\n  // the secret sauce\n  float ${SECRET} = sin(uv.x * 17.0) * amt;\n  return vec3(un_wobble_abc_h(${SECRET}));\n}`,
  helperFunctions: ['float un_wobble_abc_h(float x) { return x * 3.0; }'],
  implicitGlobals: [], version: 1, savedAt: 1,
  source: { kind: 'code', code: 'vec3 f(vec2 uv){ return vec3(secretSourceText); }', entry: 'f' },
};

const graph = (o: Record<string, unknown> = {}) => JSON.stringify({
  nodes: [{ id: 'n1', type: 'output', params: {} }, { id: 'n2', type: 'un_wobble_abc', params: {} }, { id: 'n3', type: 'customFn', params: { body: 'return sin(uv.x * 6.0);' } }],
  version: 2, savedAt: 1, ...o,
});
const presentation = (title: string, o: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, title, createdAt: 1, updatedAt: 2,
  steps: [{ id: 's1', columns: 1, blocks: [{ type: 'text', id: 'b0', markdown: 'hi' }] }],
  sources: [{ id: 'src1', title: 'Sunset', from: { kind: 'saved', name: 'Sunset', savedAt: 1 }, bundle: { play: { layers: [] } }, capturedAt: 1 }],
  ...o,
});

function fixture(): Record<string, string> {
  return {
    'shader-studio:Sunset': graph(),
    'shader-studio:Plain': JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }] }),
    'shader-studio:un:un_wobble_abc': JSON.stringify(NODE),
    'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Stripes', inputs: [], outputType: 'float', body: 'return sin(uv.x * 6.0);', glslFunctions: '', savedAt: 10 }),
    'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Glow stack', subgraph: { nodes: [] }, savedAt: 20 }),
    'shader-studio-presentation:Lesson': presentation('Lesson'),
    'shader-studio:glsl-shaders': JSON.stringify([{ id: 'g1', name: 'Plasma', code: 'void main(){ gl_FragColor = vec4(1.0); }', group: 'Tests', note: 'bright' }]),
    'shader-studio:theme': 'dark',
  };
}

/** A fresh "other machine": its own storage and node registry. */
function machine(init: Record<string, string> = {}, opts: { pro?: boolean } = {}) {
  const kv = memoryKV(init);
  const nodes = new Map<string, UserNodeDefinition>();
  for (const [k, v] of Object.entries(init)) if (k.startsWith('shader-studio:un:')) { const d = JSON.parse(v) as UserNodeDefinition; nodes.set(d.id, d); }
  const images: Array<{ name: string; bytes: Uint8Array; type: string }> = [];
  let n = 0;
  const env: ImportEnv = {
    kv,
    can: () => opts.pro ?? true,
    userNode: id => nodes.get(id),
    nodeLabels: () => [...nodes.values()].map(d => d.label),
    registerNode: async def => { nodes.set(def.id, def); kv.set(`shader-studio:un:${def.id}`, JSON.stringify(def)); return { ok: true }; },
    makeNodeId: label => `un_${label.toLowerCase().replace(/\W+/g, '_')}_${++n}`,
    backgrounds: async () => images.map(i => ({ name: i.name, bytes: i.bytes.length })),
    addBackground: async (bytes, type, name) => { images.push({ bytes, type, name }); },
    installProfile: async p => installMerge(p, kv),
    now: () => 5000,
  };
  return { kv, env, nodes, images };
}

async function exportFrom(init: Record<string, string>, ids: string[], opts: Parameters<typeof buildBundle>[3] = {}, sign = false) {
  const kv = memoryKV(init);
  const inv = await buildInventory(kv);
  const b = await buildBundle(kv, inv, ids, opts, {
    backgroundFile: async (_s, id) => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, id.length]), type: 'image/png', name: `Image ${id}` }),
  });
  const seed = newSeed();
  const signer = sign ? signerFromSeed(seed, await publicKeyOf(seed)) : null;
  const w = await writePlayfile(b.items, { author: 'Ada', signer });
  return { bundle: b, bytes: w.bytes, manifest: w.manifest };
}

async function importInto(m: ReturnType<typeof machine>, bytes: Uint8Array, picks = {}) {
  const contents = await readPlayfile(bytes);
  const plan = await planImport(contents, m.env);
  return { plan, summary: await applyImport(plan, picks, m.env) };
}

describe('graph export bundles what it uses', () => {
  it('a graph brings its published node (a dependency, even on Free) and the custom function preset it uses', async () => {
    const { bundle } = await exportFrom(fixture(), ['graph:Sunset'], { canPack: false });
    expect(bundle.items.map(i => i.kind).sort()).toEqual(['graph', 'library', 'nodes']);
    const nodes = JSON.parse(bundle.items.find(i => i.kind === 'nodes')!.data as string);
    expect(nodes.nodes.map((d: UserNodeDefinition) => d.id)).toEqual(['un_wobble_abc']);
    const lib = JSON.parse(bundle.items.find(i => i.kind === 'library')!.data as string) as LibrarySnapshot;
    expect(Object.keys(lib.items)).toEqual(['shader-studio:cfp:cfp_1']);
    expect(bundle.notes.join(' ')).toMatch(/Came along: 1 published node, 1 custom function/);
    // The graph file is readable and has no save stamps.
    const g = JSON.parse(bundle.items.find(i => i.kind === 'graph')!.data as string);
    expect(g.version).toBeUndefined();
    expect(g.nodes).toHaveLength(3);
  });

  it('as a Play setup it is a play item, with the play file kind', async () => {
    const { bundle } = await exportFrom(fixture(), ['graph:Sunset'], { asPlay: new Set(['graph:Sunset']), dependencies: false });
    expect(bundle.items.map(i => i.kind)).toEqual(['play']);
    expect(JSON.parse(bundle.items[0].data as string).kind).toBe('shader-studio-play');
  });

  it('a sealed node a graph uses goes in sealed, never unsealed', async () => {
    const init = { ...fixture(), 'shader-studio:un:un_wobble_abc': JSON.stringify(sealDefinition(NODE)) };
    const { bytes } = await exportFrom(init, ['graph:Sunset']);
    // The v2 envelope hides everything; the ZIP inside is what an older reader (or someone with the key) sees.
    for (const [, b] of Object.entries(unzipSync(await unwrapContainer(bytes)))) expect(strFromU8(b)).not.toContain(SECRET);
  });
});

describe('import: preview, keep both, replace', () => {
  it('brings a graph and what it uses to another machine, and opens the graph', async () => {
    const { bytes } = await exportFrom(fixture(), ['graph:Sunset']);
    const m = machine();
    const { plan, summary } = await importInto(m, bytes);
    expect(plan.rows.map(r => [r.kind, r.name, r.status])).toEqual([['graph', 'Sunset', 'new'], ['nodes', 'Wobble', 'new'], ['library', 'Stripes', 'new']]);
    expect(plan.rows.find(r => r.kind === 'nodes')!.dependency).toBe(true);
    expect(JSON.parse(m.kv.get('shader-studio:Sunset')!).nodes).toHaveLength(3);
    expect(m.nodes.get('un_wobble_abc')?.functionCode).toContain(SECRET);
    expect(m.kv.get('shader-studio:cfp:cfp_1')).not.toBeNull();
    expect(summary.open).toEqual({ kind: 'graph', name: 'Sunset' });

    // The same file again: everything is already here, nothing is ticked.
    const again = await importInto(m, bytes);
    expect(again.plan.rows.map(r => r.status)).toEqual(['same', 'same', 'same']);
    expect(again.plan.rows.every(r => !r.include)).toBe(true);
  });

  it('a clash comes in as “Name (2)”, or replaces yours', async () => {
    const { bytes } = await exportFrom(fixture(), ['graph:Sunset'], { dependencies: false });
    const mine = graph({ nodes: [{ id: 'x', type: 'output', params: {} }] });
    const m = machine({ 'shader-studio:Sunset': mine });
    const both = await importInto(m, bytes);
    expect(both.plan.rows[0]).toMatchObject({ status: 'conflict', choice: 'keep-both' });
    expect(both.summary.renamed).toEqual([{ kind: 'graph', from: 'Sunset', to: 'Sunset (2)' }]);
    expect(m.kv.get('shader-studio:Sunset')).toBe(mine);
    expect(JSON.parse(m.kv.get('shader-studio:Sunset (2)')!).nodes).toHaveLength(3);

    const m2 = machine({ 'shader-studio:Sunset': mine });
    const plan = await planImport(await readPlayfile(bytes), m2.env);
    const s = await applyImport(plan, { [plan.rows[0].id]: { include: true, choice: 'replace' } }, m2.env);
    expect(s.replaced).toEqual([{ kind: 'graph', name: 'Sunset' }]);
    expect(JSON.parse(m2.kv.get('shader-studio:Sunset')!).nodes).toHaveLength(3);
  });

  it('unticked rows stay out', async () => {
    const { bytes } = await exportFrom(fixture(), ['graph:Sunset']);
    const m = machine();
    const plan = await planImport(await readPlayfile(bytes), m.env);
    const nodeRow = plan.rows.find(r => r.kind === 'nodes')!;
    await applyImport(plan, { [nodeRow.id]: { include: false, choice: 'replace' } }, m.env);
    expect(m.nodes.size).toBe(0);
    expect(m.kv.get('shader-studio:Sunset')).not.toBeNull();
  });

  it('a graph name that would land on a setting’s key is renamed', async () => {
    const w = await writePlayfile([{ kind: 'graph', name: 'settings:theme', data: '{"nodes":[]}' }]);
    const m = machine();
    const { summary } = await importInto(m, w.bytes);
    expect(summary.added).toEqual([{ kind: 'graph', name: 'Imported settings:theme' }]);
    expect(m.kv.get('shader-studio:settings:theme')).toBeNull();
  });
});

describe('every kind round-trips', () => {
  it('a presentation, with the graph it was made from, marked as imported', async () => {
    const { bytes, manifest } = await exportFrom(fixture(), ['pres:Lesson']);
    expect(manifest.items.map(i => i.kind).sort()).toEqual(['graph', 'library', 'nodes', 'presentation']);
    const m = machine({ 'shader-studio-presentation:Lesson': presentation('Lesson', { steps: [] }) });
    const { summary } = await importInto(m, bytes);
    expect(summary.renamed).toContainEqual({ kind: 'presentation', from: 'Lesson', to: 'Lesson (2)' });
    const p = JSON.parse(m.kv.get('shader-studio-presentation:Lesson (2)')!);
    expect(p).toMatchObject({ title: 'Lesson (2)', origin: 'imported' });
    expect(summary.open).toEqual({ kind: 'presentation', name: 'Lesson (2)' });
  });

  it('a GLSL shader keeps its note and folder', async () => {
    const { bytes } = await exportFrom(fixture(), ['glsl:g1']);
    const m = machine();
    await importInto(m, bytes);
    expect(JSON.parse(m.kv.get('shader-studio:glsl-shaders')!)).toMatchObject([{ name: 'Plasma', code: 'void main(){ gl_FragColor = vec4(1.0); }', group: 'Tests', note: 'bright' }]);
    // A different shader under the same name: keep both.
    const other = await writePlayfile([{ kind: 'glsl', name: 'Plasma', data: 'void main(){}' }]);
    const s = await importInto(m, other.bytes);
    expect(s.summary.renamed).toEqual([{ kind: 'glsl', from: 'Plasma', to: 'Plasma (2)' }]);
  });

  it('presets and settings travel as one library item, merged without overwriting', async () => {
    const { bytes } = await exportFrom(fixture(), ['preset:gp:gp_1', 'fn:cfp:cfp_1']);
    const m = machine({ 'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Glow stack', subgraph: { nodes: [{ id: 'mine' }] }, savedAt: 1 }) });
    const { summary } = await importInto(m, bytes);
    expect(m.kv.get('shader-studio:cfp:cfp_1')).not.toBeNull();
    expect(JSON.parse(m.kv.get('shader-studio:gp:gp_1')!).subgraph.nodes).toEqual([{ id: 'mine' }]);
    expect(summary.renamed.length).toBe(1);
  });

  it('a background image goes into the backgrounds library', async () => {
    const init = fixture();
    const kv = memoryKV(init);
    const inv = await buildInventory(kv, { external: [{ source: 'backgrounds', section: 'backgrounds', group: 'Images', items: [{ id: 'img_1', label: 'Dusk', size: 5 }] }] });
    const b = await buildBundle(kv, inv, ['ext:backgrounds:img_1'], {}, { backgroundFile: async () => ({ bytes: new Uint8Array([1, 2, 3]), type: 'image/png', name: 'Dusk' }) });
    const w = await writePlayfile(b.items);
    expect(w.manifest.items[0]).toMatchObject({ kind: 'background', path: 'backgrounds/Dusk.png', meta: { type: 'image/png' } });
    const m = machine();
    await importInto(m, w.bytes);
    expect(m.images).toMatchObject([{ name: 'Dusk', type: 'image/png' }]);
    // Already here the second time.
    expect((await importInto(m, w.bytes)).plan.rows[0].status).toBe('same');
  });

  it('a whole profile installs on Pro and shows as needing Pro on Free', async () => {
    const snap: LibrarySnapshot = { kind: 'shader-studio-library', version: 1, savedAt: 1, items: { 'shader-studio:Sunset': graph(), 'shader-studio:theme': 'dark' } };
    const zip = await buildProfileZip(snap, { scope: 'everything', external: { files: {}, items: [] } });
    const w = await writePlayfile([{ kind: 'profile', name: 'Everything', data: zip.bytes }]);
    const free = machine({}, { pro: false });
    const f = await importInto(free, w.bytes);
    expect(f.plan.rows[0]).toMatchObject({ status: 'needs-pro', include: false });
    expect(free.kv.get('shader-studio:Sunset')).toBeNull();
    const pro = machine({}, { pro: true });
    await importInto(pro, w.bytes);
    expect(pro.kv.get('shader-studio:Sunset')).not.toBeNull();
    expect(readProfile(zip.bytes).snapshot.items['shader-studio:theme']).toBe('dark');
  });
});

describe('node packs', () => {
  it('sealed: no code in the file as text, imported sealed, opens for the compiler', async () => {
    const { bytes, bundle } = await exportFrom(fixture(), ['node:un_wobble_abc'], { canPack: true, seal: true }, true);
    expect(bundle.sealed).toBe(true);
    const files = unzipSync(await unwrapContainer(bytes));
    for (const [p, b] of Object.entries(files)) {
      const t = strFromU8(b);
      expect(t, p).not.toContain(SECRET);
      expect(t, p).not.toContain('un_wobble_abc_h(float');
      expect(t, p).not.toContain('secretSourceText');
    }
    const m = machine();
    const { plan } = await importInto(m, bytes);
    expect(plan.rows[0]).toMatchObject({ kind: 'nodes', sealed: true, status: 'new' });
    const got = m.nodes.get('un_wobble_abc')!;
    expect(got.sealed).toBeTruthy();
    expect(got.functionCode).toBe('');
    expect(got.signedBy?.name).toBe('Ada');
    expect(unsealDefinition(got).functionCode).toContain(SECRET);
  });

  it('keeping both copies of a sealed node renames its GLSL function too', () => {
    const renamed = renameNode(sealDefinition(NODE), 'un_wobble_2', 'Wobble (2)');
    expect(renamed.sealed).toBeTruthy();
    const open = unsealDefinition(renamed);
    expect(open.fnName).toBe('un_wobble_2');
    expect(open.functionCode).toMatch(/^vec3 un_wobble_2\(/);
    // Its helper keeps its own name (it's a different identifier).
    expect(open.functionCode).toContain('un_wobble_abc_h(');
  });

  it('a pack whose signature doesn’t hold imports nothing unless ticked', async () => {
    const { bytes } = await exportFrom(fixture(), ['node:un_wobble_abc'], { canPack: true }, true);
    const files: Record<string, Uint8Array> = unzipSync(await unwrapContainer(bytes));
    const man = JSON.parse(strFromU8(files['manifest.json']));
    man.author.name = 'Mallory';
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(man));
    const { zipSync } = await import('fflate');
    const m = machine();
    const { plan } = await importInto(m, await wrapContainer(zipSync(files)));
    expect(plan.contents.signature.state).toBe('modified');
    expect(plan.rows[0].include).toBe(false);
    expect(m.nodes.size).toBe(0);
  });

  it('an older node .json and a bare definition still import', async () => {
    resetUserNodesForTests();
    const r = await importUserNodes(JSON.stringify({ version: 1, nodes: [NODE] }));
    expect(r).toMatchObject({ ok: true, imported: ['Wobble'] });
    // A stored sealed form imports too, and opens.
    const sealed = sealDefinition({ ...NODE, id: 'un_s', fnName: 'un_s', functionCode: NODE.functionCode.replace(/un_wobble_abc\(/, 'un_s(') });
    expect((await importUserNodes(JSON.stringify(sealed))).ok).toBe(true);
    expect(getUserNode('un_s')!.functionCode).toContain(SECRET);
    // Exported again it leaves sealed, even when not asked.
    expect(JSON.stringify(exportUserNodes(['un_s']))).not.toContain(SECRET);
    resetUserNodesForTests();
  });
});

describe('a sealed node in the Studio', () => {
  beforeEach(() => resetUserNodesForTests());

  const graphUsing = (type: string): GraphNode[] => [
    { id: 'a', type, position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV' } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { amt: 0.5 } },
    { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'a', outputKey: 'color' } } }, outputs: {}, params: {} },
  ];

  it('compiles with its real GLSL; the code panel’s copy hides it line for line', async () => {
    await registerUserNode(sealDefinition(NODE), { persist: false });
    const r = compileGraph({ nodes: graphUsing(NODE.id) });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.fragmentShader).toContain(SECRET);
    const shown = redactSealedCode(r.fragmentShader);
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain('un_wobble_abc_h(float x)');
    expect(shown).toContain('// Sealed node pack: Wobble');
    expect(shown.split('\n').length).toBe(r.fragmentShader.split('\n').length);
    // The call stays (it shows where the node is used).
    expect(shown).toMatch(/= un_wobble_abc\(/);
  });

  it('a node published from a graph using it would carry its code, so it is sealed too', async () => {
    await registerUserNode(sealDefinition(NODE), { persist: false });
    const open = getUserNode(NODE.id)!;
    const built: UserNodeDefinition = { ...NODE, id: 'un_outer', label: 'Outer', fnName: 'un_outer', functionCode: 'vec3 un_outer(vec2 uv){ return vec3(0.0); }', helperFunctions: [...open.helperFunctions, open.functionCode] };
    expect(containsSealedCode(built)).toEqual(['Wobble']);
    expect(containsSealedCode({ ...built, helperFunctions: [] })).toEqual([]);
  });

  it('an unsealed node shows as it is', async () => {
    await registerUserNode(NODE, { persist: false });
    const r = compileGraph({ nodes: graphUsing(NODE.id) });
    expect(redactSealedCode(r.fragmentShader)).toBe(r.fragmentShader);
  });
});

describe('links between graphs and presentations (when records have them)', () => {
  it('a graph brings its linked presentation, and a renamed one keeps the link', async () => {
    const init = { ...fixture(), 'shader-studio:Plain': JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }], linkedPresentations: ['Lesson'] }) };
    const { bundle, bytes } = await exportFrom(init, ['graph:Plain']);
    expect(bundle.items.map(i => i.kind)).toContain('presentation');
    const off = await exportFrom(init, ['graph:Plain'], { linked: false });
    expect(off.bundle.items.map(i => i.kind)).not.toContain('presentation');
    const m = machine({ 'shader-studio-presentation:Lesson': presentation('Lesson', { steps: [] }) });
    await importInto(m, bytes);
    expect(JSON.parse(m.kv.get('shader-studio:Plain')!).linkedPresentations).toEqual(['Lesson (2)']);
  });

  it('records without links export as before', async () => {
    const { bundle } = await exportFrom(fixture(), ['graph:Plain']);
    expect(bundle.items.map(i => i.kind)).toEqual(['graph']);
  });
});

describe('Free and Pro', () => {
  it('making packs is Pro; importing them is Free', () => {
    expect(canOn('free', 'nodes.pack')).toBe(false);
    expect(canOn('pro', 'nodes.pack')).toBe(true);
    expect(canOn('free', 'nodes.import')).toBe(true);
    expect(canOn('free', 'files.install')).toBe(false);
  });

  it('on Free, chosen node types are left out of an export (they’d be a pack); a graph’s own still come along', async () => {
    const chosen = await exportFrom(fixture(), ['node:un_wobble_abc', 'glsl:g1'], { canPack: false });
    expect(chosen.bundle.items.map(i => i.kind)).toEqual(['glsl']);
    expect(chosen.bundle.notes.join(' ')).toMatch(/Pro/);
    const pro = await exportFrom(fixture(), ['node:un_wobble_abc'], { canPack: true });
    expect(pro.bundle.items.map(i => i.kind)).toEqual(['nodes']);
  });

  it('a node pack imports on Free', async () => {
    const { bytes } = await exportFrom(fixture(), ['node:un_wobble_abc'], { canPack: true, seal: true }, true);
    const free = machine({}, { pro: false });
    await importInto(free, bytes);
    expect(free.nodes.has('un_wobble_abc')).toBe(true);
  });
});

describe('older formats', () => {
  it('graph files, library ZIPs and profile ZIPs aren’t mistaken for a .playfile', async () => {
    expect(isPlayfile(new TextEncoder().encode(graph()))).toBe(false);
    const snap: LibrarySnapshot = { kind: 'shader-studio-library', version: 1, savedAt: 1, items: { 'shader-studio:Sunset': graph() } };
    const zip = await buildProfileZip(snap, { scope: 'everything', external: { files: {}, items: [] } });
    expect(isPlayfile(zip.bytes)).toBe(false);
    expect(readProfile(zip.bytes).snapshot.items['shader-studio:Sunset']).toBeDefined();
    expect(isLibraryKey('shader-studio:Sunset')).toBe(true);
  });
});
