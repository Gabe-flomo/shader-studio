/**
 * PaletteTools — the row of palette actions under a Palette or Stops Palette card:
 *
 *   Presets ▾   your saved palettes (either kind works on either node)
 *   Save        name and keep this palette
 *   Paste       read a palette from text: hex codes, a coolors.co link, rgb(), JSON…
 *   Copy hex    (Stops Palette) the stops as a hex list, to paste elsewhere
 *   → Stops     (Palette) convert this cosine palette into editable colour stops
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
import { getNodeDefinition } from '../../nodes/definitions';
import {
  parsePaletteText, rgbToHex, cosineToStops, loadPalettePresets, savePalettePreset, deletePalettePreset,
  PALETTE_PRESETS_CHANGED, type PalettePresetRecord, type RGB,
} from '../../lib/palette';

/** The stop colours a Stops Palette node currently has, in order. */
function stopsOf(node: GraphNode): RGB[] {
  const count = Math.max(2, Math.min(STOP_PALETTE_MAX, Math.round(Number(node.params.stops) || 5)));
  const defaults = getNodeDefinition('stopPalette')?.defaultParams ?? {};
  return Array.from({ length: count }, (_, i) => {
    const v = node.params[`color${i}`] ?? defaults[`color${i}`];
    return Array.isArray(v) && v.length >= 3 ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] as RGB : [0.5, 0.5, 0.5] as RGB;
  });
}

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

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenuAt = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };

  // ── Presets ─────────────────────────────────────────────────────────────────
  const applyPreset = (p: PalettePresetRecord) => {
    if (isStops) {
      const colors = p.kind === 'stops' ? p.stops ?? [] : p.cosine ? cosineToStops(p.cosine, 8) : [];
      useNodeGraphStore.getState().setPaletteStops(node.id, colors, { wrap: p.kind === 'cosine' ? 'loop' : p.wrap, blend: p.kind === 'cosine' ? 'smooth' : p.blend });
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

  const presetItems = (): MenuItem[] => {
    const own = presets.filter(p => p.kind === (isStops ? 'stops' : 'cosine'));
    const other = presets.filter(p => p.kind !== (isStops ? 'stops' : 'cosine'));
    const items: MenuItem[] = [];
    for (const p of own) items.push({ label: p.name, icon: 'presets', onSelect: () => applyPreset(p) });
    if (own.length && other.length) items.push('separator');
    for (const p of other) items.push({
      label: p.name, icon: 'presets',
      hint: isStops ? 'from a Palette · sampled into 8 stops' : 'stops · converts this node',
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
    const name = await askText('Save palette preset', { label: 'Name', initial: '', confirmLabel: 'Save' });
    if (!name) return;
    const r = isStops
      ? savePalettePreset({ name, kind: 'stops', stops: stopsOf(node), wrap: String(node.params.wrap ?? 'loop'), blend: String(node.params.blend ?? 'smooth') })
      : savePalettePreset({ name, kind: 'cosine', cosine: paletteNodeCoeffs(node.params) });
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

  const toStops = () => {
    if (useNodeGraphStore.getState().convertPaletteToStops(node.id, 8)) {
      const wired = ['offset', 'amplitude', 'freq', 'phase'].some(k => node.inputs[k]?.connection);
      toast.success('Converted to a Stops Palette', {
        message: `8 stops sampled from this palette; every colour is now its own swatch.${wired ? ' Wires into Offset / Amplitude / Frequency / Phase were dropped — their current values were sampled.' : ''} Undo to go back.`,
      });
    }
  };

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      ref={el => { cardRef.current = el?.closest<HTMLElement>('[data-node-id]') ?? null; }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px 8px' }}
    >
      <Button size="sm" variant="ghost" icon="presets" onClick={e => openMenuAt(e, presetItems())}>Presets</Button>
      <Button size="sm" variant="ghost" icon="save" onClick={() => void save()}>Save</Button>
      <span ref={pasteBtn} style={{ display: 'inline-flex' }}>
        <Button size="sm" variant="ghost" icon="import" onClick={() => setPasteOpen(o => !o)}
          title="Paste hex codes, a coolors.co link, rgb()/hsl(), vec3() or a JSON list">Paste</Button>
      </span>
      {isStops
        ? <Button size="sm" variant="ghost" icon="copy" onClick={copyHex} title="Copy the stops as a hex list">Copy hex</Button>
        : <Button size="sm" variant="ghost" icon="spark" onClick={toStops} title="Turn this cosine palette into editable colour stops">→ Stops</Button>}

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}

      {pasteOpen && (
        <Popover anchorRef={pasteBtn} clearRef={cardRef} onClose={() => setPasteOpen(false)} padding={10}>
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 8 }} onPointerDown={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600 }}>Paste a palette</div>
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
            {!parsed && <div style={{ fontSize: 11.5, color: tk.text.faint, whiteSpace: 'normal' }}>Hex codes in any layout, a coolors.co link, CSS rgb()/hsl(), GLSL vec3(), a JSON list, or lines of “R G B”.</div>}
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
