/**
 * The app's side of .playfile: opening one (the preview dialog, then the
 * import), and every export that writes one. The container itself is
 * reader.ts / writer.ts; choosing what goes in is bundle.ts; what an import
 * does is importer.ts. This module wires them to the app's storage, the
 * plan, the signing key and the file dialogs. The dialogs are in
 * components/playfile/.
 */
import { create } from 'zustand';
import { can, requireFeature, usePlan } from '../lib/plan';
import { toast } from '../components/ui/toastStore';
import { askText } from '../components/ui/dialogStore';
import { errorMessage, saveBinaryFile, type FileResult } from '../utils/fileIO';
import { buildInventory, GRAPH_PREFIX, type Inventory } from '../files/inventory';
import { localMutableKV, type MutableKV } from '../files/mutate';
import { listExternal, filesSources } from '../files/sources';
import '../files/backgroundsSource';
import { installMerge, installSources, type Profile } from '../files/profileZip';
import { getAllUserNodes, getUserNode, makeUserNodeId, registerUserNode } from '../nodes/userNodes/userNodeRegistry';
import { addImage, getImage, hasVideo, importVideoFiles, listImages, videoZipFiles } from '../lib/backgroundLibrary';
import { recordInstalledPack } from '../nodePacks/installed';
import { archiveCurrent } from '../store/graphVersions';
import { parsePresentation } from '../types/presentation';
import { PRESENTATION_KEY_PREFIX } from '../utils/library';
import { buildBundle, videoIdsIn, videoItemsFrom, type BundleOptions } from './bundle';
import type { WriteItem } from './writer';
import { applyImport, planImport, type ImportEnv, type ImportPlan, type ImportSummary, type Pick } from './importer';
import { isPlayfile, readPlayfile, type PlayfileContents } from './reader';
import { authorName, authorSigner, existingAuthorKey, trustAuthor, type Signer } from './signing';
import { playfileName, writePlayfile } from './writer';
import { PLAYFILE_MIME } from './format';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── UI state (rendered by components/playfile/PlayfileHost) ────────────────

export interface OpenImport { fileName: string; contents: PlayfileContents; plan: ImportPlan }

export const usePlayfileUi = create<{
  importing: OpenImport | null;
  /** The node pack dialog: which node types. */
  pack: { ids: string[] } | null;
}>(() => ({ importing: null, pack: null }));

/** Ask the app to show a page (App listens). */
export const OPEN_PAGE_EVENT = 'playfile-open-page';
function openPage(page: 'studio' | 'play' | 'present'): void {
  window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: page }));
}

// ── Opening ────────────────────────────────────────────────────────────────

export function appImportEnv(): ImportEnv {
  return {
    kv: localMutableKV,
    can: f => can(f),
    userNode: getUserNode,
    nodeLabels: () => getAllUserNodes().map(d => d.label),
    registerNode: async def => registerUserNode(def),
    makeNodeId: makeUserNodeId,
    // The graph a replace overwrites goes into its history first, like a save.
    writeGraph: (name, value) => {
      const version = archiveCurrent(name);
      localStorage.setItem(GRAPH_PREFIX + name, JSON.stringify({ ...JSON.parse(value), version }));
    },
    backgrounds: async () => (await listImages()).map(m => ({ name: m.name, bytes: m.bytes })),
    addBackground: async (bytes, type, name) => { await addImage(new Blob([bytes.slice().buffer], { type }), { name }); },
    installProfile: async (profile: Profile) => installSources(profile, 'merge', installMerge(profile, localMutableKV)),
    sources: filesSources(),
    hasVideo,
    addVideos: importVideoFiles,
    recordPack: recordInstalledPack,
  };
}

/** Open a .playfile's bytes: read, check and show what's inside. False (after saying why) when it can't be opened. */
export async function openPlayfileBytes(fileName: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const contents = await readPlayfile(bytes);
    const plan = await planImport(contents, appImportEnv());
    usePlayfileUi.setState({ importing: { fileName, contents, plan } });
    return true;
  } catch (e) {
    toast.error(`Couldn’t open “${fileName}”`, { message: errorMessage(e) });
    return false;
  }
}

export { isPlayfile };

/** Bring in the picked rows, remember the author if asked, refresh the app, and open what came in. */
export async function runImport(plan: ImportPlan, picks: Record<string, Pick>, opts: { trust?: boolean } = {}): Promise<ImportSummary> {
  const sig = plan.contents.signature;
  if (opts.trust && sig.state === 'signed') trustAuthor(sig.name, sig.publicKey);
  const summary = await applyImport(plan, picks, appImportEnv());
  // Presentations that came in with their pictures and fonts embedded keep references to the library instead.
  try {
    const [{ internStoredPresentations }, { savePresentation }] = await Promise.all([import('../present/presentAssets'), import('../present/storage')]);
    await internStoredPresentations(savePresentation);
  } catch { /* they stay embedded */ }
  const { syncApp } = await import('../components/files/filesActions');
  syncApp(summary.changedKeys);
  window.dispatchEvent(new Event('presentations-changed'));
  if (summary.open) {
    const { useNodeGraphStore } = await import('../store/useNodeGraphStore');
    const st = useNodeGraphStore.getState();
    if (summary.open.kind === 'presentation') {
      const { rememberLast } = await import('../present/storage');
      rememberLast(summary.open.name);
      openPage('present');
    } else if (!st.graphDirty) {
      const r = st.loadSavedGraph(summary.open.name);
      if (r.ok) {
        if (summary.open.kind === 'play') useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 }));
        else openPage('studio');
      }
    }
  }
  return summary;
}

// ── Writing ────────────────────────────────────────────────────────────────

/** Sign with this author's key: always for a node pack (made on first use), otherwise only when a key already exists. */
export async function signerFor(pack: boolean): Promise<Signer | null> {
  try {
    if (pack) return await authorSigner();
    return (await existingAuthorKey()) ? await authorSigner() : null;
  } catch (e) {
    if (pack) throw new Error(`The signing key couldn’t be made or read: ${errorMessage(e)}`);
    return null;
  }
}

export function currentAuthorName(): string {
  const s = usePlan.getState().session;
  return authorName() || (s.status === 'signed-in' ? s.user : '') || '';
}

async function inventoryWith(overlay?: Record<string, string>): Promise<{ kv: MutableKV; inv: Inventory }> {
  const extra = overlay ?? {};
  const kv: MutableKV = {
    keys: () => [...new Set([...localMutableKV.keys(), ...Object.keys(extra)])],
    get: k => (k in extra ? extra[k] : localMutableKV.get(k)),
    set: () => { throw new Error('read-only'); },
    remove: () => { throw new Error('read-only'); },
  };
  return { kv, inv: await buildInventory(kv, { external: await listExternal() }) };
}

export const appBundleEnv = {
  presentationFile: async (_name: string, stored: string) => {
    const [{ withEmbeddedAssets }, { presentationFileJson }] = await Promise.all([import('../present/presentAssets'), import('../present/exportPresentation')]);
    const p = parsePresentation(JSON.parse(stored));
    if (!p) return stored;
    return presentationFileJson((await withEmbeddedAssets(p)).doc);
  },
  backgroundFile: async (source: string, id: string) => {
    if (source !== 'backgrounds') return null;
    const img = await getImage(id);
    return img ? { bytes: new Uint8Array(await img.blob.arrayBuffer()), type: img.type, name: img.name } : null;
  },
};

export interface ExportOptions extends BundleOptions {
  fileName: string;
  /** Storage to add before choosing (the open graph, saved or not). */
  overlay?: Record<string, string>;
  /** A node pack: signed (the key is made if needed). */
  pack?: boolean;
  author?: string;
  success?: string;
}

/** Write chosen things (Files page ids) as one .playfile. */
export async function exportPlayfile(ids: string[], opts: ExportOptions): Promise<FileResult> {
  try {
    const { kv, inv } = await inventoryWith(opts.overlay);
    const bundle = await buildBundle(kv, inv, ids, { canPack: can('nodes.pack'), ...opts }, appBundleEnv);
    if (!bundle.items.length) return { ok: false, error: bundle.notes.join(' ') || 'Nothing to export.' };
    const videos = await videosFor(bundle.items);
    if (videos === null) return { ok: false, error: 'Cancelled', cancelled: true };
    bundle.items.push(...videos.items);
    if (videos.note) bundle.notes.push(videos.note);
    const signer = await signerFor(!!opts.pack);
    const { bytes, manifest } = await writePlayfile(bundle.items, { author: opts.author ?? currentAuthorName(), signer });
    const res = await saveBinaryFile(bytes, playfileName(opts.fileName), PLAYFILE_MIME);
    if (res.ok) {
      const msg = [`${plural(manifest.items.length, 'item')}${signer ? `, signed (${signer.fingerprint})` : ''}.`, ...bundle.notes].join(' ');
      toast.success(opts.success ?? `Saved ${playfileName(opts.fileName)}`, { message: msg });
    }
    return res;
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * The videos the items' Video layers use, as `video` items (the videos library's
 * files). Past 200 MB in all it asks first, like a library ZIP; null when the
 * export was called off.
 */
export async function videosFor(items: readonly WriteItem[]): Promise<{ items: WriteItem[]; note?: string } | null> {
  const ids = videoIdsIn(items);
  if (!ids.length) return { items: [] };
  try {
    const { askVideosInZip } = await import('../utils/libraryVideos');
    const choice = await askVideosInZip(undefined, undefined, ids);
    if (choice === null) return null;
    if (choice === 'none') return { items: [], note: `${plural(ids.length, 'video')} left out: the Video layers ask for their files after an import.` };
    const out = videoItemsFrom(await videoZipFiles(ids));
    const missing = ids.length - out.length;
    return { items: out, note: missing > 0 ? `${plural(missing, 'video')} this device doesn’t have couldn’t go in.` : undefined };
  } catch { return { items: [] }; }
}


/** The open graph (or its Play setup) as a .playfile, with what it uses. */
export async function exportCurrentGraph(asPlay: boolean, opts: { linked?: boolean } = {}): Promise<FileResult> {
  const { useNodeGraphStore } = await import('../store/useNodeGraphStore');
  const st = useNodeGraphStore.getState();
  let name = st.currentGraph?.name ?? '';
  if (!name) {
    const typed = await askText(asPlay ? 'Export the Play setup' : 'Export the graph', { label: 'Name', initial: asPlay ? 'My play' : 'Untitled graph', confirmLabel: 'Export' });
    if (typed === null) return { ok: false, error: 'Cancelled', cancelled: true };
    name = typed.trim() || 'Untitled graph';
  }
  const key = GRAPH_PREFIX + name;
  // The open graph as it is now; its saved record's links travel with it.
  const links = st.currentGraph ? currentGraphLinks(name) : [];
  const json = links.length ? JSON.stringify({ ...JSON.parse(st.graphFileJson(asPlay)), linkedPresentations: links }) : st.graphFileJson(asPlay);
  return exportPlayfile([`graph:${name}`], {
    fileName: name, overlay: { [key]: json }, asPlay: asPlay ? new Set([`graph:${name}`]) : undefined, linked: opts.linked ?? true,
    success: asPlay ? `Exported “${name}” as a Play file` : `Exported “${name}”`,
  });
}

/** The presentations the open graph's saved record is linked to (`linkedPresentations`, when the app has links). */
export function currentGraphLinks(name: string | null | undefined): string[] {
  if (!name) return [];
  try {
    const rec = JSON.parse(localStorage.getItem(GRAPH_PREFIX + name) ?? 'null') as { linkedPresentations?: unknown } | null;
    return Array.isArray(rec?.linkedPresentations) ? rec.linkedPresentations.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** A saved presentation as a .playfile: its Plays, pictures and fonts inside, and the graphs it was made from. */
export function exportPresentationPlayfile(name: string, doc?: unknown): Promise<FileResult> {
  return exportPlayfile([`pres:${name}`], { fileName: name, overlay: doc ? { [PRESENTATION_KEY_PREFIX + name]: JSON.stringify(doc) } : undefined, success: `Exported “${name}”` });
}

/** Node types as a signed node pack (Pro), optionally sealed. */
export async function exportNodePack(ids: string[], opts: { sealed: boolean; author: string; name?: string }): Promise<FileResult> {
  if (!requireFeature('nodes.pack')) return { ok: false, error: 'Making node packs is part of Pro', cancelled: true };
  const defs = ids.map(id => getUserNode(id)).filter(Boolean);
  if (!defs.length) return { ok: false, error: 'No node types to export yet.' };
  const name = opts.name?.trim() || (defs.length === 1 ? defs[0]!.label : 'My nodes');
  return exportPlayfile(ids.map(id => `node:${id}`), {
    fileName: name, packName: name, seal: opts.sealed, pack: true, author: opts.author, dependencies: false, canPack: true,
    success: `Exported the node pack “${name}”${opts.sealed ? ' (sealed)' : ''}`,
  });
}

/** Open the node pack dialog (Pro). */
export function openNodePackDialog(ids?: string[]): void {
  if (!requireFeature('nodes.pack')) return;
  const all = ids ?? getAllUserNodes().map(d => d.id);
  if (!all.length) { toast.info('No node types to export yet'); return; }
  usePlayfileUi.setState({ pack: { ids: all } });
}
