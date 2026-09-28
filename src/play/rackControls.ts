/**
 * rackControls.ts — a rack's controls (docs/arrangement.md, Configure): up
 * to RACK_CONTROLS_MAX parameters of an instrument or an effect picked to be
 * played on the rack card's strip. Each is an ordinary Play control on
 * `au:<rack>:<slot>::<address>` (mappable to a MIDI knob, recorded by takes
 * and on the tape) in the group "<rack> · <slot name>"; the slot keeps their
 * addresses in the strip's order (`slot.controls`).
 *
 * Pure: record in, record out (each call one undo step).
 */
import type { PlayControl, PlayRecord } from '../types/play';
import { RACK_CONTROLS_MAX } from '../types/playArrangement';
import { aeRack, aeSlot, aeSlotName, auTarget, patchSlot, type AeRack, type AeSlot } from '../types/playAudioEngine';
import { withEngine } from '../components/play/engine/engineOps';
import { playId } from './playControls';

/** A parameter a rack control can be made from (an Audio Unit's, or a granulator setting). */
export interface RackParamInfo { address: string; name: string; min: number; max: number; step?: number; value: number }

/** The controls' group: "Rack 1 · Juno-60". */
export const rackControlGroup = (rack: AeRack, slot: AeSlot) => `${rack.name} · ${aeSlotName(slot)}`;

/** A slot's rack controls, in the strip's order, with their Play controls (ones deleted elsewhere left out). */
export function rackControlsOf(p: Pick<PlayRecord, 'controls'>, rack: AeRack, slot: AeSlot): Array<{ address: string; control: PlayControl }> {
  const out: Array<{ address: string; control: PlayControl }> = [];
  for (const address of slot.controls ?? []) {
    const target = auTarget(rack.id, slot.id, address);
    const control = p.controls.find(c => c.target === target);
    if (control) out.push({ address, control });
  }
  return out;
}

/** Every rack control target on a rack (its instrument's and its effects'). */
export function rackControlTargets(p: Pick<PlayRecord, 'controls'>, rack: AeRack): string[] {
  const out: string[] = [];
  for (const s of [rack.instrument, ...rack.effects]) if (s) for (const { control } of rackControlsOf(p, rack, s)) out.push(control.target);
  return out;
}

/** Can this slot take another rack control? */
export function canAddRackControl(p: Pick<PlayRecord, 'controls'>, rack: AeRack, slot: AeSlot): boolean {
  return rackControlsOf(p, rack, slot).length < RACK_CONTROLS_MAX;
}

/**
 * Make a parameter a rack control: a Play control in the slot's group (an
 * existing control on that parameter joins the group instead), its value
 * kept in the record so the control starts there. Full or already there:
 * the record as it was.
 */
export function addRackControl(p: PlayRecord, rackId: string, slotId: string, param: RackParamInfo): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId), slot = aeSlot(rack, slotId);
  if (!rack || !slot) return p;
  const live = rackControlsOf(p, rack, slot).map(x => x.address);
  if (live.includes(param.address) || live.length >= RACK_CONTROLS_MAX) return p;
  const target = auTarget(rackId, slotId, param.address);
  const group = rackControlGroup(rack, slot);
  const params = { ...slot.params, [param.address]: slot.params?.[param.address] ?? param.value };
  let out = withEngine(p, patchSlot(p.audioEngine, rackId, slotId, { params, controls: [...live, param.address] }));
  const had = out.controls.find(c => c.target === target);
  out = {
    ...out,
    controls: had
      ? out.controls.map(c => (c === had ? { ...c, group } : c))
      : [...out.controls, { id: playId('ctl'), target, kind: 'float', label: param.name, min: param.min, max: param.max, ...(param.step ? { step: param.step } : {}), group }],
  };
  return out;
}

/** Stop being a rack control: the Play control and its mappings go too. */
export function removeRackControl(p: PlayRecord, rackId: string, slotId: string, address: string): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId), slot = aeSlot(rack, slotId);
  if (!rack || !slot) return p;
  const target = auTarget(rackId, slotId, address);
  const controls = (slot.controls ?? []).filter(a => a !== address);
  let out = withEngine(p, patchSlot(p.audioEngine, rackId, slotId, { controls: controls.length ? controls : undefined }));
  const gone = out.controls.filter(c => c.target === target).map(c => c.id);
  if (gone.length) out = { ...out, controls: out.controls.filter(c => !gone.includes(c.id)), mappings: out.mappings.filter(m => !gone.includes(m.controlId)) };
  if (out.arrangement?.tracks[rackId]?.auto[target]) {
    const t = out.arrangement.tracks[rackId];
    const auto = { ...t.auto };
    delete auto[target];
    out = { ...out, arrangement: { ...out.arrangement, tracks: { ...out.arrangement.tracks, [rackId]: { ...t, auto } } } };
  }
  return out;
}

/** Rename a rack control (its Play control's label). */
export function renameRackControl(p: PlayRecord, rackId: string, slotId: string, address: string, label: string): PlayRecord {
  const name = label.trim().slice(0, 80);
  const target = auTarget(rackId, slotId, address);
  if (!name) return p;
  return { ...p, controls: p.controls.map(c => (c.target === target ? { ...c, label: name } : c)) };
}

/** Move a rack control one place earlier (−1) or later (+1) on the strip; the Controls tab's order follows. */
export function moveRackControl(p: PlayRecord, rackId: string, slotId: string, address: string, by: -1 | 1): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId), slot = aeSlot(rack, slotId);
  if (!rack || !slot?.controls) return p;
  const list = [...slot.controls];
  const i = list.indexOf(address), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return p;
  [list[i], list[j]] = [list[j], list[i]];
  const out = withEngine(p, patchSlot(p.audioEngine, rackId, slotId, { controls: list }));
  const a = out.controls.findIndex(c => c.target === auTarget(rackId, slotId, list[i]));
  const b = out.controls.findIndex(c => c.target === auTarget(rackId, slotId, list[j]));
  if (a < 0 || b < 0) return out;
  const controls = [...out.controls];
  [controls[a], controls[b]] = [controls[b], controls[a]];
  return { ...out, controls };
}

/** After a rack (or its instrument) is renamed or replaced: every rack control's group follows its rack's name. */
export function regroupRackControls(p: PlayRecord): PlayRecord {
  let changed = false;
  const groups = new Map<string, string>();
  for (const r of p.audioEngine?.racks ?? []) {
    for (const s of [r.instrument, ...r.effects]) if (s) for (const a of s.controls ?? []) groups.set(auTarget(r.id, s.id, a), rackControlGroup(r, s));
  }
  const controls = p.controls.map(c => {
    const g = groups.get(c.target);
    if (!g || c.group === g) return c;
    changed = true;
    return { ...c, group: g };
  });
  return changed ? { ...p, controls } : p;
}
