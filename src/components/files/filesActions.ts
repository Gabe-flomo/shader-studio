/**
 * filesActions.ts — the Files page's side effects: removing with Undo (and
 * telling the rest of the app), downloading a profile or a selection (a
 * download in the browser, a save dialog or a folder in the desktop app),
 * and installing a profile.
 */
import { internStoredPresentations } from '../../present/presentAssets';
import { recordActivity } from '../../files/activity';
import { savePresentation } from '../../present/storage';
import { toast } from '../ui/toastStore';
import { LIBRARY_REFRESH_EVENTS, formatSize, libraryZipName } from '../../utils/library';
import { errorMessage, saveBinaryFile } from '../../utils/fileIO';
import { ensureRoom, isStorageLimitError, usageNow } from '../../files/storageLimit';
import { expandRemoval, localMutableKV, removalWarnings, removeFolderKeepItems, removeNodes } from '../../files/mutate';
import { buildProfileZip, everythingSnapshot, externalPart, installMerge, installReplace, installSources, selectionSnapshot, type InstallSummary, type Profile } from '../../files/profileZip';
import { removeExternal } from '../../files/sources';
import '../../files/backgroundsSource';
import '../../files/videosSource';
import type { FileNode, Inventory } from '../../files/inventory';
import { GRAPH_PREFIX, LAYER_KINDS_KEY, NODE_PREFIX, SCRIPTS_KEY } from '../../files/inventory';
import { reloadUserNodesFromStorage } from '../../nodes/userNodes/userNodeRegistry';
import { reloadSavedScripts } from '../../play/savedScripts';
import { reloadInstalledKinds } from '../../play/layerKinds';
import { loadGroupPresets, SAVED_GRAPHS_CHANGED, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { PALETTE_PRESETS_CHANGED } from '../../lib/palette';
import { BACKGROUNDS_CHANGED, resetBackgroundCache } from '../../lib/backgroundLibrary';
import { unzipSync } from 'fflate';
import { useThemeStore } from '../../theme/themeStore';
import { removeNote, type NoteEntry } from '../../files/notes';

/** Fired after the Files page changed storage, so the page itself rebuilds. */
export const FILES_CHANGED = 'files-changed';
/** Ask the app to show the Files page (the Library's “Manage in Files” button). */
export const OPEN_FILES_PAGE = 'open-files-page';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Tell every list and cache in the app that storage changed under it. */
export function syncApp(keys: string[]): void {
  const any = (p: (k: string) => boolean) => keys.some(p);
  try {
    if (any(k => k.startsWith(NODE_PREFIX))) reloadUserNodesFromStorage();
    if (any(k => k === SCRIPTS_KEY)) reloadSavedScripts();
    if (any(k => k === LAYER_KINDS_KEY)) reloadInstalledKinds();
    if (any(k => k.startsWith('shader-studio:gp:'))) useNodeGraphStore.setState({ groupPresets: loadGroupPresets() });
    // The backgrounds library caches its image list; its palettes and folders are read fresh.
    if (any(k => k.startsWith('shader-studio-backgrounds:') || k === 'assetbrowser_folders')) resetBackgroundCache();
    // The theme is read once at start: follow a reset (or its undo) now.
    if (any(k => k === 'shader-studio:theme')) useThemeStore.setState({ mode: localStorage.getItem('shader-studio:theme') === 'dark' ? 'dark' : 'light' });
    // Tracking models (docs/tracking.md): the keep/warm-up settings are read once into their own store.
    if (any(k => k.startsWith('shader-studio:settings:keepTrackerModels') || k.startsWith('shader-studio:settings:warmupTracker:'))) {
      void import('../../lib/trackerCache').then(({ useTrackerCacheSettings }) => useTrackerCacheSettings.setState({
        keepModels: localStorage.getItem('shader-studio:settings:keepTrackerModels') !== '0',
        warmup: {
          hands: localStorage.getItem('shader-studio:settings:warmupTracker:hands') === '1',
          face: localStorage.getItem('shader-studio:settings:warmupTracker:face') === '1',
          pose: localStorage.getItem('shader-studio:settings:warmupTracker:pose') === '1',
        },
      }));
    }
    // The image model's setting (docs/taste.md "How things look") is read once into its store.
    if (any(k => k === 'shader-studio:settings:useImageModel' || k === 'shader-studio:settings:imageModelDownloaded')) {
      void import('../../imageModel/client').then(({ refreshImageModelSettings }) => refreshImageModelSettings());
    }
    const open = useNodeGraphStore.getState().currentGraph;
    if (open && localStorage.getItem(GRAPH_PREFIX + open.name) == null) useNodeGraphStore.setState({ currentGraph: null });
  } catch (e) { console.error('[files] refreshing the app after a change', e); }
  for (const ev of new Set([...LIBRARY_REFRESH_EVENTS, SAVED_GRAPHS_CHANGED, PALETTE_PRESETS_CHANGED, BACKGROUNDS_CHANGED, 'usernode-changed', FILES_CHANGED])) window.dispatchEvent(new Event(ev));
}

export interface RemoveConfirm { title: string; size: number; breaks: string[]; copies: string[]; folders: number }

/**
 * Remove nodes (and everything in the containers among them). Asks first when
 * something else uses them, saying what breaks; offers Undo after.
 */
export async function removeWithUndo(inv: Inventory, ids: string[], confirm: (c: RemoveConfirm) => Promise<boolean>, opts: { confirmAlways?: boolean } = {}): Promise<boolean> {
  const nodes = expandRemoval(inv, ids);
  if (!nodes.length) return false;
  const items = nodes.filter(n => n.kind !== 'folder');
  const folders = nodes.filter(n => n.kind === 'folder');
  const size = nodes.reduce((n, x) => n + (x.kind === 'folder' ? 0 : x.size), 0);
  const what = items.length === 1 && !folders.length ? `“${items[0].label}”`
    : [items.length ? plural(items.length, 'item') : '', folders.length ? plural(folders.length, 'folder') : ''].filter(Boolean).join(' and ');
  const w = removalWarnings(nodes);
  if (w.breaks.length || w.copies.length || opts.confirmAlways || folders.some(f => f.children?.length)) {
    if (!(await confirm({ title: `Remove ${what}?`, size, breaks: w.breaks, copies: w.copies, folders: folders.length }))) return false;
  }
  let res: ReturnType<typeof removeNodes>;
  try { res = removeNodes(localMutableKV, nodes); } catch (e) { toast.error('Couldn’t remove that', { message: errorMessage(e) }); return false; }
  let undoExternal: (() => Promise<void>) | null = null;
  if (res.external.length) {
    try { undoExternal = await removeExternal(res.external); } catch (e) { toast.error('Some files couldn’t be removed', { message: errorMessage(e) }); }
  }
  syncApp(res.changedKeys);
  let undone = false;
  toast.success(`Removed ${what}`, {
    message: size ? `Freed ${formatSize(size)}.` : undefined,
    action: {
      label: 'Undo',
      stillValid: () => !undone,
      onClick: () => {
        if (undone) return;
        undone = true;
        res.undo();
        void undoExternal?.();
        syncApp(res.changedKeys);
        toast.info(`Put back ${what}`);
      },
    },
  });
  return true;
}

/**
 * Reset app settings to their defaults: their keys go (the app falls back to
 * its default), with Undo. `what` names them in the toast.
 */
export function resetSettings(inv: Inventory, ids: string[], what: string): boolean {
  const nodes = expandRemoval(inv, ids).filter(n => n.kind === 'setting');
  if (!nodes.length) return false;
  let res: ReturnType<typeof removeNodes>;
  try { res = removeNodes(localMutableKV, nodes); } catch (e) { toast.error('Couldn’t reset that', { message: errorMessage(e) }); return false; }
  syncApp(res.changedKeys);
  let undone = false;
  toast.success(`Reset ${what} to default`, {
    message: 'Some settings take effect the next time the app opens.',
    action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; res.undo(); syncApp(res.changedKeys); toast.info(`Put back ${what}`); } },
  });
  return true;
}

/** Take one note out of its saved graph, with Undo. */
export function deleteNoteWithUndo(note: NoteEntry): boolean {
  let undo: (() => void) | null;
  try { undo = removeNote(localMutableKV, note); } catch (e) { toast.error('Couldn’t delete that note', { message: errorMessage(e) }); return false; }
  if (!undo) { toast.warning('That note isn’t there any more'); return false; }
  const key = GRAPH_PREFIX + note.graph;
  syncApp([key]);
  let undone = false;
  const what = note.kind === 'play' ? `the Play notes of “${note.graphLabel}”` : `the comment on “${note.nodeLabel ?? 'a node'}”`;
  toast.success(`Deleted ${what}`, {
    action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; undo!(); syncApp([key]); toast.info('Put the note back'); } },
  });
  return true;
}

export function deleteFolderKeepItems(scope: string, folderId: string, label: string): void {
  const undo = removeFolderKeepItems(localMutableKV, scope, folderId);
  syncApp(['assetbrowser_folders']);
  let undone = false;
  toast.success(`Removed the folder “${label}”`, { message: 'What was in it stays, outside any folder.', action: { label: 'Undo', stillValid: () => !undone, onClick: () => { undone = true; undo(); syncApp(['assetbrowser_folders']); } } });
}

// ── Download ────────────────────────────────────────────────────────────────

export type SaveTarget = 'download' | 'folder';

/** Write a ZIP where the person chose: a download (a save dialog in the desktop app), or unpacked into a folder (desktop). */
async function saveZip(bytes: Uint8Array, name: string, target: SaveTarget): Promise<{ ok: boolean; where?: string }> {
  if (target === 'folder' && isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false, title: 'Save into a folder' });
    if (typeof dir !== 'string') return { ok: false };
    const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
    const files = unzipSync(bytes);
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith('/')) continue;
      const full = `${dir}/${path}`;
      await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, data);
    }
    return { ok: true, where: `${dir}/${name.replace(/\.zip$/, '')}` };
  }
  const r = await saveBinaryFile(bytes, name, 'application/zip');
  if (!r.ok && !r.cancelled) throw new Error(r.error);
  return { ok: r.ok };
}

export async function downloadEverything(target: SaveTarget = 'download'): Promise<void> {
  try {
    const snap = everythingSnapshot(localMutableKV);
    const zip = await buildProfileZip(snap, { scope: 'everything', external: await externalPart(null) });
    const saved = await saveZip(zip.bytes, zip.name, target);
    if (saved.ok) toast.success('Downloaded everything', { message: `${saved.where ? `${saved.where}: ` : `${zip.name}: `}${plural(zip.manifest.total.count, 'item')}, ${formatSize(zip.manifest.total.size)}. Install reads it back.` });
  } catch (e) { toast.error('Couldn’t download everything', { message: errorMessage(e) }); }
}

export async function downloadSelection(inv: Inventory, ids: string[], opts: { versions: boolean; dependencies: boolean }, target: SaveTarget = 'download'): Promise<void> {
  try {
    const sel = selectionSnapshot(localMutableKV, inv, ids, opts);
    const single = sel.items.length === 1 && !sel.dependencies.length ? sel.items[0].label : null;
    const name = libraryZipName(new Date(), single ? single.replace(/[/\\:*?"<>|]/g, '-').slice(0, 60) : 'selection');
    const zip = await buildProfileZip(sel.snapshot, { scope: 'selection', name, versions: opts.versions, dependencies: opts.dependencies, external: await externalPart(sel.external) });
    const saved = await saveZip(zip.bytes, zip.name, target);
    if (saved.ok) toast.success(`Downloaded ${plural(sel.items.length, 'item')}`, { message: `${saved.where ?? zip.name}${sel.dependencies.length ? `, with ${plural(sel.dependencies.length, 'thing')} they use` : ''}. Install or the Library’s Import reads it.` });
  } catch (e) { toast.error('Couldn’t download that', { message: errorMessage(e) }); }
}

/** What a selection's download holds (for the dialog): the items, what they use, and the size. */
export function selectionSummary(inv: Inventory, ids: string[], opts: { versions: boolean; dependencies: boolean }): { items: FileNode[]; dependencies: FileNode[]; size: number } {
  const sel = selectionSnapshot(localMutableKV, inv, ids, opts);
  const size = Object.entries(sel.snapshot.items).reduce((n, [k, v]) => n + k.length + v.length, 0)
    + sel.items.filter(n => n.ref?.t === 'external').reduce((n, x) => n + x.size, 0);
  return { items: sel.items, dependencies: sel.dependencies, size };
}

// ── Install ─────────────────────────────────────────────────────────────────

export async function runInstall(profile: Profile, mode: 'merge' | 'replace'): Promise<InstallSummary | null> {
  try {
    // The device's storage limit: the profile has to fit (a replace frees what is here first, so it is not counted then).
    const bytes = Object.entries(profile.snapshot.items).reduce((n, [k, v]) => n + k.length + v.length, 0) + Object.values(profile.files).reduce((n, f) => n + f.length, 0);
    if (mode === 'merge') await ensureRoom(bytes); else await ensureRoom(Math.max(0, bytes - (usageNow()?.total ?? 0)));
    let summary: InstallSummary;
    // Images and other IndexedDB stores' files go through their store.
    if (mode === 'merge') summary = await installSources(profile, 'merge', installMerge(profile, localMutableKV));
    else summary = await installReplace(profile, localMutableKV, async zip => (await saveBinaryFile(zip.bytes, zip.name, 'application/zip')).ok);
    // Presentations that came in with their pictures and fonts embedded keep references to the library instead.
    await internStoredPresentations(savePresentation).catch(() => []);
    syncApp(summary.changedKeys);
    recordActivity('import', mode === 'replace' ? 'Replaced everything' : 'Installed a profile');
    return summary;
  } catch (e) {
    if (!isStorageLimitError(e)) toast.error(mode === 'replace' ? 'Nothing was replaced' : 'Couldn’t install that', { message: errorMessage(e) });
    return null;
  }
}
