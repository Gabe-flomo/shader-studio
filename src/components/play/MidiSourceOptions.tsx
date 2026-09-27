/**
 * MidiSourceOptions — the extra rows of a MIDI mapping:
 *
 *   CC     "Active input" (the knob touched last: CC, channel, device) and
 *          **Lock to this knob**, which binds that exact control to the
 *          mapping. Several locks drive it together (whichever moved last);
 *          each has its ×. **Learn & lock** waits for the next knob.
 *   notes  the note range: **Set range** asks for the low key, then the high
 *          key; the ends can be typed (C2, 36); **Reset to full range**.
 *   pads   a Pad grid source: what it reads, and the grid's card below.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { midiEngine } from '../../lib/midiEngine';
import { activeLabel, lockLabel, sameLock, useActiveInput } from './midiUi';
import { MIDI_LOCKS_MAX, PAD_GRID_READS, type MidiLock } from '../../types/playMidi';
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

function CcLocks({ source, labelStyle, onChange }: { source: MidiSource; labelStyle: CSSProperties; onChange: (s: PlaySource) => void }) {
  const tk = useTokens();
  const active = useActiveInput();
  const [listening, setListening] = useState(false);
  const locks = source.locks ?? [];
  const setLocks = (next: MidiLock[]) => {
    const { locks: _drop, ...rest } = source;
    void _drop;
    // The first lock's CC also becomes the row's, so unlocking everything leaves the knob it was on.
    onChange(next.length ? { ...rest, locks: next.slice(0, MIDI_LOCKS_MAX), cc: next[0].cc } : rest);
  };
  const addLock = (l: MidiLock) => { if (!locks.some(x => sameLock(x, l))) setLocks([...locks, l]); };
  useEffect(() => {
    if (!listening) return;
    return midiEngine.subscribe(e => {
      if (e.kind !== 'cc') return;
      addLock({ device: e.device ?? '', channel: e.channel, cc: e.cc });
      setListening(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, source]);
  const activeLock: MidiLock | null = active?.kind === 'cc' ? { device: active.device, channel: active.channel, cc: active.number } : null;
  const already = !!activeLock && locks.some(l => sameLock(l, activeLock));
  const hint = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  return (
    <>
      <Row label="Active" labelStyle={labelStyle}>
        <span data-testid="midi-active-input" style={{ flex: 1, minWidth: 0, height: 24, padding: '0 8px', display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: tk.bg.field, color: active ? tk.text.primary : tk.text.faint, font: `500 11px ${fontFamily.mono}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          title="The MIDI control touched last, on any device">
          {active ? activeLabel(active) : 'Touch a knob…'}
        </span>
      </Row>
      <Row label="" labelStyle={labelStyle}>
        <Button size="sm" icon="lock" disabled={!activeLock || already} onClick={() => activeLock && addLock(activeLock)}
          title={activeLock ? `Only ${lockLabel(activeLock)} drives this mapping (add more to drive it from several knobs)` : 'Turn a knob first'}>
          {already ? 'Locked' : 'Lock to this knob'}
        </Button>
        <Button size="sm" variant={listening ? 'primary' : 'ghost'} onClick={() => setListening(l => !l)} title="Lock the next knob you turn">
          {listening ? 'Turn a knob…' : 'Learn & lock'}
        </Button>
      </Row>
      {locks.length > 0 && (
        <Row label="Locked" labelStyle={labelStyle}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {locks.map(l => (
            <span key={`${l.device}|${l.channel}|${l.cc}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 24, padding: '0 2px 0 8px', borderRadius: radius.lg, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `500 11px ${fontFamily.mono}` }}>
              {lockLabel(l)}
              <IconButton icon="close" label={`Unlock ${lockLabel(l)}`} size="sm" tooltip={false} onClick={() => setLocks(locks.filter(x => !sameLock(x, l)))} />
            </span>
          ))}
          {hint(locks.length > 1 ? 'Whichever moved last drives it; other knobs are ignored.' : 'Other knobs are ignored.')}
          </span>
        </Row>
      )}
    </>
  );
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
  const [step, setStep] = useState<null | 'low' | 'high'>(null);
  const [low, setLow] = useState<number | null>(null);
  const range = source.range ?? null;
  const setRange = (r: [number, number] | null) => {
    const { range: _drop, ...rest } = source;
    void _drop;
    onChange(r ? { ...rest, range: r } : rest);
  };
  useEffect(() => {
    if (!step) return;
    return midiEngine.subscribe(e => {
      if (e.kind !== 'noteOn' || (source.channel && e.channel !== source.channel)) return;
      if (step === 'low') { setLow(e.note); setStep('high'); return; }
      setRange(kmRange(low ?? e.note, e.note));
      setStep(null);
      setLow(null);
    });
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
          {range ? `${kmNoteName(lo)}–${kmNoteName(hi)}` : 'All notes'}
        </span>
        <Button size="sm" variant={step ? 'primary' : 'secondary'} onClick={() => { setStep(s => (s ? null : 'low')); setLow(null); }} title="Press the lowest key, then the highest: only notes between them count">
          {step ? 'Cancel' : 'Set range'}
        </Button>
        {range && <Button size="sm" variant="ghost" onClick={() => setRange(null)}>Reset to full range</Button>}
      </Row>
      {step && (
        <div style={{ margin: '-2px 0 6px 60px', padding: '6px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
          {step === 'low' ? 'Press the lowest key of the range…' : `Low end ${kmNoteName(low ?? 0)}. Now press the highest key…`}
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
