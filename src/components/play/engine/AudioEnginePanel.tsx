/**
 * AudioEnginePanel — the Play page's Engine tab (and the split view's big
 * panel): one view, the Arrangement (ArrangementPanel.tsx; docs/arrangement.md,
 * "The Arrangement view"). A track per rack with its lane on the timeline,
 * the transport above, the master below, and the selected track's device
 * chain at the bottom. The separate Performance view is gone: adding a rack
 * is adding a track.
 *
 * The desktop app on a Mac hosts Audio Unit synths and effects; a browser
 * runs the sample player and the Granulator. The whole engine is Pro
 * (`audio.engine`), Audio Units too (`audio.plugins`); on Free the racks are
 * kept, and the tab shows the Pro card.
 */
import { useEffect } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ProBadge } from '../../account/ProSheet';
import { openProSheet, useCan } from '../../../lib/plan';
import { isTauri } from '../../../lib/midiTransport';
import { audioEngineHost, useEngineUi } from '../../../lib/audioEngineHost';
import type { PlayRecord } from '../../../types/play';
import { ArrangementPanel } from './ArrangementPanel';

export function AudioEnginePanel({ play, onChange, touch }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  touch: boolean;
  /** Kept for callers; the view lays itself out by its own width. */
  wide?: boolean;
}) {
  const tk = useTokens();
  const ok = useCan('audio.engine');
  const racks = play.audioEngine?.racks ?? [];
  const desktop = isTauri();
  const ready = useEngineUi(s => s.status.ready);
  useEffect(() => { if (desktop && ok) void audioEngineHost.refreshOutputs(); }, [desktop, ok, ready]);

  if (!ok) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px' }}>
        <div style={{ padding: '14px 14px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="lock" size={15} style={{ color: tk.text.faint }} />
            <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>The Audio engine is part of Pro</b>
            <ProBadge />
          </div>
          <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
            Tracks of synths and effects played from MIDI and the computer keyboard, recorded onto a looping arrangement: Audio Unit instruments and effects in the desktop app on a Mac, and a sample player and a granulator for your sounds anywhere. A Listener on a track feeds audio readers, so what you play drives the picture.
            {racks.length ? ` This setup’s ${racks.length === 1 ? 'track is' : `${racks.length} tracks are`} kept as they are, and play again with Pro.` : ''}
          </span>
          <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('audio.engine')}>See what Pro adds</Button></div>
        </div>
      </div>
    );
  }

  return <ArrangementPanel play={play} onChange={onChange} touch={touch} />;
}
