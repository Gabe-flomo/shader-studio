/**
 * MapTarget — every control card on the board is a target for a source: in
 * Map mode a click routes the source being mapped onto it (or takes the
 * route off again when it already drives it), and at any time a source
 * card's grip can be dropped on it (sourceDrag.ts), lighting it up while a
 * source hovers over it. Outside both it is just its card.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { useMapMode } from './mapMode';
import { SOURCE_DRAG_TYPE, isSourceDrag, sourceIdOfDrop } from './sourceDrag';

export function MapTarget({ label, driven, onPick, onDropSource, children }: { label: string; driven: boolean; onPick: () => void; onDropSource?: (sourceId: string) => void; children: ReactNode }) {
  const tk = useTokens();
  const active = useMapMode(m => m.sourceId !== null);
  const [over, setOver] = useState(false);
  const drop = onDropSource && {
    onDragOver: (e: React.DragEvent) => {
      if (!isSourceDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    },
    // Leaving for a child of the card isn't leaving the card.
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const id = sourceIdOfDrop(e.dataTransfer.getData(SOURCE_DRAG_TYPE));
      if (!id) return;
      e.preventDefault();
      onDropSource(id);
    },
  };
  if (!active && !drop) return <>{children}</>;
  return (
    <div data-drop-target={label} style={{ position: 'relative' }} {...drop}>
      {children}
      {over && (
        <span data-drop-over="" style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', borderRadius: radius.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: alpha(tk.accent.base, 0.16), boxShadow: `inset 0 0 0 2px ${tk.accent.base}`, color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
          Drop to drive {label}
        </span>
      )}
      {active && (
        <button type="button" data-map-target={label} onClick={onPick} aria-pressed={driven}
          style={{ position: 'absolute', inset: 0, zIndex: 3, border: 0, borderRadius: radius.card, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: driven ? alpha(tk.accent.base, 0.22) : alpha(tk.accent.base, 0.08), boxShadow: `inset 0 0 0 ${driven ? 2 : 1}px ${tk.accent.base}`, color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
          {driven ? `✓ ${label} · click to unmap` : `Map onto ${label}`}
        </button>
      )}
    </div>
  );
}

/** The bar over the controls while mapping: which source, and Done (Esc too). */
export function MapModeBar() {
  const tk = useTokens();
  const { sourceId, label, stop } = useMapMode();
  if (!sourceId) return null;
  return (
    <div data-map-mode="" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', padding: '8px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>Mapping {label}: click each control it should drive.</span>
      <button type="button" onClick={stop} style={{ border: 0, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', background: tk.accent.base, color: '#fff', font: `600 12px ${fontFamily.ui}` }}>Done</button>
    </div>
  );
}
