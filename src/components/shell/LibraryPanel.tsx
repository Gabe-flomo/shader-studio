/**
 * LibraryPanel — Preferences → Library: export everything Shader Studio keeps
 * as one ZIP, import one back, and the backup folder that keeps a copy
 * outside the browser (utils/backupFolder.ts).
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { exportEverything, importEverything, librarySummary } from '../../utils/libraryActions';
import { backupNow, backupStatus, chooseBackupFolder, onBackupStatus, reconnectBackupFolder, restoreFromFolder, stopBrowserBackups } from '../../utils/backupFolder';
import { whenSaved } from '../../store/graphVersions';
import { toast } from '../ui/toastStore';

const run = (fn: () => Promise<unknown>) => () => { fn().catch(e => toast.error('That didn’t work', { message: e instanceof Error ? e.message : String(e) })); };

export function LibraryPanel({ inCard = false }: { inCard?: boolean } = {}) {
  const tk = useTokens();
  const [st, setSt] = useState(backupStatus);
  const [summary, setSummary] = useState(librarySummary);
  const [, tick] = useState(0);
  useEffect(() => onBackupStatus(s => { setSt(s); setSummary(librarySummary()); }), []);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 15000); return () => window.clearInterval(id); }, []);
  const label = { color: tk.text.secondary, font: `650 11px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const };
  const note = { color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}` };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!inCard && <span style={label}>Library</span>}
      <span style={note}>Everything you’ve saved here: {summary}, with graph versions, folders, palettes and settings.</span>
      <div style={row}>
        <Button size="sm" icon="export" onClick={run(exportEverything)} title="One ZIP: library.json (for importing) plus every graph and preset as files in folders">Export everything</Button>
        <Button size="sm" icon="import" onClick={run(importEverything)} title="A library ZIP or library.json (older Backup ZIPs work too). Adds to what you have; never overwrites.">Import a library…</Button>
      </div>

      <span style={{ ...label, marginTop: 8 }}>Backup folder</span>
      {st.support === 'none' ? (
        <span style={note}>This browser can’t keep a folder up to date (Safari, Firefox and phones can’t write to folders). Use Export everything now and then. On a computer, Chrome, Edge or the desktop app keep a backup folder for you.</span>
      ) : !st.folder ? (
        <>
          <span style={note}>Keep a copy of everything in a folder on this computer, updated a few seconds after each save. If this browser’s data is ever cleared, restore from it.</span>
          <div style={row}><Button size="sm" variant="primary" icon="folder" onClick={run(chooseBackupFolder)}>Choose a backup folder…</Button></div>
        </>
      ) : st.needsPermission ? (
        <>
          <span style={note}>The browser asks again on each visit before Shader Studio can write to “{st.folder}”.</span>
          <div style={row}>
            <Button size="sm" variant="primary" icon="folder" onClick={run(reconnectBackupFolder)}>Allow “{st.folder}” again</Button>
            <Button size="sm" variant="ghost" onClick={run(stopBrowserBackups)}>Stop backing up</Button>
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.success, 0.1), display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, wordBreak: 'break-all' }}>{st.folder}</span>
            <span style={note}>{st.lastBackup ? `Backed up ${whenSaved(st.lastBackup)}` : 'Not backed up yet'} · library.json, a daily copy in history/, and everything as files in folders</span>
          </div>
          <div style={row}>
            <Button size="sm" icon="save" onClick={run(() => backupNow(true))}>Back up now</Button>
            <Button size="sm" icon="import" onClick={run(restoreFromFolder)} title="Add what's in the folder's library.json back into Shader Studio (never overwrites)">Restore from it</Button>
            <Button size="sm" variant="ghost" icon="folder" onClick={run(chooseBackupFolder)}>Change folder…</Button>
            {st.support === 'browser' && <Button size="sm" variant="ghost" onClick={run(stopBrowserBackups)}>Stop</Button>}
          </div>
        </>
      )}
      {st.canRestore && <span style={{ ...note, color: tk.status.warningText }}>Shader Studio’s storage is empty but the folder has your library: Restore from it.</span>}
      {st.error && <span style={{ ...note, color: tk.status.danger }}>Couldn’t write the backup: {st.error}</span>}
    </div>
  );
}

const OPEN_KEY = 'shader-studio:settings:libraryOpen';

/**
 * The Library in the Graphs sidebar: one line saying where the backup is (or
 * that there isn't one), opening into the whole panel.
 */
export function LibraryCard() {
  const tk = useTokens();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  const [st, setSt] = useState(backupStatus);
  useEffect(() => onBackupStatus(setSt), []);
  const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* preference only */ } return !o; });
  const ok = st.folder && !st.needsPermission && !st.error;
  const line = st.support === 'none' ? 'Export everything to keep a copy'
    : !st.folder ? 'No backup folder yet'
    : st.needsPermission ? `Allow “${st.folder}” again`
    : st.error ? 'Backup failed'
    : `Backup · ${st.folder.split(/[\\/]/).pop()}${st.lastBackup ? ` · ${whenSaved(st.lastBackup)}` : ''}`;
  return (
    <div style={{ marginBottom: 8, borderRadius: radius.md, background: tk.bg.field }}>
      <button type="button" onClick={toggle} aria-expanded={open} title={st.folder ?? undefined}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, textAlign: 'left' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: ok ? tk.status.success : st.error || st.canRestore ? tk.status.danger : st.needsPermission ? tk.status.warning : tk.text.disabled }} />
        <span>Library</span>
        <span style={{ flex: 1, minWidth: 0, color: tk.text.faint, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
        <span style={{ color: tk.text.faint }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ padding: '2px 10px 12px' }}><LibraryPanel inCard /></div>}
    </div>
  );
}
