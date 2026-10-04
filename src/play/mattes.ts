/**
 * mattes.ts — edits to a Play record for track mattes and masks (the kit
 * draws them: play/kit/mattes.js). The Layers list, the picture's handles and
 * drawn outlines all go through these, so a matte never loops and a removed
 * mask takes its controls with it.
 */
import { defaultLayer, layerTarget, type BackgroundMatte, type LayerDisplace, type LayerMask, type MaskOp, type MaskShape, type PlayLayer, type PlayRecord, type ShapeLayer, type TrackMatte } from '../types/play';
import { canBeMatte, canHaveMatte, defaultDisplace, DISP_PROP_KEYS, DISP_PROPS, MASK_DEFAULTS, MASK_PROP_KEYS, MASKS_MAX, maskKey, matteUsers, matteWouldCycle, type MaskProp } from '../types/playLayers';
import { playId } from './playControls';
import { newMotionLayer } from './motionLayers';

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const withLayer = (p: PlayRecord, id: string, fn: (l: PlayLayer) => PlayLayer): PlayRecord => ({ ...p, layers: p.layers.map(l => (l.id === id ? fn(l) : l)) });

/**
 * Use `matteId` as the layer's matte ('' takes it off). A layer that becomes
 * a matte for the first time is hidden, as in After Effects: it shows through
 * the layer it mattes, not on its own. Nothing happens when it would loop.
 */
export function setTrackMatte(p: PlayRecord, layerId: string, matteId: string, opts: Partial<Omit<TrackMatte, 'id'>> = {}): PlayRecord {
  const l = p.layers.find(x => x.id === layerId);
  if (!l || !canHaveMatte(l.kind)) return p;
  if (!matteId) {
    if (!l.trackMatte) return p;
    return withLayer(p, layerId, x => { const c = { ...x }; delete c.trackMatte; return c; });
  }
  const m = p.layers.find(x => x.id === matteId);
  if (!m || !canBeMatte(m.kind) || matteWouldCycle(p.layers, layerId, matteId)) return p;
  const firstUse = matteUsers(p.layers, matteId).length === 0 && l.trackMatte?.id !== matteId;
  const trackMatte: TrackMatte = { id: matteId, mode: opts.mode ?? l.trackMatte?.mode ?? 'alpha', invert: opts.invert ?? l.trackMatte?.invert ?? false };
  return {
    ...p,
    layers: p.layers.map(x => (x.id === layerId ? { ...x, trackMatte } : x.id === matteId && firstUse && m.kind !== 'background' ? { ...x, visible: false } : x)),
  };
}

/** Change how the layer uses its matte (mode, invert). */
export function patchTrackMatte(p: PlayRecord, layerId: string, patch: Partial<Omit<TrackMatte, 'id'>>): PlayRecord {
  return withLayer(p, layerId, l => (l.trackMatte ? { ...l, trackMatte: { ...l.trackMatte, ...patch } } : l));
}

/**
 * A new Shape layer as the layer's matte: a box in the middle of the picture,
 * solid white (so Alpha and Luma both show the layer inside it), hidden, and
 * placed right above the layer in the stack.
 */
export function addMatteShape(p: PlayRecord, layerId: string, aspect = 16 / 9): { play: PlayRecord; id: string } {
  const i = p.layers.findIndex(x => x.id === layerId);
  const l = p.layers[i];
  if (!l || !canHaveMatte(l.kind)) return { play: p, id: '' };
  const id = playId('layer');
  const shape = {
    ...defaultLayer('shape', id, `${l.label} matte`),
    shape: 'box', x: 0.5, y: 0.5, w: r4(Math.min(aspect, 1.6) * 0.5), h: 0.5, fill: [1, 1, 1], fillOpacity: 1, strokeWidth: 0, action: 'none', toShader: false, visible: false,
  } as ShapeLayer;
  const layers = [...p.layers];
  layers.splice(i + 1, 0, shape);
  return { play: setTrackMatte({ ...p, layers }, layerId, id, { mode: 'alpha', invert: false }), id };
}

/**
 * "Show only where it moves": a new Motion layer as the layer's matte, placed
 * right above it, watching what a new Motion layer watches (the camera, or the
 * setup's first Video layer), hidden (it keeps measuring). Its Feather softens
 * the edge; the matte's Invert shows the layer where nothing moves instead.
 */
export function addMatteMotion(p: PlayRecord, layerId: string): { play: PlayRecord; id: string } {
  const i = p.layers.findIndex(x => x.id === layerId);
  const l = p.layers[i];
  if (!l || !canHaveMatte(l.kind)) return { play: p, id: '' };
  const id = playId('layer');
  const m = newMotionLayer(p.layers, id, `${l.label} · where it moves`, { visible: false, show: 'mask' });
  const layers = [...p.layers];
  layers.splice(i + 1, 0, m);
  return { play: setTrackMatte({ ...p, layers }, layerId, id, { mode: 'alpha', invert: false }), id };
}

// ── The Background's matte ──────────────────────────────────────────────────

/** Layers the Background can be matted by: not nulls, not the Background layer itself. */
export function backgroundMatteCandidates(layers: readonly PlayLayer[]): PlayLayer[] {
  return layers.filter(l => l.kind !== 'background' && canBeMatte(l.kind));
}

/**
 * Use `matteId` as the Background's matte ('' takes it off). As with a layer
 * matte, the layer becomes hidden the first time it is used, so it works as
 * the matte and not on its own too.
 */
export function setBackgroundMatte(p: PlayRecord, matteId: string): PlayRecord {
  if (!matteId) { if (!p.backgroundMatte) return p; const c = { ...p }; delete c.backgroundMatte; return c; }
  const m = p.layers.find(x => x.id === matteId);
  if (!m || m.kind === 'background' || !canBeMatte(m.kind)) return p;
  const firstUse = m.visible !== false && p.backgroundMatte?.id !== matteId;
  const backgroundMatte: BackgroundMatte = { id: matteId, mode: p.backgroundMatte?.mode ?? 'alpha', ...(p.backgroundMatte?.invert ? { invert: true } : {}) };
  return { ...p, backgroundMatte, layers: firstUse ? p.layers.map(x => (x.id === matteId ? { ...x, visible: false } : x)) : p.layers };
}

/** Change how the Background uses its matte (mode, invert, feather, opacity outside, show the layer). */
export function patchBackgroundMatte(p: PlayRecord, patch: Partial<Omit<BackgroundMatte, 'id'>>): PlayRecord {
  if (!p.backgroundMatte) return p;
  const next: BackgroundMatte = { ...p.backgroundMatte, ...patch };
  // Drop falsy optional fields so a plain matte stays small in the file.
  if (!next.invert) delete next.invert;
  if (!next.feather) delete next.feather;
  if (!next.opacityOutside) delete next.opacityOutside;
  if (!next.showLayer) delete next.showLayer;
  return { ...p, backgroundMatte: next };
}

/** "Matted by Hand path 1 · inverted · 12 px", for the Background page. */
export function backgroundMatteSummary(p: PlayRecord): string {
  const t = p.backgroundMatte;
  const m = t && p.layers.find(x => x.id === t.id);
  if (!t || !m) return '';
  const parts = [`Matted by ${m.label}`];
  if (t.mode === 'luma') parts.push('luma');
  if (t.invert) parts.push('inverted');
  if (t.feather) parts.push(`${Math.round(t.feather)} px`);
  if (t.opacityOutside) parts.push(`${Math.round(t.opacityOutside * 100)}% outside`);
  return parts.join(' · ');
}

// ── Masks ────────────────────────────────────────────────────────────────────

/** The next free mask id on a layer: m1, m2… (ids aren't reused while the layer has the old one). */
export function nextMaskId(l: PlayLayer): string {
  let n = 1;
  for (const m of l.masks ?? []) n = Math.max(n, Number(m.id.slice(1)) + 1);
  return `m${n}`;
}

/** Where a new mask goes: a box in the layer's own frame (offset from its centre, size, turn), all in picture heights. */
export interface MaskPlace { x: number; y: number; w: number; h: number; rotation?: number; points?: number[] }

/** Add a mask to a layer, on top of its others (Add). Returns its id ('' when the layer can't have one or is full). */
export function addMask(p: PlayRecord, layerId: string, shape: MaskShape, place: MaskPlace, op: MaskOp = 'add'): { play: PlayRecord; maskId: string } {
  const l = p.layers.find(x => x.id === layerId);
  if (!l || !canHaveMatte(l.kind) || (l.masks?.length ?? 0) >= MASKS_MAX) return { play: p, maskId: '' };
  const id = nextMaskId(l);
  const poly = shape === 'polygon' && (place.points?.length ?? 0) >= 6;
  const mask: LayerMask = { id, shape: poly ? 'polygon' : shape === 'polygon' ? 'rect' : shape, points: poly ? place.points!.map(r4) : [], op, invert: false };
  const nums: Record<string, number> = {};
  for (const k of MASK_PROP_KEYS) nums[maskKey(id, k)] = MASK_DEFAULTS[k];
  nums[maskKey(id, 'x')] = r4(place.x); nums[maskKey(id, 'y')] = r4(place.y);
  nums[maskKey(id, 'w')] = r4(Math.max(0.01, place.w)); nums[maskKey(id, 'h')] = r4(Math.max(0.01, place.h));
  nums[maskKey(id, 'rotation')] = Math.round((place.rotation ?? 0) * 10) / 10;
  return { play: withLayer(p, layerId, x => ({ ...x, ...nums, masks: [...(x.masks ?? []), mask] } as PlayLayer)), maskId: id };
}

/** Change a mask's shape settings (op, invert) and / or its numbers. */
export function patchMask(p: PlayRecord, layerId: string, maskId: string, patch: Partial<Pick<LayerMask, 'op' | 'invert'>>, nums: Partial<Record<MaskProp, number>> = {}): PlayRecord {
  return withLayer(p, layerId, l => {
    if (!l.masks?.some(m => m.id === maskId)) return l;
    const out = { ...l, masks: l.masks.map(m => (m.id === maskId ? { ...m, ...patch } : m)) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(nums)) if (typeof v === 'number' && Number.isFinite(v)) out[maskKey(maskId, k)] = v;
    return out as unknown as PlayLayer;
  });
}

/** Remove a mask, its numbers, and the controls (with their mappings) that drove them. */
export function removeMask(p: PlayRecord, layerId: string, maskId: string): PlayRecord {
  const keys = new Set(MASK_PROP_KEYS.map(k => maskKey(maskId, k)));
  const targets = new Set([...keys].map(k => layerTarget(layerId, k)));
  const controls = p.controls.filter(c => !targets.has(c.target));
  const kept = new Set(controls.map(c => c.id));
  return {
    ...withLayer(p, layerId, l => {
      const out = { ...l } as Record<string, unknown>;
      for (const k of keys) delete out[k];
      const masks = (l.masks ?? []).filter(m => m.id !== maskId);
      if (masks.length) out.masks = masks; else delete out.masks;
      return out as unknown as PlayLayer;
    }),
    controls,
    mappings: p.mappings.filter(m => kept.has(m.controlId)),
  };
}

/** Move a mask earlier (-1) or later (+1) in the order they combine. */
export function moveMask(p: PlayRecord, layerId: string, maskId: string, dir: -1 | 1): PlayRecord {
  return withLayer(p, layerId, l => {
    const masks = [...(l.masks ?? [])], i = masks.findIndex(m => m.id === maskId), j = i + dir;
    if (i < 0 || j < 0 || j >= masks.length) return l;
    [masks[i], masks[j]] = [masks[j], masks[i]];
    return { ...l, masks };
  });
}

/**
 * A mask from an outline drawn on the picture (x, y pairs, 0..1, y up):
 * its box around the points, and the points inside that box. `local` turns a
 * picture position and turn into the layer's own frame (kmMaskLocal).
 */
export function maskFromOutline(pts: readonly number[], aspect: number, local: (x: number, y: number, rotation: number) => { x: number; y: number; rotation: number }): MaskPlace | null {
  if (pts.length < 6) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const w = Math.max(0.01, (maxX - minX) * aspect), h = Math.max(0.01, maxY - minY);
  const points: number[] = [];
  for (let i = 0; i < pts.length; i += 2) points.push(((pts[i] - cx) * aspect) / w, (pts[i + 1] - cy) / h);
  const at = local(cx, cy, 0);
  return { x: at.x, y: at.y, w, h, rotation: at.rotation, points };
}

/** What the layer list says about a layer's matte: "Shape 1 · Luma, inverted". */
export function matteSummary(p: PlayRecord, l: PlayLayer): string {
  const t = l.trackMatte;
  const m = t && p.layers.find(x => x.id === t.id);
  if (!t || !m) return '';
  return `${m.label} · ${t.mode === 'luma' ? 'Luma' : 'Alpha'}${t.invert ? ', inverted' : ''}`;
}

/** A removed layer is no one's matte any more. */
export function dropMatteRefs(layers: PlayLayer[], removedId: string): PlayLayer[] {
  return layers.map(l => { if (l.trackMatte?.id !== removedId) return l; const c = { ...l }; delete c.trackMatte; return c; });
}

/** One line for a folded card: what the layer's matte and masks are. */
export function matteMaskSummary(play: PlayRecord, l: PlayLayer): string {
  const parts: string[] = [];
  const m = matteSummary(play, l);
  if (m) parts.push(`Matte · ${m}`);
  const n = l.masks?.length ?? 0;
  if (n) parts.push(`${n} mask${n === 1 ? '' : 's'}`);
  return parts.join('  ·  ');
}

// ── Displacement map ─────────────────────────────────────────────────────────

/**
 * Give the layer a Displacement Map reading `mapId` ('' = the picture), at
 * After Effects' defaults (Red sideways, Green up and down) with its maxima.
 * A map layer used for the first time is hidden, like a matte: it shows
 * through the layer it moves.
 */
export function addDisplace(p: PlayRecord, layerId: string, mapId = ''): PlayRecord {
  const l = p.layers.find(x => x.id === layerId);
  if (!l || !canHaveMatte(l.kind) || l.displace) return p;
  const m = mapId && mapId !== layerId ? p.layers.find(x => x.id === mapId) : undefined;
  const displace = defaultDisplace(m ? m.id : '');
  return {
    ...p,
    layers: p.layers.map(x => {
      if (x.id === layerId) { const out = { ...x, displace } as Record<string, unknown>; for (const k of DISP_PROP_KEYS) out[k] = DISP_PROPS[k].value; return out as unknown as PlayLayer; }
      return m && x.id === m.id && m.kind !== 'background' ? { ...x, visible: false } : x;
    }),
  };
}

/** Change the layer's Displacement Map (map, channels, behaviour, wrap). */
export function patchDisplace(p: PlayRecord, layerId: string, patch: Partial<LayerDisplace>): PlayRecord {
  return withLayer(p, layerId, l => {
    if (!l.displace) return l;
    const d = { ...l.displace, ...patch };
    if (d.layerId === layerId) d.layerId = '';
    if (d.map === 'layer' && !d.layerId) d.map = 'picture';
    return { ...l, displace: d };
  });
}

/** Take the layer's Displacement Map off, with its numbers and the controls that drove them. */
export function removeDisplace(p: PlayRecord, layerId: string): PlayRecord {
  const targets = new Set(DISP_PROP_KEYS.map(k => layerTarget(layerId, k)));
  const controls = p.controls.filter(c => !targets.has(c.target));
  const kept = new Set(controls.map(c => c.id));
  return {
    ...withLayer(p, layerId, l => {
      const out = { ...l } as Record<string, unknown>;
      for (const k of DISP_PROP_KEYS) delete out[k];
      delete out.displace;
      return out as unknown as PlayLayer;
    }),
    controls,
    mappings: p.mappings.filter(m => kept.has(m.controlId)),
  };
}
