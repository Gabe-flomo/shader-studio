/**
 * waterLayers.ts — record edits for Water layers (the kit runs and draws them:
 * play/kit/waterLayer.js, over the Finish stack's Water solver). Pure, so tests
 * cover them.
 *
 *   newWaterLayer        a Water layer (over anything given)
 *   waterLayerSources    layers a Water layer's source can ride, or whose shape can push it
 *   dropWaterRefs        a removed layer: Water layers riding it or stamped by it let go
 *   moveWaterToLayer     the Finish stack's Water effect as a Water layer at the top,
 *                        its settings kept, its controls, mappings, routes and Splashes
 *                        moved over to the layer
 */
import { defaultLayer, layerTarget, type PlayLayer, type PlayRecord, type WaterLayer } from '../types/play';
import { finishPropId, finishTarget } from '../types/playFinish';
import { WL_PARAMS, wlEffectKey } from './kit/waterLayer.js';

export function newWaterLayer(id: string, label: string, over: Partial<WaterLayer> = {}): WaterLayer {
  return { ...(defaultLayer('water', id, label) as WaterLayer), ...over };
}

/** Layers a Water layer can ride or be pushed by: anything but itself, other Water layers and the Background. */
export function waterLayerSources(layers: readonly PlayLayer[], selfId: string, forShape = false): PlayLayer[] {
  return layers.filter(l => l.id !== selfId && l.kind !== 'water' && l.kind !== 'background' && (!forShape || (l.kind !== 'null' && l.kind !== 'drumpad' && l.kind !== 'relationship')));
}

/** After removing layer `id`: Water layers riding it, or pushed by its shape, have no such layer any more. */
export function dropWaterRefs(layers: PlayLayer[], id: string): PlayLayer[] {
  return layers.map(l => (l.kind === 'water' && (l.sourceLayer === id || l.shapeLayer === id)
    ? { ...l, ...(l.sourceLayer === id ? { sourceLayer: '' } : {}), ...(l.shapeLayer === id ? { shapeLayer: '' } : {}) } : l));
}

/** Every string in a value (not the Finish stack or the layers) equal to a key of `map`, swapped for its value. */
function swapRefs<T>(v: T, map: ReadonlyMap<string, string>): T {
  if (typeof v === 'string') return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) { let changed = false; const out = v.map(x => { const y = swapRefs(x, map); if (y !== x) changed = true; return y; }); return (changed ? out : v) as T; }
  if (v && typeof v === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const y = swapRefs(x, map); if (y !== x) changed = true; out[k] = y; }
    return (changed ? out : v) as T;
  }
  return v;
}

/**
 * "Move to a layer": the stack's Water effect `effectId` becomes a Water layer over the whole picture at the top of
 * the layers (like the effect, it bends the picture and every layer; move it down to keep layers above it dry). Its
 * numbers, Source, Shape and Detail carry over; controls on its numbers drive the layer's, and its rules' Splashes
 * drop into the layer (anything else naming the effect, like a route, follows too). Other effects' Where → Where the
 * water moves has no water any more (`wavesLeft` counts them). Nothing happens without such an effect.
 */
export function moveWaterToLayer(p: PlayRecord, effectId: string, id: string, label = 'Water'): { play: PlayRecord; id: string; wavesLeft: number } {
  const f = p.finish;
  const e = f?.effects.find(x => x.id === effectId && x.kind === 'water');
  if (!f || !e) return { play: p, id: '', wavesLeft: 0 };
  const r = e as unknown as Record<string, unknown>;
  const nums: Record<string, number> = {};
  for (const prm of WL_PARAMS) { const v = r[wlEffectKey(prm.key)]; if (typeof v === 'number' && Number.isFinite(v)) nums[prm.key] = v; }
  const layer = newWaterLayer(id, label, {
    ...(nums as Partial<WaterLayer>),
    source: e.source ?? 'pointer', sourceLayer: e.sourceLayer ?? '', shape: e.shape ?? 'point', shapeLayer: e.layerId ?? '', detail: e.detail ?? 'medium',
    visible: e.enabled && f.on !== false,
  });
  // What named the effect now names the layer: its numbers' targets, and the effect itself (a Splash's layerId).
  const map = new Map<string, string>([[finishPropId(e.id), id]]);
  for (const prm of WL_PARAMS) map.set(finishTarget(e.id, wlEffectKey(prm.key)), layerTarget(id, prm.key));
  const { finish: _f, layers: _l, ...rest } = p;
  void _f; void _l;
  const moved = swapRefs(rest, map);
  const effects = f.effects.filter(x => x.id !== e.id);
  const wavesLeft = effects.filter(x => x.where === 'waves').length;
  const play: PlayRecord = { ...p, ...moved, layers: [...p.layers, layer], finish: effects.length || !f.on ? { ...f, effects } : undefined };
  if (!play.finish) delete play.finish;
  return { play, id, wavesLeft };
}
