/**
 * AddLayerMenu — the Layers tab's Add layer menu. A search field on top, then
 * Playfield layers (the built-ins in groups) and Your layers (kinds you saved,
 * in folders of your own). Groups open and close and remember it per browser;
 * searching looks through every group and opens the ones that match.
 *
 * On a desktop it drops down under the button; on a phone it is a sheet. Both
 * keep their height in bounds and scroll inside. ↑/↓ and Enter work from the
 * search field.
 *
 * The data (groups, folders, search) is in addLayerCatalog.ts; what the kind
 * menu does is shared with the Kind card through kindActions.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { accentColor } from '../../../theme/categories';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { PlayLayerKind, PlayRecord } from '../../../types/play';
import type { LayerKindDef } from '../../../types/layerKinds';
import { addableKinds, kindHint, kindUses, useInstalledKinds } from '../../../play/layerKinds';
import { createFolder, deleteFolder, getMembership, loadFolders, moveItemsToFolder, removeItemsFromFolders, renameFolder, toggleFolderCollapsed, type FolderEntry } from '../../../utils/assetFolders';
import { askConfirm, askText, useDialogStore } from '../../ui/dialogStore';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Sheet } from '../../ui/Sheet';
import { portalGuard } from '../../ui/portalGuard';
import { KindDialog } from './KindDialog';
import { addKindToList, applyKindLook, removeKindFromFile, removeKindFromList } from './kindActions';
import { useLayerSets } from '../presetsUi';
import { setSummary, type LayerSet } from '../../../play/layerSets';
import { builtinGroups, builtinKey, LAYER_KIND_FOLDER_SCOPE, type BuiltinVariant, loadClosed, saveClosed, yourLayers, type KindEntry } from './addLayerCatalog';

const WIDTH = 340;
const SEARCH_H = 48;
const DRAG_TYPE = 'application/x-playfield-layer-kind';

type Row = { key: string; label: string; hint: string; icon: IconName; iconColor?: string; onAdd: () => void; entry?: KindEntry };

function useFolders() {
  const read = () => {
    try { return { folders: loadFolders(LAYER_KIND_FOLDER_SCOPE), membership: getMembership(LAYER_KIND_FOLDER_SCOPE) }; } catch { return { folders: [] as FolderEntry[], membership: {} as Record<string, string> }; }
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener('assetbrowser-folders-changed', on);
    return () => window.removeEventListener('assetbrowser-folders-changed', on);
  }, []);
  return state;
}

/** assetFolders writes to localStorage and can throw when it is blocked. */
const safely = (fn: () => void) => { try { fn(); } catch { /* storage blocked */ } };

export function AddLayerMenu({ play, touch, anchorRef, onAdd, onAddKind, onAddSet, onChange, onClose }: {
  play: PlayRecord;
  /** Phone layout: a bottom sheet with bigger rows. */
  touch: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onAdd: (kind: PlayLayerKind, variant?: BuiltinVariant) => void;
  onAddKind: (def: LayerKindDef) => void;
  /** Add a saved layer set (docs/presets.md). */
  onAddSet?: (set: LayerSet) => void;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const installed = useInstalledKinds();
  const { folders, membership } = useFolders();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState(loadClosed);
  const [active, setActive] = useState<string | null>(null);
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number; entry: KindEntry; move?: boolean } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: FolderEntry } | null>(null);
  const [restyling, setRestyling] = useState<KindEntry | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const hostDialog = useDialogStore(s => s.current);
  const busy = !!(kindMenu || folderMenu || restyling || hostDialog);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searching = !!query.trim();

  // ── What to show ──────────────────────────────────────────────────────────
  const kinds = useMemo(() => addableKinds(play, installed), [play, installed]);
  const listed = useMemo(() => new Set(installed.map(k => k.def.id)), [installed]);
  const builtins = builtinGroups(query);
  const yours = yourLayers(kinds, folders, membership, query);
  const builtinTotal = builtins.reduce((n, g) => n + (searching ? g.items.length : g.total), 0);
  const yoursCount = searching ? yours.loose.length + yours.folders.reduce((n, g) => n + g.items.length, 0) : kinds.length;

  // Layer sets: groups of layers saved with their controls, mappings and actions.
  const allSets = useLayerSets();
  const sets = useMemo(() => {
    const t = query.trim().toLowerCase();
    return (onAddSet ? allSets : []).filter(x => !t || x.name.toLowerCase().includes(t) || (x.note ?? '').toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name));
  }, [allSets, query, onAddSet]);
  const setRow = (x: LayerSet): Row => ({ key: `set:${x.id}`, label: x.name, hint: [setSummary(x.play), x.note?.split('\n')[0]].filter(Boolean).join(' · '), icon: 'layers', onAdd: () => onAddSet?.(x) });

  const isOpen = (key: string) => searching || !closed[key];
  const folderOpen = (f: FolderEntry) => searching || !f.collapsed;
  const toggle = (key: string) => setClosed(c => { const next = { ...c, [key]: !c[key] }; if (!next[key]) delete next[key]; saveClosed(next); return next; });

  const kindRow = (e: KindEntry): Row => ({
    key: `k:${e.def.id}`, label: e.def.name, icon: e.def.icon, iconColor: accentColor(e.def.colour, mode),
    hint: `${kindHint(e.def.hint, e.def.paramDefs.length)}${listed.has(e.def.id) ? '' : ' · only in this file'}`,
    onAdd: () => onAddKind(e.def), entry: e,
  });
  // The rows you can reach with the keyboard, in the order they are drawn.
  const visible: Row[] = [];
  if (isOpen('section:builtin')) for (const g of builtins) if (isOpen(g.key)) for (const b of g.items) visible.push({ key: builtinKey(b), label: b.label, hint: b.hint, icon: b.icon, onAdd: () => onAdd(b.kind, b.variant) });
  if (isOpen('section:yours')) {
    for (const g of yours.folders) if (g.folder && folderOpen(g.folder)) for (const e of g.items) visible.push(kindRow(e));
    for (const e of yours.loose) visible.push(kindRow(e));
  }
  if (onAddSet && isOpen('section:sets')) for (const x of sets) visible.push(setRow(x));
  const activeRow = visible.find(r => r.key === active) ?? null;
  const pick = (r: Row) => { r.onAdd(); onClose(); };

  // ── Closing, keys ─────────────────────────────────────────────────────────
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; });
  const onCloseRef = useRef(onClose);
  const queryRef = useRef(query);
  useEffect(() => { onCloseRef.current = onClose; queryRef.current = query; });
  useEffect(() => {
    if (touch) return; // the sheet has its own scrim and Esc
    const onDown = (e: PointerEvent) => {
      if (busyRef.current) return;
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    // Esc clears the search first, then closes.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busyRef.current) return;
      e.stopPropagation();
      if (queryRef.current) { setQuery(''); setActive(null); } else onCloseRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [touch, anchorRef]);

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!visible.length) return;
      const at = activeRow ? visible.indexOf(activeRow) : -1;
      const next = e.key === 'ArrowDown' ? (at + 1) % visible.length : at <= 0 ? visible.length - 1 : at - 1;
      setActive(visible[next].key);
    } else if (e.key === 'Enter') {
      const r = activeRow ?? (searching ? visible[0] : null);
      if (r) { e.preventDefault(); pick(r); }
    }
  };
  useEffect(() => {
    if (!active) return;
    scrollRef.current?.querySelector(`[data-row="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // ── Folders ───────────────────────────────────────────────────────────────
  const newFolder = async (thenMove?: string) => {
    const label = (await askText('New folder', { label: 'Name', initial: '', confirmLabel: 'Create' }))?.trim();
    if (!label) return;
    safely(() => {
      const f = createFolder(LAYER_KIND_FOLDER_SCOPE, label);
      if (thenMove) moveItemsToFolder(LAYER_KIND_FOLDER_SCOPE, [thenMove], f.id);
    });
  };
  const renameF = async (f: FolderEntry) => {
    const label = (await askText('Rename folder', { label: 'Name', initial: f.label, confirmLabel: 'Rename' }))?.trim();
    if (label && label !== f.label) safely(() => renameFolder(LAYER_KIND_FOLDER_SCOPE, f.id, label));
  };
  const deleteF = async (f: FolderEntry) => {
    const n = kinds.filter(k => membership[k.def.id] === f.id).length;
    const ok = n === 0 || await askConfirm(`Delete the folder “${f.label}”?`, { message: `Its ${n} layer kind${n === 1 ? '' : 's'} move back to Your layers. No kind is deleted.`, confirmLabel: 'Delete folder', danger: true });
    if (ok) safely(() => deleteFolder(LAYER_KIND_FOLDER_SCOPE, f.id));
  };
  const moveTo = (id: string, folderId: string | null) => safely(() => { if (folderId) moveItemsToFolder(LAYER_KIND_FOLDER_SCOPE, [id], folderId); else removeItemsFromFolders(LAYER_KIND_FOLDER_SCOPE, [id]); });

  // Desktop: drag a kind onto a folder, or onto Your layers to take it out of one.
  const dropProps = (target: string, folderId: string | null) => touch ? {} : {
    onDragOver: (e: DragEvent) => { if (!e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (dropOn !== target) setDropOn(target); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropOn(d => (d === target ? null : d)); },
    onDrop: (e: DragEvent) => { const id = e.dataTransfer.getData(DRAG_TYPE); e.preventDefault(); e.stopPropagation(); setDropOn(null); if (id) moveTo(id, folderId); },
  };
  const dropStyle = (target: string): CSSProperties => (dropOn === target ? { background: alpha(tk.accent.base, 0.08), boxShadow: `inset 0 0 0 1.5px ${alpha(tk.accent.base, 0.55)}` } : {});

  // ── Menus ─────────────────────────────────────────────────────────────────
  const at = (e: ReactMouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: r.right - 250, y: r.bottom + 4 }; };
  const kindMenuItems = (m: NonNullable<typeof kindMenu>): MenuItem[] => {
    const { entry: e } = m;
    const inList = installed.some(k => k.def.id === e.def.id);
    const folderId = membership[e.def.id] && folders.some(f => f.id === membership[e.def.id]) ? membership[e.def.id] : null;
    if (m.move) return [
      { heading: 'Move to folder' },
      ...folders.map(f => ({ label: f.label, icon: (f.id === folderId ? 'check' : 'folder') as IconName, onSelect: () => moveTo(e.def.id, f.id) })),
      ...(folders.length ? ['separator' as const] : []),
      { label: 'New folder…', icon: 'plus', onSelect: () => { void newFolder(e.def.id); } },
      ...(folderId ? [{ label: 'Out of its folder', icon: 'close' as IconName, onSelect: () => moveTo(e.def.id, null) }] : []),
    ];
    return [
      { label: folderId ? 'Move to another folder…' : 'Move to folder…', icon: 'folder', onSelect: () => setTimeout(() => setKindMenu({ ...m, move: true }), 0) },
      { label: 'Name, icon and colour…', icon: 'edit', onSelect: () => setRestyling(e) },
      'separator',
      inList
        ? { label: e.inFile ? 'Remove from your list' : 'Delete…', icon: e.inFile ? 'minus' : 'trash', danger: !e.inFile, hint: e.inFile ? 'Your other files stop offering it. This file keeps it.' : 'Not used in this file, so it leaves Add layer everywhere.', onSelect: () => { void removeKindFromList(e.def, e.inFile); } }
        : { label: 'Add to your list', icon: 'plus', hint: 'Offer it in Add layer in your other files too.', onSelect: () => addKindToList(e.def) },
      ...(e.inFile ? [{ label: 'Remove from this file…', icon: 'trash' as IconName, danger: true, onSelect: () => { void removeKindFromFile(play, e.def, onChange); } }] : []),
    ];
  };
  const takenNames = (id: string) => [...(play.layerKinds ?? []), ...installed.map(k => k.def)].filter(k => k.id !== id).map(k => k.name);

  // ── Pieces ────────────────────────────────────────────────────────────────
  const rowH = touch ? 44 : 30;
  const caret = (open: boolean) => <Icon name="chevR" size={12} style={{ color: tk.text.faint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', flexShrink: 0 }} />;
  const count = (n: number) => <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{n}</span>;

  const sectionHead = (key: string, title: string, n: number, extra?: ReactNode, drop?: { target: string }) => (
    <div
      {...(drop ? dropProps(drop.target, null) : {})}
      style={{ position: 'sticky', top: SEARCH_H, zIndex: 1, display: 'flex', alignItems: 'center', gap: 4, background: tk.bg.panel, borderTop: `1px solid ${tk.border.subtle}`, ...(drop ? dropStyle(drop.target) : {}) }}
    >
      <button type="button" aria-expanded={isOpen(key)} disabled={searching} onClick={() => toggle(key)}
        style={{ flex: 1, minWidth: 0, height: touch ? 44 : 34, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', border: 0, background: 'transparent', color: tk.text.primary, cursor: searching ? 'default' : 'pointer', textAlign: 'left' }}>
        {caret(isOpen(key))}
        <span style={{ font: `650 12.5px ${fontFamily.ui}` }}>{title}</span>
        {count(n)}
      </button>
      {extra}
    </div>
  );

  const groupHead = (open: boolean, label: string, n: number, onToggle: () => void, icon?: IconName, extra?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button type="button" aria-expanded={open} disabled={searching} onClick={onToggle}
        style={{ flex: 1, minWidth: 0, height: touch ? 38 : 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 14px', border: 0, background: 'transparent', cursor: searching ? 'default' : 'pointer', textAlign: 'left', color: tk.text.muted }}>
        {caret(open)}
        {icon && <Icon name={icon} size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />}
        <span style={icon
          ? { font: `600 12px ${fontFamily.ui}`, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          : { font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase', color: tk.text.faint }}>{label}</span>
        {count(n)}
      </button>
      {extra}
    </div>
  );

  const moreButton = (label: string, onOpen: (e: ReactMouseEvent) => void, show: boolean) => (
    <button type="button" aria-label={label} title={label} onClick={e => { e.stopPropagation(); onOpen(e); }}
      style={{ width: touch ? 40 : 26, height: touch ? 40 : 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.sm, background: 'transparent', color: tk.text.faint, cursor: 'pointer', opacity: show ? 1 : 0 }}
      onFocus={e => { e.currentTarget.style.opacity = '1'; }} onBlur={e => { if (!show) e.currentTarget.style.opacity = '0'; }}>
      <Icon name="more" size={15} />
    </button>
  );

  const row = (r: Row, indent: number) => {
    const on = active === r.key;
    const e = r.entry;
    return (
      <div key={r.key} data-row={r.key} role="none"
        draggable={!!e && !touch}
        onDragStart={e && !touch ? ev => { ev.dataTransfer.setData(DRAG_TYPE, e.def.id); ev.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragEnd={() => setDropOn(null)}
        onMouseEnter={() => setActive(r.key)}
        style={{ display: 'flex', alignItems: 'flex-start', borderRadius: radius.md - 1, background: on ? tk.bg.field : 'transparent', margin: '0 4px' }}>
        <button type="button" role="menuitem" id={`add-layer-${r.key}`} onClick={() => pick(r)} title={r.hint}
          style={{ flex: 1, minWidth: 0, minHeight: rowH, display: 'flex', alignItems: 'flex-start', gap: 9, padding: `${touch ? 9 : 6}px 8px ${touch ? 9 : 6}px ${indent}px`, border: 0, background: 'transparent', color: tk.text.primary, textAlign: 'left', cursor: 'pointer', font: `${touch ? 13.5 : 12.5}px ${fontFamily.ui}` }}>
          <Icon name={r.icon} size={15} style={{ color: r.iconColor ?? tk.text.muted, marginTop: 1, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <span style={{ font: `${touch ? 12 : 11.5}px/1.35 ${fontFamily.ui}`, color: tk.text.faint, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.hint}</span>
          </span>
        </button>
        {e && <span style={{ paddingTop: touch ? 2 : 3, paddingRight: 2 }}>{moreButton(`${e.def.name}: folder, name, icon, colour`, ev => setKindMenu({ ...at(ev), entry: e }), touch || on || kindMenu?.entry.def.id === e.def.id)}</span>}
      </div>
    );
  };

  const empty = (text: ReactNode) => <div style={{ margin: '4px 12px 10px', padding: '10px 12px', borderRadius: radius.md, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.45 ${fontFamily.ui}` }}>{text}</div>;

  const body = (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, height: SEARCH_H, boxSizing: 'border-box', padding: touch ? '4px 0 8px' : '8px 8px 6px', background: tk.bg.panel }}>
        <Field
          aria-label="Search layers" placeholder="Search layers" height={touch ? 36 : 32} value={query} autoFocus={!touch}
          role="combobox" aria-expanded aria-controls="add-layer-list" aria-activedescendant={activeRow ? `add-layer-${activeRow.key}` : undefined}
          leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />}
          suffix={query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setActive(null); }} style={{ display: 'flex', border: 0, padding: 2, background: 'transparent', color: tk.text.faint, cursor: 'pointer' }}><Icon name="close" size={12} /></button> : undefined}
          onChange={e => { setQuery(e.target.value); setActive(null); }}
          onKeyDown={onSearchKey}
        />
      </div>
      <div id="add-layer-list" role="menu" aria-label="Layer kinds" style={{ paddingBottom: 6 }}>
        {(!searching || builtins.length > 0) && (
          <div>
            {sectionHead('section:builtin', 'Playfield layers', builtinTotal)}
            {isOpen('section:builtin') && builtins.map(g => (
              <div key={g.key} style={{ paddingBottom: 2 }}>
                {groupHead(isOpen(g.key), g.label, searching ? g.items.length : g.total, () => toggle(g.key))}
                {isOpen(g.key) && g.items.map(b => row({ key: builtinKey(b), label: b.label, hint: b.hint, icon: b.icon, onAdd: () => onAdd(b.kind, b.variant) }, 30))}
              </div>
            ))}
          </div>
        )}
        {(!searching || yoursCount > 0) && (
          <div {...dropProps('loose', null)} style={{ borderRadius: radius.md, ...dropStyle('loose') }}>
            {sectionHead('section:yours', 'Your layers', yoursCount, !searching && (
              <button type="button" onClick={() => { void newFolder(); }} title="A folder for your layer kinds"
                style={{ display: 'flex', alignItems: 'center', gap: 5, height: touch ? 36 : 26, marginRight: 4, padding: '0 8px', border: 0, borderRadius: radius.sm, background: 'transparent', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer', flexShrink: 0 }}>
                <Icon name="plus" size={12} />New folder
              </button>
            ))}
            {isOpen('section:yours') && (
              <>
                {yours.folders.map(g => {
                  const f = g.folder!;
                  const target = `folder:${f.id}`;
                  return (
                    <div key={g.key} {...dropProps(target, f.id)} style={{ borderRadius: radius.md, margin: '0 4px 2px', ...dropStyle(target) }}>
                      {groupHead(folderOpen(f), g.label, searching ? g.items.length : g.total, () => safely(() => toggleFolderCollapsed(LAYER_KIND_FOLDER_SCOPE, f.id)), 'folder',
                        !searching && moreButton(`Folder ${f.label}: rename, delete`, ev => setFolderMenu({ ...at(ev), folder: f }), true))}
                      {folderOpen(f) && (g.items.length
                        ? g.items.map(e => row(kindRow(e), 30))
                        : <div style={{ padding: '2px 12px 8px 34px', color: tk.text.faint, font: `11.5px/1.4 ${fontFamily.ui}` }}>{touch ? 'Empty. Use a kind’s ⋯ menu, Move to folder.' : 'Empty. Drag a kind here, or use its ⋯ menu.'}</div>)}
                    </div>
                  );
                })}
                {yours.loose.map(e => row(kindRow(e), 12))}
                {!searching && kinds.length === 0 && empty(<>Sketches you save as a kind show up here. Add a <b>Script</b> layer, then press <b>Save as kind</b>.</>)}
              </>
            )}
          </div>
        )}
        {onAddSet && (!searching || sets.length > 0) && (
          <div>
            {sectionHead('section:sets', 'Layer sets', sets.length)}
            {isOpen('section:sets') && (
              <>
                {sets.map(x => row(setRow(x), 12))}
                {!searching && sets.length === 0 && empty(<>Layers saved with their controls, mappings and actions. Pick layers (⇧/⌘-click), then <b>Save as a set…</b></>)}
              </>
            )}
          </div>
        )}
        {searching && visible.length === 0 && builtins.length === 0 && yoursCount === 0 && sets.length === 0 && (
          <div style={{ padding: '18px 12px', textAlign: 'center', color: tk.text.muted, font: `12.5px ${fontFamily.ui}` }}>No layer matches “{query.trim()}”.</div>
        )}
      </div>
    </>
  );

  const overlays = (
    <>
      {kindMenu && <Menu x={kindMenu.x} y={kindMenu.y} minWidth={250} maxWidth={300} onClose={() => setKindMenu(null)} items={kindMenuItems(kindMenu)} />}
      {folderMenu && <Menu x={folderMenu.x} y={folderMenu.y} minWidth={200} onClose={() => setFolderMenu(null)} items={[
        { label: 'Rename…', icon: 'edit', onSelect: () => { void renameF(folderMenu.folder); } },
        { label: 'Delete folder…', icon: 'trash', danger: true, onSelect: () => { void deleteF(folderMenu.folder); } },
      ]} />}
      {restyling && (
        <KindDialog title={`Change “${restyling.def.name}”`} confirmLabel="Save" controls={restyling.def.paramDefs.length} uses={kindUses(play, restyling.def.id)} taken={takenNames(restyling.def.id)}
          initial={{ name: restyling.def.name, hint: restyling.def.hint, icon: restyling.def.icon, colour: restyling.def.colour }}
          onDone={look => { const e = restyling; setRestyling(null); if (look) applyKindLook(e.def, e.inFile, look, onChange); }} />
      )}
    </>
  );

  if (touch) {
    return (
      <>
        <Sheet title="Add layer" onClose={() => { if (!busyRef.current) onClose(); }} maxHeight="min(80dvh, 640px)">
          {/* A steady height, so the sheet does not jump as a search narrows the list. */}
          <div ref={scrollRef} style={{ margin: '0 -8px', minHeight: 'calc(min(80dvh, 640px) - 110px)' }}>{body}</div>
        </Sheet>
        {overlays}
      </>
    );
  }
  return (
    <>
      <DropDown anchorRef={anchorRef} rootRef={rootRef} scrollRef={scrollRef}>{body}</DropDown>
      {overlays}
    </>
  );
}

/** The desktop panel: under the button, its right edge on the button's, as tall as it can be up to min(70vh, 560px). */
function DropDown({ anchorRef, rootRef, scrollRef, children }: { anchorRef: RefObject<HTMLElement | null>; rootRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const tk = useTokens();
  const [pos, setPos] = useState<{ left: number; top: number; room: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const left = Math.max(8, Math.min(a.right - WIDTH, window.innerWidth - WIDTH - 8));
      const top = a.bottom + 6;
      setPos({ left, top, room: Math.max(200, window.innerHeight - top - 8) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);
  return createPortal(
    <div {...portalGuard} ref={rootRef}
      style={{
        position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 1900, width: `min(${WIDTH}px, calc(100vw - 16px))`,
        maxHeight: `min(560px, 70vh, ${pos?.room ?? 560}px)`, display: 'flex', flexDirection: 'column',
        background: tk.bg.panel, color: tk.text.primary, borderRadius: 12, boxShadow: tk.shadow.popover, overflow: 'hidden', font: `12.5px ${fontFamily.ui}`,
      }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>{children}</div>
    </div>,
    document.body,
  );
}
