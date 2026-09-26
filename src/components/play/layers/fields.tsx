/**
 * fields.tsx — the building blocks every layer editor uses. makeFieldKit()
 * returns row helpers bound to one layer: a numeric property (a ruler plus
 * the + that makes it a control; right-click or long-press it to make it a
 * control, drive it with a null or reset it), a colour, a segmented choice, a select, a
 * toggle, a layer picker and a note. Every label carries a tooltip.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { layerNumericProps, defaultLayer, layerTarget, type PlayControl, type PlayLayer } from '../../../types/play';
import { Button } from '../../ui/Button';
import { PARTICLE_PALETTES, paletteColour } from '../../../play/particle-sim.js';
import { IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';
import { ContextMenuArea } from '../../ui/ContextMenuArea';
import { pairedKey } from '../layerOps';

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
  /** A layer picker. With `create`, a null can be made from here: it is added and picked at once. */
  pick: (label: string, key: string, layers: ReadonlyArray<{ id: string; label: string }>, empty: string, hint?: string, create?: () => void) => ReactNode;
  palette: (key?: string) => ReactNode;
  note: (text: ReactNode) => ReactNode;
  /** Which control targets exist already (layer props and actions). */
  exposedTargets: Set<string>;
  /** Add a control as given (an action button, a script toggle) to the Play panel. */
  exposeControl: (control: PlayControl) => void;
}

export const BLENDS: Choice[] = [
  { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }, { value: 'overlay', label: 'Overlay' },
  { value: 'lighten', label: 'Lighten' }, { value: 'darken', label: 'Darken' }, { value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' }, { value: 'add', label: 'Add' },
];
export const BLEND_HINT = 'How the layer mixes with what is under it. Screen and Add glow; Multiply darkens.';

/** A touch-first screen (phones, tablets): no right-click to find the property menu with. */
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

const toHex = (v: RGB) => `#${v.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export function makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose, onExposeControl, onDriveNull }: {
  l: PlayLayer;
  tk: Tokens;
  touch: boolean;
  exposedTargets: Set<string>;
  set: (patch: Record<string, unknown>) => void;
  onExpose: (key: string) => void;
  onExposeControl: (control: PlayControl) => void;
  /** Make the property a control with a Null on the picture that drives it (its X/Y partner too). */
  onDriveNull?: (key: string) => void;
}): FieldKit {
  const rec = l as unknown as Record<string, unknown>;
  // Double-clicking a ruler puts it back to the layer kind's default.
  const defaults = defaultLayer(l.kind, '', '') as unknown as Record<string, unknown>;
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
    const def = layerNumericProps(l).find(d => d.key === key);
    if (!def) return null;
    const exposed = exposedTargets.has(layerTarget(l.id, key));
    const fallback = typeof defaults[key] === 'number' ? defaults[key] as number : undefined;
    // A slider a script declared may have no value yet (a file from before it was declared): show its low end rather than crash.
    const raw = get<number>(key);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : (fallback ?? def.min);
    const pair = pairedKey(key);
    const partner = pair && layerNumericProps(l).find(d => d.key === pair.other);
    const items = () => [
      { label: exposed ? 'Already a control' : 'Add to controls', icon: 'plus' as const, hint: exposed ? undefined : 'A slider on the panel; map anything onto it', disabled: exposed, onSelect: () => onExpose(key) },
      ...(onDriveNull ? [{
        label: partner ? `Drive ${pair.axis === 'x' ? def.label : partner.label} and ${pair.axis === 'x' ? partner.label : def.label} with a null` : 'Drive with a null',
        icon: 'target' as const,
        hint: 'A control, and a null on the picture that moves it: drag the dot',
        onSelect: () => onDriveNull(key),
      }] : []),
      'separator' as const,
      { label: 'Reset to default', icon: 'resetParams' as const, disabled: fallback === undefined || fallback === value, onSelect: () => set({ [key]: fallback }) },
    ];
    return (
      <ContextMenuArea key={`prop:${key}`} items={items} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {open => (
          <>
            {label(def.label, def.hint)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <RulerSlider value={value} min={def.min} max={def.max} step={def.step ?? 0.01} defaultValue={fallback} onChange={v => set({ [key]: v })} onType={v => set({ [key]: v })} ariaLabel={`${l.label} ${def.label}`} touch={touch} />
            </div>
            {touch || COARSE
              // No right-click on a phone or tablet: the + opens the same menu.
              ? <IconButton icon={exposed ? 'check' : 'plus'} label={`${def.label}: add to controls, or drive with a null`} size="sm" active={exposed} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); open(r.left, r.bottom + 4); }} />
              : <IconButton icon={exposed ? 'check' : 'plus'} label={exposed ? 'Already a control (right-click for more)' : `Make ${def.label} a control (right-click to drive it with a null)`} size="sm" active={exposed} disabled={exposed} onClick={() => onExpose(key)} />}
          </>
        )}
      </ContextMenuArea>
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
  const pick = (text: string, key: string, layers: ReadonlyArray<{ id: string; label: string }>, empty: string, hint?: string, create?: () => void) =>
    row(text, layers.length
      ? <Select
          ariaLabel={text}
          value={get<string>(key)}
          options={[{ value: '', label: 'Pick one' }, ...layers.map(x => ({ value: x.id, label: x.label })), ...(create ? [{ value: '__new', label: '+ New null here' }] : [])]}
          onChange={v => { if (v === '__new') create?.(); else set({ [key]: v }); }}
          height={26}
        />
      : create
        ? <Button size="sm" icon="plus" onClick={create}>Create a null</Button>
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
    exposedTargets, exposeControl: onExposeControl,
  };
}

