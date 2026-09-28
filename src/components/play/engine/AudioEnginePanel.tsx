/**
 * AudioEnginePanel — the Play page's Engine tab (and the split view's big
 * panel): the Audio engine's racks (docs/audio-engine.md). On top, where the
 * engine plays (this device's output, master volume and mute); then a card
 * per rack (RackCard); then "Add a rack".
 *
 * The desktop app on a Mac hosts Audio Unit synths and effects; a browser
 * runs the sample player only. The whole engine is Pro (`audio.engine`),
 * Audio Units too (`audio.plugins`); on Free the racks are kept, and listed
 * dimmed.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Icon } from '../../ui/Icon';
import { ProBadge } from '../../account/ProSheet';
import { openProSheet, useCan } from '../../../lib/plan';
import { isTauri } from '../../../lib/midiTransport';
import { audioEngineHost, useEngineUi, useEnginePrefs } from '../../../lib/audioEngineHost';
import { AE_RACKS_MAX, newRack } from '../../../types/playAudioEngine';
import type { PlayRecord } from '../../../types/play';
import { RackCard } from './RackCard';
import { engineId, withEngine } from './engineOps';
import { MidiStatusChip } from '../chips';

export function AudioEnginePanel({ play, onChange, touch, wide = false }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  touch: boolean;
  wide?: boolean;
}) {
  const tk = useTokens();
  const ok = useCan('audio.engine');
  const racks = play.audioEngine?.racks ?? [];
  const desktop = isTauri();
  const add = () => onChange(p => {
    const list = p.audioEngine?.racks ?? [];
    if (list.length >= AE_RACKS_MAX) return p;
    return withEngine(p, { racks: [...list, newRack(engineId('rk'), list)] });
  });

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
            Racks of synths and effects played from MIDI and the computer keyboard: Audio Unit instruments and effects in the desktop app on a Mac, and a sample player for your sounds anywhere. Each rack’s sound has a spectrum for audio readers, so what you play drives the picture.
            {racks.length ? ` This setup’s ${racks.length === 1 ? 'rack is' : `${racks.length} racks are`} kept as they are, and play again with Pro.` : ''}
          </span>
          <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('audio.engine')}>See what Pro adds</Button></div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <EngineHeader desktop={desktop} touch={touch} />
      {racks.length === 0 && (
        <div style={{ padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No racks yet</div>
          A rack is an instrument and its effects. {desktop ? 'Load an Audio Unit synth (Apple’s DLSMusicDevice is on every Mac) or the sample player, add effects like AUDelay, and play it from a MIDI keyboard or the computer keyboard.' : 'In a browser a rack plays the sample player (sounds from the Library); Audio Unit synths and effects need the desktop app on a Mac.'} Its spectrum feeds audio readers, which drive controls.
        </div>
      )}
      <div style={{ display: wide ? 'grid' : 'flex', gridTemplateColumns: wide ? 'repeat(auto-fill, minmax(380px, 1fr))' : undefined, flexDirection: 'column', gap: 10, alignItems: 'start' }}>
        {racks.map((r, i) => <RackCard key={r.id} rack={r} play={play} onChange={onChange} touch={touch} index={i} count={racks.length} />)}
      </div>
      <div><Button size="sm" variant={racks.length ? 'secondary' : 'primary'} icon="plus" disabled={racks.length >= AE_RACKS_MAX} onClick={add}>Add a rack</Button></div>
      <span style={{ color: tk.text.faint, font: `11.5px/1.5 ${fontFamily.ui}` }}>
        Takes record the notes you play into racks and any parameter you made a control. Frame-by-frame renders don’t include the Audio engine’s sound yet: record it in real time, with your own audio routing (docs/audio-engine.md).
      </span>
    </div>
  );
}

function EngineHeader({ desktop, touch }: { desktop: boolean; touch: boolean }) {
  const tk = useTokens();
  const status = useEngineUi(s => s.status);
  const outputs = useEngineUi(s => s.outputs);
  const prefs = useEnginePrefs();
  const [midi, setMidi] = useState(false);
  useEffect(() => { if (desktop) void audioEngineHost.refreshOutputs(); }, [desktop, status.ready]);
  const line = !desktop
    ? 'In this browser: the sample player, through the page’s sound.'
    : status.error ? status.error
      : status.ready ? `Running at ${Math.round(status.sampleRate / 100) / 10} kHz.` : 'Starts with the first rack.';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="wave" size={14} style={{ color: tk.text.faint }} />
        <span style={{ flex: 1, minWidth: 0, color: status.error ? tk.status.danger : tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>{line}</span>
        <IconButton icon="antenna" size="sm" active={midi} label={midi ? 'Hide MIDI devices and the monitor' : 'MIDI devices and the monitor: which controllers are seen, and what they send'} onClick={() => setMidi(m => !m)} />
        {desktop && <IconButton icon={prefs.mute ? 'eyeOff' : 'wave'} size="sm" active={prefs.mute} label={prefs.mute ? 'Unmute the engine' : 'Mute the engine'} onClick={() => prefs.set({ mute: !prefs.mute })} />}
      </div>
      {midi && <div style={{ padding: '6px 0 2px' }}><MidiStatusChip monitor /></div>}
      {desktop && (
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 8 }}>
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Output</span>
          <Select ariaLabel="Output device" value={String(prefs.output)} height={28} onChange={v => prefs.set({ output: Number(v) })}
            options={[{ value: '0', label: 'System output' }, ...outputs.map(o => ({ value: String(o.id), label: `${o.name}${o.default ? ' (default)' : ''}` })), ...(prefs.output && !outputs.some(o => o.id === prefs.output) ? [{ value: String(prefs.output), label: 'A device not connected now' }] : [])]} />
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Volume</span>
          <RulerSlider value={prefs.volume} min={0} max={2} step={0.01} defaultValue={1} hard onChange={v => prefs.set({ volume: v })} ariaLabel="Engine volume" touch={touch} />
        </div>
      )}
    </div>
  );
}
