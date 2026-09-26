/**
 * LibraryPanel — everything Playfield keeps in this browser, at a glance:
 * how many graphs, versions, presets and published nodes, how much room they
 * take against the browser's limit, export/import of all of it, the backup
 * folder that keeps a copy outside the browser (utils/backupFolder.ts), and
 * where recordings are saved (utils/recordingsFolder.ts).
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { exportEverything, importEverything } from '../../utils/libraryActions';
import { backupNow, backupStatus, chooseBackupFolder, onBackupStatus, reconnectBackupFolder, resetBackupFolder, restoreFromFolder, stopBrowserBackups } from '../../utils/backupFolder';
import { formatSize, LIBRARY_REFRESH_EVENTS, libraryStats, STORAGE_LIMIT, takeSnapshot, type LibraryKind, type LibraryStats } from '../../utils/library';
import { whenSaved } from '../../store/graphVersions';
import { toast } from '../ui/toastStore';
import { RecordingsSetting } from './RecordingsSetting';

const run = (fn: () => Promise<unknown>) => () => { fn().catch(e => toast.error('That didn’t work', { message: e instanceof Error ? e.message : String(e) })); };

const KIND_LABELS: Record<LibraryKind, string> = {
  graphs: 'Graphs', versions: 'Earlier versions', 'group presets': 'Group presets', functions: 'Functions', expressions: 'Expressions',
  transforms: 'Transforms', 'keyframe presets': 'Keyframe presets', 'published nodes': 'Published nodes', palettes: 'Palettes', 'glsl shaders': 'GLSL shaders', settings: 'Settings',
};
const PRESET_KINDS: LibraryKind[] = ['group presets', 'functions', 'expressions', 'transforms', 'keyframe presets'];

/** The library's numbers, kept current while shown (after saves, imports, and every few seconds). */
function useLibraryStats(): LibraryStats {
  const [s, setS] = useState(() => libraryStats(takeSnapshot()));
  useEffect(() => {
    const refresh = () => setS(libraryStats(takeSnapshot()));
    for (const ev of LIBRARY_REFRESH_EVENTS) window.addEventListener(ev, refresh);
    const off = onBackupStatus(refresh);
    const id = window.setInterval(refresh, 5000);
    return () => { for (const ev of LIBRARY_REFRESH_EVENTS) window.removeEventListener(ev, refresh); off(); window.clearInterval(id); };
  }, []);
  return s;
}

export function LibraryPanel({ inCard = false }: { inCard?: boolean } = {}) {
  const tk = useTokens();
  const [st, setSt] = useState(backupStatus);
  const stats = useLibraryStats();
  const [showAll, setShowAll] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => onBackupStatus(setSt), []);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 15000); return () => window.clearInterval(id); }, []);
  const label = { color: tk.text.secondary, font: `650 11px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const };
  const note = { color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}` };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
  const k = stats.kinds;
  const presets = PRESET_KINDS.reduce((n, x) => n + k[x].count, 0);
  const used = stats.total / STORAGE_LIMIT;
  const tiles: Array<[string, string, string]> = [
    ['Graphs', `${k.graphs.count}`, `${k.versions.count} earlier version${k.versions.count === 1 ? '' : 's'} · ${stats.playSetups} with Play`],
    ['Presets', `${presets}`, PRESET_KINDS.filter(x => k[x].count).map(x => `${k[x].count} ${KIND_LABELS[x].toLowerCase()}`).join(' · ') || 'none yet'],
    ['Published nodes', `${k['published nodes'].count}`, `${k.palettes.count} palette${k.palettes.count === 1 ? '' : 's'} · ${k['glsl shaders'].count} GLSL`],
    ['Saved data', formatSize(stats.total), `${Math.round(used * 100)}% of the browser’s ~5 MB`],
  ];
  const kinds = (Object.keys(k) as LibraryKind[]).filter(x => k[x].size > 0).sort((a, b) => k[b].size - k[a].size);
  const biggest = Math.max(1, ...kinds.map(x => k[x].size));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!inCard && <span style={label}>Library</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, borderRadius: radius.md, overflow: 'hidden', background: tk.border.subtle }}>
        {tiles.map(([l, v, sub]) => (
          <div key={l} style={{ padding: '8px 10px', background: tk.bg.panel, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: tk.text.muted }}>{l}</div>
            <div style={{ font: `650 17px ${fontFamily.ui}`, color: l === 'Saved data' && used > 0.8 ? tk.status.warningText : tk.text.primary }}>{v}</div>
            <div title={sub} style={{ fontSize: 10.5, color: tk.text.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
          </div>
        ))}
      </div>
      <div title={`${formatSize(stats.total)} of about ${formatSize(STORAGE_LIMIT)}: when it's full, saving stops working`}>
        <div style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, used * 100)}%`, height: '100%', background: used > 0.8 ? tk.status.warning : tk.accent.base }} />
        </div>
        {used > 0.8 && <div style={{ ...note, color: tk.status.warningText, marginTop: 4 }}>The browser’s room for saved work is nearly full. Export everything, then delete old versions or graphs you don’t need.</div>}
      </div>
      <button type="button" onClick={() => setShowAll(v => !v)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}` }}>
        {showAll ? 'Hide the breakdown' : 'What takes the room'}
      </button>
      {showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {kinds.map(x => (
            <div key={x} style={{ display: 'grid', gridTemplateColumns: '112px 1fr 56px', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary }}>{KIND_LABELS[x]}{x !== 'settings' && <span style={{ color: tk.text.faint }}> · {k[x].count}</span>}</span>
              <span style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(k[x].size / biggest) * 100}%`, background: tk.accent.base }} /></span>
              <span style={{ textAlign: 'right', font: `500 11px ${fontFamily.mono}`, color: tk.text.muted }}>{formatSize(k[x].size)}</span>
            </div>
          ))}
        </div>
      )}
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
          <span style={note}>The browser asks again on each visit before Playfield can write to “{st.folder}”.</span>
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
            <Button size="sm" icon="import" onClick={run(restoreFromFolder)} title="Add what's in the folder's library.json back into Playfield (never overwrites)">Restore from it</Button>
            <Button size="sm" variant="ghost" icon="folder" onClick={run(chooseBackupFolder)}>Change…</Button>
            <Button size="sm" variant="ghost" icon="reset" onClick={run(resetBackupFolder)} title={st.support === 'desktop' ? 'Back to Documents/Shader Studio' : 'Forget this folder'}>{st.support === 'desktop' ? 'Default' : 'Stop'}</Button>
          </div>
        </>
      )}
      {st.canRestore && <span style={{ ...note, color: tk.status.warningText }}>Playfield’s storage is empty but the folder has your library: Restore from it.</span>}
      {st.error && <span style={{ ...note, color: tk.status.danger }}>Couldn’t write the backup: {st.error}</span>}

      <span style={{ ...label, marginTop: 8 }}>Save recordings to</span>
      <RecordingsSetting />
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
  const stats = useLibraryStats();
  const counts = `${stats.kinds.graphs.count} graph${stats.kinds.graphs.count === 1 ? '' : 's'} · ${formatSize(stats.total)}`;
  const line = `${counts} · ${st.support === 'none' ? 'no backup folder here'
    : !st.folder ? 'no backup folder yet'
    : st.needsPermission ? 'allow the backup folder again'
    : st.error ? 'backup failed'
    : `backed up${st.lastBackup ? ` ${whenSaved(st.lastBackup)}` : ''}`}`;
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
