/**
 * MiniMapper — the "+"'s mini mapper (owner's request, 2026-09-28): instead
 * of instantly adding a control, a small popover offers where its value
 * should come from — MIDI, mouse and keys, hands, live audio, other
 * layers, a generator, another control, or "Control only" for no source —
 * and picking one wires it at once (miniMapper.ts): the control is made if
 * the panel doesn't have it, then a mapping across its whole range. The
 * popover then shows the mapping's summary, a quick range editor, and
 * **Open in Mappings** to tune its curve and smoothing, or **Done**.
 *
 * Anchored to whatever button opened it: a layer slider's + (layers/fields.tsx)
 * or the Controls page's Add control button, after its own target picker
 * (PlayPage.tsx). Opens as a Popover on desktop, a bottom sheet on phones
 * (the same breakpoint GroupedPicker uses). Learn waits for the next input
 * of any kind (lib/playEngine.ts startLearn — the same "Learn" a mapping
 * row already offers) and wires whatever comes back.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playEngine } from '../../lib/playEngine';
import { midiEngine, type MidiEvent } from '../../lib/midiEngine';
import { filterSections, moveActive, navigableValues } from '../ui/groupedPickerModel';
import { sourceLabel } from '../../play/playSources';
import { menuAsSheet } from '../ui/menuSheet';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { NumberInput } from '../NodeGraph/NumberInput';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { usePlayUi } from './playUi';
import { CREATE_SIGNAL, MIDI_LEARN, miniMapperSections, wireMiniMapperPick, wireRuleWhen, wireSource, type MiniMapperTarget } from './miniMapperCore';
import { startRule } from './playSplit';
import { toast } from '../ui/toastStore';
import { audioReaderBank } from '../../lib/audioReaderBank';

/** The MIDI device names seen so far, kept fresh (gates the MIDI section: only shown when a device is present). */
function useMidiDeviceNames(): string[] {
  const [names, setNames] = useState(() => midiEngine.webMidi().inputs);
  useEffect(() => midiEngine.subscribe((e: MidiEvent) => { if (e.kind === 'devices') setNames(e.inputs); }), []);
  return names;
}

const DEFAULT_OPEN = new Set(['Control only', 'Signal']);

export function MiniMapper({ anchorRef, target, label, onClose }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  target: MiniMapperTarget;
  label: string;
  onClose: () => void;
}) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const midiDevices = useMidiDeviceNames();
  const hasCamera = play.layers.some(l => l.kind === 'camera');
  const readers = audioReaderBank.readers();
  const [query, setQuery] = useState('');
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const [learning, setLearning] = useState(false);
  const [wired, setWired] = useState<{ controlId: string; mappingId?: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => miniMapperSections({ play, midiDevices, hasCamera, readers }), [play, midiDevices, hasCamera, readers]);
  const shown = filterSections(sections, query);
  const values = navigableValues(shown);
  const [active, setActive] = useState<string | null>(null);
  const activeNow = active !== null && values.includes(active) ? active : values[0] ?? null;
  const isOpen = (h?: string) => !!query || !h || unfolded.has(h);
  const flip = (h: string) => setUnfolded(prev => { const n = new Set(prev); if (n.has(h)) n.delete(h); else n.add(h); return n; });

  const finishPick = (r: { play: import('../../types/play').PlayRecord; control?: import('../../types/play').PlayControl; mapping?: import('../../types/play').PlayMapping }) => {
    setPlay(() => r.play);
    if (r.control) setWired({ controlId: r.control.id, mappingId: r.mapping?.id });
  };

  const pick = (value: string) => {
    if (value === MIDI_LEARN) { setLearning(true); return; }
    if (value === CREATE_SIGNAL) {
      const r = wireRuleWhen(play, target);
      if (!r) { toast.info('Nothing to watch here', { message: 'A colour can’t be watched yet.' }); return; }
      setPlay(() => r.play);
      onClose();
      startRule({ when: r.when });
      return;
    }
    finishPick(wireMiniMapperPick(play, value, target));
  };

  // Learn: the next MIDI input (a knob, a note, the bend wheel — lib/playEngine.ts) becomes the source.
  useEffect(() => {
    if (!learning) return;
    void midiEngine.connectWebMidi({ retry: true });
    return playEngine.startLearn(source => { finishPick(wireSource(play, source, target)); setLearning(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learning, play, target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (learning) setLearning(false); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [learning, onClose]);

  const control = wired ? play.controls.find(c => c.id === wired.controlId) : undefined;
  const mapping = wired?.mappingId ? play.mappings.find(m => m.id === wired.mappingId) : undefined;
  const setRange = (patch: { outMin?: number; outMax?: number }) => setPlay(p => ({ ...p, mappings: p.mappings.map(m => (m.id === mapping?.id ? { ...m, ...patch } : m)) }));
  const openMappings = () => { usePlayUi.getState().setTab('mappings'); onClose(); };

  const asSheet = typeof window !== 'undefined' && menuAsSheet(window.innerWidth);
  // A plain function, not a component: a component made here would be a new type each render, and
  // every hover (which re-renders) would remount the list under the pointer and lose the click.
  const frame = (title: string, children: ReactNode) => asSheet
    ? <Sheet title={title} onClose={onClose} maxHeight="80dvh">{children}</Sheet>
    : <Popover anchorRef={anchorRef} onClose={onClose} align="end" width={300} padding={10}>{children}</Popover>;

  if (wired) {
    if (!control) { onClose(); return null; }
    return (
      frame(control.label, <>
        <div style={{ padding: asSheet ? '0 4px 4px' : 0 }}>
          <div style={{ color: tk.text.faint, fontSize: 11.5, marginBottom: 8 }}>
            <b style={{ color: tk.text.secondary }}>{control.label}</b>
            {mapping ? <> ← {sourceLabel(mapping.source, play.controls, play.layers)}</> : ' · a control, no source yet'}
          </div>
          {mapping && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Range</span>
              <NumberInput value={mapping.outMin} title="Low end" onCommit={n => setRange({ outMin: n })} style={{ width: 64, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />
              <span style={{ color: tk.text.faint }}>→</span>
              <NumberInput value={mapping.outMax} title="High end" onCommit={n => setRange({ outMax: n })} style={{ width: 64, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />
              {mapping.increment && <span style={{ color: tk.accent.text, font: `600 11px ${fontFamily.ui}` }}>Increment — tune it in Mappings</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {mapping && <Button size="sm" onClick={openMappings}>Open in Mappings</Button>}
            <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
          </div>
        </div>
      </>)
    );
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(moveActive(values, activeNow, e.key)); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (activeNow) pick(activeNow); }
  };

  return (
    frame(`Map ${label}`, <>
      <div style={{ padding: asSheet ? '0 4px 4px' : 0 }} onKeyDown={onListKey}>
        {!asSheet && <div style={{ padding: '2px 4px 6px', color: tk.text.faint, fontSize: 11.5 }}>Map <b style={{ color: tk.text.secondary }}>{label}</b> onto…</div>}
        <Field autoFocus={!asSheet} placeholder="Search sources" value={query} onChange={e => { setQuery(e.target.value); setActive(null); }} height={30} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
        {learning && (
          <div style={{ margin: '8px 2px 0', padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
            {midiDevices.length ? `Move a control on ${midiDevices.join(', ')}…` : 'Move a knob, press a key…'}
            <span style={{ opacity: 0.7, fontWeight: 500 }}> Esc cancels</span>
          </div>
        )}
        <div ref={listRef} style={{ maxHeight: asSheet ? undefined : 360, overflowY: 'auto', marginTop: 6 }}>
          {shown.length === 0 && <div style={{ padding: '10px 8px', color: tk.text.faint }}>No match.</div>}
          {shown.map(s => (
            <div key={s.heading}>
              {s.heading && (
                <button type="button" onClick={() => flip(s.heading!)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 6px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `650 11.5px ${fontFamily.ui}`, textAlign: 'left' }}>
                  <Icon name={isOpen(s.heading) ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
                  <span style={{ flex: 1 }}>{s.heading}</span>
                  <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{s.items.length}</span>
                </button>
              )}
              {isOpen(s.heading) && s.items.map(it => (
                <button
                  key={it.value}
                  type="button"
                  title={it.description}
                  onClick={() => pick(it.value)}
                  onMouseEnter={e => { setActive(it.value); (e.currentTarget as HTMLElement).style.background = tk.bg.hover; }}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = it.value === activeNow ? tk.bg.hover : 'none')}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: asSheet ? 40 : 30, padding: '0 8px 0 24px', border: 0, borderRadius: radius.md,
                    background: it.value === activeNow ? tk.bg.hover : 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left',
                  }}
                >
                  {it.icon && <Icon name={it.icon} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>)
  );
}
