/**
 * Library — one place for everything you save (docs/library.md): graphs, presets, functions,
 * Expression Blocks, keyframe curves, your published node types, the Code page's shaders and the
 * media library, under type filters, with one search, folders, rename, delete (with Undo),
 * export and import that work the same way for every type. Each thing keeps its own action:
 * a graph opens, a function or a group is placed in the graph, a keyframe curve is applied to
 * the open keyframe editor, a layer set is added to Play, a shader opens on the Code page.
 *
 * The same component at three sizes: the sidebar's Library (`rail`), the Files page's Library
 * (`full`) and the top bar's folder button (`popover`, on the Graphs filter). The data stays in
 * the stores it always lived in, read and written through library/libraryFacade.ts and
 * presets/presetStore.ts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '../../library/appLibrary';
import { OPEN_LIBRARY, openShaderItem } from '../../library/appLibrary';
import {
  deleteItem, exportText, importText, LIBRARY_TYPES, libraryEvents, listEverything, onlyLibraryThings, OWN_FILTER_KINDS, renameItem,
  type LibraryItem, type LibraryType,
} from '../../library/libraryFacade';
import { builtInPresets, PRESET_GROUPS, presetKind, presetKindsIn } from '../../presets/presetStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { groupByTime, lastWorkedOn, sortByRecent } from '../../store/graphRecency';
import { COMPOUND_EFFECTS, compoundSubgraph } from '../../store/compoundEffects';
import { exprPresetParams } from '../../lib/glslPatterns/saveFlows';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { ExprPreset } from '../../types/exprPreset';
import type { TransformPreset } from '../../types/transformPreset';
import type { KeyframePreset } from '../../types/keyframePreset';
import type { LayerSet } from '../../play/layerSets';
import type { RackPreset } from '../../play/rackPresets';
import type { UserNodeDefinition } from '../../types/userNode';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Menu, type MenuItem } from '../ui/Menu';
import { askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { FolderableList } from '../NodeGraph/FolderableList';
import { spawnPoint } from '../NodeGraph/spawnPoint';
import { FnThumbnail } from '../code/FnThumbnail';
import { SaveGraphForm, VersionsButton } from '../shell/GraphVersions';
import { GraphLinkBadge } from '../shell/GraphLinks';
import { reportFileResult } from '../shell/reportFileResult';
import { importBytes } from '../shell/importAnyFile';
import { requestPage } from '../page';
import { errorMessage, openBinaryFile, saveTextFile } from '../../utils/fileIO';
import { CONTAINER_ACCEPT } from '../../playfile/format';
import { useBackgroundImages, useLibraryVideos } from '../backgrounds/useBackgrounds';
import { openBackgrounds } from '../backgrounds/backgroundsUi';
import { isAudioType } from '../../lib/backgroundLibrary';
import { EmptyHint, ItemRow, RenameField, SavedItemPreview, signatureOf, TabSectionHeader } from './ItemRow';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import type { PublishSource } from '../../nodes/userNodes/publishUserNode';
const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));

/** A filter: one type, every type, or the media library (pictures, videos, sounds). */
export type LibraryFilter = 'all' | LibraryType | 'media';

const TYPE_ICON: Record<LibraryType | 'media', IconName> = {
  graphs: 'graphs', presets: 'presets', functions: 'fn', expressions: 'expr', keyframes: 'kf', nodes: 'spark', shaders: 'code', media: 'overlay',
};
const FILTER_KEY = 'playfield:library:filter';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const safeFile = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 60) || 'library';

/** Everything listed, kept current as things are saved, renamed or removed anywhere. */
function useLibraryData(): Record<LibraryType, LibraryItem[]> {
  const [data, setData] = useState(() => listEverything());
  const loadFromDisk = useNodeGraphStore(s => s.loadCustomFnsFromDisk);
  const refresh = useCallback(async () => {
    const next = listEverything();
    // Desktop: functions kept in the presets folder show too (as the sidebar always showed them).
    try {
      const disk = await loadFromDisk();
      const have = new Set(next.functions.map(f => f.id));
      for (const p of disk) if (!have.has(p.id)) next.functions.push({ type: 'functions', id: p.id, name: p.label, kind: 'customFn', folderScope: 'functions', savedAt: p.savedAt ?? 0, record: p as unknown as Record<string, unknown> });
    } catch { /* no folder */ }
    setData(next);
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
  return data;
}

export interface LibraryProps {
  size?: 'rail' | 'full' | 'popover';
  /** The filter it opens on (else the last one used; the popover always opens on Graphs). */
  filter?: LibraryFilter;
  /** After something was opened or placed (the rail closes a drawer, the popover closes). */
  onOpened?: () => void;
  /** Extra content under the list (the popover's Examples). */
  footer?: React.ReactNode;
}

export function Library({ size = 'rail', filter: initialFilter, onOpened, footer }: LibraryProps) {
  const tk = useTokens();
  const data = useLibraryData();
  const { images } = useBackgroundImages();
  const { videos } = useLibraryVideos();
  const mediaCount = (images?.length ?? 0) + (videos?.length ?? 0);
  const [filter, setFilterState] = useState<LibraryFilter>(() => {
    if (initialFilter) return initialFilter;
    try { const v = localStorage.getItem(FILTER_KEY) as LibraryFilter | null; if (v) return v; } catch { /* default */ }
    return 'graphs';
  });
  const setFilter = (f: LibraryFilter) => {
    setFilterState(f);
    if (size !== 'popover') { try { localStorage.setItem(FILTER_KEY, f); } catch { /* preference only */ } }
  };
  useEffect(() => { if (initialFilter) setFilterState(initialFilter); }, [initialFilter]);
  // "Open the Library on Presets" from elsewhere (the header, a panel's "in the Library" link).
  useEffect(() => {
    if (size === 'popover') return;
    const go = (e: Event) => { const f = (e as CustomEvent<{ filter?: LibraryFilter }>).detail?.filter; if (f) setFilterState(f); };
    window.addEventListener(OPEN_LIBRARY, go);
    return () => window.removeEventListener(OPEN_LIBRARY, go);
  }, [size]);
  const [query, setQuery] = useState('');
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const currentGraph = useNodeGraphStore(s => s.currentGraph);
  const graphDirty = useNodeGraphStore(s => s.graphDirty);

  const counts: Record<LibraryFilter, number> = {
    all: LIBRARY_TYPES.reduce((n, t) => n + data[t.id].length, 0) + mediaCount,
    ...Object.fromEntries(LIBRARY_TYPES.map(t => [t.id, data[t.id].length])) as Record<LibraryType, number>,
    media: mediaCount,
  };
  // A type with nothing in it isn't offered (Graphs always is, and whichever filter is on).
  const chips = ([
    { id: 'all', label: 'All' },
    ...LIBRARY_TYPES.map(t => ({ id: t.id as LibraryFilter, label: t.label })),
    { id: 'media', label: 'Media' },
  ] as Array<{ id: LibraryFilter; label: string }>).filter(c => c.id === 'all' || c.id === 'graphs' || c.id === filter || counts[c.id] > 0);

  const q = query.trim().toLowerCase();
  const matches = (it: LibraryItem) => !q || `${it.name} ${it.hint ?? ''} ${it.group ?? ''} ${it.kind ? presetKind(it.kind)?.label ?? '' : ''}`.toLowerCase().includes(q);
  const shownTypes: LibraryType[] = filter === 'all' ? LIBRARY_TYPES.map(t => t.id) : filter === 'media' ? [] : [filter];
  const anything = counts.all > 0;

  const pickImport = async () => {
    let picked: Awaited<ReturnType<typeof openBinaryFile>>;
    try { picked = await openBinaryFile(`${CONTAINER_ACCEPT},.json,.zip`); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
    if (!picked) return;
    // A Library export (presets, functions, graphs, nodes, shaders): merged here, nothing of yours overwritten.
    const text = picked.bytes[0] === 0x7b ? new TextDecoder().decode(picked.bytes) : null;
    if (text && onlyLibraryThings(text)) {
      const r = importText(text);
      if (!r.ok) { toast.error(`Couldn’t import “${picked.name}”`, { message: r.error }); return; }
      toast.success(`Imported “${picked.name}”`, { message: [r.added ? `${r.added} added` : 'Nothing new', r.renamed.length ? `${plural(r.renamed.length, 'graph')} came in as “… (imported)”` : '', r.kept ? `${r.kept} you already had (yours kept)` : ''].filter(Boolean).join(' · ') });
      return;
    }
    // Anything else Playfield makes: a .play file, a graph, a presentation, a library ZIP.
    await importBytes(picked.name, picked.bytes, requestPage);
  };
  const importGraphsBulk = useNodeGraphStore(s => s.importGraphsBulk);
  const importGraphs = async (mode: 'files' | 'folder') => {
    const r = await importGraphsBulk(mode);
    if (!r.ok) { reportFileResult(r, { failTitle: 'Couldn’t import graphs' }); return; }
    const n = r.imported?.length ?? 0;
    const skipped = r.skipped?.length ?? 0;
    toast.success(`Imported ${plural(n, 'graph')}`, { message: skipped ? `${plural(skipped, 'file')} skipped (${r.skipped![0].reason}).` : undefined });
  };
  const importMenuItems: MenuItem[] = [
    { label: 'A file…', icon: 'import', hint: 'A .play file, a graph, a Library export or a library ZIP: it goes where it belongs', onSelect: () => { void pickImport(); } },
    { label: 'Graph files…', icon: 'graphs', hint: 'Several graph files at once', onSelect: () => { void importGraphs('files'); } },
    { label: 'A folder of graphs…', icon: 'folder', hint: 'Its folders are recreated here', onSelect: () => { void importGraphs('folder'); } },
    { label: 'Functions (.json)…', icon: 'fn', hint: 'custom-fns.json from an older export', onSelect: () => { void useNodeGraphStore.getState().importCustomFnsFromFile(); } },
    { label: 'Node types…', icon: 'spark', hint: 'A node pack (.play) or an older node .json', onSelect: () => { void importUserNodes(); } },
    'separator',
    { label: 'Storage, backups and clean up…', icon: 'folder', hint: 'The Files page: sizes, what uses what, download everything', onSelect: () => window.dispatchEvent(new Event('open-files-page')) },
  ];
  const importUserNodes = async () => {
    const r = await useNodeGraphStore.getState().importUserNodesFromFile();
    if (!r.ok) { reportFileResult(r, { failTitle: 'Couldn’t import node types' }); return; }
    if (r.deferred) return;
    const parts = [r.imported?.length ? `${r.imported.length} new: ${r.imported.join(', ')}` : '', r.replaced?.length ? `${r.replaced.length} updated: ${r.replaced.join(', ')}` : ''].filter(Boolean);
    toast.success('Node types imported', { message: parts.join(' · ') });
  };

  const full = size === 'full';
  const pad = full ? '0' : '0';
  return (
    <div data-library={size} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, padding: pad, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Field aria-label="Search the Library" placeholder="Search the Library…" value={query} onChange={e => setQuery(e.target.value)} height={size === 'popover' ? 30 : undefined}
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />} style={{ flex: 1, minWidth: 0 }} />
        <IconButton icon="import" label="Import into the Library" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setImportMenu({ x: r.left, y: r.bottom + 4 }); }} />
      </div>
      <div role="tablist" aria-label="What to show" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {chips.map(c => {
          const on = filter === c.id;
          return (
            <button key={c.id} type="button" role="tab" aria-selected={on} data-library-filter={c.id} onClick={() => setFilter(c.id)}
              style={{
                height: 24, padding: '0 8px', border: 0, borderRadius: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                background: on ? tk.ink.base : tk.bg.field, color: on ? tk.ink.text : tk.text.secondary, font: `600 11.5px ${fontFamily.ui}`,
              }}>
              {c.label}
              {c.id !== 'all' && <span style={{ fontWeight: 500, opacity: 0.75 }}>{counts[c.id]}</span>}
            </button>
          );
        })}
      </div>
      {(filter === 'graphs' || filter === 'all') && (saving
        ? <div style={{ margin: '2px 0 4px' }}><SaveGraphForm onDone={() => setSaving(false)} /></div>
        : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" icon="save" onClick={() => setSaving(true)}>{currentGraph ? `Save “${currentGraph.name}”${graphDirty ? ' •' : ''}` : 'Save current graph'}</Button>
          </div>)}

      {!anything && !q && <EmptyHint>Nothing saved yet. Save the graph (⌘S), or save a preset from a node, a builder or Play: it all shows here.</EmptyHint>}

      <div data-library-list="" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shownTypes.map(t => {
          const items = data[t].filter(matches);
          if (filter === 'all' && items.length === 0) return null;
          const def = LIBRARY_TYPES.find(x => x.id === t)!;
          return (
            <section key={t} data-library-type={t} aria-label={def.label}>
              {filter === 'all' && <TabSectionHeader label={`${def.label} · ${items.length}`} />}
              <TypeList type={t} items={items} searching={!!q} all={data[t]} onOpened={onOpened} size={size} query={q} />
            </section>
          );
        })}
        {(filter === 'media' || (filter === 'all' && mediaCount > 0)) && (
          <section data-library-type="media" aria-label="Media">
            {filter === 'all' && <TabSectionHeader label={`Media · ${mediaCount}`} />}
            <MediaList query={q} />
          </section>
        )}
      </div>
      {footer}
      {importMenu && <Menu x={importMenu.x} y={importMenu.y} minWidth={260} onClose={() => setImportMenu(null)} items={importMenuItems} />}
    </div>
  );
}

// ── One type's list ──────────────────────────────────────────────────────────

function TypeList({ type, items, all, searching, onOpened, size, query }: { type: LibraryType; items: LibraryItem[]; all: LibraryItem[]; searching: boolean; onOpened?: () => void; size: LibraryProps['size']; query: string }) {
  const tk = useTokens();
  const def = LIBRARY_TYPES.find(x => x.id === type)!;
  const color = typeColor(tk, type);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [publish, setPublish] = useState<{ source: PublishSource; id: string } | null>(null);
  const actions = useItemActions(onOpened, setPublish);

  const row = (it: LibraryItem) => {
    if (renaming?.id === it.id) {
      return <RenameField value={renaming.value} onChange={v => setRenaming({ id: it.id, value: v })}
        onCommit={() => { const r = renameItem(it, renaming.value); if (!r.ok) toast.error('Couldn’t rename it', { message: r.error }); setRenaming(null); }}
        onCancel={() => setRenaming(null)} />;
    }
    return <LibraryRow item={it} color={color} selected={selected === it.id} onSelect={() => setSelected(s => (s === it.id ? null : it.id))}
      onRename={() => setRenaming({ id: it.id, value: it.name })} actions={actions} />;
  };

  if (type === 'presets') return <PresetsList items={items} searching={searching} row={row} query={query} actions={actions} />;
  if (items.length === 0) return searching ? <EmptyHint>Nothing matches.</EmptyHint> : <EmptyHint>{def.empty}</EmptyHint>;

  let body: React.ReactNode;
  if (searching) body = <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{sortForType(type, items).map(it => <React.Fragment key={it.id}>{row(it)}</React.Fragment>)}</div>;
  else if (type === 'shaders') body = <ShaderGroups items={items} row={row} />;
  else {
    const scope = all[0]?.folderScope ?? items[0]?.folderScope ?? type;
    body = (
      <FolderableList scopeKey={scope} color={color} items={items.map(it => ({ ...it, label: it.name }))}
        {...(type === 'graphs'
          ? { groupLoose: (l: Array<LibraryItem & { label: string }>) => groupByTime(l, i => lastWorkedOn(i.id), i => i.label), sortItems: (l: Array<LibraryItem & { label: string }>) => sortByRecent(l, i => lastWorkedOn(i.id), i => i.label), foldersLast: true }
          : { sortItems: (l: Array<LibraryItem & { label: string }>) => [...l].sort((a, b) => a.label.localeCompare(b.label)) })}
        maxHeight={size === 'rail' ? 'min(60vh, 560px)' : undefined}
        renderItem={it => row(it)} />
    );
  }
  return <>
    {type === 'nodes' && <NodeTypeTools count={items.length} />}
    {body}
    {publish && <PublishNodeModal source={publish.source} existingId={publish.id} onClose={() => setPublish(null)} />}
  </>;
}

function sortForType(type: LibraryType, items: LibraryItem[]): LibraryItem[] {
  return type === 'graphs' ? sortByRecent(items, i => lastWorkedOn(i.id), i => i.name) : [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function typeColor(tk: ReturnType<typeof useTokens>, type: LibraryType | 'media'): string {
  switch (type) {
    case 'graphs': return tk.status.success;
    case 'functions': case 'nodes': return tk.kind.fn;
    case 'expressions': return tk.kind.expr;
    case 'keyframes': return tk.status.warning;
    default: return tk.accent.base;
  }
}

/** My nodes: import a pack, export them all. */
function NodeTypeTools({ count }: { count: number }) {
  const exportUserNodes = useNodeGraphStore(s => s.exportUserNodes);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
      <Button size="sm" icon="spark" onClick={() => window.dispatchEvent(new CustomEvent('open-sidebar-tab', { detail: { tab: 'builder' } }))} title="Turn the graph, a saved graph or GLSL into a node type">Publish node…</Button>
      {count > 0 && <Button size="sm" icon="export" onClick={async () => reportFileResult(await exportUserNodes(), { failTitle: 'Couldn’t export node types' })} title="Every node type as a node pack (.play file)">Export all</Button>}
    </div>
  );
}

/** The Code page's shaders, by their groups (the Code page keeps the groups; it is where they move). */
function ShaderGroups({ items, row }: { items: LibraryItem[]; row: (it: LibraryItem) => React.ReactNode }) {
  const tk = useTokens();
  const groups = [...new Set(items.map(i => i.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b));
  const loose = items.filter(i => !i.group);
  const byName = (a: LibraryItem, b: LibraryItem) => a.name.localeCompare(b.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {groups.map(g => (
        <div key={g}>
          <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', color: tk.text.secondary, fontWeight: 600 }}>
            <Icon name="folder" size={14} style={{ color: tk.text.faint }} />{g}
          </div>
          <div style={{ paddingLeft: 16 }}>{items.filter(i => i.group === g).sort(byName).map(it => <React.Fragment key={it.id}>{row(it)}</React.Fragment>)}</div>
        </div>
      ))}
      {loose.sort(byName).map(it => <React.Fragment key={it.id}>{row(it)}</React.Fragment>)}
    </div>
  );
}

// ── Presets: by what they apply to ───────────────────────────────────────────

function PresetsList({ items, searching, row, query, actions }: { items: LibraryItem[]; searching: boolean; row: (it: LibraryItem) => React.ReactNode; query: string; actions: ItemActions }) {
  const tk = useTokens();
  const [openBuiltIns, setOpenBuiltIns] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const builtIns = useMemo(() => builtInPresets('group').filter(b => !query || b.name.toLowerCase().includes(query)), [query]);
  const groups = PRESET_GROUPS.map(g => ({ ...g, kinds: presetKindsIn(g.id).filter(k => !OWN_FILTER_KINDS.has(k.id)) }));
  const anyMine = items.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!anyMine && !searching && <EmptyHint>{LIBRARY_TYPES.find(t => t.id === 'presets')!.empty}</EmptyHint>}
      {searching && !anyMine && builtIns.length === 0 && <EmptyHint>Nothing matches.</EmptyHint>}
      {groups.map(g => {
        const kinds = g.kinds.filter(k => items.some(i => i.kind === k.id));
        if (!kinds.length) return null;
        return (
          <div key={g.id} data-preset-group={g.id}>
            <TabSectionHeader label={g.label} />
            {kinds.map(k => {
              const mine = items.filter(i => i.kind === k.id);
              return (
                <div key={k.id} data-preset-kind={k.id} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 6px 2px' }}>
                    <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.secondary }}>{k.label}</span>
                    <span style={{ fontSize: 11, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.appliesTo === k.label ? '' : k.appliesTo}</span>
                  </div>
                  {searching || k.noFolders
                    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{mine.map(it => <React.Fragment key={it.id}>{row(it)}</React.Fragment>)}</div>
                    : <FolderableList scopeKey={k.folderScope} color={tk.accent.base} items={mine.map(it => ({ ...it, label: it.name }))}
                        sortItems={l => [...l].sort((a, b) => a.label.localeCompare(b.label))} renderItem={it => row(it)} />}
                </div>
              );
            })}
          </div>
        );
      })}
      {/* The built-in effects (groups you can open), as the old Presets tab offered them. */}
      {builtIns.length > 0 && (
        <div data-preset-builtins="group">
          <button type="button" onClick={() => setOpenBuiltIns(o => !o)} aria-expanded={openBuiltIns || searching}
            style={{ height: 30, width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 12px ${fontFamily.ui}` }}>
            <Icon name={openBuiltIns || searching ? 'chevD' : 'chevR'} size={14} />Built-in effects
            <span style={{ fontSize: 11, color: tk.text.faint, fontWeight: 500 }}>{builtIns.length}</span>
          </button>
          {(openBuiltIns || searching) && <div style={{ paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {builtIns.map(b => {
              const c = COMPOUND_EFFECTS.find(x => x.id === b.id)!;
              return <ItemRow key={b.id} label={b.name} icon="presets" color={tk.accent.base} hint={b.hint}
                drag={{ label: b.name, place: pos => actions.placeCompound(c.id, pos) }} onDragDone={actions.done}
                onClick={() => setPicked(p => (p === b.id ? null : b.id))} onDoubleClick={() => actions.placeCompound(c.id)}
                preview={<SavedItemPreview name={b.name} kind="Group" signature="built in · a group you can open" comment={b.hint} onAdd={() => actions.placeCompound(c.id)} />}
                selected={picked === b.id} />;
            })}
          </div>}
        </div>
      )}
    </div>
  );
}

// ── Media ────────────────────────────────────────────────────────────────────

function MediaList({ query }: { query: string }) {
  const tk = useTokens();
  const { images } = useBackgroundImages();
  const { videos } = useLibraryVideos();
  const rows = [
    ...(images ?? []).map(m => ({ id: m.id, name: m.name, thumb: m.thumb, what: 'Picture' })),
    ...(videos ?? []).map(m => ({ id: m.id, name: m.name, thumb: (m as { thumb?: string }).thumb, what: isAudioType(m.type) ? 'Sound' : 'Video' })),
  ].filter(r => !query || r.name.toLowerCase().includes(query));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <Button size="sm" icon="overlay" onClick={() => { void openBackgrounds(); }} title="Pictures, palettes, videos and sounds: folders, rename, download, delete, clean up">Manage media…</Button>
      </div>
      {rows.length === 0 && <EmptyHint>{query ? 'Nothing matches.' : 'Pictures, videos and sounds you add (Backgrounds, Video layers, samples) show here.'}</EmptyHint>}
      {rows.map(r => (
        <ItemRow key={r.id} label={r.name} icon={r.what === 'Sound' ? 'wave' : 'overlay'} color={tk.accent.base} tag={r.what}
          thumb={r.thumb ? <img src={r.thumb} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} /> : undefined}
          onClick={() => { void openBackgrounds(); }} />
      ))}
    </div>
  );
}

// ── Rows and their actions ───────────────────────────────────────────────────

interface ItemActions {
  open: (it: LibraryItem, pos?: { x: number; y: number }) => void;
  /** Whether it has a preview card (placed by double-click, Add or drag). */
  places: (it: LibraryItem) => boolean;
  place: (it: LibraryItem, pos?: { x: number; y: number }) => string | null;
  addNodeType: (id: string, pos?: { x: number; y: number }) => string | null;
  placeCompound: (id: string, pos?: { x: number; y: number }) => string | null;
  remove: (it: LibraryItem) => void;
  exportOne: (it: LibraryItem) => void;
  edit?: (it: LibraryItem) => (() => void) | undefined;
  done: () => void;
}

function useItemActions(onOpened: (() => void) | undefined, setPublish: (p: { source: PublishSource; id: string } | null) => void): ItemActions {
  const done = () => onOpened?.();
  const place = (it: LibraryItem, pos = spawnPoint()): string | null => {
    const st = useNodeGraphStore.getState();
    const r = it.record ?? {};
    let id: string | null | undefined = null;
    switch (it.kind) {
      case 'customFn': { const p = r as unknown as CustomFnPreset; id = st.addNode('customFn', pos, { label: p.label, inputs: p.inputs, outputType: p.outputType, body: p.body, glslFunctions: p.glslFunctions, ...(p.comment ? { __comment: p.comment } : {}) }); break; }
      case 'expr': id = st.addNode('exprNode', pos, exprPresetParams(r as unknown as ExprPreset)); break;
      case 'transform': { const p = r as unknown as TransformPreset; id = st.addNode('transformVec', pos, { outputType: p.outputType, exprX: p.exprX, exprY: p.exprY, exprZ: p.exprZ, exprW: p.exprW, ...(p.comment ? { __comment: p.comment } : {}) }); break; }
      case 'group': id = st.instantiateGroupPreset(it.id, pos); break;
      default: return null;
    }
    done();
    return id ?? null;
  };
  const open = (it: LibraryItem, pos?: { x: number; y: number }) => {
    const st = useNodeGraphStore.getState();
    if (it.type === 'graphs') { if (reportFileResult(st.loadSavedGraph(it.id), { failTitle: `Couldn’t open “${it.name}”` })) done(); return; }
    if (it.type === 'shaders') { openShaderItem(it); done(); return; }
    if (it.type === 'nodes') { addNodeType(it.id, pos); return; }
    if (it.kind === 'keyframe') {
      window.dispatchEvent(new CustomEvent('apply-keyframe-preset', { detail: { keyframes: (it.record as unknown as KeyframePreset).keyframes } }));
      return;
    }
    if (it.kind === 'layerSet' || it.kind === 'rackPreset') {
      void import('../play/presetsUi').then(m => {
        if (it.kind === 'layerSet') m.addLayerSetToPlay(it.record as unknown as LayerSet);
        else m.applyRackPresetToPlay(it.record as unknown as RackPreset);
        requestPage('play');
        done();
      });
      return;
    }
    place(it, pos);
  };
  const places = (it: LibraryItem) => it.kind === 'customFn' || it.kind === 'expr' || it.kind === 'transform' || it.kind === 'group';
  const placeCompound = (id: string, pos = spawnPoint()): string | null => {
    const c = COMPOUND_EFFECTS.find(x => x.id === id);
    if (!c) return null;
    const made = useNodeGraphStore.getState().placeSubgraphAsGroup(c.label, compoundSubgraph(c), pos, c.description);
    done();
    return made;
  };
  const addNodeType = (id: string, pos?: { x: number; y: number }): string | null => {
    const made = useNodeGraphStore.getState().addNode(id, pos ?? spawnPoint(id));
    done();
    return made ?? null;
  };
  const remove = async (it: LibraryItem) => {
    if (it.type === 'nodes' && !(await askConfirm(`Delete node type “${it.name}”?`, { message: 'Placed instances stop compiling until it is back.', confirmLabel: 'Delete', danger: true }))) return;
    const { result, undo } = deleteItem(it);
    if (!result.ok) { toast.error('Couldn’t delete it', { message: result.error }); return; }
    let undone = false;
    toast.success(`Deleted “${it.name}”`, { action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; undo(); } } });
  };
  const exportOne = async (it: LibraryItem) => {
    if (it.type === 'nodes') { reportFileResult(await useNodeGraphStore.getState().exportUserNodes([it.id]), { failTitle: `Couldn’t export “${it.name}”` }); return; }
    reportFileResult(await saveTextFile(exportText([it]), `${safeFile(it.name)}.library.json`), { failTitle: `Couldn’t export “${it.name}”`, success: `Exported “${it.name}”` });
  };
  const edit = (it: LibraryItem) => {
    if (it.type !== 'nodes') return undefined;
    const d = it.record as unknown as UserNodeDefinition;
    if (!d.source) return undefined;
    return () => {
      if (d.source?.kind === 'code') { setPublish({ id: d.id, source: { kind: 'code', code: d.source.code, entry: d.source.entry, label: d.label } }); return; }
      if (useNodeGraphStore.getState().openUserNodeSource(d.id, spawnPoint())) done();
    };
  };
  return { open, place, addNodeType, places, placeCompound, remove: it => { void remove(it); }, exportOne: it => { void exportOne(it); }, edit, done };
}

function LibraryRow({ item, color, selected, onSelect, onRename, actions }: { item: LibraryItem; color: string; selected: boolean; onSelect: () => void; onRename: () => void; actions: ItemActions }) {
  const savedGraphHasPlay = useNodeGraphStore(s => s.savedGraphHasPlay);
  const currentName = useNodeGraphStore(s => s.currentGraph?.name);
  const kind = item.kind ? presetKind(item.kind) : undefined;
  const icon: IconName = item.type === 'presets' ? (item.kind === 'transform' ? 'layout' : 'presets') : TYPE_ICON[item.type];
  const fnThumb = item.kind === 'customFn' ? <FnThumbnail preset={item.record as unknown as CustomFnPreset} size={22} /> : undefined;
  const picture = item.thumb ? <img src={item.thumb} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} /> : fnThumb;
  const common = { label: item.name, icon, color, thumb: picture, onRename, onDelete: () => actions.remove(item), onExport: () => actions.exportOne(item) } as const;
  if (item.type === 'graphs') {
    return <ItemRow {...common} tag={savedGraphHasPlay(item.id) ? 'Play' : undefined} selected={currentName === item.id}
      extra={<><GraphLinkBadge graph={item.id} compact /><VersionsButton name={item.id} onOpened={actions.done} /></>}
      onClick={() => actions.open(item)} />;
  }
  if (actions.places(item)) {
    const r = item.record ?? {};
    const signature = item.kind === 'customFn' ? signatureOf(item.name, String(r.outputType), (r.inputs as Array<{ name: string; type: string }>) ?? [])
      : item.kind === 'expr' ? `${signatureOf(item.name, String(r.outputType), (r.inputs as Array<{ name: string; type: string }>) ?? [])} = ${String(r.result ?? '')}`
      : item.kind === 'transform' ? `${String(r.outputType)}(${[r.exprX, r.exprY, r.outputType !== 'vec2' ? r.exprZ : null, r.outputType === 'vec4' ? r.exprW : null].filter(Boolean).join(', ')})`
      : item.kind === 'group' ? (() => { const sg = r.subgraph as { nodes?: unknown[]; inputPorts?: unknown[]; outputPorts?: unknown[] } | undefined; return `${sg?.nodes?.length ?? 0} nodes · ${sg?.inputPorts?.length ?? 0} in · ${sg?.outputPorts?.length ?? 0} out`; })() : undefined;
    const dragType = item.kind === 'customFn' ? 'customFn' : item.kind === 'expr' ? 'exprNode' : item.kind === 'transform' ? 'transformVec' : undefined;
    return <ItemRow {...common} selected={selected} onClick={onSelect} onDoubleClick={() => actions.open(item)}
      drag={{ label: item.name, ...(dragType ? { type: dragType } : {}), place: pos => actions.place(item, pos) }} onDragDone={actions.done}
      preview={<SavedItemPreview name={item.name} kind={kind?.appliesTo ?? item.type} signature={signature} comment={item.hint}
        picture={item.kind === 'customFn' ? <FnThumbnail preset={item.record as unknown as CustomFnPreset} size={56} radius={radius.md} /> : undefined}
        onAdd={() => actions.open(item)} />} />;
  }
  if (item.type === 'nodes') {
    const sealed = !!(item.record as { sealed?: unknown } | undefined)?.sealed;
    return <ItemRow {...common} tag={sealed ? 'Sealed' : undefined}
      drag={{ label: item.name, type: item.id, place: pos => actions.addNodeType(item.id, pos) }} onDragDone={actions.done}
      onClick={() => actions.open(item)} onEdit={actions.edit?.(item)} editLabel={(item.record as unknown as UserNodeDefinition)?.source?.kind === 'code' ? 'Edit the GLSL (publish again to update)' : 'Open source graph (publish again to update)'} />;
  }
  if (item.type === 'shaders') return <ItemRow {...common} hint={item.hint ? `${item.hint} · opens on the Code page` : 'Opens on the Code page'} onClick={() => actions.open(item)} />;
  if (item.kind === 'keyframe') return <ItemRow {...common} hint="Click to apply it to the open keyframe editor" onClick={() => actions.open(item)} />;
  if (item.kind === 'layerSet' || item.kind === 'rackPreset') return <ItemRow {...common} hint={`${item.hint ? `${item.hint} · ` : ''}click to add it to Play`} onClick={() => actions.open(item)} />;
  // The rest load where they belong (a builder's strip, the Finish stack, a Palette node).
  return <ItemRow {...common} hint={`${item.hint ? `${item.hint} · ` : ''}load it from ${kind?.appliesTo ?? 'where it was saved'}`} selected={selected} onClick={onSelect}
    preview={<UsedIn name={item.name} where={kind?.appliesTo ?? ''} hint={item.hint} />} />;
}

/** A preset that loads elsewhere: where it is used. */
function UsedIn({ name, where, hint }: { name: string; where: string; hint?: string }) {
  const tk = useTokens();
  return (
    <div style={{ margin: '4px 2px 8px', padding: '9px 12px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: tk.text.secondary }}>
      <b style={{ color: tk.text.primary, fontSize: 13, overflowWrap: 'anywhere' }}>{name}</b>
      {hint && <span>{hint}</span>}
      <span style={{ color: tk.text.faint }}>Load it from {where}: its presets list it there too.</span>
    </div>
  );
}

/** A small count line used by other surfaces: "12 graphs · 4 presets". */
export function librarySummaryLine(data: Record<LibraryType, LibraryItem[]>): string {
  return LIBRARY_TYPES.filter(t => data[t.id].length).map(t => plural(data[t.id].length, t.one)).join(' · ') || 'Nothing saved yet';
}

