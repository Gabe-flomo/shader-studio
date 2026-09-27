/**
 * A node pack project → the items of a `.playfile` (docs/node-packs.md).
 * Pure apart from what `env` does (reading a background's bytes, embedding a
 * presentation's pictures), so tests run it on a map.
 *
 *   resolvePackNodes   each node's definition: the published node type as it
 *                      is now, or the copy the pack kept if it's gone
 *   namespaceLabels    names unique inside the pack; every node is listed
 *                      under the pack's name
 *   collectDependencies  what the pack could bring along (the graphs its
 *                      nodes came from, presentations linked to its graphs)
 *                      and what its example graphs use that isn't in it
 *   validatePack       everything worth saying before an export
 *   assemblePack       the items: one `nodes` item carrying the pack's
 *                      description, and one item per extra
 *   versions           semver parse / bump, and the version an export gets
 */
import { loadSavedEffects, type ListKV, type SavedEffect } from '../play/finishLibrary';
import { sealCustomCode } from '../types/playFinish';
import type { UserNodeDefinition } from '../types/userNode';
import { GLSL_KEY, GRAPH_PREFIX } from '../files/inventory';
import { PRESENTATION_KEY_PREFIX } from '../utils/library';
import { graphFileText } from '../playfile/bundle';
import type { WriteItem } from '../playfile/writer';
import { sealDefinition, storedForm } from '../playfile/sealing';
import type { PackExtra, PackInfo, PackNode, PackProject } from './types';

export interface ReadKV { get(key: string): string | null; keys(): string[] }

export interface PackEnv {
  kv: ReadKV;
  /** A published node type here (in memory: a sealed one has its code filled in). */
  userNode: (id: string) => UserNodeDefinition | undefined;
  /** A presentation's stored JSON → its file, pictures and fonts embedded. */
  presentationFile?: (name: string, stored: string) => Promise<string>;
  /** A background image's file. */
  backgroundFile?: (id: string) => Promise<{ bytes: Uint8Array; type: string; name: string } | null>;
  /** Labels of the built-in node types (a pack node with the same name is still told apart by its category). */
  builtinLabels?: () => Iterable<string>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const parse = (v: string | null | undefined): unknown => { if (v == null) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Versions ────────────────────────────────────────────────────────────────

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?\s*$/.exec(v);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

export function bumpVersion(v: string, part: 'major' | 'minor' | 'patch' = 'patch'): string {
  const [a, b, c] = parseVersion(v) ?? [1, 0, 0];
  return part === 'major' ? `${a + 1}.0.0` : part === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

export function compareVersions(x: string, y: string): number {
  const a = parseVersion(x) ?? [0, 0, 0], b = parseVersion(y) ?? [0, 0, 0];
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The version this export should carry: the project's, bumped (patch) when that one has gone out already. */
export function nextExportVersion(p: Pick<PackProject, 'version' | 'exports'>): string {
  const v = parseVersion(p.version) ? p.version.trim().replace(/^v/, '') : '1.0.0';
  const latest = p.exports.reduce<string | null>((m, e) => (m === null || compareVersions(e.version, m) > 0 ? e.version : m), null);
  if (!p.exports.some(e => e.version === v) && (latest === null || compareVersions(v, latest) > 0)) return v;
  return bumpVersion(latest && compareVersions(latest, v) > 0 ? latest : v, 'patch');
}

// ── Nodes ───────────────────────────────────────────────────────────────────

export interface ResolvedNode {
  node: PackNode;
  /** Null when the node type is gone and the pack kept no copy. */
  def: UserNodeDefinition | null;
  /** From the copy the pack kept (the node type isn't here any more). */
  fromSnapshot: boolean;
}

export function resolvePackNodes(p: Pick<PackProject, 'packNodes'>, env: Pick<PackEnv, 'userNode'>): ResolvedNode[] {
  return p.packNodes.map(node => {
    const live = env.userNode(node.nodeId);
    if (live) return { node, def: live, fromSnapshot: false };
    return { node, def: node.snapshot ?? null, fromSnapshot: !!node.snapshot };
  });
}

/**
 * Names inside the pack: each node's label, trimmed, with a clash inside the
 * pack told apart as "Name 2", "Name 3" (in the pack's order). Outside the
 * pack nothing can clash: every node is listed under the pack's own name.
 */
export function namespaceLabels(nodes: ReadonlyArray<Pick<PackNode, 'nodeId' | 'label'>>): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of nodes) {
    const base = n.label.trim().replace(/\s+/g, ' ') || 'Node';
    let label = base;
    for (let i = 2; taken.has(label.toLowerCase()); i++) label = `${base} ${i}`;
    taken.add(label.toLowerCase());
    out.set(n.nodeId, label);
  }
  return out;
}

/** The category a pack's nodes are listed under. */
export const packCategory = (p: Pick<PackProject, 'name'>): string => p.name.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Node pack';

// ── Dependencies ────────────────────────────────────────────────────────────

/** The saved graph a node came from, if it did. */
export function sourceGraphOf(n: PackNode): string | null {
  return n.origin.kind === 'graph' || n.origin.kind === 'graphGroup' ? n.origin.graph : null;
}

/** Every node type a graph's nodes use, groups included. */
export function nodeTypesIn(nodes: unknown, out = new Set<string>()): Set<string> {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    const o = obj(n);
    if (!o) continue;
    if (typeof o.type === 'string') out.add(o.type);
    const sub = obj(obj(o.params)?.subgraph);
    if (sub) nodeTypesIn(sub.nodes, out);
  }
  return out;
}

/** A saved graph's linked presentations (`linkedPresentations`: ids or names), as presentation names here. */
export function linkedPresentationsOf(kv: ReadKV, graph: string): string[] {
  const rec = obj(parse(kv.get(GRAPH_PREFIX + graph)));
  const list = Array.isArray(rec?.linkedPresentations) ? rec.linkedPresentations.filter((x): x is string => typeof x === 'string') : [];
  if (!list.length) return [];
  const out: string[] = [];
  let byId: Map<string, string> | null = null;
  for (const v of list) {
    if (kv.get(PRESENTATION_KEY_PREFIX + v) != null) { out.push(v); continue; }
    if (!byId) {
      byId = new Map();
      for (const k of kv.keys()) {
        if (!k.startsWith(PRESENTATION_KEY_PREFIX)) continue;
        const id = obj(parse(kv.get(k)))?.id;
        if (typeof id === 'string') byId.set(id, k.slice(PRESENTATION_KEY_PREFIX.length));
      }
    }
    const name = byId.get(v);
    if (name) out.push(name);
  }
  return [...new Set(out)];
}

export interface Suggestion { extra: PackExtra; why: string }
export interface Unresolved { graph: string; nodeType: string; label: string; here: boolean }

/**
 * What the pack could bring along, and what its example graphs need that it doesn't have:
 *   suggestions  the graphs its nodes came from, and presentations linked to its graphs
 *   unresolved   published node types an included graph uses that aren't in the pack
 *                (the graph wouldn't compile for someone who has only the pack)
 */
export function collectDependencies(p: Pick<PackProject, 'packNodes' | 'extras'>, env: Pick<PackEnv, 'kv' | 'userNode'>): { suggestions: Suggestion[]; unresolved: Unresolved[] } {
  const suggestions: Suggestion[] = [];
  const graphs = new Set(p.extras.filter(e => e.kind === 'graph').map(e => e.name));
  const pres = new Set(p.extras.filter(e => e.kind === 'presentation').map(e => e.name));
  const suggestedGraphs = new Set<string>();
  for (const n of p.packNodes) {
    const g = sourceGraphOf(n);
    if (!g || graphs.has(g) || suggestedGraphs.has(g) || env.kv.get(GRAPH_PREFIX + g) == null) continue;
    suggestedGraphs.add(g);
    suggestions.push({ extra: { kind: 'graph', name: g, auto: true }, why: `“${n.label}” came from it` });
  }
  const suggestedPres = new Set<string>();
  for (const g of [...graphs, ...suggestedGraphs]) {
    for (const name of linkedPresentationsOf(env.kv, g)) {
      if (pres.has(name) || suggestedPres.has(name)) continue;
      suggestedPres.add(name);
      suggestions.push({ extra: { kind: 'presentation', name, auto: true }, why: `linked to “${g}”` });
    }
  }
  const inPack = new Set(p.packNodes.map(n => n.nodeId));
  const unresolved: Unresolved[] = [];
  for (const g of graphs) {
    const rec = obj(parse(env.kv.get(GRAPH_PREFIX + g)));
    for (const t of nodeTypesIn(rec?.nodes)) {
      if (inPack.has(t)) continue;
      const def = env.userNode(t);
      // Published node types are `un_…`; built-ins come with every copy of the app.
      if (!def && !t.startsWith('un_')) continue;
      unresolved.push({ graph: g, nodeType: t, label: def?.label ?? t, here: !!def });
    }
  }
  return { suggestions, unresolved };
}

// ── Validation ──────────────────────────────────────────────────────────────

export type Level = 'error' | 'warn' | 'info';
export interface Issue { level: Level; text: string }

export interface Validation {
  pack: Issue[];
  /** By node id. */
  nodes: Map<string, Issue[]>;
  /** By extraKey. */
  extras: Map<string, Issue[]>;
  /** Nothing at the error level. */
  ok: boolean;
}

export const extraKey = (e: PackExtra): string => (e.kind === 'graph' || e.kind === 'presentation' ? `${e.kind}:${e.name}` : `${e.kind}:${e.id}`);

/** Compile results by node id (the UI compiles each node with the real compiler; tests pass their own). */
export type CompileResults = ReadonlyMap<string, { ok: boolean; error?: string }>;

export function validatePack(p: PackProject, env: PackEnv, compiled?: CompileResults): Validation {
  const pack: Issue[] = [];
  const nodes = new Map<string, Issue[]>();
  const extras = new Map<string, Issue[]>();
  const add = (m: Map<string, Issue[]>, k: string, i: Issue) => { const l = m.get(k) ?? []; l.push(i); m.set(k, l); };

  if (!p.name.trim()) pack.push({ level: 'error', text: 'Give the pack a name.' });
  if (!parseVersion(p.version)) pack.push({ level: 'error', text: `“${p.version}” isn’t a version: use three numbers, like 1.0.0.` });
  if (!p.packNodes.length && !p.extras.some(e => e.kind === 'finishEffect')) pack.push({ level: 'error', text: 'Add at least one node (or a Finish effect).' });
  if (!p.author.trim()) pack.push({ level: 'info', text: 'No author name: the file will say “Unnamed author”.' });
  const builtin = new Set([...(env.builtinLabels?.() ?? [])].map(l => l.toLowerCase()));

  const labels = namespaceLabels(p.packNodes);
  const seen = new Set<string>();
  for (const r of resolvePackNodes(p, env)) {
    const id = r.node.nodeId;
    if (seen.has(id)) add(nodes, id, { level: 'error', text: 'It’s in the pack twice.' });
    seen.add(id);
    if (!r.def) { add(nodes, id, { level: 'error', text: 'This node type isn’t here any more and the pack kept no copy of it. Remove it, or add it again.' }); continue; }
    if (r.fromSnapshot) add(nodes, id, { level: 'warn', text: 'The node type was deleted here: the pack uses the copy it kept when the node was added.' });
    const final = labels.get(id)!;
    if (final !== r.node.label.trim().replace(/\s+/g, ' ')) add(nodes, id, { level: 'info', text: `Another node in the pack has this name: it goes in as “${final}”.` });
    else if (builtin.has(final.toLowerCase())) add(nodes, id, { level: 'info', text: `A built-in node is also called “${final}”: this one is listed under “${packCategory(p)}”.` });
    const c = compiled?.get(id);
    if (c && !c.ok) add(nodes, id, { level: 'error', text: `It doesn’t compile: ${(c.error ?? '').split('\n')[0].slice(0, 240)}` });
    if (!r.def.outputs.length) add(nodes, id, { level: 'error', text: 'It has no outputs.' });
    if (r.def.sealed && !p.sealed) add(nodes, id, { level: 'info', text: 'It came from a sealed pack, so it goes in sealed.' });
  }

  const { unresolved } = collectDependencies(p, env);
  const sources = new Map<string, string[]>();
  for (const n of p.packNodes) { const g = sourceGraphOf(n); if (g) sources.set(g, [...(sources.get(g) ?? []), n.label]); }
  for (const e of p.extras) {
    const k = extraKey(e);
    if (e.kind === 'graph') {
      if (env.kv.get(GRAPH_PREFIX + e.name) == null) add(extras, k, { level: 'warn', text: 'This saved graph isn’t here any more: it will be left out.' });
      for (const u of unresolved.filter(x => x.graph === e.name)) {
        add(extras, k, { level: 'warn', text: u.here ? `It uses “${u.label}”, which isn’t in the pack: someone with only the pack can’t open it fully. Add that node to the pack.` : `It uses a node type that isn’t here (${u.nodeType}).` });
      }
      const built = sources.get(e.name);
      if (built && p.sealed) add(extras, k, { level: 'warn', text: `It holds how ${built.map(l => `“${l}”`).join(', ')} ${built.length === 1 ? 'is' : 'are'} built: anyone who opens it can read that code, sealed or not.` });
    } else if (e.kind === 'presentation') {
      if (env.kv.get(PRESENTATION_KEY_PREFIX + e.name) == null) add(extras, k, { level: 'warn', text: 'This presentation isn’t here any more: it will be left out.' });
    } else if (e.kind === 'glsl') {
      if (!glslShader(env.kv, e.id)) add(extras, k, { level: 'warn', text: 'This shader isn’t on the GLSL page any more: it will be left out.' });
    } else if (e.kind === 'note') {
      if (!e.text.trim()) add(extras, k, { level: 'info', text: 'It’s empty: it will be left out.' });
    } else if (e.kind === 'finishEffect') {
      if (!loadSavedEffects(listKV(env.kv)).some(x => x.id === e.id)) add(extras, k, { level: 'warn', text: 'This Finish effect isn’t in Your effects any more: it will be left out.' });
    }
  }
  const all = [...pack, ...[...nodes.values()].flat(), ...[...extras.values()].flat()];
  return { pack, nodes, extras, ok: !all.some(i => i.level === 'error') };
}

function glslShader(kv: ReadKV, id: string): { name: string; code: string; note?: string; group?: string } | null {
  const list = parse(kv.get(GLSL_KEY));
  if (!Array.isArray(list)) return null;
  const s = list.map(obj).find(x => x?.id === id);
  return s && typeof s.code === 'string' ? { name: typeof s.name === 'string' ? s.name : 'Shader', code: s.code, note: typeof s.note === 'string' ? s.note : undefined, group: typeof s.group === 'string' ? s.group : undefined } : null;
}

// ── Assembly ────────────────────────────────────────────────────────────────

export interface AssembledPack {
  items: WriteItem[];
  info: PackInfo;
  /** The node types as they go in the file (stored form: sealed ones as blobs). */
  defs: UserNodeDefinition[];
  sealed: boolean;
  notes: string[];
}

export function packInfo(p: PackProject, version = p.version, examples: string[] = [], presentations: string[] = []): PackInfo {
  const notes = p.extras.filter((e): e is Extract<PackExtra, { kind: 'note' }> => e.kind === 'note' && !!e.text.trim()).map(e => ({ name: e.name.trim() || 'Notes', text: e.text }));
  return {
    id: p.id, name: packCategory(p), version,
    ...(p.author.trim() ? { author: p.author.trim() } : {}),
    ...(p.description.trim() ? { description: p.description.trim() } : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(p.icon.trim() ? { icon: p.icon.trim() } : {}),
    ...(p.licence.trim() ? { licence: p.licence.trim() } : {}),
    ...(notes.length ? { notes } : {}),
    ...(examples.length ? { examples } : {}),
    ...(presentations.length ? { presentations } : {}),
  };
}

/** The node types as they go in the file: renamed in the pack, listed under it, sealed when the pack is (or they came sealed). */
export function packDefinitions(p: PackProject, env: Pick<PackEnv, 'userNode'>, now = Date.now()): UserNodeDefinition[] {
  const labels = namespaceLabels(p.packNodes);
  const category = packCategory(p);
  return resolvePackNodes(p, env).flatMap(r => {
    if (!r.def) return [];
    const def: UserNodeDefinition = { ...r.def, label: labels.get(r.node.nodeId) ?? r.def.label, category, savedAt: now };
    delete def.signedBy;
    return [p.sealed || def.sealed ? sealDefinition(def) : storedForm(def)];
  });
}

export async function assemblePack(p: PackProject, env: PackEnv, o: { version?: string; now?: number } = {}): Promise<AssembledPack> {
  const version = o.version ?? p.version;
  const items: WriteItem[] = [];
  const notes: string[] = [];
  const examples: string[] = [];
  const presentations: string[] = [];
  const missing: string[] = [];

  for (const e of p.extras) {
    if (e.kind === 'graph') {
      const v = env.kv.get(GRAPH_PREFIX + e.name);
      if (v == null) { missing.push(`“${e.name}”`); continue; }
      const nodes = obj(parse(v))?.nodes;
      items.push({ kind: 'graph', name: e.name, data: graphFileText(v, false), meta: { example: true, ...(Array.isArray(nodes) ? { detail: plural(nodes.length, 'node') } : {}) } });
      examples.push(e.name);
    } else if (e.kind === 'presentation') {
      const v = env.kv.get(PRESENTATION_KEY_PREFIX + e.name);
      if (v == null) { missing.push(`“${e.name}”`); continue; }
      items.push({ kind: 'presentation', name: e.name, data: env.presentationFile ? await env.presentationFile(e.name, v) : v });
      presentations.push(e.name);
    } else if (e.kind === 'glsl') {
      const s = glslShader(env.kv, e.id);
      if (!s) { missing.push(`“${e.name}”`); continue; }
      items.push({ kind: 'glsl', name: s.name, data: s.code, meta: { ...(s.note ? { note: s.note } : {}), group: s.group || packCategory(p) } });
    } else if (e.kind === 'background') {
      const f = env.backgroundFile ? await env.backgroundFile(e.id) : null;
      if (!f) { missing.push(`“${e.name}”`); continue; }
      items.push({ kind: 'background', name: f.name || e.name, data: f.bytes, ext: extFor(f.type), meta: { type: f.type } });
    }
  }
  // Custom Finish effects travel inside the nodes item (sealed with the pack, or when they came sealed).
  const saved = loadSavedEffects(listKV(env.kv));
  const finishEffects: SavedEffect[] = [];
  for (const e of p.extras) {
    if (e.kind !== 'finishEffect') continue;
    const fx = saved.find(x => x.id === e.id);
    if (!fx) { missing.push(`“${e.name}”`); continue; }
    const out: SavedEffect = { ...fx, pack: packCategory(p) };
    if (p.sealed && !out.sealed) { out.sealed = sealCustomCode(out.code); out.code = ''; }
    finishEffects.push(out);
  }
  if (missing.length) notes.push(`Left out (not here any more): ${missing.join(', ')}.`);

  const info = { ...packInfo(p, version, examples, presentations), ...(finishEffects.length ? { finishEffects: finishEffects.map(f => f.name) } : {}) };
  const defs = packDefinitions(p, env, o.now);
  const sealed = defs.length > 0 && defs.every(d => !!d.sealed);
  const nodesItem: WriteItem = {
    kind: 'nodes', name: info.name,
    data: JSON.stringify({ version: 1, nodes: defs, pack: info, ...(finishEffects.length ? { finishEffects } : {}) }, null, 1),
    meta: { count: defs.length, ...(finishEffects.length ? { finishEffects: finishEffects.length } : {}), sealed: sealed ? true : defs.some(d => !!d.sealed) ? 'some' : false, labels: defs.map(d => d.label).slice(0, 50), pack: { id: info.id, name: info.name, version } },
  };
  return { items: [nodesItem, ...items], info, defs, sealed, notes };
}

function extFor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  if (t.includes('avif')) return '.avif';
  if (t.includes('svg')) return '.svg';
  return '.bin';
}

/** Byte length of an item's data (for the export summary). */
export const itemBytes = (it: WriteItem): number => (typeof it.data === 'string' ? new TextEncoder().encode(it.data).length : it.data.length);

/** The pack's KV as the Finish library reads it (read-only here). */
function listKV(kv: ReadKV): ListKV {
  return { get: k => kv.get(k), set: () => ({ ok: false, error: 'read-only' }) };
}
