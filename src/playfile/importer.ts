/**
 * Importing a .playfile: what each item would become here (the preview), and
 * then bringing in the chosen ones.
 *
 *   planImport(contents, env)      rows: one per graph, Play setup,
 *                                  presentation, node type, shader, image, and
 *                                  one per library or profile item; each new,
 *                                  already here, a clash (same name, different
 *                                  content), needs Pro, or unreadable
 *   applyImport(plan, picks, env)  brings in the ticked rows; a clash is kept
 *                                  as both ("Name (2)") or replaces yours
 *
 * Nothing in the file runs: graphs and presentations are stored as data,
 * presentations are marked as imported (their Script layers run sandboxed),
 * and nodes are GLSL for the compiler. All storage goes through `env`, so
 * tests run it on a map.
 */
import type { UserNodeDefinition } from '../types/userNode';
import { parsePresentation } from '../types/presentation';
import { freePresentationName, isGraphKey, PRESENTATION_KEY_PREFIX, type LibrarySnapshot } from '../utils/library';
import { GLSL_KEY, GRAPH_PREFIX, parseJson } from '../files/inventory';
import type { MutableKV } from '../files/mutate';
import { freeName, installMerge, previewInstall, readProfile, type InstallSummary, type Profile } from '../files/profileZip';
import type { FilesSource } from '../files/sources';
import { fromUtf8 } from './bytes';
import { KIND_LAYOUT, type ItemKind } from './format';
import type { PlayfileContents, ReadItem, SignatureStatus } from './reader';
import { sealDefinition, storedForm, unsealDefinition } from './sealing';
import { videoFilesFor } from './bundle';
import { readPackInfo, type InstalledPack, type PackInfo } from '../nodePacks/types';
import { installEffects, loadSavedEffects, parseSavedEffect, type SavedEffect } from '../play/finishLibrary';

export type RowStatus = 'new' | 'same' | 'conflict' | 'needs-pro' | 'unreadable';
export type Choice = 'keep-both' | 'replace';

export interface ImportRow {
  id: string;
  kind: ItemKind;
  name: string;
  bytes: number;
  status: RowStatus;
  /** One short line: "24 nodes · Play", "3 in · 1 out". */
  detail?: string;
  /** Why it can't come in (unreadable, needs Pro). */
  reason?: string;
  /** Came along as something another item uses. */
  dependency?: boolean;
  sealed?: boolean;
  /** Ticked by default. */
  include: boolean;
  /** The default for a clash. */
  choice: Choice;
  /** What it is, read (kind-specific). */
  value: unknown;
}

export interface ImportPlan {
  rows: ImportRow[];
  contents: PlayfileContents;
  /** Node packs made in the pack workspace: their name, version, notes and examples (by the `nodes` item's path). */
  packs?: Array<{ path: string; info: PackInfo }>;
}

export interface ImportEnv {
  kv: MutableKV;
  /** The plan's entitlement check (profile items need `files.install`). */
  can: (feature: 'files.install') => boolean;
  userNode: (id: string) => UserNodeDefinition | undefined;
  /** Every node type's label here (for naming a kept-both copy). */
  nodeLabels?: () => string[];
  registerNode: (def: UserNodeDefinition) => Promise<{ ok: boolean; error?: string }>;
  makeNodeId: (label: string) => string;
  /** Store a graph (archiving the one it replaces into its history); the app's saveGraph path. */
  writeGraph?: (name: string, value: string) => void;
  /** Background images already here (for "already here"). */
  backgrounds?: () => Promise<Array<{ name: string; bytes: number }>>;
  addBackground?: (bytes: Uint8Array, type: string, name: string) => Promise<void>;
  /** The profile Install path (for `profile` items). */
  installProfile?: (profile: Profile) => Promise<InstallSummary>;
  /** Stores for a profile's preview (backgrounds). */
  sources?: FilesSource[];
  /** Is this video (by its id) in the videos library already? */
  hasVideo?: (id: string) => Promise<boolean>;
  /** Put videos into the library: the files `importVideoFiles` reads (lib/backgroundLibrary.ts). */
  addVideos?: (files: Record<string, Uint8Array>) => Promise<{ added: number; same: number; skipped: number }>;
  /** Remember a node pack that came in (its category, nodes and examples). */
  recordPack?: (pack: InstalledPack) => void;
  now?: () => number;
}

export interface ImportSummary {
  added: Array<{ kind: ItemKind; name: string }>;
  replaced: Array<{ kind: ItemKind; name: string }>;
  renamed: Array<{ kind: ItemKind; from: string; to: string }>;
  same: number;
  failed: Array<{ name: string; error: string }>;
  /** Storage keys written (for refreshing the app's caches). */
  changedKeys: string[];
  /** What to open afterwards: the file's one graph or Play setup, or its one presentation. */
  open?: { kind: 'graph' | 'play' | 'presentation'; name: string };
  /** Node packs that came in. */
  packs?: InstalledPack[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Content of a graph for "is it the same": what it draws and plays, not when it was saved. */
function graphContent(v: unknown): string {
  const g = obj(v);
  return g ? JSON.stringify([g.nodes, g.looseGroups ?? null, g.play ?? null, g.datasets ?? null]) : '';
}

function nodeContent(d: UserNodeDefinition): string {
  const { savedAt: _s, signedBy: _b, sealed, ...rest } = storedForm(d);
  void _s; void _b;
  // Two seals of the same code differ in salt: compare the readable parts and whether it's sealed.
  return JSON.stringify({ ...rest, sealed: !!sealed });
}

function isNodeDefinition(d: unknown): d is UserNodeDefinition {
  const x = obj(d);
  return !!x && typeof x.id === 'string' && /^[\w-]{1,120}$/.test(x.id) && typeof x.label === 'string' && typeof x.fnName === 'string' && /^[A-Za-z_]\w{0,120}$/.test(x.fnName)
    && typeof x.functionCode === 'string' && Array.isArray(x.inputs) && Array.isArray(x.outputs) && Array.isArray(x.params)
    && (!x.sealed || !!obj(x.sealed));
}

/** A graph name that is safe as a storage key (not a preset or a setting). */
export function graphNameFor(name: string): string {
  // eslint-disable-next-line no-control-regex
  const n = name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100) || 'Imported graph';
  return isGraphKey(GRAPH_PREFIX + n, '{"nodes":[]}') ? n : `Imported ${n}`;
}

function glslList(kv: MutableKV): Obj[] {
  const l = parseJson(kv.get(GLSL_KEY));
  return Array.isArray(l) ? l.map(obj).filter((x): x is Obj => !!x) : [];
}

export async function planImport(contents: PlayfileContents, env: ImportEnv): Promise<ImportPlan> {
  const rows: ImportRow[] = [];
  const sig = contents.signature;
  // Nodes from a file whose signature doesn't hold aren't ticked: someone changed it.
  const nodesOk = sig.state !== 'modified';
  const bgs = env.backgrounds ? await env.backgrounds().catch(() => []) : [];
  const packs: Array<{ path: string; info: PackInfo }> = [];
  for (const it of contents.items) {
    const dependency = it.meta?.dependency === true;
    const base = { kind: it.kind, bytes: it.bytes, dependency, include: true, choice: 'keep-both' as Choice };
    const bad = (reason: string, name = it.name): ImportRow => ({ ...base, id: it.path, name, status: 'unreadable', reason, include: false, value: null });
    switch (it.kind) {
      case 'graph':
      case 'play': {
        const g = obj(parseJson(fromUtf8(it.data)));
        if (!g || !Array.isArray(g.nodes)) { rows.push(bad('Not a graph: it has no nodes')); break; }
        const name = graphNameFor(it.name);
        const mine = parseJson(env.kv.get(GRAPH_PREFIX + name));
        const status: RowStatus = mine == null ? 'new' : graphContent(mine) === graphContent(g) ? 'same' : 'conflict';
        const play = obj(g.play);
        const detail = [plural(g.nodes.length, 'node'), play && (Array.isArray(play.controls) && play.controls.length || Array.isArray(play.layers) && play.layers.length) ? 'Play' : ''].filter(Boolean).join(' · ');
        rows.push({ ...base, id: it.path, name, status, detail, include: status !== 'same', value: g });
        break;
      }
      case 'presentation': {
        const raw = parseJson(fromUtf8(it.data));
        const p = parsePresentation(raw);
        if (!p) { rows.push(bad('Not a presentation')); break; }
        const name = (it.name || p.title).trim() || 'Untitled presentation';
        const mine = parsePresentation(parseJson(env.kv.get(PRESENTATION_KEY_PREFIX + name)));
        const strip = (x: object) => JSON.stringify({ ...x, title: '', updatedAt: 0, createdAt: 0, origin: undefined });
        const status: RowStatus = !mine ? 'new' : strip(mine) === strip(p) ? 'same' : 'conflict';
        rows.push({ ...base, id: it.path, name, status, detail: `${plural(p.steps.length, 'step')} · ${plural(p.sources.length, 'Play')}`, include: status !== 'same', value: p });
        break;
      }
      case 'nodes': {
        const raw = parseJson(fromUtf8(it.data));
        const list: unknown[] = Array.isArray(obj(raw)?.nodes) ? obj(raw)!.nodes as unknown[] : Array.isArray(raw) ? raw : [raw];
        const info = readPackInfo(raw);
        // A pack's nodes are listed under the pack's name (docs/node-packs.md, "Namespacing").
        const defs = list.filter(isNodeDefinition).map(d => (info ? { ...d, category: info.name } : d));
        // Custom Finish effects a pack carries (docs/finish-stack.md): into Your effects, sealed ones sealed.
        const fxRaw = obj(raw)?.finishEffects;
        const effects = (Array.isArray(fxRaw) ? fxRaw : []).map(parseSavedEffect).filter((x): x is SavedEffect => !!x).map(x => (info ? { ...x, pack: info.name } : x));
        if (!defs.length && !effects.length) { rows.push(bad('No node types in it')); break; }
        if (info) packs.push({ path: it.path, info });
        const haveFx = loadSavedEffects(env.kv);
        for (const fx of effects) {
          const mine = haveFx.find(x => x.id === fx.id);
          const status: RowStatus = !mine ? 'new' : mine.code === fx.code && JSON.stringify(mine.sealed ?? null) === JSON.stringify(fx.sealed ?? null) ? 'same' : 'conflict';
          rows.push({ ...base, id: `${it.path}#fx:${fx.id}`, name: fx.name, status, sealed: !!fx.sealed, detail: 'Finish effect', choice: 'replace', include: status !== 'same' && nodesOk, value: fx });
        }
        for (const d of defs) {
          const mine = env.userNode(d.id);
          const status: RowStatus = !mine ? 'new' : nodeContent(mine) === nodeContent(d) ? 'same' : 'conflict';
          rows.push({
            ...base, id: `${it.path}#${d.id}`, name: d.label, status, sealed: !!d.sealed,
            detail: `${d.inputs.length} in · ${d.outputs.length} out${d.params.length ? ` · ${plural(d.params.length, 'slider')}` : ''}`,
            // Updating a node type you already have is what sharing it again means: replace by default.
            choice: 'replace', include: status !== 'same' && nodesOk, value: d,
          });
        }
        break;
      }
      case 'glsl': {
        const code = fromUtf8(it.data);
        if (!code.trim()) { rows.push(bad('It’s empty')); break; }
        const mine = glslList(env.kv).find(s => s.name === it.name);
        const status: RowStatus = !mine ? 'new' : mine.code === code ? 'same' : 'conflict';
        rows.push({ ...base, id: it.path, name: it.name, status, detail: plural(code.split('\n').length, 'line'), include: status !== 'same', value: { code, note: typeof it.meta?.note === 'string' ? it.meta.note : undefined, group: typeof it.meta?.group === 'string' ? it.meta.group : undefined } });
        break;
      }
      case 'background': {
        const type = typeof it.meta?.type === 'string' && /^image\//.test(it.meta.type) ? it.meta.type : typeFromPath(it.path);
        if (!type) { rows.push(bad('Not an image')); break; }
        const same = bgs.some(b => b.name === it.name && b.bytes === it.bytes);
        rows.push({ ...base, id: it.path, name: it.name, status: same ? 'same' : 'new', detail: type.replace('image/', '').toUpperCase(), include: !same, value: { type } });
        break;
      }
      case 'library': {
        const snap = obj(parseJson(fromUtf8(it.data))) as LibrarySnapshot | undefined;
        if (!snap || !obj(snap.items)) { rows.push(bad('Not a library snapshot')); break; }
        const pv = await previewInstall({ snapshot: snap, manifest: null, files: {} }, env.kv, []);
        const fresh = pv.counts.new + pv.counts.rename + pv.counts.merge;
        rows.push({ ...base, id: it.path, name: it.name, status: fresh ? 'new' : 'same', detail: [plural(pv.rows.length, 'item'), pv.counts.rename ? `${pv.counts.rename} under a new name` : '', pv.counts.same ? `${pv.counts.same} already here` : ''].filter(Boolean).join(' · '), include: fresh > 0, value: snap });
        break;
      }
      case 'video': {
        const id = typeof it.meta?.id === 'string' ? it.meta.id : '';
        // Video layers' files and drum pads' samples (audio) share the store.
        const type = typeof it.meta?.type === 'string' && /^(video|audio)\//.test(it.meta.type) ? it.meta.type : videoTypeFromPath(it.path);
        if (!id || !type) { rows.push(bad('Not a video or sound this version can keep')); break; }
        const here = env.hasVideo ? await env.hasVideo(id).catch(() => false) : false;
        rows.push({ ...base, id: it.path, name: it.name, status: here ? 'same' : 'new', detail: `${type.startsWith('audio/') ? 'Sound · ' : ''}${type.replace(/^(video|audio)\//, '').replace(/^x-/, '').toUpperCase()}`, include: !here, value: { id, type } });
        break;
      }
      case 'profile': {
        let profile: Profile;
        try { profile = readProfile(it.data); } catch (e) { rows.push(bad(`Not a profile: ${e instanceof Error ? e.message : String(e)}`)); break; }
        const pv = await previewInstall(profile, env.kv, env.sources ?? []);
        const pro = env.can('files.install');
        rows.push({ ...base, id: it.path, name: it.name, status: pro ? 'new' : 'needs-pro', reason: pro ? undefined : 'Installing a profile is part of Pro', detail: `${plural(pv.rows.length, 'item')} · ${pv.counts.new} new`, include: pro, value: profile });
        break;
      }
    }
  }
  return { rows, contents, ...(packs.length ? { packs } : {}) };
}

const AUDIO_TYPES: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm', aif: 'audio/aiff', aiff: 'audio/aiff' };
function videoTypeFromPath(p: string): string | null {
  const e = /\.(mp4|m4v|webm|mov|ogv|wav|mp3|ogg|oga|m4a|aac|flac|weba|aiff?)$/i.exec(p)?.[1]?.toLowerCase();
  if (!e) return null;
  if (AUDIO_TYPES[e]) return AUDIO_TYPES[e];
  return e === 'mov' ? 'video/quicktime' : e === 'm4v' ? 'video/x-m4v' : e === 'ogv' ? 'video/ogg' : `video/${e}`;
}

function typeFromPath(p: string): string | null {
  const m = /\.(png|jpe?g|webp|gif|avif|svg)$/i.exec(p);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'jpg' ? 'image/jpeg' : e === 'svg' ? 'image/svg+xml' : `image/${e}`;
}

export interface Pick { include: boolean; choice: Choice }

export async function applyImport(plan: ImportPlan, picks: Record<string, Pick>, env: ImportEnv): Promise<ImportSummary> {
  const now = env.now?.() ?? Date.now();
  const sum: ImportSummary = { added: [], replaced: [], renamed: [], same: 0, failed: [], changedKeys: [] };
  const signedBy = signedByOf(plan.contents.signature);
  const set = (k: string, v: string) => { env.kv.set(k, v); sum.changedKeys.push(k); };
  const pick = (r: ImportRow): Pick => picks[r.id] ?? { include: r.include, choice: r.choice };
  const graphsIn: Array<{ kind: 'graph' | 'play'; name: string }> = [];
  const presIn: string[] = [];
  /** Node rows that came in, by row id → the id registered (a kept-both copy has a new one). */
  const nodeIdsIn = new Map<string, string>();

  for (const r of plan.rows) {
    const p = pick(r);
    if (!p.include || r.status === 'unreadable' || r.status === 'needs-pro') continue;
    if (r.status === 'same') { sum.same++; continue; }
    const replace = r.status === 'conflict' && p.choice === 'replace';
    try {
      switch (r.kind) {
        case 'graph':
        case 'play': {
          const g = { ...(r.value as Obj) };
          delete g.kind;
          const name = r.status === 'conflict' && !replace ? freeName(r.name, n => env.kv.get(GRAPH_PREFIX + n) != null) : r.name;
          const value = JSON.stringify({ ...g, savedAt: now });
          if (env.writeGraph) { env.writeGraph(name, value); sum.changedKeys.push(GRAPH_PREFIX + name); } else set(GRAPH_PREFIX + name, value);
          record(sum, r, name, replace);
          graphsIn.push({ kind: r.kind, name });
          break;
        }
        case 'presentation': {
          const doc = r.value as ReturnType<typeof parsePresentation> & object;
          const name = r.status === 'conflict' && !replace ? freePresentationName(r.name, env.kv) : r.name;
          // Someone else's presentation: its Script layers run in a sandboxed frame.
          set(PRESENTATION_KEY_PREFIX + name, JSON.stringify({ ...doc, title: name, origin: 'imported', updatedAt: now }));
          record(sum, r, name, replace);
          presIn.push(name);
          break;
        }
        case 'nodes': {
          if (r.id.includes('#fx:')) {
            // A Finish effect from a pack: kept both, it comes in under a new id and name.
            let fx = { ...(r.value as SavedEffect), savedAt: now };
            if (r.status === 'conflict' && !replace) {
              const names = new Set(loadSavedEffects(env.kv).map(x => x.name));
              fx = { ...fx, id: `${fx.id}_${now.toString(36)}`, name: freeName(fx.name, n => names.has(n)) };
            }
            const res = installEffects([fx], env.kv);
            if (!res.ok) throw new Error(res.error);
            sum.changedKeys.push('shader-studio:finish-effects');
            record(sum, r, fx.name, replace);
            break;
          }
          let def = { ...(r.value as UserNodeDefinition), savedAt: now, ...(signedBy ? { signedBy } : {}) };
          if (!signedBy) delete def.signedBy;
          let name = def.label;
          if (r.status === 'conflict' && !replace) {
            const labels = new Set(env.nodeLabels?.() ?? [env.userNode(def.id)?.label ?? '']);
            name = freeName(def.label, l => labels.has(l));
            def = renameNode(def, env.makeNodeId(def.label), name);
          }
          const res = await env.registerNode(def);
          if (!res.ok) throw new Error(res.error ?? 'It couldn’t be saved');
          nodeIdsIn.set(r.id, def.id);
          sum.changedKeys.push(`shader-studio:un:${def.id}`);
          record(sum, r, name, replace);
          break;
        }
        case 'glsl': {
          const v = r.value as { code: string; note?: string; group?: string };
          const list = glslList(env.kv);
          let name = r.name;
          if (replace) {
            const i = list.findIndex(s => s.name === r.name);
            list[i] = { ...list[i], code: v.code, ...(v.note ? { note: v.note } : {}) };
          } else {
            if (r.status === 'conflict') name = freeName(r.name, n => list.some(s => s.name === n));
            list.push({ id: `sh_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name, code: v.code, ...(v.group ? { group: v.group } : {}), ...(v.note ? { note: v.note } : {}) });
          }
          set(GLSL_KEY, JSON.stringify(list));
          record(sum, r, name, replace);
          break;
        }
        case 'background': {
          if (!env.addBackground) throw new Error('Background images can’t be stored here');
          const item = plan.contents.items.find(i => i.path === r.id) as ReadItem;
          await env.addBackground(item.data, (r.value as { type: string }).type, r.name);
          record(sum, r, r.name, false);
          break;
        }
        case 'video': {
          if (!env.addVideos) throw new Error('Videos can’t be stored here');
          const item = plan.contents.items.find(i => i.path === r.id) as ReadItem;
          const res = await env.addVideos(videoFilesFor(item));
          if (!res.added && !res.same) throw new Error('The video couldn’t be kept');
          record(sum, r, r.name, false);
          break;
        }
        case 'library': {
          const res = installMerge({ snapshot: r.value as LibrarySnapshot, manifest: null, files: {} }, env.kv);
          sum.changedKeys.push(...res.changedKeys);
          sum.added.push({ kind: 'library', name: `${r.name} (${res.added} added${res.renamed.length ? `, ${res.renamed.length} renamed` : ''})` });
          for (const x of res.renamed) sum.renamed.push({ kind: 'library', from: x.from, to: x.to });
          sum.same += res.same;
          break;
        }
        case 'profile': {
          if (!env.installProfile) throw new Error('Profiles can’t be installed here');
          const res = await env.installProfile(r.value as Profile);
          sum.changedKeys.push(...res.changedKeys);
          sum.added.push({ kind: 'profile', name: `${r.name} (${res.added} added)` });
          break;
        }
      }
    } catch (e) {
      sum.failed.push({ name: r.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  remapLinks(env.kv, sum);
  if (plan.packs?.length) {
    sum.packs = [];
    const renamed = (kind: 'graph' | 'presentation', name: string) => sum.renamed.find(x => (x.kind === kind || (kind === 'graph' && x.kind === 'play')) && x.from === name)?.to ?? name;
    const graphNames = new Set(graphsIn.map(g => g.name));
    const presNames = new Set(presIn);
    for (const { path, info } of plan.packs) {
      const nodeIds = plan.rows.filter(r => r.kind === 'nodes' && r.id.startsWith(`${path}#`) && !r.id.includes('#fx:'))
        .map(r => nodeIdsIn.get(r.id) ?? (r.status === 'same' ? (r.value as UserNodeDefinition).id : ''))
        .filter(Boolean);
      if (!nodeIds.length) continue;
      const pack: InstalledPack = {
        ...info,
        examples: (info.examples ?? []).map(n => renamed('graph', graphNameFor(n))).filter(n => graphNames.has(n) || env.kv.get(GRAPH_PREFIX + n) != null),
        presentations: (info.presentations ?? []).map(n => renamed('presentation', n)).filter(n => presNames.has(n) || env.kv.get(PRESENTATION_KEY_PREFIX + n) != null),
        nodeIds, category: info.name, installedAt: now,
        ...(signedBy ? { signedBy } : {}),
      };
      sum.packs.push(pack);
      env.recordPack?.(pack);
    }
  }
  const chosenGraphs = graphsIn.filter(g => !plan.rows.find(r => r.name === g.name && r.dependency));
  // A node pack's graphs are its examples: they're opened from the pack's entry in the node list, not straight away.
  if (sum.packs?.length) return sum;
  if (chosenGraphs.length === 1 && !presIn.length) sum.open = { kind: chosenGraphs[0].kind, name: chosenGraphs[0].name };
  else if (presIn.length === 1) sum.open = { kind: 'presentation', name: presIn[0] };
  return sum;
}

/**
 * A copy of a node type under a new id (and so a new GLSL function name):
 * kept both, the two must not define the same function. A sealed one is
 * opened, renamed and sealed again.
 */
export function renameNode(def: UserNodeDefinition, id: string, label: string): UserNodeDefinition {
  const open = def.sealed ? unsealDefinition(def) : def;
  const fnName = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/_{2,}/g, '_');
  const re = new RegExp(`\\b${open.fnName}(?=(_i\\d+)?\\b)`, 'g');
  const renamed: UserNodeDefinition = {
    ...open, id, label, fnName,
    functionCode: open.functionCode.replace(re, fnName),
    ...(open.iterations ? { iterations: { ...open.iterations, functions: Object.fromEntries(Object.entries(open.iterations.functions).map(([k, v]) => [k, v.replace(re, fnName)])) } } : {}),
  };
  if (!def.sealed) return renamed;
  const { sealed: _old, ...plain } = renamed;
  void _old;
  return sealDefinition(plain);
}

/**
 * Graphs and presentations that came in under a new name keep their links:
 * a graph's `linkedPresentations` and a presentation's `linkedGraphs` that
 * named the old one name the new one (links by id need nothing).
 */
function remapLinks(kv: MutableKV, sum: ImportSummary): void {
  const graphs = new Map(sum.renamed.filter(r => r.kind === 'graph' || r.kind === 'play').map(r => [r.from, r.to]));
  const pres = new Map(sum.renamed.filter(r => r.kind === 'presentation').map(r => [r.from, r.to]));
  if (!graphs.size && !pres.size) return;
  for (const k of new Set(sum.changedKeys)) {
    const isPres = k.startsWith(PRESENTATION_KEY_PREFIX);
    if (!isPres && !(k.startsWith(GRAPH_PREFIX) && !k.startsWith('shader-studio:un:') && k !== GLSL_KEY)) continue;
    const rec = obj(parseJson(kv.get(k)));
    const field = isPres ? 'linkedGraphs' : 'linkedPresentations';
    const map = isPres ? graphs : pres;
    const list = rec?.[field];
    if (!rec || !Array.isArray(list) || !list.some(v => typeof v === 'string' && map.has(v))) continue;
    kv.set(k, JSON.stringify({ ...rec, [field]: list.map(v => (typeof v === 'string' ? map.get(v) ?? v : v)) }));
  }
}

function record(sum: ImportSummary, r: ImportRow, name: string, replaced: boolean): void {
  if (replaced) sum.replaced.push({ kind: r.kind, name });
  else if (name !== r.name) sum.renamed.push({ kind: r.kind, from: r.name, to: name });
  else sum.added.push({ kind: r.kind, name });
}

function signedByOf(s: SignatureStatus): UserNodeDefinition['signedBy'] | undefined {
  return s.state === 'signed' ? { name: s.name, fingerprint: s.fingerprint } : undefined;
}

/** "3 graphs, 1 node pack": what a file holds, by kind. */
export function describeKinds(rows: ImportRow[]): string {
  const by = new Map<ItemKind, number>();
  for (const r of rows) by.set(r.kind, (by.get(r.kind) ?? 0) + 1);
  return [...by].map(([k, n]) => (n === 1 ? `1 ${KIND_LAYOUT[k].label.toLowerCase()}` : `${n} ${KIND_LAYOUT[k].plural.toLowerCase()}`)).join(', ');
}

