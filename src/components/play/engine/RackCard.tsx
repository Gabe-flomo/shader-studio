/**
 * RackCard — one Audio engine rack: what plays it (MIDI input and channel,
 * the computer keyboard), its instrument (an Audio Unit synth or the sample
 * player), its Audio Unit effects in order, its volume, a mini spectrum with
 * the readers that listen to it, and a strip of keys to try it with the mouse.
 *
 * Each plug-in parameter can become a control (+), target
 * `au:<rack>:<slot>::<address>`; a value moved here is kept in the setup.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toastStore';
import { askConfirm, askText } from '../../ui/dialogStore';
import { SpectrumView } from '../SpectrumView';
import { EMPTY_READERS, useReadersPanel, withReaders } from '../readersPanelUi';
import { newReader, formatHz, READER_GAIN_MAX, READER_GAIN_MIN } from '../../../play/audioReaders';
import { AUDIO_READERS_MAX, type AudioReader, type PlayAudioReaders, type PlayRecord } from '../../../types/play';
import {
  AE_EFFECTS_MAX, AE_INST, AE_PAD_BASE_NOTE, AE_ZONES_MAX, aeRack, aeSlot, auTarget, moveEffect, patchRack, patchSlot, setRackKeyboard, zonesFor,
  type AeRack, type AeSlot, type AeZone, type PlayAudioEngine,
} from '../../../types/playAudioEngine';
import { audioEngineHost, useEngineUi } from '../../../lib/audioEngineHost';
import { formatParam, type AuParam } from '../../../lib/audioEngineProtocol';
import { engineReaderInput } from '../../../lib/engineSound';
import { midiEngine, midiNoteName } from '../../../lib/midiEngine';
import { RACK_KEYBOARD_HINT, rackKeyboard, useRackKeyboard } from '../../../lib/rackKeyboard';
import { Kbd } from '../../ui/Kbd';
import { isAudioType } from '../../../lib/backgroundLibrary';
import { useLibraryVideos } from '../../backgrounds/useBackgrounds';
import { isTauri } from '../../../lib/midiTransport';
import { useCan } from '../../../lib/plan';
import { UnitPicker, type UnitChoice } from './UnitPicker';
import { playId } from '../../../play/playControls';
import { usePlayUi } from '../playUi';
import { engineId, withEngine } from './engineOps';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

export function RackCard({ rack, play, onChange, touch, index, count }: {
  rack: AeRack;
  play: PlayRecord;
  onChange: Change;
  touch: boolean;
  index: number;
  count: number;
}) {
  const tk = useTokens();
  const [picking, setPicking] = useState<'instrument' | 'effect' | null>(null);
  const [folded, setFolded] = useState(false);
  const desktop = isTauri();
  const pluginsOk = useCan('audio.plugins');
  const edit = (fn: (ae: PlayAudioEngine | undefined) => PlayAudioEngine) => onChange(p => withEngine(p, fn(p.audioEngine)));
  const patch = (over: Partial<AeRack>) => edit(ae => patchRack(ae, rack.id, over));
  const errors = useEngineUi(s => s.errors);
  const rackError = errors[`${rack.id}/rack`];

  const pick = (c: UnitChoice) => {
    setPicking(null);
    if (picking === 'instrument') {
      const inst: AeSlot = c.kind === 'sampler'
        ? { id: AE_INST, kind: 'sampler', zones: rack.instrument?.kind === 'sampler' ? rack.instrument.zones : [] }
        : { id: AE_INST, kind: 'au', unit: { type: c.unit.type, subtype: c.unit.subtype, manufacturer: c.unit.manufacturer, name: c.unit.name, vendor: c.unit.vendor } };
      edit(ae => patchRack(ae, rack.id, { instrument: inst }));
    } else if (c.kind === 'au') {
      if (rack.effects.length >= AE_EFFECTS_MAX) { toast.error(`A rack takes ${AE_EFFECTS_MAX} effects at most`); return; }
      const fx: AeSlot = { id: engineId('fx'), kind: 'au', unit: { type: c.unit.type, subtype: c.unit.subtype, manufacturer: c.unit.manufacturer, name: c.unit.name, vendor: c.unit.vendor } };
      edit(ae => patchRack(ae, rack.id, r => ({ ...r, effects: [...r.effects, fx] })));
    }
  };
  const removeSlot = (slotId: string) => edit(ae => patchRack(ae, rack.id, r => (slotId === AE_INST ? { ...r, instrument: null } : { ...r, effects: r.effects.filter(e => e.id !== slotId) })));
  const remove = async () => {
    if (rack.instrument || rack.effects.length) {
      const ok = await askConfirm(`Delete ${rack.name}?`, { message: 'Its instrument, effects and any controls on their parameters go with it.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    audioEngineHost.releaseHeld(rack.id);
    edit(ae => ({ racks: (ae?.racks ?? []).filter(r => r.id !== rack.id) }));
  };
  const rename = async () => {
    const name = await askText('Rename rack', { initial: rack.name, confirmLabel: 'Rename' });
    if (name && name.trim()) patch({ name: name.trim().slice(0, 60) });
  };
  const move = (by: -1 | 1) => edit(ae => {
    const racks = [...(ae?.racks ?? [])];
    const i = racks.findIndex(r => r.id === rack.id), j = i + by;
    if (i < 0 || j < 0 || j >= racks.length) return { racks };
    [racks[i], racks[j]] = [racks[j], racks[i]];
    return { racks };
  });

  return (
    <div style={{ borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 12px', borderBottom: folded ? 'none' : `1px solid ${tk.border.subtle}` }}>
        <IconButton icon={folded ? 'chevR' : 'chevD'} size="sm" label={folded ? 'Open' : 'Fold'} onClick={() => setFolded(f => !f)} />
        <Icon name="piano" size={15} style={{ color: tk.text.faint }} />
        <button type="button" onClick={() => void rename()} title="Rename" style={{ border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `650 13px ${fontFamily.ui}`, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rack.name}</button>
        <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {rack.instrument ? (rack.instrument.kind === 'sampler' ? 'Sample player' : rack.instrument.unit?.name) : 'No instrument'}{rack.effects.length ? ` · ${rack.effects.length} effect${rack.effects.length === 1 ? '' : 's'}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <IconButton icon={rack.mute ? 'eyeOff' : 'wave'} size="sm" active={rack.mute} label={rack.mute ? 'Unmute' : 'Mute'} onClick={() => { if (!rack.mute) audioEngineHost.releaseHeld(rack.id); patch({ mute: !rack.mute }); }} />
        <IconButton icon="chevU" size="sm" label="Move up" disabled={index === 0} onClick={() => move(-1)} />
        <IconButton icon="chevD" size="sm" label="Move down" disabled={index === count - 1} onClick={() => move(1)} />
        <IconButton icon="trash" size="sm" tone="danger" label="Delete rack" onClick={() => void remove()} />
      </div>
      {!folded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 12px' }}>
          {rackError && <Note tone="bad">{rackError}</Note>}
          <InputRow rack={rack} onPatch={patch} onKeyboard={on => { audioEngineHost.releaseHeld(rack.id); edit(ae => setRackKeyboard(ae, rack.id, on)); }} touch={touch} />
          <RackSpectrum rack={rack} play={play} onChange={onChange} />
          <Keys rackId={rack.id} touch={touch} />
          <Caption>Instrument</Caption>
          {rack.instrument ? (
            <SlotView rack={rack} slot={rack.instrument} play={play} onChange={onChange} touch={touch} desktop={desktop} pluginsOk={pluginsOk}
              onReplace={() => setPicking('instrument')} onRemove={() => removeSlot(AE_INST)} />
          ) : (
            <div><Button size="sm" variant="primary" icon="plus" onClick={() => setPicking('instrument')}>Choose an instrument…</Button></div>
          )}
          <Caption>Effects{rack.effects.length ? ` · ${rack.effects.length}` : ''}</Caption>
          {rack.effects.map((e, i) => (
            <SlotView key={e.id} rack={rack} slot={e} play={play} onChange={onChange} touch={touch} desktop={desktop} pluginsOk={pluginsOk}
              first={i === 0} last={i === rack.effects.length - 1}
              onMove={by => edit(ae => moveEffect(ae, rack.id, e.id, by))}
              onBypass={() => edit(ae => patchSlot(ae, rack.id, e.id, { bypass: !e.bypass }))}
              onRemove={() => removeSlot(e.id)} />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" icon="plus" onClick={() => setPicking('effect')} disabled={rack.effects.length >= AE_EFFECTS_MAX} title="An Audio Unit effect after the instrument (delay, reverb, filter…)">Audio Unit effect…</Button>
            {!desktop && <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>Audio Units play in the desktop app on a Mac.</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 8 }}>
            <span style={labelStyle(tk)}>Volume</span>
            <RulerSlider value={rack.volume} min={0} max={2} step={0.01} defaultValue={1} hard onChange={v => patch({ volume: v })} ariaLabel={`${rack.name} volume`} touch={touch} />
          </div>
        </div>
      )}
      {picking && <UnitPicker want={picking} compact={touch} onPick={pick} onClose={() => setPicking(null)} />}
    </div>
  );
}

const labelStyle = (tk: ReturnType<typeof useTokens>): CSSProperties => ({ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' });

function Caption({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ ...labelStyle(tk), marginTop: 2 }}>{children}</span>;
}

function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'bad' }) {
  const tk = useTokens();
  return <span style={{ color: tone === 'bad' ? tk.status.danger : tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>{children}</span>;
}

// ── What plays it ────────────────────────────────────────────────────────────

/**
 * Which MIDI input and channel play the rack (any device by default: a
 * controller plugged in just works), and the computer keyboard toggle
 * (lib/rackKeyboard.ts): on, every plain key plays this rack DAW-style and the
 * app's shortcuts wait; one rack at a time, off by default.
 */
function InputRow({ rack, onPatch, onKeyboard, touch }: { rack: AeRack; onPatch: (o: Partial<AeRack>) => void; onKeyboard: (on: boolean) => void; touch: boolean }) {
  const tk = useTokens();
  const [devices, setDevices] = useState(() => midiEngine.webMidi().inputs);
  useEffect(() => midiEngine.subscribe(e => { if (e.kind === 'devices') setDevices(midiEngine.webMidi().inputs); }), []);
  const kbRack = useRackKeyboard(s => s.rackId);
  const octave = useRackKeyboard(s => s.octave);
  const velocity = useRackKeyboard(s => s.velocity);
  const sustain = useRackKeyboard(s => s.sustain);
  const live = kbRack === rack.id;
  const midiOptions = [
    { value: '', label: 'Any MIDI input' },
    { value: 'off', label: 'No MIDI' },
    ...devices.map(d => ({ value: d, label: d })),
    ...(rack.midi && rack.midi !== 'off' && !devices.includes(rack.midi) ? [{ value: rack.midi, label: `${rack.midi} (not connected)` }] : []),
  ];
  const channels = [{ value: '0', label: 'All channels' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` }))];
  const reroute = (o: Partial<AeRack>) => { audioEngineHost.releaseHeld(rack.id); onPatch(o); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle(tk), width: 64 }}>Played by</span>
        <Select ariaLabel="MIDI input" value={rack.midi} options={midiOptions} onChange={v => { if (v !== 'off') void midiEngine.connectWebMidi(); reroute({ midi: v }); }} height={28} style={{ flex: '1 1 150px', minWidth: 0 }} />
        <Select ariaLabel="MIDI channel" value={String(rack.channel)} options={channels} onChange={v => reroute({ channel: Number(v) })} height={28} style={{ flex: '0 1 130px', minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingLeft: 70 }}>
        <Toggle checked={rack.keyboard} onChange={onKeyboard} label={<span title={RACK_KEYBOARD_HINT}>Computer keyboard</span>} />
        {rack.keyboard && live && <span style={{ color: tk.accent.text, font: `600 11px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 5 }}>Playing this rack{sustain ? ' · sustain' : ''} <Kbd combo="escape" /> gives it back</span>}
        {rack.keyboard && !live && <Note>Takes the keyboard while the Play page shows.</Note>}
      </div>
      {rack.keyboard && (
        <div style={{ display: 'grid', gridTemplateColumns: '64px auto 1fr', alignItems: 'center', gap: 6, paddingLeft: 6 }}>
          <span style={labelStyle(tk)}>Octave</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconButton icon="minus" size="sm" label="Octave down (Z)" disabled={octave <= 0} onClick={() => rackKeyboard.setOctave(octave - 1)} />
            <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.secondary, minWidth: 54, textAlign: 'center' }} title="The A key's note">A = {midiNoteName((octave + 1) * 12)}</span>
            <IconButton icon="plus" size="sm" label="Octave up (X)" disabled={octave >= 8} onClick={() => rackKeyboard.setOctave(octave + 1)} />
          </span>
          <span />
          <span style={labelStyle(tk)}>Velocity</span>
          <span style={{ gridColumn: '2 / 4' }}>
            <RulerSlider value={velocity} min={1} max={127} step={1} integer defaultValue={100} hard onChange={v => rackKeyboard.setVelocity(v)} ariaLabel="Keyboard velocity" touch={touch} />
          </span>
          <span />
          <Note>{RACK_KEYBOARD_HINT}</Note>
        </div>
      )}
    </div>
  );
}

const EMPTY_HELD: number[] = [];

/** Two octaves to click (Shift: full velocity), from C3. */
function Keys({ rackId, touch }: { rackId: string; touch: boolean }) {
  const tk = useTokens();
  const [down, setDown] = useState<number | null>(null);
  // The computer keyboard's notes light up here too.
  const typed = useRackKeyboard(s => (s.rackId === rackId ? s.held : EMPTY_HELD));
  const base = 48;
  const whites = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  const blacks: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10, 7: 13, 8: 15, 10: 18, 11: 20, 12: 22 };
  const h = touch ? 56 : 44;
  const on = (n: number, vel: number) => { setDown(n); audioEngineHost.input(rackId, [0x90, n, vel]); };
  const off = () => { if (down !== null) audioEngineHost.input(rackId, [0x80, down, 0]); setDown(null); };
  const key = (n: number, black: boolean, style: CSSProperties) => (
    <button key={n} type="button" aria-label={`Play ${midiNoteName(n)}`} title={midiNoteName(n)}
      onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); on(n, e.shiftKey ? 127 : Math.round(40 + 87 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))); }}
      onPointerUp={off} onPointerCancel={off}
      style={{ position: 'absolute', border: 0, padding: 0, cursor: 'pointer', borderRadius: '0 0 4px 4px', ...style,
        background: down === n || typed.includes(n) ? tk.accent.base : black ? '#1d1d22' : '#fbfbfc', boxShadow: black ? `0 1px 2px ${alpha('#000', 0.35)}` : `inset -1px 0 0 ${alpha('#000', 0.28)}, inset 0 -1px 0 ${alpha('#000', 0.28)}` }} />
  );
  const w = 100 / whites.length;
  return (
    <div style={{ position: 'relative', height: h, borderRadius: radius.sm, overflow: 'hidden', touchAction: 'none', userSelect: 'none', boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.3)}`, background: '#fbfbfc' }}>
      {whites.map((o, i) => key(base + o, false, { left: `${i * w}%`, width: `${w}%`, top: 0, height: '100%' }))}
      {Object.entries(blacks).map(([i, o]) => key(base + o, true, { left: `${(Number(i) + 1) * w - w * 0.3}%`, width: `${w * 0.6}%`, top: 0, height: '60%', zIndex: 1 }))}
    </div>
  );
}

// ── The spectrum and its readers ─────────────────────────────────────────────

let readerSeq = 0;
const readerId = () => `rd${Date.now().toString(36)}${(readerSeq++).toString(36)}`;

function RackSpectrum({ rack, play, onChange }: { rack: AeRack; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const cfg = play.audioReaders ?? EMPTY_READERS;
  const input = engineReaderInput(rack.id);
  const mine = cfg.input === input;
  const [selected, setSelected] = useState('');
  const edit = (fn: (c: PlayAudioReaders) => PlayAudioReaders) => onChange(p => withReaders(p, fn(p.audioReaders ?? EMPTY_READERS)));
  const listenHere = () => edit(c => ({ ...c, input }));
  const add = (hz: number, topDb: number) => {
    if (!mine || cfg.readers.length >= AUDIO_READERS_MAX) return;
    const r = newReader(readerId(), hz, topDb, cfg.readers);
    edit(c => ({ ...c, readers: [...c.readers, r] }));
    setSelected(r.id);
  };
  const move = (id: string, hz: number, gain: number) => edit(c => ({
    ...c,
    readers: c.readers.map((r: AudioReader) => (r.id !== id ? r : { ...r, hz, gain: Math.max(READER_GAIN_MIN, Math.min(READER_GAIN_MAX, gain)), ...(r.name === formatHz(r.hz) ? { name: formatHz(hz) } : {}) })),
  }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SpectrumView compact readers={mine ? cfg.readers : []} selected={selected} peakHold={false} height={92}
        canAdd={mine && cfg.readers.length < AUDIO_READERS_MAX} onSelect={setSelected} onAdd={add} onMove={move}
        spectrum={() => audioEngineHost.spectrum(rack.id)} emptyText="Silent: play a note" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {!mine && <Button size="sm" icon="wave" onClick={listenHere} title="Point the setup’s audio readers at this rack’s sound">Readers listen here</Button>}
        <Button size="sm" variant={mine ? 'primary' : 'ghost'} icon="wave" onClick={() => { listenHere(); useReadersPanel.getState().show({ focus: selected || cfg.readers[0]?.id || '' }); }}>Audio readers…</Button>
        <span style={{ flex: '1 1 140px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{mine ? 'Click the spectrum to place a reader; each drives controls like any audio reader.' : 'The readers listen to something else now.'}</span>
      </div>
    </div>
  );
}

// ── A slot: the instrument or an effect ──────────────────────────────────────

function SlotView({ rack, slot, play, onChange, touch, desktop, pluginsOk, first, last, onMove, onBypass, onRemove, onReplace }: {
  rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean; desktop: boolean; pluginsOk: boolean;
  first?: boolean; last?: boolean;
  onMove?: (by: -1 | 1) => void; onBypass?: () => void; onRemove: () => void; onReplace?: () => void;
}) {
  const tk = useTokens();
  const key = `${rack.id}/${slot.id}`;
  const error = useEngineUi(s => s.errors[key]);
  const loading = useEngineUi(s => !!s.loading[key]);
  const [open, setOpen] = useState(false);
  const isAu = slot.kind === 'au';
  const name = slot.kind === 'sampler' ? 'Sample player' : slot.unit?.name ?? 'Audio Unit';
  const openWindow = async () => {
    const why = await audioEngineHost.openUi(rack.id, slot.id, `${rack.name} · ${name}`);
    if (why) toast.error('The plug-in window didn’t open', { message: why });
  };
  const keepState = async () => {
    const st = await audioEngineHost.slotState(rack.id, slot.id);
    if (!st) { toast.error('The plug-in didn’t give its settings'); return; }
    onChange(p => withEngine(p, patchSlot(p.audioEngine, rack.id, slot.id, { state: st })));
    toast.success('Its settings are kept with the setup', { message: 'Save the setup to keep them for next time.' });
  };
  const offline = isAu && (!desktop || !pluginsOk);
  return (
    <div style={{ borderRadius: radius.md, background: tk.bg.field, padding: '8px 8px 8px 10px', display: 'flex', flexDirection: 'column', gap: 6, opacity: slot.bypass || offline ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Icon name={slot.id === AE_INST ? (isAu ? 'piano' : 'import') : 'wave'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}{loading ? ' · loading…' : ''}</b>
          {isAu && <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.unit?.vendor}{slot.state ? ' · settings kept' : ''}</span>}
        </span>
        {isAu && desktop && pluginsOk && <IconButton icon="popout" size="sm" label="Open the plug-in’s window" onClick={() => void openWindow()} />}
        {isAu && desktop && pluginsOk && <IconButton icon="sliders" size="sm" active={open} label={open ? 'Hide parameters' : 'Parameters'} onClick={() => setOpen(o => !o)} />}
        {onBypass && <IconButton icon="bypass" size="sm" active={!!slot.bypass} label={slot.bypass ? 'Turn back on' : 'Bypass'} onClick={onBypass} />}
        {onMove && <IconButton icon="chevU" size="sm" label="Earlier" disabled={first} onClick={() => onMove(-1)} />}
        {onMove && <IconButton icon="chevD" size="sm" label="Later" disabled={last} onClick={() => onMove(1)} />}
        {onReplace && <IconButton icon="reset" size="sm" label="Choose another instrument" onClick={onReplace} />}
        <IconButton icon="trash" size="sm" tone="danger" label="Remove" onClick={onRemove} />
      </div>
      {offline && <Note>{!desktop ? 'Plays in the desktop app on a Mac; kept here as it is.' : 'Audio Unit plug-ins are part of Pro: kept as it is, silent until then.'}</Note>}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Note tone="bad">{error}</Note>
          <Button size="sm" variant="ghost" icon="rebuild" onClick={() => audioEngineHost.retry(rack.id, slot.id)}>Try again</Button>
        </div>
      )}
      {slot.kind === 'sampler' && <SamplerZones rack={rack} slot={slot} onChange={onChange} />}
      {isAu && open && desktop && pluginsOk && <Params rack={rack} slot={slot} play={play} onChange={onChange} touch={touch} onKeep={() => void keepState()} />}
    </div>
  );
}

function Params({ rack, slot, play, onChange, touch, onKeep }: { rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean; onKeep: () => void }) {
  const tk = useTokens();
  const key = `${rack.id}/${slot.id}`;
  const params = useEngineUi(s => s.params[key]);
  const [q, setQ] = useState('');
  useEffect(() => { if (!params) void audioEngineHost.listParams(rack.id, slot.id); }, [params, rack.id, slot.id]);
  const exposed = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  if (!params) return <Note>Reading its parameters…</Note>;
  if (!params.length) return <Note>It has no parameters to show here: use its window.</Note>;
  const shown = q ? params.filter(p => p.name.toLowerCase().includes(q.toLowerCase())) : params.slice(0, 200);
  const set = (p: AuParam, v: number) => {
    audioEngineHost.setParamNow(rack.id, slot.id, p.address, v);
    onChange(pr => withEngine(pr, patchSlot(pr.audioEngine, rack.id, slot.id, { params: { ...slot.params, [p.address]: v } })));
  };
  const expose = (p: AuParam) => {
    const target = auTarget(rack.id, slot.id, p.address);
    const label = `${rack.name} · ${slot.unit?.name ?? 'Audio Unit'} · ${p.name}`;
    onChange(pr => {
      if (pr.controls.some(c => c.target === target)) return pr;
      toast.success(`${label} is a control`, { message: 'Map a source onto it in Mappings (audio readers, MIDI, an LFO…).', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('controls') } });
      // The value it has now is kept, so the control starts there (and a mapping that lets go comes back to it).
      const withValue = withEngine(pr, patchSlot(pr.audioEngine, rack.id, slot.id, { params: { ...aeSlot(aeRack(pr.audioEngine, rack.id), slot.id)?.params, [p.address]: slot.params?.[p.address] ?? p.value } }));
      return { ...withValue, controls: [...withValue.controls, { id: playId('ctl'), target, kind: 'float', label, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}) }] };
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {params.length > 8 && <input aria-label="Filter parameters" placeholder={`Filter ${params.length} parameters`} value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0, height: 26, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />}
        <Button size="sm" variant="ghost" icon="save" onClick={onKeep} title="Keep everything the plug-in is set to (its preset, including what you changed in its own window) with this setup">Keep its settings</Button>
      </div>
      {shown.map(p => {
        const v = slot.params?.[p.address] ?? p.value;
        const target = auTarget(rack.id, slot.id, p.address);
        const isExposed = exposed.has(target);
        return (
          <div key={p.address} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 34%) 1fr 26px', alignItems: 'center', gap: 6 }}>
            <span title={`${p.name}${p.unit ? ` (${p.unit})` : ''}`} style={{ color: tk.text.secondary, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            {p.kind === 'toggle' ? (
              <Toggle checked={v >= 0.5} onChange={on => set(p, on ? p.max : p.min)} label={formatParam(p, v)} />
            ) : p.kind === 'list' && p.values?.length ? (
              <Select ariaLabel={p.name} value={String(Math.round(v))} height={26} onChange={x => set(p, Number(x))}
                options={p.values.map((label, i) => ({ value: String(Math.round(p.min) + i), label }))} />
            ) : (
              <RulerSlider value={v} min={p.min} max={p.max} step={p.step || (p.max - p.min) / 1000} defaultValue={p.value} hard onChange={x => set(p, x)} ariaLabel={p.name} touch={touch} integer={p.step === 1} />
            )}
            <IconButton icon={isExposed ? 'check' : 'plus'} size="sm" active={isExposed} disabled={isExposed} label={isExposed ? 'Already a control' : `Make ${p.name} a control, to map audio, MIDI or an LFO onto it`} onClick={() => expose(p)} />
          </div>
        );
      })}
      {!q && params.length > 200 && <Note>{params.length - 200} more: filter to find them.</Note>}
    </div>
  );
}

// ── The sample player's sounds ───────────────────────────────────────────────

function SamplerZones({ rack, slot, onChange }: { rack: AeRack; slot: AeSlot; onChange: Change }) {
  const tk = useTokens();
  const { videos } = useLibraryVideos();
  const sounds = useMemo(() => (videos ?? []).filter(v => isAudioType(v.type)), [videos]);
  const zones = slot.zones ?? [];
  const [adding, setAdding] = useState('');
  const setZones = (z: AeZone[]) => onChange(p => withEngine(p, patchSlot(p.audioEngine, rack.id, AE_INST, { zones: z.slice(0, AE_ZONES_MAX) })));
  const nextNote = zones.length ? Math.min(127, Math.max(...zones.map(z => z.hi)) + 1) : AE_PAD_BASE_NOTE;
  const addSound = (id: string, mode: 'keys' | 'pitched') => {
    const s = sounds.find(x => x.id === id);
    if (!s) return;
    setZones(mode === 'pitched' ? [...zones, ...zonesFor([s], 'pitched')] : [...zones, ...zonesFor([s], 'keys', nextNote)]);
    setAdding('');
  };
  const allKeys = () => setZones(zonesFor(sounds.slice(0, 16), 'keys'));
  const noteSel = (value: number, onPick: (n: number) => void, label: string) => (
    <Select ariaLabel={label} value={String(value)} height={24} onChange={v => onPick(Number(v))} style={{ minWidth: 0 }}
      options={Array.from({ length: 128 }, (_, n) => ({ value: String(n), label: `${midiNoteName(n)} (${n})` }))} />
  );
  const patchZone = (i: number, over: Partial<AeZone>) => setZones(zones.map((z, j) => (j === i ? { ...z, ...over } : z)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {zones.length === 0 && <Note>No sounds yet. Add sounds from the Library (Library → Backgrounds → Sounds → Upload sounds): one per key like a drum rack from C2 (36), or one across the keyboard, pitched from C4.</Note>}
      {zones.map((z, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 1fr) auto auto auto 26px', alignItems: 'center', gap: 4 }}>
          <span title={z.name} style={{ color: tk.text.secondary, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.name}</span>
          {noteSel(z.lo, n => patchZone(i, { lo: n, hi: Math.max(n, z.hi), ...(z.lo === z.hi && z.root === z.lo ? { root: n, hi: n } : {}) }), 'Lowest note')}
          {noteSel(z.hi, n => patchZone(i, { hi: n, lo: Math.min(n, z.lo) }), 'Highest note')}
          {noteSel(z.root, n => patchZone(i, { root: n }), 'Its own pitch on')}
          <IconButton icon="close" size="sm" label="Remove this sound" onClick={() => setZones(zones.filter((_, j) => j !== i))} />
        </div>
      ))}
      {zones.length > 0 && <Note>Each row: the lowest and highest key it plays, and the key where it plays at its own pitch.</Note>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Select ariaLabel="A sound from the Library" value={adding} height={28} style={{ flex: '1 1 160px', minWidth: 0 }} onChange={setAdding}
          options={[{ value: '', label: sounds.length ? 'A sound from the Library…' : 'No sounds in the Library yet' }, ...sounds.map(s => ({ value: s.id, label: s.name }))]} />
        <Button size="sm" disabled={!adding || zones.length >= AE_ZONES_MAX} onClick={() => addSound(adding, 'keys')} title={`On the next key (${midiNoteName(nextNote)})`}>Add on one key</Button>
        <Button size="sm" disabled={!adding || zones.length >= AE_ZONES_MAX} onClick={() => addSound(adding, 'pitched')} title="Across every key, at its own pitch on C4">Across the keys</Button>
        {sounds.length > 1 && zones.length === 0 && <Button size="sm" variant="ghost" onClick={allKeys}>Use the first {Math.min(16, sounds.length)} as a kit</Button>}
      </div>
    </div>
  );
}
