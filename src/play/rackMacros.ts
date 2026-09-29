/**
 * rackMacros.ts — a rack's Macro Controls (docs/audio-engine.md, "Macros"),
 * like Ableton's: 8 knobs on each rack, each turning any number of its
 * devices' parameters (an Audio Unit's, a Granulator's settings), each
 * target through its own curve and range (play/kit/macros.js).
 *
 * The macro is what gets mapped from outside: a Play control on
 * `macro:<rack>::<n>` in the group "<rack> · Macros" (MIDI Learn, the mini
 * mapper, readers, increments, quick link, the tape and takes). The record
 * keeps each macro's value and writes its targets' values into their slots'
 * `params` whenever it's set by hand, so a saved setup, a preset and a render
 * start where the knob is; while a mapping (or the tape) drives the macro,
 * the host fans the driven value out every frame (`macroValueOf`).
 *
 * A rack control (Configure) can be moved onto a macro, and a macro target
 * detached as a rack control again.
 *
 * Pure: record in, record out (each call one undo step).
 */
import type { PlayControl, PlayRecord } from '../types/play';
import { RACK_CONTROLS_MAX } from '../types/playArrangement';
import {
  MACRO_TARGETS_MAX, aeRack, aeSlot, auPropId, macroCanTarget, macroPropId, macroTarget, parseMacroTarget, patchRack, rackMacros,
  type AeRack, type MacroCurve, type PlayAudioEngine, type RackMacro, type RackMacroTarget,
} from '../types/playAudioEngine';
import { mcCurve, mcTargetValue } from './kit/macros.js';
import { addRackControl, rackControlsOf, removeRackControl } from './rackControls';
import { playId } from './playControls';

export { mcCurve, mcTargetValue };

/** The macros' group on the Controls tab: "Rack 1 · Macros". */
export const macroControlGroup = (rack: Pick<AeRack, 'name'>) => `${rack.name} · Macros`;
/** A macro's Play control label: "Rack 1 · Macro 3". */
export const macroControlLabel = (rack: Pick<AeRack, 'name'>, m: Pick<RackMacro, 'name'>) => `${rack.name} · ${m.name}`;

/** A parameter a macro can be pointed at: where it is, its name and full range, its value now. */
export interface MacroParamInfo { slot: string; address: string; name: string; lo: number; hi: number; value?: number }

/** The Play control on a macro, if it has one. */
export function macroControl(p: Pick<PlayRecord, 'controls'>, rackId: string, n: number): PlayControl | undefined {
  const t = macroTarget(rackId, n);
  return p.controls.find(c => c.target === t);
}

/** Put a rack's macros back (always RACK_MACROS), with `fn` applied to macro n. */
function patchMacros(ae: PlayAudioEngine | undefined, rackId: string, n: number, fn: (m: RackMacro) => RackMacro): PlayAudioEngine {
  return patchRack(ae, rackId, r => ({ ...r, macros: rackMacros(r).map((m, i) => (i === n - 1 ? fn(m) : m)) }));
}

/** Each target's value for the macro's value, written into its slot's `params`. */
export function applyMacro(ae: PlayAudioEngine | undefined, rackId: string, n: number): PlayAudioEngine | undefined {
  const rack = aeRack(ae, rackId);
  const m = rack ? rackMacros(rack)[n - 1] : undefined;
  if (!rack || !m?.targets.length) return ae;
  let out = ae;
  const bySlot = new Map<string, Record<string, number>>();
  for (const t of m.targets) {
    const s = aeSlot(rack, t.slot);
    if (!macroCanTarget(s, t.address)) continue;
    const params = bySlot.get(t.slot) ?? { ...s!.params };
    params[t.address] = mcTargetValue(m.value, t);
    bySlot.set(t.slot, params);
  }
  for (const [slot, params] of bySlot) {
    out = patchRack(out, rackId, r => (slot === 'inst'
      ? { ...r, instrument: r.instrument ? { ...r.instrument, params } : r.instrument }
      : { ...r, effects: r.effects.map(e => (e.id === slot ? { ...e, params } : e)) }));
  }
  return out;
}

/** Turn a macro (0..1): its value and every target's, in one step. */
export function setMacroValue(p: PlayRecord, rackId: string, n: number, value: number): PlayRecord {
  if (!aeRack(p.audioEngine, rackId)) return p;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const ae = applyMacro(patchMacros(p.audioEngine, rackId, n, m => ({ ...m, value: v })), rackId, n);
  return ae ? { ...p, audioEngine: ae } : p;
}

/** Rename a macro, or give it a colour ('' takes it off); its Play control's label follows the name. */
export function patchMacro(p: PlayRecord, rackId: string, n: number, patch: { name?: string; color?: string }): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack) return p;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 40) : undefined;
  if (name === '') return p;
  const ae = patchMacros(p.audioEngine, rackId, n, m => {
    const out = { ...m, ...(name ? { name } : {}) };
    if (patch.color !== undefined) { if (/^#[0-9a-fA-F]{6}$/.test(patch.color)) out.color = patch.color; else delete out.color; }
    return out;
  });
  const out = { ...p, audioEngine: ae };
  if (!name) return out;
  const target = macroTarget(rackId, n);
  return { ...out, controls: out.controls.map(c => (c.target === target ? { ...c, label: macroControlLabel(rack, { name }) } : c)) };
}

/** The macro's Play control, made if it has none: "Rack 1 · Macro 3" in "Rack 1 · Macros", 0..1. */
export function ensureMacroControl(p: PlayRecord, rackId: string, n: number): { play: PlayRecord; control?: PlayControl } {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack || n < 1 || n > rackMacros(rack).length) return { play: p };
  const had = macroControl(p, rackId, n);
  if (had) return { play: p, control: had };
  const m = rackMacros(rack)[n - 1];
  const control: PlayControl = { id: playId('ctl'), target: macroTarget(rackId, n), kind: 'float', label: macroControlLabel(rack, m), min: 0, max: 1, group: macroControlGroup(rack) };
  return { play: { ...p, controls: [...p.controls, control] }, control };
}

/**
 * Point a macro at a parameter: its whole range, linear, the parameter moved
 * to where the macro is (as Ableton does). Already a target: the record as it
 * was. The macro's Play control is made too, so it can be mapped at once.
 */
export function addMacroTarget(p: PlayRecord, rackId: string, n: number, param: MacroParamInfo, opts: { min?: number; max?: number; curve?: MacroCurve } = {}): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  const m = rack ? rackMacros(rack)[n - 1] : undefined;
  if (!rack || !m || !macroCanTarget(aeSlot(rack, param.slot), param.address)) return p;
  if (m.targets.length >= MACRO_TARGETS_MAX || m.targets.some(t => t.slot === param.slot && t.address === param.address)) return p;
  const t: RackMacroTarget = { slot: param.slot, address: param.address, min: opts.min ?? param.lo, max: opts.max ?? param.hi, curve: opts.curve ?? 'linear', name: param.name, lo: param.lo, hi: param.hi };
  const ae = applyMacro(patchMacros(p.audioEngine, rackId, n, x => ({ ...x, targets: [...x.targets, t] })), rackId, n);
  return ensureMacroControl({ ...p, audioEngine: ae }, rackId, n).play;
}

/** Change one of a macro's targets (its range, curve or breakpoints); the parameter follows at once. */
export function patchMacroTarget(p: PlayRecord, rackId: string, n: number, index: number, patch: Partial<Pick<RackMacroTarget, 'min' | 'max' | 'curve' | 'points'>>): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  const m = rack ? rackMacros(rack)[n - 1] : undefined;
  if (!rack || !m?.targets[index]) return p;
  const ae = applyMacro(patchMacros(p.audioEngine, rackId, n, x => ({
    ...x,
    targets: x.targets.map((t, i) => {
      if (i !== index) return t;
      const out: RackMacroTarget = { ...t, ...patch };
      if (out.curve === 'custom') { if (!out.points || out.points.length < 4) out.points = [0, 0, 0.5, 0.5, 1, 1]; }
      else delete out.points;
      return out;
    }),
  })), rackId, n);
  return { ...p, audioEngine: ae };
}

/** Stop a macro turning a parameter (it stays where it is). */
export function removeMacroTarget(p: PlayRecord, rackId: string, n: number, index: number): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack || !rackMacros(rack)[n - 1]?.targets[index]) return p;
  return { ...p, audioEngine: patchMacros(p.audioEngine, rackId, n, x => ({ ...x, targets: x.targets.filter((_, i) => i !== index) })) };
}

/**
 * "Move to macro n": a rack control becomes one of the macro's targets over
 * the control's range, and leaves the direct controls (its Play control, its
 * mappings and its moves on the tape go, as removing it does).
 */
export function moveControlToMacro(p: PlayRecord, rackId: string, slotId: string, address: string, n: number): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId), slot = aeSlot(rack, slotId);
  if (!rack || !slot) return p;
  const rc = rackControlsOf(p, rack, slot).find(x => x.address === address);
  if (!rc) return p;
  const m = rackMacros(rack)[n - 1];
  if (!m || m.targets.length >= MACRO_TARGETS_MAX || m.targets.some(t => t.slot === slotId && t.address === address)) return p;
  const { control } = rc;
  const removed = removeRackControl(p, rackId, slotId, address);
  return addMacroTarget(removed, rackId, n, { slot: slotId, address, name: control.label, lo: control.min, hi: control.max });
}

/**
 * "Detach as a control": a macro target becomes a rack control on its device
 * again (at the value it has now), and the macro stops turning it. The
 * device full (RACK_CONTROLS_MAX): nothing changes (`ok` false).
 */
export function detachMacroTarget(p: PlayRecord, rackId: string, n: number, index: number): { record: PlayRecord; ok: boolean } {
  const rack = aeRack(p.audioEngine, rackId);
  const t = rack ? rackMacros(rack)[n - 1]?.targets[index] : undefined;
  const slot = t ? aeSlot(rack, t.slot) : undefined;
  if (!rack || !t || !slot) return { record: p, ok: false };
  const live = rackControlsOf(p, rack, slot);
  if (!live.some(x => x.address === t.address) && live.length >= RACK_CONTROLS_MAX) return { record: p, ok: false };
  const lo = t.lo ?? Math.min(t.min, t.max), hi = t.hi ?? Math.max(t.min, t.max);
  const value = slot.params?.[t.address] ?? mcTargetValue(rackMacros(rack)[n - 1].value, t);
  const out = removeMacroTarget(p, rackId, n, index);
  return { record: addRackControl(out, rackId, t.slot, { address: t.address, name: t.name ?? `Parameter ${t.address}`, min: lo, max: hi, value }), ok: true };
}

type ValueOf = (id: string, key: string, base: number) => number;

const fanIndex = new WeakMap<PlayAudioEngine, Map<string, Array<{ rackId: string; n: number; target: RackMacroTarget }>>>();

/** `${auPropId}\0${address}` → the macros turning that parameter (cached per engine record). */
function macroIndex(ae: PlayAudioEngine): Map<string, Array<{ rackId: string; n: number; target: RackMacroTarget }>> {
  let idx = fanIndex.get(ae);
  if (idx) return idx;
  idx = new Map();
  for (const r of ae.racks) {
    (r.macros ?? []).forEach((m, i) => {
      for (const target of m.targets) {
        const k = `${auPropId(r.id, target.slot)}\u0000${target.address}`;
        const list = idx!.get(k) ?? [];
        list.push({ rackId: r.id, n: i + 1, target });
        idx!.set(k, list);
      }
    });
  }
  fanIndex.set(ae, idx);
  return idx;
}

/**
 * The parameters as the host should drive them: a parameter whose macro is
 * being driven (a mapping, the tape: `valueOf` has a value for
 * `macro:<rack>` / n) takes the macro's value through its curve and range;
 * anything else reads as `valueOf` says (a rack control's own mapping, else
 * the record, where a macro set by hand already wrote it).
 */
export function macroValueOf(ae: PlayAudioEngine | undefined, valueOf: ValueOf): ValueOf {
  if (!ae?.racks.some(r => r.macros?.some(m => m.targets.length))) return valueOf;
  const idx = macroIndex(ae);
  return (id, key, base) => {
    const hits = idx.get(`${id}\u0000${key}`);
    if (hits) {
      for (const h of hits) {
        const v = valueOf(macroPropId(h.rackId), String(h.n), Number.NaN);
        if (!Number.isNaN(v)) return mcTargetValue(v, h.target);
      }
    }
    return valueOf(id, key, base);
  };
}

const paramTargets = new WeakMap<PlayAudioEngine, Array<{ rackId: string; slotId: string; address: string }>>();

/** Every parameter a rack's macros turn (cached per engine record: the host asks every frame), as `au:` targets' parts (the host drives these along with the rack controls). */
export function macroParamTargets(ae: PlayAudioEngine | undefined): Array<{ rackId: string; slotId: string; address: string }> {
  if (!ae) return [];
  const had = paramTargets.get(ae);
  if (had) return had;
  const out: Array<{ rackId: string; slotId: string; address: string }> = [];
  paramTargets.set(ae, out);
  const seen = new Set<string>();
  for (const r of ae?.racks ?? []) {
    for (const m of r.macros ?? []) {
      for (const t of m.targets) {
        const k = `${r.id}/${t.slot}/${t.address}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ rackId: r.id, slotId: t.slot, address: t.address });
      }
    }
  }
  return out;
}

/**
 * Take control tracks on macros turned into their targets' values over time:
 * `valueAt(macroProp, n, …, t)` read through each target (renders: the
 * Granulator's settings; the native job's parameter steps use `macroSteps`).
 */
export function macroValueAt<T extends unknown[]>(ae: PlayAudioEngine | undefined, valueAt: (id: string, key: string, base: number, ...rest: T) => number): (id: string, key: string, base: number, ...rest: T) => number {
  if (!ae?.racks.some(r => r.macros?.some(m => m.targets.length))) return valueAt;
  const idx = macroIndex(ae);
  return (id, key, base, ...rest) => {
    const hits = idx.get(`${id}\u0000${key}`);
    if (hits) {
      for (const h of hits) {
        const mv = valueAt(macroPropId(h.rackId), String(h.n), Number.NaN, ...rest);
        if (!Number.isNaN(mv)) return mcTargetValue(mv, h.target);
      }
    }
    return valueAt(id, key, base, ...rest);
  };
}

/** A take's control track on a macro: the parameters it turns and each one's value for a macro value. */
export function macroFanOut(ae: PlayAudioEngine | undefined, target: string): Array<{ rackId: string; slotId: string; address: string; value: (v: number) => number }> {
  const t = parseMacroTarget(target);
  const r = t ? aeRack(ae, t.rackId) : undefined;
  if (!t || !r) return [];
  return rackMacros(r)[t.n - 1].targets.map(x => ({ rackId: r.id, slotId: x.slot, address: x.address, value: (v: number) => mcTargetValue(v, x) }));
}

/** "Macro 1 0.40 · Cutoff" for the folded strip: how many are in use and the first ones' values. */
export function macrosSummary(rack: AeRack): string {
  const used = rackMacros(rack).filter(m => m.targets.length);
  if (!used.length) return 'No macros mapped yet';
  const first = used.slice(0, 3).map(m => `${m.name} ${Math.round(m.value * 100)}%`).join(' · ');
  return `${used.length} in use · ${first}${used.length > 3 ? '…' : ''}`;
}

/** The curve drawn as points (0..1 each way), for a small preview. */
export function curvePreview(curve: MacroCurve, points: readonly number[] | undefined, n = 24): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => [i / n, mcCurve(i / n, curve, points as number[] | undefined)]);
}
