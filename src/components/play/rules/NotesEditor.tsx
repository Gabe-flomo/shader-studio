/**
 * NotesEditor — a Play notes reaction's settings: the notes (a two-octave
 * piano to click, moved up and down an octave at a time), how they play
 * (Chord, Strum, Arp, Random), velocity and its spread, length, and a scale
 * to snap to.
 */
import { useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { NOTES_MAX, NOTES_SCALES, type NotesSpec } from '../../../types/play';
import { noteName } from '../../../play/notes';
import { IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';

const BLACK = new Set([1, 3, 6, 8, 10]);
/** A black key's width, % of the keyboard. */
const KEY_W = 4;
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function NotesEditor({ spec: s, onChange }: { spec: NotesSpec; onChange: (s: NotesSpec) => void }) {
  const tk = useTokens();
  // The piano shows two octaves from here (starting at the lowest chosen note's octave).
  const [base, setBase] = useState(() => Math.max(0, Math.min(96, Math.floor((s.notes.length ? Math.min(...s.notes) : 60) / 12) * 12)));
  const set = (patch: Partial<NotesSpec>) => onChange({ ...s, ...patch });
  const toggle = (n: number) => set({ notes: s.notes.includes(n) ? s.notes.filter(x => x !== n) : [...s.notes, n].sort((a, b) => a - b).slice(0, NOTES_MAX) });
  const num: React.CSSProperties = { width: 50, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' };
  const word = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const keys = Array.from({ length: 24 }, (_, i) => base + i).filter(n => n <= 127);
  const whites = keys.filter(n => !BLACK.has(n % 12));
  // A black key sits on the line after the white keys below it.
  const blacks = keys.filter(n => BLACK.has(n % 12)).map(n => ({ n, at: whites.filter(w => w < n).length }));
  return (
    <div data-notes-editor="" style={{ padding: '6px 0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton icon="chevL" label="An octave down" size="sm" disabled={base <= 0} onClick={() => setBase(b => Math.max(0, b - 12))} />
        <div role="group" aria-label="Notes" style={{ flex: 1, position: 'relative', height: 44, display: 'flex', gap: 1 }}>
          {whites.map(n => {
            const on = s.notes.includes(n);
            return <button key={n} type="button" data-note={n} aria-pressed={on} title={noteName(n)} onClick={() => toggle(n)}
              style={{ flex: 1, minWidth: 0, border: 0, borderRadius: '0 0 3px 3px', cursor: 'pointer', padding: 0, background: on ? tk.accent.base : tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />;
          })}
          {blacks.map(({ n, at }) => {
            const on = s.notes.includes(n);
            return <button key={n} type="button" data-note={n} aria-pressed={on} title={noteName(n)} onClick={() => toggle(n)}
              style={{ position: 'absolute', top: 0, left: `calc(${(at / whites.length) * 100}% - ${KEY_W / 2}%)`, width: `${KEY_W}%`, height: 27, border: 0, borderRadius: '0 0 3px 3px', cursor: 'pointer', padding: 0, zIndex: 1, background: on ? tk.accent.base : tk.text.secondary }} />;
          })}
        </div>
        <IconButton icon="chevR" label="An octave up" size="sm" disabled={base >= 96} onClick={() => setBase(b => Math.min(96, b + 12))} />
      </div>
      <div style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, margin: '3px 0 0 30px' }}>{s.notes.length ? s.notes.map(noteName).join(' ') : 'Click keys to pick the notes'} · from {noteName(base)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <Segmented size="sm" ariaLabel="How the notes play" value={s.play} onChange={play => set({ play })} options={[
          { value: 'chord', label: 'Chord', title: 'All at once' }, { value: 'strum', label: 'Strum', title: 'One after another, low to high' },
          { value: 'arp', label: 'Arp', title: 'The next note each time it fires' }, { value: 'random', label: 'Random', title: 'One of them, picked at random' },
        ]} />
        {s.play === 'strum' && <>{word('gap')}<NumberInput value={s.gapMs} min={0} max={2000} step={5} title="Between notes, ms" onCommit={n => set({ gapMs: Math.max(0, Math.min(2000, n)) })} style={num} />{word('ms')}</>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {word('Velocity')}<NumberInput value={s.velocity} min={1} max={127} step={1} title="1 to 127" onCommit={n => set({ velocity: Math.max(1, Math.min(127, Math.round(n))) })} style={num} />
        {word('±')}<NumberInput value={Math.round(s.velRandom * 100)} min={0} max={100} step={5} title="How far each note's velocity may stray, %" onCommit={n => set({ velRandom: Math.max(0, Math.min(100, n)) / 100 })} style={num} />{word('%')}
        {word('Length')}<NumberInput value={s.lengthMs} min={20} max={8000} step={10} title="How long each note sounds, ms" onCommit={n => set({ lengthMs: Math.max(20, Math.min(8000, n)) })} style={num} />{word('ms')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {word('Snap to')}
        <Select ariaLabel="Scale" value={s.scale} height={24} options={NOTES_SCALES.map(x => ({ value: x, label: x === 'chromatic' ? 'Any note' : x[0].toUpperCase() + x.slice(1) }))} onChange={v => set({ scale: v as NotesSpec['scale'] })} />
        {s.scale !== 'chromatic' && <Select ariaLabel="Root" value={String(s.root)} height={24} options={ROOTS.map((r, i) => ({ value: String(i), label: r }))} onChange={v => set({ root: Number(v) })} />}
      </div>
    </div>
  );
}
