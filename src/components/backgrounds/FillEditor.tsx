/**
 * FillEditor — build a gradient or a palette's bands from colour stops: the
 * shared GradientStopsEditor (ui/GradientStopsEditor.tsx: a bar with the
 * stops built in, the chosen stop's colour and place under it), then Smooth
 * or Bands and the angle. At most `max` stops (Play's background keeps 8; the
 * Studio's Stops Palette uses the same bar with its own 32).
 *
 * PaletteEditor is the same editor in a window with a name, for making or
 * changing a library palette.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { GradientStopsEditor } from '../ui/GradientStopsEditor';
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { PLAY_FILL_STOPS_MAX, fitStops, type BackgroundFill } from '../../types/play';
import { freePaletteName, paletteCss, savePalette, type Palette } from '../../lib/backgroundLibrary';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <GradientStopsEditor stops={stops} max={max} style={fill.style} touch={compact} onChange={next => onChange({ ...fill, stops: next })} />

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
