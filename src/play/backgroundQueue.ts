/**
 * backgroundQueue.ts — the edits a Background layer's queue takes, pure, on
 * the whole record: add the layer (at most one, always first), add, remove,
 * rename, reorder and change its sources, and what the header's Background
 * setting shows while there is one.
 *
 * The header rule: with no Background layer the header's setting decides
 * (Shader, Image, Video, Colour; Layers only) as it always has. Choosing an
 * image, a video or a graph there adds a Background layer with it as the first
 * source; while the layer is there the header says so and links to it, and
 * removing the layer hands the picture back to the header's setting.
 */
import { backgroundLayerOf, defaultLayer, type BackgroundItem, type BackgroundLayer, type PlayLayer, type PlayRecord } from '../types/play';
import { BACKGROUND_QUEUE_MAX } from '../types/playLayers';
import { playId } from './playControls';

/** A new source id. */
export const newSourceId = (): string => playId('src');

/** "This graph": the open graph as a source (the preview's own program). */
export function thisGraphSource(): BackgroundItem { return { id: newSourceId(), kind: 'graph', name: 'This graph', graph: 'this' }; }

/** A starter sketch for a Script source: it paints the whole picture, so it reads as a background. */
export const DEFAULT_BACKGROUND_SKETCH = `// A background sketch: draw(s) paints the whole picture every frame.
// s.ctx is a 2D canvas (s.width × s.height), s.time the clock in seconds.
function draw(s) {
  const { ctx, width: w, height: h, time: t } = s;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'hsl(' + (220 + 30 * Math.sin(t * 0.2)) + ' 60% 14%)');
  g.addColorStop(1, 'hsl(' + (280 + 30 * Math.cos(t * 0.17)) + ' 55% 22%)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Slow rings from the middle.
  ctx.lineWidth = h * 0.004;
  for (let i = 0; i < 12; i++) {
    const r = ((t * 0.08 + i / 12) % 1) * Math.hypot(w, h) * 0.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.18 * (1 - r / (Math.hypot(w, h) * 0.6))) + ')';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
  }
}
`;

/** Add a Background layer holding `sources` (first in the layers), or add them to the one there is. Returns the layer's id. */
export function addBackground(p: PlayRecord, sources: BackgroundItem[] = [], id: string = playId('layer')): { play: PlayRecord; id: string } {
  const existing = backgroundLayerOf(p);
  if (existing) return { play: sources.length ? addSources(p, sources) : p, id: existing.id };
  const layer = { ...defaultLayer('background', id, 'Background'), sources: sources.slice(0, BACKGROUND_QUEUE_MAX) } as BackgroundLayer;
  return { play: { ...p, layers: [layer, ...p.layers.filter(l => l.kind !== 'background')] }, id };
}

/** Change the Background layer (no-op without one). */
function withQueue(p: PlayRecord, fn: (l: BackgroundLayer) => BackgroundLayer): PlayRecord {
  const l = backgroundLayerOf(p);
  if (!l) return p;
  return { ...p, layers: [fn(l), ...p.layers.slice(1)] as PlayLayer[] };
}

/** Sources at the end of the queue (a Background layer is added when there is none). */
export function addSources(p: PlayRecord, sources: BackgroundItem[]): PlayRecord {
  if (!backgroundLayerOf(p)) return addBackground(p, sources).play;
  return withQueue(p, l => ({ ...l, sources: [...l.sources, ...sources].slice(0, BACKGROUND_QUEUE_MAX) }));
}

export function updateSource(p: PlayRecord, id: string, patch: Partial<BackgroundItem>): PlayRecord {
  return withQueue(p, l => ({ ...l, sources: l.sources.map(s => (s.id === id ? { ...s, ...patch, id: s.id, kind: s.kind } : s)) }));
}

export function renameSource(p: PlayRecord, id: string, name: string): PlayRecord {
  const n = name.trim().slice(0, 120);
  return n ? updateSource(p, id, { name: n }) : p;
}

/**
 * Take a source out. The index keeps pointing at what showed when it can: a
 * source before the showing one moves the index down with it.
 */
export function removeSource(p: PlayRecord, id: string): PlayRecord {
  return withQueue(p, l => {
    const i = l.sources.findIndex(s => s.id === id);
    if (i < 0) return l;
    const sources = l.sources.filter(s => s.id !== id);
    const index = i < Math.round(l.index) ? Math.max(0, l.index - 1) : Math.min(l.index, Math.max(0, sources.length - 1));
    return { ...l, sources, index };
  });
}

/** Move a source to position `to` (0 = first). The index follows the source that was showing. */
export function moveSource(p: PlayRecord, id: string, to: number): PlayRecord {
  return withQueue(p, l => {
    const from = l.sources.findIndex(s => s.id === id);
    if (from < 0) return l;
    const j = Math.max(0, Math.min(l.sources.length - 1, Math.round(to)));
    if (j === from) return l;
    const sources = [...l.sources];
    const [it] = sources.splice(from, 1);
    sources.splice(j, 0, it);
    const showing = l.sources[Math.max(0, Math.min(l.sources.length - 1, Math.round(l.index)))]?.id;
    const k = sources.findIndex(s => s.id === showing);
    return { ...l, sources, index: k >= 0 ? k : l.index };
  });
}

/** A copy of a source right after it, named "… copy". */
export function duplicateSource(p: PlayRecord, id: string): PlayRecord {
  return withQueue(p, l => {
    const i = l.sources.findIndex(s => s.id === id);
    if (i < 0 || l.sources.length >= BACKGROUND_QUEUE_MAX) return l;
    const copy = { ...structuredClone(l.sources[i]), id: newSourceId(), name: `${l.sources[i].name} copy` };
    const sources = [...l.sources];
    sources.splice(i + 1, 0, copy);
    return { ...l, sources };
  });
}

/**
 * What the header's Background shows: 'layer' while a Background layer
 * decides, otherwise the header's own setting.
 */
export function headerBackground(p: PlayRecord): 'layer' | 'shader' | 'image' | 'video' | 'colour' {
  if (backgroundLayerOf(p)) return 'layer';
  return p.display?.source ?? 'shader';
}
