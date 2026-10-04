/**
 * ArrangementPanel — the Audio engine, one view, laid out like a DAW's
 * arrangement (docs/arrangement.md, "The Arrangement view"):
 *
 *   transport   Play/Pause (Space while the engine has focus), Stop (back to
 *               the start), Record, Loop, Metronome, Count-in, BPM, where the
 *               tape is (bars.beats.sixteenths and time), Make a take, MIDI
 *   tracks      one per rack: a header (colour, instrument, name, Lead, arm,
 *               mute, solo, volume, meter; drag to reorder) and a lane on the
 *               bar/beat timeline with the loop brace, the record point and the
 *               playhead. Recordings are clips that look like audio (the
 *               notes by default, or the track's rendered sound / an envelope
 *               from its notes when the track shows as Audio): select, mute,
 *               delete, trim their ends. Note editing is a follow-up.
 *   master      the engine's output, at the bottom
 *   devices     the selected track's chain (DeviceChain.tsx), at the bottom, or
 *               (the Notes/Device switch) a MIDI clip's notes in the piano roll
 *               (PianoRoll.tsx); double-click a clip to open it in its own
 *               window (PianoRollWindow.tsx), Edit notes here to open it there
 *
 * Perf: transport ticks never re-render React. The playheads, a recording's
 * growing clip, the position readout and the meters move on their own
 * animation frame; lanes redraw their canvas only when their track, preview,
 * size or selection changes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Segmented } from '../../ui/Choice';
import { Icon } from '../../ui/Icon';
import { NOTE_NAMES, SCALES } from '../../../play/scales';
import type { IconName } from '../../ui/iconPaths';
import { Menu, type MenuItem } from '../../ui/Menu';
import { loadRackPresets, rackPresetSummary } from '../../../play/rackPresets';
import { applyRackPresetToPlay, presetSoundToMaster, saveRackAsPreset } from '../presetsUi';
import { toast } from '../../ui/toastStore';
import { askConfirm } from '../../ui/dialogStore';
import type { PlayRecord } from '../../../types/play';
import {
  COUNT_INS, NOTE_MIN, TAPE_MAX_SECONDS, addNote, clearTrack, clipBounds, deleteClip, deleteNote, emptyArrangement, notePitchRange, patchNote, patchTrack, recordBpm, setClipMute, trackClips, trimClip,
  type ArrClip, type ArrNote, type ArrTrack, type CountIn, type PlayArrangement,
} from '../../../types/playArrangement';
import { AE_RACKS_MAX, newRack, patchRack, type AeRack } from '../../../types/playAudioEngine';
import { tape, useTape, type TapePhase } from '../../../lib/tape';
import { refreshPreviews, useTapePreviews, type LanePreview } from '../../../lib/tapePreview';
import { arrangementTake } from '../../../lib/tapeTake';
import { addTake, useTakes } from '../../../lib/takes';
import { audioEngineHost, useEngineSelection, useEnginePrefs, useEngineUi } from '../../../lib/audioEngineHost';
import { ENGINE_MASTER } from '../../../lib/engineSound';
import { keyboardClaimed } from '../../../lib/keyboardClaim';
import { isTauri } from '../../../lib/midiTransport';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { MidiStatusChip } from '../chips';
import {
  TRACK_COLORS, barsBeats, clipWave, engineTracks, moveTrack, parseBarsBeats, rulerTicks, snapPoint, tapeStep, type StepUnit, type TrackInstrument, type TrackRow,
} from '../../../play/engineView';
import { engineId, withEngine } from './engineOps';
import { lockLead, selectRack } from './selectRack';
import { LeadChip, useRackEdits } from './RackParts';
import { UnitPicker } from './UnitPicker';
import { DeviceChain, MasterChain } from './DeviceChain';
import { PianoRoll } from './PianoRoll';
import { PianoRollWindowHost } from './PianoRollWindow';
import { usePianoRollWindow } from './pianoRollWindowStore';
import { scaleBadge } from '../../../play/pianoRollWindow';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** Settings changes (loop, metronome, mute…) aren't undo steps: they're how the tape plays, like a mixer's. */
function setArr(fn: (a: PlayArrangement) => PlayArrangement): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: fn(p.arrangement ?? emptyArrangement(recordBpm(p.mappings))) }), false);
}

/** An edit to the tape that is an undo step. */
function editArr(fn: (a: PlayArrangement) => PlayArrangement, label: string): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: fn(p.arrangement ?? emptyArrangement(recordBpm(p.mappings))) }), { label });
}

const fmt = (s: number) => {
  const neg = s < 0 ? '−' : '';
  const a = Math.abs(s), m = Math.floor(a / 60), r = a - m * 60;
  return `${neg}${m}:${r.toFixed(1).padStart(4, '0')}`;
};

/** The header column's width beside the lanes (wide layout). */
const HEAD_W = 212;
/** Below this panel width the tracks stack: header above lane. */
const NARROW_PX = 560;

const INSTRUMENT_ICON: Record<TrackInstrument, IconName> = { au: 'piano', sampler: 'grid', granulator: 'swarm', send: 'import', none: 'piano' };

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

// ── Meters: one animation frame for all of them ─────────────────────────────

type MeterEl = { el: HTMLElement; id: string };
const meters = new Set<MeterEl>();
let meterRaf = 0, meterLast = 0;
function meterLoop(t: number): void {
  meterRaf = meters.size ? requestAnimationFrame(meterLoop) : 0;
  if (t - meterLast < 33 || (typeof document !== 'undefined' && document.hidden)) return;
  meterLast = t;
  for (const m of meters) {
    const s = audioEngineHost.spectrum(m.id);
    const db = s && s.rms > 0 ? 20 * Math.log10(s.rms) : -120;
    const f = Math.max(0, Math.min(1, (db + 54) / 54));
    m.el.style.transform = `scaleX(${f})`;
    m.el.style.background = db > -3 ? '#ff5a4f' : db > -12 ? '#f5c542' : '#46c46a';
  }
}

/** A small level meter for a rack (or the master): its sound's RMS, on the shared frame. */
function Meter({ id, width = '100%' }: { id: string; width?: number | string }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = { el, id };
    meters.add(m);
    if (!meterRaf) meterRaf = requestAnimationFrame(meterLoop);
    return () => { meters.delete(m); };
  }, [id]);
  return (
    <span aria-hidden style={{ display: 'block', width, height: 4, borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
      <span ref={ref} style={{ display: 'block', height: '100%', width: '100%', transformOrigin: 'left', transform: 'scaleX(0)', background: '#46c46a' }} />
    </span>
  );
}

// ── The view ────────────────────────────────────────────────────────────────

export function ArrangementPanel({ play, onChange, touch }: { play: PlayRecord; onChange: Change; touch: boolean }) {
  const tk = useTokens();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const narrow = width > 0 && width < NARROW_PX;
  const racks = useMemo(() => play.audioEngine?.racks ?? [], [play.audioEngine]);
  const arr = play.arrangement ?? emptyArrangement(recordBpm(play.mappings));
  const phase = useTape(s => s.phase);
  const count = useTape(s => s.count);
  const selected = useEngineSelection(s => s.selected);
  const rows = useMemo(() => engineTracks(play.audioEngine, play.arrangement, selected, play.audioReaders?.input ?? ''), [play.audioEngine, play.arrangement, selected, play.audioReaders?.input]);
  const [chainOf, setChainOf] = useState<'track' | 'master'>('track');
  const [clipSel, setClipSel] = useState<{ rack: string; index: number } | null>(null);
  const [picker, setPicker] = useState<{ rack: string; want: 'instrument' | 'effect' } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  // The device area shows the selected track's devices or (Notes) a MIDI clip in the piano roll: `t` is a time inside it, `key` refits on each open.
  const [devView, setDevView] = useState<'device' | 'notes'>('device');
  const [roll, setRoll] = useState<{ rack: string; t: number; key: number } | null>(null);
  const [chainH, setChainH] = useState(() => { try { return Number(localStorage.getItem('shader-studio:engine:chainH')) || 280; } catch { return 280; } });
  const lanes = useTapePreviews(s => s.lanes);
  // Previews follow the tape and the racks (each lane renders again only when its own track or rack changed).
  useEffect(() => { refreshPreviews(useNodeGraphStore.getState().play); }, [play.arrangement, play.audioEngine]);
  // A clip selection that no longer exists goes.
  useEffect(() => {
    if (clipSel && !trackClips(play.arrangement?.tracks[clipSel.rack], play.arrangement?.length ?? 0)[clipSel.index]) setClipSel(null);
  }, [clipSel, play.arrangement]);

  const selRow = rows.find(r => r.selected);
  const selRack = racks.find(r => r.id === selRow?.id);
  const live = phase === 'recording' || phase === 'counting';
  // The view's span: the tape and some room; the whole minute while recording (the tape can grow).
  const span = live ? TAPE_MAX_SECONDS : Math.min(TAPE_MAX_SECONDS, Math.max(8, Math.ceil((arr.length || 4) * 1.25)));

  const addTrack = () => {
    if (racks.length >= AE_RACKS_MAX) return;
    const id = engineId('rk');
    onChange(p => { const list = p.audioEngine?.racks ?? []; return list.length >= AE_RACKS_MAX ? p : withEngine(p, { ...p.audioEngine, racks: [...list, newRack(id, list)] }); });
    selectRack(id);
    setChainOf('track');
    setPicker({ rack: id, want: 'instrument' });
  };
  const pickTrack = (id: string) => { selectRack(id); setChainOf('track'); };
  /** Double-click a MIDI clip: its notes in the piano roll window; `here`: in the device area (Notes). */
  const openClip = (rack: string, t: number, where: 'window' | 'here' = 'window') => {
    selectRack(rack);
    if (where === 'window') { usePianoRollWindow.getState().open(rack, t); return; }
    setChainOf('track');
    setRoll(r => ({ rack, t, key: (r?.key ?? 0) + 1 }));
    setDevView('notes');
    setChainH(h => Math.max(h, 420)); // room for the keys (not remembered: the drag sets that)
  };
  /** The Notes/Device switch: Notes opens the selected clip on this track, else its first. */
  const showNotes = () => {
    setDevView('notes');
    if (!selRack || roll?.rack === selRack.id) return;
    const clips = trackClips(arr.tracks[selRack.id], arr.length);
    const c = (clipSel?.rack === selRack.id ? clips[clipSel.index] : undefined) ?? clips[0];
    if (c) setRoll(r => ({ rack: selRack.id, t: c.t, key: (r?.key ?? 0) + 1 }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || keyboardClaimed(e.nativeEvent)) return;
    const st = useTape.getState();
    const scrubbing = st.phase === 'recording' || st.phase === 'counting'; // scrubbing is ignored while recording
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      tape.togglePlay();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && clipSel) {
      e.preventDefault(); e.stopPropagation();
      const name = racks.find(r => r.id === clipSel.rack)?.name ?? 'a track';
      editArr(a => deleteClip(a, clipSel.rack, clipSel.index), `Deleted a clip on ${name}`);
      setClipSel(null);
    } else if (e.key === 'Home' && !scrubbing) {
      e.preventDefault(); e.stopPropagation();
      tape.setPoint(0);
    } else if (e.key === 'End' && !scrubbing) {
      e.preventDefault(); e.stopPropagation();
      tape.setPoint(arr.length);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !scrubbing) {
      e.preventDefault(); e.stopPropagation();
      const unit: StepUnit = e.altKey ? 'beat' : 'bar';
      tape.setPoint(tapeStep(tape.position(), e.key === 'ArrowLeft' ? -1 : 1, arr.bpm, unit, arr.length));
    }
  };
  // Space on a focused button would also click it on key-up: that's the transport's now.
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === ' ' && !isTyping(e.target) && !keyboardClaimed(e.nativeEvent)) e.preventDefault(); };

  const dragChain = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = chainH;
    const move = (ev: PointerEvent) => setChainH(Math.max(140, Math.min(640, h0 - (ev.clientY - y0))));
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      setChainH(h => { try { localStorage.setItem('shader-studio:engine:chainH', String(h)); } catch { /* private window */ } return h; });
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };

  const timeline = (
    <Timeline play={play} arr={arr} racks={racks} rows={rows} span={span} lanes={lanes} phase={phase} narrow={narrow} touch={touch}
      masterSelected={chainOf === 'master'} clipSel={clipSel} onClipSel={setClipSel} onPickTrack={pickTrack} onPickMaster={() => setChainOf('master')}
      onAddTrack={addTrack} onMenu={setMenu} onChange={onChange} onOpenClip={openClip} />
  );
  const rollHere = roll && selRack && roll.rack === selRack.id ? roll : null;
  const chain = chainOf === 'master'
    ? <MasterChain play={play} onChange={onChange} touch={touch} narrow={narrow} />
    : selRack
      ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
            <Segmented<'device' | 'notes'> size="sm" ariaLabel="Device area" value={devView} onChange={v => (v === 'notes' ? showNotes() : setDevView('device'))}
              options={[{ value: 'device', label: 'Device' }, { value: 'notes', label: 'Notes' }]} />
            <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {devView === 'notes' ? 'Right-click another MIDI clip → Edit notes here to edit it here' : 'Double-click a MIDI clip to open its notes in the piano roll window'}
            </span>
          </div>
          {devView === 'device'
            ? <DeviceChain rack={selRack} row={selRow!} play={play} onChange={onChange} touch={touch} narrow={narrow} onPick={want => setPicker({ rack: selRack.id, want })} />
            : rollHere
              ? (
                <div style={{ flex: narrow ? 'none' : 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: narrow ? (touch ? 500 : 440) : undefined }}>
                  <PianoRoll key={rollHere.key} rack={selRack} arr={arr} anchor={rollHere.t} color={selRow!.color} touch={touch} onAnchor={t => setRoll(r => (r ? { ...r, t } : r))} />
                </div>
              )
              : <div style={{ flex: 1, minHeight: 80, display: 'grid', placeItems: 'center', color: tk.text.faint, font: `12px ${fontFamily.ui}`, padding: 12, textAlign: 'center' }}>{selRack.name} has no clips yet: record some notes, or double-click its lane to add one.</div>}
        </div>
      )
      : null;

  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={onKeyUp} data-engine-view=""
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none', position: 'relative', overflowY: narrow ? 'auto' : 'hidden' }}>
      <TransportBar play={play} arr={arr} touch={touch} narrow={narrow} />
      {narrow ? (
        <>
          <div style={{ padding: '0 10px' }}>{timeline}</div>
          {chain && <div style={{ borderTop: `1px solid ${tk.border.default}`, marginTop: 8 }}>{chain}</div>}
        </>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 90, overflowY: 'auto', padding: '0 12px 8px' }}>{timeline}</div>
          {chain && (
            <>
              <div role="separator" aria-orientation="horizontal" aria-label="Drag to resize the device chain" onPointerDown={dragChain}
                style={{ flexShrink: 0, height: 7, cursor: 'row-resize', borderTop: `1px solid ${tk.border.default}`, background: tk.bg.subtle, display: 'grid', placeItems: 'center', touchAction: 'none' }}>
                <span style={{ width: 36, height: 3, borderRadius: 2, background: tk.border.strong }} />
              </div>
              <div style={{ flexShrink: 0, height: chainH, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{chain}</div>
            </>
          )}
        </>
      )}
      {phase === 'counting' && count > 0 && (
        <div aria-live="polite" style={{ position: 'absolute', left: '50%', top: '38%', transform: 'translate(-50%, -50%)', padding: '10px 22px', borderRadius: radius.lg, background: alpha('#000', 0.72), color: '#fff', font: `700 28px ${fontFamily.mono}`, pointerEvents: 'none' }}>{count}</div>
      )}
      {picker && (() => {
        const r = racks.find(x => x.id === picker.rack);
        return r ? <PickerFor rack={r} want={picker.want} onChange={onChange} touch={touch} onClose={() => setPicker(null)} /> : null;
      })()}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onClose={() => setMenu(null)} />}
      <PianoRollWindowHost racks={racks} arr={arr} touch={touch} colorOf={id => rows.find(r => r.id === id)?.color ?? tk.accent.base} onDock={(rack, t) => openClip(rack, t, 'here')} />
      <style>{'@keyframes tapePulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }'}</style>
    </div>
  );
}

function PickerFor({ rack, want, onChange, touch, onClose }: { rack: AeRack; want: 'instrument' | 'effect'; onChange: Change; touch: boolean; onClose: () => void }) {
  const edits = useRackEdits(rack, onChange);
  return <UnitPicker want={want} compact={touch} onPick={c => { onClose(); edits.pick(want, c); }} onClose={onClose} />;
}

// ── The transport ───────────────────────────────────────────────────────────

function TransportButton({ label, onClick, active, tone, disabled, size, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean; tone?: 'danger'; disabled?: boolean; size: number; children: ReactNode }) {
  const tk = useTokens();
  const on = active ? (tone === 'danger' ? tk.status.danger : tk.accent.base) : null;
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick}
      style={{ width: size, height: size, borderRadius: radius.sm, border: 0, flexShrink: 0, display: 'grid', placeItems: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        background: on ? alpha(on, 0.16) : tk.bg.field, boxShadow: `inset 0 0 0 1px ${on ?? tk.border.default}`, color: on ?? tk.text.secondary }}>
      {children}
    </button>
  );
}

// |◀ ◀◀ ▶▶ ▶| — go to the start/end, and step a bar (⌥: a beat). No matching icon in the set: small inline glyphs.
function GlyphToStart() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2.5" y="3" width="2" height="10" /><path d="M13 3v10L5 8z" /></svg>; }
function GlyphToEnd() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="11.5" y="3" width="2" height="10" /><path d="M3 3v10l8-5z" /></svg>; }
function GlyphStepBack() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3v10L2.5 8z" /><path d="M14 3v10L7.5 8z" /></svg>; }
function GlyphStepFwd() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3v10L13.5 8z" /><path d="M2 3v10L8.5 8z" /></svg>; }

/** Play/Pause, Stop, Record, Loop, Metronome, Count-in, BPM, where the tape is. */
function TransportBar({ play, arr, touch, narrow }: { play: PlayRecord; arr: PlayArrangement; touch: boolean; narrow: boolean }) {
  const tk = useTokens();
  const phase = useTape(s => s.phase);
  const point = useTape(s => s.point);
  const count = useTape(s => s.count);
  const alone = useTape(s => s.selected);
  const mode = useTape(s => s.mode);
  const status = useEngineUi(s => s.status);
  const [midi, setMidi] = useState(false);
  const [posEdit, setPosEdit] = useState<string | null>(null);
  const bbRef = useRef<HTMLSpanElement>(null), timeRef = useRef<HTMLSpanElement>(null);
  const length = arr.length;
  const running = phase !== 'stopped';
  const recording = phase === 'recording' || phase === 'counting';
  const racksHere = !!play.audioEngine?.racks.length;
  // The readouts follow the tape on their own frame while it runs (no React re-render per tick).
  useEffect(() => {
    const bb = bbRef.current, tm = timeRef.current;
    if (!bb || !tm || posEdit !== null) return;
    const write = () => { const p = tape.position(); bb.textContent = barsBeats(p, arr.bpm); tm.textContent = `${fmt(p)} / ${fmt(tape.shownLength())}`; };
    write();
    if (!running) return;
    let raf = 0;
    const loop = () => { write(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, point, length, arr.bpm, posEdit]);
  const commitPos = () => {
    const t = posEdit === null ? null : parseBarsBeats(posEdit, arr.bpm);
    setPosEdit(null);
    if (t !== null) tape.setPoint(Math.min(length || Infinity, t));
  };
  const startEdit = () => { if (!recording) setPosEdit(barsBeats(tape.position(), arr.bpm).split('.').slice(0, 2).join('.')); };
  const aloneName = alone ? play.audioEngine?.racks.find(r => r.id === alone)?.name : '';
  const playLabel = running ? (recording ? (phase === 'counting' ? 'Pause: cancel the count-in' : 'Pause: stop recording (kept) and hold here') : 'Pause (Space)') : length > 0 ? `Play from ${barsBeats(point, arr.bpm)} (Space)` : 'Nothing on the tape yet: press Record';
  const recLabel = recording ? 'Stop recording (keeps it: one undo step)'
    : phase === 'playing' ? 'Punch in: record from here while the tape plays'
      : length > 0 ? `Record ${aloneName ? `${aloneName} alone ` : ''}from ${barsBeats(point, arr.bpm)}${arr.countIn ? ` after ${arr.countIn} bar${arr.countIn > 1 ? 's' : ''} of count-in` : ''}` : 'Record: the first recording sets the tape’s length';
  const b = touch ? 38 : 30;
  const makeTake = () => {
    const take = arrangementTake(play, `Tape ${(play.takes ?? []).filter(t => t.tape?.made).length + 1}`);
    if (!take) { toast.info('Nothing on the tape to make a take of'); return; }
    addTake(take);
    toast.success(`${take.name} is a take`, { message: 'Render it from Record like any take: the racks play the tape offline, sample by sample.', action: { label: 'Render…', onClick: () => useTakes.getState().renderTake(take.id) } });
  };
  const desktop = isTauri();
  const engineLine = !desktop ? '' : status.error ? status.error : status.ready ? `${Math.round(status.sampleRate / 100) / 10} kHz` : '';
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
      <div role="toolbar" aria-label="Transport" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <TransportButton label="Go to the start (Home)" size={b} disabled={recording || (point === 0 && !running)} onClick={() => tape.setPoint(0)}>
          <GlyphToStart />
        </TransportButton>
        <TransportButton label="One bar back (⌥: one beat; ← when the engine has focus)" size={b} disabled={recording} onClick={e => tape.setPoint(tapeStep(tape.position(), -1, arr.bpm, e.altKey ? 'beat' : 'bar', length))}>
          <GlyphStepBack />
        </TransportButton>
        <TransportButton label={playLabel} size={b} active={phase === 'playing'} disabled={!running && !(length > 0)} onClick={() => tape.togglePlay()}>
          <Icon name={running ? 'pause' : 'play'} size={15} />
        </TransportButton>
        <TransportButton label="One bar forward (⌥: one beat; → when the engine has focus)" size={b} disabled={recording} onClick={e => tape.setPoint(tapeStep(tape.position(), 1, arr.bpm, e.altKey ? 'beat' : 'bar', length))}>
          <GlyphStepFwd />
        </TransportButton>
        <TransportButton label="Go to the end of the material (End)" size={b} disabled={recording || !(length > 0)} onClick={() => tape.setPoint(length)}>
          <GlyphToEnd />
        </TransportButton>
        <TransportButton label="Stop: back to the start" size={b} disabled={!running && point === 0} onClick={() => tape.stopToStart()}>
          <span style={{ width: 10, height: 10, borderRadius: 1.5, background: 'currentColor' }} />
        </TransportButton>
        <TransportButton label={recLabel} size={b} active={recording} tone="danger" disabled={!racksHere} onClick={() => tape.record()}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: tk.status.danger, animation: phase === 'recording' ? 'tapePulse 1s ease-in-out infinite' : undefined }} />
        </TransportButton>
        <span style={{ width: 1, height: b - 8, background: tk.border.default, margin: '0 2px' }} />
        <TransportButton label={arr.loop ? 'Loop on: playback starts over at the end' : 'Loop off: playback stops at the end'} size={b} active={arr.loop} onClick={() => setArr(a => ({ ...a, loop: !a.loop }))}>
          <Icon name="loop" size={15} />
        </TransportButton>
        <TransportButton label={arr.metronome ? 'Metronome on: a click every beat (you hear it; recordings don’t)' : 'Metronome off (a count-in counts silently)'} size={b} active={arr.metronome} onClick={() => setArr(a => ({ ...a, metronome: !a.metronome }))}>
          <Icon name="clock" size={15} />
        </TransportButton>
        <Select ariaLabel="Count-in" value={String(arr.countIn)} height={b} style={{ flex: '0 1 112px', minWidth: 0 }}
          options={COUNT_INS.map(n => ({ value: String(n), label: n ? `Count-in ${n} bar${n > 1 ? 's' : ''}` : 'No count-in' }))}
          onChange={v => setArr(a => ({ ...a, countIn: Number(v) as CountIn }))} />
        <BpmField key={arr.bpm} bpm={arr.bpm} height={b} />
        <ScaleField scale={arr.scale} height={b} />
        <span title={posEdit !== null ? 'Position: bar.beat, Enter to move there' : 'Where the tape is: bar.beat.sixteenth, and time / the tape’s length (click to edit)'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', height: b, boxSizing: 'border-box', borderRadius: radius.sm, background: tk.bg.field, minWidth: 0 }}>
          {posEdit !== null ? (
            <input autoFocus aria-label="Position: bar.beat" inputMode="decimal" value={posEdit} onChange={e => setPosEdit(e.target.value)}
              onBlur={commitPos} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitPos(); } else if (e.key === 'Escape') { e.preventDefault(); setPosEdit(null); } }}
              style={{ width: 56, height: b - 8, padding: '0 4px', borderRadius: radius.sm, border: `1px solid ${tk.border.strong}`, background: tk.bg.panel, color: tk.text.primary, font: `700 13px ${fontFamily.mono}`, boxSizing: 'border-box' }} />
          ) : (
            <span role="button" tabIndex={0} onClick={startEdit} onKeyDown={e => { if (e.key === 'Enter') startEdit(); }} style={{ cursor: recording ? 'default' : 'text' }}>
              <span ref={bbRef} aria-label="Position in bars and beats" style={{ font: `700 13px ${fontFamily.mono}`, color: recording ? tk.status.danger : tk.text.primary, fontVariantNumeric: 'tabular-nums', minWidth: 44 }} />
              {!narrow && <span ref={timeRef} style={{ font: `11px ${fontFamily.mono}`, color: tk.text.muted, fontVariantNumeric: 'tabular-nums', marginLeft: 6 }} />}
              {narrow && <span ref={timeRef} style={{ display: 'none' }} />}
            </span>
          )}
        </span>
        {phase === 'counting' && <span style={{ font: `700 12px ${fontFamily.ui}`, color: tk.status.danger }}>Count-in · {count}</span>}
        <span style={{ flex: 1 }} />
        <Select ariaLabel="Fade in" value={String(arr.fade)} height={b} style={{ flex: '0 1 118px', minWidth: 0 }}
          options={[0, 10, 50, 200, 500, 1000].map(ms => ({ value: String(ms), label: ms ? `Fade in ${ms} ms` : 'No fade in' }))}
          onChange={v => setArr(a => ({ ...a, fade: Number(v) }))} />
        <IconButton icon="record" size={touch ? 'md' : 'sm'} disabled={!(arr.length > 0)} onClick={makeTake} label="Make a take: the tape as a take (its notes and rack controls), to render from Record" />
        <IconButton icon="antenna" size={touch ? 'md' : 'sm'} active={midi} label={midi ? 'Hide MIDI devices and the monitor' : 'MIDI devices and the monitor: which controllers are seen, and what they send'} onClick={() => setMidi(m => !m)} />
        {engineLine && <span title={status.error ? 'The desktop engine' : 'The desktop engine is running'} style={{ color: status.error ? tk.status.danger : tk.text.faint, font: `11px ${fontFamily.ui}`, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{engineLine}</span>}
      </div>
      {alone && aloneName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>Record {aloneName} alone:</span>
          <Segmented size="sm" ariaLabel="How recording the track alone works" value={mode} onChange={m => useTape.setState({ mode: m })}
            options={[
              { value: 'replace', label: 'Replace', title: 'Everything on this track from the record point to where you stop is replaced' },
              { value: 'overdub', label: 'Overdub', title: 'Only where you play notes or move a rack control is replaced' },
            ]} />
          <Button size="sm" variant="ghost" onClick={() => useTape.setState({ selected: '' })}>All armed tracks</Button>
        </div>
      )}
      {midi && <div style={{ padding: '2px 0' }}><MidiStatusChip monitor /></div>}
    </div>
  );
}

/**
 * The tape's scale (Live's current scale): racks with Snap to scale put live
 * notes in it, and the piano roll shows its notes. "No scale" turns it off
 * (the root and scale are kept for next time).
 */
function ScaleField({ scale, height }: { scale: PlayArrangement['scale']; height: number }) {
  const on = !!scale?.on;
  const set = (patch: Partial<NonNullable<PlayArrangement['scale']>>) => setArr(a => ({ ...a, scale: { on: true, root: 0, name: 'major', ...a.scale, ...patch } }));
  return (
    <span data-tape-scale="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="The tape's scale: racks with Snap to scale (in MIDI in) play every note in key">
      {on && <Select ariaLabel="Scale root" value={String(scale!.root)} height={height} style={{ width: 62 }} options={NOTE_NAMES.map((n, i) => ({ value: String(i), label: n }))} onChange={v => set({ root: Number(v) })} />}
      <Select ariaLabel="Scale" value={on ? scale!.name : 'off'} height={height} style={{ flex: '0 1 150px', minWidth: 0 }}
        options={[{ value: 'off', label: 'No scale' }, ...SCALES.map(sc => ({ value: sc.id, label: sc.name }))]}
        onChange={v => (v === 'off' ? setArr(a => (a.scale ? { ...a, scale: { ...a.scale, on: false } } : a)) : set({ on: true, name: v }))} />
    </span>
  );
}

function BpmField({ bpm, height }: { bpm: number; height: number }) {
  const tk = useTokens();
  const [text, setText] = useState(String(bpm));
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 20 && v <= 300) setArr(a => ({ ...a, bpm: Math.round(v * 10) / 10 })); else setText(String(bpm));
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }} title="The timeline’s, the metronome’s and the count-in’s tempo (from the Clock source when the setup has one)">
      <input aria-label="BPM" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 48, height, padding: '0 6px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `600 12px ${fontFamily.mono}`, boxSizing: 'border-box' }} />
      BPM
    </label>
  );
}

// ── The timeline ────────────────────────────────────────────────────────────

type RegisterEl = (el: HTMLElement | null, prev: { el: HTMLElement | null }) => void;
type ClipSel = { rack: string; index: number } | null;

function Timeline({ play, arr, racks, rows, span, lanes, phase, narrow, touch, masterSelected, clipSel, onClipSel, onPickTrack, onPickMaster, onAddTrack, onMenu, onChange, onOpenClip }: {
  play: PlayRecord; arr: PlayArrangement; racks: readonly AeRack[]; rows: readonly TrackRow[]; span: number; lanes: Record<string, LanePreview>; phase: TapePhase;
  narrow: boolean; touch: boolean; masterSelected: boolean; clipSel: ClipSel; onClipSel: (s: ClipSel) => void;
  onPickTrack: (id: string) => void; onPickMaster: () => void; onAddTrack: () => void;
  onMenu: (m: { x: number; y: number; items: MenuItem[]; title?: string }) => void; onChange: Change; onOpenClip: (rack: string, t: number, where?: 'window' | 'here') => void;
}) {
  const tk = useTokens();
  const point = useTape(s => s.point);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rulerW = useWidth(rulerRef);
  // Playheads and a recording's growing clips register here; one animation frame moves them all.
  const heads = useRef(new Set<HTMLElement>());
  const recs = useRef(new Set<HTMLElement>());
  const [tick, setTick] = useState(0);
  const register = useCallback((set: Set<HTMLElement>): RegisterEl => (el, prev) => {
    if (prev.el) set.delete(prev.el);
    prev.el = el;
    if (el) set.add(el);
    setTick(t => t + 1);
  }, []);
  const registerHead = useMemo(() => register(heads.current), [register]);
  const registerRec = useMemo(() => register(recs.current), [register]);
  const running = phase !== 'stopped';
  const recording = phase === 'recording';
  useEffect(() => {
    const place = () => {
      const p = tape.position();
      const left = `${Math.max(0, Math.min(1, p / span)) * 100}%`, op = p < 0 ? '0.35' : '1';
      for (const h of heads.current) { h.style.left = left; h.style.opacity = op; }
      const pt = useTape.getState().point;
      for (const r of recs.current) {
        r.style.left = `${(pt / span) * 100}%`;
        r.style.width = `${Math.max(0, Math.min(span, p) - pt) / span * 100}%`;
      }
    };
    place();
    if (!running) return;
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, span, point, arr.length, tick]);
  // Click or drag the ruler or a lane to move the playhead: snapped to the
  // beat grid, free (unsnapped) while ⇧ is held. Ignored while recording.
  const seek = useCallback((t: number, free = false) => {
    if (useTape.getState().phase === 'recording' || useTape.getState().phase === 'counting') return;
    tape.setPoint(snapPoint(t, arr.bpm, arr.length, free));
  }, [arr.bpm, arr.length]);
  const rulerTimeAt = (clientX: number): number => {
    const el = rulerRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };
  /** Pointer-down on the ruler or a lane's empty stretch: seeks at once, then follows the drag. */
  const scrub = useCallback((e: React.PointerEvent, timeAt: (clientX: number) => number) => {
    if (useTape.getState().phase === 'recording' || useTape.getState().phase === 'counting') return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX), e.shiftKey);
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX), ev.shiftKey);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }, [seek]);
  const recRacks = useMemo(() => (recording ? tape.recordingRacks(play) : []), [recording, play]);
  const ticks = useMemo(() => rulerTicks(span, arr.bpm, rulerW || 600), [span, arr.bpm, rulerW]);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const dropTrack = (to: number) => {
    const id = drag?.id;
    setDrag(null);
    if (!id) return;
    onChange(p => (p.audioEngine ? withEngine(p, moveTrack(p.audioEngine, id, to)) : p));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 6 }}>
      {/* The ruler: bars and beats at the tape's tempo, the loop brace, the tape's end, the record point. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', position: 'sticky', top: 0, zIndex: 2, background: tk.bg.subtle, paddingBottom: 4 }}>
        {!narrow && <span style={{ width: HEAD_W, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {rows.length} track{rows.length === 1 ? '' : 's'} · {arr.length > 0 ? `${arr.length.toFixed(1)} s of ${TAPE_MAX_SECONDS}` : 'empty tape'}
        </span>}
        <div ref={rulerRef} role="slider" aria-label="Record point: click or drag to move it, snapped to the beat grid (⇧: free); Home/End and ←/→ step when the engine has focus"
          aria-valuemin={0} aria-valuemax={arr.length} aria-valuenow={point} aria-valuetext={barsBeats(point, arr.bpm)} tabIndex={0}
          onPointerDown={e => scrub(e, rulerTimeAt)}
          style={{ position: 'relative', flex: 1, minWidth: 0, height: 26, borderRadius: radius.sm, background: tk.bg.field, cursor: 'pointer', overflow: 'hidden' }}>
          {arr.loop && arr.length > 0 && (
            <span title="Loop: the tape plays round from here to its end" style={{ position: 'absolute', left: 0, width: `${Math.min(1, arr.length / span) * 100}%`, top: 0, height: 6, background: alpha(tk.accent.base, 0.55), borderRadius: '0 0 3px 3px' }} />
          )}
          {arr.length > 0 && <span style={{ position: 'absolute', left: `${Math.min(1, arr.length / span) * 100}%`, top: 0, bottom: 0, width: 1, background: tk.border.strong }} />}
          {ticks.map(t => (
            <span key={`${t.bar}.${t.beat}`} style={{ position: 'absolute', left: `${(t.t / span) * 100}%`, bottom: 0, height: t.label ? 18 : 6, borderLeft: `1px solid ${t.label ? tk.border.strong : tk.border.default}`, paddingLeft: 3, color: tk.text.muted, font: `10px ${fontFamily.mono}`, lineHeight: '12px' }}>{t.label}</span>
          ))}
          {span >= TAPE_MAX_SECONDS && <span title="The tape’s limit for now" style={{ position: 'absolute', right: 3, top: 7, color: tk.status.danger, font: `600 10px ${fontFamily.ui}` }}>60 s</span>}
          <Marker point={point} span={span} />
        </div>
      </div>
      {rows.map((row, i) => {
        const rack = racks.find(r => r.id === row.id)!;
        return (
          <div key={row.id}
            onDragOver={e => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const over = e.clientY < r.top + r.height / 2 ? i : i + 1; if (over !== drag.over) setDrag({ ...drag, over }); }}
            onDrop={e => { e.preventDefault(); dropTrack(drag?.over ?? i); }}
            style={{ position: 'relative' }}>
            {drag && drag.over === i && <DropLine top />}
            <Track play={play} arr={arr} rack={rack} row={masterSelected && row.selected ? { ...row, selected: false } : row} index={i} count={rows.length} track={arr.tracks[row.id]} span={span} preview={lanes[row.id]}
              narrow={narrow} touch={touch} recording={recRacks.includes(row.id)} clipSel={clipSel?.rack === row.id ? clipSel.index : -1}
              onClipSel={index => onClipSel(index < 0 ? null : { rack: row.id, index })} onSeek={seek} onPick={() => onPickTrack(row.id)} onMenu={onMenu} onChange={onChange}
              registerHead={registerHead} registerRec={registerRec} onOpenClip={(t, where) => onOpenClip(row.id, t, where)}
              onDragStart={() => setDrag({ id: row.id, over: i })} onDragEnd={() => setDrag(null)} />
            {drag && i === rows.length - 1 && drag.over === rows.length && <DropLine />}
          </div>
        );
      })}
      {rows.length === 0 && (
        <div style={{ margin: '8px 0', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No tracks yet</div>
          A track is a rack: an instrument and its effects. {isTauri() ? 'Load an Audio Unit synth (Apple’s DLSMusicDevice is on every Mac), the sample player or the Granulator, add effects, and play it from a MIDI keyboard or the computer keyboard.' : 'In a browser a track plays the sample player or the Granulator; Audio Unit synths and effects need the desktop app on a Mac.'} Press Record and play: what you play lands on the track as a clip.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <Button size="sm" variant={rows.length ? 'secondary' : 'primary'} icon="plus" disabled={rows.length >= AE_RACKS_MAX} onClick={onAddTrack}
          title={rows.length >= AE_RACKS_MAX ? `Up to ${AE_RACKS_MAX} tracks` : 'A new track: an instrument and its effects'}>Add track</Button>
        <Button size="sm" variant="ghost" icon="presets" disabled={rows.length >= AE_RACKS_MAX}
          onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu({ x: r.left, y: r.bottom + 4, title: 'Add a track from a preset', items: fromPresetItems() }); }}
          title="A track from a saved rack: its instrument, effects and controls">From a preset…</Button>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Drag a track’s header to reorder · Space plays and pauses</span>
      </div>
      {rows.length > 0 && <MasterRow narrow={narrow} touch={touch} selected={masterSelected} onPick={onPickMaster} span={span} registerHead={registerHead} />}
    </div>
  );
}

/** A menu of the saved rack presets, each doing `pick`. */
function presetItems(pick: (p: ReturnType<typeof loadRackPresets>[number]) => void): MenuItem[] {
  const list = loadRackPresets().sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return [{ label: 'No rack presets yet', disabled: true, hint: 'A track’s ⋯ menu → Save as preset…', onSelect: () => {} }];
  return list.map(p => ({ label: p.name, icon: 'presets' as IconName, hint: rackPresetSummary(p), onSelect: () => pick(p) }));
}

/** Add track → From a preset…: a new track from each, and the ones with Sound effects as a Finish → Sound chain. */
function fromPresetItems(): MenuItem[] {
  const items = presetItems(p => applyRackPresetToPlay(p));
  const withSound = loadRackPresets().filter(p => p.soundFx?.effects.length);
  if (!withSound.length) return items;
  return [...items, 'separator', { heading: 'Only its Sound effects, on Finish → Sound' }, ...withSound.map(p => ({ label: p.name, icon: 'sliders' as IconName, hint: p.soundFx!.effects.map(e => e.kind).join(' → '), onSelect: () => presetSoundToMaster(p) }))];
}

function DropLine({ top = false }: { top?: boolean }) {
  const tk = useTokens();
  return <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: -1, height: 2, background: tk.accent.base, zIndex: 3 }} />;
}

function Marker({ point, span }: { point: number; span: number }) {
  const tk = useTokens();
  return (
    <span aria-hidden title="The record point" style={{ position: 'absolute', left: `${(point / span) * 100}%`, top: 0, bottom: 0, marginLeft: -5, width: 10, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', left: 0, bottom: 0, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `7px solid ${tk.status.danger}` }} />
      <span style={{ position: 'absolute', left: 4.5, top: 0, bottom: 0, width: 1, background: tk.status.danger }} />
    </span>
  );
}

// ── A track: its header and its lane ────────────────────────────────────────

function Toggle2({ on, label, title, onClick, touch, color }: { on: boolean; label: string; title: string; onClick: () => void; touch: boolean; color: string }) {
  const tk = useTokens();
  const s = touch ? 30 : 22;
  return (
    <button type="button" aria-pressed={on} aria-label={title} title={title} onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ width: s, height: s, borderRadius: radius.sm, border: 0, cursor: 'pointer', flexShrink: 0, font: `700 10.5px ${fontFamily.ui}`, color: on ? '#fff' : tk.text.muted, background: on ? color : tk.bg.field, display: 'grid', placeItems: 'center' }}>{label}</button>
  );
}

/** A thin horizontal volume fader for a track's header (0..2, 1 = as is; double-click for 1). */
function VolumeBar({ value, onChange, label, touch }: { value: number; onChange: (v: number) => void; label: string; touch: boolean }) {
  const tk = useTokens();
  const f = Math.max(0, Math.min(1, value / 2));
  const fromX = (el: HTMLElement, x: number) => { const r = el.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 200) / 100; };
  const db = value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dB` : '−∞ dB';
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={2} aria-valuenow={value} aria-valuetext={db} title={`${label}: ${db}`}
      onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onChange(fromX(e.currentTarget, e.clientX)); }}
      onPointerMove={e => { if (e.buttons & 1) onChange(fromX(e.currentTarget, e.clientX)); }}
      onDoubleClick={() => onChange(1)}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(2, Math.round((value + 0.05) * 100) / 100)); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, Math.round((value - 0.05) * 100) / 100)); }
      }}
      style={{ position: 'relative', flex: 'none', width: '100%', minWidth: 40, height: touch ? 22 : 14, borderRadius: 3, background: tk.bg.field, cursor: 'ew-resize', touchAction: 'none' }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${f * 100}%`, borderRadius: 3, background: alpha(tk.text.primary, 0.18) }} />
      <span style={{ position: 'absolute', left: '50%', top: 2, bottom: 2, width: 1, background: tk.border.strong }} />
      <span style={{ position: 'absolute', left: `${f * 100}%`, top: -1, bottom: -1, width: 3, marginLeft: -1.5, borderRadius: 1, background: tk.text.secondary }} />
    </div>
  );
}

function Track({ play, arr, rack, row, index, count, track, span, preview, narrow, touch, recording, clipSel, onClipSel, onSeek, onPick, onMenu, onChange, registerHead, registerRec, onOpenClip, onDragStart, onDragEnd }: {
  play: PlayRecord; arr: PlayArrangement; rack: AeRack; row: TrackRow; index: number; count: number; track: ArrTrack | undefined; span: number; preview: LanePreview | undefined;
  narrow: boolean; touch: boolean; recording: boolean; clipSel: number; onClipSel: (index: number) => void; onSeek: (t: number, free?: boolean) => void; onPick: () => void;
  onMenu: (m: { x: number; y: number; items: MenuItem[]; title?: string }) => void; onChange: Change; registerHead: RegisterEl; registerRec: RegisterEl;
  onOpenClip: (t: number, where?: 'window' | 'here') => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const tk = useTokens();
  const edits = useRackEdits(rack, onChange);
  const alone = useTape(s => s.selected === rack.id);
  const patchT = (over: Partial<ArrTrack>) => setArr(a => patchTrack(a, rack.id, over));
  const has = trackClips(track, arr.length).length > 0;
  const clear = async () => {
    if (!(await askConfirm(`Clear ${rack.name}’s track?`, { message: 'Its clips come off the tape (Undo brings them back).', confirmLabel: 'Clear', danger: true }))) return;
    useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: clearTrack(p.arrangement ?? emptyArrangement(), rack.id) }), { label: `Cleared ${rack.name}’s track` });
  };
  const move = (by: -1 | 1) => onChange(p => (p.audioEngine ? withEngine(p, moveTrack(p.audioEngine, rack.id, by < 0 ? index - 1 : index + 2)) : p));
  const recolor = (color: string) => onChange(p => withEngine(p, patchRack(p.audioEngine, rack.id, { color })));
  const openMenu = (x: number, y: number) => onMenu({
    x, y, title: rack.name,
    items: [
      { label: 'Rename…', icon: 'edit', onSelect: () => void edits.rename() },
      { label: 'Save as preset…', icon: 'save', hint: 'Its instrument, effects and rack controls (no mappings, no tape)', onSelect: () => void saveRackAsPreset(rack.id) },
      { label: 'Replace with preset…', icon: 'presets', hint: 'Its devices and controls from a saved rack; its clips stay', onSelect: () => setTimeout(() => onMenu({ x, y, title: `Replace ${rack.name}’s devices`, items: presetItems(p => applyRackPresetToPlay(p, rack.id)) }), 0) },
      { heading: 'Colour' },
      ...TRACK_COLORS.map((c, k) => ({ label: `Colour ${k + 1}${c === row.color ? ' ✓' : ''}`, icon: 'star' as IconName, iconColor: c, onSelect: () => recolor(c) })),
      'separator',
      { heading: 'Show the tape as' },
      { label: `MIDI notes${(track?.show ?? 'midi') === 'midi' ? ' ✓' : ''}`, icon: 'piano', hint: 'What was recorded, as notes', onSelect: () => patchT({ show: 'midi' }) },
      { label: `Audio${track?.show === 'audio' ? ' ✓' : ''}`, icon: 'wave', hint: 'The track\'s rendered sound, or an envelope from the notes', onSelect: () => patchT({ show: 'audio' }) },
      'separator',
      { label: row.locked ? 'Unlock the lead' : 'Lock as lead', icon: 'lock', hint: 'The lead takes MIDI notes, the computer keyboard and pad hits', onSelect: () => lockLead(rack.id, !row.locked) },
      { label: alone ? 'Record every armed track' : 'Record this track alone…', icon: 'record', hint: 'Replace or overdub just this track from the record point', onSelect: () => { useTape.setState({ selected: alone ? '' : rack.id }); } },
      { label: 'Move up', icon: 'chevU', disabled: index === 0, onSelect: () => move(-1) },
      { label: 'Move down', icon: 'chevD', disabled: index === count - 1, onSelect: () => move(1) },
      'separator',
      { label: 'Clear its clips…', icon: 'trash', disabled: !has, onSelect: () => void clear() },
      { label: 'Delete track…', icon: 'trash', danger: true, onSelect: () => void edits.remove() },
    ],
  });
  const h = touch ? 76 : 62;
  const header = (
    <div draggable={!touch} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rack.name); onDragStart(); }} onDragEnd={onDragEnd}
      onClick={onPick} onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY); }}
      aria-current={row.selected || undefined}
      style={{ width: narrow ? '100%' : HEAD_W, flexShrink: 0, boxSizing: 'border-box', height: narrow ? undefined : h, display: 'flex', gap: 0, borderRadius: radius.sm, overflow: 'hidden', cursor: 'pointer',
        background: row.selected ? alpha(row.color, 0.16) : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${row.selected ? alpha(row.color, 0.7) : tk.border.subtle}` }}>
      <span aria-hidden style={{ width: 5, flexShrink: 0, background: row.color, opacity: row.mute ? 0.4 : 1 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, padding: '5px 6px 5px 7px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <Icon name={INSTRUMENT_ICON[row.instrument]} size={13} style={{ color: row.instrument === 'none' ? tk.text.faint : row.color, flexShrink: 0 }} />
          <span onDoubleClick={e => { e.stopPropagation(); void edits.rename(); }} title={`${row.name} · ${row.instrumentName} (double-click to rename)`}
            style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto' }}>{row.name}</span>
          {row.lead && <LeadChip locked={row.locked} own={row.ownRouting} />}
          <span style={{ flex: 1 }} />
          <IconButton icon="more" size="sm" label={`${rack.name}: rename, colour, lock as lead, move, clear, delete`} onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
          <Toggle2 on={row.arm} label="●" title={row.arm ? 'Armed: records when you press Record' : 'Not armed: Record leaves this track alone'} onClick={() => patchT({ arm: !row.arm })} touch={touch} color={tk.status.danger} />
          <Toggle2 on={row.mute} label="M" title={row.mute ? 'Unmute this track' : 'Mute this track (live and on the tape)'} onClick={() => { edits.toggleMute(); if (track?.mute) patchT({ mute: false }); }} touch={touch} color={tk.status.warning} />
          <Toggle2 on={row.solo} label="S" title={row.solo ? 'Unsolo' : 'Solo on the tape: only soloed tracks play back'} onClick={() => patchT({ solo: !row.solo })} touch={touch} color={tk.accent.base} />
          <span style={{ flex: 1, minWidth: 40, display: 'flex', flexDirection: 'column', gap: 3, marginLeft: 3 }}>
            <VolumeBar value={rack.volume} label={`${rack.name} volume`} onChange={v => edits.patch({ volume: v })} touch={touch} />
            <Meter id={rack.id} />
          </span>
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: narrow ? 4 : 8, padding: '3px 0' }}>
      {header}
      <Lane rack={rack} row={row} arr={arr} track={track} span={span} preview={preview} height={narrow ? (touch ? 64 : 54) : h} recording={recording}
        selectedClip={clipSel} onSelectClip={i => { onPick(); onClipSel(i); }} onSeek={onSeek} onMenu={onMenu} registerHead={registerHead} registerRec={registerRec} controls={play.controls} onOpenClip={onOpenClip} />
    </div>
  );
}

// ── A lane: the clips ───────────────────────────────────────────────────────

const EDGE_PX = 7;

function Lane({ rack, row, arr, track, span, preview, height, recording, selectedClip, onSelectClip, onSeek, onMenu, registerHead, registerRec, controls, onOpenClip }: {
  rack: AeRack; row: TrackRow; arr: PlayArrangement; track: ArrTrack | undefined; span: number; preview: LanePreview | undefined; height: number; recording: boolean;
  selectedClip: number; onSelectClip: (i: number) => void; onSeek: (t: number, free?: boolean) => void;
  onMenu: (m: { x: number; y: number; items: MenuItem[]; title?: string }) => void; registerHead: RegisterEl; registerRec: RegisterEl; controls: PlayRecord['controls'];
  onOpenClip: (t: number, where?: 'window' | 'here') => void;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const headSlot = useRef<{ el: HTMLElement | null }>({ el: null });
  const recSlot = useRef<{ el: HTMLElement | null }>({ el: null });
  const headRef = useMemo(() => (el: HTMLElement | null) => registerHead(el, headSlot.current), [registerHead]);
  const recRef = useMemo(() => (el: HTMLElement | null) => registerRec(el, recSlot.current), [registerRec]);
  const [w, setW] = useState(0);
  const [trim, setTrim] = useState<{ index: number; t: number; d: number } | null>(null);
  // Editing notes on a MIDI lane: the selected note, and one being dragged (drawn in place of the record's).
  const [noteSel, setNoteSel] = useState(-1);
  const [noteDrag, setNoteDrag] = useState<{ index: number; note: ArrNote } | null>(null);
  const midi = (track?.show ?? 'midi') === 'midi';
  const shownTrack = useMemo(() => (noteDrag && track ? { ...track, notes: track.notes.map((n, i) => (i === noteDrag.index ? noteDrag.note : n)) } : track), [track, noteDrag]);
  useEffect(() => { if (noteSel >= 0 && !(track?.notes[noteSel])) setNoteSel(-1); }, [track, noteSel]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const clips = useMemo(() => {
    const list = trackClips(track, arr.length);
    return trim ? list.map((c, i) => (i === trim.index ? { ...c, t: trim.t, d: trim.d } : c)) : list;
  }, [track, arr.length, trim]);
  const muted = row.mute;
  const color = muted ? tk.text.faint : row.color;
  const bpm = arr.bpm;
  // A MIDI clip shows the tape's key while a scale is on (where to find it: the piano roll's Scale section).
  const badge = midi ? scaleBadge(arr.scale) : '';
  useEffect(() => {
    const c = ref.current;
    if (!c || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = height * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const x = (t: number) => (t / span) * w;
    // Bars and beats.
    for (const tk2 of rulerTicks(span, bpm, w)) {
      g.fillStyle = alpha(tk.text.primary, tk2.label ? 0.1 : 0.045);
      g.fillRect(Math.round(x(tk2.t)), 0, 1, height);
    }
    // Past the tape's end: dimmed.
    if (arr.length > 0) { g.fillStyle = alpha(tk.text.primary, 0.05); g.fillRect(x(arr.length), 0, w - x(arr.length), height); }
    const wavePreview = preview?.status === 'ok' ? { peaks: preview.peaks, length: preview.length } : null;
    clips.forEach((clip, i) => drawClip(g, clip, i === selectedClip, clip.mute ? tk.text.faint : color, x, height, shownTrack, wavePreview, tk, rack.name, controls, noteSel, badge));
  }, [w, height, span, bpm, arr.length, clips, selectedClip, color, preview, shownTrack, tk, rack.name, controls, noteSel, badge]);

  const timeAt = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span; };
  /** The note under a point on a MIDI lane, and whether it's by its right edge (resize). */
  const hitNote = (clientX: number, clientY: number): { index: number; edge: boolean } | null => {
    if (!midi || !track?.notes.length) return null;
    const r = ref.current!.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
    const x = (t: number) => (t / span) * r.width;
    for (let i = track.notes.length - 1; i >= 0; i--) {
      const n = track.notes[i];
      const clip = clips.find(c => n.t < c.t + c.d && n.t + n.d > c.t);
      if (!clip) continue;
      const band = noteBand(height, x(clip.t + clip.d) - x(clip.t));
      const geo = noteGeometry(track.notes, band.top, band.bottom);
      const a = x(n.t), b = x(n.t + Math.max(n.d, 0.02)), y0 = geo.y(n.n);
      if (px >= a - 2 && px <= b + 2 && py >= y0 - 1 && py <= y0 + geo.rh + 1) return { index: i, edge: b - a > 10 && b - px < 5 };
    }
    return null;
  };
  const pitchAt = (clientY: number): number => {
    const r = ref.current!.getBoundingClientRect();
    const band = noteBand(height, 200);
    return noteGeometry(track?.notes ?? [], band.top, band.bottom).pitchAt(clientY - r.top);
  };
  const hit = (clientX: number): { index: number; edge: 'start' | 'end' | null } | null => {
    const r = ref.current!.getBoundingClientRect(), px = clientX - r.left;
    for (let i = 0; i < clips.length; i++) {
      const a = (clips[i].t / span) * r.width, b = ((clips[i].t + clips[i].d) / span) * r.width;
      if (px >= a - EDGE_PX / 2 && px <= b + EDGE_PX / 2) {
        const edge = b - a > EDGE_PX * 3 ? (px - a < EDGE_PX ? 'start' : b - px < EDGE_PX ? 'end' : null) : null;
        return { index: i, edge };
      }
    }
    return null;
  };
  const clipMenu = (index: number, x: number, y: number) => {
    const c = clips[index];
    onMenu({
      x, y, title: `${rack.name} · clip ${index + 1}`,
      items: [
        { label: c.mute ? 'Unmute the clip' : 'Mute the clip', icon: c.mute ? 'eye' : 'eyeOff', hint: 'A muted clip stays on the lane and doesn’t play', onSelect: () => editArr(a => setClipMute(a, rack.id, index, !c.mute), `${c.mute ? 'Unmuted' : 'Muted'} a clip on ${rack.name}`) },
        { label: 'Delete the clip', icon: 'trash', danger: true, hint: 'Delete or Backspace', onSelect: () => { editArr(a => deleteClip(a, rack.id, index), `Deleted a clip on ${rack.name}`); onSelectClip(-1); } },
        ...(midi ? [
          { label: 'Edit notes', icon: 'piano' as IconName, hint: 'In the piano roll window (double-click the clip)', onSelect: () => onOpenClip(c.t) },
          { label: 'Edit notes here', icon: 'piano' as IconName, hint: 'In the device area under the tracks (Notes)', onSelect: () => onOpenClip(c.t, 'here') },
        ] : []),
      ],
    });
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    const phase0 = useTape.getState().phase;
    const hn = phase0 === 'recording' || phase0 === 'counting' ? null : hitNote(e.clientX, e.clientY);
    if (hn && track) {
      // A note: select it; drag to move it in time and pitch, its right edge to lengthen it, ⌥-drag up/down for velocity.
      e.stopPropagation();
      setNoteSel(hn.index);
      onSelectClip(-1);
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const n0 = track.notes[hn.index], t0 = timeAt(e.clientX), y0 = e.clientY, p0 = pitchAt(e.clientY);
      let cur: ArrNote = n0, moved = false;
      const move = (ev: PointerEvent) => {
        moved = true;
        const dt = timeAt(ev.clientX) - t0;
        if (ev.altKey) cur = { ...n0, v: Math.max(0.01, Math.min(1, n0.v + (y0 - ev.clientY) / 120)) };
        else if (hn.edge) cur = { ...n0, d: Math.max(NOTE_MIN, snapPoint(n0.t + n0.d + dt, bpm, 0, ev.shiftKey) - n0.t) };
        else cur = { ...n0, t: Math.max(0, snapPoint(n0.t + dt, bpm, 0, ev.shiftKey)), n: Math.max(0, Math.min(127, n0.n + (pitchAt(ev.clientY) - p0))) };
        setNoteDrag({ index: hn.index, note: cur });
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        setNoteDrag(null);
        if (moved && (cur.t !== n0.t || cur.n !== n0.n || cur.d !== n0.d || cur.v !== n0.v)) {
          let at = hn.index;
          editArr(a => { const r = patchNote(a, rack.id, hn.index, cur); at = r.index; return r.arr; }, hn.edge ? `Lengthened a note on ${rack.name}` : `Moved a note on ${rack.name}`);
          setNoteSel(at);
        }
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      return;
    }
    setNoteSel(-1);
    const h = hit(e.clientX);
    if (!h) {
      onSelectClip(-1);
      if (useTape.getState().phase === 'recording' || useTape.getState().phase === 'counting') return; // scrubbing is ignored while recording
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      onSeek(timeAt(e.clientX), e.shiftKey);
      const move = (ev: PointerEvent) => onSeek(timeAt(ev.clientX), ev.shiftKey);
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      return;
    }
    onSelectClip(h.index);
    const phase = useTape.getState().phase;
    if (!h.edge || phase === 'recording' || phase === 'counting') return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const c0 = clips[h.index], b = clipBounds(arr, rack.id, h.index);
    if (!b) return;
    let cur = { index: h.index, t: c0.t, d: c0.d };
    const move = (ev: PointerEvent) => {
      const t = Math.round(timeAt(ev.clientX) * 100) / 100;
      cur = h.edge === 'start'
        ? (() => { const a = Math.max(b.min, Math.min(t, c0.t + c0.d - 0.05)); return { index: h.index, t: a, d: c0.t + c0.d - a }; })()
        : { index: h.index, t: c0.t, d: Math.max(0.05, Math.min(b.max, t) - c0.t) };
      setTrim(cur);
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setTrim(null);
      if (Math.abs(cur.t - c0.t) > 1e-6 || Math.abs(cur.d - c0.d) > 1e-6) editArr(a => trimClip(a, rack.id, h.index, cur.t, cur.t + cur.d), `Trimmed a clip on ${rack.name}`);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const [cursor, setCursor] = useState('pointer');
  const sel = clips[selectedClip];
  const note = preview?.status === 'busy' ? 'Rendering…' : '';
  const style: CSSProperties = { display: 'block', width: '100%', height, borderRadius: radius.sm, background: tk.bg.field, cursor, touchAction: 'none' };
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <canvas ref={ref} style={style} onPointerDown={onPointerDown} tabIndex={0}
        onDoubleClick={e => {
          // A MIDI clip (or a note in it) opens in the piano roll; empty lane gets a new note (a beat long, velocity 0.8), snapped to the beat (⇧ free).
          if (!midi) return;
          const phase = useTape.getState().phase;
          if (phase === 'recording' || phase === 'counting') return;
          const h = hit(e.clientX);
          if (h) { onOpenClip(clips[h.index].t); return; }
          const t = snapPoint(timeAt(e.clientX), bpm, 0, e.shiftKey), d = 60 / Math.max(1, bpm);
          const note: ArrNote = { t, n: pitchAt(e.clientY), v: 0.8, d };
          let at = -1;
          editArr(a => { const r = addNote(a, rack.id, note); at = r.index; return r.arr; }, `Added a note on ${rack.name}`);
          setNoteSel(at);
        }}
        onKeyDown={e => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && noteSel >= 0) {
            e.preventDefault(); e.stopPropagation();
            editArr(a => deleteNote(a, rack.id, noteSel), `Deleted a note on ${rack.name}`);
            setNoteSel(-1);
          }
        }}
        onPointerMove={e => { if (e.buttons) return; const hn = hitNote(e.clientX, e.clientY); if (hn) { setCursor(hn.edge ? 'ew-resize' : 'grab'); return; } const h = hit(e.clientX); setCursor(h?.edge ? 'ew-resize' : 'pointer'); }}
        onContextMenu={e => { e.preventDefault(); const h = hit(e.clientX); if (h) { onSelectClip(h.index); clipMenu(h.index, e.clientX, e.clientY); } }}
        aria-label={`${rack.name}’s lane: ${clips.length} clip${clips.length === 1 ? '' : 's'}. Click a clip to select it (drag its ends to trim), or the lane to set the record point.${midi ? ' Drag a note to move it, its end to lengthen it, ⌥-drag for velocity, Delete to remove it; double-click a clip to edit it in the piano roll, empty lane to add a note.' : ''}`} />
      {recording && <div ref={recRef} aria-hidden style={{ position: 'absolute', top: 2, bottom: 2, left: 0, width: 0, borderRadius: 3, background: alpha(tk.status.danger, 0.28), boxShadow: `inset 0 0 0 1px ${alpha(tk.status.danger, 0.8)}`, pointerEvents: 'none' }} />}
      <div ref={headRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1, pointerEvents: 'none', background: recording ? tk.status.danger : tk.text.primary, opacity: 0.8 }} />
      {sel && !trim && (
        <span style={{ position: 'absolute', top: 2, left: `calc(${Math.min(1, (sel.t + sel.d) / span) * 100}% - 52px)`, display: 'inline-flex', gap: 2, padding: 1, borderRadius: radius.sm, background: alpha(tk.bg.panel, 0.92), boxShadow: `0 1px 4px ${alpha('#000', 0.25)}` }}>
          <IconButton icon={sel.mute ? 'eye' : 'eyeOff'} size="sm" label={sel.mute ? 'Unmute the clip' : 'Mute the clip (it stays, silent)'} onClick={() => editArr(a => setClipMute(a, rack.id, selectedClip, !sel.mute), `${sel.mute ? 'Unmuted' : 'Muted'} a clip on ${rack.name}`)} />
          <IconButton icon="trash" size="sm" tone="danger" label="Delete the clip (Delete)" onClick={() => { editArr(a => deleteClip(a, rack.id, selectedClip), `Deleted a clip on ${rack.name}`); onSelectClip(-1); }} />
        </span>
      )}
      {note && <span style={{ position: 'absolute', right: 6, bottom: 4, color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, pointerEvents: 'none' }}>{note}</span>}
      {!clips.length && !recording && <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: tk.text.faint, font: `11px ${fontFamily.ui}`, pointerEvents: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="record" size={11} />{row.arm ? 'Armed: press Record and play' : 'Nothing recorded'}</span>}
    </div>
  );
}

/** Where a MIDI lane draws each pitch: the track's own range (at least an octave), rows from the bottom up. Shared by drawing and hit-testing. */
function noteGeometry(notes: readonly ArrNote[], top: number, bottom: number): { lo: number; hi: number; rh: number; y: (n: number) => number; pitchAt: (py: number) => number } {
  const { lo, hi } = notePitchRange(notes);
  const rows = hi - lo + 1, rh = Math.max(2, (bottom - top) / rows);
  return { lo, hi, rh, y: n => bottom - (n - lo + 1) * rh, pitchAt: py => Math.max(0, Math.min(127, lo + Math.floor((bottom - py) / rh))) };
}
/** The lane's vertical band the notes sit in (drawClip's `top`/`bottom` for a clip with a title strip). */
function noteBand(height: number, cw: number): { top: number; bottom: number } {
  const strip = height >= 44 && cw > 30 ? 12 : 0;
  return { top: 1.5 + strip + 2, bottom: height - 3.5 };
}

/** One clip: a rounded block in the track's colour, a title strip, the waveform (mirrored), the rack controls' moves as faint lines. */
function drawClip(g: CanvasRenderingContext2D, clip: ArrClip, selected: boolean, color: string, x: (t: number) => number, height: number, track: ArrTrack | undefined,
  preview: { peaks: Float32Array; length: number } | null, tk: ReturnType<typeof useTokens>, name: string, controls: PlayRecord['controls'], selectedNote = -1, badge = ''): void {
  const x0 = x(clip.t), x1 = x(clip.t + clip.d), cw = Math.max(2, x1 - x0);
  const r = Math.min(4, cw / 2);
  const strip = height >= 44 && cw > 30 ? 12 : 0;
  g.save();
  g.beginPath();
  g.roundRect(x0 + 0.5, 1.5, cw - 1, height - 3, r);
  g.fillStyle = alpha(color, clip.mute ? 0.1 : 0.2);
  g.fill();
  g.clip();
  if (strip) {
    g.fillStyle = alpha(color, clip.mute ? 0.35 : 0.85);
    g.fillRect(x0, 0, cw, strip + 1.5);
    g.fillStyle = clip.mute ? tk.text.muted : '#101014';
    g.font = `600 9.5px ${fontFamily.ui}`;
    g.textBaseline = 'middle';
    const label = clip.mute ? `${name} (muted)` : name;
    g.fillText(label, x0 + 5, 1.5 + strip / 2 + 0.5, Math.max(0, cw - 10));
    // The key just after the name ("Tom keys · A min"), when it fits (the selected clip's buttons sit on the right).
    if (badge) {
      const nx = x0 + 5 + g.measureText(label).width + 6;
      const bw = g.measureText(`· ${badge}`).width;
      if (nx + bw <= x1 - 6) {
        g.globalAlpha = 0.7;
        g.fillText(`· ${badge}`, nx, 1.5 + strip / 2 + 0.5);
        g.globalAlpha = 1;
      }
    }
  }
  const top = 1.5 + strip + 2, bottom = height - 3.5, mid = (top + bottom) / 2, amp = (bottom - top) / 2;
  if (track?.show === 'audio') {
    // The waveform (the rendered sound, or an envelope drawn from the notes).
    const cols = Math.max(8, Math.min(600, Math.round(cw / 1.5)));
    const wave = clipWave(track, clip, cols, preview);
    g.fillStyle = alpha(color, clip.mute ? 0.35 : 0.9);
    const step = cw / cols;
    for (let i = 0; i < cols; i++) {
      const hh = Math.max(0.5, wave.peaks[i] * amp);
      g.fillRect(x0 + i * step, mid - hh, Math.max(1, step - 0.25), hh * 2);
    }
  } else {
    // MIDI: the notes as bars, pitch up the lane (the track's own range), velocity as opacity; the selected one outlined.
    const all = track?.notes ?? [];
    const geo = noteGeometry(all, top, bottom);
    let any = false;
    all.forEach((n, i) => {
      if (!(n.t < clip.t + clip.d && n.t + n.d > clip.t)) return;
      any = true;
      const nx0 = Math.max(x0, x(n.t)), nx1 = Math.min(x1, x(n.t + Math.max(n.d, 0.02)));
      const ny = geo.y(n.n);
      g.fillStyle = alpha(color, clip.mute ? 0.3 : 0.45 + 0.5 * Math.max(0, Math.min(1, n.v)));
      g.fillRect(nx0, ny, Math.max(2, nx1 - nx0 - 0.5), Math.max(1.5, geo.rh - 0.75));
      if (i === selectedNote) { g.strokeStyle = tk.text.primary; g.lineWidth = 1.5; g.strokeRect(nx0 + 0.75, ny + 0.75, Math.max(2, nx1 - nx0 - 0.5) - 1.5, Math.max(1.5, geo.rh - 0.75) - 1.5); }
    });
    if (!any) { g.fillStyle = alpha(color, 0.35); g.fillRect(x0, mid - 0.5, cw, 1); }
  }
  // Rack controls' moves inside the clip: thin lines across the control's range.
  g.lineWidth = 1;
  for (const [target, pts] of Object.entries(track?.auto ?? {})) {
    const c = controls.find(k => k.target === target);
    const lo = c?.min ?? 0, hi = c?.max ?? 1, rg = hi - lo || 1;
    g.strokeStyle = alpha(tk.status.warning, clip.mute ? 0.3 : 0.75);
    g.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < clip.t - 1e-6 || pts[i] > clip.t + clip.d + 1e-6) continue;
      const px = x(pts[i]), py = bottom - ((pts[i + 1] - lo) / rg) * (bottom - top);
      if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
  g.beginPath();
  g.roundRect(x0 + 0.5, 1.5, cw - 1, height - 3, r);
  g.lineWidth = selected ? 2 : 1;
  g.strokeStyle = selected ? tk.text.primary : alpha(color, clip.mute ? 0.4 : 0.9);
  g.stroke();
}

// ── The master ──────────────────────────────────────────────────────────────

function MasterRow({ narrow, touch, selected, onPick, span, registerHead }: { narrow: boolean; touch: boolean; selected: boolean; onPick: () => void; span: number; registerHead: RegisterEl }) {
  const tk = useTokens();
  const prefs = useEnginePrefs();
  const desktop = isTauri();
  const headSlot = useRef<{ el: HTMLElement | null }>({ el: null });
  const headRef = useMemo(() => (el: HTMLElement | null) => registerHead(el, headSlot.current), [registerHead]);
  void span;
  const h = touch ? 56 : 44;
  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: narrow ? 4 : 8, padding: '6px 0 10px', borderTop: `1px solid ${tk.border.default}`, marginTop: 2 }}>
      <div onClick={onPick} aria-current={selected || undefined}
        style={{ width: narrow ? '100%' : HEAD_W, flexShrink: 0, boxSizing: 'border-box', minHeight: h, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: radius.sm, cursor: 'pointer',
          background: selected ? alpha(tk.accent.base, 0.12) : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${selected ? tk.accent.base : tk.border.subtle}` }}>
        <Icon name="wave" size={13} style={{ color: tk.text.muted }} />
        <b style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>Master</b>
        {desktop && <Toggle2 on={prefs.mute} label="M" title={prefs.mute ? 'Unmute the engine' : 'Mute the engine'} onClick={() => prefs.set({ mute: !prefs.mute })} touch={touch} color={tk.status.warning} />}
        <span style={{ flex: 1, minWidth: 40, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {desktop && <VolumeBar value={prefs.volume} label="Engine volume" onChange={v => prefs.set({ volume: v })} touch={touch} />}
          <Meter id={ENGINE_MASTER} />
        </span>
      </div>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, height: narrow ? 28 : h, borderRadius: radius.sm, background: tk.bg.field, display: 'flex', alignItems: 'center', padding: '0 8px', color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden' }}>
        {desktop ? 'Every track together, to the engine’s output' : 'Every track together, through the page’s sound'}
        <div ref={headRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1, pointerEvents: 'none', background: tk.text.primary, opacity: 0.5 }} />
      </div>
    </div>
  );
}
