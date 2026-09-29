/**
 * RackParts — the pieces of an Audio engine rack the Arrangement view's
 * device chain (DeviceChain.tsx) is made of: what plays it (MIDI input and
 * channel, the computer keyboard, a send), its instrument (an Audio Unit
 * synth, the sample player's zones, the Granulator), each Audio Unit slot
 * (window, parameters, Configure, bypass), the spectrum with the readers that
 * listen to it, and a strip of keys to try it with the mouse; and the record
 * edits the track header and the chain make (useRackEdits).
 *
 * Each plug-in parameter can become a control (+), target
 * `au:<rack>:<slot>::<address>`; a value moved here is kept in the setup.
 *
 * Sound in (desktop): instead of an instrument, a rack can take a web sound
 * (everything the page plays, or one layer's) through its effects
 * (lib/engineSend.ts); the page stops playing that sound itself.
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
import { EMPTY_READERS, useReadersPanel } from '../readersPanelUi';
import { READER_GAIN_MAX, READER_GAIN_MIN } from '../../../play/audioReaders';
import { addReader, newReader, patchReader, regroupReaderControls, setReaderInput } from '../../../play/readerControls';
import { AUDIO_READERS_MAX, type PlayRecord } from '../../../types/play';
import { ReaderDots } from '../ReaderDots';
import {
  AE_EFFECTS_MAX, AE_INST, AE_PAD_BASE_NOTE, AE_ZONES_MAX, aeRack, aeSlot, aeSlotName, auTarget, patchRack, patchSlot, zonesFor,
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
import type { UnitChoice } from './UnitPicker';
import { playId } from '../../../play/playControls';
import { usePlayUi } from '../playUi';
import { engineId, withEngine } from './engineOps';
import { sendChoices, sendLabel } from '../../../lib/engineSend';
import { GranulatorPanel, ParamRow } from './GranulatorPanel';
import { Section } from '../layers/Section';
import { SI_MODE_NAMES, siClamp, siParam } from '../../../play/kit/samplerIndex.js';
import type { GrParam } from '../../../play/kit/granulator.js';
import { AUDIO_FX_EFFECTS, rackChainId } from '../../../types/playAudioFx';
import { RACK_CONTROLS_MAX } from '../../../types/playArrangement';
import { regroupRackControls } from '../../../play/rackControls';
import { ConfigurePanel } from './RackControls';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/**
 * A rack's record edits, as the track header and the device chain make them:
 * choose an instrument or add an effect (from UnitPicker), remove a slot,
 * rename, recolour, delete the rack. Each goes through withEngine, so controls
 * and mappings on what's removed go too.
 */
export function useRackEdits(rack: AeRack, onChange: Change) {
  const edit = (fn: (ae: PlayAudioEngine | undefined) => PlayAudioEngine) => onChange(p => withEngine(p, fn(p.audioEngine)));
  const patch = (over: Partial<AeRack>) => edit(ae => patchRack(ae, rack.id, over));
  const pick = (want: 'instrument' | 'effect', c: UnitChoice) => {
    if (want === 'instrument') {
      const inst: AeSlot = c.kind === 'sampler'
        ? { id: AE_INST, kind: 'sampler', zones: rack.instrument?.kind === 'sampler' ? rack.instrument.zones : [] }
        : c.kind === 'granulator'
          ? (rack.instrument?.kind === 'granulator' ? rack.instrument : { id: AE_INST, kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' } })
          : { id: AE_INST, kind: 'au', unit: { type: c.unit.type, subtype: c.unit.subtype, manufacturer: c.unit.manufacturer, name: c.unit.name, vendor: c.unit.vendor } };
      onChange(p => regroupRackControls(withEngine(p, patchRack(p.audioEngine, rack.id, { instrument: inst }))));
    } else if (c.kind === 'au') {
      if (rack.effects.length >= AE_EFFECTS_MAX) { toast.error(`A rack takes ${AE_EFFECTS_MAX} effects at most`); return; }
      const fx: AeSlot = { id: engineId('fx'), kind: 'au', unit: { type: c.unit.type, subtype: c.unit.subtype, manufacturer: c.unit.manufacturer, name: c.unit.name, vendor: c.unit.vendor } };
      edit(ae => patchRack(ae, rack.id, r => ({ ...r, effects: [...r.effects, fx] })));
    }
  };
  const removeSlot = (slotId: string) => edit(ae => patchRack(ae, rack.id, r => (slotId === AE_INST ? { ...r, instrument: null } : { ...r, effects: r.effects.filter(e => e.id !== slotId) })));
  const remove = async () => {
    if (rack.instrument || rack.effects.length) {
      const ok = await askConfirm(`Delete ${rack.name}?`, { message: 'Its instrument, effects, track on the tape and any controls on their parameters go with it.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    audioEngineHost.releaseHeld(rack.id);
    edit(ae => ({ ...ae, racks: (ae?.racks ?? []).filter(r => r.id !== rack.id) }));
  };
  const rename = async () => {
    const name = await askText('Rename track', { initial: rack.name, confirmLabel: 'Rename' });
    // The readers' and rack controls' groups are named after the rack: they follow.
    if (name && name.trim()) onChange(p => regroupRackControls(regroupReaderControls(withEngine(p, patchRack(p.audioEngine, rack.id, { name: name.trim().slice(0, 60) })))));
  };
  const toggleMute = () => { if (!rack.mute) audioEngineHost.releaseHeld(rack.id); patch({ mute: !rack.mute }); };
  return { edit, patch, pick, removeSlot, remove, rename, toggleMute };
}

/** "Lead" (and "Locked") on the track that takes the MIDI input. */
export function LeadChip({ locked, own }: { locked: boolean; own: boolean }) {
  const tk = useTokens();
  return (
    <span title={own ? 'The lead, but this rack has its own MIDI device or channel: it plays what that sends' : locked ? 'Locked as the lead: it takes MIDI notes, the computer keyboard and pad hits' : 'The lead: it takes MIDI notes, the computer keyboard and pad hits (select another card to hand them over, or lock it)'}
      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, background: alpha(tk.accent.base, 0.14), color: tk.accent.text, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {locked && <Icon name="lock" size={10} />}Lead{locked ? ' · locked' : ''}
    </span>
  );
}

export const labelStyle = (tk: ReturnType<typeof useTokens>): CSSProperties => ({ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' });

export function Caption({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ ...labelStyle(tk), marginTop: 2 }}>{children}</span>;
}

export function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'bad' }) {
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
export function InputRow({ rack, onPatch, onKeyboard, touch }: { rack: AeRack; onPatch: (o: Partial<AeRack>) => void; onKeyboard: (on: boolean) => void; touch: boolean }) {
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

/**
 * Sound in (desktop): the rack plays its instrument from MIDI, or takes a web
 * sound through its effects (lib/engineSend.ts). The instrument slot is kept
 * in the record while a send is on and comes back when it's turned off.
 */
export function SourceRow({ rack, play, onPatch }: { rack: AeRack; play: PlayRecord; onPatch: (o: Partial<AeRack>) => void }) {
  const tk = useTokens();
  const choices = sendChoices(play.layers);
  const options = [
    { value: '', label: rack.instrument ? 'Its instrument, from MIDI' : 'An instrument, from MIDI' },
    ...choices,
    ...(rack.source && !choices.some(c => c.value === rack.source) ? [{ value: rack.source, label: sendLabel(rack.source, play.layers) }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ ...labelStyle(tk), width: 64 }}>Sound in</span>
      <Select ariaLabel="What the rack plays" value={rack.source ?? ''} options={options} height={28} style={{ flex: '1 1 200px', minWidth: 0 }}
        onChange={v => onPatch(v ? { source: v } : { source: undefined })} />
    </div>
  );
}

/** A sending rack: what it takes, how the send is doing, and the way back. */
export function SendView({ rack, play }: { rack: AeRack; play: PlayRecord }) {
  const tk = useTokens();
  const key = `${rack.id}/${AE_INST}`;
  const error = useEngineUi(s => s.errors[key]);
  const loading = useEngineUi(s => !!s.loading[key]);
  const rate = useEngineUi(s => s.status.sampleRate);
  const [stats, setStats] = useState<{ queued: number; underruns: number } | null>(null);
  useEffect(() => {
    let on = true;
    const tick = async () => { const st = await audioEngineHost.inputStats(rack.id); if (on) setStats(st); };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => { on = false; clearInterval(id); };
  }, [rack.id]);
  return (
    <div style={{ borderRadius: radius.md, background: tk.bg.field, padding: '8px 8px 8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Icon name="import" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sendLabel(rack.source ?? '', play.layers)}{loading ? ' · connecting…' : ''}</b>
          <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}` }}>
            Sent through the effects below and heard from the engine’s output; the page no longer plays it.
            {stats && rate > 0 ? ` About ${Math.round(stats.queued / rate * 1000)} ms in the engine’s buffer${stats.underruns ? ` · ${stats.underruns} dropouts` : ''}.` : ''}
          </span>
        </span>
      </div>
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Note tone="bad">{error}</Note>
          <Button size="sm" variant="ghost" icon="rebuild" onClick={() => audioEngineHost.retry(rack.id, AE_INST)}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/** A Granulator's Sound chain (`rack:<id>`, Finish → Sound): how many effects, and the way there. */
export function GrainChainRow({ rack, play }: { rack: AeRack; play: PlayRecord }) {
  const tk = useTokens();
  const chain = play.audioFx?.chains[rackChainId(rack.id)];
  const n = chain?.effects.length ?? 0;
  const open = () => { usePlayUi.getState().setFinishView('sound'); usePlayUi.getState().setTab('finish'); };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ ...labelStyle(tk), width: 64 }}>Sound fx</span>
      <span style={{ flex: '1 1 140px', color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>
        {n ? `${chain!.effects.map(e => AUDIO_FX_EFFECTS[e.kind].label).join(' → ')}${chain!.on ? '' : ' (off)'}` : 'None yet: filter, echo, reverb, distortion, compressor.'}
      </span>
      <Button size="sm" variant="ghost" icon="sliders" onClick={open} title="Finish → Sound: this rack’s own chain">Sound effects…</Button>
    </div>
  );
}

const EMPTY_HELD: number[] = [];

/** Two octaves to click (Shift: full velocity), from C3. */
export function Keys({ rackId, touch }: { rackId: string; touch: boolean }) {
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

export function RackSpectrum({ id, name, play, onChange }: { id: string; name: string; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const cfg = play.audioReaders ?? EMPTY_READERS;
  const input = engineReaderInput(id);
  const mine = cfg.input === input;
  const [selected, setSelected] = useState('');
  // Reader edits go through play/readerControls.ts: each reader comes with a control in "Audio readers · <rack>".
  const listenHere = () => onChange(p => setReaderInput(p, input));
  const add = (hz: number, topDb: number) => {
    if (!mine || cfg.readers.length >= AUDIO_READERS_MAX) return;
    const r = newReader(readerId(), hz, topDb, cfg.readers);
    onChange(p => addReader(p, r));
    setSelected(r.id);
  };
  const move = (id: string, hz: number, gain: number) => onChange(p => patchReader(p, id, { hz, gain: Math.max(READER_GAIN_MIN, Math.min(READER_GAIN_MAX, gain)) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SpectrumView compact readers={mine ? cfg.readers : []} selected={selected} peakHold={false} height={92}
        canAdd={mine && cfg.readers.length < AUDIO_READERS_MAX} onSelect={setSelected} onAdd={add} onMove={move}
        spectrum={() => audioEngineHost.spectrum(id)} emptyText="Silent: play a note" />
      <ReaderDots play={play} input={input} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {!mine && <Button size="sm" icon="wave" onClick={listenHere} title="Point the setup’s audio readers at this rack’s sound">Readers listen here</Button>}
        <Button size="sm" variant={mine ? 'primary' : 'ghost'} icon="wave" onClick={() => { listenHere(); useReadersPanel.getState().show({ focus: selected || cfg.readers[0]?.id || '' }); }}>Audio readers…</Button>
        <span style={{ flex: '1 1 140px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{mine ? 'Click the spectrum to place a reader: it becomes a control in Audio readers · ' + name + '.' : 'The readers listen to something else now.'}</span>
      </div>
    </div>
  );
}

// ── A slot: the instrument or an effect ──────────────────────────────────────

/**
 * One slot as a device: its name, the plug-in's window, parameters,
 * Configure, bypass (its on/off), earlier/later (left/right in the chain;
 * dragging does the same), replace, remove; under it `children` (the slot's
 * rack controls) and what the slot has to set (zones, the Granulator, the
 * parameter list). `grip`: drawn first in the title row (the drag handle).
 *
 * `folded`/`onToggleFold` (Task: collapsible devices in a rack): folds it to
 * the header row alone — its name, bypass and `summary`, a one-line readout
 * of its rack controls — dropping the rest (params, Configure's panel, the
 * Granulator/sampler settings). Still folds while `configuring`: touching a
 * parameter in the plug-in's own window (docs/arrangement.md, "touch to
 * configure") keeps working, since that only needs Configure's own watch,
 * not this panel drawn open.
 */
export function SlotView({ rack, slot, play, onChange, touch, desktop, pluginsOk, first, last, onMove, onBypass, onRemove, onReplace, grip, children, folded, onToggleFold, summary }: {
  rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean; desktop: boolean; pluginsOk: boolean;
  first?: boolean; last?: boolean;
  onMove?: (by: -1 | 1) => void; onBypass?: () => void; onRemove: () => void; onReplace?: () => void;
  grip?: React.ReactNode; children?: React.ReactNode;
  folded?: boolean; onToggleFold?: () => void; summary?: string;
}) {
  const tk = useTokens();
  const key = `${rack.id}/${slot.id}`;
  const error = useEngineUi(s => s.errors[key]);
  const loading = useEngineUi(s => !!s.loading[key]);
  const [open, setOpen] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const isAu = slot.kind === 'au';
  const canConfigure = slot.kind === 'granulator' || slot.kind === 'sampler' || (isAu && desktop && pluginsOk);
  const name = aeSlotName(slot);
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
  // Still shown open while configuring, even folded: the touch-to-configure watch lives in ConfigurePanel.
  const collapsed = !!folded && !configuring;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: slot.bypass || offline ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
        {onToggleFold && <IconButton icon={collapsed ? 'chevR' : 'chevD'} size="sm" label={collapsed ? 'Expand' : 'Collapse to its name, on/off and a summary'} onClick={onToggleFold} />}
        {grip}
        {onBypass && <IconButton icon="bypass" size="sm" active={!slot.bypass} label={slot.bypass ? 'Off (bypassed): turn it on' : 'On: bypass it'} onClick={onBypass} />}
        <Icon name={slot.id === AE_INST ? (isAu ? 'piano' : slot.kind === 'granulator' ? 'wave' : 'import') : 'wave'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <span onDoubleClick={onToggleFold} style={{ flex: '1 1 90px', minWidth: 0, display: 'flex', flexDirection: 'column', cursor: onToggleFold ? 'pointer' : undefined }}>
          <b style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}{loading ? ' · loading…' : ''}</b>
          {isAu && !collapsed && <span style={{ color: tk.text.muted, font: `10.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.unit?.vendor}{slot.state ? ' · settings kept' : ''}</span>}
          {collapsed && summary && <span title={summary} style={{ color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
        </span>
        {!collapsed && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
            {isAu && desktop && pluginsOk && <IconButton icon="popout" size="sm" label="Open window: the plug-in’s own view" onClick={() => void openWindow()} />}
            {isAu && desktop && pluginsOk && <IconButton icon="sliders" size="sm" active={open} label={open ? 'Hide parameters' : 'Parameters'} onClick={() => setOpen(o => !o)} />}
            {canConfigure && <IconButton icon="target" size="sm" active={configuring} label={configuring ? 'Done configuring' : `Configure: pick up to ${RACK_CONTROLS_MAX} rack controls${isAu ? ' (touch them in its window, or pick from the list)' : ''}`} onClick={() => setConfiguring(c => !c)} />}
            {onMove && <IconButton icon="chevL" size="sm" label="Earlier in the chain" disabled={first} onClick={() => onMove(-1)} />}
            {onMove && <IconButton icon="chevR" size="sm" label="Later in the chain" disabled={last} onClick={() => onMove(1)} />}
            {onReplace && <IconButton icon="reset" size="sm" label="Choose another instrument" onClick={onReplace} />}
            <IconButton icon="trash" size="sm" tone="danger" label="Remove" onClick={onRemove} />
          </span>
        )}
      </div>
      {!collapsed && children}
      {!collapsed && offline && <Note>{!desktop ? 'Plays in the desktop app on a Mac; kept here as it is.' : 'Audio Unit plug-ins are part of Pro: kept as it is, silent until then.'}</Note>}
      {!collapsed && error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Note tone="bad">{error}</Note>
          <Button size="sm" variant="ghost" icon="rebuild" onClick={() => audioEngineHost.retry(rack.id, slot.id)}>Try again</Button>
        </div>
      )}
      {configuring && <ConfigurePanel rack={rack} slot={slot} play={play} onChange={onChange} desktop={desktop} onClose={() => setConfiguring(false)} />}
      {!collapsed && slot.kind === 'sampler' && <SamplerZones rack={rack} slot={slot} onChange={onChange} />}
      {!collapsed && slot.kind === 'sampler' && <SamplerIndex rack={rack} slot={slot} play={play} onChange={onChange} touch={touch} />}
      {!collapsed && slot.kind === 'granulator' && <GranulatorPanel rack={rack} slot={slot} play={play} onChange={onChange} touch={touch} />}
      {!collapsed && isAu && open && desktop && pluginsOk && <Params rack={rack} slot={slot} play={play} onChange={onChange} touch={touch} onKeep={() => void keepState()} />}
    </div>
  );
}

export function Params({ rack, slot, play, onChange, touch, onKeep }: { rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean; onKeep: () => void }) {
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

// ── The sample player's Sample index ─────────────────────────────────────────

/**
 * The sample player's Sample index (docs/audio-engine.md, "Sample index"):
 * Index, its mode, spread and seed, each with a + that makes it a control
 * (`au:<rack>:inst::<address>`, like a granulator setting). Folded by
 * default, with a one-line summary.
 */
export function SamplerIndex({ rack, slot, play, onChange, touch }: { rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean }) {
  const exposed = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  const valueOf = (key: string) => { const p = siParam(key)!; return slot.params?.[String(p.addr)] ?? p.value; };
  const set = (key: string, v: number) => onChange(pr => {
    const cur = aeSlot(aeRack(pr.audioEngine, rack.id), AE_INST);
    if (cur?.kind !== 'sampler') return pr;
    const p = siParam(key)!;
    return withEngine(pr, patchSlot(pr.audioEngine, rack.id, AE_INST, { params: { ...cur.params, [String(p.addr)]: siClamp(key, v) } }));
  });
  const expose = (p: GrParam) => {
    const target = auTarget(rack.id, AE_INST, String(p.addr));
    const label = `${rack.name} · Sample player · ${p.name}`;
    onChange(pr => {
      if (pr.controls.some(c => c.target === target)) return pr;
      toast.success(`${label} is a control`, { message: 'Map a source onto it in Mappings (an Increment, a beat, a signal, MIDI…).', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('controls') } });
      return { ...pr, controls: [...pr.controls, { id: playId('ctl'), target, kind: 'float', label, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}) }] };
    });
  };
  const mode = Math.round(valueOf('indexMode'));
  const summary = `${SI_MODE_NAMES[mode] ?? 'Index'}${mode === 1 ? '' : ` · Index ${Math.round(valueOf('sampleIndex'))}`}${mode === 2 ? ` ± ${Math.round(valueOf('indexSpread'))}` : ''}`;
  const keys = ['sampleIndex', 'indexMode', ...(mode === 2 ? ['indexSpread'] : []), ...(mode === 0 ? [] : ['indexSeed'])];
  return (
    <Section kind="engine-sampler" title="Sample index" summary={summary}
      hint="A note plays the zone Index places on from the one it lands in (zones in key order, wrapping round), at the same distance from that zone’s root key. Takes record the note actually played.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {keys.map(k => {
          const p = siParam(k)!;
          return <ParamRow key={k} p={p} value={valueOf(k)} touch={touch} soft={k === 'sampleIndex' || k === 'indexSpread'}
            exposed={exposed.has(auTarget(rack.id, AE_INST, String(p.addr)))} onSet={v => set(k, v)} onExpose={() => expose(p)} />;
        })}
      </div>
    </Section>
  );
}

// ── The sample player's sounds ───────────────────────────────────────────────

export function SamplerZones({ rack, slot, onChange }: { rack: AeRack; slot: AeSlot; onChange: Change }) {
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
