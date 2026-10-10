/**
 * NoteClassMapDialog — "Map 12 notes → 12 targets" (docs/midi.md, Note
 * classes): pick up to twelve controls or layers in the order they should
 * play, see which note each gets (C, C#, D…), and make a source per note
 * with octaves wrapped, so the same key in any octave hits the same target.
 * The work is play/noteClassMap.ts.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { kmClassName } from '../../play/kit/midi.js';
import { classOf, lightProp, mapNoteClasses, NOTE_CLASSES, type NoteTarget } from '../../play/noteClassMap';
import { CHANNELS } from '../../play/playSources';
import type { PlayRecord } from '../../types/play';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';

const keyOf = (t: NoteTarget) => `${t.kind}:${t.id}`;
const CLASS_OPTIONS = Array.from({ length: NOTE_CLASSES }, (_, i) => ({ value: `${i}`, label: kmClassName(i) }));

export function NoteClassMapDialog({ play, onRecord, onClose }: {
  play: PlayRecord;
  onRecord: (fn: (p: PlayRecord) => PlayRecord) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const [picks, setPicks] = useState<NoteTarget[]>([]);
  const [channel, setChannel] = useState(0);
  const [first, setFirst] = useState(0);
  const controls = useMemo(() => play.controls.filter(c => c.kind === 'float'), [play.controls]);
  const layers = useMemo(() => play.layers.filter(l => !!lightProp(l)), [play.layers]);
  const order = new Map(picks.map((p, i) => [keyOf(p), i]));
  const toggle = (t: NoteTarget) => setPicks(prev => (prev.some(p => keyOf(p) === keyOf(t))
    ? prev.filter(p => keyOf(p) !== keyOf(t))
    : prev.length >= NOTE_CLASSES ? prev : [...prev, t]));
  const make = () => {
    let made = 0;
    onRecord(p => { const r = mapNoteClasses(p, picks, { channel, first }); made = r.sourceIds.length; return r.play; });
    toast.success(`Mapped ${made} note${made === 1 ? '' : 's'}, any octave`, { message: `${kmClassName(first)} plays the first; each note in any octave hits the same target.` });
    onClose();
  };
  const row = (t: NoteTarget, label: string, sub: string) => {
    const i = order.get(keyOf(t));
    const on = i !== undefined;
    const full = !on && picks.length >= NOTE_CLASSES;
    return (
      <button key={keyOf(t)} type="button" data-note-target={keyOf(t)} disabled={full} onClick={() => toggle(t)}
        title={on ? 'Click to take it out' : full ? 'Twelve picked: one per note' : 'Click to give it the next note'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: full ? 'default' : 'pointer', textAlign: 'left',
          background: on ? alpha(tk.accent.base, 0.12) : 'transparent', opacity: full ? 0.5 : 1, color: tk.text.primary }}>
        <span style={{ width: 30, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: on ? alpha(tk.accent.base, 0.3) : tk.bg.field, color: on ? tk.accent.text : tk.text.faint, font: `600 11px ${fontFamily.mono}` }}>
          {on ? kmClassName(classOf(i, first)) : '·'}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ font: `500 12.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.faint }}>{sub}</span>
        </span>
        {on && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{i + 1}</span>}
      </button>
    );
  };
  const heading = (t: string) => <div style={{ margin: '10px 0 4px', font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>{t}</div>;
  return (
    <Modal title="Map 12 notes → 12 targets" subtitle="One note per target, in any octave" icon="piano" width={500} onClose={onClose}
      footer={<>
        <Button variant="ghost" disabled={!picks.length} onClick={() => setPicks([])}>Clear</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="piano" disabled={!picks.length} onClick={make}>{picks.length ? `Map ${picks.length} note${picks.length === 1 ? '' : 's'}` : 'Pick targets'}</Button>
      </>}>
      <div data-note-class-map="" style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ font: `12px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>
          Click the controls or layers in the order they should play. The first gets {kmClassName(first)}, the next {kmClassName(first + 1)}, and so on up to twelve.
          Octaves wrap: {kmClassName(first)}2, {kmClassName(first)}3 and {kmClassName(first)}4 all hit the first one. A layer is lit through its opacity (a shape's fill): faint at rest, full on its note.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ font: `12px ${fontFamily.ui}`, color: tk.text.secondary }}>Start on</span>
          <Select ariaLabel="First note" value={`${first}`} options={CLASS_OPTIONS} onChange={v => setFirst(parseInt(v, 10) || 0)} height={26} />
          <span style={{ font: `12px ${fontFamily.ui}`, color: tk.text.secondary }}>Channel</span>
          <Select ariaLabel="MIDI channel" value={`${channel}`} options={CHANNELS} onChange={v => setChannel(parseInt(v, 10) || 0)} height={26} />
          <span style={{ marginLeft: 'auto', font: `500 11.5px ${fontFamily.mono}`, color: tk.text.faint }}>{picks.length} / {NOTE_CLASSES}</span>
        </div>
        {!controls.length && !layers.length && <div style={{ marginTop: 12, color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>Add some sliders or layers first.</div>}
        {layers.length > 0 && <>{heading('Layers')}{layers.map(l => row({ kind: 'layer', id: l.id }, l.label, `${l.kind} · lit by its ${lightProp(l)?.label.toLowerCase() ?? 'opacity'}`))}</>}
        {controls.length > 0 && <>{heading('Controls')}{controls.map(c => row({ kind: 'control', id: c.id }, c.label, `${c.min} to ${c.max}`))}</>}
      </div>
    </Modal>
  );
}
