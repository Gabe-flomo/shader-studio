/**
 * layerOps.ts — edits to a Play record's layers that more than one place
 * offers (the Layers list, the picture's right-click menu): remove with
 * everything that pointed at it, duplicate, reset to defaults, move in the
 * draw order, make a null for a property that follows one, and make a null
 * that drives a control.
 */
import { finishHost, finishHostLabel, finishParamOf, finishTarget } from '../../types/playFinish';
import { audioFxControlFor } from '../../types/playAudioFx';
import { layerNumericProps, defaultLayer, layerTarget, type NullLayer, type ShapeLayer, type PlayControl, type PlayLayer, type PlayMapping, type PlayRecord, type PlaySource, type TriggerSpec } from '../../types/play';
import { candidateLabel, playId, targetParts, type PlayCandidate } from '../../play/playControls';
import { resetKindLayer } from '../../play/layerKinds';
import { dropMatteRefs } from '../../play/mattes';

/** Remove a layer and the controls, mappings and actions that read or drive it. */
export function removeLayer(p: PlayRecord, id: string): PlayRecord {
  const controls = p.controls.filter(c => !c.target.startsWith(`layer:${id}::`) && !c.target.startsWith(`act:${id}::`));
  const ids = new Set(controls.map(c => c.id));
  const out: PlayRecord = {
    ...p,
    // A layer that used it as its matte goes back to no matte; a path that used it as a corner loses that corner.
    layers: dropMatteRefs(p.layers.filter(l => l.id !== id), id).map(l => (l.kind === 'shape' && l.pointIds?.includes(id) ? { ...l, pointIds: l.pointIds.filter(x => x !== id) }
      // A relationship loses the member (and a member reading the layer's alpha reads brightness again).
      : l.kind === 'relationship' && l.members.some(m => m.id === id || m.layerId === id) ? { ...l, members: l.members.filter(m => m.id !== id).map(m => (m.layerId === id ? { ...m, layerId: '', channel: m.channel === 'layer' ? 'brightness' : m.channel } : m)) }
      // An Agents rule aimed at it has no target (the rule stays, idle); a null following its agents stops.
      : l.kind === 'agents' && l.rules.some(r => r.targetId === id) ? { ...l, rules: l.rules.map(r => (r.targetId === id ? { ...r, targetId: '' } : r)) }
      : l.kind === 'null' && l.follow === 'agent' && l.followId === id ? { ...l, follow: 'none' as const, followId: '' } : l)),
    controls,
    mappings: p.mappings.filter(m => ids.has(m.controlId)
      && !((m.source.kind === 'null' || m.source.kind === 'sensor') && m.source.layerId === id)
      && !(m.source.kind === 'trigger' && triggerReads(m.source.trigger, id)))
      // A distance to the removed layer has nothing to measure to: it asks for another.
      .map(m => (m.source.kind === 'sensor' && m.source.otherId === id ? { ...m, source: { ...m.source, otherId: '' } } : m)),
  };
  const actions = (p.actions ?? []).filter(a => a.layerId !== id && !triggerReads(a.trigger, id));
  if (actions.length) out.actions = actions; else delete out.actions;
  // The Background's matte goes back to none when its layer is removed.
  if (out.backgroundMatte?.id === id) delete out.backgroundMatte;
  return out;
}

/** Does a trigger read this layer (a shape trigger on it, a proximity trigger from or to it)? */
function triggerReads(t: TriggerSpec, id: string): boolean {
  return (t.on === 'zone' && t.layerId === id) || (t.on === 'proximity' && (t.a === id || t.b === id));
}

/** A copy right above the original (drawn on top), nudged so it can be told apart on the picture. */
export function duplicateLayer(p: PlayRecord, id: string): { play: PlayRecord; id: string } {
  const i = p.layers.findIndex(l => l.id === id);
  if (i < 0) return { play: p, id: '' };
  const src = p.layers[i] as unknown as Record<string, unknown>;
  const copy = { ...structuredClone(src), id: playId('layer'), label: `${String(src.label)} copy` } as Record<string, unknown>;
  if (typeof copy.x === 'number' && typeof copy.y === 'number') { copy.x = Math.min(1, (copy.x as number) + 0.03); copy.y = Math.max(0, (copy.y as number) - 0.03); }
  const layers = [...p.layers];
  layers.splice(i + 1, 0, copy as unknown as PlayLayer);
  // In a group, the copy joins it.
  const groups = p.groups?.map(g => (g.layers.includes(id) ? { ...g, layers: [...g.layers, copy.id as string] } : g));
  return { play: { ...p, layers, ...(groups ? { groups } : {}) }, id: copy.id as string };
}

/** Every setting back to the kind's default; the name, the id (so controls and mappings still reach it), visibility, the matte and the masks stay. */
export function resetLayer(p: PlayRecord, id: string): PlayRecord {
  return {
    ...p,
    // A layer of a saved kind goes back to that kind's code and values, not to the starter sketch.
    // A Background layer keeps its queue, a Data layer its dataset: they are what it is, not a setting.
    layers: p.layers.map(l => (l.id === id ? keepMatteAndMasks(l, resetKindLayer(p, l) ?? { ...defaultLayer(l.kind, l.id, l.label), visible: l.visible, ...(l.kind === 'background' ? { sources: l.sources } : l.kind === 'data' ? { dataset: l.dataset } : {}) } as PlayLayer) : l)),
  };
}

/** A layer's matte, masks and mask numbers carried onto `to`. */
function keepMatteAndMasks(from: PlayLayer, to: PlayLayer): PlayLayer {
  if (!from.trackMatte && !from.masks?.length) return to;
  const out = { ...to } as Record<string, unknown>;
  for (const [k, v] of Object.entries(from)) if (k === 'trackMatte' || k === 'masks' || k.startsWith('mask_')) out[k] = v;
  return out as unknown as PlayLayer;
}

/** One step in the flat draw order. With groups in the list, use moveItem (groupOps.ts), which moves among neighbours. */
export function moveLayer(p: PlayRecord, id: string, dir: -1 | 1): PlayRecord {
  const i = p.layers.findIndex(l => l.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.layers.length) return p;
  // The Background layer stays at the bottom.
  if (p.layers[i].kind === 'background' || p.layers[j].kind === 'background') return p;
  const layers = [...p.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...p, layers };
}

/**
 * A new null placed where the layer is (or the middle), with `key` on that
 * layer pointing at it: "follow a null" in one step. A null's own followId
 * gets the new null to follow it, one step along.
 */
export function addNullFor(p: PlayRecord, layerId: string, key: string): { play: PlayRecord; id: string } {
  const owner = p.layers.find(l => l.id === layerId) as unknown as Record<string, unknown> | undefined;
  if (!owner) return { play: p, id: '' };
  const id = playId('layer');
  const n = p.layers.filter(l => l.kind === 'null').length + 1;
  const nul = defaultLayer('null', id, `Null ${n}`) as NullLayer;
  if (typeof owner.x === 'number' && typeof owner.y === 'number') {
    nul.x = owner.x as number; nul.y = owner.y as number;
    if (owner.kind === 'null') { nul.x = Math.min(0.95, nul.x + 0.1); }
  }
  const layers = p.layers.map(l => (l.id === layerId ? ({ ...l, [key]: id } as PlayLayer) : l));
  return { play: { ...p, layers: [...layers, nul] }, id };
}

/**
 * Two nulls that follow the index fingertips (right and left hand), for hand
 * tracking in one step. A side that already has a null following its index
 * tip isn't added again.
 */
export function addFingertipNulls(p: PlayRecord): PlayRecord {
  const have = (side: 'right' | 'left') => p.layers.some(l => l.kind === 'null' && (l as NullLayer).follow === 'hand' && (l as NullLayer).handSide === side && (l as NullLayer).handPoint === 8);
  const added: PlayLayer[] = [];
  for (const side of ['right', 'left'] as const) {
    if (have(side)) continue;
    const nul = defaultLayer('null', playId('layer'), side === 'right' ? 'Right index tip' : 'Left index tip') as NullLayer;
    nul.follow = 'hand'; nul.handSide = side; nul.handPoint = 8;
    nul.x = side === 'right' ? 0.62 : 0.38; nul.y = 0.5;
    added.push(nul);
  }
  return added.length ? { ...p, layers: [...p.layers, ...added] } : p;
}

/** The fingertips a hand path starts from, in order round the shape: both index tips up, both thumbs below. */
export const HAND_PATH_POINTS: ReadonlyArray<{ side: 'right' | 'left'; point: number; label: string; x: number; y: number }> = [
  { side: 'right', point: 8, label: 'Right index tip', x: 0.64, y: 0.66 },
  { side: 'right', point: 4, label: 'Right thumb tip', x: 0.6, y: 0.36 },
  { side: 'left', point: 4, label: 'Left thumb tip', x: 0.4, y: 0.36 },
  { side: 'left', point: 8, label: 'Left index tip', x: 0.36, y: 0.66 },
];

/**
 * A filled path shape between both hands' thumb and index tips: four
 * corners that move with your hands, wrapped round the outside (Hull) so
 * crossing fingers never make a bow-tie. Nulls already following those
 * points are used; missing ones are added (resting where a frame of hands
 * would be, until tracking starts). Returns the record and the shape's id.
 */
export function addHandPath(p: PlayRecord, id = playId('layer')): { play: PlayRecord; id: string } {
  const { play: withNulls, ids: pointIds } = handPathNulls(p);
  const n = p.layers.filter(l => l.kind === 'shape' && l.shape === 'path').length + 1;
  const shape = defaultLayer('shape', id, `Hand path ${n}`) as ShapeLayer;
  Object.assign(shape, { shape: 'path', pointIds, pathStyle: 'fill', hull: true, onLost: 'fade', action: 'none', fill: [0.45, 0.8, 1], fillOpacity: 0.35, stroke: [0.45, 0.8, 1], strokeWidth: 2 });
  return { play: { ...withNulls, layers: [...withNulls.layers, shape] }, id };
}

/** The nulls on both hands' thumb and index tips (HAND_PATH_POINTS order): the ones there, plus any missing, added. */
export function handPathNulls(p: PlayRecord): { play: PlayRecord; ids: string[] } {
  const added: PlayLayer[] = [];
  const ids = HAND_PATH_POINTS.map(h => {
    const have = p.layers.find(l => l.kind === 'null' && l.follow === 'hand' && l.handSide === h.side && l.handPoint === h.point);
    if (have) return have.id;
    const nul = defaultLayer('null', playId('layer'), h.label) as NullLayer;
    Object.assign(nul, { follow: 'hand', handSide: h.side, handPoint: h.point, x: h.x, y: h.y, spring: 0.7, wobble: 0.15, size: 6 });
    added.push(nul);
    return nul.id;
  });
  return { play: added.length ? { ...p, layers: [...p.layers, ...added] } : p, ids };
}

/** The same three things the picture's right-click menu offers. */
export function layerMenuItems({ onDuplicate, onReset, onRemove, onRule }: { onDuplicate: () => void; onReset: () => void; onRemove: () => void; onRule?: () => void }) {
  return [
    ...(onRule ? [{ label: 'Rule for this layer…', hint: 'When something happens, do something to it', onSelect: onRule }] : []),
    { label: 'Duplicate', hint: 'A copy on top, slightly offset', onSelect: onDuplicate },
    { label: 'Reset to defaults', hint: 'Every setting back to new; the name, controls and mappings stay', onSelect: onReset },
    { label: 'Delete', hint: 'With the controls and mappings that use it', onSelect: onRemove, danger: true },
  ];
}

/** The Background layer's menu: no Duplicate (there is only one). */
export function backgroundMenuItems({ onReset, onRemove }: { onReset: () => void; onRemove: () => void }) {
  return [
    { label: 'Reset settings', hint: 'Index, placement and transition back to new; the queue, controls and mappings stay', onSelect: onReset },
    { label: 'Delete', hint: 'The header’s Background setting decides again', onSelect: onRemove, danger: true },
  ];
}

/**
 * Rename a layer, and its controls with it: a control still named after the
 * layer ("Old · Speed") becomes "New · Speed". Controls you renamed yourself
 * are left alone.
 */
export function renameLayer(p: PlayRecord, id: string, label: string): PlayRecord {
  const old = p.layers.find(l => l.id === id)?.label;
  if (old === undefined || old === label) return p;
  return {
    ...p,
    layers: p.layers.map(l => (l.id === id ? { ...l, label } : l)),
    controls: p.controls.map(c => (c.target.startsWith(`layer:${id}::`) && c.label.startsWith(`${old} · `) ? { ...c, label: label + c.label.slice(old.length) } : c)),
  };
}

/** A slider a null should drive: its target, range and value now, and which way of the null moves it. */
export interface NullDrive {
  target: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  axis: 'x' | 'y';
}

/**
 * The other half of an X/Y pair ("posX" → "posY", "x" → "y", "centerY" →
 * "centerX"), so one null can drive both. The key ends in X or Y after a
 * lower-case letter, or is just "x"/"y".
 */
export function pairedKey(key: string): { axis: 'x' | 'y'; other: string } | null {
  const m = /^(|.*[a-z0-9_])([XxYy])$/.exec(key);
  if (!m) return null;
  const c = m[2];
  const axis = c === 'x' || c === 'X' ? 'x' : 'y';
  const swap = c === 'x' ? 'y' : c === 'y' ? 'x' : c === 'X' ? 'Y' : 'X';
  return { axis, other: m[1] + swap };
}

/**
 * Add a Null layer on the picture that drives one or two controls (X across
 * its range left to right, Y bottom to top), making each control if the
 * panel doesn't have it yet. The null starts where the values are now, so
 * nothing jumps.
 */
export function driveWithNull(p: PlayRecord, drives: NullDrive[], label: string): { play: PlayRecord; nullId: string; controlIds: string[] } {
  const nullId = playId('layer');
  const nul = defaultLayer('null', nullId, label) as NullLayer;
  // Where along the control's range the value is now (the control's range, when it's already on the panel).
  const at = (value: number, c: PlayControl) => {
    const span = c.max - c.min;
    return Math.max(0.03, Math.min(0.97, span ? (value - c.min) / span : 0.5));
  };
  const controls = [...p.controls];
  const mappings = [...p.mappings];
  const controlIds: string[] = [];
  for (const d of drives) {
    let c = controls.find(x => x.target === d.target);
    if (!c) {
      c = { id: playId('ctl'), target: d.target, kind: 'float', label: d.label, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) } as PlayControl;
      controls.push(c);
    }
    controlIds.push(c.id);
    if (d.axis === 'x') nul.x = at(d.value, c); else nul.y = at(d.value, c);
    mappings.push({ id: playId('map'), controlId: c.id, source: { kind: 'null', layerId: nullId, axis: d.axis }, outMin: c.min, outMax: c.max, curve: 'linear', smoothMs: 0, enabled: true });
  }
  // An axis nothing drives (a single slider moves the dot sideways): pick a height clear of the other nulls.
  if (!drives.some(d => d.axis === 'y')) {
    const others = p.layers.filter((l): l is NullLayer => l.kind === 'null');
    nul.y = [0.5, 0.3, 0.7, 0.15, 0.85].find(y => others.every(o => Math.hypot(o.x - nul.x, o.y - y) > 0.12)) ?? 0.5;
  }
  return { play: { ...p, layers: [...p.layers, nul], controls, mappings }, nullId, controlIds };
}

/** A slider as the null helpers see it: where it lives, its key (for X/Y pairing), range and value now. */
interface Slider { target: string; key: string; label: string; min: number; max: number; step?: number; value: number }

/**
 * What a null should drive when `picked` is chosen: the slider, and its X/Y
 * partner among `siblings` when it has one (posX with posY), so one null
 * moves both. The label names the null.
 */
export function nullDrivesFor(picked: Slider, siblings: readonly Slider[]): { drives: NullDrive[]; label: string } {
  const one = (d: Slider, axis: 'x' | 'y'): NullDrive => ({ target: d.target, label: d.label, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}), value: d.value, axis });
  const pair = pairedKey(picked.key);
  const partner = pair && siblings.find(s => s.key === pair.other);
  if (pair && partner) {
    const [x, y] = pair.axis === 'x' ? [picked, partner] : [partner, picked];
    return { drives: [one(x, 'x'), one(y, 'y')], label: `${x.label.replace(/[\s·_-]*[Xx]$/, '') || x.label} null` };
  }
  return { drives: [one(picked, 'x')], label: `${picked.label} null` };
}

const graphSlider = (c: PlayCandidate): Slider => ({ target: c.target, key: targetParts(c.target).paramKey, label: candidateLabel(c), min: c.min, max: c.max, step: c.step, value: typeof c.value === 'number' ? c.value : c.min });

/** A graph slider (and its X/Y partner on the same node), ready for driveWithNull. */
export function graphNullDrives(candidates: readonly PlayCandidate[], c: PlayCandidate): { drives: NullDrive[]; label: string } {
  const node = targetParts(c.target).nodeId;
  return nullDrivesFor(graphSlider(c), candidates.filter(x => x.kind === 'float' && targetParts(x.target).nodeId === node).map(graphSlider));
}

/** A layer's numeric property (and its X/Y partner), ready for driveWithNull. */
export function layerNullDrives(l: PlayLayer, key: string): { drives: NullDrive[]; label: string } | null {
  const rec = l as unknown as Record<string, unknown>;
  const sliders: Slider[] = layerNumericProps(l).map(d => ({
    target: layerTarget(l.id, d.key), key: d.key, label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}),
    value: typeof rec[d.key] === 'number' ? rec[d.key] as number : d.min,
  }));
  const picked = sliders.find(s => s.key === key);
  return picked ? nullDrivesFor(picked, sliders) : null;
}

/** A graph param as a panel control (unchanged when it's already one). */
export function addCandidateControl(p: PlayRecord, c: PlayCandidate): PlayRecord {
  if (p.controls.some(x => x.target === c.target)) return p;
  return { ...p, controls: [...p.controls, { id: playId('ctl'), target: c.target, kind: c.kind, label: candidateLabel(c), min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}) }] };
}

/** A layer's numeric property as a panel control (unchanged when it's already one). */
export function addLayerPropControl(p: PlayRecord, layerId: string, key: string): PlayRecord {
  const l = p.layers.find(x => x.id === layerId);
  const d = l && layerNumericProps(l).find(x => x.key === key);
  const target = layerTarget(layerId, key);
  if (!l || !d || p.controls.some(c => c.target === target)) return p;
  return { ...p, controls: [...p.controls, { id: playId('ctl'), target, kind: 'float', label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) }] };
}

/** A Finish effect's number as a panel control (unchanged when it's already one). */
export function addFinishPropControl(p: PlayRecord, effectId: string, key: string): PlayRecord {
  const e = finishHost(p.finish, effectId);
  const d = e && finishParamOf(e, key);
  const target = finishTarget(effectId, key);
  if (!e || !d || p.controls.some(c => c.target === target)) return p;
  return { ...p, controls: [...p.controls, { id: playId('ctl'), target, kind: 'float', label: `${finishHostLabel(e)} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) }] };
}

/** An audio effect's number (`audiofx:<chain>:<effect>::<key>`) as a panel control (unchanged when it's already one). */
export function addAudioFxPropControl(p: PlayRecord, target: string): PlayRecord {
  const c = audioFxControlFor(p.audioFx, p.layers, target);
  if (!c || p.controls.some(x => x.target === target)) return p;
  return { ...p, controls: [...p.controls, { id: playId('ctl'), ...c }] };
}

/** A mapping's target: an existing control, a graph candidate, or a layer/Finish/sound number. */
export type MapTarget = { control: string } | { candidate: PlayCandidate } | { layerId: string; key: string } | { effectId: string; key: string } | { audioFx: string };

/**
 * The control `target` names, made first if it doesn't exist yet (no mapping: the "Control
 * only" path a source picker offers alongside its sources). Shared by mapSourceTo.
 */
export function resolveTargetControl(p: PlayRecord, target: MapTarget): { play: PlayRecord; control?: PlayControl } {
  let rec = p, targetKey: string;
  if ('control' in target) targetKey = p.controls.find(c => c.id === target.control)?.target ?? '';
  else if ('audioFx' in target) { rec = addAudioFxPropControl(rec, target.audioFx); targetKey = target.audioFx; }
  else if ('candidate' in target) { rec = addCandidateControl(rec, target.candidate); targetKey = target.candidate.target; }
  else if ('effectId' in target) { rec = addFinishPropControl(rec, target.effectId, target.key); targetKey = finishTarget(target.effectId, target.key); }
  else { rec = addLayerPropControl(rec, target.layerId, target.key); targetKey = layerTarget(target.layerId, target.key); }
  return { play: rec, control: rec.controls.find(c => c.target === targetKey) };
}

/** Map `source` onto the control at `target` (made first if needed), across its whole range. Returns the record and the control. */
export function mapSourceTo(p: PlayRecord, source: PlaySource, target: MapTarget, smoothMs = 60): { play: PlayRecord; control?: PlayControl } {
  const { play: rec, control } = resolveTargetControl(p, target);
  if (!control) return { play: p };
  const mapping: PlayMapping = { id: playId('map'), controlId: control.id, source, outMin: control.min, outMax: control.max, curve: 'linear', smoothMs, enabled: true };
  return { play: { ...rec, mappings: [...rec.mappings, mapping] }, control };
}
