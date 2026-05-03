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
  /** Render the pill. FolderableList handles drag/selection/context-menu wrapping. */
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  emptyHint?: React.ReactNode;
}

type MenuTarget =
  | { kind: 'panel' }
  | { kind: 'item';   id: string }
  | { kind: 'folder'; id: string };

interface MenuState { x: number; y: number; target: MenuTarget }

// ── Main component ────────────────────────────────────────────────────────────

export function FolderableList<T extends FolderableItem>({
  scopeKey, color, items, renderItem, emptyHint,
}: FolderableListProps<T>) {
  const [folders,     setFolders]     = useState<FolderEntry[]>(() => loadFolders(scopeKey));
  const [membership,  setMembership]  = useState<Record<string, string>>(() => getMembership(scopeKey));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu,        setMenu]        = useState<MenuState | null>(null);
  const [dropTargetId, setDropTarget] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolder] = useState<string | null>(null);

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

  const openMenu = useCallback((e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const buildMenuItems = useCallback((target: MenuTarget): ContextMenuItem[] => {
    if (target.kind === 'panel') {
      return [{ label: '📁  New Folder', action: promptNewFolder }];
    }
    if (target.kind === 'folder') {
      const fid = target.id;
      return [
        { label: 'Rename Folder', action: () => setRenamingFolder(fid) },
        { label: 'Delete Folder', destructive: true, separator: true,
          action: () => { deleteFolder(scopeKey, fid); refresh(); } },
      ];
    }
    // item / multi-item
    const effectiveIds =
      selectedIds.size > 1 && selectedIds.has(target.id)
        ? [...selectedIds] : [target.id];
    const inFolder = effectiveIds.some(id => !!membership[id]);
    const result: ContextMenuItem[] = [
      {
        label: effectiveIds.length > 1
          ? `Move ${effectiveIds.length} items to Folder…` : 'Move to Folder…',
        action: () => promptMoveToFolder(effectiveIds),
      },
    ];
    if (inFolder) result.push({
      label: effectiveIds.length > 1 ? 'Remove from Folders' : 'Remove from Folder',
      destructive: true,
      action: () => { removeItemsFromFolders(scopeKey, effectiveIds); refresh(); },
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, selectedIds, membership, folders, refresh]);

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

  // ── Drag ──────────────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, itemId: string) {
    const ids = selectedIds.size > 1 && selectedIds.has(itemId) ? [...selectedIds] : [itemId];
    e.dataTransfer.setData('application/shader-studio-folder',
      JSON.stringify({ scopeKey, ids }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function parseDrop(e: React.DragEvent): string[] | null {
    try {
      const raw = e.dataTransfer.getData('application/shader-studio-folder');
      if (!raw) return null;
      const { scopeKey: src, ids } = JSON.parse(raw) as { scopeKey: string; ids: string[] };
      return src === scopeKey ? ids : null;
    } catch { return null; }
  }

  // ── Item wrapper (inline — NOT a component defined inside render) ─────────

  function renderWrappedItem(item: T) {
    const selected = selectedIds.has(item.id);
    return (
      <div
        key={item.id}
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
        style={{ outline: selected ? `2px solid ${color}66` : 'none', borderRadius: '20px', cursor: 'grab' }}
      >
        {renderItem(item, selected)}
      </div>
    );
  }

  const itemsInFolder = (fid: string) => items.filter(i => membership[i.id] === fid);
  const ungrouped     = items.filter(i => !membership[i.id]);
  const isEmpty       = items.length === 0 && folders.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      // onContextMenu on the CONTAINER fires for any right-click not already
      // stopped by an item or folder row (they call stopPropagation).
      onContextMenu={e => openMenu(e, { kind: 'panel' })}
      onClick={() => setSelectedIds(new Set())}
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        flex: 1,        // fill available panel height so the whole area is clickable
        minHeight: '40px',
      }}
    >
      {isEmpty && emptyHint}

      {/* Folder sections */}
      {folders.map(folder => {
        const children  = itemsInFolder(folder.id);
        const isTarget  = dropTargetId === folder.id;
        const isRenaming = renamingFolderId === folder.id;
        return (
          <div key={folder.id}>
            {/* Header */}
            <div
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropTarget(folder.id); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault(); setDropTarget(null);
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
              <span style={{
                fontSize: '9px', color: `${color}aa`, display: 'inline-block',
                transform: folder.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s', flexShrink: 0,
              }}>▾</span>

              {isRenaming ? (
                <input
                  autoFocus
                  defaultValue={folder.label}
                  onBlur={e => { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingFolder(null); refresh(); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingFolder(null); refresh(); }
                    if (e.key === 'Escape') setRenamingFolder(null);
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
              <span style={{ fontSize: '9px', color: `${color}55`, flexShrink: 0 }}>{children.length}</span>
            </div>

            {/* Contents */}
            {!folder.collapsed && (
              <div style={{ paddingLeft: '12px', paddingTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {children.length === 0
                  ? <span style={{ fontSize: '10px', color: '#45475a', fontStyle: 'italic' }}>Empty — drag items here</span>
                  : children.map(item => renderWrappedItem(item))
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
            if (ids) { removeItemsFromFolders(scopeKey, ids); refresh(); }
          }}
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px',
            paddingTop: folders.length > 0 ? '4px' : '0',
            borderTop: folders.length > 0
              ? `1px solid ${dropTargetId === 'ungrouped' ? `${color}44` : '#252535'}` : 'none',
            transition: 'border-color 0.1s',
          }}
        >
          {ungrouped.map(item => renderWrappedItem(item))}
        </div>
      )}

      {/* Drop zone to remove from folder (when all items are in folders) */}
      {ungrouped.length === 0 && folders.length > 0 && items.length > 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDropTarget('ungrouped'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={e => {
            e.preventDefault(); setDropTarget(null);
            const ids = parseDrop(e);
            if (ids) { removeItemsFromFolders(scopeKey, ids); refresh(); }
          }}
          style={{
            padding: '6px', borderRadius: '5px', textAlign: 'center', fontStyle: 'italic',
            border: `1px dashed ${dropTargetId === 'ungrouped' ? `${color}88` : '#313244'}`,
            fontSize: '10px', color: '#45475a', transition: 'border-color 0.1s',
          }}
        >
          Drop here to remove from folder
        </div>
      )}

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
