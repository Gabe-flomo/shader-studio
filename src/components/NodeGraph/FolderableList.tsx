import React, { useState, useEffect, useCallback } from 'react';
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
import { AssetContextMenu } from './AssetContextMenu';
import type { ContextMenuItem } from './AssetContextMenu';

export interface FolderableItem { id: string; label: string; }

interface Props<T extends FolderableItem> {
  scopeKey: string;
  color: string;
  items: T[];
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  emptyHint?: React.ReactNode;
}

// ── Btn helper ────────────────────────────────────────────────────────────────
function SmallBtn({ children, onClick, title, active }: {
  children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string; active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick(e); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: active || hov ? '#313244' : 'none',
        border: '1px solid ' + (active || hov ? '#45475a' : '#313244'),
        color: hov ? '#cdd6f4' : '#6c7086',
        borderRadius: '4px', fontSize: '10px', padding: '1px 6px',
        cursor: 'pointer', lineHeight: 1.5, flexShrink: 0,
      }}
    >{children}</button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function FolderableList<T extends FolderableItem>({
  scopeKey, color, items, renderItem, emptyHint,
}: Props<T>) {
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
  function buildFolderMenuItems(folderId: string): ContextMenuItem[] {
    return [
      { label: 'Rename', action: () => setRenamingId(folderId) },
      { label: 'Delete Folder', destructive: true, separator: true,
        action: () => { deleteFolder(scopeKey, folderId); refresh(); } },
    ];
  }

  // ── Move-selected submenu ─────────────────────────────────────────────────
  function buildMoveMenuItems(ids: string[]): ContextMenuItem[] {
    const folderItems: ContextMenuItem[] = folders.map(f => ({
      label: `📁  ${f.label}`,
      action: () => { moveItemsToFolder(scopeKey, ids, f.id); setSelected(new Set()); refresh(); setMoveMenu(null); },
    }));
    folderItems.push({
      label: '＋  New folder…',
      separator: folderItems.length > 0,
      action: () => { setMoveMenu(null); startCreating(); },
    });
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
        style={{ outline: sel ? `2px solid ${color}66` : 'none', borderRadius: '20px', cursor: 'grab' }}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: '40px' }}
      onClick={e => { if (e.target === e.currentTarget) setSelected(new Set()); }}
    >

      {/* Toolbar: + New Folder button + selection action */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallBtn onClick={() => startCreating()} title="Create a new folder">
          + Folder
        </SmallBtn>
        {numSel > 0 && (
          <SmallBtn
            active
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMoveMenu({ x: rect.left, y: rect.bottom + 4, ids: [...selectedIds] });
            }}
            title="Move selected items to a folder"
          >
            Move {numSel} →
          </SmallBtn>
        )}
      </div>

      {/* Inline new-folder input */}
      {creatingFolder && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          <span style={{ fontSize: '11px', color: `${color}99`, flexShrink: 0 }}>📁</span>
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
              flex: 1, background: '#11111b', border: `1px solid ${color}`,
              color, borderRadius: '4px', padding: '2px 7px',
              fontSize: '11px', outline: 'none', minWidth: 0,
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
                  onBlur={e => { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingId(null); refresh(); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameFolder(scopeKey, folder.id, e.currentTarget.value || folder.label); setRenamingId(null); refresh(); }
                    if (e.key === 'Escape') setRenamingId(null);
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
            display: 'flex', flexWrap: 'wrap', gap: '4px',
            paddingTop: folders.length > 0 ? '4px' : '0',
            borderTop: folders.length > 0 ? `1px solid ${dropTarget === 'ungrouped' ? `${color}44` : '#252535'}` : 'none',
            transition: 'border-color 0.1s',
          }}
        >
          {ungrouped.map(item => renderWrapped(item))}
        </div>
      )}

      {/* Un-folder drop zone */}
      {ungrouped.length === 0 && folders.length > 0 && items.length > 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDropTarget('ungrouped'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={e => {
            e.preventDefault(); setDropTarget(null);
            const ids = parseDrop(e);
            if (ids) { removeItemsFromFolders(scopeKey, ids); setSelected(new Set()); refresh(); }
          }}
          style={{
            padding: '6px', borderRadius: '5px', textAlign: 'center', fontStyle: 'italic',
            border: `1px dashed ${dropTarget === 'ungrouped' ? `${color}88` : '#313244'}`,
            fontSize: '10px', color: '#45475a', transition: 'border-color 0.1s',
          }}
        >
          Drop here to remove from folder
        </div>
      )}

      {/* Folder right-click menu */}
      {folderMenu && (
        <AssetContextMenu
          x={folderMenu.x} y={folderMenu.y}
          items={buildFolderMenuItems(folderMenu.id)}
          onDismiss={() => setFolderMenu(null)}
        />
      )}

      {/* Move-selected submenu */}
      {moveMenu && (
        <AssetContextMenu
          x={moveMenu.x} y={moveMenu.y}
          items={buildMoveMenuItems(moveMenu.ids)}
          onDismiss={() => setMoveMenu(null)}
        />
      )}
    </div>
  );
}
