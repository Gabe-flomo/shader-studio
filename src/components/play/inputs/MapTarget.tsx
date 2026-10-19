/**
 * MapTarget — every control card on the board is a target for a source: in
 * Map mode a click routes the source being mapped onto it (or takes the
 * route off again when it already drives it), and at any time a source
 * card's grip can be dropped on it (sourceDrag.ts), lighting it up while a
 * source hovers over it. In Learn mode (learnMode.ts, Play audit P6) it wears
 * a blue overlay instead: a click picks it as what the next knob or key drives.
 * Outside these it is just its card.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { useMapMode } from './mapMode';
import { useLearnMode } from './learnMode';
import { useViewport } from '../../../lib/viewport';
import { SOURCE_DRAG_TYPE, isSourceDrag, sourceIdOfDrop } from './sourceDrag';

export function MapTarget({ id, label, driven, learned, onPick, onDropSource, children }: {
  /** The control's id (Learn picks it). */
  id?: string;
  label: string;
  driven: boolean;
  /** Learn: what this Learn mapped onto it ("CC 74"), once it has. */
  learned?: string;
  onPick: () => void;
  onDropSource?: (sourceId: string) => void;
  children: ReactNode;
}) {
  const tk = useTokens();
  const active = useMapMode(m => m.sourceId !== null);
  const learning = useLearnMode(m => m.on) && !!id;
  const picked = useLearnMode(m => m.on && m.controlId === id);
  const [over, setOver] = useState(false);
  const drop = onDropSource && {
    onDragOver: (e: React.DragEvent) => {
      if (!isSourceDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    },
    // Leaving for a child of the card isn't leaving the card.
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const id = sourceIdOfDrop(e.dataTransfer.getData(SOURCE_DRAG_TYPE));
      if (!id) return;
      e.preventDefault();
      onDropSource(id);
    },
  };
  if (!active && !drop && !learning) return <>{children}</>;
  return (
    <div data-drop-target={label} style={{ position: 'relative' }} {...drop}>
      {children}
      {over && (
        <span data-drop-over="" style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', borderRadius: radius.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: alpha(tk.accent.base, 0.16), boxShadow: `inset 0 0 0 2px ${tk.accent.base}`, color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
          Drop to drive {label}
        </span>
      )}
      {learning && (
        // Ableton's MIDI map: every mappable control tinted blue, the picked one solid.
        <button type="button" data-learn-target={id} aria-pressed={picked} onClick={() => useLearnMode.getState().pick(id!)}
          title={picked ? `Move a knob, hit a note or press a key for ${label}` : `Learn onto ${label}`}
          style={{ position: 'absolute', inset: 0, zIndex: 3, border: 0, borderRadius: radius.card, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px', textAlign: 'center',
            background: picked ? alpha(LEARN_BLUE, 0.34) : alpha(LEARN_BLUE, 0.14), boxShadow: `inset 0 0 0 ${picked ? 2 : 1}px ${LEARN_BLUE}`, font: `600 12px ${fontFamily.ui}` }}>
          {/* Only the picked card says something: the rest are a tint to click (their names show through). */}
          {picked && (
            <span style={{ padding: '3px 8px', borderRadius: 6, background: LEARN_BLUE, color: '#fff' }}>
              {learned ? `← ${learned}` : 'Move a knob or press a key…'}
            </span>
          )}
        </button>
      )}
      {active && (
        <button type="button" data-map-target={label} onClick={onPick} aria-pressed={driven}
          style={{ position: 'absolute', inset: 0, zIndex: 3, border: 0, borderRadius: radius.card, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: driven ? alpha(tk.accent.base, 0.22) : alpha(tk.accent.base, 0.08), boxShadow: `inset 0 0 0 ${driven ? 2 : 1}px ${tk.accent.base}`, color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
          {driven ? `✓ ${label} · click to unmap` : `Map onto ${label}`}
        </button>
      )}
    </div>
  );
}

/** Learn's overlay colour: Ableton's MIDI-map blue, the same in light and dark. */
export const LEARN_BLUE = '#2f7bf6';

/** The strip over the controls while Learn is on: what it waits for, and Stop (Esc too). */
export function LearnModeBar({ label }: { label: (controlId: string) => string }) {
  const tk = useTokens();
  const { on, controlId, mappingId, stop } = useLearnMode();
  // A phone has no Esc key: Stop says it.
  const phone = useViewport(v => v.phone);
  if (!on) return null;
  const name = controlId ? label(controlId) : '';
  return (
    <div data-learn-mode="" role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', padding: '8px 12px', borderRadius: radius.md, background: alpha(LEARN_BLUE, 0.14), boxShadow: `inset 0 0 0 1px ${alpha(LEARN_BLUE, 0.5)}`, color: tk.text.primary, font: `600 12px ${fontFamily.ui}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {!controlId ? `Learn: ${phone ? 'tap' : 'click'} a control, then move a knob, hit a note or press a key… `
          : mappingId ? `${name} is mapped. Move another knob or key to replace it, or click another control… `
          : `${name}: move a knob, hit a note or press a key… `}
        {!phone && <span style={{ fontWeight: 500, color: tk.text.muted }}>Esc to stop</span>}
      </span>
      <button type="button" onClick={stop} style={{ border: 0, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', background: LEARN_BLUE, color: '#fff', font: `600 12px ${fontFamily.ui}` }}>Stop</button>
    </div>
  );
}

/** The bar over the controls while mapping: which source, and Done (Esc too). */
export function MapModeBar() {
  const tk = useTokens();
  const { sourceId, label, stop } = useMapMode();
  if (!sourceId) return null;
  return (
    <div data-map-mode="" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', padding: '8px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>Mapping {label}: click each control it should drive.</span>
      <button type="button" onClick={stop} style={{ border: 0, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', background: tk.accent.base, color: '#fff', font: `600 12px ${fontFamily.ui}` }}>Done</button>
    </div>
  );
}
