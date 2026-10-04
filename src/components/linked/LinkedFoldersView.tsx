/**
 * The Files page's Linked folders (docs/linked-folders.md):
 *
 *   LinkedFoldersView   the view: each linked folder with its state and what
 *                       it's for, Link a folder…, rename, what it's for, Allow
 *                       again / Check again / Find it…, Unlink (with Undo), and
 *                       the shared browser over the chosen one
 *   LinkedFoldersEntry  the Files sidebar's row
 *   LinkedFoldersGroup  the sidebar's group under the tree: each folder, a click away
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import {
  UNSUPPORTED_TEXT, linkFolder, linkedSupport, loadLinkedFolders, reconnectLinkedFolder, relocateLinkedFolder, renameLinkedFolder, setLinkedKind, unlinkFolder, useLinkedFolders,
  type LinkedFolder,
} from '../../files/linkedFolders';
import { KIND_HINTS } from '../../files/linkedRefs';
import { LinkedBrowser, StatusDot, statusWords } from './LinkedBrowser';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ask for a new name, and so on: the folder's menu. */
function folderMenu(f: LinkedFolder, status: string | undefined): MenuItem[] {
  return [
    { label: 'Rename…', icon: 'edit', onSelect: async () => { const t = (await askText('Rename linked folder', { label: 'Name', initial: f.name, confirmLabel: 'Rename' }))?.trim(); if (t && t !== f.name) await renameLinkedFolder(f.id, t); } },
    { heading: 'Mostly for' },
    ...KIND_HINTS.map(k => ({ label: k.label, icon: (k.value === f.kind ? 'check' : undefined), onSelect: () => { void setLinkedKind(f.id, k.value); } }) as MenuItem),
    'separator',
    status === 'permission'
      ? { label: 'Reconnect', icon: 'link', onSelect: () => { void reconnectLinkedFolder(f.id); } }
      : { label: 'Check again', icon: 'rebuild', onSelect: () => { void reconnectLinkedFolder(f.id); } },
    { label: 'Find it somewhere else…', icon: 'folder', hint: 'It moved, or the drive has a new name: files inside keep their paths', onSelect: () => { void relocateLinkedFolder(f.id).catch(e => toast.error('Couldn’t use that folder', { message: e instanceof Error ? e.message : String(e) })); } },
    'separator',
    { label: 'Unlink', icon: 'unlink', danger: true, hint: 'Nothing on disk is touched; setups using its files show them missing', onSelect: async () => {
      const undo = await unlinkFolder(f.id);
      if (undo) toast.info(`Unlinked “${f.name}”`, { message: 'Nothing on disk was touched. Setups that use its files show them as missing until it’s linked again.', action: { label: 'Undo', onClick: () => { void undo(); } } });
    } },
  ];
}

export function LinkedFoldersView({ compact = false, folderId: wanted }: { compact?: boolean; folderId?: string }) {
  const tk = useTokens();
  const { folders, status } = useLinkedFolders();
  const support = linkedSupport();
  useEffect(() => { void loadLinkedFolders(); }, []);
  const [current, setCurrent] = useState<string | undefined>(wanted);
  useEffect(() => { if (wanted) setCurrent(wanted); }, [wanted]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const note = { font: `12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary, margin: 0 };
  const link = async () => {
    try { const f = await linkFolder(); if (f) setCurrent(f.id); }
    catch (e) { toast.error('Couldn’t link that folder', { message: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: compact ? '14px 16px 40px' : '24px 28px 48px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1, font: `650 18px ${fontFamily.ui}`, color: tk.text.primary }}>Linked folders</h2>
        {support !== 'none' && <Button size="sm" variant="primary" icon="folder" onClick={() => void link()}>Link a folder…</Button>}
      </div>
      <p style={note}>
        Folders on your computer (a samples folder, images, videos, fonts) that every picker can browse: drum pads, image and video layers, backgrounds, fonts.
        A file is used from where it is, read-only. Nothing is copied into the library, so linked files don’t count toward the storage limit.
        A .playfile export takes a copy of the files it uses along; library and profile ZIPs keep only the references (the folders stay yours).
      </p>
      {support === 'none' && (
        <div style={{ padding: '12px 14px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, ...note }}>{UNSUPPORTED_TEXT}</div>
      )}
      {folders.length > 0 && (
        <div role="list" aria-label="Linked folders" style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
          {folders.map(f => {
            const s = status[f.id];
            const on = current === f.id;
            return (
              <div key={f.id} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px 8px 10px', borderRadius: radius.lg, background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${on ? alpha(tk.accent.base, 0.5) : tk.border.default}` }}>
                <button type="button" onClick={() => setCurrent(f.id)} title={f.path ?? f.name} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text, position: 'relative' }}>
                    <Icon name="folder" size={16} />
                    <span style={{ position: 'absolute', right: -2, bottom: -2, borderRadius: '50%', padding: 1.5, background: on ? tk.bg.selected : tk.bg.panel, display: 'flex' }}><StatusDot status={s} size={8} /></span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ font: `600 13px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ font: `11.5px ${fontFamily.ui}`, color: s === 'missing' || s === 'permission' ? tk.status.warningText : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {statusWords(s).text} · {KIND_HINTS.find(k => k.value === f.kind)?.label ?? 'Anything'}{f.backend === 'desktop' && f.path ? ` · ${f.path}` : f.backend === 'browser' ? ' · in this browser' : ''}
                    </span>
                  </span>
                </button>
                <IconButton icon="more" label={`More for “${f.name}”`} tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: Math.max(8, r.right - 250), y: r.bottom + 4, items: folderMenu(f, s) }); }} />
              </div>
            );
          })}
        </div>
      )}
      {(folders.length > 0 || support !== 'none') && (
        <div style={{ padding: compact ? '12px 12px' : '14px 16px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <LinkedBrowser filter="any" mode="manage" compact={compact} folderId={current} onFolderChange={setCurrent} listHeight={compact ? '56dvh' : 'min(56vh, 560px)'} />
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} minWidth={250} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** The Files sidebar's row for Linked folders: how many, and whether one needs something. */
export function LinkedFoldersEntry({ active, onClick }: { active: boolean; onClick: () => void }) {
  const tk = useTokens();
  const { folders, status } = useLinkedFolders();
  useEffect(() => { void loadLinkedFolders(); }, []);
  const [hover, setHover] = useState(false);
  const trouble = folders.filter(f => status[f.id] === 'missing' || status[f.id] === 'permission').length;
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-current={active ? 'page' : undefined}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', background: active ? tk.bg.selected : hover ? tk.bg.hover : 'transparent', color: active ? tk.accent.text : tk.text.primary, font: `600 12.5px ${fontFamily.ui}` }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text, flexShrink: 0 }}><Icon name="link" size={13} /></span>
      <span style={{ flex: 1 }}>Linked folders</span>
      {trouble > 0 && <span title={`${plural(trouble, 'folder')} need${trouble === 1 ? 's' : ''} you`} style={{ display: 'flex' }}><Icon name="warning" size={13} style={{ color: tk.status.warningText }} /></span>}
      {folders.length > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: active ? tk.accent.base : tk.bg.field, color: active ? tk.bg.panel : tk.text.muted, font: `600 10.5px ${fontFamily.ui}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{folders.length}</span>}
    </button>
  );
}

/** Under the tree: each linked folder, with its state. */
export function LinkedFoldersGroup({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
  const tk = useTokens();
  const { folders, status } = useLinkedFolders();
  if (!folders.length) return null;
  return (
    <div role="group" aria-label="Linked folders" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {folders.map(f => (
        <button key={f.id} type="button" onClick={() => onOpen(f.id)} title={`${f.name}: ${statusWords(status[f.id]).text}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', background: current === f.id ? tk.bg.selected : 'transparent', color: current === f.id ? tk.accent.text : tk.text.secondary, font: `500 12.5px ${fontFamily.ui}` }}>
          <Icon name="folder" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <StatusDot status={status[f.id]} size={7} />
        </button>
      ))}
    </div>
  );
}
