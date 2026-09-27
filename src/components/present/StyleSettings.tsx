/**
 * StyleSettings — how a presentation looks, in the Present page's settings
 * panel (types/presentationStyle.ts has the model):
 *
 *   StepBackgroundSettings      this step's background: the presentation's
 *                               (Default), None, Colour, Gradient or Image,
 *                               and its legibility effects
 *   PresentationStyleSettings   the background every step shows unless it
 *                               sets its own; typography (Google Fonts for
 *                               headings, body and code, embedded; size, line
 *                               height, colours) with a live specimen; and
 *                               what the embedded images and fonts weigh
 *
 * Changes show at once in the step in the middle (and in Slides and Scroll).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useTokens, useThemeStore } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { ColorSwatch } from '../ui/ColorPicker';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { Sheet } from '../ui/Sheet';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { FillEditor } from '../backgrounds/FillEditor';
import { openBackgrounds, openCapture } from '../backgrounds/backgroundsUi';
import { usePalettes } from '../backgrounds/useBackgrounds';
import { freePaletteName, paletteCss, paletteFill, savePalette, PALETTE_PRESETS } from '../../lib/backgroundLibrary';
import { PLAY_FILL_STOPS_MAX, fitStops } from '../../types/play';
import {
  DARK_BELOW, IMAGE_EFFECTS, LINE_HEIGHT_RANGE, luminance, SCALE_RANGE, STYLE_WARN_BYTES, DEFAULT_LINE_HEIGHT, fontStack, resolveBackground, sizeLabel, stepLook, styleBytes,
  type FontCategory, type FontRole, type FontRoleName, type PresentBackground, type PresentImage, type RGB,
} from '../../types/presentationStyle';
import { FONT_CATEGORIES, GOOGLE_FONTS, findFont, nearestWeight, previewCssUrl, type GoogleFont } from '../../present/googleFonts';
import { IMAGE_ACCEPT } from '../play/backgroundFiles';
import { paperStyle } from './paper';
import { Backdrop } from './Backdrop';
import { lookVars, useImageMap, useStepLook, useTypeVars } from './presentLook';
import { Row, Section } from './InspectorParts';
import { usePresentation } from './presentationStore';
import {
  applyImage, chooseFont, fontBusy, onFontBusy, patchTypography, presentImageFromFile, presentImageFromLibrary, setDefaultBackground, setStepBackground,
} from './styleActions';

type Kind = 'default' | PresentBackground['kind'];

const KIND_LABEL: Record<Kind, string> = { default: 'Default', none: 'None', colour: 'Colour', fill: 'Gradient', image: 'Image' };
const pct = (v: number | undefined) => Math.round((v ?? 0) * 100);

// ── A background, edited ────────────────────────────────────────────────────

/** A small picture of a background (for the kind tiles). */
function Swatch({ bg, images, style }: { bg: PresentBackground | null; images: ReadonlyMap<string, PresentImage>; style?: CSSProperties }) {
  const tk = useTokens();
  const dark = useThemeStore(s => s.mode) === 'dark';
  const base: CSSProperties = { borderRadius: 6, boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, ...style };
  if (!bg) return <span style={{ ...base, ...paperStyle(tk.bg.app, dark) }} />;
  if (bg.kind === 'colour' && bg.colour) return <span style={{ ...base, background: `rgb(${bg.colour.map(c => Math.round(c * 255)).join(' ')})` }} />;
  if (bg.kind === 'fill' && bg.fill) return <span style={{ ...base, background: paletteCss(bg.fill) }} />;
  const img = bg.image ? images.get(bg.image) : undefined;
  if (bg.kind === 'image' && img) return <span style={{ ...base, backgroundImage: `url("${img.src}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />;
  return <span style={{ ...base, background: tk.bg.field, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint }}><Icon name="overlay" size={14} /></span>;
}

function KindTiles({ kinds, value, onPick, preview }: { kinds: Kind[]; value: Kind; onPick: (k: Kind) => void; preview: (k: Kind) => ReactNode }) {
  const tk = useTokens();
  return (
    <div role="radiogroup" aria-label="Background" style={{ display: 'grid', gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))`, gap: 6 }}>
      {kinds.map(k => {
        const on = k === value;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onPick(k)}
            title={k === 'default' ? 'The presentation’s background (set it under Style)' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5, padding: 4, border: 0, borderRadius: radius.md, cursor: 'pointer',
              background: on ? alpha(tk.accent.base, 0.1) : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
            }}>
            <span style={{ position: 'relative', display: 'flex', height: 30 }}>
              {preview(k)}
              {k === 'default' && <span style={{ position: 'absolute', right: 3, bottom: 3, width: 16, height: 16, borderRadius: 5, background: tk.bg.panel, color: tk.text.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: tk.shadow.float }}><Icon name="link" size={11} /></span>}
            </span>
            <span style={{ color: on ? tk.text.primary : tk.text.muted, font: `${on ? 650 : 550} 11px ${fontFamily.ui}`, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{KIND_LABEL[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A 0–100 % amount on the app's ruler slider. */
function Amount({ label, value, onChange, hint, disabled, defaultValue, compact }: { label: string; value: number | undefined; onChange: (v: number) => void; hint?: string; disabled?: boolean; defaultValue: number; compact: boolean }) {
  return (
    <Row label={label} hint={hint}>
      <RulerSlider ariaLabel={label} value={pct(value)} min={0} max={100} step={1} integer={false} defaultValue={Math.round(defaultValue * 100)} disabled={disabled} touch={compact} onChange={v => onChange(Math.max(0, Math.min(1, v / 100)))} />
    </Row>
  );
}

/** Where the image sits: a 3 × 3 grid of anchors. */
function PositionGrid({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const tk = useTokens();
  const at = [0, 0.5, 1];
  const names = [['Top left', 'Top', 'Top right'], ['Left', 'Centre', 'Right'], ['Bottom left', 'Bottom', 'Bottom right']];
  return (
    <div role="radiogroup" aria-label="Position" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 22px)', gap: 3, padding: 3, borderRadius: radius.md, background: tk.bg.field, width: 'max-content' }}>
      {at.map((y, r) => at.map((x, c) => {
        const on = Math.abs(value[0] - x) < 0.01 && Math.abs(value[1] - y) < 0.01;
        return (
          <button key={`${r}${c}`} type="button" role="radio" aria-checked={on} aria-label={names[r][c]} title={names[r][c]} onClick={() => onChange([x, y])}
            style={{ width: 22, height: 18, border: 0, padding: 0, borderRadius: 4, cursor: 'pointer', background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.14)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: on ? 7 : 4, height: on ? 7 : 4, borderRadius: '50%', background: on ? tk.accent.base : tk.text.faint }} />
          </button>
        );
      }))}
    </div>
  );
}

/**
 * The editor for one background. `value` undefined means the step uses the
 * presentation's (`inherited`); `forStep` offers Default.
 */
function BackgroundEditor({ value, inherited, forStep, compact, lightText, onChange }: {
  value: PresentBackground | undefined;
  inherited: PresentBackground | null;
  forStep: boolean;
  compact: boolean;
  /** Is the text over it light (so the shade darkens)? */
  lightText: boolean | null;
  onChange: (bg: PresentBackground | undefined) => void;
}) {
  const tk = useTokens();
  const images = useImageMap();
  const palettes = usePalettes();
  const fileRef = useRef<HTMLInputElement>(null);
  const imageMenuAnchor = useRef<HTMLDivElement>(null);
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Image was chosen but no picture yet: show where to get one before anything changes. */
  const [wantImage, setWantImage] = useState(false);
  const kind: Kind = wantImage ? 'image' : value === undefined ? (forStep ? 'default' : 'none') : value.kind;
  // What a new kind starts from: this background's settings, else the one it inherits.
  const from: PresentBackground = value ?? inherited ?? { kind: 'none' };
  const bg = value;

  const pick = (k: Kind) => {
    setWantImage(false);
    if (k === 'default') { onChange(undefined); return; }
    if (k === 'none') { onChange({ kind: 'none' }); return; }
    if (k === 'colour') { onChange({ ...from, kind: 'colour', colour: from.colour ?? [0.07, 0.075, 0.1] }); return; }
    if (k === 'fill') { onChange({ ...from, kind: 'fill', fill: from.fill ?? { ...paletteFill(PALETTE_PRESETS[0]) } }); return; }
    if (from.image && images.has(from.image)) { onChange({ ...from, kind: 'image' }); return; }
    setWantImage(true);
  };
  const withImage = async (get: () => Promise<PresentImage | null>) => {
    const stepIndex = usePresentation.getState().step;
    setBusy(true);
    try {
      const img = await get();
      if (!img) return;
      // A first picture starts readable: softened, and washed toward the text's opposite (light pictures need more of it).
      const light = !!img.avg && luminance(img.avg) >= DARK_BELOW;
      const base = from.kind === 'image' ? from : { ...from, ...(from.blur === undefined && from.shade === undefined ? { ...IMAGE_EFFECTS, shade: light ? 0.5 : IMAGE_EFFECTS.shade } : {}) };
      applyImage(img, (id, p) => {
        const next: PresentBackground = { ...base, kind: 'image', image: id };
        return forStep
          ? { ...p, steps: p.steps.map((s, i) => (i === stepIndex ? { ...s, background: next } : s)) }
          : { ...p, style: { ...p.style, background: next } };
      });
      setWantImage(false);
    } catch (e) {
      toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const fromLibrary = async () => {
    const p = await openBackgrounds({ pick: 'image', title: 'Choose an image background' });
    if (p?.kind === 'image') await withImage(() => presentImageFromLibrary(p.image.id));
  };
  const capture = async () => {
    const id = await openCapture({ aspect: 16 / 9 });
    if (id) await withImage(() => presentImageFromLibrary(id));
  };
  const saveAsPalette = async () => {
    const f = bg?.fill;
    if (!f) return;
    const n = await askText('Save as palette', { label: 'Name', initial: freePaletteName(f.name ?? 'My gradient'), confirmLabel: 'Save' });
    if (!n) return;
    try {
      const p = savePalette({ name: n, stops: f.stops, style: f.style, angle: f.angle });
      onChange({ ...bg, fill: { ...f, paletteId: p.id, name: p.name } });
      toast.success(`Saved “${p.name}”`, { message: 'In the Library’s backgrounds, under Palettes.' });
    } catch (e) { toast.error('Couldn’t save the palette', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const set = (patch: Partial<PresentBackground>) => { if (bg) onChange({ ...bg, ...patch }); };
  const kinds: Kind[] = forStep ? ['default', 'none', 'colour', 'fill', 'image'] : ['none', 'colour', 'fill', 'image'];
  const imageItems: MenuItem[] = [
    { label: 'Your backgrounds…', icon: 'overlay', hint: 'An image background from the Library', onSelect: () => void fromLibrary() },
    { label: 'Upload a file…', icon: 'import', hint: 'PNG, JPG or WebP (kept in the Library too)', onSelect: () => fileRef.current?.click() },
    { label: 'Capture from a graph…', icon: 'camera', hint: 'A still of any graph at the moment you choose', onSelect: () => void capture() },
  ];
  const img = bg?.kind === 'image' && bg.image ? images.get(bg.image) : undefined;
  const shadeLabel = lightText === false ? 'Lighten' : 'Darken';

  return (
    <>
      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void withImage(() => presentImageFromFile(f)); }} />
      <KindTiles kinds={kinds} value={kind} onPick={pick} preview={k => (
        <Swatch style={{ flex: 1 }} images={images}
          bg={k === 'default' ? inherited : k === 'none' ? null : k === kind && bg ? bg : k === 'colour' ? { kind: 'colour', colour: from.colour ?? [0.07, 0.075, 0.1] } : k === 'fill' ? { kind: 'fill', fill: from.fill ?? paletteFill(PALETTE_PRESETS[0]) } : from.image ? { kind: 'image', image: from.image } : { kind: 'image' }} />
      )} />

      {kind === 'default' && (
        <div style={{ color: tk.text.muted, font: `500 12px/1.5 ${fontFamily.ui}` }}>
          {inherited ? `The presentation’s background: ${KIND_LABEL[inherited.kind].toLowerCase()}. Change it under Style, or pick one for this step alone.` : 'The presentation has no background: the page and its paper grain. Pick one for this step, or for every step under Style.'}
        </div>
      )}

      {bg?.kind === 'colour' && bg.colour && (
        <ColorSwatch label="Background colour" value={bg.colour} onChange={c => set({ colour: c as RGB })} />
      )}

      {bg?.kind === 'fill' && bg.fill && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="listbox" aria-label="Palettes" style={{ display: 'flex', gap: 5, overflowX: 'auto', padding: '2px 2px 4px', minWidth: 0 }}>
            {[...palettes.filter(p => !p.preset), ...palettes.filter(p => p.preset)].slice(0, 20).map(p => {
              const on = bg.fill?.paletteId === p.id;
              return <button key={p.id} type="button" role="option" aria-selected={on} title={p.name} onClick={() => set({ fill: paletteFill(p) })}
                style={{ width: 34, height: 22, flexShrink: 0, borderRadius: 6, border: 0, padding: 0, cursor: 'pointer', background: paletteCss(p, 90), boxShadow: on ? `0 0 0 2px ${tk.bg.subtle}, 0 0 0 3.5px ${tk.accent.base}` : `inset 0 0 0 1px ${alpha('#000000', 0.14)}` }} />;
            })}
          </div>
          <FillEditor compact={compact} max={PLAY_FILL_STOPS_MAX} fill={bg.fill} onChange={f => set({ fill: { style: f.style, stops: fitStops(f.stops, PLAY_FILL_STOPS_MAX), angle: f.angle } })} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" icon="overlay" onClick={async () => { const pk = await openBackgrounds({ pick: 'palette', title: 'Choose a palette' }); if (pk?.kind === 'palette') set({ fill: paletteFill(pk.palette) }); }}>More palettes…</Button>
            <Button size="sm" variant="ghost" icon="save" onClick={() => void saveAsPalette()} title="Keep these colours in the Library, to use anywhere">Save as palette</Button>
          </div>
        </div>
      )}

      {kind === 'image' && (
        <div ref={imageMenuAnchor} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {img ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 96, aspectRatio: '16 / 9', flexShrink: 0, borderRadius: radius.md, backgroundImage: `url("${img.src}")`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}` }} />
              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span title={img.name} style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</span>
                <Button size="sm" icon="import" disabled={busy} style={{ alignSelf: 'flex-start' }}
                  onClick={() => { const r = imageMenuAnchor.current?.getBoundingClientRect(); setImageMenu({ x: r ? r.left : 16, y: r ? r.top + 64 : 80 }); }}>{busy ? 'Loading…' : 'Replace…'}</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: tk.text.muted, font: `500 12px ${fontFamily.ui}` }}>{busy ? 'Loading the picture…' : 'Choose a picture:'}</span>
              {imageItems.map(it => typeof it === 'object' && 'label' in it && (
                <Button key={it.label} size="sm" icon={it.icon} disabled={busy} onClick={it.onSelect} style={{ justifyContent: 'flex-start' }}>{it.label}</Button>
              ))}
            </div>
          )}
          {img && bg && (
            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Row label="Fit"><Segmented size="sm" ariaLabel="Fit" value={bg.fit ?? 'cover'} onChange={fit => set({ fit: fit === 'cover' ? undefined : fit })} options={[{ value: 'cover', label: 'Fill', title: 'Fill the page, cropping the picture' }, { value: 'contain', label: 'Fit inside', title: 'The whole picture, with its own colour around it' }]} /></Row>
              <Row label="Position"><PositionGrid value={bg.position ?? [0.5, 0.5]} onChange={v => set({ position: v[0] === 0.5 && v[1] === 0.5 ? undefined : v })} /></Row>
            </div>
          )}
        </div>
      )}

      {bg && bg.kind !== 'none' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, borderTop: `1px solid ${tk.border.subtle}` }}>
          <span style={{ color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Legibility</span>
          {bg.kind === 'image' && (
            <>
              <Amount compact={compact} label="Blur" value={bg.blur} defaultValue={IMAGE_EFFECTS.blur} onChange={blur => set({ blur })} />
              <Amount compact={compact} label="Falloff" value={bg.falloff} defaultValue={IMAGE_EFFECTS.falloff} disabled={!bg.blur} onChange={falloff => set({ falloff })}
                hint="The blur is strongest behind the text and fades toward the sides, so the picture stays sharp at the edges." />
            </>
          )}
          <Amount compact={compact} label={shadeLabel} value={bg.shade} defaultValue={bg.kind === 'image' ? IMAGE_EFFECTS.shade : 0} onChange={shade => set({ shade })}
            hint={lightText === false ? 'Dark text on this background: it lightens.' : 'Light text on this background: it darkens.'} />
          <Amount compact={compact} label="Vignette" value={bg.vignette} defaultValue={bg.kind === 'image' ? IMAGE_EFFECTS.vignette : 0} onChange={vignette => set({ vignette })} hint="The edges fade out." />
        </div>
      )}
      {imageMenu && <Menu x={imageMenu.x} y={imageMenu.y} minWidth={250} items={imageItems} onClose={() => setImageMenu(null)} />}
    </>
  );
}

// ── This step ───────────────────────────────────────────────────────────────

export function StepBackgroundSettings({ compact }: { compact: boolean }) {
  const index = usePresentation(s => s.step);
  const step = usePresentation(s => s.doc?.steps[s.step]);
  const style = usePresentation(s => s.doc?.style);
  const look = useStepLook(step);
  if (!step) return null;
  return (
    <Section title="Background">
      <BackgroundEditor key={step.id} forStep compact={compact} value={step.background} inherited={resolveBackground(style, undefined)} lightText={look.lightText}
        onChange={bg => setStepBackground(index, bg)} />
    </Section>
  );
}

// ── The presentation ────────────────────────────────────────────────────────

const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
const ROLES: Array<{ role: FontRoleName; label: string; sample: string }> = [
  { role: 'heading', label: 'Headings', sample: 'Step titles and # headings' },
  { role: 'body', label: 'Body', sample: 'Text, lists and captions' },
  { role: 'code', label: 'Code', sample: 'Code blocks and `inline code`' },
];

function useFontBusy(): string | null {
  return useSyncExternalStore(onFontBusy, fontBusy);
}

/** The picker's previews: each family drawn in itself (only the letters of the names, from Google, once). */
let previewLoaded = false;
function usePreviewFonts(): void {
  useEffect(() => {
    if (previewLoaded || typeof document === 'undefined') return;
    previewLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = previewCssUrl(GOOGLE_FONTS, `${GOOGLE_FONTS.map(f => f.family).join('')}Aa`);
    document.head.appendChild(link);
  }, []);
}

function FontPicker({ role, value, compact, anchorRef, onPick, onClose }: {
  role: FontRoleName; value: FontRole | undefined; compact: boolean; anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (f: GoogleFont | null) => void; onClose: () => void;
}) {
  const tk = useTokens();
  usePreviewFonts();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FontCategory | 'all'>(role === 'code' ? 'mono' : 'all');
  const list = GOOGLE_FONTS.filter(f => (cat === 'all' || f.category === cat) && f.family.toLowerCase().includes(q.trim().toLowerCase()));
  const chip = (id: FontCategory | 'all', label: string) => {
    const on = cat === id;
    return <button key={id} type="button" aria-pressed={on} onClick={() => setCat(id)} style={{ height: 26, padding: '0 10px', borderRadius: 13, border: 0, cursor: 'pointer', background: on ? tk.accent.base : tk.bg.field, color: on ? '#fff' : tk.text.secondary, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{label}</button>;
  };
  const row = (key: string, label: ReactNode, sub: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" role="option" aria-selected={on} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: compact ? 46 : 40, padding: '4px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', background: on ? alpha(tk.accent.base, 0.1) : 'transparent', color: tk.text.primary }}>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, flexShrink: 0 }}>{sub}</span>
      <span style={{ width: 14, flexShrink: 0, color: tk.accent.base }}>{on && <Icon name="check" size={14} />}</span>
    </button>
  );
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <Field autoFocus={!compact} height={32} value={q} placeholder="Search fonts" aria-label="Search fonts" leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} />
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>{chip('all', 'All')}{FONT_CATEGORIES.map(c => chip(c.id, c.label))}</div>
      <div role="listbox" aria-label="Fonts" style={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: compact ? undefined : 340, minHeight: 0 }}>
        {!q && row('system', <span style={{ font: `500 16px ${role === 'code' ? fontFamily.mono : fontFamily.ui}` }}>{role === 'code' ? 'System monospace' : 'System font'}</span>, 'no download', !value, () => onPick(null))}
        {list.map(f => row(f.family, <span style={{ font: `${f.category === 'display' || f.category === 'handwriting' ? 400 : 500} 17px ${fontStack(f)}` }}>{f.family}</span>, FONT_CATEGORIES.find(c => c.id === f.category)?.label ?? '', value?.family === f.family, () => onPick(f)))}
        {!list.length && <div style={{ padding: 16, color: tk.text.muted, font: `500 12px ${fontFamily.ui}`, textAlign: 'center' }}>No font called “{q}” in this list.</div>}
      </div>
      <div style={{ color: tk.text.faint, font: `500 11px/1.45 ${fontFamily.ui}` }}>From Google Fonts. The one you choose is downloaded once and kept in the presentation, so it works offline and in exported pages.</div>
    </div>
  );
  const title = `${ROLES.find(r => r.role === role)?.label} font`;
  if (compact) return <Sheet title={title} onClose={onClose} maxHeight="86dvh">{body}</Sheet>;
  return <Popover anchorRef={anchorRef} onClose={onClose} align="end" width={320} padding={12}>{body}</Popover>;
}

function FontRow({ role, label, sample, compact }: { role: FontRoleName; label: string; sample: string; compact: boolean }) {
  const tk = useTokens();
  const value = usePresentation(s => s.doc?.style?.typography?.[role]);
  const busy = useFontBusy();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const font = value ? findFont(value.family) : undefined;
  const loading = !!busy && (busy === value?.family || open);
  const pick = async (f: GoogleFont | null) => {
    setOpen(false);
    if (!f) { await chooseFont(role, null); return; }
    const weight = role === 'heading' ? nearestWeight(f, f.category === 'serif' || f.category === 'display' ? 600 : 700) : 400;
    const ok = await chooseFont(role, { family: f.family, category: f.category, weight });
    if (ok) toast.success(`${label}: ${f.family}`, { message: 'Downloaded from Google Fonts and kept in the presentation.' });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button ref={ref} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} title={sample}
          style={{ flex: 1, minWidth: 0, height: compact ? 40 : 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 10px', border: 0, borderRadius: radius.control, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary, boxShadow: open ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none' }}>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `${role === 'heading' ? value?.weight ?? 650 : 500} 14.5px ${value ? fontStack(value) : role === 'code' ? fontFamily.mono : fontFamily.ui}` }}>
            {loading && busy ? `Downloading ${busy}…` : value?.family ?? (role === 'code' ? 'System monospace' : 'System font')}
          </span>
          <Icon name="chevD" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
        </button>
        {role === 'heading' && value && font && font.weights.length > 1 && (
          <Select ariaLabel="Heading weight" height={compact ? 40 : 36} value={String(value.weight)} style={{ width: 118, flexShrink: 0 }}
            options={font.weights.map(w => ({ value: String(w), label: `${WEIGHT_NAMES[w] ?? w}` }))}
            onChange={w => void chooseFont('heading', { ...value, weight: Number(w) })} />
        )}
      </div>
      {open && <FontPicker role={role} value={value} compact={compact} anchorRef={ref} onPick={f => void pick(f)} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A live sample of the typography over this step's background. */
function Specimen() {
  const tk = useTokens();
  const step = usePresentation(s => s.doc?.steps[s.step]);
  const look = useStepLook(step);
  const vars = useTypeVars();
  const dark = useThemeStore(s => s.mode) === 'dark';
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, ...paperStyle(tk.bg.app, dark), ...vars, ...lookVars(look) }}>
      <Backdrop look={look} column={220} />
      <div style={{ position: 'relative', zIndex: 1, padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="pp-title" style={{ fontSize: 'calc(21px * var(--pp-scale, 1))' }}>{step?.title || 'A step title'}</div>
        <div className="pp-md" style={{ fontSize: 'calc(13.5px * var(--pp-scale, 1))' }}><p>Body text reads like this, with <strong>bold</strong>, <a>a link</a> and <code>code()</code>.</p></div>
      </div>
    </div>
  );
}

const rgbOf = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;

function ColourRow({ label, value, auto, onChange }: { label: string; value: RGB | undefined; auto: string; onChange: (c: RGB | undefined) => void }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 30 }}>
      <span style={{ flex: 1, color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>{label}</span>
      {value && <ColorSwatch size="sm" showHex={false} label={label} value={value} onChange={c => onChange(c as RGB)} />}
      <Toggle checked={!value} onChange={on => onChange(on ? undefined : rgbOf(/^#[0-9a-f]{6}$/i.test(auto) ? auto : '#202020'))} label="Automatic" />
    </div>
  );
}

export function PresentationStyleSettings({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const images = useImageMap();
  const stepIndex = usePresentation(s => s.step);
  const t = doc?.style?.typography;
  const bytes = useMemo(() => styleBytes(doc ?? {}), [doc]);
  if (!doc) return null;
  const defaultBg = doc.style?.background;
  const look = stepLook(doc.style, images, undefined);
  const overridden = doc.steps.filter(s => s.background).length;
  // The colours the open step shows now: what a colour starts from when Automatic is turned off.
  const stepText = stepLook(doc.style, images, doc.steps[stepIndex]).text;
  return (
    <>
      <Section title="Background of every step" extra={overridden ? <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>{overridden} step{overridden === 1 ? '' : 's'} set their own</span> : undefined}>
        <BackgroundEditor forStep={false} compact={compact} value={defaultBg ?? { kind: 'none' }} inherited={null} lightText={look.lightText} onChange={bg => setDefaultBackground(bg)} />
      </Section>
      <Section title="Typography">
        <Specimen />
        {ROLES.map(r => <FontRow key={r.role} role={r.role} label={r.label} sample={r.sample} compact={compact} />)}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: tk.text.faint, font: `500 11.5px/1.45 ${fontFamily.ui}` }}>
          <Icon name="info" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Fonts are downloaded from Google Fonts once, when you choose them, and kept in the presentation: it works offline, in the app and in exported pages.</span>
        </div>
        <Row label="Text size" extra={<span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{Math.round((t?.scale ?? 1) * 100)}%</span>}>
          <RulerSlider ariaLabel="Text size" value={Math.round((t?.scale ?? 1) * 100)} min={SCALE_RANGE[0] * 100} max={SCALE_RANGE[1] * 100} step={1} defaultValue={100} touch={compact}
            onChange={v => patchTypography({ scale: Math.abs(v - 100) < 0.5 ? undefined : v / 100 })} />
        </Row>
        <Row label="Line height" extra={<span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{(t?.lineHeight ?? DEFAULT_LINE_HEIGHT).toFixed(2)}</span>}>
          <RulerSlider ariaLabel="Line height" value={t?.lineHeight ?? DEFAULT_LINE_HEIGHT} min={LINE_HEIGHT_RANGE[0]} max={LINE_HEIGHT_RANGE[1]} step={0.01} defaultValue={DEFAULT_LINE_HEIGHT} touch={compact}
            onChange={v => patchTypography({ lineHeight: Math.abs(v - DEFAULT_LINE_HEIGHT) < 0.005 ? undefined : v })} />
        </Row>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ColourRow label="Heading colour" value={t?.headingColour} auto={stepText?.heading ?? tk.text.primary} onChange={c => patchTypography({ headingColour: c })} />
          <ColourRow label="Body colour" value={t?.bodyColour} auto={stepText?.body ?? tk.text.secondary} onChange={c => patchTypography({ bodyColour: c })} />
          <span style={{ color: tk.text.faint, font: `500 11.5px/1.4 ${fontFamily.ui}` }}>Automatic: light text on dark backgrounds, dark text on light ones.</span>
        </div>
      </Section>
      <Section title="Kept in the presentation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: tk.text.secondary, font: `500 12px/1.5 ${fontFamily.ui}` }}>
          <span>Images: {bytes.images ? `${sizeLabel(bytes.images)} (${doc.images?.length ?? 0})` : 'none'}</span>
          <span>Fonts: {bytes.fonts ? `${sizeLabel(bytes.fonts)} (${[...new Set((doc.fonts ?? []).map(f => f.family))].join(', ')})` : 'none'}</span>
        </div>
        {bytes.total > STYLE_WARN_BYTES && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', color: tk.status.warningText, font: `500 12px/1.45 ${fontFamily.ui}` }}>
            <Icon name="warning" size={13} style={{ flexShrink: 0, marginTop: 2, color: tk.status.warning }} />
            <span>Over {sizeLabel(STYLE_WARN_BYTES)} of images and fonts: saving in this browser may fail, and files and pages get slow to open. Use fewer image backgrounds.</span>
          </div>
        )}
      </Section>
    </>
  );
}
