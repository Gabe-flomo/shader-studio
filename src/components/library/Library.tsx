/**
 * Library — everything you saved that goes on the graph, and the media library (docs/library.md).
 * It is drawn exactly like the sidebar's Nodes list (NodeGraph/browserParts.tsx): a search field,
 * categories under small caps headings (group presets first), each a row with its count that opens
 * into its items as pills. Click a pill to preview it, double-click it (or Add to graph) to add it
 * where the view is, or drag it onto the graph to drop it there. A picture, a video or a sound
 * dragged in becomes the node that plays it (library/mediaPlacement.ts).
 *
 * What it lists is library/libraryCategories.ts. Saved graphs are the top bar's Load menu
 * (GraphsList.tsx); shaders are on the Code page; builder presets are in their builder.
 *
 * The same component in the sidebar (`rail`), on the Files page and the phone's Library (`full`).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '../../library/appLibrary';
import { OPEN_LIBRARY } from '../../library/appLibrary';
import { deleteItem, exportText, importText, libraryEvents, onlyLibraryThings, renameItem } from '../../library/libraryFacade';
import { LIBRARY_CATEGORIES, libraryCategory, listAddable, mediaItems, type AddableItem, type LibraryCategoryId } from '../../library/libraryCategories';
import { placeMedia } from '../../library/mediaPlacement';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { COMPOUND_EFFECTS, compoundSubgraph } from '../../store/compoundEffects';
import { exprPresetParams } from '../../lib/glslPatterns/saveFlows';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { ExprPreset } from '../../types/exprPreset';
import type { TransformPreset } from '../../types/transformPreset';
import type { PalettePresetRecord } from '../../lib/palette';
import type { UserNodeDefinition } from '../../types/userNode';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { spawnPoint } from '../NodeGraph/spawnPoint';
import { AddHint, CapsLabel, CategoryRow, Crumb, Pill } from '../NodeGraph/browserParts';
import { FnThumbnail } from '../code/FnThumbnail';
import { reportFileResult } from '../shell/reportFileResult';
import { importBytes } from '../shell/importAnyFile';
import { requestPage } from '../page';
import { errorMessage, openBinaryFile, saveTextFile } from '../../utils/fileIO';
import { CONTAINER_ACCEPT } from '../../playfile/format';
import { useBackgroundImages, useLibraryVideos } from '../backgrounds/useBackgrounds';
import { openBackgrounds } from '../backgrounds/backgroundsUi';
import { EmptyHint, RenameField, signatureOf } from './ItemRow';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import type { PublishSource } from '../../nodes/userNodes/publishUserNode';
const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));

/** A category the Library can be asked to open on (OPEN_LIBRARY's detail.filter); older type names map onto them. */
export type LibraryFilter = LibraryCategoryId | 'presets' | 'all';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const safeFile = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 60) || 'library';
const asCategory = (f: LibraryFilter | undefined): LibraryCategoryId | null => (f && LIBRARY_CATEGORIES.some(c => c.id === f) ? f as LibraryCategoryId : null);

/** Everything listed, kept current as things are saved, renamed or removed anywhere. */
function useLibraryData(): Record<LibraryCategoryId, AddableItem[]> {
  const [saved, setSaved] = useState(() => listAddable());
  const loadFromDisk = useNodeGraphStore(s => s.loadCustomFnsFromDisk);
  const refresh = useCallback(async () => {
    const next = listAddable();
    // Desktop: functions kept in the presets folder show too (as the sidebar always showed them).
    try {
      const disk = await loadFromDisk();
      const have = new Set(next.functions.map(f => f.id));
      for (const p of disk) if (!have.has(p.id)) next.functions.push({ type: 'functions', id: p.id, name: p.label, kind: 'customFn', folderScope: 'functions', savedAt: p.savedAt ?? 0, record: p as unknown as Record<string, unknown>, category: 'functions' });
    } catch { /* no folder */ }
    setSaved(next);
  }, [loadFromDisk]);
  useEffect(() => {
    const on = () => { void refresh(); };
    on();
    const evs = libraryEvents();
    for (const ev of evs) window.addEventListener(ev, on);
    window.addEventListener('storage', on);
    window.addEventListener('focus', on);
    return () => { for (const ev of evs) window.removeEventListener(ev, on); window.removeEventListener('storage', on); window.removeEventListener('focus', on); };
  }, [refresh]);
  const { images } = useBackgroundImages();
  const { videos } = useLibraryVideos();
  const media = useMemo(() => mediaItems(images, videos), [images, videos]);
  return useMemo(() => ({ ...saved, ...media }), [saved, media]);
}

export interface LibraryProps {
  size?: 'rail' | 'full';
  /** The category it opens on (else the category list). */
  filter?: LibraryFilter;
  /** After something was added (the phone's sheet closes). */
  onOpened?: () => void;
}

export function Library({ size = 'rail', filter, onOpened }: LibraryProps) {
  const tk = useTokens();
  const data = useLibraryData();
  const [open, setOpen] = useState<LibraryCategoryId | null>(() => asCategory(filter));
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const [publish, setPublish] = useState<{ source: PublishSource; id: string } | null>(null);
  useEffect(() => { setOpen(asCategory(filter)); }, [filter]);
  // "Show in the Library" from elsewhere (Publish node's My nodes, a preset menu).
  useEffect(() => {
    const go = (e: Event) => { const f = (e as CustomEvent<{ filter?: LibraryFilter }>).detail?.filter; setOpen(asCategory(f)); setPicked(null); setQuery(''); };
    window.addEventListener(OPEN_LIBRARY, go);
    return () => window.removeEventListener(OPEN_LIBRARY, go);
  }, []);
  const actions = useActions(onOpened, setPublish);

  const q = query.trim().toLowerCase();
  const matches = (it: AddableItem) => `${it.name} ${it.hint ?? ''}`.toLowerCase().includes(q);
  const count = (c: LibraryCategoryId) => data[c].length;
  const total = LIBRARY_CATEGORIES.reduce((n, c) => n + (c.id === 'builtInGroups' ? 0 : count(c.id)), 0);
  const key = (it: AddableItem) => `${it.category}:${it.id}`;
  const pick = (it: AddableItem) => setPicked(p => (p === key(it) ? null : key(it)));

  const pills = (items: AddableItem[]) => {
    const sel = items.find(it => key(it) === picked);
    return <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map(it => (
          <Pill key={key(it)} attrs={{ 'data-library-item': it.id, 'data-library-category': it.category }}
            label={it.name} description={it.hint} isSelected={picked === key(it)}
            lead={pillLead(it)}
            onSingleClick={() => pick(it)} onDoubleClick={() => { actions.add(it); setPicked(null); }}
            drag={{ label: it.name, ...(dragType(it) ? { type: dragType(it)! } : {}), place: pos => actions.add(it, pos) }}
            onDragEnd={() => { setPicked(null); actions.done(); }} />
        ))}
      </div>
      {sel && <Preview key={key(sel)} item={sel} actions={actions} onGone={() => setPicked(null)} />}
    </>;
  };

  let body: React.ReactNode;
  if (q) {
    const hits = LIBRARY_CATEGORIES.map(c => ({ c, items: data[c.id].filter(matches) })).filter(x => x.items.length);
    body = hits.length === 0
      ? <div style={{ color: tk.text.faint, fontSize: 12, padding: '4px 2px' }}>No matches</div>
      : <>
          <AddHint noun="one" />
          {hits.map(({ c, items }) => <div key={c.id} data-library-section={c.id}><CapsLabel>{c.label}</CapsLabel>{pills(items)}</div>)}
        </>;
  } else if (open) {
    const c = libraryCategory(open);
    const items = data[open];
    body = (
      <div data-library-open={open} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Crumb label={c.label} count={items.length} onBack={() => { setOpen(null); setPicked(null); }} />
        <div data-category-info style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '0 2px 4px' }}>{c.info}</div>
        {items.length === 0 ? <EmptyHint>{emptyLine(open)}</EmptyHint> : <><AddHint noun="one" />{pills(items)}</>}
        {open === 'nodes' && <NodeTypeTools count={items.length} />}
        {c.section === 'Media' && <div style={{ marginTop: 6 }}><Button size="sm" variant="ghost" icon="overlay" onClick={() => { void openBackgrounds(); }}>Manage media…</Button></div>}
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(['Presets', 'Media'] as const).map(section => {
          // A category with nothing in it isn't offered (the built-in groups always are).
          const cats = LIBRARY_CATEGORIES.filter(c => c.section === section && (count(c.id) > 0 || c.id === 'builtInGroups'));
          if (!cats.length) return null;
          return (
            <div key={section} data-library-section={section}>
              <CapsLabel rule>{section}</CapsLabel>
              {cats.map(c => (
                <CategoryRow key={c.id} label={c.label} title={c.info} count={count(c.id)} attrs={{ 'data-library-category-row': c.id }}
                  onClick={() => { setOpen(c.id); setPicked(null); }} />
              ))}
            </div>
          );
        })}
        {total === 0 && <div style={{ marginTop: 6 }}><EmptyHint>Nothing of yours here yet. Save a group as a preset, publish a node, or add pictures, videos and sounds: they all show here, ready to drop on the graph.</EmptyHint></div>}
      </div>
    );
  }

  const importMenuItems: MenuItem[] = [
    { label: 'A file…', icon: 'import', hint: 'A Library export, a .play file or a library ZIP: it goes where it belongs', onSelect: () => { void pickImport(); } },
    { label: 'Functions (.json)…', icon: 'fn', hint: 'custom-fns.json from an older export', onSelect: () => { void useNodeGraphStore.getState().importCustomFnsFromFile(); } },
    { label: 'Node types…', icon: 'spark', hint: 'A node pack (.play) or an older node .json', onSelect: () => { void importUserNodes(); } },
    { label: 'Pictures, videos and sounds…', icon: 'overlay', hint: 'The media manager: import, folders, rename, clean up', onSelect: () => { void openBackgrounds(); } },
  ];

  return (
    <div data-library={size} style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
      <Field aria-label="Search the Library" placeholder="Search the Library…" value={query} onChange={e => setQuery(e.target.value)}
        leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />} style={{ flexShrink: 0, marginBottom: 6 }} />
      <div data-library-list="">{body}</div>
      {!open && !q && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" icon="import" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setImportMenu({ x: r.left, y: r.bottom + 4 }); }}>Import…</Button>
          <Button size="sm" variant="ghost" icon="overlay" onClick={() => { void openBackgrounds(); }}>Manage media…</Button>
        </div>
      )}
      {importMenu && <Menu x={importMenu.x} y={importMenu.y} minWidth={260} onClose={() => setImportMenu(null)} items={importMenuItems} />}
      {publish && <PublishNodeModal source={publish.source} existingId={publish.id} onClose={() => setPublish(null)} />}
    </div>
  );
}

async function pickImport(): Promise<void> {
  let picked: Awaited<ReturnType<typeof openBinaryFile>>;
  try { picked = await openBinaryFile(`${CONTAINER_ACCEPT},.json,.zip`); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
  if (!picked) return;
  // A Library export: merged here, nothing of yours overwritten.
  const text = picked.bytes[0] === 0x7b ? new TextDecoder().decode(picked.bytes) : null;
  if (text && onlyLibraryThings(text)) {
    const r = importText(text);
    if (!r.ok) { toast.error(`Couldn’t import “${picked.name}”`, { message: r.error }); return; }
    toast.success(`Imported “${picked.name}”`, { message: [r.added ? `${r.added} added` : 'Nothing new', r.renamed.length ? `${plural(r.renamed.length, 'graph')} came in as “… (imported)”` : '', r.kept ? `${r.kept} you already had (yours kept)` : ''].filter(Boolean).join(' · ') });
    return;
  }
  // Anything else Playfield makes: a .play file, a graph, a presentation, a library ZIP.
  await importBytes(picked.name, picked.bytes, requestPage);
}

async function importUserNodes(): Promise<void> {
  const r = await useNodeGraphStore.getState().importUserNodesFromFile();
  if (!r.ok) { reportFileResult(r, { failTitle: 'Couldn’t import node types' }); return; }
  if (r.deferred) return;
  const parts = [r.imported?.length ? `${r.imported.length} new: ${r.imported.join(', ')}` : '', r.replaced?.length ? `${r.replaced.length} updated: ${r.replaced.join(', ')}` : ''].filter(Boolean);
  toast.success('Node types imported', { message: parts.join(' · ') });
}

function emptyLine(c: LibraryCategoryId): string {
  switch (c) {
    case 'groups': return 'Save a group as a preset (its menu → Save as preset) to keep it here.';
    case 'nodes': return 'Publish a graph or a group as a node (Publish node).';
    case 'functions': return 'Save a Custom Function node as a preset.';
    case 'expressions': return 'Save an Expression Block node as a preset.';
    case 'transforms': return 'Save a Transform Vec node as a preset.';
    case 'palettes': return 'Save a palette from a Palette node’s presets menu.';
    case 'images': return 'Pictures you add (a Texture node, Backgrounds) show here.';
    case 'videos': return 'Videos you add (a Texture node, a Video layer) show here.';
    case 'sounds': return 'Sounds you load (an Audio Source, a sample) show here.';
    default: return 'Nothing here yet.';
  }
}

/** The node type a pill drags as (the drop shows its card); none for groups and media (a plain label). */
function dragType(it: AddableItem): string | undefined {
  switch (it.category) {
    case 'functions': return 'customFn';
    case 'expressions': return 'exprNode';
    case 'transforms': return 'transformVec';
    case 'nodes': return it.id;
    default: return undefined;
  }
}

function pillLead(it: AddableItem): React.ReactNode {
  if (it.category === 'functions') return <FnThumbnail preset={it.record as unknown as CustomFnPreset} size={20} />;
  if (it.thumb) return <img src={it.thumb} alt="" draggable={false} style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />;
  return undefined;
}

// ── Adding things ────────────────────────────────────────────────────────────

interface Actions {
  /** Put it on the graph (at `pos`, else where the view is); the new node's id. */
  add: (it: AddableItem, pos?: { x: number; y: number }) => string | null;
  remove: (it: AddableItem) => void;
  exportOne: (it: AddableItem) => void;
  edit: (it: AddableItem) => (() => void) | undefined;
  done: () => void;
}

function useActions(onOpened: (() => void) | undefined, setPublish: (p: { source: PublishSource; id: string } | null) => void): Actions {
  const done = () => onOpened?.();
  const add = (it: AddableItem, at?: { x: number; y: number }): string | null => {
    const st = useNodeGraphStore.getState();
    const r = it.record ?? {};
    const pos = at ?? spawnPoint(it.category === 'nodes' ? it.id : undefined);
    let id: string | null | undefined = null;
    if (it.media) id = placeMedia({ kind: it.media, id: it.id, name: it.name, thumb: it.thumb ?? undefined }, pos);
    else switch (it.category) {
      case 'functions': { const p = r as unknown as CustomFnPreset; id = st.addNode('customFn', pos, { label: p.label, inputs: p.inputs, outputType: p.outputType, body: p.body, glslFunctions: p.glslFunctions, ...(p.comment ? { __comment: p.comment } : {}) }); break; }
      case 'expressions': id = st.addNode('exprNode', pos, exprPresetParams(r as unknown as ExprPreset)); break;
      case 'transforms': { const p = r as unknown as TransformPreset; id = st.addNode('transformVec', pos, { outputType: p.outputType, exprX: p.exprX, exprY: p.exprY, exprZ: p.exprZ, exprW: p.exprW, ...(p.comment ? { __comment: p.comment } : {}) }); break; }
      case 'groups': id = st.instantiateGroupPreset(it.id, pos); break;
      case 'builtInGroups': { const c = COMPOUND_EFFECTS.find(x => x.id === it.id); if (c) id = st.placeSubgraphAsGroup(c.label, compoundSubgraph(c), pos, c.description); break; }
      case 'nodes': id = st.addNode(it.id, pos); break;
      case 'palettes': {
        const p = r as unknown as PalettePresetRecord;
        if (p.kind === 'cosine' && p.cosine) id = st.addNode('palette', pos, { preset: 'custom', ...p.cosine });
        else { id = st.addNode('stopPalette', pos); if (id) st.setPaletteStops(id, p.stops ?? [], { wrap: p.wrap, blend: p.blend }); }
        break;
      }
      default: break;
    }
    if (id) done();
    return id ?? null;
  };
  const remove = async (it: AddableItem) => {
    if (it.category === 'nodes' && !(await askConfirm(`Delete node type “${it.name}”?`, { message: 'Placed instances stop compiling until it is back.', confirmLabel: 'Delete', danger: true }))) return;
    const { result, undo } = deleteItem(it);
    if (!result.ok) { toast.error('Couldn’t delete it', { message: result.error }); return; }
    let undone = false;
    toast.success(`Deleted “${it.name}”`, { action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; undo(); } } });
  };
  const exportOne = async (it: AddableItem) => {
    if (it.category === 'nodes') { reportFileResult(await useNodeGraphStore.getState().exportUserNodes([it.id]), { failTitle: `Couldn’t export “${it.name}”` }); return; }
    reportFileResult(await saveTextFile(exportText([it]), `${safeFile(it.name)}.library.json`), { failTitle: `Couldn’t export “${it.name}”`, success: `Exported “${it.name}”` });
  };
  const edit = (it: AddableItem) => {
    if (it.category !== 'nodes') return undefined;
    const d = it.record as unknown as UserNodeDefinition;
    if (!d.source) return undefined;
    return () => {
      if (d.source?.kind === 'code') { setPublish({ id: d.id, source: { kind: 'code', code: d.source.code, entry: d.source.entry, label: d.label } }); return; }
      if (useNodeGraphStore.getState().openUserNodeSource(d.id, spawnPoint())) done();
    };
  };
  return { add, remove: it => { void remove(it); }, exportOne: it => { void exportOne(it); }, edit, done };
}

/** One line saying what it is: a function's signature, a group's sockets. */
function signature(it: AddableItem): string | undefined {
  const r = it.record ?? {};
  switch (it.category) {
    case 'functions': return signatureOf(it.name, String(r.outputType), (r.inputs as Array<{ name: string; type: string }>) ?? []);
    case 'expressions': return `${signatureOf(it.name, String(r.outputType), (r.inputs as Array<{ name: string; type: string }>) ?? [])} = ${String(r.result ?? '')}`;
    case 'transforms': return `${String(r.outputType)}(${[r.exprX, r.exprY, r.outputType !== 'vec2' ? r.exprZ : null, r.outputType === 'vec4' ? r.exprW : null].filter(Boolean).join(', ')})`;
    case 'groups': { const sg = r.subgraph as { nodes?: unknown[]; inputPorts?: unknown[]; outputPorts?: unknown[] } | undefined; return `${sg?.nodes?.length ?? 0} nodes · ${sg?.inputPorts?.length ?? 0} in · ${sg?.outputPorts?.length ?? 0} out`; }
    default: return undefined;
  }
}

const KIND_WORD: Record<LibraryCategoryId, string> = {
  groups: 'Group preset', builtInGroups: 'Built-in group', nodes: 'My node', functions: 'Function', expressions: 'Expression Block', transforms: 'Vector transform',
  palettes: 'Palette', images: 'Picture → Texture node', videos: 'Video → Texture node', sounds: 'Sound → Audio Source',
};

/** The card under a picked pill, as the Nodes list shows one: what it is, Add to graph, and its own actions. */
function Preview({ item, actions, onGone }: { item: AddableItem; actions: Actions; onGone: () => void }) {
  const tk = useTokens();
  const [renaming, setRenaming] = useState<string | null>(null);
  const sig = signature(item);
  const own = !item.builtIn && !item.media;
  const edit = actions.edit(item);
  const picture = item.category === 'functions' ? <FnThumbnail preset={item.record as unknown as CustomFnPreset} size={56} radius={radius.md} />
    : item.thumb ? <img src={item.thumb} alt="" style={{ width: item.media ? 96 : 56, height: 56, borderRadius: radius.md, objectFit: 'cover', flexShrink: 0 }} /> : null;
  return (
    <div data-library-preview={item.id} style={{ marginTop: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {picture}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {renaming !== null
            ? <RenameField value={renaming} onChange={setRenaming}
                onCommit={() => { const r = renameItem(item, renaming); if (!r.ok) toast.error('Couldn’t rename it', { message: r.error }); setRenaming(null); }}
                onCancel={() => setRenaming(null)} />
            : <span style={{ fontWeight: 600, fontSize: 13, color: tk.text.primary, overflowWrap: 'anywhere' }}>{item.name}</span>}
          <span style={{ fontSize: 11, color: tk.text.faint }}>{KIND_WORD[item.category]}</span>
        </div>
      </div>
      {sig && <code style={{ font: `11.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.field, borderRadius: 6, padding: '5px 8px', overflowWrap: 'anywhere' }}>{sig}</code>}
      {item.hint && <div style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted, whiteSpace: 'pre-wrap' }}>{item.hint}</div>}
      <Button size="sm" variant="primary" icon="plus" onClick={() => { if (actions.add(item)) onGone(); }}>Add to graph</Button>
      {(own || item.media) && (
        <div style={{ display: 'flex', gap: 4, paddingTop: 6, borderTop: `1px solid ${tk.border.subtle}`, alignItems: 'center' }}>
          {own && <>
            {edit && <Button size="sm" variant="ghost" icon="layoutGraph" onClick={edit} title={(item.record as unknown as UserNodeDefinition)?.source?.kind === 'code' ? 'Edit the GLSL (publish again to update)' : 'Open the source graph (publish again to update)'}>Edit</Button>}
            <span style={{ flex: 1 }} />
            <IconButton icon="export" size="sm" label="Export as a file" onClick={() => actions.exportOne(item)} />
            <IconButton icon="edit" size="sm" label="Rename" onClick={() => setRenaming(item.name)} />
            <IconButton icon="trash" size="sm" tone="danger" label="Delete" onClick={() => { actions.remove(item); onGone(); }} />
          </>}
          {item.media && <Button size="sm" variant="ghost" icon="overlay" onClick={() => { void openBackgrounds(); }}>Manage media…</Button>}
        </div>
      )}
    </div>
  );
}

/** My nodes: Publish, import a pack, export them all. */
function NodeTypeTools({ count }: { count: number }) {
  const exportUserNodes = useNodeGraphStore(s => s.exportUserNodes);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      <Button size="sm" variant="ghost" icon="spark" onClick={() => window.dispatchEvent(new CustomEvent('open-sidebar-tab', { detail: { tab: 'builder' } }))} title="Turn the graph, a saved graph or GLSL into a node type">Publish node…</Button>
      {count > 0 && <Button size="sm" variant="ghost" icon="export" onClick={async () => reportFileResult(await exportUserNodes(), { failTitle: 'Couldn’t export node types' })} title="Every node type as a node pack (.play file)">Export all</Button>}
    </div>
  );
}
