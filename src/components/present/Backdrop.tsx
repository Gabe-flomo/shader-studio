/**
 * Backdrop — a step's background behind the reading area (present/backdrop.ts
 * builds the layers: the picture, its blurred copy under a falloff mask, the
 * shade, the vignette; presentLook.ts has the hooks that decide it).
 *
 * The picture is the library's (IndexedDB); until it's read, or when the
 * library doesn't have it, the presentation's tiny preview stands in, blurred. Layers are plain elements with CSS, so nothing
 * redraws while canvases run; the blurred copy is its own composited layer.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import { backdropLayers, declsToStyle } from '../../present/backdrop';
import type { StepLook } from '../../types/presentationStyle';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { useImageMap, useLibraryImage } from './presentLook';
import { relinkImage } from './styleActions';

/** The background layers, filling the nearest positioned box (under the content, never catching the pointer). */
export const Backdrop = memo(function Backdrop({ look, column, style }: { look: StepLook; column: number; style?: CSSProperties }) {
  const images = useImageMap();
  const bg = look.bg;
  const img = bg?.kind === 'image' && bg.image ? images.get(bg.image) : undefined;
  const { url } = useLibraryImage(img);
  // Only the preview to show (missing, or still loading): blurred all over, so its few pixels read as a soft wash.
  const preview = !!img && url === img.thumb;
  const shown = useMemo(() => (bg && preview ? { ...bg, blur: Math.max(bg.blur ?? 0, 0.6), falloff: 0 } : bg), [bg, preview]);
  const layers = useMemo(() => (shown ? backdropLayers(shown, { src: url, matte: img?.avg, tone: look.tone, column }) : []), [shown, url, img?.avg, look.tone, column]);
  if (!layers.length) return null;
  return (
    <div aria-hidden="true" className="pp-backdrop" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0, ...style }}>
      {layers.map(l => <div key={l.name} style={{ position: 'absolute', inset: 0, ...declsToStyle(l.decls) }} />)}
    </div>
  );
});

/**
 * In Edit: the step's image background isn't in this browser's library
 * (deleted, or the presentation came from another machine). Its preview
 * shows, blurred; this says so and offers to pick the picture again.
 */
export function MissingImageNote({ look }: { look: StepLook }) {
  const tk = useTokens();
  const images = useImageMap();
  const bg = look.bg;
  const img = bg?.kind === 'image' && bg.image ? images.get(bg.image) : undefined;
  const { missing } = useLibraryImage(img);
  if (!img || !missing) return null;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); void relinkImage(img.id); }}
      title={`“${img.name}” isn’t in this browser’s image backgrounds (deleted, or made on another machine). Its small preview shows instead. Pick the picture again to relink it.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px 0 9px', marginBottom: 14, border: 0, borderRadius: 14, cursor: 'pointer',
        background: alpha(tk.bg.panel, 0.92), color: tk.status.warningText, boxShadow: tk.shadow.float, font: `600 12px ${fontFamily.ui}`,
      }}>
      <Icon name="warning" size={13} style={{ color: tk.status.warning }} />
      Image missing: relink…
    </button>
  );
}
