/**
 * Node packs (docs/node-packs.md): making nodes from saved things, the pack's
 * dependencies and validation, namespacing, assembly (sealed and not), the
 * version an export gets, and the round trip through a .playfile into a new
 * machine (the pack's category, its examples, compiling its nodes). Plus the
 * .playfile video follow-up: Video layers' files travel with graphs.
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

import type { UserNodeDefinition } from '../../types/userNode';
import type { GraphNode } from '../../types/nodeGraph';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { ExprPreset } from '../../types/exprPreset';
import { memoryKV } from '../../files/mutate';
import { buildUserNodeDefinition, describeSource, type PublishSource } from '../../nodes/userNodes/publishUserNode';
import { keyFromLabel } from '../../nodes/userNodes/paramCandidates';
import { registerUserNode, resetUserNodesForTests } from '../../nodes/userNodes/userNodeRegistry';
import { compileGraph } from '../../compiler/graphCompiler';
import { writePlayfile } from '../../playfile/writer';
import { readPlayfile } from '../../playfile/reader';
import { applyImport, planImport, type ImportEnv } from '../../playfile/importer';
import { videoFilesFor, videoIdsIn, videoItemsFrom } from '../../playfile/bundle';
import { newSeed, publicKeyOf, signerFromSeed } from '../../playfile/signing';
import { addVideoFile, getVideo, hasVideo, importVideoFiles, listVideos, removeVideo, resetBackgroundCache, videoZipFiles } from '../../lib/backgroundLibrary';
import {
  assemblePack, bumpVersion, collectDependencies, compareVersions, namespaceLabels, nextExportVersion, packDefinitions, parseVersion, validatePack, type PackEnv,
} from '../assemble';
import { addNode, deleteProject, listProjects, loadProject, moveNode, newProject, recordExport, removeNode, renameNode, saveProject } from '../projects';
import { customFnSource, exprSource, groupsIn, groupPresetSource } from '../sources';
import { installedPacks, packForCategory, recordInstalledPack } from '../installed';
import type { PackProject } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const WAVES: CustomFnPreset = {
  id: 'cfp_waves', label: 'Waves', savedAt: 1, outputType: 'float', glslFunctions: '',
  inputs: [{ name: 'uv', type: 'vec2' }, { name: 'freq', type: 'float', slider: { min: 1, max: 20 } }],
  body: 'return sin(uv.x * freq) * 0.5 + 0.5;',
};
const STRIPE: ExprPreset = {
  id: 'ep_stripe', label: 'Stripe', savedAt: 1, outputType: 'float',
  inputs: [{ name: 'uv', type: 'vec2', slider: null }], lines: [], result: 'step(0.5, fract(uv.y * 4.0))',
};

/** Publish a source the way the node builder does, with every port kept. */
function publish(source: PublishSource, label: string): UserNodeDefinition {
  const ports = describeSource(source);
  const taken = new Set<string>();
  const r = buildUserNodeDefinition(source, {
    label, category: 'My Nodes',
    inputs: ports.inputs.map(i => ({ portKey: i.portKey, key: keyFromLabel(i.label, taken, 'input'), label: i.label, type: i.type, slider: i.type === 'float' && i.slider ? i.slider : null })),
    outputs: ports.outputs.map(o => ({ portKey: o.portKey, key: keyFromLabel(o.label, taken, 'output'), label: o.label, type: o.type })),
    params: [],
  });
  if (!r.ok) throw new Error(r.error);
  return r.def;
}

/** A saved graph with a group (the Glow group: length(uv) → a falloff) wired to the Output, using a published node too. */
function exampleGraph(extraType?: string): string {
  const group: GraphNode = {
    id: 'g1', type: 'group', position: { x: 0, y: 0 },
    inputs: { in_uv: { type: 'vec2', label: 'UV' } }, outputs: { out0: { type: 'float', label: 'Glow' } },
    params: {
      label: 'Glow',
      subgraph: {
        nodes: [{
          id: 'e1', type: 'exprNode', position: { x: 0, y: 0 },
          inputs: { uv: { type: 'vec2', label: 'uv', connection: { nodeId: '__group_input__', outputKey: 'in_uv' } } },
          outputs: { result: { type: 'float', label: 'Result' } },
          params: { label: 'Falloff', inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'float', lines: [], result: '0.05 / length(uv)' },
        }],
        inputPorts: [{ key: 'in_uv', type: 'vec2', label: 'UV', toNodeId: 'e1', toInputKey: 'uv' }],
        outputPorts: [{ key: 'out0', type: 'float', label: 'Glow', fromNodeId: 'e1', fromOutputKey: 'result' }],
      },
    },
  };
  const nodes: unknown[] = [
    { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
    { ...group, inputs: { in_uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } } },
    { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'g1', outputKey: 'out0' } } }, outputs: {}, params: {} },
  ];
  if (extraType) nodes.push({ id: 'x', type: extraType, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} });
  return JSON.stringify({ nodes, version: 1, savedAt: 1, linkedPresentations: ['pres_1'] });
}

const PRESENTATION = JSON.stringify({
  id: 'pres_1', version: 1, title: 'Glow lesson', createdAt: 1, updatedAt: 2,
  steps: [{ id: 's1', columns: 1, blocks: [{ type: 'text', id: 'b0', markdown: 'Glow' }] }], sources: [],
});

interface World { kv: ReturnType<typeof memoryKV>; env: PackEnv; nodes: Map<string, UserNodeDefinition>; defs: { waves: UserNodeDefinition; stripe: UserNodeDefinition; glow: UserNodeDefinition } }

function world(): World {
  const waves = publish(customFnSource(WAVES), 'Waves');
  const stripe = publish(exprSource(STRIPE), 'Stripe');
  const glowNode = groupsIn(JSON.parse(exampleGraph()).nodes as GraphNode[])[0].node;
  const glow = publish({ kind: 'group', node: glowNode }, 'Glow');
  const nodes = new Map([waves, stripe, glow].map(d => [d.id, d]));
  const kv = memoryKV({
    'shader-studio:Glow scene': exampleGraph(),
    'shader-studio-presentation:Glow lesson': PRESENTATION,
    'shader-studio:glsl-shaders': JSON.stringify([{ id: 'sh1', name: 'Plasma', code: 'void main(){ gl_FragColor = vec4(1.0); }' }]),
  });
  return {
    kv, nodes, defs: { waves, stripe, glow },
    env: { kv, userNode: id => nodes.get(id), builtinLabels: () => ['Noise', 'Waves'] },
  };
}

function pack(w: World, o: Partial<PackProject> = {}): PackProject {
  let p = newProject('Glow Kit', { author: 'Ada', now: 1000, id: 'pack_glow' });
  p = addNode(p, w.defs.waves, { kind: 'customFn', presetId: WAVES.id, label: 'Waves' });
  p = addNode(p, w.defs.stripe, { kind: 'expr', presetId: STRIPE.id, label: 'Stripe' });
  p = addNode(p, w.defs.glow, { kind: 'graphGroup', graph: 'Glow scene', groupId: 'g1', groupLabel: 'Glow' });
  return { ...p, ...o };
}

function importEnv(kv = memoryKV(), nodes = new Map<string, UserNodeDefinition>()): ImportEnv & { nodes: Map<string, UserNodeDefinition> } {
  let n = 0;
  return {
    kv, nodes, can: () => true,
    userNode: id => nodes.get(id),
    nodeLabels: () => [...nodes.values()].map(d => d.label),
    registerNode: async def => { nodes.set(def.id, def); return { ok: true }; },
    makeNodeId: label => `un_${label.toLowerCase().replace(/\W+/g, '_')}_${++n}`,
    recordPack: p => recordInstalledPack(p),
    now: () => 9000,
  };
}

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
  resetUserNodesForTests();
});

// ── Making nodes from saved things ──────────────────────────────────────────

describe('nodes from saved things', () => {
  it('a Custom Function, an Expression Block and a group in a saved graph each publish as a node with their sockets', () => {
    const w = world();
    expect(w.defs.waves.inputs.map(i => [i.key, i.type, !!i.slider])).toEqual([['uv', 'vec2', false], ['freq', 'float', true]]);
    expect(w.defs.waves.outputs[0].type).toBe('float');
    expect(w.defs.stripe.inputs.map(i => i.key)).toEqual(['uv']);
    expect(w.defs.glow.inputs.map(i => i.type)).toEqual(['vec2']);
    expect(w.defs.glow.functionCode).toContain('length');
  });

  it('lists the groups in a graph, nested ones with their path', () => {
    const inner = JSON.parse(exampleGraph()).nodes[1] as GraphNode;
    const outer: GraphNode = { id: 'o', type: 'group', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label: 'Outer', subgraph: { nodes: [inner], inputPorts: [], outputPorts: [] } } };
    expect(groupsIn([outer]).map(g => g.path)).toEqual(['Outer', 'Outer › Glow']);
    expect(groupPresetSource({ id: 'gp', label: 'G', subgraph: { nodes: [], inputPorts: [], outputPorts: [] }, savedAt: 1 }).kind).toBe('subgraph');
  });
});

// ── Project edits and storage ───────────────────────────────────────────────

describe('pack projects', () => {
  it('add, rename, reorder and remove nodes; adding one again refreshes it', () => {
    const w = world();
    let p = pack(w);
    expect(p.packNodes.map(n => n.label)).toEqual(['Waves', 'Stripe', 'Glow']);
    p = moveNode(p, w.defs.glow.id, -1);
    expect(p.packNodes.map(n => n.label)).toEqual(['Waves', 'Glow', 'Stripe']);
    p = renameNode(p, w.defs.waves.id, 'Sine waves');
    p = addNode(p, { ...w.defs.waves, description: 'new' }, { kind: 'published' });
    expect(p.packNodes).toHaveLength(3);
    expect(p.packNodes[0].label).toBe('Sine waves');
    expect(p.packNodes[0].origin.kind).toBe('customFn');
    expect(p.packNodes[0].snapshot?.description).toBe('new');
    p = removeNode(p, w.defs.stripe.id);
    expect(p.packNodes.map(n => n.label)).toEqual(['Sine waves', 'Glow']);
  });

  it('saves and reopens (a project is not mistaken for a graph)', () => {
    const kv = memoryKV();
    const p = saveProject(pack(world()), kv, 5);
    expect(loadProject(p.id, kv)?.packNodes).toHaveLength(3);
    expect(listProjects(kv).map(x => x.name)).toEqual(['Glow Kit']);
    expect(JSON.parse(kv.get(`shader-studio-nodepack:${p.id}`)!).nodes).toBeUndefined();
    deleteProject(p.id, kv);
    expect(listProjects(kv)).toEqual([]);
  });
});

// ── Namespacing ─────────────────────────────────────────────────────────────

describe('namespacing inside the pack', () => {
  it('two nodes with one name are told apart; every node is listed under the pack', () => {
    const labels = namespaceLabels([{ nodeId: 'a', label: 'Glow' }, { nodeId: 'b', label: ' glow ' }, { nodeId: 'c', label: 'Glow' }]);
    expect([...labels.values()]).toEqual(['Glow', 'glow 2', 'Glow 3']);
    const w = world();
    const p = renameNode(pack(w), w.defs.stripe.id, 'Waves');
    const defs = packDefinitions(p, w.env, 7);
    expect(defs.map(d => d.label)).toEqual(['Waves', 'Waves 2', 'Glow']);
    expect(new Set(defs.map(d => d.category))).toEqual(new Set(['Glow Kit']));
    // Ids (and so function names and the example graphs' references) are untouched.
    expect(defs.map(d => d.id)).toEqual([w.defs.waves.id, w.defs.stripe.id, w.defs.glow.id]);
    const v = validatePack(p, w.env);
    expect(v.nodes.get(w.defs.stripe.id)?.[0].text).toMatch(/goes in as “Waves 2”/);
    // A built-in with the same name: fine, it's listed under the pack.
    expect(v.nodes.get(w.defs.waves.id)?.[0].text).toMatch(/built-in node is also called/);
  });
});

// ── Dependencies and validation ─────────────────────────────────────────────

describe('dependencies', () => {
  it('offers the graphs the nodes came from and the presentations linked to them (by id)', () => {
    const w = world();
    const { suggestions, unresolved } = collectDependencies(pack(w), w.env);
    expect(suggestions.map(s => [s.extra.kind, 'name' in s.extra ? s.extra.name : '', s.why])).toEqual([
      ['graph', 'Glow scene', '“Glow” came from it'],
      ['presentation', 'Glow lesson', 'linked to “Glow scene”'],
    ]);
    expect(unresolved).toEqual([]);
  });

  it('an example graph using a published node that is not in the pack is unresolved', () => {
    const w = world();
    const other = { ...w.defs.stripe, id: 'un_other_1', label: 'Other' };
    w.nodes.set(other.id, other);
    w.kv.set('shader-studio:Glow scene', exampleGraph('un_other_1'));
    const p = { ...pack(w), extras: [{ kind: 'graph' as const, name: 'Glow scene' }] };
    expect(collectDependencies(p, w.env).unresolved).toEqual([{ graph: 'Glow scene', nodeType: 'un_other_1', label: 'Other', here: true }]);
    const v = validatePack(p, w.env);
    expect(v.extras.get('graph:Glow scene')?.map(i => i.text).join(' ')).toMatch(/uses “Other”, which isn’t in the pack/);
    // Built-in types (uv, output, group, exprNode) are never unresolved.
    expect(collectDependencies({ ...p, extras: p.extras }, { ...w.env, kv: memoryKV({ 'shader-studio:Glow scene': exampleGraph() }) }).unresolved).toEqual([]);
  });

  it('validation: a name, a version, at least one node, compile errors, deleted nodes, the sealed-source warning', () => {
    const w = world();
    const empty = validatePack({ ...newProject(''), name: ' ', version: 'one' }, w.env);
    expect(empty.ok).toBe(false);
    expect(empty.pack.map(i => i.text).join(' ')).toMatch(/name.*version.*at least one node/s);
    const p = { ...pack(w, { sealed: true }), extras: [{ kind: 'graph' as const, name: 'Glow scene' }] };
    const v = validatePack(p, w.env, new Map([[w.defs.stripe.id, { ok: false, error: "ERROR: 0:1: 'x' : undeclared identifier" }]]));
    expect(v.ok).toBe(false);
    expect(v.nodes.get(w.defs.stripe.id)?.map(i => i.text).join(' ')).toMatch(/doesn’t compile: ERROR/);
    expect(v.extras.get('graph:Glow scene')?.map(i => i.text).join(' ')).toMatch(/holds how “Glow” is built/);
    // A node type deleted here: the pack's copy stands in.
    w.nodes.delete(w.defs.waves.id);
    expect(validatePack(pack(w), w.env).nodes.get(w.defs.waves.id)?.[0]).toMatchObject({ level: 'warn' });
    const noCopy = pack(w);
    noCopy.packNodes[0] = { ...noCopy.packNodes[0], snapshot: undefined };
    expect(validatePack(noCopy, w.env).ok).toBe(false);
  });
});

// ── Versions ────────────────────────────────────────────────────────────────

describe('re-export versioning', () => {
  it('parses, compares and bumps', () => {
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('v2.0.3')).toEqual([2, 0, 3]);
    expect(parseVersion('one')).toBeNull();
    expect(bumpVersion('1.2.3')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('the first export keeps the version; exporting again bumps it; a higher version typed by hand is kept', () => {
    let p = newProject('P');
    expect(nextExportVersion(p)).toBe('1.0.0');
    p = recordExport(p, { version: '1.0.0', at: 1, sealed: false, bytes: 10 });
    expect(p.version).toBe('1.0.0');
    expect(nextExportVersion(p)).toBe('1.0.1');
    p = recordExport(p, { version: '1.0.1', at: 2, sealed: false, bytes: 10 });
    expect(nextExportVersion(p)).toBe('1.0.2');
    expect(nextExportVersion({ ...p, version: '2.0.0' })).toBe('2.0.0');
    // Typed lower than what already went out: after the latest.
    expect(nextExportVersion({ ...p, version: '0.9.0' })).toBe('1.0.2');
  });
});

// ── Assembly and the round trip ─────────────────────────────────────────────

async function signer() {
  const seed = newSeed();
  return signerFromSeed(seed, await publicKeyOf(seed));
}

describe('assembling and exporting a pack', () => {
  it('one nodes item carrying the pack, and the extras: graph, presentation, GLSL, notes', async () => {
    const w = world();
    const p: PackProject = {
      ...pack(w, { description: 'Glows and waves', licence: 'CC BY 4.0', icon: 'G' }),
      extras: [
        { kind: 'graph', name: 'Glow scene', auto: true },
        { kind: 'presentation', name: 'Glow lesson' },
        { kind: 'glsl', id: 'sh1', name: 'Plasma' },
        { kind: 'note', id: 'n1', name: 'Read me', text: '# Glow Kit\nUse **Glow** on UV.' },
        { kind: 'graph', name: 'Gone' },
      ],
    };
    const a = await assemblePack(p, w.env, { version: '1.1.0', now: 3 });
    expect(a.items.map(i => i.kind)).toEqual(['nodes', 'graph', 'presentation', 'glsl']);
    const file = JSON.parse(a.items[0].data as string);
    expect(file.version).toBe(1);
    expect(file.nodes).toHaveLength(3);
    expect(file.pack).toMatchObject({ id: 'pack_glow', name: 'Glow Kit', version: '1.1.0', author: 'Ada', licence: 'CC BY 4.0', examples: ['Glow scene'], presentations: ['Glow lesson'], notes: [{ name: 'Read me' }] });
    expect(a.items[0].meta).toMatchObject({ count: 3, sealed: false, pack: { name: 'Glow Kit', version: '1.1.0' } });
    expect(a.items[1].meta).toMatchObject({ example: true });
    expect(a.items[3].meta).toMatchObject({ group: 'Glow Kit' });
    expect(a.notes.join(' ')).toMatch(/Left out.*“Gone”/);
  });

  it('sealed: no node carries its code or source; it still compiles after coming in', async () => {
    const w = world();
    const p = pack(w, { sealed: true });
    const a = await assemblePack(p, w.env);
    expect(a.sealed).toBe(true);
    const { bytes } = await writePlayfile(a.items, { author: 'Ada', signer: await signer() });
    for (const [path, b] of Object.entries(unzipSync(bytes))) {
      if (!path.startsWith('nodes/')) continue;
      const text = strFromU8(b);
      expect(text).not.toContain('sin(uv.x * freq)');
      expect(text).not.toContain('"source"');
    }
    // On a new machine: import, then use each node in a graph.
    const m = importEnv();
    const plan = await planImport(await readPlayfile(bytes), m);
    expect(plan.rows.filter(r => r.kind === 'nodes').every(r => r.sealed && r.status === 'new')).toBe(true);
    const sum = await applyImport(plan, {}, m);
    expect(sum.failed).toEqual([]);
    for (const def of m.nodes.values()) {
      await registerUserNode(def, { persist: false });
      const out = def.outputs[0];
      const r = compileGraph({
        nodes: [
          { id: 'n', type: def.id, position: { x: 0, y: 0 }, inputs: Object.fromEntries(def.inputs.map(i => [i.key, { type: i.type, label: i.label }])), outputs: { [out.key]: { type: out.type, label: out.label } }, params: Object.fromEntries(def.inputs.filter(i => i.slider).map(i => [i.key, i.slider!.default])) },
          { id: 'o', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'n', outputKey: out.key } } }, outputs: {}, params: {} },
        ],
      });
      expect(r.success, `${def.label}: ${r.errors?.join(' ')}`).toBe(true);
      expect(r.fragmentShader).toContain(def.fnName);
    }
  });

  it('importing: nodes under the pack’s name, examples and presentations recorded (renamed ones too)', async () => {
    const w = world();
    const p: PackProject = { ...pack(w), extras: [{ kind: 'graph', name: 'Glow scene' }, { kind: 'presentation', name: 'Glow lesson' }] };
    const a = await assemblePack(p, w.env);
    const { bytes } = await writePlayfile(a.items, { author: 'Ada', signer: await signer() });
    // The other machine already has a different "Glow scene".
    const m = importEnv(memoryKV({ 'shader-studio:Glow scene': JSON.stringify({ nodes: [{ id: 'x', type: 'output', params: {} }] }) }));
    const contents = await readPlayfile(bytes);
    expect(contents.signature.state).toBe('signed');
    const plan = await planImport(contents, m);
    expect(plan.packs?.[0].info).toMatchObject({ name: 'Glow Kit', version: '1.0.0', examples: ['Glow scene'] });
    const sum = await applyImport(plan, {}, m);
    expect(sum.open).toBeUndefined();
    expect([...m.nodes.values()].map(d => d.category)).toEqual(['Glow Kit', 'Glow Kit', 'Glow Kit']);
    expect(sum.packs?.[0]).toMatchObject({ name: 'Glow Kit', category: 'Glow Kit', examples: ['Glow scene (2)'], presentations: ['Glow lesson'] });
    expect(sum.packs?.[0].nodeIds.sort()).toEqual([w.defs.waves.id, w.defs.stripe.id, w.defs.glow.id].sort());
    expect(sum.packs?.[0].signedBy?.name).toBe('Ada');
    expect(installedPacks().map(x => x.name)).toEqual(['Glow Kit']);
    expect(packForCategory('Glow Kit')?.examples).toEqual(['Glow scene (2)']);
    // The example graph still names the pack's nodes by id.
    expect(m.kv.get('shader-studio:Glow scene (2)')).toContain('"group"');
  });

  it('a newer version of the pack updates its nodes in place and keeps the examples listed', async () => {
    const w = world();
    const m = importEnv();
    const p1: PackProject = { ...pack(w), extras: [{ kind: 'graph', name: 'Glow scene' }] };
    for (const [version, proj] of [['1.0.0', p1], ['1.0.1', { ...p1, extras: [] as PackProject['extras'], packNodes: p1.packNodes.map(n => ({ ...n, label: `${n.label}!` })) }]] as const) {
      const a = await assemblePack(proj, w.env, { version });
      const { bytes } = await writePlayfile(a.items, { author: 'Ada' });
      await applyImport(await planImport(await readPlayfile(bytes), m), {}, m);
    }
    expect([...m.nodes.values()].map(d => d.label).sort()).toEqual(['Glow!', 'Stripe!', 'Waves!']);
    expect(installedPacks()[0]).toMatchObject({ version: '1.0.1', examples: ['Glow scene'] });
  });

  it('carries custom Finish effects: sealed in a sealed pack, into Your effects on import, and they still run', async () => {
    const w = world();
    const code = 'uniform float levels; // 2..16 = 4\nvec3 effect(vec2 uv, vec3 color) { return floor(color * levels) / levels; }\n';
    w.kv.set('shader-studio:finish-effects', JSON.stringify([{ id: 'fx_post', name: 'Posterize', code, savedAt: 1 }]));
    const p: PackProject = { ...pack(w, { sealed: true }), extras: [{ kind: 'finishEffect', id: 'fx_post', name: 'Posterize' }] };
    expect(validatePack(p, w.env).ok).toBe(true);
    const a = await assemblePack(p, w.env);
    expect(a.info.finishEffects).toEqual(['Posterize']);
    const { bytes } = await writePlayfile(a.items, { author: 'Ada', signer: await signer() });
    for (const [path, b] of Object.entries(unzipSync(bytes))) if (path.startsWith('nodes/')) expect(strFromU8(b)).not.toContain('floor(color');
    const m = importEnv();
    const plan = await planImport(await readPlayfile(bytes), m);
    const row = plan.rows.find(r => r.id.includes('#fx:'))!;
    expect(row).toMatchObject({ name: 'Posterize', status: 'new', sealed: true, detail: 'Finish effect' });
    const sum = await applyImport(plan, {}, m);
    expect(sum.failed).toEqual([]);
    const saved = JSON.parse(m.kv.get('shader-studio:finish-effects')!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'fx_post', name: 'Posterize', code: '', pack: 'Glow Kit' });
    expect(JSON.stringify(saved)).not.toContain('floor(color');
    // In a stack it is sealed in the record, but its settings and code are there in memory.
    const { newCustomEffect, finishNumericProps, renderableFinish } = await import('../../types/playFinish');
    const e = newCustomEffect({ name: saved[0].name, code: '', sealed: saved[0].sealed, defId: 'fx_post' });
    expect(e.code).toBe('');
    expect(finishNumericProps(e).map(x => x.key)).toEqual(['levels']);
    expect(renderableFinish({ on: true, effects: [e] })!.effects[0].code).toBe(code);
    // The same pack again: already here.
    const again = await planImport(await readPlayfile(bytes), m);
    expect(again.rows.find(r => r.id.includes('#fx:'))?.status).toBe('same');
  });
});

// ── Videos in .playfile exports ─────────────────────────────────────────────

describe('Video layers’ files travel in .playfile exports', () => {
  it('finds the video ids in graphs, Play setups and (escaped) library snapshots', () => {
    const play = JSON.stringify({ nodes: [], play: { layers: [{ kind: 'video', videoId: 'vid_a' }] } });
    const lib = JSON.stringify({ items: { 'shader-studio:X': JSON.stringify({ nodes: [], play: { layers: [{ kind: 'video', videoId: 'vid_b' }] } }) } });
    expect(videoIdsIn([
      { kind: 'play', name: 'A', data: play },
      { kind: 'library', name: 'L', data: lib },
      { kind: 'glsl', name: 'G', data: '"videoId":"vid_c"' },
    ]).sort()).toEqual(['vid_a', 'vid_b']);
  });

  it('bundles a used video and restores it (same id) on import; already here is not ticked', async () => {
    const meta = await addVideoFile(new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/webm' }), { name: 'Clip.webm', poster: { thumb: '', width: 64, height: 36, duration: 2 } });
    const graph = JSON.stringify({ nodes: [{ id: 'o', type: 'output', params: {} }], play: { layers: [{ kind: 'video', videoId: meta.id }] } });
    const items = videoItemsFrom(await videoZipFiles(videoIdsIn([{ kind: 'graph', name: 'V', data: graph }])));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'video', name: 'Clip.webm', ext: '.webm', meta: { id: meta.id, type: 'video/webm', width: 64, duration: 2 } });
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'V', data: graph }, ...items], {});
    expect(Object.keys(unzipSync(bytes))).toContain('videos/Clip.webm');
    const env: ImportEnv = { ...importEnv(), hasVideo, addVideos: importVideoFiles };

    const here = await planImport(await readPlayfile(bytes), env);
    expect(here.rows.find(r => r.kind === 'video')).toMatchObject({ status: 'same', include: false });

    await removeVideo(meta.id);
    expect(await listVideos()).toEqual([]);
    const plan = await planImport(await readPlayfile(bytes), env);
    expect(plan.rows.find(r => r.kind === 'video')).toMatchObject({ status: 'new', include: true, detail: 'WEBM' });
    const sum = await applyImport(plan, {}, env);
    expect(sum.failed).toEqual([]);
    const back = await getVideo(meta.id);
    expect(back?.name).toBe('Clip.webm');
    expect(new Uint8Array(await back!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    // The file shape importVideoFiles reads.
    expect(Object.keys(videoFilesFor({ name: 'C', path: 'videos/C.mp4', data: new Uint8Array(1), meta: { id: 'v' } }))).toEqual(['backgrounds/videos.json', 'backgrounds/videos/C.mp4']);
  });
});
