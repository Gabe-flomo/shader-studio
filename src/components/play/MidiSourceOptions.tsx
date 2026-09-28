/**
 * MidiSourceOptions — the extra rows of a MIDI mapping:
 *
 *   CC     the **Knob** it follows (a new row waits for the first knob turned,
 *          lib/midiAutoLearn.ts; **Change…** waits for another), the
 *          **Active** input (the knob touched last: CC, channel, device) and
 *          **Lock to this knob**, which binds that exact control, device
 *          included, to the mapping. Several locks drive it together
 *          (whichever moved last); each has its ×, and unlocking keeps the CC.
 *   notes  the note range: **Set range** asks for the low key, then the high
 *          key; the ends can be typed (C2, 36); **Learn a note** waits for one
 *          key (velocity, gate); **Reset to full range**.
 *   pads   a Pad grid source: what it reads, and the grid's card below.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { midiEngine } from '../../lib/midiEngine';
import { ASSIGN_FLASH_MS, assignCc, claimMidiListen, isUnassignedCc, lastMidiAssignment, onMidiAssignment, withCcLocks, type MidiAssignment } from '../../lib/midiAutoLearn';
import { activeLabel, lockLabel, sameLock, useActiveInput } from './midiUi';
import { PAD_GRID_READS, type MidiLock } from '../../types/playMidi';
import type { PlaySource } from '../../types/play';
import { kmNoteName, kmParseNote, kmRange } from '../../play/kit/midi.js';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { NumberInput } from '../NodeGraph/NumberInput';
import { DEFAULT_PAD_GRID } from '../../types/playMidi';

type MidiSource = Extract<PlaySource, { kind: 'midi' }>;
type PadSource = Extract<PlaySource, { kind: 'pad' }>;

function Row({ label, labelStyle, children }: { label: string; labelStyle: CSSProperties; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

export function MidiSourceOptions({ source, labelStyle, numStyle, onChange }: {
  source: MidiSource;
  labelStyle: CSSProperties;
  numStyle: CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  if (source.signal === 'cc') return <CcLocks source={source} labelStyle={labelStyle} onChange={onChange} />;
  if (source.signal === 'note' || source.signal === 'velocity' || source.signal === 'gate') return <NoteRange source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
  return null;
}

/** "Turn a knob…", pulsing: a CC row that hasn't been given its knob yet (lib/midiAutoLearn.ts). */
export function MidiWaitChip({ title, style }: { title: string; style?: CSSProperties }) {
  const tk = useTokens();
  return (
    <span data-testid="midi-cc-unassigned" title={title}
      style={{ height: 24, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 6, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11px ${fontFamily.ui}`, whiteSpace: 'nowrap', ...style }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tk.accent.base, animation: 'midi-wait-pulse 1.4s ease-in-out infinite' }} />
      Turn a knob…
      <style>{'@keyframes midi-wait-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}@media (prefers-reduced-motion:reduce){@keyframes midi-wait-pulse{0%,100%{opacity:1;transform:none}50%{opacity:1;transform:none}}}'}</style>
    </span>
  );
}

/**
 * The Knob row of a CC mapping: which CC (and channel) drives it, **Change…**
 * to wait for another knob, and **Lock to this knob**, which also ties it to
 * the device the active knob is on. The CC number and channel fields are in
 * the source row above (PlayPage.tsx).
 */
function CcLocks({ source, labelStyle, onChange }: { source: MidiSource; labelStyle: CSSProperties; onChange: (s: PlaySource) => void }) {
  const tk = useTokens();
  const active = useActiveInput();
  const [listening, setListening] = useState(false);
  const locks = source.locks ?? [];
  const unassigned = isUnassignedCc(source);
  const setLocks = (next: MidiLock[]) => onChange(withCcLocks(source, next));
  const addLock = (l: MidiLock) => { if (!locks.some(x => sameLock(x, l))) setLocks([...locks, l]); };
  // Change…: the next knob turned becomes the row's CC (the old one stays until then; Esc cancels).
  useEffect(() => {
    if (!listening) return;
    const release = claimMidiListen();
    void midiEngine.connectWebMidi({ retry: true });
    const off = midiEngine.subscribe(e => {
      if (e.kind !== 'cc') return;
      onChange(assignCc(locks.length ? withCcLocks(source, []) : source, e));
      setListening(false);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setListening(false); };
    window.addEventListener('keydown', onKey);
    return () => { off(); release(); window.removeEventListener('keydown', onKey); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, source]);
  // The knob this row follows: its CC and channel, and the device it was last turned on.
  // The assignment lands in the record first and reaches this row as a new `source`: look for it then, and listen on for the next.
  const [flash, setFlash] = useState<MidiAssignment | null>(null);
  useEffect(() => {
    const recent = recentAssignment(source);
    if (recent) setFlash(recent);
    return onMidiAssignment(a => { if (matchesAssignment(source, a)) setFlash(a); });
  }, [source]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), ASSIGN_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash]);
  const activeLock: MidiLock | null = active?.kind === 'cc' ? { device: active.device, channel: active.channel, cc: active.number } : null;
  const onThisKnob = !!activeLock && !unassigned && activeLock.cc === source.cc && (!source.channel || activeLock.channel === source.channel);
  const device = onThisKnob ? active!.device : lastMidiAssignment()?.cc === source.cc && lastMidiAssignment()?.channel === source.channel ? lastMidiAssignment()!.device : '';
  const already = !!activeLock && locks.some(l => sameLock(l, activeLock));
  const hint = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const knobText = unassigned ? null : `CC ${source.cc}${source.channel ? ` · ch ${source.channel}` : ' · any ch'}${device ? ` · ${device}` : ''}`;
  return (
    <>
      <Row label="Knob" labelStyle={labelStyle}>
        {unassigned && !listening
          ? <MidiWaitChip title="The first CC that moves on any device becomes this row's CC and channel" style={{ flex: 1 }} />
          : (
            <span data-testid="midi-knob" style={{ flex: 1, minWidth: 0, height: 24, padding: '0 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: flash ? alpha(tk.accent.base, 0.18) : tk.bg.field, color: listening ? tk.accent.text : tk.text.primary, font: `${flash ? 600 : 500} 11px ${fontFamily.mono}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', transition: 'background 0.8s ease-out' }}
              title={listening ? 'Waiting for the next knob (Esc keeps the current one)' : 'The knob this mapping follows. Type another CC number in the field above, or press Change… and turn the knob you want.'}>
              {listening ? 'Turn a knob…' : flash ? `Assigned ${knobText}` : knobText}
            </span>
          )}
        <Button size="sm" variant={listening ? 'primary' : 'ghost'} onClick={() => setListening(l => !l)}
          title={listening ? 'Stop waiting and keep the current knob' : 'Learn a different knob: the next CC that moves becomes this row’s CC (any device)'}>
          {listening ? 'Cancel' : 'Change…'}
        </Button>
      </Row>
      <Row label="Active" labelStyle={labelStyle}>
        <span data-testid="midi-active-input" style={{ flex: 1, minWidth: 0, height: 24, padding: '0 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: tk.bg.field, color: active ? tk.text.primary : tk.text.faint, font: `500 11px ${fontFamily.mono}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          title="The MIDI control touched last, on any device">
          {active ? activeLabel(active) : 'Touch a knob…'}
        </span>
        <Button size="sm" icon="lock" disabled={!activeLock || already} onClick={() => activeLock && addLock(activeLock)}
          title={activeLock
            ? `Lock: only ${lockLabel(activeLock)} drives this mapping. Unlike Change…, a lock names the device too, so the same CC from another controller is ignored. Add more locks to drive it from several knobs.`
            : 'Turn the knob you want, then lock it: a lock ties this row to that exact device, channel and CC'}>
          {already ? 'Locked' : 'Lock to this knob'}
        </Button>
      </Row>
      {locks.length > 0 && (
        <Row label="Locked" labelStyle={labelStyle}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {locks.map(l => (
            <span key={`${l.device}|${l.channel}|${l.cc}`} title={`Locked: only this control drives the row. Unlocking keeps CC ${l.cc}; the row then follows it from any device.`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 24, padding: '0 2px 0 8px', borderRadius: radius.lg, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `500 11px ${fontFamily.mono}` }}>
              {lockLabel(l)}
              <IconButton icon="close" label={`Unlock ${lockLabel(l)} (keeps CC ${l.cc}, from any device)`} size="sm" tooltip={false} onClick={() => setLocks(locks.filter(x => !sameLock(x, l)))} />
            </span>
          ))}
          {hint(locks.length > 1 ? 'Whichever moved last drives it; other knobs are ignored.' : 'Other knobs are ignored.')}
          </span>
        </Row>
      )}
    </>
  );
}

function matchesAssignment(source: MidiSource, a: MidiAssignment): boolean {
  return source.signal === 'cc' && source.cc === a.cc && source.channel === a.channel;
}

/** The assignment made moments ago to this row's knob, so a row mounted right after it still flashes. */
function recentAssignment(source: MidiSource): MidiAssignment | null {
  const a = lastMidiAssignment();
  return a && matchesAssignment(source, a) && Date.now() - a.at < ASSIGN_FLASH_MS ? a : null;
}

/** A note typed as a name or a number; commits on Enter or leaving the field (keyed by its value, so a new value starts it afresh). */
function NoteField({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(kmNoteName(value));
  const [bad, setBad] = useState(false);
  const commit = () => {
    const n = kmParseNote(text);
    if (n === null) { setBad(true); return; }
    setBad(false);
    if (n !== value) onCommit(n); else setText(kmNoteName(value));
  };
  return (
    <Field aria-label={label} title={`${label}: a note name (C2, F#3) or number (0–127)`} value={text} invalid={bad} mono height={24}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ width: 52 }} />
  );
}

function NoteRange({ source, labelStyle, onChange }: { source: MidiSource; labelStyle: CSSProperties; numStyle: CSSProperties; onChange: (s: PlaySource) => void }) {
  const tk = useTokens();
  // 'one': Learn a note, a range of a single key (a pad for a gate or velocity source).
  const [step, setStep] = useState<null | 'low' | 'high' | 'one'>(null);
  const [low, setLow] = useState<number | null>(null);
  const range = source.range ?? null;
  const setRange = (r: [number, number] | null) => {
    const { range: _drop, ...rest } = source;
    void _drop;
    onChange(r ? { ...rest, range: r } : rest);
  };
  useEffect(() => {
    if (!step) return;
    // Waiting for keys: an unassigned CC row doesn't take a knob meanwhile (lib/midiAutoLearn.ts).
    const release = claimMidiListen();
    const off = midiEngine.subscribe(e => {
      if (e.kind !== 'noteOn' || (source.channel && e.channel !== source.channel)) return;
      if (step === 'low') { setLow(e.note); setStep('high'); return; }
      setRange(step === 'one' ? [e.note, e.note] : kmRange(low ?? e.note, e.note));
      setStep(null);
      setLow(null);
    });
    return () => { off(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, low, source]);
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setStep(null); setLow(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);
  const lo = range ? range[0] : 0, hi = range ? range[1] : 127;
  return (
    <>
      <Row label="Notes" labelStyle={labelStyle}>
        <span data-testid="midi-note-range" style={{ font: `600 11.5px ${fontFamily.mono}`, color: range ? tk.text.primary : tk.text.muted, minWidth: 64 }}>
          {range ? (lo === hi ? kmNoteName(lo) : `${kmNoteName(lo)}–${kmNoteName(hi)}`) : 'All notes'}
        </span>
        <Button size="sm" variant={step === 'low' || step === 'high' ? 'primary' : 'secondary'} onClick={() => { setStep(s => (s ? null : 'low')); setLow(null); }} title="Press the lowest key, then the highest: only notes between them count">
          {step === 'low' || step === 'high' ? 'Cancel' : 'Set range'}
        </Button>
        {source.signal !== 'note' && (
          <Button size="sm" variant={step === 'one' ? 'primary' : 'ghost'} onClick={() => { setStep(s => (s === 'one' ? null : 'one')); setLow(null); }} title="Press one key or pad: only that note drives this row (a range of one)">
            {step === 'one' ? 'Cancel' : range && lo === hi ? 'Change note…' : 'Learn a note'}
          </Button>
        )}
        {range && <Button size="sm" variant="ghost" onClick={() => setRange(null)}>{lo === hi ? 'Any note' : 'Reset to full range'}</Button>}
      </Row>
      {step && (
        <div style={{ margin: '-2px 0 6px 60px', padding: '6px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
          {step === 'one' ? 'Press the key or pad for this row…' : step === 'low' ? 'Press the lowest key of the range…' : `Low end ${kmNoteName(low ?? 0)}. Now press the highest key…`}
          <span style={{ fontWeight: 500, opacity: 0.8 }}> Esc to cancel</span>
        </div>
      )}
      {range && (
        <Row label="" labelStyle={labelStyle}>
          <NoteField key={`lo${lo}`} label="Lowest note" value={lo} onCommit={n => setRange(kmRange(n, Math.max(n, hi)))} />
          <span style={{ color: tk.text.faint }}>to</span>
          <NoteField key={`hi${hi}`} label="Highest note" value={hi} onCommit={n => setRange(kmRange(Math.min(n, lo), n))} />
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>
            {source.signal === 'note' ? `${kmNoteName(lo)} reads 0, ${kmNoteName(hi)} reads 1` : 'Notes outside are ignored'}
          </span>
        </Row>
      )}
    </>
  );
}

export function PadSourceOptions({ source, labelStyle, numStyle, onChange }: {
  source: PadSource;
  labelStyle: CSSProperties;
  numStyle: CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const tk = useTokens();
  const pg = useNodeGraphStore(s => s.play.padGrid);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  return (
    <>
      <Row label="Reads" labelStyle={labelStyle}>
        <Segmented size="sm" wrap ariaLabel="Pad grid reading" value={source.read} options={PAD_GRID_READS.map(r => ({ value: r.value, label: r.label.replace(/^Pad /, ''), title: r.title }))} onChange={read => onChange({ ...source, read })} />
        {source.read === 'cell' && <>
          <NumberInput value={source.col + 1} min={1} max={pg?.cols ?? 32} step={1} title="Column (1 at the left)" onCommit={n => onChange({ ...source, col: Math.max(0, Math.round(n) - 1) })} style={{ ...numStyle, width: 40 }} />
          <NumberInput value={source.row + 1} min={1} max={pg?.rows ?? 32} step={1} title="Row (1 at the bottom)" onCommit={n => onChange({ ...source, row: Math.max(0, Math.round(n) - 1) })} style={{ ...numStyle, width: 40 }} />
        </>}
      </Row>
      {!pg && (
        <div style={{ margin: '-2px 0 6px 60px', display: 'flex', alignItems: 'center', gap: 8, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
          No pad grid yet.
          <Button size="sm" icon="grid" onClick={() => setPlay(p => ({ ...p, padGrid: { ...DEFAULT_PAD_GRID } }))}>Set up the pad grid</Button>
        </div>
      )}
    </>
  );
}
