/**
 * FillEditor — build a gradient or a palette's bands from colour stops: a bar
 * showing it, a handle per stop (drag along the bar; click the bar to add a
 * stop there, in the colour it had), the chosen stop's colour and place,
 * Smooth or Bands, and the angle. At most `max` stops (Play's background
 * keeps 8; the Studio's Palette node has its own 32).
 *
 * PaletteEditor is the same editor in a window with a name, for making or
 * changing a library palette.
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { ColorSwatch } from '../ui/ColorPicker';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { PLAY_FILL_STOPS_MAX, fitStops, type BackgroundFill, type ColourStop } from '../../types/play';
import { freePaletteName, paletteCss, savePalette, type Palette } from '../../lib/backgroundLibrary';
import { klFillColourAt } from '../../play/kit/layers.js';

export type EditableFill = Pick<BackgroundFill, 'stops' | 'style' | 'angle'>;

const ANGLES: Array<{ a: number; label: string; title: string }> = [
  { a: 180, label: '↓', title: 'Top to bottom' },
  { a: 90, label: '→', title: 'Left to right' },
  { a: 135, label: '↘', title: 'Top left to bottom right' },
  { a: 45, label: '↗', title: 'Bottom left to top right' },
  { a: 0, label: '↑', title: 'Bottom to top' },
];

export function FillEditor({ fill, onChange, max = PLAY_FILL_STOPS_MAX, compact = false, showAngle = true }: {
  fill: EditableFill;
  onChange: (f: EditableFill) => void;
  max?: number;
  compact?: boolean;
  showAngle?: boolean;
}) {
  const tk = useTokens();
  const stops = fitStops(fill.stops, max);
  const [sel, setSel] = useState(0);
  const selected = Math.min(sel, stops.length - 1);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; moved: boolean } | null>(null);
  const set = (next: ColourStop[], keep?: ColourStop) => {
    const sorted = [...next].sort((a, b) => a.pos - b.pos);
    if (keep) setSel(Math.max(0, sorted.indexOf(keep)));
    onChange({ ...fill, stops: sorted });
  };
  const posAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r ? Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) : 0;
  };
  const addAt = (pos: number) => {
    if (stops.length >= max) { toast.info(`${max} stops at most`, { message: 'Remove one to add another here.' }); return; }
    const s: ColourStop = { pos, color: klFillColourAt({ ...fill, stops, style: 'gradient' }, pos) };
    set([...stops, s], s);
  };
  const handle = 26;
  const h = compact ? 40 : 34;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* The bar and its stops */}
      <div style={{ position: 'relative', paddingBottom: handle - 6, margin: '0 10px' }}>
        <div
          ref={bar}
          role="presentation"
          title={stops.length < max ? 'Click to add a stop here' : undefined}
          onPointerDown={e => { if (e.target === e.currentTarget) addAt(posAt(e.clientX)); }}
          style={{ height: h, borderRadius: radius.md, background: paletteCss({ stops, style: fill.style }, 90), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, cursor: stops.length < max ? 'copy' : 'default', touchAction: 'none' }}
        />
        {stops.map((s, i) => {
          const on = i === selected;
          return (
            <button
              key={i} type="button" aria-label={`Stop ${i + 1} at ${Math.round(s.pos * 100)}%`} aria-pressed={on}
              onPointerDown={e => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setSel(i);
                drag.current = { i, moved: false };
              }}
              onPointerMove={e => {
                const d = drag.current;
                if (!d || d.i !== i) return;
                d.moved = true;
                // A stop stays between its neighbours while dragged, so the order (and which handle is which) holds.
                const lo = i > 0 ? stops[i - 1].pos : 0, hi = i + 1 < stops.length ? stops[i + 1].pos : 1;
                const next = stops.map((x, j) => (j === i ? { ...x, pos: Math.max(lo, Math.min(hi, posAt(e.clientX))) } : x));
                onChange({ ...fill, stops: next });
              }}
              onPointerUp={() => {
                const d = drag.current; drag.current = null;
                if (d?.moved) set(stops, stops[i]);
              }}
              onKeyDown={e => {
                const step = e.shiftKey ? 0.1 : 0.01;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const s2 = { ...s, pos: Math.max(0, Math.min(1, s.pos + (e.key === 'ArrowLeft' ? -step : step))) };
                  set(stops.map((x, j) => (j === i ? s2 : x)), s2);
                } else if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > 2) {
                  e.preventDefault(); set(stops.filter((_, j) => j !== i)); setSel(Math.max(0, i - 1));
                }
              }}
              style={{
                position: 'absolute', top: h - 8, left: `calc(${s.pos * 100}% - ${handle / 2}px)`, width: handle, height: handle, padding: 0, border: 0, background: 'none',
                cursor: 'grab', touchAction: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              }}
            >
              <span style={{
                width: on ? 18 : 15, height: on ? 18 : 15, marginTop: on ? 0 : 2, borderRadius: '50%', background: paletteCss({ stops: [s], style: 'gradient' }),
                boxShadow: `0 0 0 2px ${on ? tk.accent.base : tk.bg.panel}, 0 1px 3px ${alpha('#000000', 0.35)}`,
              }} />
            </button>
          );
        })}
      </div>

      {/* The chosen stop */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ColorSwatch label={`Stop ${selected + 1}`} value={stops[selected].color} size="sm" onChange={c => set(stops.map((x, j) => (j === selected ? { ...x, color: c } : x)))} />
        <Field aria-label="Where this stop sits (%)" height={28} style={{ width: 76 }} suffix="%" inputMode="numeric"
          value={String(Math.round(stops[selected].pos * 100))}
          onChange={e => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; const s2 = { ...stops[selected], pos: Math.max(0, Math.min(1, v / 100)) }; set(stops.map((x, j) => (j === selected ? s2 : x)), s2); }} />
        <IconButton icon="trash" label="Remove this stop" size="sm" disabled={stops.length <= 2} onClick={() => { set(stops.filter((_, j) => j !== selected)); setSel(Math.max(0, selected - 1)); }} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="plus" disabled={stops.length >= max} title={stops.length >= max ? `${max} stops at most` : 'Add a stop halfway to the next one'}
          onClick={() => { const a = stops[selected], b = stops[selected + 1] ?? stops[selected - 1] ?? a; addAt((a.pos + b.pos) / 2 || 0.5); }}>Stop</Button>
        <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{stops.length} of {max}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Segmented<'gradient' | 'bands'> size="sm" ariaLabel="Blend" value={fill.style} onChange={style => onChange({ ...fill, stops, style })} options={[
          { value: 'gradient', label: 'Smooth', title: 'Blend from stop to stop' },
          { value: 'bands', label: 'Bands', title: 'Each colour holds until the next stop: hard edges' },
        ]} />
        {showAngle && (
          <>
            <div role="radiogroup" aria-label="Direction" style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: radius.md, background: tk.bg.field }}>
              {ANGLES.map(o => {
                const on = Math.round(fill.angle) === o.a;
                return (
                  <button key={o.a} type="button" role="radio" aria-checked={on} title={o.title} onClick={() => onChange({ ...fill, stops, angle: o.a })}
                    style={{ width: compact ? 32 : 26, height: compact ? 30 : 24, border: 0, borderRadius: 6, cursor: 'pointer', background: on ? tk.bg.panel : 'transparent', color: on ? tk.text.primary : tk.text.muted, font: `600 13px ${fontFamily.ui}`, boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none' }}>{o.label}</button>
                );
              })}
            </div>
            <Field aria-label="Angle in degrees" height={28} style={{ width: 72 }} suffix="°" inputMode="numeric" value={String(Math.round(fill.angle))}
              onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange({ ...fill, stops, angle: ((v % 360) + 360) % 360 }); }} />
          </>
        )}
      </div>
    </div>
  );
}

/** A small preview of a fill (CSS's gradient angles are the kit's, so it matches the picture). */
export function FillPreview({ fill, width = 64, height = 36 }: { fill: EditableFill; width?: number; height?: number }) {
  return <span style={{ width, height, flexShrink: 0, borderRadius: radius.sm, background: paletteCss(fill), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}` }} />;
}

/** Make a new library palette, or change one of yours. */
export function PaletteEditor({ initial, compact, onClose, onSaved }: { initial: Palette | null; compact: boolean; onClose: () => void; onSaved?: (p: Palette) => void }) {
  const tk = useTokens();
  const [name, setName] = useState(initial?.name ?? freePaletteName('My palette'));
  const [fill, setFill] = useState<EditableFill>(() => initial
    ? { stops: initial.stops, style: initial.style, angle: initial.angle ?? 180 }
    : { stops: [{ pos: 0, color: [0.1, 0.1, 0.18] }, { pos: 0.5, color: [0.45, 0.28, 0.6] }, { pos: 1, color: [0.96, 0.7, 0.5] }], style: 'gradient', angle: 180 });
  const save = () => {
    try {
      const p = savePalette({ id: initial?.id, createdAt: initial?.createdAt, name: name.trim() || 'Palette', stops: fill.stops, style: fill.style, angle: fill.angle, folderId: initial?.folderId });
      toast.success(`Saved “${p.name}”`);
      onSaved?.(p);
      onClose();
    } catch (e) { toast.error('Couldn’t save the palette', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: compact ? '4px 0 8px' : '16px 20px' }}>
      <div style={{ height: 96, borderRadius: radius.lg, background: paletteCss(fill), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.1)}` }} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>Name</span>
        <Field value={name} onChange={e => setName(e.target.value)} aria-label="Palette name" />
      </label>
      <FillEditor fill={fill} onChange={setFill} compact={compact} />
    </div>
  );
  const actions = (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon="save" onClick={save}>{initial ? 'Save changes' : 'Save palette'}</Button>
    </>
  );
  if (compact) {
    return (
      <Sheet title={initial ? `Edit “${initial.name}”` : 'New palette'} onClose={onClose} maxHeight="90dvh">
        {body}
        <div style={{ display: 'flex', gap: 8, padding: '6px 0 4px' }}>{actions}</div>
      </Sheet>
    );
  }
  return (
    <Modal title={initial ? `Edit “${initial.name}”` : 'New palette'} icon="spark" onClose={onClose} width={460} footer={actions}>
      {body}
    </Modal>
  );
}
