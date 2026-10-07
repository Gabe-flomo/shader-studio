/**
 * ShapeGallery — the Scene Builder's shapes as a grid of small pictures (docs/scene-builder.md,
 * "The shape gallery"). Click (or tap) a tile to add the shape beside the selection; on a desktop,
 * drag it onto a row of the Scene tree to put it before, after or inside that row.
 *
 * The pictures come from sceneBuilder/thumbnails.ts (a tiny CPU ray marcher with a clear
 * background, so they read on light and dark themes). Each is drawn once, a few per frame so
 * opening the gallery never stalls, at the screen's pixel density, and kept for the session.
 */
import { useEffect, useState, type DragEvent } from 'react';
import { GALLERY_SHAPES, renderThumbnail, type GalleryShape } from '../../sceneBuilder/thumbnails';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

/** The drag type a gallery tile carries (its gallery key). */
export const SHAPE_DRAG = 'application/x-scene-shape';

const PX = 56;
const cache = new Map<string, string>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let pumping = false;

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    // A few per frame: the gallery fills in as you watch rather than all at once after a pause.
    while (queue.length && performance.now() - t0 < 12) {
      const key = queue.shift()!;
      if (cache.has(key)) continue;
      cache.set(key, draw(key));
    }
    listeners.forEach(l => l());
    if (queue.length) requestAnimationFrame(step);
    else pumping = false;
  };
  requestAnimationFrame(step);
}

function draw(key: string): string {
  try {
    const scale = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const size = PX * scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.putImageData(new ImageData(renderThumbnail(key, size, scale >= 2 ? 1 : 2), size, size), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** The picture of a gallery tile (or a shape kind), once it has been drawn; null until then. */
export function useThumbnail(key: string): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (cache.has(key)) return;
    const l = () => { if (cache.has(key)) bump(n => n + 1); };
    listeners.add(l);
    if (!queue.includes(key)) queue.push(key);
    pump();
    return () => { listeners.delete(l); };
  }, [key]);
  return cache.get(key) || null;
}

/** A shape's picture at any size (the tree's rows, the inspector's header). */
export function ShapeThumb({ kind, size = 22, title }: { kind: string; size?: number; title?: string }) {
  const tk = useTokens();
  const src = useThumbnail(kind);
  return src
    ? <img src={src} alt="" title={title} width={size} height={size} draggable={false} style={{ width: size, height: size, flexShrink: 0, display: 'block' }} />
    : <span aria-hidden style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: tk.bg.field, transform: 'scale(0.6)' }} />;
}

function Tile({ g, onPick, size }: { g: GalleryShape; onPick: (g: GalleryShape) => void; size: number }) {
  const tk = useTokens();
  const src = useThumbnail(g.key);
  const [hover, setHover] = useState(false);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(SHAPE_DRAG, g.key);
    e.dataTransfer.setData('text/plain', g.key);
    e.dataTransfer.effectAllowed = 'copy';
    if (src) {
      const img = new Image();
      img.src = src;
      e.dataTransfer.setDragImage(img, PX / 2, PX / 2);
    }
  };
  return (
    <button type="button" data-gallery-shape={g.key} draggable onDragStart={onDragStart} onClick={() => onPick(g)}
      title={`${g.label}: ${g.blurb}`} aria-label={`Add a ${g.label.toLowerCase()}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 2px 5px', minWidth: 0,
        border: 0, borderRadius: radius.md, cursor: 'grab', background: hover ? tk.bg.hover : 'none',
        boxShadow: `inset 0 0 0 1px ${hover ? tk.border.strong : tk.border.subtle}`, color: tk.text.secondary,
      }}>
      <span style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {src
          ? <img src={src} alt="" width={size} height={size} draggable={false} style={{ width: size, height: size, display: 'block' }} />
          : <span aria-hidden style={{ width: size * 0.5, height: size * 0.5, borderRadius: '50%', background: tk.bg.field }} />}
      </span>
      <span style={{ maxWidth: '100%', font: `500 11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
    </button>
  );
}

/** The grid of tiles. `size`: each picture's size in CSS pixels. */
export function ShapeGallery({ onPick, size = PX, minTile = 76 }: { onPick: (g: GalleryShape) => void; size?: number; minTile?: number }) {
  return (
    <div role="list" aria-label="Shapes" data-shape-gallery
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minTile}px, 1fr))`, gap: 4 }}>
      {GALLERY_SHAPES.map(g => <div role="listitem" key={g.key} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><Tile g={g} onPick={onPick} size={size} /></div>)}
    </div>
  );
}
