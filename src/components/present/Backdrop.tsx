/**
 * Backdrop — a step's background behind the reading area (present/backdrop.ts
 * builds the layers: the picture, its blurred copy under a falloff mask, the
 * shade, the vignette; presentLook.ts has the hooks that decide it).
 *
 * The picture is the embedded copy, or the library's full-size one when this
 * browser has it (relinkUrl). Layers are plain elements with CSS, so nothing
 * redraws while canvases run; the blurred copy is its own composited layer.
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { relinkUrl } from '../../lib/backgroundLibrary';
import { backdropLayers, declsToStyle } from '../../present/backdrop';
import type { PresentImage, StepLook } from '../../types/presentationStyle';
import { useImageMap } from './presentLook';

/** The image's URL: the embedded copy at once, then the library's full-size one if it's here. */
function useImageUrl(img: PresentImage | undefined): string | undefined {
  const [url, setUrl] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (!img?.libraryId) return;
    let live = true;
    void relinkUrl({ libraryId: img.libraryId, src: img.src }).then(u => { if (live) setUrl({ for: img.id, url: u }); });
    return () => { live = false; };
  }, [img?.id, img?.libraryId, img?.src]);
  if (!img) return undefined;
  return url && url.for === img.id ? url.url : img.src;
}

/** The background layers, filling the nearest positioned box (under the content, never catching the pointer). */
export const Backdrop = memo(function Backdrop({ look, column, style }: { look: StepLook; column: number; style?: CSSProperties }) {
  const images = useImageMap();
  const bg = look.bg;
  const img = bg?.kind === 'image' && bg.image ? images.get(bg.image) : undefined;
  const src = useImageUrl(img);
  const layers = useMemo(() => (bg ? backdropLayers(bg, { src, matte: img?.avg, tone: look.tone, column }) : []), [bg, src, img?.avg, look.tone, column]);
  if (!layers.length) return null;
  return (
    <div aria-hidden="true" className="pp-backdrop" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0, ...style }}>
      {layers.map(l => <div key={l.name} style={{ position: 'absolute', inset: 0, ...declsToStyle(l.decls) }} />)}
    </div>
  );
});
