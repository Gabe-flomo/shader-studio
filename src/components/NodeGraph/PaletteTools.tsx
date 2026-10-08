/**
 * PaletteTools — the row of palette actions under a Palette or Stops Palette card:
 *
 *   Presets ▾   the app's palettes (the Library's, built in and yours: the same picker as
 *               Present and Play backgrounds) and presets saved here (either kind works on either node)
 *   Save        name and keep this palette: a Stops Palette goes to the Library, a Palette to the presets
 *   Reverse     (Stops Palette) the stops end to end
 *   Paste       read a palette from text: hex codes, a coolors.co link, rgb(), JSON…
 *   Copy hex    (Stops Palette) the stops as a hex list, to paste elsewhere
 *   → Stops ▾   (Palette) convert this cosine palette into editable colour stops:
 *               Auto picks the fewest stops within ~1% of the original, or pick a count
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Menu, type MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { askText, askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { paletteNodeCoeffs, STOP_PALETTE_MAX } from '../../nodes/definitions/color';
import { usePalettes } from '../backgrounds/useBackgrounds';
import { openBackgrounds } from '../backgrounds/backgroundsUi';
import { freePaletteName, paletteCss, savePalette, type Palette } from '../../lib/backgroundLibrary';
import { alpha } from '../../theme/tokens';
import { evenStops } from '../ui/gradientStops';
import { libraryPaletteColours, stopColoursOf } from './stopPaletteModel';
import {
  parsePaletteText, rgbToHex, autoFitCosineStops, fitCosineStops, loadPalettePresets, savePalettePreset, deletePalettePreset,
  PALETTE_PRESETS_CHANGED, PASTE_FORMATS, type PalettePresetRecord, type RGB,
} from '../../lib/palette';

const pct = (e: number) => (e < 0.001 ? '<0.1%' : `${(e * 100).toFixed(e < 0.1 ? 1 : 0)}%`);
/** How the stops cover the palette, in a few words. */
const coverage = (f: { period: number; seamless: boolean }) =>
  !f.seamless ? 'one trip — this palette never repeats exactly' : f.period > 1 ? `loops every ${f.period} (its full repeat)` : 'loops exactly';

/** The stop colours a Stops Palette node currently has, in order. */
const stopsOf = (node: GraphNode): RGB[] => stopColoursOf(node.params);


function Swatches({ colors, height = 14 }: { colors: RGB[]; height?: number }) {
  return (
    <div style={{ display: 'flex', height, borderRadius: 4, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}>
      {colors.map((c, i) => <div key={i} title={rgbToHex(c)} style={{ flex: 1, background: rgbToHex(c) }} />)}
    </div>
  );
}

export function PaletteTools({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const isStops = node.type === 'stopPalette';
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const [presets, setPresets] = useState(loadPalettePresets);
  useEffect(() => {
    const refresh = () => setPresets(loadPalettePresets());
    window.addEventListener(PALETTE_PRESETS_CHANGED, refresh);
    return () => window.removeEventListener(PALETTE_PRESETS_CHANGED, refresh);
  }, []);

  const palettes = usePalettes();
  const presetsBtn = useRef<HTMLSpanElement>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenuAt = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };

  // ── Presets ─────────────────────────────────────────────────────────────────
  const applyPreset = (p: PalettePresetRecord) => {
    if (isStops) {
      if (p.kind === 'cosine' && p.cosine) {
        const fit = autoFitCosineStops(p.cosine, STOP_PALETTE_MAX);
        useNodeGraphStore.getState().setPaletteStops(node.id, fit.stops, { wrap: 'loop', blend: fit.blend });
      } else {
        useNodeGraphStore.getState().setPaletteStops(node.id, p.stops ?? [], { wrap: p.wrap, blend: p.blend });
      }
      return;
    }
    if (p.kind === 'cosine' && p.cosine) {
      updateNodeParams(node.id, { preset: 'custom', ...p.cosine }, { immediate: true });
    } else if (p.stops) {
      // A stops preset can't be a cosine palette: the node becomes a Stops Palette holding it.
      useNodeGraphStore.getState().setPaletteStops(node.id, p.stops, { wrap: p.wrap, blend: p.blend });
      toast.info('Converted to a Stops Palette', { message: `“${p.name}” is a colour-stop palette, so this node now holds those stops. Undo to go back.` });
    }
  };

  /** A Library palette (the same ones Present and Play backgrounds pick from) becomes this node's stops. */
  const applyLibrary = (p: Palette) => {
    const blendNow = String(node.params.blend ?? 'smooth');
    const blend = p.style === 'bands' ? 'bands' : blendNow === 'bands' ? 'smooth' : undefined;
    useNodeGraphStore.getState().setPaletteStops(node.id, libraryPaletteColours(p), { blend });
    setPresetsOpen(false);
    if (!isStops) toast.info('Converted to a Stops Palette', { message: `“${p.name}” is a colour-stop palette, so this node now holds its stops. Undo to go back.` });
  };
  const reverse = () => useNodeGraphStore.getState().setPaletteStops(node.id, [...stopsOf(node)].reverse());

  const presetItems = (): MenuItem[] => {
    const own = presets.filter(p => p.kind === (isStops ? 'stops' : 'cosine'));
    const other = presets.filter(p => p.kind !== (isStops ? 'stops' : 'cosine'));
    const items: MenuItem[] = [];
    for (const p of own) items.push({ label: p.name, icon: 'presets', onSelect: () => applyPreset(p) });
    if (own.length && other.length) items.push('separator');
    for (const p of other) items.push({
      label: p.name, icon: 'presets',
      hint: isStops ? 'from a Palette · auto-fitted into stops' : 'stops · converts this node',
      onSelect: () => applyPreset(p),
    });
    if (items.length === 0) items.push({ label: 'No saved palettes yet — use Save', disabled: true, onSelect: () => {} });
    if (presets.length) {
      items.push('separator');
      items.push({ label: 'Delete a preset…', icon: 'trash', onSelect: () => setTimeout(() => setMenu(m => m && { ...m, items: deleteItems() }), 0) });
    }
    return items;
  };

  const deleteItems = (): MenuItem[] => loadPalettePresets().map(p => ({
    label: `Delete “${p.name}”`, danger: true, hint: p.kind === 'stops' ? 'stops' : 'palette',
    onSelect: () => {
      void askConfirm(`Delete the preset “${p.name}”?`, { confirmLabel: 'Delete', danger: true }).then(ok => {
        if (!ok) return;
        const r = deletePalettePreset(p.id);
        if (!r.ok) toast.error('Couldn’t delete the preset', { message: r.error });
      });
    },
  }));

  const save = async () => {
    if (isStops) {
      // Colour stops are a Library palette: usable here, and as a Play or Present background.
      const name = await askText('Save palette', { label: 'Name', initial: freePaletteName('My palette'), confirmLabel: 'Save' });
      if (!name) return;
      try {
        const p = savePalette({ name, stops: evenStops(stopsOf(node)), style: String(node.params.blend ?? 'smooth') === 'bands' ? 'bands' : 'gradient', angle: 90 });
        toast.success(`Saved “${p.name}”`, { message: 'In the Library’s backgrounds, under Palettes: pick it under Presets on any Palette node, or as a Play or Present background.' });
      } catch (e) { toast.error('Couldn’t save the palette', { message: e instanceof Error ? e.message : String(e) }); }
      return;
    }
    const name = await askText('Save palette preset', { label: 'Name', initial: '', confirmLabel: 'Save' });
    if (!name) return;
    const r = savePalettePreset({ name, kind: 'cosine', cosine: paletteNodeCoeffs(node.params) });
    if (r.ok) toast.success(`Saved “${name}”`, { message: 'Find it under Presets on any Palette or Stops Palette.' });
    else toast.error('Couldn’t save the preset', { message: r.error });
  };

  // ── Paste ───────────────────────────────────────────────────────────────────
  const pasteBtn = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const parsed = useMemo(() => (pasteText.trim() ? parsePaletteText(pasteText) : null), [pasteText]);
  const applyPaste = () => {
    if (!parsed?.ok) return;
    if (parsed.colors.length < 2) { toast.warning('A palette needs at least two colours'); return; }
    const used = useNodeGraphStore.getState().setPaletteStops(node.id, parsed.colors);
    setPasteOpen(false);
    setPasteText('');
    const notes: string[] = [];
    if (parsed.colors.length > used) notes.push(`${parsed.colors.length} colours thinned evenly to ${used}, the most a Stops Palette holds.`);
    if (!isStops) notes.push('This Palette became a Stops Palette holding them; undo to go back.');
    toast.success(`Pasted ${used} colours`, notes.length ? { message: notes.join(' ') } : undefined);
  };

  const copyHex = () => {
    const text = stopsOf(node).map(rgbToHex).join(' ');
    void navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied the stops as hex', { message: text }),
      () => toast.error('Couldn’t reach the clipboard', { message: text }),
    );
  };

  const toStops = (count: number | 'auto') => {
    const coeffs = paletteNodeCoeffs(node.params);
    const fit = count === 'auto' ? autoFitCosineStops(coeffs, STOP_PALETTE_MAX) : fitCosineStops(coeffs, count);
    if (useNodeGraphStore.getState().convertPaletteToStops(node.id, count)) {
      const wired = ['offset', 'amplitude', 'freq', 'phase'].some(k => node.inputs[k]?.connection);
      toast.success(`Converted to ${fit.stops.length} stops`, {
        message: `Largest colour difference from the original: ${pct(fit.error)}; ${coverage(fit)}${fit.period > 1 ? `, so Scale and Speed were divided by ${fit.period}` : ''}. Blend: ${fit.blend === 'curve' ? 'Curve' : 'Linear'}. Every colour is now its own swatch.${wired ? ' Wires into Offset / Amplitude / Frequency / Phase were dropped — their current values were sampled.' : ''} Undo to go back.`,
      });
    }
  };
  /** The fidelity choices, each with how closely it matches the palette. */
  const toStopsItems = (): MenuItem[] => {
    const coeffs = paletteNodeCoeffs(node.params);
    const auto = autoFitCosineStops(coeffs, STOP_PALETTE_MAX);
    const items: MenuItem[] = [
      { label: `Auto — ${auto.stops.length} stops`, icon: 'spark', hint: `max error ${pct(auto.error)} · ${coverage(auto)}`, onSelect: () => toStops('auto') },
      'separator',
    ];
    for (const n of [4, 8, 12, 16, 24, 32]) {
      const fit = fitCosineStops(coeffs, n);
      items.push({ label: `${n} stops`, hint: `max error ${pct(fit.error)}`, onSelect: () => toStops(n) });
    }
    return items;
  };

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      ref={el => { cardRef.current = el?.closest<HTMLElement>('[data-node-id]') ?? null; }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px 8px' }}
    >
      <span ref={presetsBtn} style={{ display: 'inline-flex' }}>
        <Button size="sm" variant="ghost" icon="presets" aria-expanded={presetsOpen} onClick={() => setPresetsOpen(o => !o)}
          title="The Library’s palettes (built in and yours, shared with Play and Present backgrounds) and presets saved here">Presets</Button>
      </span>
      <Button size="sm" variant="ghost" icon="save" onClick={() => void save()} title={isStops ? 'Keep these colours in the Library, to use here or as a background' : 'Save this palette as a preset'}>Save</Button>
      {isStops && <Button size="sm" variant="ghost" icon="bidir" onClick={reverse} title="Turn the stops end to end">Reverse</Button>}
      <span ref={pasteBtn} style={{ display: 'inline-flex' }}>
        <Button size="sm" variant="ghost" icon="import" onClick={() => setPasteOpen(o => !o)}
          title="Paste hex codes, a coolors.co link, rgb()/hsl(), vec3() or a JSON list">Paste</Button>
      </span>
      {isStops
        ? <Button size="sm" variant="ghost" icon="copy" onClick={copyHex} title="Copy the stops as a hex list">Copy hex</Button>
        : <Button size="sm" variant="ghost" icon="spark" onClick={e => openMenuAt(e, toStopsItems())} title="Turn this cosine palette into editable colour stops — Auto, or choose how many">→ Stops</Button>}

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}

      {presetsOpen && (
        <Popover anchorRef={presetsBtn} clearRef={cardRef} onClose={() => setPresetsOpen(false)} padding={10}>
          <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 8 }} onPointerDown={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600 }}>Library palettes</div>
            <div role="listbox" aria-label="Palettes" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {[...palettes.filter(p => !p.preset), ...palettes.filter(p => p.preset)].map(p => (
                <button key={p.id} type="button" role="option" aria-selected={false} title={`${p.name} · ${p.stops.length} colours${p.style === 'bands' ? ' · bands' : ''}`} onClick={() => applyLibrary(p)}
                  style={{ width: 34, height: 22, flexShrink: 0, borderRadius: 6, border: 0, padding: 0, cursor: 'pointer', background: paletteCss(p, 90), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.14)}` }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" icon="overlay" onClick={async () => { const pk = await openBackgrounds({ pick: 'palette', title: 'Choose a palette' }); if (pk?.kind === 'palette') applyLibrary(pk.palette); }}>More…</Button>
              <Button size="sm" variant="ghost" icon="presets" onClick={e => openMenuAt(e, presetItems())} title="Presets saved on Palette nodes (cosine palettes and older colour-stop presets)">Saved presets ▾</Button>
            </div>
            <div style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'normal' }}>{isStops ? 'A palette’s colours become this node’s stops, one each.' : 'A colour-stop palette turns this node into a Stops Palette holding it.'}</div>
          </div>
        </Popover>
      )}

      {pasteOpen && (
        <Popover anchorRef={pasteBtn} clearRef={cardRef} onClose={() => setPasteOpen(false)} padding={10}>
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 8 }} onPointerDown={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600 }}>Paste a palette</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }} aria-label="Accepted formats">
              {PASTE_FORMATS.map(f => (
                <span key={f.label} title={f.example} style={{
                  font: `500 10.5px ${fontFamily.mono}`, padding: '2px 6px', borderRadius: 999, cursor: 'help',
                  background: tk.bg.field, color: tk.text.muted,
                }}>{f.label}</span>
              ))}
            </div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyPaste(); e.stopPropagation(); }}
              placeholder={'#264653 #2a9d8f #e9c46a #f4a261 #e76f51\nhttps://coolors.co/264653-2a9d8f-e9c46a\nrgb(38, 70, 83), rgb(42, 157, 143)…'}
              spellCheck={false}
              style={{
                height: 92, resize: 'vertical', padding: 8, borderRadius: radius.md, border: 0, outline: 'none',
                background: tk.bg.field, color: tk.text.primary, font: `11.5px/1.45 ${fontFamily.mono}`,
              }}
            />
            {parsed?.ok && (
              <>
                <Swatches colors={parsed.colors} height={18} />
                <div style={{ fontSize: 11.5, color: tk.text.muted }}>
                  {parsed.colors.length} colours · {parsed.format}
                  {parsed.colors.length > STOP_PALETTE_MAX ? ` · will be thinned to ${STOP_PALETTE_MAX}` : ''}
                </div>
              </>
            )}
            {parsed && !parsed.ok && <div style={{ fontSize: 11.5, color: tk.status.danger, whiteSpace: 'normal' }}>{parsed.error}</div>}
            {!parsed && <div style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'normal' }}>Any of the formats above — hover one for an example. Mixed formats are read in order.</div>}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={!parsed?.ok || parsed.colors.length < 2} onClick={applyPaste}>
                {isStops ? 'Use these stops' : 'Use as Stops Palette'}
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
