/**
 * LinkedBrowser — the one "From a linked folder" browser (docs/linked-folders.md),
 * used by every asset picker (through LinkedPickerHost) and by the Files
 * page's Linked folders view: which folder, its state (with the one-click
 * Allow again / Check again / Find it…), a lazy tree you walk into, a search
 * over the folder and everything under it, the picker's type filter,
 * thumbnails, posters and waveforms, and a preview of the chosen file.
 *
 *   mode 'file'     pick a file (double-click, or Use it)
 *   mode 'folder'   pick the folder you're in (its files that take the filter)
 *   mode 'manage'   just browse (the Files page): the type filter is yours to change
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import {
  UNSUPPORTED_TEXT, checkLinkedFolder, linkFolder, linkedSupport, listLinked, loadLinkedFolders, onLinkedChange, reconnectLinkedFolder, relocateLinkedFolder, searchLinked, useLinkedFolders,
  type LinkedEntry, type LinkedFolder, type LinkedStatus,
} from '../../files/linkedFolders';
import { firstFiles, hintFilter, linkedRef, mediaKindOf, pickerEntries, type LinkedFilter } from '../../files/linkedRefs';
import { cachedPreview, linkedPreview, type LinkedPreview } from '../../files/linkedThumbs';
import { FILTER_WORDS, lengthWords, sizeWords, type LinkedPick } from './linkedUi';

const KIND_ICON: Record<string, IconName> = { image: 'overlay', video: 'play', audio: 'wave', font: 'text' };
const FILTERS: { value: LinkedFilter; label: string }[] = [
  { value: 'any', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Sounds' }, { value: 'font', label: 'Fonts' },
];

export function statusWords(s: LinkedStatus | undefined): { text: string; tone: 'ok' | 'warn' | 'bad' | 'busy' } {
  switch (s) {
    case 'connected': return { text: 'Connected', tone: 'ok' };
    case 'permission': return { text: 'Needs your OK', tone: 'warn' };
    case 'missing': return { text: 'Not found', tone: 'bad' };
    default: return { text: 'Checking…', tone: 'busy' };
  }
}

export function StatusDot({ status, size = 8 }: { status: LinkedStatus | undefined; size?: number }) {
  const tk = useTokens();
  const { tone } = statusWords(status);
  const c = tone === 'ok' ? tk.status.success : tone === 'warn' ? tk.status.warning : tone === 'bad' ? tk.status.danger : tk.text.disabled;
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0, background: c }} />;
}

/** A folder's trouble and the one thing to do about it (null when it's fine). */
export function FolderTrouble({ folder, status, compact }: { folder: LinkedFolder; status: LinkedStatus | undefined; compact?: boolean }) {
  const tk = useTokens();
  const [busy, setBusy] = useState(false);
  if (status !== 'permission' && status !== 'missing') return null;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { toast.error('Couldn’t reach the folder', { message: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); } };
  const c = status === 'missing' ? tk.status.danger : tk.status.warning;
  return (
    <div role="status" style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'flex-start' : 'center', gap: 8, padding: '9px 12px', borderRadius: radius.md, background: alpha(c, 0.1), boxShadow: `inset 0 0 0 1px ${alpha(c, 0.3)}` }}>
      <span style={{ flex: 1, minWidth: 0, font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
        {status === 'permission'
          ? <><b style={{ color: tk.text.primary }}>Allow “{folder.name}” again.</b> The browser asks once per visit before the app may read a folder.</>
          : <><b style={{ color: tk.text.primary }}>“{folder.name}” isn’t there.</b> {folder.backend === 'desktop' ? 'Is the drive plugged in? Was it moved or renamed?' : 'It may have been moved, renamed or deleted.'} Setups that use its files show them as missing until it’s back.</>}
      </span>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {status === 'permission'
          ? <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => reconnectLinkedFolder(folder.id))}>Allow again</Button>
          : <>
            <Button size="sm" disabled={busy} onClick={() => void run(() => reconnectLinkedFolder(folder.id))}>Check again</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => relocateLinkedFolder(folder.id))} title="Point this linked folder at where it is now: files inside keep their paths, so setups find them again">Find it…</Button>
          </>}
      </span>
    </div>
  );
}

/** A file's small picture, made when it scrolls into view. */
function EntryThumb({ folderId, entry, w, h, big = false, onPreview }: { folderId: string; entry: LinkedEntry; w: number | string; h: number; big?: boolean; onPreview?: (p: LinkedPreview | null) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  const [p, setP] = useState<LinkedPreview | null>(() => cachedPreview(folderId, entry));
  useEffect(() => {
    setP(cachedPreview(folderId, entry));
    const el = ref.current;
    if (!el || entry.dir) return;
    let live = true;
    const go = () => { void linkedPreview(folderId, entry).then(x => { if (live) { setP(x); onPreview?.(x); } }); };
    if (typeof IntersectionObserver === 'undefined') { go(); return () => { live = false; }; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [folderId, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = mediaKindOf(entry.name);
  const wave = kind === 'audio';
  return (
    <span ref={ref} style={{ width: w, height: h, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: entry.dir ? tk.bg.field : wave || kind === 'font' ? alpha(tk.accent.base, 0.08) : tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.08)}` }}>
      {p?.thumb
        ? <img src={p.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: wave || kind === 'font' ? 'contain' : big ? 'contain' : 'cover', display: 'block' }} />
        : <Icon name={entry.dir ? 'folder' : KIND_ICON[kind ?? ''] ?? 'overlay'} size={big ? 26 : 14} style={{ color: entry.dir ? tk.text.muted : wave || kind === 'font' ? tk.accent.base : alpha('#ffffff', 0.45) }} />}
    </span>
  );
}

function detailOf(e: LinkedEntry, p: LinkedPreview | null): string {
  if (e.dir) return 'Folder';
  return [sizeWords(e.size), p?.width && p.height ? `${p.width} × ${p.height}` : '', p?.duration ? lengthWords(p.duration) : ''].filter(Boolean).join(' · ');
}

function Row({ folderId, e, selected, onClick, onDouble, compact, showPath }: { folderId: string; e: LinkedEntry; selected: boolean; onClick: () => void; onDouble?: () => void; compact: boolean; showPath: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  // The detail line fills in once the thumbnail's preview is made (its size, length).
  const [p, setP] = useState<LinkedPreview | null>(() => cachedPreview(folderId, e));
  return (
    <button type="button" onClick={onClick} onDoubleClick={onDouble} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-pressed={selected}
      title={e.path}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: compact ? 48 : 44, padding: '4px 8px 4px 6px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
        background: selected ? tk.bg.selected : hover ? tk.bg.hover : 'transparent', color: tk.text.primary,
      }}>
      <EntryThumb folderId={folderId} entry={e} w={compact ? 56 : 64} h={compact ? 34 : 36} onPreview={setP} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `${e.dir ? 600 : 500} 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? tk.accent.text : tk.text.primary }}>{e.name}</span>
        <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{showPath && e.path.includes('/') ? `${e.path.slice(0, e.path.lastIndexOf('/'))} · ` : ''}{detailOf(e, p)}</span>
      </span>
      {e.dir && <Icon name="chevR" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />}
    </button>
  );
}

export interface LinkedBrowserProps {
  filter: LinkedFilter;
  mode: 'file' | 'folder' | 'manage';
  onPick?: (p: LinkedPick) => void;
  compact?: boolean;
  /** Start in this folder (and sub-folder). */
  folderId?: string;
  dir?: string;
  /** The list's height (the rest of the window sets it). */
  listHeight?: number | string;
  /** Extra actions for the manage view's header (rename, unlink…). */
  folderActions?: (f: LinkedFolder) => ReactNode;
  onFolderChange?: (id: string) => void;
}

export function LinkedBrowser({ filter: pickerFilter, mode, onPick, compact = false, folderId: startFolder, dir: startDir = '', listHeight = 360, folderActions, onFolderChange }: LinkedBrowserProps) {
  const tk = useTokens();
  const { folders, status, loaded } = useLinkedFolders();
  const support = linkedSupport();
  useEffect(() => { void loadLinkedFolders(); }, []);
  const [folderId, setFolderId] = useState<string>(startFolder ?? '');
  const folder = folders.find(f => f.id === folderId) ?? null;
  // The first folder (the picker's kind first) when none is chosen, or the chosen one went.
  useEffect(() => {
    if (folder || !folders.length) return;
    const want = folders.find(f => pickerFilter !== 'any' && hintFilter(f.kind) === pickerFilter) ?? folders[0];
    setFolderId(want.id);
  }, [folder, folders, pickerFilter]);
  useEffect(() => { if (folderId) onFolderChange?.(folderId); }, [folderId, onFolderChange]);
  useEffect(() => { if (startFolder) setFolderId(startFolder); }, [startFolder]);

  const [dir, setDir] = useState(startDir);
  const [typeFilter, setTypeFilter] = useState<LinkedFilter>(pickerFilter);
  // In the Files view the filter follows the folder's kind until you change it.
  useEffect(() => { if (mode === 'manage' && folder) setTypeFilter(hintFilter(folder.kind)); }, [mode, folder?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter = mode === 'manage' ? typeFilter : pickerFilter;
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<LinkedEntry[] | null>(null);
  const [found, setFound] = useState<{ files: LinkedEntry[]; complete: boolean } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<LinkedEntry | null>(null);
  const [version, setVersion] = useState(0);
  const st = folder ? status[folder.id] : undefined;

  useEffect(() => onLinkedChange(() => setVersion(v => v + 1)), []);
  // A folder that comes back (allowed again, plugged in) lists again.
  useEffect(() => { setVersion(v => v + 1); }, [st]);

  useEffect(() => {
    if (!folder) { setEntries(null); return; }
    let live = true;
    setError('');
    listLinked(folder.id, dir).then(es => { if (live) setEntries(es); }, e => {
      if (!live) return;
      // A sub-folder that went: back to the top.
      if (dir && (e as { reason?: string }).reason === 'file') { setDir(''); return; }
      setEntries(null); setError(e instanceof Error ? e.message : String(e));
    });
    return () => { live = false; };
  }, [folder, dir, version]);

  useEffect(() => {
    const needle = q.trim();
    if (!folder || !needle) { setFound(null); return; }
    let live = true;
    const t = window.setTimeout(() => { searchLinked(folder.id, needle, filter, { dir }).then(r => { if (live) setFound(r); }, () => { if (live) setFound({ files: [], complete: true }); }); }, 180);
    return () => { live = false; window.clearTimeout(t); };
  }, [folder, q, filter, dir, version]);

  useEffect(() => { setSelected(null); }, [folderId, dir]);

  const shown = useMemo(() => (found ? found.files : entries ? pickerEntries(entries, filter) : []), [found, entries, filter]);
  const folderFiles = useMemo(() => (entries ? firstFiles(entries, filter, 1000) : []), [entries, filter]);
  const words = FILTER_WORDS[filter];

  const link = async () => {
    try { const f = await linkFolder({ kind: pickerFilter === 'audio' ? 'samples' : pickerFilter === 'image' ? 'images' : pickerFilter === 'video' ? 'videos' : pickerFilter === 'font' ? 'fonts' : undefined }); if (f) { setFolderId(f.id); setDir(''); } }
    catch (e) { toast.error('Couldn’t link that folder', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const pickFile = (e: LinkedEntry) => { if (mode === 'file' && folder && !e.dir) onPick?.({ kind: 'file', ref: linkedRef(folder.id, e.path), folderId: folder.id, entry: e }); };

  // ── Nothing to show yet ──
  if (support === 'none' && !folders.length) {
    return <Empty icon="link" title="Linked folders aren’t available here" text={UNSUPPORTED_TEXT} />;
  }
  if (loaded && !folders.length) {
    return (
      <Empty icon="link" title="No linked folders yet" text={`Link a folder on your computer (a samples folder, an image folder, a video folder, fonts): its files are used from where they are, not copied into the library, and don’t count toward the storage limit.`}
        action={<Button variant="primary" icon="folder" onClick={() => void link()}>Link a folder…</Button>} />
    );
  }

  const crumbs = folder ? [{ label: folder.name, dir: '' }, ...(dir ? dir.split('/').map((p, i, all) => ({ label: p, dir: all.slice(0, i + 1).join('/') })) : [])] : [];
  const preview = selected && folder ? <Preview folderId={folder.id} e={selected} compact={compact} mode={mode} onUse={() => pickFile(selected)} /> : null;

  const list = (
    <div role="list" aria-label={`${folder?.name ?? 'Folder'} contents`} style={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
      {error ? <Note>{error}</Note>
        : !entries && !found ? <Note>{st === 'checking' || !st ? 'Opening…' : ' '}</Note>
        : !shown.length ? <Note>{found ? `No ${words.many} called anything like “${q.trim()}”${found.complete ? '' : ' (stopped after the first 400 folders)'}.` : `No ${words.many} here${dir ? '' : ' at the top'}.`}</Note>
        : shown.map(e => (
          <Row key={e.path} folderId={folder!.id} e={e} compact={compact} showPath={!!found} selected={selected?.path === e.path}
            onClick={() => { if (e.dir) { setDir(e.path); setQ(''); } else setSelected(e); }}
            onDouble={mode === 'file' && !e.dir ? () => pickFile(e) : undefined} />
        ))}
      {found && !found.complete && shown.length > 0 && <Note>Showing the first {shown.length}. Type more of the name to narrow it.</Note>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot status={st} />
          <Select ariaLabel="Linked folder" value={folderId} height={32} style={{ flex: 1, minWidth: 0 }}
            options={folders.map(f => ({ value: f.id, label: `${f.name}${status[f.id] === 'connected' || status[f.id] === 'checking' ? '' : ` (${statusWords(status[f.id]).text.toLowerCase()})`}` }))}
            onChange={id => { setFolderId(id); setDir(''); setQ(''); }} />
        </div>
        {folder && folderActions?.(folder)}
        {support !== 'none' && <Button size="sm" icon="plus" onClick={() => void link()} title="Link another folder on this computer">{compact ? 'Link' : 'Link a folder…'}</Button>}
      </div>
      {folder && <FolderTrouble folder={folder} status={st} compact={compact} />}
      {folder && st !== 'missing' && st !== 'permission' && <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: compact ? 'wrap' : 'nowrap' }}>
          <nav aria-label="Where you are" style={{ flex: '1 1 160px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 2, overflow: 'hidden' }}>
            {dir && <IconButton icon="chevL" size="sm" label="Up one folder" tooltip={false} onClick={() => setDir(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')} />}
            {crumbs.map((c, i) => (
              <span key={c.dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, flexShrink: i === crumbs.length - 1 ? 1 : 0 }}>
                {i > 0 && <Icon name="chevR" size={11} style={{ color: tk.text.faint, flexShrink: 0 }} />}
                <button type="button" onClick={() => { setDir(c.dir); setQ(''); }} disabled={i === crumbs.length - 1}
                  style={{ border: 0, background: 'none', padding: '2px 4px', borderRadius: 5, cursor: i === crumbs.length - 1 ? 'default' : 'pointer', color: i === crumbs.length - 1 ? tk.text.primary : tk.text.muted, font: `${i === crumbs.length - 1 ? 600 : 500} 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{c.label}</button>
              </span>
            ))}
          </nav>
          <Field aria-label={`Search ${words.many}`} placeholder={`Search ${dir ? 'here and below' : words.many}`} height={30} value={q} onChange={e => setQ(e.target.value)}
            style={{ flex: compact ? '1 1 100%' : '0 1 220px' }}
            leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />}
            onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
        </div>
        {mode === 'manage'
          ? <Segmented<LinkedFilter> size="sm" ariaLabel="Show" value={typeFilter} onChange={setTypeFilter} options={FILTERS} wrap />
          : filter !== 'any' && <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>Showing {words.many} and folders.</span>}
        <div style={{ display: 'flex', gap: 12, minHeight: 0, flexDirection: compact ? 'column' : 'row' }}>
          <div style={{ flex: 1, minWidth: 0, maxHeight: listHeight, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>{list}</div>
          {!compact && mode !== 'folder' && (
            <div style={{ width: 220, flexShrink: 0 }}>{preview ?? <Note>{mode === 'file' ? `Choose a ${words.one} to see it here. Double-click to use it straight away.` : `Choose a ${words.one} to see it here.`}</Note>}</div>
          )}
          {compact && mode !== 'folder' && preview}
        </div>
        {mode === 'folder' && folder && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 4, borderTop: `1px solid ${tk.border.subtle}` }}>
            <span style={{ flex: 1, minWidth: 0, color: tk.text.muted, font: `12px/1.45 ${fontFamily.ui}` }}>
              {folderFiles.length ? `${folderFiles.length} ${folderFiles.length === 1 ? words.one : words.many} in “${crumbs[crumbs.length - 1]?.label}” (not in the folders inside it).` : `No ${words.many} right in this folder: open the one that has them.`}
            </span>
            <Button variant="primary" icon="check" disabled={!folderFiles.length} onClick={() => onPick?.({ kind: 'folder', folderId: folder.id, dir, files: folderFiles })}>Use this folder</Button>
          </div>
        )}
      </>}
    </div>
  );
}

function Preview({ folderId, e, compact, mode, onUse }: { folderId: string; e: LinkedEntry; compact: boolean; mode: LinkedBrowserProps['mode']; onUse: () => void }) {
  const tk = useTokens();
  const [p, setP] = useState<LinkedPreview | null>(() => cachedPreview(folderId, e));
  useEffect(() => { let live = true; setP(cachedPreview(folderId, e)); void linkedPreview(folderId, e).then(x => { if (live) setP(x); }); return () => { live = false; }; }, [folderId, e]);
  return (
    <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', gap: 10, alignItems: compact ? 'center' : 'stretch', padding: compact ? 8 : 0, borderRadius: radius.md, background: compact ? tk.bg.field : 'transparent' }}>
      {compact ? <EntryThumb folderId={folderId} entry={e} w={72} h={44} /> : <EntryThumb folderId={folderId} entry={e} w="100%" h={124} big />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal', wordBreak: 'break-word' }}>{e.name}</span>
        <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>{detailOf(e, p)}</span>
        {!compact && <span style={{ font: `11px/1.4 ${fontFamily.ui}`, color: tk.text.faint, wordBreak: 'break-all' }}>{e.path}</span>}
      </div>
      {mode === 'file' && <Button size="sm" variant="primary" icon="check" onClick={onUse}>Use it</Button>}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ padding: '16px 8px', color: tk.text.faint, textAlign: 'center', font: `500 12px/1.5 ${fontFamily.ui}` }}>{children}</div>;
}

function Empty({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '26px 16px' }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text }}><Icon name={icon} size={19} /></span>
      <span style={{ font: `600 13.5px ${fontFamily.ui}`, color: tk.text.primary }}>{title}</span>
      <span style={{ font: `12px/1.5 ${fontFamily.ui}`, color: tk.text.muted, maxWidth: 420 }}>{text}</span>
      {action}
    </div>
  );
}

/** Check every folder again (the Files view's refresh). */
export async function recheckFolders(folders: readonly LinkedFolder[]): Promise<void> { await Promise.all(folders.map(f => checkLinkedFolder(f.id))); }
