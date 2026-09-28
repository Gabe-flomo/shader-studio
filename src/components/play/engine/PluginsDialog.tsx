/**
 * PluginsDialog — Library → Settings → Plugins (and "Manage plugins…" in the
 * Audio engine's pickers): every installed Audio Unit with a switch, so only
 * the ones you want appear in the rack and effect pickers. Search, Enable
 * all / Disable all (of what the search shows), Rescan, New tags, and "New
 * plugins start disabled". Kept on this device (lib/pluginSettings.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Modal } from '../../ui/Modal';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toastStore';
import { matchUnit, pluginEnabled, usePluginSettings, type AuUnitInfo } from '../../../lib/pluginSettings';
import { audioEngineHost } from '../../../lib/audioEngineHost';
import { isTauri } from '../../../lib/midiTransport';

/** Scan (once a session unless asked) and give back the units. */
export async function scanPlugins(force = false): Promise<string[]> {
  const st = usePluginSettings.getState();
  if (st.units && !force) return [];
  const invoke = await audioEngineHost.bridgeInvoke();
  if (!invoke) return [];
  return st.rescan(invoke);
}

export function PluginsDialog({ onClose, compact = false }: { onClose: () => void; compact?: boolean }) {
  const tk = useTokens();
  const { units, prefs, scanning, error, setEnabled, setNewOff, clearNew, reload } = usePluginSettings();
  const [q, setQ] = useState('');
  const desktop = isTauri();
  useEffect(() => { reload(); void scanPlugins(); }, [reload]);
  // Looking at the list is what "New" waits for: the tags go when it closes.
  useEffect(() => () => { usePluginSettings.getState().clearNew(); }, []);
  const shown = useMemo(() => (units ?? []).filter(u => matchUnit(u, q)), [units, q]);
  const on = (units ?? []).filter(u => pluginEnabled(prefs, u.code)).length;
  const fresh = (units ?? []).filter(u => prefs.units[u.code]?.new).length;
  const rescan = async () => {
    const added = await scanPlugins(true);
    toast.success(added.length ? `${added.length} new plugin${added.length === 1 ? '' : 's'} found` : 'No new plugins');
  };

  const row = (u: AuUnitInfo) => {
    const enabled = pluginEnabled(prefs, u.code);
    const isNew = prefs.units[u.code]?.new;
    return (
      <div key={u.code} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: radius.md, background: tk.bg.field, opacity: enabled ? 1 : 0.62 }}>
        <Icon name={u.kind === 'instrument' ? 'piano' : 'wave'} size={15} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</b>
            {isNew && <span style={{ padding: '1px 6px', borderRadius: 999, background: alpha(tk.accent.base, 0.16), color: tk.accent.text, font: `700 9.5px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>New</span>}
          </span>
          <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.vendor || 'Unknown maker'} · {u.kind === 'instrument' ? 'Instrument' : 'Effect'}{u.version ? ` · ${u.version}` : ''}{u.v3 ? ' · AUv3' : ' · AUv2'}
          </span>
        </div>
        <Toggle checked={enabled} onChange={v => setEnabled([u.code], v)} label={<span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{`Offer ${u.name}`}</span>} />
      </div>
    );
  };

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? 0 : '12px 16px 16px' }}>
      {!desktop ? (
        <div style={{ padding: '12px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Audio Unit plugins are hosted by the desktop app on a Mac. In a browser the Audio engine has its sample player only.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>
              {units ? `${on} of ${units.length} offered${fresh ? ` · ${fresh} new` : ''}` : scanning ? 'Looking for plugins…' : 'Not scanned yet'}
            </span>
            <span style={{ flex: 1 }} />
            <Button size="sm" icon="rebuild" disabled={scanning} onClick={() => void rescan()} title="Look for Audio Units installed since the last scan">{scanning ? 'Scanning…' : 'Rescan plugins'}</Button>
          </div>
          {error && <span style={{ color: tk.status.danger, font: `12px ${fontFamily.ui}` }}>{error}</span>}
          <Field aria-label="Search plugins" placeholder="Search by name, maker or kind" height={32} value={q} onChange={e => setQ(e.target.value)}
            leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" icon="check" disabled={!shown.length} onClick={() => setEnabled(shown.map(u => u.code), true)}>{q ? 'Enable these' : 'Enable all'}</Button>
            <Button size="sm" icon="eyeOff" disabled={!shown.length} onClick={() => setEnabled(shown.map(u => u.code), false)}>{q ? 'Disable these' : 'Disable all'}</Button>
            {fresh > 0 && <Button size="sm" variant="ghost" onClick={clearNew}>Clear New tags</Button>}
          </div>
          <Toggle checked={prefs.newOff} onChange={setNewOff} label="New plugins start disabled" />
          <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: compact ? undefined : 420, overflowY: 'auto' }}>
            {units && !shown.length && <span style={{ padding: 12, color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>{q ? `No plugin called anything like “${q.trim()}”.` : 'No Audio Units found.'}</span>}
            {shown.map(row)}
          </div>
          <span style={{ color: tk.text.faint, font: `11.5px/1.5 ${fontFamily.ui}` }}>
            Only the plugins switched on appear in the Audio engine’s instrument and effect pickers. A rack already using a hidden plugin keeps it. Saved on this device (Files → App settings → Audio Unit plugins).
          </span>
        </>
      )}
    </div>
  );
  return compact
    ? <Sheet title="Plugins" onClose={onClose} maxHeight="90dvh">{body}</Sheet>
    : <Modal title="Plugins" subtitle="Audio Units the app offers" icon="piano" onClose={onClose} width={560}>{body}</Modal>;
}

/** The Library's Settings row: a count and the button. */
export function PluginsSetting() {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const { units, prefs } = usePluginSettings();
  const n = units ? units.filter(u => pluginEnabled(prefs, u.code)).length : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" icon="piano" onClick={() => setOpen(true)} title="Which installed Audio Units the Audio engine offers">Plugins{n !== null ? ` (${n} of ${units!.length})` : ''}…</Button>
      <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>{isTauri() ? 'Audio Unit synths and effects for the Audio engine.' : 'Audio Units need the desktop app on a Mac.'}</span>
      {open && <PluginsDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
