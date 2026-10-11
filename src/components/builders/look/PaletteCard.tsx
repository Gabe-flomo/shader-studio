/**
 * PaletteCard and SlotColourRow — the scene builders' palette (builders/look/palette.ts).
 *
 *  - PaletteCard: the scene's palette as a swatch strip, the app's palettes (and the ones saved
 *    in the palette library) as strips to pick from, and "Make your own": a bar of colour stops to
 *    add, remove, drag and recolour, saved to the palette library on request.
 *  - SlotColourRow: a colour that is either a slot of that palette (a swatch button each) or a free
 *    colour, for the background and each shape.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { ColorSwatch } from '../../ui/ColorPicker';
import { Field } from '../../ui/Field';
import { GradientStopsEditor } from '../../ui/GradientStopsEditor';
import { evenStops } from '../../ui/gradientStops';
import { toast } from '../../ui/toastStore';
import { BuilderLabel, BuilderNote } from '../BuilderWindow';
import { Row } from '../../sceneBuilder/controls';
import { PALETTE_PRESETS_CHANGED, loadPalettePresets, savePalettePreset, type PalettePresetRecord } from '../../../lib/palette';
import {
  CUSTOM_PALETTE, LIBRARY_PALETTES, MAX_SWATCHES, librarySwatches, paletteLabel, paletteSwatches, savedSwatches, slotColour, swatchGradient, type Vec3,
} from '../../../builders/look/palette';
import { tileName } from '../../ui/textFit';

const css = (c: Vec3) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;

/** A palette as a strip of its swatches (a button when it can be picked). */
function Strip({ colours, label, selected, onPick, testId }: { colours: readonly Vec3[]; label: string; selected?: boolean; onPick?: () => void; testId?: string }) {
  const tk = useTokens();
  const body = (
    <>
      <span style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        {colours.map((c, i) => <span key={i} style={{ flex: 1, background: css(c) }} />)}
      </span>
      <span data-tile-name title={label} style={{ fontSize: 11, color: selected ? tk.accent.text : tk.text.muted, ...tileName }}>{label}</span>
    </>
  );
  const style = {
    display: 'flex', flexDirection: 'column' as const, gap: 3, padding: 4, borderRadius: radius.sm, minWidth: 0, textAlign: 'left' as const,
    border: 0, background: selected ? alpha(tk.accent.base, 0.12) : 'transparent', boxShadow: selected ? `inset 0 0 0 1px ${tk.accent.base}` : 'none', cursor: onPick ? 'pointer' : 'default',
  };
  return onPick
    ? <button type="button" data-palette-strip={testId ?? label} title={`Use ${label}`} onClick={onPick} style={style}>{body}</button>
    : <div style={style}>{body}</div>;
}

export interface PaletteValue { key: string; custom?: Vec3[] | null; customName?: string | null }

/** The palette library's saved palettes, kept fresh. */
function useSavedPalettes(): PalettePresetRecord[] {
  const [list, setList] = useState(() => loadPalettePresets());
  useEffect(() => {
    const on = () => setList(loadPalettePresets());
    window.addEventListener(PALETTE_PRESETS_CHANGED, on);
    return () => window.removeEventListener(PALETTE_PRESETS_CHANGED, on);
  }, []);
  return list;
}

/**
 * The palette picker and maker. `onChange` gets the whole palette; `key` coalesces a drag of the
 * stops into one undo step.
 */
export function PaletteCardBody({ value, onChange }: { value: PaletteValue; onChange: (v: PaletteValue, key?: string) => void }) {
  const tk = useTokens();
  const saved = useSavedPalettes();
  const swatches = paletteSwatches(value.key, value.custom);
  const own = value.key === CUSTOM_PALETTE;
  const [making, setMaking] = useState(own);
  const [name, setName] = useState(value.customName ?? '');
  useEffect(() => { setName(value.customName ?? ''); }, [value.customName]);
  const startOwn = () => { setMaking(true); onChange({ key: CUSTOM_PALETTE, custom: swatches.slice(0, MAX_SWATCHES), customName: own ? value.customName : `${paletteLabel(value.key)} (mine)` }); };
  const save = () => {
    const nm = name.trim() || 'Scene palette';
    const r = savePalettePreset({ name: nm, kind: 'stops', stops: swatches.map(c => [...c] as Vec3), wrap: 'clamp', blend: 'linear' });
    if (r.ok) { toast.success(`Saved “${nm}” to the palette library`); onChange({ ...value, customName: nm }); }
    else toast.error('The palette could not be saved', { message: r.error });
  };
  return (
    <div data-palette-card style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div data-palette-current style={{ height: 26, borderRadius: radius.sm, background: swatchGradient(swatches), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {swatches.map((c, i) => (
          <span key={i} title={`Slot ${i + 1}`} style={{ flex: 1, height: 22, borderRadius: 4, background: css(c), display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 10px ${fontFamily.mono}`, color: c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 > 0.55 ? '#000a' : '#fffb' }}>{i + 1}</span>
        ))}
      </div>
      <BuilderNote>Its colours are slots: the background and each shape can take one (Colour → a numbered swatch), so picking another palette recolours all of them. Colour by uses it too.</BuilderNote>
      <BuilderLabel>The app's palettes</BuilderLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 4 }}>
        {LIBRARY_PALETTES.map(p => <Strip key={p.key} testId={p.key} colours={librarySwatches(p)} label={p.label} selected={value.key === p.key} onPick={() => { setMaking(false); onChange({ key: p.key, custom: null, customName: null }); }} />)}
      </div>
      {saved.length > 0 && (
        <>
          <BuilderLabel>Saved in the palette library</BuilderLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 4 }}>
            {saved.map(p => <Strip key={p.id} testId={`saved:${p.name}`} colours={savedSwatches(p)} label={p.name} selected={own && value.customName === p.name}
              onPick={() => { setMaking(true); onChange({ key: CUSTOM_PALETTE, custom: savedSwatches(p), customName: p.name }); }} />)}
          </div>
        </>
      )}
      {!making && <Button size="sm" variant="ghost" icon="plus" onClick={startOwn} data-palette-make>Make your own from this one</Button>}
      {making && (
        <div data-palette-maker style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
          <BuilderLabel>Your palette</BuilderLabel>
          <GradientStopsEditor stops={evenStops(swatches)} max={MAX_SWATCHES} fixedSpacing label="Colour"
            onChange={stops => onChange({ key: CUSTOM_PALETTE, custom: stops.map(s => [s.color[0], s.color[1], s.color[2]] as Vec3), customName: value.customName ?? name }, 'palette:stops')} />
          <BuilderNote>Click the bar to add a colour, drag one to move it along, click one to change it, Backspace to remove it (2 to {MAX_SWATCHES}).</BuilderNote>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Field aria-label="Palette name" placeholder="Name" value={name} onChange={e => setName(e.target.value)} onBlur={() => own && onChange({ ...value, customName: name.trim() || null })} style={{ flex: 1 }} />
            <Button size="sm" icon="save" onClick={save} disabled={!own} data-palette-save>Save to library</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A colour from the palette or a free one: the palette's slots as swatches (the chosen one ringed)
 * and a free colour swatch beside them.
 */
export function SlotColourRow({ label, hint, value, slot, swatches, onColour, onSlot }: {
  label: string; hint?: string; value: Vec3; slot: number | null | undefined; swatches: readonly Vec3[];
  onColour: (c: Vec3) => void; onSlot: (slot: number | null) => void;
}) {
  const tk = useTokens();
  const free = slot == null;
  const shown = free ? value : slotColour(swatches, slot);
  return (
    <Row label={label} hint={hint ?? 'A slot of the scene\'s palette (Look → Palette), so changing the palette recolours it; or a free colour of its own.'}>
      <div data-slot-row={label} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {swatches.map((c, i) => {
          const on = !free && ((Math.round(slot!) % swatches.length) + swatches.length) % swatches.length === i;
          return (
            <button key={i} type="button" data-slot={i + 1} aria-pressed={on} title={`Palette slot ${i + 1}`} onClick={() => onSlot(i)}
              style={{ width: 22, height: 22, borderRadius: 5, border: 0, padding: 0, cursor: 'pointer', background: css(c), boxShadow: on ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 3.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}` }} />
          );
        })}
        <span style={{ width: 1, height: 18, background: tk.border.subtle, margin: '0 3px' }} />
        <span title="A free colour" style={{ display: 'flex', alignItems: 'center', borderRadius: 6, boxShadow: free ? `0 0 0 1.5px ${tk.accent.base}` : 'none' }}>
          <ColorSwatch value={shown} label={`${label}: a free colour`} size="sm" showHex={free}
            onChange={rgb => { onColour([rgb[0], rgb[1], rgb[2]]); if (!free) onSlot(null); }} />
        </span>
      </div>
    </Row>
  );
}
