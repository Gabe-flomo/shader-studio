/**
 * GradientSetting — a colour setting that can be Solid or a Gradient (docs/gradients.md).
 *
 *   [Solid | Gradient]   the switch, beside the setting's swatch
 *   gradient bar         2–8 stops: click to add, drag to move, click a handle for its colour
 *   Along · Blend        what drives it here (Height, Normal, UV X…) and Smooth / Linear / Constant
 *   Wrap | Mirror        a periodic driver (Angle) only: round the circle, or there and back
 *   From · To            the driver's values at the bar's two ends: small sliders (type past an end to widen
 *                        them). On a node card each is also a socket and a Play control target (its row carries
 *                        `data-param-key`, so right-click offers Add to Play); a wire there shows instead
 *   Presets ▾ / Save     the app's palettes (built in and yours, shared with the Palette nodes and
 *                        Play / Present backgrounds), Save as preset, rename or delete yours
 *
 * Pure UI over a ColourGradient; the node card (NodeGraph/GradientColourParam.tsx) and the Scene
 * Builder each map it onto their own data.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from './Button';
import { Segmented } from './Choice';
import { RulerSlider } from './RulerSlider';
import { GradientStopsEditor } from './GradientStopsEditor';
import { Menu, type MenuItem } from './Menu';
import { Select } from './Select';
import { askConfirm, askText } from './dialogStore';
import { toast } from './toastStore';
import { usePalettes } from '../backgrounds/useBackgrounds';
import { deletePalette, freePaletteName, renamePalette, savePalette, type Palette } from '../../lib/backgroundLibrary';
import {
  GRADIENT_DRIVERS, GRADIENT_MAX_STOPS, INTERP_OPTIONS, REPEAT_OPTIONS, evalGradient, gradientCssOf, isPeriodicDriver, normaliseStops, rangeSliderBounds,
  type ColourGradient, type GradientDriver, type GradientInterp, type GradientRepeat,
} from '../../lib/colourGradient';
import type { GradientStop } from './gradientStops';

export type ColourMode = 'solid' | 'gradient';

/** A Library palette as at most 8 gradient stops (resampled evenly when it has more). */
/** A strip of a palette's stops (a CSS background), for its row in the Presets menu. */
export const paletteSwatchCss = (p: Palette): string =>
  gradientCssOf({ stops: paletteAsGradientStops(p), interp: p.style === 'bands' ? 'constant' : 'linear' });

export function paletteAsGradientStops(p: Pick<Palette, 'stops' | 'style'>): GradientStop[] {
  const stops = p.stops.map(s => ({ pos: s.pos, color: [s.color[0], s.color[1], s.color[2]] as [number, number, number] }));
  if (stops.length <= GRADIENT_MAX_STOPS) return normaliseStops(stops);
  const interp: GradientInterp = p.style === 'bands' ? 'constant' : 'linear';
  return Array.from({ length: GRADIENT_MAX_STOPS }, (_, i) => {
    const t = i / (GRADIENT_MAX_STOPS - 1);
    return { pos: t, color: evalGradient(stops, t, interp) };
  });
}

export function ColourModeSwitch({ mode, onChange, label }: { mode: ColourMode; onChange: (m: ColourMode) => void; label: string }) {
  return (
    <Segmented<ColourMode> size="sm" ariaLabel={`${label}: solid colour or gradient`} value={mode} onChange={onChange}
      options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} />
  );
}

export function GradientSetting({ value, onChange, drivers, label, touch = false, rangeKeys, wired }: {
  value: ColourGradient;
  /** `structural`: the stop count, the driver, the blend or Wrap / Mirror changed (the shader is rebuilt); otherwise only live values. */
  onChange: (g: ColourGradient, structural: boolean) => void;
  drivers: readonly GradientDriver[];
  label: string;
  touch?: boolean;
  /** On a node card: the From / To param keys, set as each row's `data-param-key` (right-click → Add to Play). */
  rangeKeys?: { from: string; to: string };
  /** A wire into the From / To socket: shown in place of the slider (the wire wins). */
  wired?: { from?: ReactNode; to?: ReactNode };
}) {
  const tk = useTokens();
  const palettes = usePalettes();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const clearRef = useRef<HTMLElement | null>(null);

  const set = (patch: Partial<ColourGradient>) => {
    const next = { ...value, ...patch };
    const structural = next.stops.length !== value.stops.length || next.along !== value.along || next.interp !== value.interp || next.repeat !== value.repeat;
    onChange(next, structural);
  };
  const setAlong = (along: GradientDriver) => {
    const r = GRADIENT_DRIVERS[along].range;
    const { repeat: _r, ...rest } = value;
    onChange({ ...rest, along, from: r[0], to: r[1], ...(isPeriodicDriver(along) ? { repeat: value.repeat ?? 'wrap' } : {}) }, true);
  };
  const applyPalette = (p: Palette) => {
    const stops = paletteAsGradientStops(p);
    onChange({ ...value, stops, interp: p.style === 'bands' ? 'constant' : value.interp === 'constant' ? 'smooth' : value.interp }, true);
  };

  const openAt = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const builtIn = palettes.filter(p => p.preset);
  const yours = palettes.filter(p => !p.preset);
  const presetItems = (): MenuItem[] => [
    { heading: 'Built in' },
    ...builtIn.map(p => ({ label: p.name, icon: 'presets' as const, swatch: paletteSwatchCss(p), onSelect: () => applyPalette(p) })),
    { heading: 'Yours' },
    ...(yours.length ? yours.map(p => ({ label: p.name, icon: 'presets' as const, swatch: paletteSwatchCss(p), onSelect: () => applyPalette(p) }))
      : [{ label: 'None saved yet: use Save as preset', disabled: true, onSelect: () => {} }]),
    'separator',
    { label: 'Save as preset…', icon: 'plus' as const, onSelect: () => { void save(); } },
    ...(yours.length ? [
      { label: 'Rename a preset…', onSelect: () => setTimeout(() => setMenu(m => m && { ...m, items: yours.map(p => ({ label: `Rename “${p.name}”`, onSelect: () => { void rename(p); } })) }), 0) },
      { label: 'Delete a preset…', icon: 'trash' as const, onSelect: () => setTimeout(() => setMenu(m => m && { ...m, items: yours.map(p => ({ label: `Delete “${p.name}”`, danger: true, onSelect: () => { void remove(p); } })) }), 0) },
    ] : []),
  ];
  const save = async () => {
    const name = await askText('Save gradient as preset', { label: 'Name', initial: freePaletteName('My gradient'), confirmLabel: 'Save' });
    if (!name) return;
    try {
      const p = savePalette({ name, stops: normaliseStops(value.stops), style: value.interp === 'constant' ? 'bands' : 'gradient', angle: 90 });
      toast.success(`Saved “${p.name}”`, { message: 'Under Presets on every gradient colour, the Palette nodes, and Play and Present backgrounds.' });
    } catch (e) { toast.error('Couldn’t save the preset', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const rename = async (p: Palette) => {
    const name = await askText('Rename preset', { label: 'Name', initial: p.name, confirmLabel: 'Rename' });
    if (name && name !== p.name) renamePalette(p.id, name);
  };
  const remove = async (p: Palette) => {
    if (!(await askConfirm(`Delete the preset “${p.name}”?`, { confirmLabel: 'Delete', danger: true }))) return;
    deletePalette(p.id);
  };

  const info = GRADIENT_DRIVERS[value.along];
  const bounds = rangeSliderBounds(value.along);
  const periodic = isPeriodicDriver(value.along);
  const rangeRow = (which: 'from' | 'to') => (
    <div key={which} data-param-key={rangeKeys?.[which]} data-gradient-range={which} style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 28 }}
      title={which === 'from' ? `${info.hint} From is ${periodic ? 'where the bar starts' : 'the value at the bar\'s left end'}.` : periodic ? `${info.hint}` : `${info.hint} To is the value at the bar's right end.`}>
      <span style={{ ...labelStyle, width: 32 }}>{which === 'from' ? 'From' : periodic ? 'Span' : 'To'}</span>
      {wired?.[which]
        ? <div style={{ flex: 1, minWidth: 0 }}>{wired[which]}</div>
        : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <RulerSlider ariaLabel={`${label}: gradient ${which}`} value={value[which]} min={bounds.min} max={bounds.max} step={0.001}
              defaultValue={info.range[which === 'from' ? 0 : 1]} touch={touch} onChange={v => set({ [which]: v })} />
          </div>
        )}
    </div>
  );
  const labelStyle = { font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted, flexShrink: 0 } as const;

  return (
    <div ref={el => { clearRef.current = el?.closest<HTMLElement>('[data-node-id]') ?? null; }} data-gradient-setting={label}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <GradientStopsEditor stops={value.stops} min={2} max={GRADIENT_MAX_STOPS} style={value.interp === 'constant' ? 'bands' : 'gradient'}
        touch={touch} clearRef={clearRef} barHeight={touch ? 36 : 26}
        onChange={stops => set({ stops: normaliseStops(stops) })} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={labelStyle}>Along</span>
        <Select ariaLabel={`${label}: gradient along`} value={value.along} height={28} style={{ flex: 1, minWidth: 0 }}
          options={drivers.map(d => ({ value: d, label: GRADIENT_DRIVERS[d].label }))} onChange={v => setAlong(v as GradientDriver)} />
        <Select ariaLabel={`${label}: blend`} value={value.interp} height={28} style={{ width: 96, flexShrink: 0 }}
          options={INTERP_OPTIONS} onChange={v => set({ interp: v as GradientInterp })} />
      </div>
      {periodic && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} title={REPEAT_OPTIONS.map(o => `${o.label}: ${o.hint}`).join('\n')}>
          <span style={{ ...labelStyle, width: 32 }}>Ends</span>
          <Segmented<GradientRepeat> size="sm" ariaLabel={`${label}: wrap or mirror`} value={value.repeat ?? 'wrap'} onChange={repeat => set({ repeat })}
            options={REPEAT_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
        </div>
      )}
      {rangeRow('from')}
      {rangeRow('to')}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="sm" variant="secondary" onClick={e => openAt(e, presetItems())} aria-haspopup="menu">Presets ▾</Button>
        <Button size="sm" variant="ghost" onClick={() => { void save(); }}>Save as preset</Button>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} title={`${label}: presets`} />}
    </div>
  );
}

/** A small read-only strip of a gradient (for a folded row or a list). */
export function GradientStrip({ value, width = 64, height = 18 }: { value: Pick<ColourGradient, 'stops' | 'interp'> & Partial<Pick<ColourGradient, 'along' | 'repeat'>>; width?: number | string; height?: number }) {
  return <span style={{ display: 'inline-block', width, height, borderRadius: 4, background: gradientCssOf(value), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} />;
}

