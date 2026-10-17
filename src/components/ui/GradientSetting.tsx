/**
 * GradientSetting — a colour setting that can be Solid or a Gradient (docs/gradients.md).
 *
 *   [Solid | Gradient]   the switch, beside the setting's swatch
 *   gradient bar         2–8 stops: click to add, drag to move, click a handle for its colour
 *   Along · Blend        what drives it here (Height, Normal, UV X…) and Smooth / Linear / Constant
 *   From · To            the driver's values at the bar's two ends
 *   Presets ▾ / Save     the app's palettes (built in and yours, shared with the Palette nodes and
 *                        Play / Present backgrounds), Save as preset, rename or delete yours
 *
 * Pure UI over a ColourGradient; the node card (NodeGraph/GradientColourParam.tsx) and the Scene
 * Builder each map it onto their own data.
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from './Button';
import { Segmented } from './Choice';
import { Field } from './Field';
import { GradientStopsEditor } from './GradientStopsEditor';
import { Menu, type MenuItem } from './Menu';
import { Select } from './Select';
import { askConfirm, askText } from './dialogStore';
import { toast } from './toastStore';
import { usePalettes } from '../backgrounds/useBackgrounds';
import { deletePalette, freePaletteName, renamePalette, savePalette, type Palette } from '../../lib/backgroundLibrary';
import {
  GRADIENT_DRIVERS, GRADIENT_MAX_STOPS, INTERP_OPTIONS, evalGradient, gradientCssOf, normaliseStops,
  type ColourGradient, type GradientDriver, type GradientInterp,
} from '../../lib/colourGradient';
import type { GradientStop } from './gradientStops';

export type ColourMode = 'solid' | 'gradient';

/** A Library palette as at most 8 gradient stops (resampled evenly when it has more). */
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

export function GradientSetting({ value, onChange, drivers, label, touch = false }: {
  value: ColourGradient;
  /** `structural`: the stop count, the driver or the blend changed (the shader is rebuilt); otherwise only live values. */
  onChange: (g: ColourGradient, structural: boolean) => void;
  drivers: readonly GradientDriver[];
  label: string;
  touch?: boolean;
}) {
  const tk = useTokens();
  const palettes = usePalettes();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const clearRef = useRef<HTMLElement | null>(null);
  const [fromText, setFromText] = useState<string | null>(null);
  const [toText, setToText] = useState<string | null>(null);

  const set = (patch: Partial<ColourGradient>) => {
    const next = { ...value, ...patch };
    const structural = next.stops.length !== value.stops.length || next.along !== value.along || next.interp !== value.interp;
    onChange(next, structural);
  };
  const setAlong = (along: GradientDriver) => {
    const r = GRADIENT_DRIVERS[along].range;
    onChange({ ...value, along, from: r[0], to: r[1] }, true);
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
    ...builtIn.map(p => ({ label: p.name, icon: 'presets' as const, onSelect: () => applyPalette(p) })),
    { heading: 'Yours' },
    ...(yours.length ? yours.map(p => ({ label: p.name, icon: 'presets' as const, onSelect: () => applyPalette(p) }))
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

  const num = (text: string | null, v: number) => text ?? String(Math.round(v * 1000) / 1000);
  const commitNum = (which: 'from' | 'to', text: string) => {
    const n = Number(text);
    if (Number.isFinite(n) && text.trim() !== '') set({ [which]: n });
  };
  const info = GRADIENT_DRIVERS[value.along];
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
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} title={`${info.hint} From is the value at the bar's left end, To at its right end.`}>
        <span style={labelStyle}>From</span>
        <Field aria-label={`${label}: gradient from`} mono height={28} value={num(fromText, value.from)} style={{ flex: 1 }}
          onChange={e => { setFromText(e.target.value); commitNum('from', e.target.value); }} onBlur={() => setFromText(null)} />
        <span style={labelStyle}>To</span>
        <Field aria-label={`${label}: gradient to`} mono height={28} value={num(toText, value.to)} style={{ flex: 1 }}
          onChange={e => { setToText(e.target.value); commitNum('to', e.target.value); }} onBlur={() => setToText(null)} />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="sm" variant="secondary" onClick={e => openAt(e, presetItems())} aria-haspopup="menu">Presets ▾</Button>
        <Button size="sm" variant="ghost" onClick={() => { void save(); }}>Save as preset</Button>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} title={`${label}: presets`} />}
    </div>
  );
}

/** A small read-only strip of a gradient (for a folded row or a list). */
export function GradientStrip({ value, width = 64, height = 18 }: { value: Pick<ColourGradient, 'stops' | 'interp'>; width?: number | string; height?: number }) {
  return <span style={{ display: 'inline-block', width, height, borderRadius: 4, background: gradientCssOf(value), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} />;
}

