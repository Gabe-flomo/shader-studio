/**
 * BackgroundsDialog — the library's backgrounds: Images (captured from a
 * graph, or imported), Palettes (built in, and yours), Videos (the Video
 * layers' files: poster, size, which setups use them, delete with a warning
 * when one does, and clean up the ones nothing uses) and Sounds (the drum
 * pads' samples, kept in the same store: a waveform, size, length, used by,
 * rename, download, delete and clean up). Folders like the
 * other kinds (the shared folder store), search, and per item rename, move to
 * a folder, download or copy, and delete with Undo. Capture from a graph and
 * Import an image sit at the top. Opened with `pick`, choosing an item
 * answers the caller instead (openBackgrounds in backgroundsUi.ts).
 */
import { exportPlayfile } from '../../playfile/app';
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
import { askConfirm, askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { FolderableList } from '../NodeGraph/FolderableList';
import { createFolder, getFolderForItem, loadFolders } from '../../utils/assetFolders';
import { saveBinaryFile } from '../../utils/fileIO';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { formatSize } from '../../utils/library';
import { browserKV, describeVideoUses, videoUses, type VideoUse } from '../../lib/videoUsage';
import {
  IMAGE_FOLDER_SCOPE, PALETTE_FOLDER_SCOPE, addVideoFile, freePaletteName, ensureSoundWave, getImage, getVideo, isAudioType, importImageFile, moveImage, movePalette, paletteCss, renameImage, renamePalette, renameVideo, savePalette, videoExt,
  type BackgroundImageMeta, type LibraryVideoMeta, type Palette,
} from '../../lib/backgroundLibrary';
import { deleteImageWithUndo, deletePaletteWithUndo, deleteVideosWithUndo, useBackgroundImages, useLibraryVideos, usePalettes } from './useBackgrounds';
import { openCapture, type BackgroundPick } from './backgroundsUi';
import { audioAccept, isAudioFile, notAudioMessage } from '../../lib/audioAccept';
import { PaletteEditor } from './FillEditor';
import { LinkedBrowser } from '../linked/LinkedBrowser';
import { useLinkedAvailable } from '../linked/LinkedPickButton';

type Tab = 'images' | 'palettes' | 'videos' | 'sounds' | 'linked';
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 640;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "1920 × 1080 · Sunset at 3.2 s, with layers" */
function imageDetail(m: BackgroundImageMeta): string {
  const size = `${m.width} × ${m.height}`;
  if (!m.source) return size;
  const graph = m.source.kind === 'example' ? EXAMPLE_INDEX[m.source.graph]?.label ?? m.source.graph : m.source.graph;
  return `${size} · ${graph} at ${Number(m.source.time.toFixed(2))} s${m.source.mode === 'play' ? ', with layers' : ''}`;
}

const clock = (s: number) => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return `${m}:${r < 10 ? '0' : ''}${r}`; };

/** "12.4 MB · 1280 × 720 · 0:08 · used by 2 setups" */
function videoDetail(v: LibraryVideoMeta, uses: readonly VideoUse[] | undefined): string {
  const parts = [formatSize(v.bytes), v.width && v.height ? `${v.width} × ${v.height}` : '', v.duration ? clock(v.duration) : ''];
  if (uses) parts.push(uses.length ? `used by ${uses.length === 1 ? (uses[0].kind === 'open' ? 'the open graph' : `“${uses[0].label}”`) : `${uses.length} setups`}` : 'not used');
  return parts.filter(Boolean).join(' · ');
}

function Thumb({ src, w = 72, h = 40, icon = 'overlay' }: { src?: string; w?: number; h?: number; icon?: 'overlay' | 'play' | 'wave' }) {
  const tk = useTokens();
  return (
    <span style={{ width: w, height: h, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.08)}` }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Icon name={icon} size={14} style={{ color: alpha('#ffffff', 0.4) }} />}
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

export function BackgroundsDialog({ pick, title, linked = false, onDone }: { pick?: 'image' | 'palette' | 'any'; title?: string; linked?: boolean; onDone: (p: BackgroundPick | null) => void }) {
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
  const soundInput = useRef<HTMLInputElement>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump(n => n + 1);
    window.addEventListener('assetbrowser-folders-changed', on);
    return () => window.removeEventListener('assetbrowser-folders-changed', on);
  }, []);
  const picking = !!pick;
  // Linked folders (docs/linked-folders.md): pictures from disk when the caller takes them; browsing when just managing.
  const linkedOk = useLinkedAvailable();
  const withLinked = linkedOk && (linked || !pick);
  const tabs = [...(pick === 'image' ? ['images'] : pick === 'palette' ? ['palettes'] : pick ? ['images', 'palettes'] : ['images', 'palettes', 'videos', 'sounds']), ...(withLinked ? ['linked'] : [])];
  const { videos, error: videoError } = useLibraryVideos();
  // Drum pad samples are kept with the videos; each has its own tab.
  const vids = useMemo(() => (videos ?? []).filter(v => !isAudioType(v.type)), [videos]);
  const snds = useMemo(() => (videos ?? []).filter(v => isAudioType(v.type)), [videos]);
  // A sound without a waveform yet gets one while the tab is open (tried once a session).
  useEffect(() => { if (tab === 'sounds') for (const s of snds) if (!s.thumb) void ensureSoundWave(s.id).catch(() => {}); }, [tab, snds]);
  const media = tab === 'sounds' ? snds : vids;
  // Which setups use each video: saved graphs and presentations, and the open graph as it is now.
  const openName = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const openLayers = useNodeGraphStore(s => s.play.layers);
  const openEngine = useNodeGraphStore(s => s.play.audioEngine);
  const openSounds = useMemo(() => (openEngine?.racks ?? []).flatMap(r => (r.instrument?.zones ?? []).map(z => z.sampleId)), [openEngine]);
  const uses = useMemo(() => (tab === 'videos' || tab === 'sounds' ? videoUses(media.map(v => v.id), browserKV, { name: openName, layers: openLayers, sounds: openSounds }) : null), [tab, media, openName, openLayers, openSounds]);
  const unusedVideos = useMemo(() => (uses ? media.filter(v => !uses.get(v.id)?.length) : []), [uses, media]);
  const sound = tab === 'sounds';
  const kindWord = sound ? 'sound' : 'video';

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
    { label: 'Download as .playfile', icon: 'export', hint: 'Opens straight into someone’s backgrounds library', onSelect: () => { void exportPlayfile([`ext:backgrounds:${m.id}`], { fileName: m.name, dependencies: false, success: `Saved “${m.name}”` }).then(r => { if (!r.ok && !r.cancelled) toast.error('Couldn’t download it', { message: r.error }); }); } },
    { label: 'Download the picture', icon: 'camera', hint: `The picture file, ${m.width} × ${m.height}`, onSelect: async () => {
      const img = await getImage(m.id);
      if (!img) return;
      const ext = img.type === 'image/jpeg' ? 'jpg' : img.type.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png';
      const res = await saveBinaryFile(new Uint8Array(await img.blob.arrayBuffer()), `${m.name.replace(/[/\\:*?"<>|]/g, '-')}.${ext}`, img.type);
      if (!res.ok && !res.cancelled) toast.error('Couldn’t download it', { message: res.error });
    } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, hint: 'You can undo it for a few seconds', onSelect: () => void deleteImageWithUndo(m) },
  ];
  const deleteVideo = async (v: LibraryVideoMeta) => {
    const u = uses?.get(v.id) ?? [];
    const one = u.reduce((n, x) => n + x.layers, 0) === 1;
    const msg = isAudioType(v.type)
      ? `${describeVideoUses(u, ['A drum pad', 'drum pads'])} Without the file, ${one ? 'that pad asks' : 'those pads ask'} for it again (pick the file, or import a ZIP that has it). You can undo for a few seconds.`
      : `${describeVideoUses(u)} Without the file, ${one ? 'that layer asks' : 'those layers ask'} for it again (pick the file, or import a ZIP that has it). You can undo for a few seconds.`;
    if (u.length && !(await askConfirm(`Delete “${v.name}”?`, { message: msg, confirmLabel: 'Delete', danger: true }))) return;
    await deleteVideosWithUndo([v], u.length ? (isAudioType(v.type) ? 'The pads that used it ask for it again.' : 'The layers that used it ask for it again.') : undefined);
  };
  const cleanUp = async () => {
    const list = unusedVideos;
    if (!list.length) return;
    const bytes = list.reduce((n, v) => n + v.bytes, 0);
    if (!(await askConfirm(`Delete ${plural(list.length, `unused ${kindWord}`)}?`, { message: `${list.map(v => `“${v.name}”`).slice(0, 6).join(', ')}${list.length > 6 ? ` and ${list.length - 6} more` : ''}: no saved Play setup, presentation or the open graph uses ${list.length === 1 ? 'it' : 'them'}. Frees ${formatSize(bytes)}.`, confirmLabel: 'Delete', danger: true }))) return;
    await deleteVideosWithUndo(list);
  };
  const videoMenu = (v: LibraryVideoMeta): MenuItem[] => [
    { label: 'Rename…', icon: 'edit', onSelect: async () => { const t = (await askText(isAudioType(v.type) ? 'Rename sound' : 'Rename video', { label: 'Name', initial: v.name, confirmLabel: 'Rename' }))?.trim(); if (t && t !== v.name) await renameVideo(v.id, t); } },
    { label: 'Download', icon: 'export', hint: `The ${isAudioType(v.type) ? 'sound' : 'video'} file, ${formatSize(v.bytes)}`, onSelect: async () => {
      const got = await getVideo(v.id);
      if (!got) return;
      const ext = videoExt(got.type);
      const base = v.name.replace(/[/\\:*?"<>|]/g, '-');
      const res = await saveBinaryFile(new Uint8Array(await got.blob.arrayBuffer()), new RegExp(`\\.${ext}$`, 'i').test(base) ? base : `${base}.${ext}`, got.type);
      if (!res.ok && !res.cancelled) toast.error('Couldn’t download it', { message: res.error });
    } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, hint: uses?.get(v.id)?.length ? (isAudioType(v.type) ? 'Its drum pads ask for it again; you can undo' : 'Its Video layers ask for it again; you can undo') : 'You can undo it for a few seconds', onSelect: () => void deleteVideo(v) },
  ];
  const videoRow = (v: LibraryVideoMeta) => (
    <Row key={v.id} compact={compact} picking={false} title={v.name} detail={videoDetail(v, uses?.get(v.id))}
      lead={<Thumb src={v.thumb || undefined} icon={isAudioType(v.type) ? 'wave' : 'play'} w={compact ? 64 : 80} h={compact ? 36 : 45} />}
      onPick={() => {}} onMenu={el => openMenu(el, videoMenu(v))} />
  );
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
  // Sounds of your own, several at once: kept with the drum pads' samples, for drum pads and the Audio engine's sample player.
  const uploadSounds = async (files: File[]) => {
    const ok = files.filter(isAudioFile), bad = files.filter(f => !isAudioFile(f));
    if (bad.length) toast.error(bad.length === 1 ? 'That isn’t a sound' : `${bad.length} files aren’t sounds`, { message: notAudioMessage(bad[0]) });
    if (!ok.length) return;
    setBusy(true);
    let added = 0;
    const failed: string[] = [];
    for (const f of ok) {
      try { await addVideoFile(f); added++; } catch { failed.push(f.name); }
    }
    setBusy(false);
    if (added) toast.success(added === 1 ? `Added “${ok[0].name}”` : `Added ${added} sounds`, { message: 'Use them on drum pads, or in an Audio engine rack’s sample player.' });
    if (failed.length) toast.error(`Couldn’t keep ${failed.join(', ')}`, { message: 'This browser may be out of room for files.' });
  };
  const capture = async () => {
    const id = await openCapture();
    if (id) setTab('images');
  };

  const toolbar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '0 0 10px' : '14px 18px 10px', borderBottom: `1px solid ${tk.border.subtle}` }}>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      <input ref={soundInput} type="file" multiple accept={audioAccept()} style={{ display: 'none' }}
        onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void uploadSounds(fs); }} />
      {tabs.length > 1 && (
        <Segmented<Tab> fill ariaLabel="Kind of background" value={tab} onChange={setTab} options={[
          { value: 'images', label: `Images${images ? ` (${images.length})` : ''}` },
          { value: 'palettes', label: `Palettes (${palettes.length})` },
          ...(tabs.includes('videos') ? [{ value: 'videos' as Tab, label: `Videos${videos ? ` (${vids.length})` : ''}` }] : []),
          ...(tabs.includes('sounds') ? [{ value: 'sounds' as Tab, label: `Sounds${videos ? ` (${snds.length})` : ''}` }] : []),
          ...(tabs.includes('linked') ? [{ value: 'linked' as Tab, label: pick ? 'Linked folder' : 'Linked' }] : []),
        ]} />
      )}
      {tab !== 'linked' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tab === 'images' ? (
          <>
            <Button size="sm" variant="primary" icon="camera" onClick={() => void capture()} title="Render a saved graph or an example at a moment you choose, and keep it as a picture">Capture from a graph…</Button>
            <Button size="sm" icon="import" disabled={busy} onClick={() => fileInput.current?.click()} title="PNG, JPG, WebP, GIF or SVG, kept as it is">{busy ? 'Adding…' : 'Import an image…'}</Button>
          </>
        ) : tab === 'videos' || tab === 'sounds' ? (
          <>
            {sound && <Button size="sm" variant="primary" icon="import" disabled={busy} onClick={() => soundInput.current?.click()} title="WAV, MP3, AIFF, FLAC, M4A or OGG files, several at once, for drum pads and the Audio engine’s sample player">{busy ? 'Adding…' : 'Upload sounds…'}</Button>}
            <Button size="sm" icon="trash" disabled={!unusedVideos.length} onClick={() => void cleanUp()}
              title={`Delete the ${kindWord}s no saved Play setup, presentation or the open graph uses`}>
              {unusedVideos.length ? `Clean up ${unusedVideos.length} unused (${formatSize(unusedVideos.reduce((n, v) => n + v.bytes, 0))})` : 'Nothing unused'}
            </Button>
            <span style={{ alignSelf: 'center', color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}` }}>{formatSize(media.reduce((n, v) => n + v.bytes, 0))} in all</span>
          </>
        ) : (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>New palette…</Button>
        )}
      </div>}
      {tab !== 'linked' && (tab === 'images' ? imgs.length : tab === 'videos' || tab === 'sounds' ? media.length : palettes.length) > 6 && (
        <Field aria-label="Search backgrounds" placeholder={tab === 'images' ? 'Search image backgrounds' : tab === 'videos' || tab === 'sounds' ? `Search ${kindWord}s` : 'Search palettes'} height={32} value={q} onChange={e => setQ(e.target.value)}
          leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />}
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      )}
    </div>
  );

  const empty = (text: string) => <div style={{ padding: '22px 8px', color: tk.text.faint, textAlign: 'center', lineHeight: 1.5, font: `500 12.5px/1.5 ${fontFamily.ui}` }}>{text}</div>;
  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, padding: '10px 6px 4px' };

  let body: React.ReactNode;
  if (tab === 'linked') {
    body = <LinkedBrowser filter={pick ? 'image' : 'any'} mode={pick ? 'file' : 'manage'} compact={compact} listHeight={compact ? '44dvh' : 360}
      onPick={p => { if (p.kind === 'file') onDone({ kind: 'linked', ref: p.ref, name: p.entry.name }); }} />;
  } else if (tab === 'images') {
    const found = needle ? imgs.filter(m => `${m.name} ${imageDetail(m)}`.toLowerCase().includes(needle)) : null;
    body = images === null ? empty('Loading…')
      : error ? empty(`Image backgrounds can’t be kept in this browser: ${error}`)
      : found ? (found.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{found.map(imageRow)}</div> : empty(`No image background called anything like “${q.trim()}”.`))
      : <FolderableList scopeKey={IMAGE_FOLDER_SCOPE} color={tk.accent.base} items={imgs.map(m => ({ id: m.id, label: m.name }))}
          renderItem={item => { const m = byId.get(item.id); return m ? imageRow(m) : null; }}
          emptyHint={empty('No image backgrounds yet. Capture one from a graph (any moment, with or without its layers), or import a picture.')} />;
  } else if (tab === 'videos' || tab === 'sounds') {
    const list = needle ? media.filter(v => v.name.toLowerCase().includes(needle)) : media;
    body = videos === null ? empty('Loading…')
      : videoError ? empty(`${sound ? 'Sounds' : 'Videos'} can’t be kept in this browser: ${videoError}`)
      : list.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{list.map(videoRow)}</div>
      : empty(needle ? `No ${kindWord} called anything like “${q.trim()}”.` : sound
        ? 'No sounds yet. Upload some, or add a Drum pads layer on Play and drop a sample on a pad.'
        : 'No videos yet. Add a Video layer on Play and pick a file, or drop a video on the picture.');
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
      {picking ? 'Choose one to use it. ' : ''}{tab === 'linked'
        ? 'Files in folders you linked (Files → Linked folders), used from where they are: not copied into the library, and not counted toward the storage limit.'
        : tab === 'sounds'
        ? 'Kept in this browser with the videos; Export everything, the workspace folder and the backup folder include them. Drum pads and the Audio engine’s sample player point at their sounds here, so a setup shared without them asks for the files.'
        : tab === 'videos'
        ? 'Kept in this browser; Export everything, the workspace folder and the backup folder include them. A Video layer points at its file here, so a setup shared without it asks for the file.'
        : 'Kept in this browser; Export everything and the backup folder include them. A setup that uses one keeps its own copy, so it works when shared.'}
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
    <Modal title={heading} subtitle={images ? `${plural(images.length, 'image')} · ${plural(mine.length, 'palette')} of yours${vids.length && !picking ? ` · ${plural(vids.length, 'video')}` : ''}${snds.length && !picking ? ` · ${plural(snds.length, 'sound')}` : ''}` : undefined} icon="overlay" onClose={() => onDone(null)} width={600} footer={note}>
      {toolbar}
      <div style={{ maxHeight: 'min(58vh, 540px)', overflowY: 'auto' }}>{content}</div>
      {popup}{editor}
    </Modal>
  );
}
