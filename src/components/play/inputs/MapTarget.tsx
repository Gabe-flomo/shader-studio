/**
 * MapTarget — in Map mode every control is a target: a click routes the
 * source being mapped onto it (or takes the route off again when it already
 * drives it). Outside Map mode it is just its card.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { useMapMode } from './mapMode';

export function MapTarget({ label, driven, onPick, children }: { label: string; driven: boolean; onPick: () => void; children: ReactNode }) {
  const tk = useTokens();
  const active = useMapMode(m => m.sourceId !== null);
  if (!active) return <>{children}</>;
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <button type="button" data-map-target={label} onClick={onPick} aria-pressed={driven}
        style={{ position: 'absolute', inset: 0, zIndex: 3, border: 0, borderRadius: radius.card, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: driven ? alpha(tk.accent.base, 0.22) : alpha(tk.accent.base, 0.08), boxShadow: `inset 0 0 0 ${driven ? 2 : 1}px ${tk.accent.base}`, color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
        {driven ? `✓ ${label} · click to unmap` : `Map onto ${label}`}
      </button>
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
