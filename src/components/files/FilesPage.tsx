/**
 * FilesPage — one place to see, manage, clean up, download and install
 * everything Shader Studio keeps in this browser (src/files/ is the model).
 *
 * Desktop: a sidebar with the space meter, Clean up, and the tree; on the
 * right the selected thing (breadcrumbs, what it is, what uses it, what is
 * inside). Phone: the same as pages you drill into, the meter on the first.
 * Tick things anywhere (a whole section or folder too) to download or remove
 * them together.
 */
import { exportEverythingPlayfile } from '../playfile/exportMenus';
import { openPlayfileBytes } from '../../playfile/app';
import { CONTAINER_ACCEPT } from '../../playfile/format';
import { isPlayfile } from '../../playfile/reader';
import { ProBadgeFor } from '../account/ProSheet';
import { requireFeature } from '../../lib/plan';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Menu, type MenuItem } from '../ui/Menu';
import { askConfirm, askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import type { Page } from '../page';
import { formatSize } from '../../utils/library';
import { errorMessage, openBinaryFile } from '../../utils/fileIO';
import { createFolder, loadFolders, moveItemsToFolder, removeItemsFromFolders, renameFolder } from '../../utils/assetFolders';
import { APP_SETTINGS_ID, countLeaves, itemsOf, pathTo, walk, type FileNode } from '../../files/inventory';
import { collectNotes, type NoteEntry } from '../../files/notes';
import { getNodeDefinition } from '../../nodes/definitions';
import { NotesView } from './NotesView';
import { AppSettingsView } from './AppSettingsView';
import { cleanupSuggestions } from '../../files/cleanup';
import { localMutableKV } from '../../files/mutate';
import { previewInstall, readProfile, type InstallPreview, type Profile } from '../../files/profileZip';
import { rememberLast } from '../../present/storage';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useFilesInventory } from './useFilesInventory';
import { FilesTree } from './FilesTree';
import { SpaceMeter } from './SpaceMeter';
import { Breadcrumbs, NodeView, type CheckState } from './NodeView';
import { CleanUpView } from './CleanUpView';
import { DownloadDialog, InstallDialog, RemoveDialog } from './FilesDialogs';
import { deleteFolderKeepItems, deleteNoteWithUndo, downloadEverything, removeWithUndo, syncApp, type RemoveConfirm, type SaveTarget } from './filesActions';
import { Check, IconTile } from './fileUi';
import { capsLabel } from './fileUiShared';
import { HomeView, type HomeEntry } from './HomeView';
import { ItemPage } from './ItemPage';
import { isPlayGraph, ITEM_KINDS, itemCode, itemRecord } from '../../files/itemCode';
import { NodePage } from './NodePage';
import { NodesListView } from './NodesListView';
import { Sheet } from '../ui/Sheet';
import { duplicateNode } from '../../files/duplicate';
import { graphFileText } from '../../playfile/bundle';
import { saveTextFile } from '../../utils/fileIO';
import { WorkspaceBanner, WorkspaceEntry, WorkspaceView } from '../workspace/WorkspacePanel';
import { LinkedFoldersEntry, LinkedFoldersGroup, LinkedFoldersView } from '../linked/LinkedFoldersView';
import { useLinkedFolders } from '../../files/linkedFolders';
import { OPEN_WORKSPACE_VIEW, takeWorkspaceViewRequest } from '../workspace/workspaceUi';
import { OPEN_CLEANUP_VIEW } from '../../files/storageLimit';
import { takeCleanupRequest } from '../../files/storageLimitApp';
import { exportPlayfile } from '../../playfile/app';
import { reportFileResult } from '../shell/reportFileResult';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** A saved drum kit (Presets → Drum kits): it can leave as a .playfile with its samples. */
const isDrumKit = (n: FileNode) => n.kind === 'preset' && n.id.startsWith('dkit:');
const exportKit = async (n: FileNode) => reportFileResult(await exportPlayfile([n.id], { fileName: n.label, dependencies: false, success: `Exported the kit “${n.label}”` }), { failTitle: 'Couldn’t export the kit' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type View = 'home' | 'browse' | 'cleanup' | 'workspace' | 'linked' | 'notes' | 'nodes';
/** The GLSL page reads these when it mounts: the editor's text and which saved shader it is. */
const GLSL_EDITOR_KEY = 'shader-studio:glsl-editor';
const GLSL_OPEN_KEY = 'glsl-editor:open-shader';

export function FilesPage({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: (p: Page) => void }) {
  const tk = useTokens();
  const { inv, building, estimate, usage } = useFilesInventory();
  const [view, setView] = useState<View>(() => (takeWorkspaceViewRequest() ? 'workspace' : takeCleanupRequest() ? 'cleanup' : 'home'));
  /** The linked folder the Linked folders view shows. */
  const [linkedId, setLinkedId] = useState<string | undefined>(undefined);
  /** The node type whose page is shown (the Nodes view). */
  const [nodeType, setNodeType] = useState<string | null>(null);
  /** On a phone, an item's page opens in a sheet over where you are. */
  const [sheetId, setSheetId] = useState<string | null>(null);
  // A storage-limit refusal's "Open Files → Clean up" asks for the Clean up view.
  useEffect(() => {
    const go = () => { takeCleanupRequest(); setView('cleanup'); };
    window.addEventListener(OPEN_CLEANUP_VIEW, go);
    return () => window.removeEventListener(OPEN_CLEANUP_VIEW, go);
  }, []);
  // The top bar's workspace indicator asks for the Workspace view.
  useEffect(() => {
    const go = () => { takeWorkspaceViewRequest(); setView('workspace'); };
    window.addEventListener(OPEN_WORKSPACE_VIEW, go);
    return () => window.removeEventListener(OPEN_WORKSPACE_VIEW, go);
  }, []);
  // Where you are, as the path down to it: when the thing itself goes (removed, renamed), you land on its nearest surviving parent.
  const [trail, setTrail] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['section:graphs']));
  const [menu, setMenu] = useState<{ node: FileNode | null; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ c: RemoveConfirm; resolve: (ok: boolean) => void } | null>(null);
  const [download, setDownload] = useState<string[] | null>(null);
  const [install, setInstall] = useState<{ name: string; profile: Profile; preview: InstallPreview } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const current = inv ? [...trail].reverse().find(id => inv.byId.has(id)) ?? null : null;
  const node = inv && current ? inv.byId.get(current) ?? null : null;
  const [rawChecked, setChecked] = useState<Set<string>>(() => new Set());
  // Ticks on things that are gone don't count.
  const checked = useMemo(() => (inv ? new Set([...rawChecked].filter(id => inv.byId.has(id))) : rawChecked), [inv, rawChecked]);

  const open = useCallback((id: string | null) => {
    const n = id && inv ? inv.byId.get(id) : null;
    if (compact && n && ITEM_KINDS.has(n.kind)) { setSheetId(id); return; }
    setSheetId(null);
    setView(id ? 'browse' : 'home');
    setTrail(id && inv ? pathTo(inv, id).map(n => n.id) : []);
    if (id && inv) setExpanded(s => { const n = new Set(s); for (const p of pathTo(inv, id).slice(0, -1)) n.add(p.id); return n; });
    scroller.current?.scrollTo({ top: 0 });
  }, [inv, compact]);
  const openNodePage = useCallback((type: string) => { setSheetId(null); setNodeType(type); setView('nodes'); scroller.current?.scrollTo({ top: 0 }); }, []);
  const show = useCallback((v: View) => { setSheetId(null); setView(v); scroller.current?.scrollTo({ top: 0 }); }, []);

  // ── Ticks ──
  const ancestorsOfChecked = useMemo(() => {
    const out = new Set<string>();
    if (!inv) return out;
    for (const id of checked) { let p = inv.parentOf.get(id); while (p) { out.add(p); p = inv.parentOf.get(p); } }
    return out;
  }, [checked, inv]);
  const checkState = useCallback((id: string): CheckState => {
    if (checked.has(id)) return 'on';
    if (inv) { let p = inv.parentOf.get(id); while (p) { if (checked.has(p)) return 'inherited'; p = inv.parentOf.get(p); } }
    return ancestorsOfChecked.has(id) ? 'mixed' : 'off';
  }, [checked, inv, ancestorsOfChecked]);
  const onCheck = (id: string, on: boolean) => {
    setChecked(s => {
      const n = new Set(s);
      if (on) {
        n.add(id);
        const sub = inv?.byId.get(id);
        if (sub) for (const d of walk(sub.children ?? [])) n.delete(d.id); // implied by the tick above them
      } else n.delete(id);
      return n;
    });
  };
  const selection = useMemo(() => {
    if (!inv || !checked.size) return null;
    const nodes = [...checked].map(id => inv.byId.get(id)).filter((n): n is FileNode => !!n);
    const items = itemsOf(inv, checked);
    return { ids: [...checked], count: nodes.reduce((n, x) => n + (x.kind === 'section' || x.kind === 'group' || x.kind === 'folder' ? countLeaves(x.children) : 1), 0), size: nodes.reduce((n, x) => n + x.size, 0), items };
  }, [inv, checked]);

  // ── Actions ──
  const askRemove = useCallback((c: RemoveConfirm) => new Promise<boolean>(resolve => setConfirm({ c, resolve })), []);
  const remove = async (ids: string[], confirmAlways = false) => {
    if (!inv) return false;
    const ok = await removeWithUndo(inv, ids, askRemove, { confirmAlways });
    if (ok) setChecked(s => { const n = new Set(s); for (const id of ids) n.delete(id); return n; });
    return ok;
  };

  const preview = async (picked: { name: string; bytes: Uint8Array }) => {
    // A .playfile opens its own preview (importing one is Free; a profile inside it needs Pro there).
    if (isPlayfile(picked.bytes)) { await openPlayfileBytes(picked.name, picked.bytes); return; }
    if (!requireFeature('files.install')) return;
    try {
      const profile = readProfile(picked.bytes);
      setInstall({ name: picked.name, profile, preview: await previewInstall(profile, localMutableKV) });
    } catch (e) { toast.error(`Couldn’t read “${picked.name}”`, { message: errorMessage(e) }); }
  };
  const startInstall = async () => {
    if (!requireFeature('files.install')) return;
    let picked: Awaited<ReturnType<typeof openBinaryFile>>;
    try { picked = await openBinaryFile(`${CONTAINER_ACCEPT},.zip,.json`); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
    if (picked) await preview(picked);
  };
  // A profile ZIP dropped anywhere on the page opens the same preview.
  const drop = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); },
    onDrop: (e: DragEvent) => {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      void f.arrayBuffer().then(b => preview({ name: f.name, bytes: new Uint8Array(b) }));
    },
  };

  const openGraph = async (name: string, page: Page | null = 'studio') => {
    const st = useNodeGraphStore.getState();
    if (st.graphDirty && !(await askConfirm(`Open “${name}”?`, { message: 'The graph open now has changes that aren’t saved; opening another one drops them.', confirmLabel: 'Open', danger: true }))) return false;
    const r = st.loadSavedGraph(name);
    if (!r.ok) { toast.error('Couldn’t open it', { message: r.error }); return false; }
    if (page) onNavigate?.(page);
    return true;
  };
  // Go to a note: its graph open (loaded when it isn't the open one), then its node shown in the Studio, or the Play page for Play notes.
  const goToNote = async (n: NoteEntry) => {
    const st = useNodeGraphStore.getState();
    const isOpen = n.live || (n.graph != null && st.currentGraph?.name === n.graph);
    if (!isOpen && (n.graph == null || !(await openGraph(n.graph, null)))) return;
    if (n.kind === 'play') { onNavigate?.('play'); return; }
    const s2 = useNodeGraphStore.getState();
    if (s2.activeGroupPath.length) s2.exitToDepth(0);
    // Enter the groups it sits in, as far as the Studio goes (two deep, not into sealed groups); past that, show the group.
    let scope = s2.nodes, target = n.nodeId!;
    const path: string[] = [];
    for (const gid of n.groupPath ?? []) {
      const g = scope.find(x => x.id === gid);
      if (!g) break;
      if (g.sealed || path.length >= 2) { target = gid; break; }
      path.push(gid);
      scope = (g.params.subgraph as { nodes?: typeof scope } | undefined)?.nodes ?? [];
    }
    if (!path.length) s2.focusNode(target);
    else s2.revealNode(path, target);
    onNavigate?.('studio');
  };
  /** A saved GLSL shader on the GLSL page: the page reads the editor's text and the open shader's id when it mounts. */
  const openShader = (n: FileNode) => {
    const rec = itemRecord(n);
    const code = itemCode(n, rec)?.text;
    const id = n.ref?.t === 'part' && n.ref.match?.field === 'id' ? String(n.ref.match.value) : null;
    if (code == null) { toast.error('Couldn’t open that shader'); return; }
    try { localStorage.setItem(GLSL_EDITOR_KEY, code); if (id) localStorage.setItem(GLSL_OPEN_KEY, id); } catch { /* the page falls back to its own text */ }
    onNavigate?.('glsl');
  };
  /** Open a thing where it lives: a graph in the Studio (or Play when it has a setup), a presentation on Present, a shader on the GLSL page. */
  const openWhereItBelongs = (n: FileNode) => {
    if (n.kind === 'graph') void openGraph(n.label, isPlayGraph(n) ? 'play' : 'studio');
    else if (n.kind === 'presentation') { rememberLast(n.label); onNavigate?.('present'); }
    else if (n.kind === 'shader') openShader(n);
    else if (n.kind === 'function' || n.kind === 'builderFn') onNavigate?.('fn');
    else open(n.id);
  };
  const exportItemPlayfile = async (n: FileNode) => reportFileResult(await exportPlayfile([n.id], { fileName: n.label, success: `Exported “${n.label}”` }), { failTitle: 'Couldn’t export it' });
  const exportReadable = async (n: FileNode) => {
    const rec = itemRecord(n);
    const text = n.kind === 'graph' && rec.raw ? graphFileText(rec.raw, isPlayGraph(n)) : itemCode(n, rec)?.text ?? rec.raw;
    if (text == null) { toast.error('Nothing to export'); return; }
    const ext = n.kind === 'shader' || n.kind === 'function' || n.kind === 'builderFn' ? 'glsl' : n.kind === 'script' ? 'js' : 'json';
    const safe = n.label.replace(/[/\\:*?"<>|]/g, '-').slice(0, 60) || 'item';
    reportFileResult(await saveTextFile(text, `${safe}.${ext}`, ext === 'json' ? 'application/json' : 'text/plain'), { failTitle: 'Couldn’t export it', success: `Exported “${n.label}”` });
  };
  const duplicate = (n: FileNode) => {
    let r: ReturnType<typeof duplicateNode>;
    try { r = duplicateNode(localMutableKV, n); } catch (e) { toast.error('Couldn’t duplicate it', { message: errorMessage(e) }); return; }
    if (!r) { toast.warning('That can’t be duplicated here'); return; }
    const key = n.ref?.t === 'key' || n.ref?.t === 'part' ? n.ref.key : '';
    syncApp([key]);
    let undone = false;
    const made = r;
    toast.success(`Made “${made.label}”`, { action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; made.undo(); syncApp([key]); } } });
  };
  const notesCount = useMemo(() => {
    if (!inv) return 0;
    try { return collectNotes(localMutableKV, { labelOf: t => getNodeDefinition(t)?.label }).notes.length; } catch { return 0; }
  }, [inv]);
  // Download everything, and ZIPs of chosen items, are Pro; so is installing (docs/accounts-and-plans.md §4).
  const openDownload = (ids: string[]) => { if (requireFeature('files.everything')) setDownload(ids); };
  const everything = (target: SaveTarget) => { if (requireFeature('files.everything')) void downloadEverything(target); };
  const downloadMenu = (x: number, y: number) => {
    if (!requireFeature('files.everything')) return;
    setMenu({ node: null, x, y });
  };

  const menuItems = (n: FileNode | null): MenuItem[] => {
    if (!n) return [
      { label: 'Save as a .playfile…', icon: 'export', hint: 'One file: open it here or on another computer, see what’s inside, pick what comes in', onSelect: () => { void exportEverythingPlayfile(); } },
      { label: 'Save as a ZIP…', icon: 'export', hint: 'One file: install it here or on another computer', onSelect: () => everything('download') },
      ...(isTauri() ? [{ label: 'Save to a folder…', icon: 'folder' as const, hint: 'The same files, unpacked into a folder you choose', onSelect: () => everything('folder') }] : []),
    ];
    const items: MenuItem[] = [];
    const scopeOf = n.membership?.scope;
    if (n.kind === 'graph') items.push({ label: 'Open in the Studio', icon: 'nodes', onSelect: () => { void openGraph(n.label); } });
    if (n.kind === 'presentation') items.push({ label: 'Open on Present', icon: 'slides', onSelect: () => { rememberLast(n.label); onNavigate?.('present'); } });
    if (isDrumKit(n)) items.push({ label: 'Save as a .playfile…', icon: 'export', hint: 'The kit with the samples it uses, in one file that opens anywhere', onSelect: () => { void exportKit(n); } });
    if (n.scope && n.kind !== 'folder') items.push({ label: 'New folder…', icon: 'folder', onSelect: async () => { const l = await askText('New folder', { label: 'Name', confirmLabel: 'Create' }); if (l?.trim()) { createFolder(n.scope!, l.trim()); syncApp(['assetbrowser_folders']); } } });
    if (n.kind === 'folder' && n.ref?.t === 'folder') {
      const { scope, folderId } = n.ref;
      items.push({ label: 'Rename folder…', icon: 'edit', onSelect: async () => { const l = await askText('Rename folder', { label: 'Name', initial: n.label, confirmLabel: 'Rename' }); if (l?.trim()) { renameFolder(scope, folderId, l.trim()); syncApp(['assetbrowser_folders']); } } });
    }
    if (items.length) items.push('separator');
    const downloadable = !n.private && (n.kind === 'section' || n.kind === 'group' || n.kind === 'folder' ? countLeaves(n.children) > 0 : true);
    if (downloadable) items.push({ label: n.part ? 'Download its item…' : n.kind === 'section' || n.kind === 'group' || n.kind === 'folder' ? `Download all ${countLeaves(n.children)}…` : 'Download…', icon: 'export', onSelect: () => openDownload([n.id]) });
    // Move between the list's folders.
    if (scopeOf && inv) {
      const folders = loadFolders(scopeOf);
      const inFolder = inv.byId.get(inv.parentOf.get(n.id) ?? '')?.kind === 'folder';
      if (folders.length || inFolder) {
        items.push('separator', { heading: 'Move to' });
        for (const f of folders.slice(0, 8)) items.push({ label: f.label, icon: 'folder', disabled: inv.parentOf.get(n.id)?.endsWith(`folder:${f.id}`), onSelect: () => { moveItemsToFolder(scopeOf, [n.membership!.id], f.id); syncApp(['assetbrowser_folders']); } });
        if (inFolder) items.push({ label: 'Out of its folder', icon: 'unlink', onSelect: () => { removeItemsFromFolders(scopeOf, [n.membership!.id]); syncApp(['assetbrowser_folders']); } });
      }
    }
    const removable = n.ref || n.kind === 'section' || n.kind === 'group' || n.kind === 'folder';
    if (removable && (n.kind !== 'section' && n.kind !== 'group' ? true : countLeaves(n.children) > 0)) {
      items.push('separator');
      if (n.kind === 'folder' && n.ref?.t === 'folder') {
        const { scope, folderId } = n.ref;
        items.push({ label: 'Remove folder, keep items', icon: 'folder', onSelect: () => deleteFolderKeepItems(scope, folderId, n.label) });
        items.push({ label: n.children?.length ? `Remove folder and ${plural(countLeaves(n.children), 'item')}…` : 'Remove folder', icon: 'trash', danger: true, onSelect: () => { void remove([n.id], !!n.children?.length); } });
      } else if (n.kind === 'section' || n.kind === 'group' || n.kind === 'folder') {
        items.push({ label: `Remove all ${countLeaves(n.children)}…`, icon: 'trash', danger: true, onSelect: () => { void remove([n.id], true); } });
      } else {
        items.push({ label: n.kind === 'setting' ? 'Remove (back to default)' : 'Remove…', icon: 'trash', danger: true, onSelect: () => { void remove([n.id], n.size > 40_000); } });
      }
    }
    return items;
  };

  const cleanupCount = useMemo(() => (inv ? cleanupSuggestions(inv).filter(g => g.kind !== 'big').reduce((n, g) => n + g.items.length, 0) : 0), [inv]);

  if (!inv) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, font: `12.5px ${fontFamily.ui}`, background: tk.bg.app }}>{building ? 'Reading what’s saved…' : 'Couldn’t read this browser’s storage.'}</div>;
  }

  const path = node ? pathTo(inv, node.id) : [];
  const itemPage = (n: FileNode) => (
    <ItemPage inv={inv} node={n} compact={compact} onOpen={open} onMenu={(x, at) => setMenu({ node: x, ...at })}
      primary={n.kind === 'graph' ? { label: isPlayGraph(n) ? 'Open in Play' : 'Open in the Studio', icon: isPlayGraph(n) ? 'play' : 'nodes', onClick: () => { void openGraph(n.label, isPlayGraph(n) ? 'play' : 'studio'); } }
        : n.kind === 'presentation' ? { label: 'Open on Present', icon: 'slides', onClick: () => { rememberLast(n.label); onNavigate?.('present'); } }
        : n.kind === 'shader' ? { label: 'Open on the GLSL page', icon: 'code', onClick: () => openShader(n) }
        : n.kind === 'builderFn' ? { label: 'Open the Function Builder', icon: 'fn', onClick: () => onNavigate?.('fn') }
        : null}
      onExportPlayfile={!n.private && n.kind !== 'palette' ? () => { void exportItemPlayfile(n); } : undefined}
      onExportReadable={() => { void exportReadable(n); }}
      onDuplicate={n.ref ? () => duplicate(n) : undefined}
      onRemove={n.ref ? () => { void remove([n.id], n.size > 40_000); } : undefined} />
  );
  const sheetNode = sheetId ? inv.byId.get(sheetId) ?? null : null;
  const nodeView = node?.id === APP_SETTINGS_ID ? <AppSettingsView inv={inv} node={node} compact={compact} /> : node && ITEM_KINDS.has(node.kind) ? itemPage(node) : node ? (
    <NodeView inv={inv} node={node} compact={compact} checkState={checkState} onCheck={onCheck} onOpen={open} onMenu={(n, at) => setMenu({ node: n, ...at })}
      actions={<>
        {node.kind === 'graph' && <Button size="sm" icon="nodes" onClick={() => { void openGraph(node.label); }}>Open in the Studio</Button>}
        {node.kind === 'presentation' && <Button size="sm" icon="slides" onClick={() => { rememberLast(node.label); onNavigate?.('present'); }}>Open on Present</Button>}
        {isDrumKit(node) && <Button size="sm" icon="export" onClick={() => { void exportKit(node); }} title="The kit with the samples it uses, in one file that opens anywhere">Save as a .playfile…</Button>}
        {!node.private && !node.part && <Button size="sm" icon="export" onClick={() => openDownload([node.id])}>Download…</Button>}
        {node.ref && <Button size="sm" variant="ghost" icon="trash" onClick={() => { void remove([node.id], node.size > 40_000); }}>Remove…</Button>}
      </>} />
  ) : null;
  const cleanup = <CleanUpView inv={inv} compact={compact} onShow={open} onRemove={remove} />;
  const workspace = <WorkspaceView compact={compact} />;
  const linked = <LinkedFoldersView compact={compact} folderId={linkedId} />;
  const notes = <NotesView inv={inv} compact={compact} onGoTo={n => { void goToNote(n); }} onDelete={n => { deleteNoteWithUndo(n); }} />;
  const entries: HomeEntry[] = [
    { id: 'browse', icon: 'folder', label: 'Browse', sub: 'Everything saved, as a tree', tint: tk.accent.base, onClick: () => open('section:graphs') },
    { id: 'nodes', icon: 'nodes', label: 'Nodes', sub: 'Every node type: sockets, a live picture, its GLSL', tint: tk.accent.base, onClick: () => { setNodeType(null); show('nodes'); } },
    { id: 'notes', icon: 'comment', label: 'Notes', sub: notesCount ? `${plural(notesCount, 'note')}: Play notes and node comments` : 'No notes yet', count: notesCount, tint: tk.accent.base, onClick: () => show('notes') },
    { id: 'cleanup', icon: 'spark', label: 'Clean up', sub: cleanupCount ? `${plural(cleanupCount, 'suggestion')}: old versions, unused files, duplicates` : 'Nothing to clean up', count: cleanupCount, tint: tk.status.success, onClick: () => show('cleanup') },
    { id: 'workspace', icon: 'folder', label: 'Workspace folder', sub: 'A folder on this computer that mirrors what’s saved', tint: tk.status.warning, onClick: () => show('workspace') },
    { id: 'linked', icon: 'link', label: 'Linked folders', sub: 'Folders of samples, images, videos and fonts, used in place', tint: tk.accent.base, onClick: () => show('linked') },
    { id: 'settings', icon: 'sliders', label: 'App settings', sub: 'Theme, shortcuts, panel sizes: reset to default here', tint: tk.text.muted, onClick: () => open(APP_SETTINGS_ID) },
  ];
  const home = <HomeView inv={inv} compact={compact} estimate={estimate} usage={usage} entries={entries} onOpen={open} onOpenNode={openNodePage} onOpenWhereItBelongs={openWhereItBelongs}
    browse={compact ? <div style={{ borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
      {inv.sections.map((s, i) => <SectionRow key={s.id} node={s} first={i === 0} state={checkState(s.id)} onCheck={on => onCheck(s.id, on)} onOpen={() => open(s.id)} />)}
    </div> : undefined} />;
  const nodesView = nodeType ? <NodePage type={nodeType} compact={compact} inv={inv} onOpen={open} onNavigate={onNavigate} /> : <NodesListView compact={compact} onOpenNode={openNodePage} />;
  const special = (v: View) => (v === 'home' ? home : v === 'nodes' ? nodesView : v === 'cleanup' ? cleanup : v === 'workspace' ? workspace : v === 'linked' ? linked : v === 'notes' ? notes : null);
  const specialCrumb = (v: View) => (v === 'nodes' && nodeType ? [{ id: 'nodes', label: 'Nodes', kind: 'section' as const, section: 'nodes' as const, size: 0 }, { id: `nodetype:${nodeType}`, label: getNodeDefinition(nodeType)?.label ?? nodeType, kind: 'node' as const, section: 'nodes' as const, size: 0 }] : crumb(v === 'cleanup' ? 'Clean up' : v === 'workspace' ? 'Workspace folder' : v === 'linked' ? 'Linked folders' : v === 'notes' ? 'Notes' : v === 'nodes' ? 'Nodes' : 'Home'));
  const banner = view !== 'workspace' && <WorkspaceBanner compact={compact} onOpen={() => setView('workspace')} />;
  const crumb = (label: string) => [{ id: view, label, kind: 'section' as const, section: 'graphs' as const, size: 0 }];

  // With something ticked, the bar at the top becomes the selection's: what's ticked, its size, and what to do with it.
  const selectionBar = selection && (
    <div role="region" aria-label="Selection" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: compact ? 2 : 8 }}>
      <IconButton icon="close" label="Clear the selection" tooltip={false} onClick={() => setChecked(new Set())} />
      <span style={{ font: `600 ${compact ? 12.5 : 13}px ${fontFamily.ui}`, color: tk.accent.text, whiteSpace: 'nowrap' }}>{plural(selection.count, 'item')} selected</span>
      <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatSize(selection.size)}</span>
      <span style={{ flex: 1 }} />
      {compact ? <>
        <IconButton icon="trash" label="Remove" tone="danger" tooltip={false} onClick={() => { void remove(selection.ids, true); }} />
        <IconButton icon="export" label="Download" tooltip={false} disabled={!selection.items.some(n => !n.private)} onClick={() => openDownload(selection.ids)} />
      </> : <>
        <Button size="sm" icon="trash" onClick={() => { void remove(selection.ids, true); }}>Remove…</Button>
        <Button size="sm" variant="primary" icon="export" disabled={!selection.items.some(n => !n.private)} onClick={() => openDownload(selection.ids)}>Download…</Button>
      </>}
    </div>
  );

  const dialogs = <>
    {compact && sheetNode && <Sheet title={sheetNode.label} onClose={() => setSheetId(null)} maxHeight="88dvh">{itemPage(sheetNode)}</Sheet>}
    {menu && <Menu x={menu.x} y={menu.y} minWidth={240} onClose={() => setMenu(null)} items={menuItems(menu.node)} />}
    {confirm && <RemoveDialog c={confirm.c} onDone={ok => { confirm.resolve(ok); setConfirm(null); }} />}
    {download && <DownloadDialog inv={inv} ids={download} onClose={() => setDownload(null)} />}
    {install && <InstallDialog fileName={install.name} profile={install.profile} preview={install.preview} compact={compact} onClose={() => setInstall(null)} />}
  </>;

  // ── Phone: pages you drill into ──
  if (compact) {
    const atRoot = view === 'home';
    return (
      <div {...drop} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: tk.bg.app, position: 'relative' }}>
        {/* The top bar already says Files: this bar appears once you're inside something, or have ticked something. */}
        {(!atRoot || selection) && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, height: 44, padding: '0 6px 0 4px', background: selection ? tk.bg.selected : tk.bg.panel, borderBottom: `1px solid ${tk.border.default}` }}>
          {selectionBar ?? <>
          <IconButton icon="chevL" label="Back" tooltip={false} onClick={() => { if (view === 'nodes' && nodeType) setNodeType(null); else if (view !== 'browse') show('home'); else open(path.length > 1 ? path[path.length - 2].id : null); }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Breadcrumbs path={view !== 'browse' ? specialCrumb(view) : path} onOpen={id => { if (id === 'nodes') setNodeType(null); else open(id); }} compact />
          </div>
          </>}
        </div>}
        {banner}
        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {view === 'home' ? <>
            {home}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 16px 40px', marginTop: -24 }}>
              <Button icon="import" onClick={() => { void startInstall(); }}>Install…<ProBadgeFor feature="files.install" /></Button>
              <Button variant="primary" icon="export" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); downloadMenu(r.left, r.bottom + 4); }}>Download all<ProBadgeFor feature="files.everything" /></Button>
            </div>
          </> : view !== 'browse' ? special(view) : node ? nodeView : home}
        </div>
        {dialogs}
      </div>
    );
  }

  // ── Desktop ──
  return (
    <div {...drop} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', background: tk.bg.app, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <aside aria-label="Files" style={{ width: 288, flexShrink: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, borderRight: `1px solid ${tk.border.default}`, minHeight: 0 }}>
        <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${tk.border.subtle}` }}>
          <SpaceMeter inv={inv} estimate={estimate} usage={usage} onCleanUp={() => setView('cleanup')} />
        </div>
        <div style={{ padding: '10px 10px 4px' }}>
          <SideEntry icon="grid" tint={tk.accent.base} label="Home" sub="" count={0} active={view === 'home'} dense onClick={() => show('home')} />
          <SideEntry icon="nodes" tint={tk.accent.base} label="Nodes" sub="" count={0} active={view === 'nodes'} dense onClick={() => { setNodeType(null); show('nodes'); }} />
          <CleanUpEntry count={cleanupCount} active={view === 'cleanup'} onClick={() => show('cleanup')} dense />
          <NotesEntry count={notesCount} active={view === 'notes'} onClick={() => show('notes')} dense />
          <WorkspaceEntry active={view === 'workspace'} onClick={() => show('workspace')} />
          <LinkedFoldersEntry active={view === 'linked'} onClick={() => show('linked')} />
        </div>
        <div style={{ ...capsLabel(tk), padding: '12px 18px 6px' }}>Everything saved</div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 10px 16px' }}>
          <FilesTree sections={inv.sections} current={view === 'browse' ? current : null} expanded={expanded} onSelect={open}
            onToggle={id => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
          <LinkedGroup current={view === 'linked' ? linkedId ?? null : null} onOpen={id => { setLinkedId(id); show('linked'); }} />
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: selection ? '0 16px 0 10px' : '0 16px 0 20px', borderBottom: `1px solid ${tk.border.default}`, background: selection ? tk.bg.selected : tk.bg.panel }}>
          {selectionBar ?? <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Breadcrumbs path={view !== 'browse' ? specialCrumb(view) : path} onOpen={id => { if (id === 'nodes') setNodeType(null); else open(id); }} />
          </div>
          <Button size="sm" icon="import" onClick={() => { void startInstall(); }} title="Open a .playfile, a profile or a partial ZIP: see what’s inside, then bring it in">Install…<ProBadgeFor feature="files.install" /></Button>
          <Button size="sm" variant="primary" icon="export" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); downloadMenu(r.right - 260, r.bottom + 4); }} title="Everything saved here: one .playfile, or one ZIP with a manifest">Download everything<ProBadgeFor feature="files.everything" /></Button>
          </>}
        </div>
        {banner}
        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {view !== 'browse' ? special(view) : node ? nodeView : home}
        </div>
      </main>
      {dialogs}
    </div>
  );
}

function CleanUpEntry({ count, active = false, dense = false, onClick }: { count: number; active?: boolean; dense?: boolean; onClick: () => void }) {
  const tk = useTokens();
  return <SideEntry icon="spark" tint={tk.status.success} label="Clean up" sub={count ? `${plural(count, 'suggestion')}: old versions, unused files, duplicates` : 'Nothing to clean up'} count={count} active={active} dense={dense} onClick={onClick} />;
}

function NotesEntry({ count, active = false, dense = false, onClick }: { count: number; active?: boolean; dense?: boolean; onClick: () => void }) {
  const tk = useTokens();
  return <SideEntry icon="comment" tint={tk.accent.base} label="Notes" sub={count ? `${plural(count, 'note')}: Play notes and node comments` : 'No notes yet'} count={count} active={active} dense={dense} onClick={onClick} />;
}

function SideEntry({ icon, tint, label, sub, count, active, dense, onClick }: { icon: IconName; tint: string; label: string; sub: string; count: number; active: boolean; dense: boolean; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-current={active ? 'page' : undefined}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: dense ? '7px 8px' : '11px 12px', border: 0, borderRadius: dense ? radius.md : radius.lg, cursor: 'pointer', textAlign: 'left',
        background: active ? tk.bg.selected : dense ? (hover ? tk.bg.hover : 'transparent') : tk.bg.panel, boxShadow: dense ? 'none' : `inset 0 0 0 1px ${tk.border.default}`,
        color: active ? tk.accent.text : tk.text.primary, font: `600 12.5px ${fontFamily.ui}`,
      }}>
      <span style={{ width: dense ? 22 : 32, height: dense ? 22 : 32, borderRadius: dense ? 6 : 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tint, 0.14), color: tint, flexShrink: 0 }}>
        <Icon name={icon} size={dense ? 13 : 16} />
      </span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {label}
        {!dense && <span style={{ fontWeight: 400, fontSize: 11.5, color: tk.text.muted }}>{sub}</span>}
      </span>
      {count > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: active ? tk.accent.base : tk.bg.field, color: active ? tk.bg.panel : tk.text.muted, font: `600 10.5px ${fontFamily.ui}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>}
      {!dense && <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />}
    </button>
  );
}

function SectionRow({ node, first, state, onCheck, onOpen }: { node: FileNode; first: boolean; state: CheckState; onCheck: (on: boolean) => void; onOpen: () => void }) {
  const tk = useTokens();
  const n = countLeaves(node.children);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '6px 10px 6px 4px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}`, cursor: 'pointer', opacity: n ? 1 : 0.6 }}>
      <Check checked={state === 'on'} mixed={state === 'mixed'} disabled={!n} label={`Select ${node.label}`} onChange={onCheck} />
      <IconTile node={node} size={32} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `600 13.5px ${fontFamily.ui}`, color: tk.text.primary }}>{node.label}</span>
        <span style={{ fontSize: 11.5, color: tk.text.muted }}>{n ? `${plural(n, 'item')} · ${formatSize(node.size)}` : 'Nothing saved'}</span>
      </span>
      <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />
    </div>
  );
}

/** The sidebar's Linked folders group under the tree (only when there are some). */
function LinkedGroup({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
  const tk = useTokens();
  const count = useLinkedFolders(s => s.folders.length);
  if (!count) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...capsLabel(tk), padding: '8px 8px 4px' }}>Linked folders</div>
      <LinkedFoldersGroup current={current} onOpen={onOpen} />
    </div>
  );
}
