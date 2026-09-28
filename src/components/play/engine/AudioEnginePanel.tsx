/**
 * AudioEnginePanel — the Play page's Engine tab (and the split view's big
 * panel), in two views like Finish's Picture and Sound:
 *
 *   Performance   the racks (docs/audio-engine.md): where the engine plays
 *                 (output, master volume and mute), which rack leads, the
 *                 tape's transport, a card per rack (RackCard), "Add a rack"
 *   Arrangement   the tape (docs/arrangement.md, ArrangementPanel): a lane per
 *                 rack, record, overdub, punch in
 *
 * Selecting a card makes its rack the lead (it takes the MIDI no rack's own
 * routing claims) unless one is locked as the lead.
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
import { Segmented } from '../../ui/Choice';
import { usePlayUi } from '../playUi';
import { ArrangementPanel, TapeTransport } from './ArrangementPanel';
import { useEngineSelection } from '../../../lib/audioEngineHost';
import { keyboardRack, leadRackId, setLeadLock, setRackKeyboard } from '../../../types/playAudioEngine';

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
    return withEngine(p, { ...p.audioEngine, racks: [...list, newRack(engineId('rk'), list)] });
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, padding: '8px 12px 0', borderBottom: `1px solid ${tk.border.subtle}` }}>
        <EngineViews play={play} />
        <div style={{ height: 8 }} />
      </div>
      <EngineBody play={play} onChange={onChange} touch={touch} wide={wide} desktop={desktop} add={add} />
    </div>
  );
}

function EngineViews({ play }: { play: PlayRecord }) {
  const view = usePlayUi(s => s.engineView), setView = usePlayUi(s => s.setEngineView);
  const n = play.audioEngine?.racks.length ?? 0, len = play.arrangement?.length ?? 0;
  return (
    <Segmented fill size="sm" ariaLabel="The racks or the tape" value={view} onChange={setView}
      options={[
        { value: 'performance', label: `Performance${n ? ` · ${n}` : ''}`, title: 'The racks: instruments and effects, played live' },
        { value: 'arrangement', label: `Arrangement${len > 0 ? ` · ${len.toFixed(1)} s` : ''}`, title: 'The tape: record what you play into each rack, loop it, overdub, punch in' },
      ]} />
  );
}

function EngineBody({ play, onChange, touch, wide, desktop, add }: {
  play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void; touch: boolean; wide: boolean; desktop: boolean; add: () => void;
}) {
  const tk = useTokens();
  const view = usePlayUi(s => s.engineView);
  const selected = useEngineSelection(s => s.selected);
  const racks = play.audioEngine?.racks ?? [];
  if (view === 'arrangement') return <ArrangementPanel play={play} onChange={onChange} touch={touch} />;
  const lock = play.audioEngine?.lock ?? '';
  const lead = leadRackId(play.audioEngine, selected);
  // Selecting a card hands it the lead (unless one is locked); the computer keyboard, if a rack has it, follows the lead.
  const select = (id: string) => {
    if (useEngineSelection.getState().selected === id) return;
    useEngineSelection.getState().select(id);
    if (!lock) followLead(id);
  };
  const followLead = (id: string) => onChange(p => {
    const kb = keyboardRack(p.audioEngine);
    return kb && kb.id !== id ? { ...p, audioEngine: setRackKeyboard(p.audioEngine, id, true) } : p;
  });
  const setLock = (id: string, on: boolean) => {
    onChange(p => ({ ...p, audioEngine: setLeadLock(p.audioEngine, on ? id : '') }));
    followLead(on ? id : leadRackId({ racks }, useEngineSelection.getState().selected));
  };
  const leadRack = racks.find(r => r.id === lead);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <EngineHeader desktop={desktop} touch={touch} playing={leadRack ? `${leadRack.name}${lock ? ' · locked' : ''}` : ''} />
      {racks.length > 0 && (
        <div style={{ padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field }}>
          <TapeTransport play={play} compact touch={touch} />
        </div>
      )}
      {racks.length === 0 && (
        <div style={{ padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No racks yet</div>
          A rack is an instrument and its effects. {desktop ? 'Load an Audio Unit synth (Apple’s DLSMusicDevice is on every Mac) or the sample player, add effects like AUDelay, and play it from a MIDI keyboard or the computer keyboard.' : 'In a browser a rack plays the sample player (sounds from the Library); Audio Unit synths and effects need the desktop app on a Mac.'} Its spectrum feeds audio readers, which drive controls.
        </div>
      )}
      <div style={{ display: wide ? 'grid' : 'flex', gridTemplateColumns: wide ? 'repeat(auto-fill, minmax(380px, 1fr))' : undefined, flexDirection: 'column', gap: 10, alignItems: 'start' }}>
        {racks.map((r, i) => (
          <RackCard key={r.id} rack={r} play={play} onChange={onChange} touch={touch} index={i} count={racks.length}
            selected={r.id === (selected || lead)} lead={r.id === lead} locked={r.id === lock}
            onSelect={() => select(r.id)} onLock={on => setLock(r.id, on)} />
        ))}
      </div>
      <div><Button size="sm" variant={racks.length ? 'secondary' : 'primary'} icon="plus" disabled={racks.length >= AE_RACKS_MAX} onClick={add}>Add a rack</Button></div>
      <span style={{ color: tk.text.faint, font: `11.5px/1.5 ${fontFamily.ui}` }}>
        Takes record the notes you play into racks and any parameter you made a control. {desktop ? 'Rendering a take renders the racks with it, and a real-time recording carries the engine’s sound. Sound in on a card sends a page sound through a rack’s effects.' : 'In the desktop app the engine’s sound is in recordings and renders too.'}
      </span>
    </div>
  );
}

function EngineHeader({ desktop, touch, playing }: { desktop: boolean; touch: boolean; playing: string }) {
  const tk = useTokens();
  const status = useEngineUi(s => s.status);
  const outputs = useEngineUi(s => s.outputs);
  const prefs = useEnginePrefs();
  const [midi, setMidi] = useState(false);
  useEffect(() => { if (desktop) void audioEngineHost.refreshOutputs(); }, [desktop, status.ready]);
  const line = !desktop
    ? 'In this browser: the sample player and the Granulator, through the page’s sound.'
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
      {playing && (
        <span title="The lead rack takes MIDI notes, the computer keyboard and pad hits; racks with their own device or channel play what that sends" style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>
          Playing: {playing}
        </span>
      )}
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
