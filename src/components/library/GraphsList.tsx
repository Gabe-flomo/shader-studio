/**
 * GraphsList — the top bar's Load menu (docs/library.md, "Load"): your saved graphs and nothing
 * else, newest worked-on first and in your folders, with one search; click opens one. Each row
 * keeps its graph actions (versions, linked presentations, export, rename, delete with Undo), and
 * the import button brings graph files in. The bundled examples sit under it (the host's footer).
 */
import React, { useEffect, useState } from 'react';
import '../../library/appLibrary';
import { deleteItem, exportText, libraryEvents, listLibrary, renameItem, type LibraryItem } from '../../library/libraryFacade';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { groupByTime, lastWorkedOn, sortByRecent } from '../../store/graphRecency';
import { useTokens } from '../../theme/themeStore';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { FolderableList } from '../NodeGraph/FolderableList';
import { VersionsButton } from '../shell/GraphVersions';
import { GraphLinkBadge } from '../shell/GraphLinks';
import { reportFileResult } from '../shell/reportFileResult';
import { saveTextFile } from '../../utils/fileIO';
import { EmptyHint, ItemRow, RenameField } from './ItemRow';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const safeFile = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 60) || 'graph';

/** The saved graphs, kept current as they are saved, renamed or removed anywhere. */
function useGraphs(): LibraryItem[] {
  const [list, setList] = useState(() => listLibrary('graphs'));
  useEffect(() => {
    const on = () => setList(listLibrary('graphs'));
    const evs = libraryEvents();
    for (const ev of evs) window.addEventListener(ev, on);
    window.addEventListener('storage', on);
    return () => { for (const ev of evs) window.removeEventListener(ev, on); window.removeEventListener('storage', on); };
  }, []);
  return list;
}

export function GraphsList({ onOpened, footer }: { onOpened?: () => void; footer?: React.ReactNode }) {
  const tk = useTokens();
  const graphs = useGraphs();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const savedGraphHasPlay = useNodeGraphStore(s => s.savedGraphHasPlay);
  const currentName = useNodeGraphStore(s => s.currentGraph?.name);
  const importGraphsBulk = useNodeGraphStore(s => s.importGraphsBulk);
  const color = tk.status.success;
  const q = query.trim().toLowerCase();
  const shown = q ? graphs.filter(g => g.name.toLowerCase().includes(q)) : graphs;

  const open = (it: LibraryItem) => { if (reportFileResult(useNodeGraphStore.getState().loadSavedGraph(it.id), { failTitle: `Couldn’t open “${it.name}”` })) onOpened?.(); };
  const remove = (it: LibraryItem) => {
    const { result, undo } = deleteItem(it);
    if (!result.ok) { toast.error('Couldn’t delete it', { message: result.error }); return; }
    let undone = false;
    toast.success(`Deleted “${it.name}”`, { action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; undo(); } } });
  };
  const exportOne = async (it: LibraryItem) => {
    reportFileResult(await saveTextFile(exportText([it]), `${safeFile(it.name)}.library.json`), { failTitle: `Couldn’t export “${it.name}”`, success: `Exported “${it.name}”` });
  };
  const importGraphs = async (mode: 'files' | 'folder') => {
    const r = await importGraphsBulk(mode);
    if (!r.ok) { reportFileResult(r, { failTitle: 'Couldn’t import graphs' }); return; }
    const n = r.imported?.length ?? 0;
    const skipped = r.skipped?.length ?? 0;
    toast.success(`Imported ${plural(n, 'graph')}`, { message: skipped ? `${plural(skipped, 'file')} skipped (${r.skipped![0].reason}).` : undefined });
  };

  const row = (it: LibraryItem) => renaming?.id === it.id
    ? <RenameField value={renaming.value} onChange={v => setRenaming({ id: it.id, value: v })}
        onCommit={() => { const r = renameItem(it, renaming.value); if (!r.ok) toast.error('Couldn’t rename it', { message: r.error }); setRenaming(null); }}
        onCancel={() => setRenaming(null)} />
    : <ItemRow label={it.name} icon="graphs" color={color} tag={savedGraphHasPlay(it.id) ? 'Play' : undefined} selected={currentName === it.id}
        extra={<><GraphLinkBadge graph={it.id} compact /><VersionsButton name={it.id} onOpened={onOpened} /></>}
        onClick={() => open(it)} onRename={() => setRenaming({ id: it.id, value: it.name })} onDelete={() => remove(it)} onExport={() => { void exportOne(it); }} />;

  return (
    <div data-graphs-list="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Field aria-label="Search saved graphs" placeholder="Search saved graphs…" value={query} onChange={e => setQuery(e.target.value)} height={30}
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />} style={{ flex: 1, minWidth: 0 }} />
        <IconButton icon="import" label="Import graphs" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setImportMenu({ x: r.left, y: r.bottom + 4 }); }} />
      </div>
      {graphs.length === 0 && <EmptyHint>No saved graphs yet. Save the graph (⌘S) to keep it here.</EmptyHint>}
      {graphs.length > 0 && shown.length === 0 && <EmptyHint>No saved graph matches “{query}”.</EmptyHint>}
      {shown.length > 0 && (q
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{sortByRecent(shown, i => lastWorkedOn(i.id), i => i.name).map(it => <React.Fragment key={it.id}>{row(it)}</React.Fragment>)}</div>
        : <FolderableList scopeKey="graphs" color={color} items={shown.map(it => ({ ...it, label: it.name }))} foldersLast
            groupLoose={l => groupByTime(l, i => lastWorkedOn(i.id), i => i.label)} sortItems={l => sortByRecent(l, i => lastWorkedOn(i.id), i => i.label)}
            renderItem={it => row(it)} />)}
      {footer}
      {importMenu && <Menu x={importMenu.x} y={importMenu.y} minWidth={240} onClose={() => setImportMenu(null)} items={[
        { label: 'Graph files…', icon: 'graphs', hint: 'Several graph files (or .play files) at once', onSelect: () => { void importGraphs('files'); } },
        { label: 'A folder of graphs…', icon: 'folder', hint: 'Its folders are recreated here', onSelect: () => { void importGraphs('folder'); } },
      ]} />}
    </div>
  );
}
