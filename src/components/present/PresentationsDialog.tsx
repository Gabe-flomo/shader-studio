/**
 * PresentationsDialog — every presentation saved in this browser: search,
 * folders (the same folders the library's ZIPs and backup folder use), a
 * still, how many steps and Plays, when it was last changed. Open one, or
 * download, copy, rename, file or delete it (with Undo). New, Import and
 * Download all sit at the top.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { FolderableList } from '../NodeGraph/FolderableList';
import { whenSaved } from '../../store/graphVersions';
import { createFolder, loadFolders, moveItemsToFolder, removeItemsFromFolders, getFolderForItem } from '../../utils/assetFolders';
import { PRESENTATION_FOLDER_SCOPE } from '../../utils/library';
import { loadPresentation, renamePresentation, type PresentationEntry } from '../../present/storage';
import { usePresentation } from './presentationStore';
import { deleteWithUndo, downloadAllPresentations, exportPresentationFile, importPresentationFile } from './presentationFiles';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

async function renameSaved(name: string): Promise<void> {
  const t = (await askText('Rename presentation', { label: 'Title', initial: name, confirmLabel: 'Rename' }))?.trim();
  if (!t || t === name) return;
  const st = usePresentation.getState();
  const ok = st.name === name ? st.rename(t) : renamePresentation(name, t);
  if (!ok) toast.error('That name is taken', { message: `There's already a presentation called “${t}”.` });
}

function duplicateSaved(name: string): void {
  const st = usePresentation.getState();
  const doc = st.name === name ? st.doc : loadPresentation(name);
  if (!doc) return;
  const copy = st.adopt({ ...structuredClone(doc), createdAt: Date.now() });
  toast.success(`Made a copy: “${copy}”`, { message: 'The copy is open now.' });
}

function Row({ entry, current, compact, onOpen, onMenu }: { entry: PresentationEntry; current: boolean; compact: boolean; onOpen: () => void; onMenu: (el: HTMLElement) => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '6px 4px 6px 6px' : '5px 4px 5px 6px', borderRadius: radius.md, background: current ? alpha(tk.accent.base, 0.1) : hover ? tk.bg.hover : 'transparent' }}
    >
      <button type="button" onClick={onOpen} title={`Open “${entry.name}”`}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
        <span style={{ width: 64, height: 36, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {entry.poster ? <img src={entry.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="slides" size={15} style={{ color: alpha('#ffffff', 0.4) }} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 13px ${fontFamily.ui}` }}>{entry.name}</span>
            {current && <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: radius.sm, background: alpha(tk.accent.base, 0.16), color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}` }}>Open</span>}
          </span>
          <span style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {plural(entry.steps, 'step')} · {plural(entry.sources, 'Play')}{entry.updatedAt ? ` · ${whenSaved(entry.updatedAt)}` : ''}
          </span>
        </span>
      </button>
      <span ref={menuRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
        <IconButton icon="more" label={`More for “${entry.name}”`} tooltip={false} onClick={e => { e.stopPropagation(); if (menuRef.current) onMenu(menuRef.current); }}
          style={compact ? { width: 36, height: 36 } : undefined} />
      </span>
    </div>
  );
}

export function PresentationsDialog({ list, compact, onClose, onNew }: { list: PresentationEntry[]; compact: boolean; onClose: () => void; onNew: () => void }) {
  const tk = useTokens();
  const current = usePresentation(s => s.name);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; name: string; move?: boolean } | null>(null);
  const [folders, setFolders] = useState(() => loadFolders(PRESENTATION_FOLDER_SCOPE));
  useEffect(() => {
    const on = () => setFolders(loadFolders(PRESENTATION_FOLDER_SCOPE));
    window.addEventListener('assetbrowser-folders-changed', on);
    return () => window.removeEventListener('assetbrowser-folders-changed', on);
  }, []);

  const open = (name: string) => {
    if (!usePresentation.getState().open(name)) { toast.error(`Couldn’t open “${name}”`, { message: 'It isn’t readable.' }); return; }
    onClose();
  };
  const byName = useMemo(() => new Map(list.map(e => [e.name, e])), [list]);
  const items = useMemo(() => list.map(e => ({ id: e.name, label: e.name })), [list]);
  const needle = q.trim().toLowerCase();
  const found = needle ? list.filter(e => e.name.toLowerCase().includes(needle)) : null;

  const menuItems = (name: string): MenuItem[] => {
    const inFolder = getFolderForItem(PRESENTATION_FOLDER_SCOPE, name);
    return [
      { label: 'Open', icon: 'slides', onSelect: () => open(name) },
      { label: 'Download', icon: 'export', hint: 'A .present.json file with every Play in it', onSelect: () => void exportPresentationFile(name) },
      { label: 'Make a copy', icon: 'copy', onSelect: () => { duplicateSaved(name); onClose(); } },
      { label: 'Rename…', icon: 'edit', onSelect: () => void renameSaved(name) },
      { label: inFolder ? 'Move to another folder…' : 'Move to a folder…', icon: 'folder', onSelect: () => { const at = menu; if (at) setTimeout(() => setMenu({ ...at, move: true }), 0); } },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, hint: 'You can undo it for a few seconds', onSelect: () => deleteWithUndo(name) },
    ];
  };
  const moveItems = (name: string): MenuItem[] => {
    const inFolder = getFolderForItem(PRESENTATION_FOLDER_SCOPE, name);
    return [
      ...folders.map(f => ({ label: f.label, icon: (f.id === inFolder ? 'check' : 'folder') as 'check' | 'folder', onSelect: () => moveItemsToFolder(PRESENTATION_FOLDER_SCOPE, [name], f.id) })),
      ...(folders.length ? ['separator' as const] : []),
      { label: 'New folder…', icon: 'plus', onSelect: async () => {
        const label = (await askText('New folder', { label: 'Name', initial: '', confirmLabel: 'Create' }))?.trim();
        if (label) moveItemsToFolder(PRESENTATION_FOLDER_SCOPE, [name], createFolder(PRESENTATION_FOLDER_SCOPE, label).id);
      } },
      ...(inFolder ? [{ label: 'Out of its folder', icon: 'close' as const, onSelect: () => removeItemsFromFolders(PRESENTATION_FOLDER_SCOPE, [name]) }] : []),
    ];
  };
  const row = (name: string) => {
    const e = byName.get(name);
    if (!e) return null;
    return <Row entry={e} current={name === current} compact={compact} onOpen={() => open(name)}
      onMenu={el => { const r = el.getBoundingClientRect(); setMenu({ x: Math.max(8, r.right - 240), y: r.bottom + 4, name }); }} />;
  };

  const toolbar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '0 0 10px' : '14px 18px 10px', borderBottom: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" icon="plus" onClick={() => { onClose(); onNew(); }}>New</Button>
        <Button size="sm" icon="import" onClick={() => { void importPresentationFile().then(onClose); }} title="Open a .present.json file as a new presentation">Import…</Button>
        <Button size="sm" variant="ghost" icon="export" disabled={!list.length} onClick={() => void downloadAllPresentations()} title="Every presentation as .present.json files in one ZIP, in their folders (with a library.json that imports them all back)">Download all</Button>
      </div>
      {list.length > 3 && (
        <Field aria-label="Search presentations" placeholder="Search presentations" height={32} value={q} onChange={e => setQ(e.target.value)}
          leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />}
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      )}
    </div>
  );
  const body = (
    <div style={{ padding: compact ? '10px 0 4px' : '10px 14px 14px', minHeight: compact ? 160 : 260 }}>
      {found ? (
        found.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{found.map(e => <div key={e.name}>{row(e.name)}</div>)}</div>
          : <div style={{ padding: '20px 8px', color: tk.text.faint, textAlign: 'center' }}>No presentation called anything like “{q.trim()}”.</div>
      ) : (
        <FolderableList scopeKey={PRESENTATION_FOLDER_SCOPE} color={tk.accent.base} items={items}
          renderItem={item => row(item.id)}
          emptyHint={<div style={{ padding: '20px 8px', color: tk.text.faint, textAlign: 'center', lineHeight: 1.5 }}>No presentations yet. Start a new one, or import a .present.json file.</div>} />
      )}
    </div>
  );
  const note = (
    <div style={{ color: tk.text.faint, font: `500 11.5px/1.5 ${fontFamily.ui}` }}>
      Saved in this browser as you work. Each one carries copies of its Plays, so it keeps working if a graph changes or goes. The Library’s Export everything and backup folder include them.
    </div>
  );
  const popup = menu && <Menu x={menu.x} y={menu.y} minWidth={240} items={menu.move ? moveItems(menu.name) : menuItems(menu.name)} onClose={() => setMenu(null)} />;

  if (compact) {
    return (
      <Sheet title="Presentations" onClose={onClose} maxHeight="88dvh">
        {toolbar}{body}<div style={{ padding: '6px 2px 4px' }}>{note}</div>{popup}
      </Sheet>
    );
  }
  return (
    <Modal title="Presentations" subtitle={`${plural(list.length, 'presentation')} in this browser`} icon="slides" onClose={onClose} width={580}
      footer={note}>
      {toolbar}
      <div style={{ maxHeight: 'min(56vh, 520px)', overflowY: 'auto' }}>{body}</div>
      {popup}
    </Modal>
  );
}
