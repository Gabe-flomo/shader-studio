import React, { useState, useEffect, useCallback } from 'react';
import type { FolderEntry } from '../../utils/assetFolders';
import {
  loadFolders,
  getMembership,
  createFolder,
  renameFolder,
  deleteFolder,
  toggleFolderCollapsed,
  moveItemsToFolder,
  removeItemsFromFolders,
} from '../../utils/assetFolders';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';

export interface FolderableItem { id: string; label: string; }

interface Props<T extends FolderableItem> {
  scopeKey: string;
  color: string;
  items: T[];
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  emptyHint?: React.ReactNode;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function FolderableList<T extends FolderableItem>({
  scopeKey, color, items, renderItem, emptyHint,
}: Props<T>) {
  const tk = useTokens();
  const [folders,     setFolders]    = useState<FolderEntry[]>(() => loadFolders(scopeKey));
  const [membership,  setMembership] = useState<Record<string,string>>(() => getMembership(scopeKey));
  const [selectedIds, setSelected]   = useState<Set<string>>(new Set());
  const [dropTarget,  setDropTarget] = useState<string|null>(null);
  const [creatingFolder, setCreating] = useState(false);
  const [newFolderVal,   setNewFolderVal] = useState('');
  const [renamingId,  setRenamingId]  = useState<string|null>(null);
  // folder context menu
  const [folderMenu, setFolderMenu]  = useState<{x:number;y:number;id:string}|null>(null);
  // "move selected" submenu
  const [moveMenu, setMoveMenu]      = useState<{x:number;y:number;ids:string[]}|null>(null);

  const refresh = useCallback(() => {
    setFolders(loadFolders(scopeKey));
    setMembership(getMembership(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    window.addEventListener('assetbrowser-folders-changed', refresh);
    return () => window.removeEventListener('assetbrowser-folders-changed', refresh);
  }, [refresh]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelected(new Set()); setCreating(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── New folder ────────────────────────────────────────────────────────────
  function startCreating() { setCreating(true); setNewFolderVal(''); }

  function confirmNewFolder() {
    if (newFolderVal.trim()) { createFolder(scopeKey, newFolderVal.trim()); refresh(); }
    setCreating(false); setNewFolderVal('');
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, itemId: string) {
    const ids = selectedIds.size > 1 && selectedIds.has(itemId) ? [...selectedIds] : [itemId];
    e.dataTransfer.setData('application/ssfolder', JSON.stringify({ scopeKey, ids }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function parseDrop(e: React.DragEvent): string[]|null {
    try {
      const raw = e.dataTransfer.getData('application/ssfolder');
      if (!raw) return null;
      const { scopeKey: src, ids } = JSON.parse(raw) as { scopeKey:string; ids:string[] };
      return src === scopeKey ? ids : null;
    } catch { return null; }
  }

  // ── Folder context menu ───────────────────────────────────────────────────
  function buildFolderMenuItems(folderId: string): MenuItem[] {
    return [
      { label: 'Rename', icon: 'edit', onSelect: () => setRenamingId(folderId) },
      'separator',
      { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => { deleteFolder(scopeKey, folderId); refresh(); } },
    ];
  }

  // ── Move-selected submenu ─────────────────────────────────────────────────
  function buildMoveMenuItems(ids: string[]): MenuItem[] {
    const folderItems: MenuItem[] = folders.map(f => ({
      label: f.label,
      icon: 'folder' as const,
      onSelect: () => { moveItemsToFolder(scopeKey, ids, f.id); setSelected(new Set()); refresh(); setMoveMenu(null); },
    }));
    if (folderItems.length > 0) folderItems.push('separator');
    folderItems.push({ label: 'New folder…', icon: 'plus', onSelect: () => { setMoveMenu(null); startCreating(); } });
    return folderItems;
  }

  // ── Selection cmd+click ───────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent, itemId: string) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return next;
      });
    }
  }

  // ── Item wrapper ──────────────────────────────────────────────────────────
  function renderWrapped(item: T) {
    const sel = selectedIds.has(item.id);
    return (
      <div
        key={item.id}
        draggable
        onDragStart={e => handleDragStart(e, item.id)}
        onMouseDown={e => handleMouseDown(e, item.id)}
        style={{ boxShadow: sel ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none', background: sel ? tk.bg.selected : undefined, borderRadius: radius.md, cursor: 'grab' }}
      >
        {renderItem(item, sel)}
      </div>
    );
  }

  const itemsInFolder = (fid: string) => items.filter(i => membership[i.id] === fid);
  const ungrouped     = items.filter(i => !membership[i.id]);
  const isEmpty       = items.length === 0 && folders.length === 0;
  const numSel        = selectedIds.size;

  return (
    // flexShrink 0: when two lists share a scrolling column (Node Builder: saved
    // graphs above My nodes) a long list must push the next section down, not
    // get squashed to its minHeight and spill over it.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, flexShrink: 0, minHeight: 40, font: `12.5px ${fontFamily.ui}` }}
      onClick={e => { if (e.target === e.currentTarget) setSelected(new Set()); }}
    >

      {/* Toolbar: + New Folder button + selection action */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
        <Button size="sm" variant="ghost" icon="plus" title="Create a new folder" onClick={e => { e.stopPropagation(); startCreating(); }}
          style={{ height: 26, padding: '0 8px', color: tk.text.muted }}>Folder</Button>
        {numSel > 0 && (
          <Button
            size="sm"
            title="Move selected items to a folder"
            style={{ height: 26, padding: '0 8px' }}
            onClick={e => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setMoveMenu({ x: rect.left, y: rect.bottom + 4, ids: [...selectedIds] });
            }}
          >Move {numSel} to…</Button>
        )}
      </div>

      {/* Inline new-folder input */}
      {creatingFolder && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 8px' }}
          onClick={e => e.stopPropagation()}
        >
          <Icon name="folder" size={15} style={{ color: tk.text.faint }} />
          <input
            autoFocus
            value={newFolderVal}
            onChange={e => setNewFolderVal(e.target.value)}
            placeholder="Folder name…"
            onKeyDown={e => {
              if (e.key === 'Enter') confirmNewFolder();
              if (e.key === 'Escape') { setCreating(false); }
              e.stopPropagation();
            }}
            onBlur={confirmNewFolder}
            style={{
              flex: 1, minWidth: 0, height: 28, background: tk.bg.panel, border: 0, borderRadius: radius.md - 1,
              boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, padding: '0 8px',
              font: `12.5px ${fontFamily.ui}`, outline: 'none',
            }}
          />
        </div>
      )}

      {isEmpty && !creatingFolder && emptyHint}

      {/* Folders */}
      {folders.map(folder => {
        const children  = itemsInFolder(folder.id);
        const isTarget  = dropTarget === folder.id;
        const isRenaming = renamingId === folder.id;

        return (
          <div key={folder.id}>
            {/* Header */}
            <div
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropTarget(folder.id); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault(); setDropTarget(null);
                const ids = parseDrop(e);
                if (ids) { moveItemsToFolder(scopeKey, ids, folder.id); setSelected(new Set()); refresh(); }
              }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setFolderMenu({ x: e.clientX, y: e.clientY, id: folder.id }); }}
              onClick={e => { if (!isRenaming) { e.stopPropagation(); toggleFolderCollapsed(scopeKey, folder.id); refresh(); } }}
              style={{
                height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: radius.md,
                background: isTarget ? alpha(color, 0.12) : 'transparent',
                boxShadow: isTarget ? `inset 0 0 0 1px ${alpha(color, 0.5)}` : 'none',
                cursor: 'pointer', userSelect: 'none', color: tk.text.secondary, fontWeight: 600,
                transition: 'background 0.1s',
              }}
            >
              <Icon name={folder.collapsed ? 'chevR' : 'chevD'} size={14} style={{ color: tk.text.faint }} />

              {isRenaming ? (
                <input
                  autoFocus
                  defaultValue={folder.label}
                  onBlur={e => { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingId(null); refresh(); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingId(null); refresh(); }
                    if (e.key === 'Escape') setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ flex: 1, minWidth: 0, height: 24, background: tk.bg.panel, border: 0, borderRadius: radius.sm, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, padding: '0 6px', font: `12.5px ${fontFamily.ui}`, outline: 'none' }}
                />
              ) : (
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folder.label}
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 400, color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 6px', flexShrink: 0 }}>{children.length}</span>
            </div>

            {/* Contents */}
            {!folder.collapsed && (
              <div style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {children.length === 0
                  ? <span style={{ fontSize: 12, color: tk.text.faint, padding: '4px 8px' }}>Empty — drag items here</span>
                  : children.map(item => renderWrapped(item))
                }
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped items */}
      {ungrouped.length > 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDropTarget('ungrouped'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={e => {
            e.preventDefault(); setDropTarget(null);
            const ids = parseDrop(e);
            if (ids) { removeItemsFromFolders(scopeKey, ids); setSelected(new Set()); refresh(); }
          }}
          style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            paddingTop: folders.length > 0 ? 6 : 0,
            borderTop: folders.length > 0 ? `1px solid ${dropTarget === 'ungrouped' ? alpha(color, 0.5) : tk.border.subtle}` : 'none',
            transition: 'border-color 0.1s',
          }}
        >
          {ungrouped.map(item => renderWrapped(item))}
        </div>
      )}


      {/* Folder right-click menu */}
      {folderMenu && (
        <Menu x={folderMenu.x} y={folderMenu.y} items={buildFolderMenuItems(folderMenu.id)} onClose={() => setFolderMenu(null)} />
      )}

      {/* Move-selected submenu */}
      {moveMenu && (
        <Menu x={moveMenu.x} y={moveMenu.y} items={buildMoveMenuItems(moveMenu.ids)} onClose={() => setMoveMenu(null)} />
      )}
    </div>
  );
}
