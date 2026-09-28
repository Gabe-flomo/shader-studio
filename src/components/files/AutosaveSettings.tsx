/**
 * Autosave and crash recovery in App settings (docs/crash-recovery.md): how
 * often the open project is autosaved, the autosaves there are (open one), and
 * on the desktop the plug-ins switched off for crashing (Try again).
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { askConfirm } from '../ui/dialogStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { AUTOSAVE_MODES, type AutosaveMode } from '../../files/autosave';
import { formatClock, restoreSnapshot, useAutosave } from '../../files/recovery';
import { crashedPlugins, usePluginSettings } from '../../lib/pluginSettings';
import { retryPlugin } from '../../lib/pluginSafety';
import { cardStyle } from './fileUiShared';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function Row({ label, detail, children, first }: { label: string; detail?: string; children?: React.ReactNode; first?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}` }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {detail && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{detail}</span>}
      </div>
      {children}
    </div>
  );
}

export function AutosaveSettings() {
  const tk = useTokens();
  const mode = useAutosave(s => s.mode);
  const setMode = useAutosave(s => s.setMode);
  const snaps = useAutosave(s => s.snapshots);
  const error = useAutosave(s => s.error);
  const prefs = usePluginSettings(s => s.prefs);
  const crashed = crashedPlugins(prefs);
  const units = usePluginSettings(s => s.units);
  const nameOf = (code: string) => units?.find(u => u.code === code)?.name ?? prefs.units[code]?.crashed?.name ?? code;

  const open = async (file: string) => {
    const st = useNodeGraphStore.getState();
    if (st.graphDirty || (!st.currentGraph && st.nodes.length)) {
      const ok = await askConfirm('Open this autosave?', { message: 'The project open now has changes that aren’t saved; opening the autosave replaces it.', confirmLabel: 'Open', danger: true });
      if (!ok) return;
    }
    await restoreSnapshot(file);
  };
  const reveal = () => { void import('@tauri-apps/api/core').then(({ invoke }) => invoke('autosave_reveal')).catch(() => { /* no folder yet */ }); };

  return (
    <section aria-label="Autosave and recovery" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Autosave and recovery</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>If Playfield closes unexpectedly, the next launch offers the last autosave</span>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        <div data-setting="shader-studio:settings:autosave">
          <Row first label="Autosave the open project" detail={error ? `The last autosave failed: ${error}` : 'The graph and its Play setup, as Save writes them. The last 3 are kept on this device, apart from your saved work.'}>
            <Select ariaLabel="Autosave" value={mode} height={26} options={AUTOSAVE_MODES.map(m => ({ value: m.id, label: m.label }))} onChange={v => setMode(v as AutosaveMode)} />
          </Row>
        </div>
        {snaps.map(s => (
          <Row key={s.file} label={`${s.project.name ?? 'Untitled'}${s.project.dirty ? ' · unsaved changes' : ''}`} detail={`Autosaved ${formatClock(s.at)}`}>
            <Button size="sm" variant="ghost" icon="history" onClick={() => { void open(s.file); }}>Open</Button>
          </Row>
        ))}
        {!snaps.length && <Row label="No autosaves yet" detail={mode === 'off' ? 'Autosave is off.' : 'One is written once the open project changes.'} />}
        {isTauri() && snaps.length > 0 && (
          <Row label="Autosave folder" detail="In the app’s own data folder">
            <Button size="sm" variant="ghost" icon="folder" onClick={reveal}>Show in Finder</Button>
          </Row>
        )}
      </div>
      {crashed.length > 0 && (
        <div style={{ ...cardStyle(tk), overflow: 'hidden' }} aria-label="Plug-ins switched off for crashing">
          {crashed.map((c, i) => (
            <Row key={c.code} first={i === 0} label={nameOf(c.code)} detail={`${c.why}${c.at ? ` · ${formatClock(c.at)}` : ''}. Switched off in Plugins.`}>
              <Button size="sm" icon="reset" onClick={() => { void retryPlugin(c.code, nameOf(c.code)); }}>Try again</Button>
            </Row>
          ))}
        </div>
      )}
    </section>
  );
}
