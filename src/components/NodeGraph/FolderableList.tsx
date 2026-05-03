import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderEntry,
  loadFolders,
  getMembership,
  createFolder,
  renameFolder,
  deleteFolder,
  toggleFolderCollapsed,
  moveItemsToFolder,
  removeItemsFromFolders,
} from '../../utils/assetFolders';
import { AssetContextMenu, ContextMenuItem } from './AssetContextMenu';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderableItem {
  id: string;
  label: string;
}

interface FolderableListProps<T extends FolderableItem> {
  scopeKey: string;
  color: string;
  items: T[];
  /** Just render the pill — FolderableList handles drag/selection/context-menu wrapping. */
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  emptyHint?: React.ReactNode;
}

// ── Context menu target ───────────────────────────────────────────────────────

type MenuTarget =
  | { kind: 'panel' }
  | { kind: 'item';   id: string }
  | { kind: 'folder'; id: string };

interface MenuState { x: number; y: number; target: MenuTarget }

// ── Main component ────────────────────────────────────────────────────────────

export function FolderableList<T extends FolderableItem>({
  scopeKey, color, items, renderItem, emptyHint,
}: FolderableListProps<T>) {
  const [folders,    setFolders]    = useState<FolderEntry[]>(() => loadFolders(scopeKey));
  const [membership, setMembership] = useState<Record<string, string>>(() => getMembership(scopeKey));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setFolders(loadFolders(scopeKey));
    setMembership(getMembership(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    window.addEventListener('assetbrowser-folders-changed', refresh);
    return () => window.removeEventListener('assetbrowser-folders-changed', refresh);
  }, [refresh]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedIds(new Set()); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Context menu ──────────────────────────────────────────────────────────

  function openMenu(e: React.MouseEvent, target: MenuTarget) {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  function buildMenuItems(target: MenuTarget): ContextMenuItem[] {
    if (target.kind === 'panel') {
      return [{ label: '📁  New Folder', action: promptNewFolder }];
    }

    if (target.kind === 'folder') {
      const fid = target.id;
      return [
        { label: 'Rename Folder', action: () => setRenamingFolderId(fid) },
        { label: 'Delete Folder', destructive: true, separator: true,
          action: () => { deleteFolder(scopeKey, fid); refresh(); } },
      ];
    }

    // item (or multi-item)
    const effectiveIds =
      selectedIds.size > 1 && selectedIds.has(target.id)
        ? [...selectedIds]
        : [target.id];
    const inFolder = effectiveIds.some(id => !!membership[id]);
    const moveLabel = effectiveIds.length > 1
      ? `Move ${effectiveIds.length} items to Folder…`
      : 'Move to Folder…';
    const items2: ContextMenuItem[] = [
      { label: moveLabel, action: () => promptMoveToFolder(effectiveIds) },
    ];
    if (inFolder) items2.push({
      label: effectiveIds.length > 1 ? 'Remove from Folders' : 'Remove from Folder',
      destructive: true,
      action: () => { removeItemsFromFolders(scopeKey, effectiveIds); refresh(); },
    });
    return items2;
  }

  function promptNewFolder() {
    const label = window.prompt('Folder name:');
    if (label?.trim()) { createFolder(scopeKey, label.trim()); refresh(); }
  }

  function promptMoveToFolder(ids: string[]) {
    if (folders.length === 0) {
      const label = window.prompt('No folders yet — enter a name to create one:');
      if (label?.trim()) {
        const f = createFolder(scopeKey, label.trim());
        moveItemsToFolder(scopeKey, ids, f.id);
        refresh();
      }
      return;
    }
    const choices = folders.map((f, i) => `${i + 1}. ${f.label}`).join('\n');
    const input = window.prompt(
      `Move to folder:\n${choices}\n\nEnter number — or type a name to create a new folder:`
    );
    if (!input?.trim()) return;
    const n = parseInt(input.trim(), 10);
    const target = (!isNaN(n) && n >= 1 && n <= folders.length)
      ? folders[n - 1]
      : createFolder(scopeKey, input.trim());
    moveItemsToFolder(scopeKey, ids, target.id);
    refresh();
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, itemId: string) {
    const ids = selectedIds.size > 1 && selectedIds.has(itemId)
      ? [...selectedIds] : [itemId];
    e.dataTransfer.setData('application/shader-studio-folder',
      JSON.stringify({ scopeKey, ids }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function parseDrop(e: React.DragEvent): string[] | null {
    const raw = e.dataTransfer.getData('application/shader-studio-folder');
    if (!raw) return null;
    try {
      const { scopeKey: src, ids } = JSON.parse(raw) as { scopeKey: string; ids: string[] };
      return src === scopeKey ? ids : null;
    } catch { return null; }
  }

  // ── Item wrapper ─────────────────────────────────────────────────────────

  function ItemWrapper({ item }: { item: T }) {
    const selected = selectedIds.has(item.id);
    return (
      <div
        draggable
        onDragStart={e => handleDragStart(e, item.id)}
        onMouseDown={e => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          }
        }}
        onContextMenu={e => openMenu(e, { kind: 'item', id: item.id })}
        style={{
          outline: selected ? `2px solid ${color}66` : 'none',
          borderRadius: '20px',
          cursor: 'grab',
        }}
      >
        {renderItem(item, selected)}
      </div>
    );
  }

  const itemsInFolder = (fid: string) => items.filter(i => membership[i.id] === fid);
  const ungrouped     = items.filter(i => !membership[i.id]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={panelRef}
      style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
    >
      {items.length === 0 && folders.length === 0 && emptyHint}

      {/* Folders */}
      {folders.map(folder => {
        const children = itemsInFolder(folder.id);
        const isTarget = dropTargetId === folder.id;
        const isRenaming = renamingFolderId === folder.id;
        return (
          <div key={folder.id}>
            <div
              onDragOver={e => { e.preventDefault(); setDropTargetId(folder.id); }}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={e => {
                e.preventDefault(); setDropTargetId(null);
                const ids = parseDrop(e);
                if (ids) { moveItemsToFolder(scopeKey, ids, folder.id); refresh(); }
              }}
              onContextMenu={e => openMenu(e, { kind: 'folder', id: folder.id })}
              onClick={e => { if (!isRenaming) { e.stopPropagation(); toggleFolderCollapsed(scopeKey, folder.id); refresh(); } }}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 6px', borderRadius: '5px',
                background: isTarget ? `${color}18` : 'transparent',
                border: isTarget ? `1px dashed ${color}88` : '1px solid transparent',
                cursor: 'pointer', userSelect: 'none',
                transition: 'background 0.1s, border-color 0.1s',
              }}
            >
              <span style={{ fontSize: '9px', color: `${color}aa`, display: 'inline-block', transform: folder.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
              {isRenaming ? (
                <input
                  autoFocus
                  defaultValue={folder.label}
                  onBlur={e => { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingFolderId(null); refresh(); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingFolderId(null); refresh(); }
                    if (e.key === 'Escape') setRenamingFolderId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ background: '#11111b', border: `1px solid ${color}`, color, borderRadius: '4px', padding: '1px 6px', fontSize: '11px', outline: 'none', flex: 1, minWidth: 0 }}
                />
              ) : (
                <span style={{ fontSize: '11px', color, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📁 {folder.label}
                </span>
              )}
              <span style={{ fontSize: '9px', color: `${color}66`, flexShrink: 0 }}>{children.length}</span>
            </div>
            {!folder.collapsed && (
              <div style={{ paddingLeft: '12px', paddingTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {children.length === 0
                  ? <span style={{ fontSize: '10px', color: '#45475a', fontStyle: 'italic' }}>Empty — drag items here</span>
                  : children.map(item => <ItemWrapper key={item.id} item={item} />)
                }
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped items */}
      {ungrouped.length > 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDropTargetId('ungrouped'); }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={e => {
            e.preventDefault(); setDropTargetId(null);
            const ids = parseDrop(e);
            if (ids) { removeItemsFromFolders(scopeKey, ids); refresh(); }
          }}
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px',
            paddingTop: folders.length > 0 ? '4px' : '0',
            borderTop: folders.length > 0 ? `1px solid ${dropTargetId === 'ungrouped' ? `${color}44` : '#252535'}` : 'none',
            transition: 'border-color 0.1s',
          }}
        >
          {ungrouped.map(item => <ItemWrapper key={item.id} item={item} />)}
        </div>
      )}

      {/* Drop zone for removing from folders (when all items are in folders) */}
      {ungrouped.length === 0 && folders.length > 0 && items.length > 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDropTargetId('ungrouped'); }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={e => {
            e.preventDefault(); setDropTargetId(null);
            const ids = parseDrop(e);
            if (ids) { removeItemsFromFolders(scopeKey, ids); refresh(); }
          }}
          style={{
            padding: '6px', borderRadius: '5px',
            border: `1px dashed ${dropTargetId === 'ungrouped' ? `${color}88` : '#313244'}`,
            fontSize: '10px', color: '#45475a', textAlign: 'center', fontStyle: 'italic',
            transition: 'border-color 0.1s',
          }}
        >
          Drop here to remove from folder
        </div>
      )}

      {/* Spacer for right-click on empty panel space */}
      <div
        onContextMenu={e => openMenu(e, { kind: 'panel' })}
        onClick={() => setSelectedIds(new Set())}
        style={{ flexGrow: 1, minHeight: '12px' }}
      />

      {/* Context menu */}
      {menu && (
        <AssetContextMenu
          x={menu.x} y={menu.y}
          items={buildMenuItems(menu.target)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}
