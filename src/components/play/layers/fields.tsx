/**
 * fields.tsx — the building blocks every layer editor uses. makeFieldKit()
 * returns row helpers bound to one layer: a numeric property (a ruler plus
 * the + that makes it a control), a colour, a segmented choice, a select, a
 * toggle, a layer picker and a note. Every label carries a tooltip.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { LAYER_NUMERIC_PROPS, layerTarget, type PlayLayer } from '../../../types/play';
import { PARTICLE_PALETTES, paletteColour } from '../../../play/particle-sim.js';
import { IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';

type Tokens = ReturnType<typeof useTokens>;
type RGB = [number, number, number];
export interface Choice<V extends string = string> { value: V; label: string; title?: string }

export interface FieldKit {
  l: PlayLayer;
  tk: Tokens;
  numStyle: React.CSSProperties;
  set: (patch: Partial<PlayLayer> | Record<string, unknown>) => void;
  get: <T = unknown>(key: string) => T;
  prop: (key: string) => ReactNode;
  props: (...keys: string[]) => ReactNode;
  row: (label: string, children: ReactNode, hint?: string) => ReactNode;
  colour: (label: string, key: string, hint?: string) => ReactNode;
  seg: (label: string, key: string, options: Choice[], hint?: string) => ReactNode;
  select: (label: string, key: string, options: Choice[], hint?: string) => ReactNode;
  toggle: (label: string, key: string, text: string, hint?: string) => ReactNode;
  pick: (label: string, key: string, layers: ReadonlyArray<{ id: string; label: string }>, empty: string, hint?: string) => ReactNode;
  palette: (key?: string) => ReactNode;
  note: (text: ReactNode) => ReactNode;
}

export const BLENDS: Choice[] = [
  { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }, { value: 'overlay', label: 'Overlay' },
  { value: 'lighten', label: 'Lighten' }, { value: 'darken', label: 'Darken' }, { value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' }, { value: 'add', label: 'Add' },
];
export const BLEND_HINT = 'How the layer mixes with what is under it. Screen and Add glow; Multiply darkens.';

const toHex = (v: RGB) => `#${v.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export function makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose }: {
  l: PlayLayer;
  tk: Tokens;
  touch: boolean;
  exposedTargets: Set<string>;
  set: (patch: Record<string, unknown>) => void;
  onExpose: (key: string) => void;
}): FieldKit {
  const rec = l as unknown as Record<string, unknown>;
  const get = <T,>(key: string) => rec[key] as T;
  const numStyle: React.CSSProperties = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  const labelStyle: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62, flexShrink: 0, display: 'inline-block' };
  const label = (text: string, hint?: string) => hint
    ? <Tooltip label={text} description={hint} placement="top"><span style={{ ...labelStyle, cursor: 'help' }}>{text}</span></Tooltip>
    : <span style={labelStyle}>{text}</span>;
  const row = (text: string, children: ReactNode, hint?: string) => (
    <div key={`row:${text}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {label(text, hint)}
      {children}
    </div>
  );
  const prop = (key: string) => {
    const def = LAYER_NUMERIC_PROPS[l.kind].find(d => d.key === key);
    if (!def) return null;
    const value = get<number>(key);
    const exposed = exposedTargets.has(layerTarget(l.id, key));
    return (
      <div key={`prop:${key}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {label(def.label, def.hint)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider value={value} min={def.min} max={def.max} step={def.step ?? 0.01} defaultValue={value} onChange={v => set({ [key]: v })} onType={v => set({ [key]: v })} ariaLabel={`${l.label} ${def.label}`} touch={touch} />
        </div>
        <IconButton icon={exposed ? 'check' : 'plus'} label={exposed ? 'Already a control' : `Make ${def.label} a control (then map anything onto it)`} size="sm" active={exposed} disabled={exposed} onClick={() => onExpose(key)} />
      </div>
    );
  };
  const colour = (text: string, key: string, hint?: string) => {
    const hex = toHex(get<RGB>(key));
    return row(text, (
      <label style={{ position: 'relative', width: 44, height: 26, borderRadius: radius.md, background: hex, boxShadow: `inset 0 0 0 1px ${alpha('#888888', 0.45)}`, cursor: 'pointer' }}>
        <input type="color" aria-label={`${l.label} ${text}`} value={hex} onChange={e => set({ [key]: fromHex(e.target.value) })} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    ), hint);
  };
  const seg = (text: string, key: string, options: Choice[], hint?: string) =>
    row(text, <Segmented size="sm" ariaLabel={text} value={get<string>(key)} options={options} onChange={v => set({ [key]: v })} />, hint);
  const select = (text: string, key: string, options: Choice[], hint?: string) =>
    row(text, <Select ariaLabel={text} value={String(get(key))} options={options} onChange={v => set({ [key]: v })} height={26} />, hint);
  const toggle = (text: string, key: string, what: string, hint?: string) =>
    row(text, <Toggle checked={get<boolean>(key)} onChange={v => set({ [key]: v })} label={what} />, hint);
  const pick = (text: string, key: string, layers: ReadonlyArray<{ id: string; label: string }>, empty: string, hint?: string) =>
    row(text, layers.length
      ? <Select ariaLabel={text} value={get<string>(key)} options={[{ value: '', label: 'Pick one' }, ...layers.map(x => ({ value: x.id, label: x.label }))]} onChange={v => set({ [key]: v })} height={26} />
      : <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{empty}</span>, hint);
  const swatch = (i: number) => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${paletteColour(i, t).map(v => Math.round(v * 255)).join(',')})`).join(',')})`;
  const palette = (key = 'palette') => row('Palette', (
    <>
      <Select ariaLabel="Palette" value={String(get<number>(key))} height={26} options={PARTICLE_PALETTES.map((pl, i) => ({ value: String(i), label: pl.name }))} onChange={v => set({ [key]: Number(v) })} />
      <span style={{ width: 64, height: 14, borderRadius: 4, background: swatch(get<number>(key)), boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}` }} />
    </>
  ), 'Cosine palettes: colour = a + b·cos(2π(c·t + d)).');
  const note = (text: ReactNode) => <div style={{ margin: '6px 0 0 68px', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{text}</div>;
  return {
    l, tk, numStyle, get, set: p => set(p as Record<string, unknown>),
    prop, props: (...keys) => keys.map(prop), row, colour, seg, select, toggle, pick, palette, note,
  };
}

