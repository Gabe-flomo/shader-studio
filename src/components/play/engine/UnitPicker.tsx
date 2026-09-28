/**
 * UnitPicker — choose an instrument (the sample player, or an Audio Unit
 * synth) or an Audio Unit effect for a rack. Lists the plugins switched on in
 * Plugins (lib/pluginSettings.ts), with search; "Manage plugins…" opens the
 * list of all of them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { Modal } from '../../ui/Modal';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { ProBadge } from '../../account/ProSheet';
import { enabledUnits, matchUnit, usePluginSettings, type AuUnitInfo } from '../../../lib/pluginSettings';
import { openProSheet, useCan } from '../../../lib/plan';
import { isTauri } from '../../../lib/midiTransport';
import { PluginsDialog, scanPlugins } from './PluginsDialog';

export type UnitChoice = { kind: 'sampler' } | { kind: 'au'; unit: AuUnitInfo };

export function UnitPicker({ want, compact, onPick, onClose }: {
  want: 'instrument' | 'effect';
  compact: boolean;
  onPick: (c: UnitChoice) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const { units, prefs, scanning } = usePluginSettings();
  const pluginsOk = useCan('audio.plugins');
  const desktop = isTauri();
  const [q, setQ] = useState('');
  const [manage, setManage] = useState(false);
  useEffect(() => { if (desktop) void scanPlugins(); }, [desktop]);
  const list = useMemo(() => enabledUnits((units ?? []).filter(u => u.kind === want), prefs).filter(u => matchUnit(u, q)), [units, prefs, want, q]);
  const hidden = (units ?? []).filter(u => u.kind === want).length - enabledUnits((units ?? []).filter(u => u.kind === want), prefs).length;

  const item = (key: string, icon: 'piano' | 'wave' | 'import', title: string, sub: string, onClick: () => void, disabled = false) => (
    <button key={key} type="button" disabled={disabled} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', border: 0, borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, cursor: disabled ? 'default' : 'pointer', textAlign: 'left', opacity: disabled ? 0.55 : 1 }}>
      <Icon name={icon} size={15} style={{ color: tk.text.faint, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
        <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
    </button>
  );

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: compact ? 0 : '12px 16px 16px' }}>
      {want === 'instrument' && item('sampler', 'import', 'Sample player', 'Sounds from the Library, one per key or one across the keyboard. Works in the browser too.', () => onPick({ kind: 'sampler' }))}
      {!desktop ? (
        <span style={{ padding: '10px 4px', color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Audio Unit {want === 'instrument' ? 'synths' : 'effects'} run in the desktop app on a Mac. A setup made there keeps them, and they play again when it’s opened there.
        </span>
      ) : !pluginsOk ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px', color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <span style={{ flex: 1 }}>Audio Unit synths and effects are part of Pro.</span>
          <ProBadge />
          <Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('audio.plugins')}>See Pro</Button>
        </div>
      ) : (
        <>
          <Field aria-label={`Search ${want}s`} placeholder={`Search ${want === 'instrument' ? 'synths' : 'effects'}`} height={32} value={q} onChange={e => setQ(e.target.value)}
            leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} />
          <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: compact ? undefined : 380, overflowY: 'auto' }}>
            {units === null && scanning && <span style={{ padding: 10, color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>Looking for plugins…</span>}
            {units !== null && !list.length && <span style={{ padding: 10, color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>{q ? `Nothing called anything like “${q.trim()}”.` : `No ${want === 'instrument' ? 'synths' : 'effects'} switched on.`}</span>}
            {list.map(u => item(u.code, want === 'instrument' ? 'piano' : 'wave', u.name, `${u.vendor || 'Unknown maker'}${u.version ? ` · ${u.version}` : ''}${u.v3 ? ' · AUv3' : ''}`, () => onPick({ kind: 'au', unit: u })))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>{hidden > 0 ? `${hidden} hidden in Plugins.` : ' '}</span>
            <Button size="sm" variant="ghost" icon="sliders" onClick={() => setManage(true)}>Manage plugins…</Button>
          </div>
        </>
      )}
      {manage && <PluginsDialog compact={compact} onClose={() => setManage(false)} />}
    </div>
  );
  const title = want === 'instrument' ? 'Choose an instrument' : 'Add an Audio Unit effect';
  return compact ? <Sheet title={title} onClose={onClose} maxHeight="85dvh">{body}</Sheet> : <Modal title={title} icon={want === 'instrument' ? 'piano' : 'wave'} onClose={onClose} width={520}>{body}</Modal>;
}
