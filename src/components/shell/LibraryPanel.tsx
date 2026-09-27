/**
 * LibraryPanel — everything Playfield keeps in this browser, at a glance:
 * how many graphs, versions, presets and published nodes, how much room they
 * take against the browser's limit, export/import of all of it, the workspace
 * folder that holds it all as files (workspace/workspace.ts), and where
 * recordings are saved (utils/recordingsFolder.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { exportEverything, exportSet, importEverything } from '../../utils/libraryActions';
import { onWorkspaceStatus, useWorkspaceStatus } from '../../workspace/workspace';
import { WorkspaceView } from '../workspace/WorkspacePanel';
import { summary } from '../workspace/workspaceUi';
import { countInSet, DOWNLOAD_SETS, formatSize, LIBRARY_REFRESH_EVENTS, libraryStats, STORAGE_LIMIT, takeSnapshot, type LibraryKind, type LibraryStats } from '../../utils/library';
import { toast } from '../ui/toastStore';
import { RecordingsSetting } from './RecordingsSetting';
import { openBackgrounds, openCapture } from '../backgrounds/backgroundsUi';
import { useBackgroundImages } from '../backgrounds/useBackgrounds';

const run = (fn: () => Promise<unknown>) => () => { fn().catch(e => toast.error('That didn’t work', { message: e instanceof Error ? e.message : String(e) })); };

const KIND_LABELS: Record<LibraryKind, string> = {
  graphs: 'Graphs', versions: 'Earlier versions', 'group presets': 'Group presets', functions: 'Functions', expressions: 'Expressions',
  transforms: 'Transforms', 'keyframe presets': 'Keyframe presets', 'published nodes': 'Published nodes', presentations: 'Presentations', palettes: 'Palettes', 'glsl shaders': 'GLSL shaders', backgrounds: 'Background palettes', settings: 'Settings',
};
const PRESET_KINDS: LibraryKind[] = ['group presets', 'functions', 'expressions', 'transforms', 'keyframe presets'];

/** The library's numbers, kept current while shown (after saves, imports, and every few seconds). */
function useLibraryStats(): LibraryStats {
  const [s, setS] = useState(() => libraryStats(takeSnapshot()));
  useEffect(() => {
    const refresh = () => setS(libraryStats(takeSnapshot()));
    for (const ev of LIBRARY_REFRESH_EVENTS) window.addEventListener(ev, refresh);
    const off = onWorkspaceStatus(refresh);
    const id = window.setInterval(refresh, 5000);
    return () => { for (const ev of LIBRARY_REFRESH_EVENTS) window.removeEventListener(ev, refresh); off(); window.clearInterval(id); };
  }, []);
  return s;
}

export function LibraryPanel({ inCard = false }: { inCard?: boolean } = {}) {
  const tk = useTokens();
  const dlRef = useRef<HTMLSpanElement>(null);
  const [dlMenu, setDlMenu] = useState<{ x: number; y: number } | null>(null);
  const stats = useLibraryStats();
  const { images } = useBackgroundImages();
  const imageCount = images?.length ?? 0;
  const imageBytes = (images ?? []).reduce((n, m) => n + m.bytes, 0);
  const [showAll, setShowAll] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 15000); return () => window.clearInterval(id); }, []);
  const label = { color: tk.text.secondary, font: `650 11px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const };
  const note = { color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}` };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
  const k = stats.kinds;
  const presets = PRESET_KINDS.reduce((n, x) => n + k[x].count, 0);
  const used = stats.total / STORAGE_LIMIT;
  const tiles: Array<[string, string, string]> = [
    ['Graphs', `${k.graphs.count}`, `${k.versions.count} earlier version${k.versions.count === 1 ? '' : 's'} · ${stats.playSetups} with Play`],
    ['Presentations', `${k.presentations.count}`, k.presentations.count ? `${formatSize(k.presentations.size)}, Plays included` : 'none yet'],
    ['Presets', `${presets}`, PRESET_KINDS.filter(x => k[x].count).map(x => `${k[x].count} ${KIND_LABELS[x].toLowerCase()}`).join(' · ') || 'none yet'],
    ['Published nodes', `${k['published nodes'].count}`, `${k.palettes.count} palette${k.palettes.count === 1 ? '' : 's'} · ${k['glsl shaders'].count} GLSL`],
    ['Backgrounds', `${imageCount + k.backgrounds.count}`, imageCount + k.backgrounds.count ? `${imageCount} image${imageCount === 1 ? '' : 's'} (${formatSize(imageBytes)}) · ${k.backgrounds.count} palette${k.backgrounds.count === 1 ? '' : 's'}` : 'none yet'],
    ['Saved data', formatSize(stats.total), `${Math.round(used * 100)}% of the browser’s ~5 MB`],
  ];
  const kinds = (Object.keys(k) as LibraryKind[]).filter(x => k[x].size > 0).sort((a, b) => k[b].size - k[a].size);
  const biggest = Math.max(1, ...kinds.map(x => k[x].size));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!inCard && <span style={label}>Library</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, borderRadius: radius.md, overflow: 'hidden', background: tk.border.subtle }}>
        {tiles.map(([l, v, sub], i) => (
          <div key={l} style={{ padding: '8px 10px', background: tk.bg.panel, minWidth: 0, gridColumn: i === tiles.length - 1 && tiles.length % 2 === 1 ? '1 / -1' : undefined }}>
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
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setShowAll(v => !v)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}` }}>
          {showAll ? 'Hide the breakdown' : 'What takes the room'}
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new Event('open-files-page'))} title="Everything saved, item by item: sizes, what uses what, clean up, download and install" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}` }}>
          Manage in Files →
        </button>
      </div>
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
        <Button size="sm" icon="export" onClick={run(exportEverything)} title="One ZIP: library.json (for importing) plus every graph, presentation and preset as files in folders">Export everything</Button>
        <span ref={dlRef} style={{ display: 'inline-flex' }}>
          <Button size="sm" icon="export" title="One kind of thing as a ZIP of plain files: just the graphs, the presentations (.present.json), the GLSL shaders (.glsl), the functions, nodes or presets" onClick={() => { const r = dlRef.current?.getBoundingClientRect(); setDlMenu(r ? { x: r.left, y: r.bottom + 4 } : null); }}>Download…</Button>
        </span>
        {dlMenu && (
          <Menu x={dlMenu.x} y={dlMenu.y} minWidth={280} onClose={() => setDlMenu(null)}
            items={DOWNLOAD_SETS.map(d => { const n = d.id === 'everything' ? 0 : countInSet(takeSnapshot(), d.id) + (d.id === 'backgrounds' ? imageCount : 0); return { label: d.id === 'everything' ? d.label : `${d.label} (${n})`, hint: d.hint, icon: 'export' as const, disabled: d.id !== 'everything' && n === 0, onSelect: () => { void exportSet(d.id); } }; })} />
        )}
        <Button size="sm" icon="import" onClick={run(importEverything)} title="A library ZIP or library.json (older Backup ZIPs work too). Adds to what you have; never overwrites.">Import a library…</Button>
      </div>

      <span style={{ ...label, marginTop: 8 }}>Backgrounds</span>
      <span style={note}>Pictures and palettes for Play’s Background and for presentations. Capture a still from any graph (at any moment, with or without its layers), or import a picture.</span>
      <div style={row}>
        <Button size="sm" icon="overlay" onClick={() => { void openBackgrounds(); }} title="Image backgrounds and palettes: folders, rename, download, delete">Backgrounds{imageCount + k.backgrounds.count ? ` (${imageCount + k.backgrounds.count})` : ''}…</Button>
        <Button size="sm" icon="camera" onClick={() => { void openCapture(); }} title="Render a saved graph or an example at a moment you choose and keep it as an image background">Capture from a graph…</Button>
      </div>

      <span style={{ ...label, marginTop: 8 }}>Workspace folder</span>
      <WorkspaceView inSettings />

      <span style={{ ...label, marginTop: 8 }}>Save recordings to</span>
      <RecordingsSetting />
    </div>
  );
}

const OPEN_KEY = 'shader-studio:settings:libraryOpen';

/**
 * The Library in the Graphs sidebar: one line saying how the workspace folder
 * is doing (or that there isn't one), opening into the whole panel.
 */
export function LibraryCard() {
  const tk = useTokens();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  const st = useWorkspaceStatus();
  const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* preference only */ } return !o; });
  const ws = summary(st);
  const stats = useLibraryStats();
  const pres = stats.kinds.presentations.count;
  const counts = `${stats.kinds.graphs.count} graph${stats.kinds.graphs.count === 1 ? '' : 's'}${pres ? ` · ${pres} presentation${pres === 1 ? '' : 's'}` : ''} · ${formatSize(stats.total)}`;
  const line = `${counts} · ${st.state === 'off' ? (st.support === 'none' ? 'kept in this browser' : 'no workspace folder yet') : ws.line.toLowerCase()}`;
  return (
    <div style={{ marginBottom: 8, borderRadius: radius.md, background: tk.bg.field }}>
      <button type="button" onClick={toggle} aria-expanded={open} title={st.folder ?? undefined}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, textAlign: 'left' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: ws.tone === 'ok' ? tk.status.success : ws.tone === 'bad' ? tk.status.danger : ws.tone === 'warn' ? tk.status.warning : ws.tone === 'busy' ? tk.accent.base : tk.text.disabled }} />
        <span>Library</span>
        <span style={{ flex: 1, minWidth: 0, color: tk.text.faint, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
        <span style={{ color: tk.text.faint }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ padding: '2px 10px 12px' }}><LibraryPanel inCard /></div>}
    </div>
  );
}
