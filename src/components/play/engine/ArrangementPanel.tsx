/**
 * ArrangementPanel — the Engine tab's Arrangement view (docs/arrangement.md):
 * the tape. A transport (Record, Play/Stop, Loop, Metronome, Count-in, BPM,
 * fade-in), the ruler up to the 60 s limit, and one lane per rack with its
 * rendered waveform and notes. Click a lane to set the record point; select
 * a lane to re-record that rack alone (replace or overdub).
 *
 * Perf: transport ticks never re-render React. The playhead and the time
 * readout move on their own animation frame while the tape runs; lanes
 * redraw their canvas only when their track, preview or size changes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Segmented } from '../../ui/Choice';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toastStore';
import { askConfirm } from '../../ui/dialogStore';
import type { PlayRecord } from '../../../types/play';
import {
  COUNT_INS, TAPE_MAX_SECONDS, clearTrack, emptyArrangement, patchTrack, recordBpm, trackHasMaterial,
  type ArrTrack, type CountIn, type PlayArrangement,
} from '../../../types/playArrangement';
import { aeSlotName, type AeRack } from '../../../types/playAudioEngine';
import { tape, useTape, type TapePhase } from '../../../lib/tape';
import { refreshPreviews, useTapePreviews, type LanePreview } from '../../../lib/tapePreview';
import { arrangementTake } from '../../../lib/tapeTake';
import { addTake, useTakes } from '../../../lib/takes';
import { usePlayUi } from '../playUi';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { selectRack } from './selectRack';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** Settings changes (loop, metronome, mute…) aren't undo steps: they're how the tape plays, like a mixer's. */
function setArr(fn: (a: PlayArrangement) => PlayArrangement): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: fn(p.arrangement ?? emptyArrangement(recordBpm(p.mappings))) }), false);
}

const fmt = (s: number) => {
  const neg = s < 0 ? '−' : '';
  const a = Math.abs(s), m = Math.floor(a / 60), r = a - m * 60;
  return `${neg}${m}:${r.toFixed(1).padStart(4, '0')}`;
};

// ── The transport (both views) ───────────────────────────────────────────────

/** Record, Play/Stop and where the tape is; `compact` for the Performance view (with the way to the Arrangement). */
export function TapeTransport({ play, compact = false, touch = false }: { play: PlayRecord; compact?: boolean; touch?: boolean }) {
  const tk = useTokens();
  const phase = useTape(s => s.phase);
  const count = useTape(s => s.count);
  const point = useTape(s => s.point);
  const selected = useTape(s => s.selected);
  const arr = play.arrangement;
  const length = arr?.length ?? 0;
  const timeRef = useRef<HTMLSpanElement>(null);
  const running = phase !== 'stopped';
  // The readout follows the tape on its own frame while it runs (no React re-render per tick).
  useEffect(() => {
    const el = timeRef.current;
    if (!el) return;
    const write = () => { el.textContent = `${fmt(tape.position())} / ${fmt(tape.shownLength())}`; };
    write();
    if (!running) return;
    let raf = 0;
    const loop = () => { write(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, point, length]);
  const recording = phase === 'recording' || phase === 'counting';
  const racksHere = !!play.audioEngine?.racks.length;
  const selName = selected ? play.audioEngine?.racks.find(r => r.id === selected)?.name : '';
  const recTitle = recording ? 'Stop recording (keeps it: one undo step)'
    : phase === 'playing' ? 'Punch in: record from here while the tape plays'
      : length > 0 ? `Record ${selName ? `${selName} ` : ''}from ${fmt(point)}${arr?.countIn ? ` after ${arr.countIn} bar${arr.countIn > 1 ? 's' : ''} of count-in` : ''}` : 'Record: the first recording sets the tape’s length';
  const btn = touch ? 40 : 32;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <button type="button" aria-label={recTitle} title={recTitle} disabled={!racksHere} onClick={() => tape.record()}
        style={{ width: btn, height: btn, borderRadius: '50%', border: 0, cursor: racksHere ? 'pointer' : 'default', flexShrink: 0, display: 'grid', placeItems: 'center',
          background: recording ? tk.status.danger : tk.bg.field, boxShadow: `inset 0 0 0 1.5px ${recording ? tk.status.danger : tk.border.strong}`, opacity: racksHere ? 1 : 0.5 }}>
        <span style={{ width: 12, height: 12, borderRadius: recording ? 2 : '50%', background: recording ? '#fff' : tk.status.danger, animation: phase === 'recording' ? 'tapePulse 1s ease-in-out infinite' : undefined }} />
      </button>
      <IconButton icon={running && !recording ? 'pause' : 'play'} size={touch ? 'md' : 'sm'} label={running ? 'Stop' : length > 0 ? `Play from ${fmt(point)}` : 'Nothing on the tape yet'}
        disabled={!running && !(length > 0)} onClick={() => (running ? tape.stop() : tape.play())} active={phase === 'playing'} />
      <span ref={timeRef} aria-live="off" style={{ font: `600 12px ${fontFamily.mono}`, color: recording ? tk.status.danger : tk.text.secondary, minWidth: 104, fontVariantNumeric: 'tabular-nums' }} />
      {phase === 'counting' && <span style={{ font: `700 12px ${fontFamily.ui}`, color: tk.status.danger }}>Count-in · {count}</span>}
      {compact && (
        <>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="layout" onClick={() => usePlayUi.getState().setEngineView('arrangement')} title="The tape: a lane per rack, overdub, punch-in">Arrangement</Button>
        </>
      )}
      <style>{'@keyframes tapePulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }'}</style>
    </div>
  );
}

// ── The Arrangement view ─────────────────────────────────────────────────────

export function ArrangementPanel({ play, touch }: { play: PlayRecord; onChange: Change; touch: boolean }) {
  const tk = useTokens();
  const racks = useMemo(() => play.audioEngine?.racks ?? [], [play.audioEngine]);
  const arr = play.arrangement ?? emptyArrangement(recordBpm(play.mappings));
  const phase = useTape(s => s.phase);
  const count = useTape(s => s.count);
  const selected = useTape(s => s.selected);
  const mode = useTape(s => s.mode);
  const lanes = useTapePreviews(s => s.lanes);
  // Previews follow the tape and the racks (each lane renders again only when its own track or rack changed).
  useEffect(() => { refreshPreviews(useNodeGraphStore.getState().play); }, [play.arrangement, play.audioEngine]);
  const live = phase === 'recording' || phase === 'counting';
  // The view's span: the tape and some room; the whole minute while recording (the tape can grow).
  const span = live ? TAPE_MAX_SECONDS : Math.min(TAPE_MAX_SECONDS, Math.max(8, Math.ceil((arr.length || 4) * 1.25)));
  const makeTake = () => {
    const take = arrangementTake(play, `Tape ${(play.takes ?? []).filter(t => t.tape?.made).length + 1}`);
    if (!take) { toast.info('Nothing on the tape to make a take of'); return; }
    addTake(take);
    toast.success(`${take.name} is a take`, { message: 'Render it from Record like any take: the racks play the tape offline, sample by sample.', action: { label: 'Render…', onClick: () => useTakes.getState().renderTake(take.id) } });
  };
  const noRacks = !racks.length;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
        <TapeTransport play={play} touch={touch} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <IconButton icon="loop" size="sm" active={arr.loop} label={arr.loop ? 'Loop is on: playback starts over at the end' : 'Loop is off: playback stops at the end'} onClick={() => setArr(a => ({ ...a, loop: !a.loop }))} />
          <IconButton icon="clock" size="sm" active={arr.metronome} label={arr.metronome ? 'Metronome on: a click every beat' : 'Metronome off (the count-in counts silently)'} onClick={() => setArr(a => ({ ...a, metronome: !a.metronome }))} />
          <Select ariaLabel="Count-in" value={String(arr.countIn)} height={28} style={{ flex: '0 1 130px', minWidth: 0 }}
            options={COUNT_INS.map(n => ({ value: String(n), label: n ? `Count-in ${n} bar${n > 1 ? 's' : ''}` : 'No count-in' }))}
            onChange={v => setArr(a => ({ ...a, countIn: Number(v) as CountIn }))} />
          <BpmField key={arr.bpm} bpm={arr.bpm} />
          <Select ariaLabel="Fade in" value={String(arr.fade)} height={28} style={{ flex: '0 1 140px', minWidth: 0 }}
            options={[0, 10, 50, 200, 500, 1000].map(ms => ({ value: String(ms), label: ms ? `Fade in ${ms} ms` : 'No fade in' }))}
            onChange={v => setArr(a => ({ ...a, fade: Number(v) }))} />
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="record" disabled={!(arr.length > 0)} onClick={makeTake} title="A take of the tape (its notes and rack controls), to render from Record">Make a take</Button>
        </div>
        {selected && racks.some(r => r.id === selected) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>Record {racks.find(r => r.id === selected)?.name} alone:</span>
            <Segmented size="sm" ariaLabel="How recording the selected track works" value={mode} onChange={m => useTape.setState({ mode: m })}
              options={[
                { value: 'replace', label: 'Replace', title: 'Everything on this track from the record point to where you stop is replaced' },
                { value: 'overdub', label: 'Overdub', title: 'Only where you play notes or move a rack control is replaced' },
              ]} />
            <Button size="sm" variant="ghost" onClick={() => useTape.setState({ selected: '' })}>All armed tracks</Button>
          </div>
        )}
      </div>
      {noRacks ? (
        <div style={{ padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>The tape records racks</div>
          Add a rack in Performance, then press Record here and play it. The first recording sets the tape’s length; play it back, overdub another rack, or punch in from any point.
        </div>
      ) : (
        <Lanes play={play} arr={arr} racks={racks} span={span} lanes={lanes} phase={phase} selected={selected} touch={touch} />
      )}
      {phase === 'counting' && count > 0 && (
        <div aria-live="polite" style={{ position: 'sticky', bottom: 12, alignSelf: 'center', padding: '10px 22px', borderRadius: radius.lg, background: alpha('#000', 0.72), color: '#fff', font: `700 28px ${fontFamily.mono}`, pointerEvents: 'none' }}>{count}</div>
      )}
      <span style={{ color: tk.text.faint, font: `11.5px/1.5 ${fontFamily.ui}` }}>
        The tape keeps notes and rack controls, not sound: playing it back plays each rack for real, so readers and mappings follow. Recording onto it replaces only where you play notes or move a rack control; select a lane to redo one rack. Up to {TAPE_MAX_SECONDS} s for now. Each recording is one undo step.
      </span>
    </div>
  );
}

function BpmField({ bpm }: { bpm: number }) {
  const tk = useTokens();
  const [text, setText] = useState(String(bpm));
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 20 && v <= 300) setArr(a => ({ ...a, bpm: Math.round(v * 10) / 10 })); else setText(String(bpm));
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }} title="The metronome’s and count-in’s tempo (from the Clock source when the setup has one)">
      <input aria-label="BPM" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 46, height: 28, padding: '0 6px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `12px ${fontFamily.mono}` }} />
      BPM
    </label>
  );
}

// ── Lanes ────────────────────────────────────────────────────────────────────

const HEAD_W = 168;

function Lanes({ play, arr, racks, span, lanes, phase, selected, touch }: {
  play: PlayRecord; arr: PlayArrangement; racks: readonly AeRack[]; span: number; lanes: Record<string, LanePreview>; phase: TapePhase; selected: string; touch: boolean;
}) {
  const tk = useTokens();
  const point = useTape(s => s.point);
  const areaRef = useRef<HTMLDivElement>(null);
  const extRef = useRef<HTMLDivElement>(null);
  // Each lane's playhead registers here; one animation frame moves them all.
  const heads = useRef(new Set<HTMLDivElement>());
  const [headsTick, setHeadsTick] = useState(0);
  const registerHead = useMemo(() => (el: HTMLDivElement | null, prev: { el: HTMLDivElement | null }) => {
    if (prev.el) heads.current.delete(prev.el);
    prev.el = el;
    if (el) heads.current.add(el);
    setHeadsTick(t => t + 1);
  }, []);
  const running = phase !== 'stopped';
  // The playhead (and a recording's growing tape) on their own frame while the tape runs.
  useEffect(() => {
    const ext = extRef.current;
    if (!ext) return;
    const place = () => {
      const p = tape.position();
      const left = `${Math.max(0, Math.min(1, p / span)) * 100}%`, op = p < 0 ? '0.35' : '1';
      for (const h of heads.current) { h.style.left = left; h.style.opacity = op; }
      ext.style.width = `${Math.min(1, tape.shownLength() / span) * 100}%`;
    };
    place();
    if (!running) return;
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, span, point, arr.length, headsTick]);
  const seekAt = (clientX: number) => {
    const el = areaRef.current;
    if (!el || phase === 'recording' || phase === 'counting') return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
    tape.setPoint(Math.round(t * 20) / 20);
  };
  const ticks = useMemo(() => {
    const step = span <= 10 ? 1 : span <= 30 ? 5 : 10;
    return Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  }, [span]);
  const narrow = useNarrow();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* The ruler: seconds, the tape's length, the 60 s limit, the record point. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {!narrow && <span style={{ width: HEAD_W, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{arr.length > 0 ? `${arr.length.toFixed(1)} s of ${TAPE_MAX_SECONDS}` : 'Empty tape'}</span>}
        <div ref={areaRef} role="slider" aria-label="Record point" aria-valuemin={0} aria-valuemax={arr.length} aria-valuenow={point} tabIndex={0}
          onPointerDown={e => seekAt(e.clientX)}
          onKeyDown={e => { if (e.key === 'ArrowLeft') tape.setPoint(point - 0.1); else if (e.key === 'ArrowRight') tape.setPoint(point + 0.1); else if (e.key === 'Home') tape.setPoint(0); }}
          style={{ position: 'relative', flex: 1, minWidth: 0, height: 22, borderRadius: radius.sm, background: tk.bg.field, cursor: 'pointer', overflow: 'hidden' }}>
          <div ref={extRef} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: alpha(tk.accent.base, 0.14) }} />
          {ticks.map(t => (
            <span key={t} style={{ position: 'absolute', left: `${(t / span) * 100}%`, bottom: 0, height: 22, borderLeft: `1px solid ${tk.border.default}`, paddingLeft: 3, color: tk.text.faint, font: `10px ${fontFamily.mono}` }}>{t}</span>
          ))}
          {span >= TAPE_MAX_SECONDS && <span title="The tape’s limit for now" style={{ position: 'absolute', right: 2, top: 3, color: tk.status.danger, font: `600 10px ${fontFamily.ui}` }}>60 s limit</span>}
          <Marker point={point} span={span} />
        </div>
      </div>
      <div>
        {racks.map(r => (
          <Lane key={r.id} play={play} rack={r} track={arr.tracks[r.id]} length={arr.length} span={span} preview={lanes[r.id]}
            selected={selected === r.id} narrow={narrow} touch={touch} onSeek={seekAt} registerHead={registerHead} recording={phase === 'recording'} />
        ))}
      </div>
    </div>
  );
}

function Marker({ point, span }: { point: number; span: number }) {
  const tk = useTokens();
  return (
    <span aria-hidden style={{ position: 'absolute', left: `${(point / span) * 100}%`, top: 0, bottom: 0, marginLeft: -5, width: 10, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `7px solid ${tk.status.danger}` }} />
      <span style={{ position: 'absolute', left: 4.5, top: 0, bottom: 0, width: 1, background: tk.status.danger }} />
    </span>
  );
}

/** Under 560 px the lanes stack: the lane's header above its timeline. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 560);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 560);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

type RegisterHead = (el: HTMLDivElement | null, prev: { el: HTMLDivElement | null }) => void;

function Lane({ play, rack, track, length, span, preview, selected, narrow, touch, onSeek, registerHead, recording }: {
  play: PlayRecord; rack: AeRack; track: ArrTrack | undefined; length: number; span: number; preview: LanePreview | undefined;
  selected: boolean; narrow: boolean; touch: boolean; onSeek: (clientX: number) => void; registerHead: RegisterHead; recording: boolean;
}) {
  const tk = useTokens();
  const armed = track?.arm !== false;
  const has = trackHasMaterial(track);
  const clear = async () => {
    if (!(await askConfirm(`Clear ${rack.name}’s track?`, { message: 'Its notes and rack control moves come off the tape (Undo brings them back).', confirmLabel: 'Clear', danger: true }))) return;
    useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: clearTrack(p.arrangement ?? emptyArrangement(), rack.id) }), { label: `Cleared ${rack.name}’s track` });
  };
  const patch = (over: Partial<ArrTrack>) => setArr(a => patchTrack(a, rack.id, over));
  // Selecting a lane also selects its rack: unless one is locked as the lead, what you play goes to it.
  const select = () => {
    const on = useTape.getState().selected !== rack.id;
    useTape.setState({ selected: on ? rack.id : '' });
    if (on) selectRack(rack.id);
  };
  const nNotes = track?.notes.length ?? 0, nAuto = Object.keys(track?.auto ?? {}).length;
  const head = (
    <div style={{ width: narrow ? '100%' : HEAD_W, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <button type="button" onClick={select} title={selected ? 'Selected: Record redoes this rack alone. Click to record every armed track again.' : 'Select to record this rack alone (replace or overdub)'}
        style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <b style={{ font: `650 12.5px ${fontFamily.ui}`, color: selected ? tk.accent.text : tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rack.name}</b>
        <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rack.instrument ? aeSlotName(rack.instrument) : rack.source ? 'A send' : 'No instrument'}{has ? ` · ${nNotes} note${nNotes === 1 ? '' : 's'}${nAuto ? ` · ${nAuto} control${nAuto === 1 ? '' : 's'}` : ''}` : ''}
        </span>
      </button>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <IconButton icon="record" size={touch ? 'md' : 'sm'} active={armed} label={armed ? 'Armed: records when you press Record' : 'Not armed: Record leaves this track alone'} onClick={() => patch({ arm: !armed })} />
        <LaneToggle on={!!track?.mute} label="M" title={track?.mute ? 'Unmute this track' : 'Mute this track on playback'} onClick={() => patch({ mute: !track?.mute })} touch={touch} />
        <LaneToggle on={!!track?.solo} label="S" title={track?.solo ? 'Unsolo' : 'Solo: only soloed tracks play'} onClick={() => patch({ solo: !track?.solo })} touch={touch} />
        <IconButton icon="trash" size={touch ? 'md' : 'sm'} tone="danger" label="Clear this track" disabled={!has} onClick={() => void clear()} />
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: narrow ? 4 : 8, padding: '6px 0', borderTop: `1px solid ${tk.border.subtle}`, background: selected ? alpha(tk.accent.base, 0.06) : undefined, borderRadius: selected ? radius.sm : 0 }}>
      {head}
      <LaneCanvas track={track} length={length} span={span} preview={preview} muted={!!track?.mute} controls={play.controls} onSeek={onSeek} height={touch ? 64 : 54} registerHead={registerHead} recording={recording} />
    </div>
  );
}

function LaneToggle({ on, label, title, onClick, touch }: { on: boolean; label: string; title: string; onClick: () => void; touch: boolean }) {
  const tk = useTokens();
  const s = touch ? 32 : 24;
  return (
    <button type="button" aria-pressed={on} aria-label={title} title={title} onClick={onClick}
      style={{ width: s, height: s, borderRadius: radius.sm, border: 0, cursor: 'pointer', font: `700 11px ${fontFamily.ui}`, color: on ? '#fff' : tk.text.muted, background: on ? (label === 'M' ? tk.status.warning : tk.accent.base) : tk.bg.field }}>{label}</button>
  );
}

/** One lane's timeline: the rendered waveform, the notes as bars, the rack controls' automation as lines. Redrawn only when they change. */
function LaneCanvas({ track, length, span, preview, muted, controls, onSeek, height, registerHead, recording }: {
  track: ArrTrack | undefined; length: number; span: number; preview: LanePreview | undefined; muted: boolean;
  controls: PlayRecord['controls']; onSeek: (clientX: number) => void; height: number; registerHead: RegisterHead; recording: boolean;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const headSlot = useRef<{ el: HTMLDivElement | null }>({ el: null });
  const headRef = useMemo(() => (el: HTMLDivElement | null) => registerHead(el, headSlot.current), [registerHead]);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
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
    // Past the tape's end: dimmed.
    g.fillStyle = alpha(tk.text.primary, 0.05);
    g.fillRect(x(length), 0, w - x(length), height);
    // The waveform, mirrored around the middle.
    if (preview?.status === 'ok') {
      const p = preview.peaks, n = p.length, lw = x(preview.length);
      g.fillStyle = alpha(tk.accent.base, muted ? 0.18 : 0.42);
      for (let i = 0; i < n; i++) {
        const h = Math.max(0.5, p[i] * (height / 2 - 2));
        g.fillRect((i / n) * lw, height / 2 - h, Math.max(1, lw / n), h * 2);
      }
    }
    // Notes as bars, across the track's own pitch range.
    const notes = track?.notes ?? [];
    if (notes.length) {
      let lo = 127, hi = 0;
      for (const n of notes) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); }
      const range = Math.max(12, hi - lo + 1), bar = Math.max(2, Math.min(6, (height - 8) / range));
      for (const n of notes) {
        const y = 4 + (1 - (n.n - lo + 0.5) / range) * (height - 8) - bar / 2;
        g.fillStyle = alpha(tk.text.primary, muted ? 0.25 : 0.35 + 0.55 * n.v);
        g.fillRect(x(n.t), y, Math.max(2, x(n.t + n.d) - x(n.t)), bar);
      }
    }
    // Rack controls' automation: a line each, across the control's range.
    g.lineWidth = 1.25;
    for (const [target, pts] of Object.entries(track?.auto ?? {})) {
      const c = controls.find(k => k.target === target);
      const lo = c?.min ?? 0, hi = c?.max ?? 1, r = hi - lo || 1;
      g.strokeStyle = tk.status.warning;
      g.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const px = x(pts[i]), py = height - 3 - ((pts[i + 1] - lo) / r) * (height - 6);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
  }, [w, height, span, length, track, preview, muted, controls, tk]);
  const note = preview?.status === 'none' && preview.why ? preview.why : preview?.status === 'busy' ? 'Rendering…' : '';
  const style: CSSProperties = { display: 'block', width: '100%', height, borderRadius: radius.sm, background: tk.bg.field, cursor: 'pointer', touchAction: 'none' };
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <canvas ref={ref} style={style} onPointerDown={e => onSeek(e.clientX)} aria-label="The track: click to set the record point" />
      <div ref={headRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1, pointerEvents: 'none', background: recording ? tk.status.danger : tk.accent.base }} />
      {note && <span style={{ position: 'absolute', right: 6, bottom: 4, color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, pointerEvents: 'none' }}>{note}</span>}
      {!track?.notes.length && !Object.keys(track?.auto ?? {}).length && <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: tk.text.faint, font: `11px ${fontFamily.ui}`, pointerEvents: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="record" size={11} />Nothing recorded</span>}
    </div>
  );
}
