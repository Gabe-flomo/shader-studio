/**
 * BackgroundsDialog — the library's backgrounds: Images (captured from a
 * graph, or imported) and Palettes (built in, and yours). Folders like the
 * other kinds (the shared folder store), search, and per item rename, move to
 * a folder, download or copy, and delete with Undo. Capture from a graph and
 * Import an image sit at the top. Opened with `pick`, choosing an item
 * answers the caller instead (openBackgrounds in backgroundsUi.ts).
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
import { Segmented } from '../ui/Choice';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { FolderableList } from '../NodeGraph/FolderableList';
import { createFolder, getFolderForItem, loadFolders } from '../../utils/assetFolders';
import { saveBinaryFile } from '../../utils/fileIO';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';
import {
  IMAGE_FOLDER_SCOPE, PALETTE_FOLDER_SCOPE, freePaletteName, getImage, importImageFile, moveImage, movePalette, paletteCss, renameImage, renamePalette, savePalette,
  type BackgroundImageMeta, type Palette,
} from '../../lib/backgroundLibrary';
import { deleteImageWithUndo, deletePaletteWithUndo, useBackgroundImages, usePalettes } from './useBackgrounds';
import { openCapture, type BackgroundPick } from './backgroundsUi';
import { PaletteEditor } from './FillEditor';

type Tab = 'images' | 'palettes';
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 640;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "1920 × 1080 · Sunset at 3.2 s, with layers" */
function imageDetail(m: BackgroundImageMeta): string {
  const size = `${m.width} × ${m.height}`;
  if (!m.source) return size;
  const graph = m.source.kind === 'example' ? EXAMPLE_INDEX[m.source.graph]?.label ?? m.source.graph : m.source.graph;
  return `${size} · ${graph} at ${Number(m.source.time.toFixed(2))} s${m.source.mode === 'play' ? ', with layers' : ''}`;
}

function Thumb({ src, w = 72, h = 40 }: { src?: string; w?: number; h?: number }) {
  const tk = useTokens();
  return (
    <span style={{ width: w, height: h, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.08)}` }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Icon name="overlay" size={14} style={{ color: alpha('#ffffff', 0.4) }} />}
    </span>
  );
}

function Row({ lead, title, detail, picking, onPick, onMenu, compact }: { lead: React.ReactNode; title: string; detail: string; picking: boolean; onPick: () => void; onMenu?: (el: HTMLElement) => void; compact: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px 5px 6px', borderRadius: radius.md, background: hover ? tk.bg.hover : 'transparent' }}>
      <button type="button" onClick={onPick} title={picking ? `Use “${title}”` : title}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, padding: 0, background: 'none', cursor: picking ? 'pointer' : 'default', textAlign: 'left', color: tk.text.primary }}>
        {lead}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 13px ${fontFamily.ui}` }}>{title}</span>
          <span style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
        </span>
        {picking && hover && !compact && <span style={{ color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, flexShrink: 0 }}>Use</span>}
      </button>
      {onMenu && (
        <span ref={menuRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton icon="more" label={`More for “${title}”`} tooltip={false} onClick={e => { e.stopPropagation(); if (menuRef.current) onMenu(menuRef.current); }}
            style={compact ? { width: 36, height: 36 } : undefined} />
        </span>
      )}
    </div>
  );
}

export function BackgroundsDialog({ pick, title, onDone }: { pick?: 'image' | 'palette' | 'any'; title?: string; onDone: (p: BackgroundPick | null) => void }) {
  const tk = useTokens();
  const compact = narrow();
  const { images, error } = useBackgroundImages();
  const palettes = usePalettes();
  const [tab, setTab] = useState<Tab>(pick === 'palette' ? 'palettes' : 'images');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [editing, setEditing] = useState<Palette | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump(n => n + 1);
    window.addEventListener('assetbrowser-folders-changed', on);
    return () => window.removeEventListener('assetbrowser-folders-changed', on);
  }, []);
  const picking = !!pick;
  const tabs = pick === 'image' ? ['images'] : pick === 'palette' ? ['palettes'] : ['images', 'palettes'];

  const needle = q.trim().toLowerCase();
  const imgs = useMemo(() => images ?? [], [images]);
  const byId = useMemo(() => new Map(imgs.map(m => [m.id, m])), [imgs]);
  const palById = useMemo(() => new Map(palettes.map(p => [p.id, p])), [palettes]);
  const presets = palettes.filter(p => p.preset);
  const mine = palettes.filter(p => !p.preset);

  const moveItems = (scope: string, id: string, move: (id: string, folder: string | null) => void): MenuItem[] => {
    const inFolder = getFolderForItem(scope, id);
    const folders = loadFolders(scope);
    return [
      ...folders.map(f => ({ label: f.label, icon: (f.id === inFolder ? 'check' : 'folder') as 'check' | 'folder', onSelect: () => move(id, f.id) })),
      ...(folders.length ? ['separator' as const] : []),
      { label: 'New folder…', icon: 'plus', onSelect: async () => {
        const label = (await askText('New folder', { label: 'Name', initial: '', confirmLabel: 'Create' }))?.trim();
        if (label) move(id, createFolder(scope, label).id);
      } },
      ...(inFolder ? [{ label: 'Out of its folder', icon: 'close' as const, onSelect: () => move(id, null) }] : []),
    ];
  };
  const openMenu = (el: HTMLElement, items: MenuItem[]) => { const r = el.getBoundingClientRect(); setMenu({ x: Math.max(8, r.right - 240), y: r.bottom + 4, items }); };
  const later = (fn: () => void) => () => setTimeout(fn, 0);

  const imageMenu = (m: BackgroundImageMeta, el: HTMLElement): MenuItem[] => [
    ...(picking && pick !== 'palette' ? [{ label: 'Use it', icon: 'check' as const, onSelect: () => onDone({ kind: 'image', image: m }) }, 'separator' as const] : []),
    { label: 'Rename…', icon: 'edit', onSelect: async () => { const t = (await askText('Rename background', { label: 'Name', initial: m.name, confirmLabel: 'Rename' }))?.trim(); if (t && t !== m.name) await renameImage(m.id, t); } },
    { label: getFolderForItem(IMAGE_FOLDER_SCOPE, m.id) ? 'Move to another folder…' : 'Move to a folder…', icon: 'folder', onSelect: later(() => openMenu(el, moveItems(IMAGE_FOLDER_SCOPE, m.id, moveImage))) },
    { label: 'Download', icon: 'export', hint: `The picture file, ${m.width} × ${m.height}`, onSelect: async () => {
      const img = await getImage(m.id);
      if (!img) return;
      const ext = img.type === 'image/jpeg' ? 'jpg' : img.type.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png';
      const res = await saveBinaryFile(new Uint8Array(await img.blob.arrayBuffer()), `${m.name.replace(/[/\\:*?"<>|]/g, '-')}.${ext}`, img.type);
      if (!res.ok && !res.cancelled) toast.error('Couldn’t download it', { message: res.error });
    } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, hint: 'You can undo it for a few seconds', onSelect: () => void deleteImageWithUndo(m) },
  ];
  const paletteMenu = (p: Palette, el: HTMLElement): MenuItem[] => [
    ...(picking && pick !== 'image' ? [{ label: 'Use it', icon: 'check' as const, onSelect: () => onDone({ kind: 'palette', palette: p }) }, 'separator' as const] : []),
    ...(p.preset ? [] : [
      { label: 'Edit…', icon: 'edit' as const, onSelect: () => setEditing(p) },
      { label: 'Rename…', icon: 'edit' as const, onSelect: async () => { const t = (await askText('Rename palette', { label: 'Name', initial: p.name, confirmLabel: 'Rename' }))?.trim(); if (t && t !== p.name) renamePalette(p.id, t); } },
      { label: getFolderForItem(PALETTE_FOLDER_SCOPE, p.id) ? 'Move to another folder…' : 'Move to a folder…', icon: 'folder' as const, onSelect: later(() => openMenu(el, moveItems(PALETTE_FOLDER_SCOPE, p.id, movePalette))) },
    ]),
    { label: 'Make a copy', icon: 'copy', hint: p.preset ? 'A copy of yours, to change' : undefined, onSelect: () => { const c = savePalette({ ...p, id: undefined, createdAt: undefined, name: freePaletteName(p.name) }); toast.success(`Saved “${c.name}”`); } },
    ...(p.preset ? [] : ['separator' as const, { label: 'Delete', icon: 'trash' as const, danger: true, hint: 'You can undo it for a few seconds', onSelect: () => deletePaletteWithUndo(p) }]),
  ];

  const imageRow = (m: BackgroundImageMeta) => (
    <Row key={m.id} compact={compact} picking={picking && pick !== 'palette'} title={m.name} detail={imageDetail(m)}
      lead={<Thumb src={m.thumb} w={compact ? 64 : 80} h={compact ? 36 : 45} />}
      onPick={() => { if (picking && pick !== 'palette') onDone({ kind: 'image', image: m }); }}
      onMenu={el => openMenu(el, imageMenu(m, el))} />
  );
  const paletteRow = (p: Palette) => (
    <Row key={p.id} compact={compact} picking={picking && pick !== 'image'} title={p.name}
      detail={`${plural(p.stops.length, 'colour')} · ${p.style === 'bands' ? 'bands' : 'gradient'}${p.preset ? ' · built in' : ''}`}
      lead={<span style={{ width: compact ? 64 : 80, height: compact ? 36 : 45, flexShrink: 0, borderRadius: radius.sm, background: paletteCss(p), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.08)}` }} />}
      onPick={() => { if (picking && pick !== 'image') onDone({ kind: 'palette', palette: p }); }}
      onMenu={el => openMenu(el, paletteMenu(p, el))} />
  );

  const importFile = async (file: File) => {
    setBusy(true);
    try { const m = await importImageFile(file); toast.success(`Added “${m.name}”`, { message: `${m.width} × ${m.height}, in Image backgrounds.` }); }
    catch (e) { toast.error('Couldn’t add that image', { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const capture = async () => {
    const id = await openCapture();
    if (id) setTab('images');
  };

  const toolbar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '0 0 10px' : '14px 18px 10px', borderBottom: `1px solid ${tk.border.subtle}` }}>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      {tabs.length > 1 && (
        <Segmented<Tab> fill ariaLabel="Kind of background" value={tab} onChange={setTab} options={[
          { value: 'images', label: `Images${images ? ` (${images.length})` : ''}` },
          { value: 'palettes', label: `Palettes (${palettes.length})` },
        ]} />
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tab === 'images' ? (
          <>
            <Button size="sm" variant="primary" icon="camera" onClick={() => void capture()} title="Render a saved graph or an example at a moment you choose, and keep it as a picture">Capture from a graph…</Button>
            <Button size="sm" icon="import" disabled={busy} onClick={() => fileInput.current?.click()} title="PNG, JPG, WebP, GIF or SVG, kept as it is">{busy ? 'Adding…' : 'Import an image…'}</Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>New palette…</Button>
        )}
      </div>
      {(tab === 'images' ? imgs.length : palettes.length) > 6 && (
        <Field aria-label="Search backgrounds" placeholder={tab === 'images' ? 'Search image backgrounds' : 'Search palettes'} height={32} value={q} onChange={e => setQ(e.target.value)}
          leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />}
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      )}
    </div>
  );

  const empty = (text: string) => <div style={{ padding: '22px 8px', color: tk.text.faint, textAlign: 'center', lineHeight: 1.5, font: `500 12.5px/1.5 ${fontFamily.ui}` }}>{text}</div>;
  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, padding: '10px 6px 4px' };

  let body: React.ReactNode;
  if (tab === 'images') {
    const found = needle ? imgs.filter(m => `${m.name} ${imageDetail(m)}`.toLowerCase().includes(needle)) : null;
    body = images === null ? empty('Loading…')
      : error ? empty(`Image backgrounds can’t be kept in this browser: ${error}`)
      : found ? (found.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{found.map(imageRow)}</div> : empty(`No image background called anything like “${q.trim()}”.`))
      : <FolderableList scopeKey={IMAGE_FOLDER_SCOPE} color={tk.accent.base} items={imgs.map(m => ({ id: m.id, label: m.name }))}
          renderItem={item => { const m = byId.get(item.id); return m ? imageRow(m) : null; }}
          emptyHint={empty('No image backgrounds yet. Capture one from a graph (any moment, with or without its layers), or import a picture.')} />;
  } else {
    const found = needle ? palettes.filter(p => p.name.toLowerCase().includes(needle)) : null;
    body = found
      ? (found.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{found.map(paletteRow)}</div> : empty(`No palette called anything like “${q.trim()}”.`))
      : (
        <>
          <div style={caps}>Yours</div>
          <FolderableList scopeKey={PALETTE_FOLDER_SCOPE} color={tk.accent.base} items={mine.map(p => ({ id: p.id, label: p.name }))}
            renderItem={item => { const p = palById.get(item.id); return p ? paletteRow(p) : null; }}
            emptyHint={empty('None of your own yet. Make one here, or build a gradient on Play (Background: Colour → Gradient) and Save as palette.')} />
          <div style={caps}>Built in</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{presets.map(paletteRow)}</div>
        </>
      );
  }
  const content = <div style={{ padding: compact ? '10px 0 4px' : '8px 14px 14px', minHeight: compact ? 180 : 300 }}>{body}</div>;
  const note = (
    <div style={{ color: tk.text.faint, font: `500 11.5px/1.5 ${fontFamily.ui}` }}>
      {picking ? 'Choose one to use it. ' : ''}Kept in this browser; Export everything and the backup folder include them. A setup that uses one keeps its own copy, so it works when shared.
    </div>
  );
  const popup = menu && <Menu x={menu.x} y={menu.y} minWidth={240} items={menu.items} onClose={() => setMenu(null)} />;
  const editor = editing && (
    <PaletteEditor initial={editing === 'new' ? null : editing} compact={compact} onClose={() => setEditing(null)} />
  );
  const heading = title ?? (pick === 'image' ? 'Choose an image background' : pick === 'palette' ? 'Choose a palette' : 'Backgrounds');

  if (compact) {
    return (
      <Sheet title={heading} onClose={() => onDone(null)} maxHeight="90dvh">
        {toolbar}{content}<div style={{ padding: '6px 2px 4px' }}>{note}</div>{popup}{editor}
      </Sheet>
    );
  }
  return (
    <Modal title={heading} subtitle={images ? `${plural(images.length, 'image')} · ${plural(mine.length, 'palette')} of yours` : undefined} icon="overlay" onClose={() => onDone(null)} width={600} footer={note}>
      {toolbar}
      <div style={{ maxHeight: 'min(58vh, 540px)', overflowY: 'auto' }}>{content}</div>
      {popup}{editor}
    </Modal>
  );
}
