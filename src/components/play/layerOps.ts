/**
 * layerOps.ts — edits to a Play record's layers that more than one place
 * offers (the Layers list, the picture's right-click menu): remove with
 * everything that pointed at it, duplicate, reset to defaults, move in the
 * draw order, make a null for a property that follows one, and make a null
 * that drives a control.
 */
import { defaultLayer, type NullLayer, type PlayControl, type PlayLayer, type PlayRecord } from '../../types/play';
import { playId } from '../../play/playControls';

/** Remove a layer and the controls, mappings and actions that read or drive it. */
export function removeLayer(p: PlayRecord, id: string): PlayRecord {
  const controls = p.controls.filter(c => !c.target.startsWith(`layer:${id}::`));
  const ids = new Set(controls.map(c => c.id));
  const out: PlayRecord = {
    ...p,
    layers: p.layers.filter(l => l.id !== id),
    controls,
    mappings: p.mappings.filter(m => ids.has(m.controlId)
      && !((m.source.kind === 'null' || m.source.kind === 'sensor') && m.source.layerId === id)
      && !(m.source.kind === 'trigger' && m.source.trigger.on === 'zone' && m.source.trigger.layerId === id)),
  };
  const actions = (p.actions ?? []).filter(a => a.layerId !== id && !(a.trigger.on === 'zone' && a.trigger.layerId === id));
  if (actions.length) out.actions = actions; else delete out.actions;
  return out;
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
  return { play: { ...p, layers }, id: copy.id as string };
}

/** Every setting back to the kind's default; the name, the id (so controls and mappings still reach it) and visibility stay. */
export function resetLayer(p: PlayRecord, id: string): PlayRecord {
  return {
    ...p,
    layers: p.layers.map(l => (l.id === id ? { ...defaultLayer(l.kind, l.id, l.label), visible: l.visible } as PlayLayer : l)),
  };
}

export function moveLayer(p: PlayRecord, id: string, dir: -1 | 1): PlayRecord {
  const i = p.layers.findIndex(l => l.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.layers.length) return p;
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

/** The same three things the picture's right-click menu offers. */
export function layerMenuItems({ onDuplicate, onReset, onRemove }: { onDuplicate: () => void; onReset: () => void; onRemove: () => void }) {
  return [
    { label: 'Duplicate', hint: 'A copy on top, slightly offset', onSelect: onDuplicate },
    { label: 'Reset to defaults', hint: 'Every setting back to new; the name, controls and mappings stay', onSelect: onReset },
    { label: 'Delete', hint: 'With the controls and mappings that use it', onSelect: onRemove, danger: true },
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
  return { play: { ...p, layers: [...p.layers, nul], controls, mappings }, nullId, controlIds };
}
