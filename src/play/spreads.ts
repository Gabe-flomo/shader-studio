/**
 * spreads.ts — Spread controls as record edits (docs/spread-control.md):
 * making one (with its Amount and Shift controls), adding, removing and
 * reordering members, the curve and mode, Reset, deleting it. Pure: each
 * takes the record and returns the next one, so each is one undo step. The
 * engine (lib/playEngine.ts) and the website runtime play them, through the
 * kit's maths (play/kit/spread.js).
 */
import type { PlayControl, PlayRecord, PlaySpread } from '../types/play';
import { parseSpreadTarget, spreadTarget, SPREADS_MAX, withSpreadControls } from '../types/play';
import { SP_MAX_MEMBERS, SP_POINTS, spCurve, spValue, spWeights } from './kit/spread.js';
import { playId } from './playControls';

/** The Spread a control is a member of, if any. */
export function spreadOf(play: Pick<PlayRecord, 'spreads'>, controlId: string): PlaySpread | undefined {
  return play.spreads?.find(s => s.members.includes(controlId));
}

/** The Spread whose Amount or Shift a control is, if any. */
export function spreadOfControl(play: Pick<PlayRecord, 'spreads'>, c: PlayControl): { spread: PlaySpread; key: 'amount' | 'shift' } | null {
  const t = parseSpreadTarget(c.target);
  const spread = t ? play.spreads?.find(s => s.id === t.spreadId) : undefined;
  return t && spread ? { spread, key: t.key } : null;
}

/** Can this control join a Spread? Sliders only, and never a Spread's own Amount or Shift. */
export function canSpread(c: PlayControl | undefined): boolean {
  return !!c && c.kind === 'float' && !parseSpreadTarget(c.target);
}

/** "Spread 1", "Spread 2": the first name not taken. */
export function nextSpreadLabel(play: Pick<PlayRecord, 'spreads'>): string {
  const taken = new Set((play.spreads ?? []).map(s => s.label));
  for (let n = 1; ; n++) if (!taken.has(`Spread ${n}`)) return `Spread ${n}`;
}

/** A Shift control's range follows the member count: 0 … N − 1. */
function syncShiftRange(controls: PlayControl[], sp: PlaySpread): PlayControl[] {
  const target = spreadTarget(sp.id, 'shift');
  const max = Math.max(1, sp.members.length - 1);
  return controls.map(c => (c.target === target && c.max !== max ? { ...c, min: Math.min(c.min, 0), max } : c));
}

function withSpread(play: PlayRecord, sp: PlaySpread): PlayRecord {
  const spreads = (play.spreads ?? []).map(s => (s.id === sp.id ? sp : s));
  return { ...play, spreads, controls: syncShiftRange(play.controls, sp) };
}

/**
 * A new Spread with these members (sliders, in this order; any already in a
 * Spread leave it), its Amount and Shift controls placed where its first
 * member is. Returns the record unchanged past SPREADS_MAX.
 */
export function makeSpread(play: PlayRecord, memberIds: readonly string[] = [], label?: string): { play: PlayRecord; spreadId: string } {
  if ((play.spreads?.length ?? 0) >= SPREADS_MAX) return { play, spreadId: '' };
  let next = play;
  const members = memberIds.filter((id, i) => memberIds.indexOf(id) === i && canSpread(play.controls.find(c => c.id === id))).slice(0, SP_MAX_MEMBERS);
  for (const id of members) { const had = spreadOf(next, id); if (had) next = removeFromSpread(next, had.id, id); }
  const sp: PlaySpread = { id: playId('spr'), label: label?.trim() || nextSpreadLabel(next), members, amount: 0, shift: 0, curve: 'linear', mode: 'offset' };
  const made = withSpreadControls([], [sp]);
  const at = members.length ? next.controls.findIndex(c => c.id === members[0]) : -1;
  const controls = at >= 0 ? [...next.controls.slice(0, at), ...made, ...next.controls.slice(at)] : [...next.controls, ...made];
  return { play: { ...next, spreads: [...(next.spreads ?? []), sp], controls: syncShiftRange(controls, sp) }, spreadId: sp.id };
}

/** Add a slider to a Spread, at the end of its order (or at `index`). It leaves any Spread it was in. */
export function addToSpread(play: PlayRecord, spreadId: string, controlId: string, index?: number): PlayRecord {
  if (!canSpread(play.controls.find(c => c.id === controlId))) return play;
  const had = spreadOf(play, controlId);
  if (had?.id === spreadId) return play;
  const next = had ? removeFromSpread(play, had.id, controlId) : play;
  const sp = next.spreads?.find(s => s.id === spreadId);
  if (!sp || sp.members.length >= SP_MAX_MEMBERS) return play;
  const members = [...sp.members];
  members.splice(index === undefined ? members.length : Math.max(0, Math.min(members.length, index)), 0, controlId);
  return withSpread(next, { ...sp, members });
}

/** Take a member out of a Spread (the control stays on the panel). */
export function removeFromSpread(play: PlayRecord, spreadId: string, controlId: string): PlayRecord {
  const sp = play.spreads?.find(s => s.id === spreadId);
  if (!sp || !sp.members.includes(controlId)) return play;
  return withSpread(play, { ...sp, members: sp.members.filter(id => id !== controlId) });
}

/** Move a member from one place in the order to another. */
export function moveSpreadMember(play: PlayRecord, spreadId: string, from: number, to: number): PlayRecord {
  const sp = play.spreads?.find(s => s.id === spreadId);
  if (!sp || from === to || from < 0 || from >= sp.members.length) return play;
  const members = [...sp.members];
  const [m] = members.splice(from, 1);
  members.splice(Math.max(0, Math.min(members.length, to)), 0, m);
  return withSpread(play, { ...sp, members });
}

/** Change a Spread's settings (curve, mode, reset signal, label). A new label renames its Amount and Shift. */
export function patchSpread(play: PlayRecord, spreadId: string, patch: Partial<Omit<PlaySpread, 'id' | 'members'>>): PlayRecord {
  const sp = play.spreads?.find(s => s.id === spreadId);
  if (!sp) return play;
  const next: PlaySpread = { ...sp, ...patch };
  if (next.curve === 'custom' && (!next.curveY || next.curveY.length < 2)) next.curveY = Array.from({ length: SP_POINTS }, (_, i) => spCurve(i / (SP_POINTS - 1), sp.curve === 'custom' ? 'linear' : sp.curve, undefined, false));
  if (next.curve !== 'custom') delete next.curveY;
  if (!next.invert) delete next.invert;
  if (!next.resetOn) delete next.resetOn;
  let out = withSpread(play, next);
  if (patch.label !== undefined && patch.label !== sp.label) {
    const rename = new Map([[spreadTarget(sp.id, 'amount'), `${next.label} · Amount`], [spreadTarget(sp.id, 'shift'), `${next.label} · Shift`]]);
    out = { ...out, controls: out.controls.map(c => (rename.has(c.target) ? { ...c, label: rename.get(c.target)! } : c)) };
  }
  return out;
}

/** Delete a Spread: its members stay as plain controls; its Amount and Shift controls (and mappings onto them) go. */
export function deleteSpread(play: PlayRecord, spreadId: string): PlayRecord {
  const gone = new Set(play.controls.filter(c => parseSpreadTarget(c.target)?.spreadId === spreadId).map(c => c.id));
  const spreads = (play.spreads ?? []).filter(s => s.id !== spreadId);
  const out: PlayRecord = {
    ...play, spreads,
    controls: play.controls.filter(c => !gone.has(c.id)),
    mappings: play.mappings.filter(m => !gone.has(m.controlId) && (m.source.kind !== 'control' || !gone.has(m.source.controlId))),
  };
  if (!spreads.length) delete out.spreads;
  return out;
}

/** A control leaves the panel: it leaves its Spread too (a Spread's own Amount or Shift takes the Spread with it). */
export function dropFromSpreads(play: PlayRecord, controlId: string): PlayRecord {
  const c = play.controls.find(x => x.id === controlId);
  const own = c && parseSpreadTarget(c.target);
  if (own) return deleteSpread(play, own.spreadId);
  const sp = spreadOf(play, controlId);
  return sp ? removeFromSpread(play, sp.id, controlId) : play;
}

/**
 * Reset: every member's own value back to its slider's minimum (whatever the
 * minimum is set to now), so the curve then lays the offsets from there.
 * Returns member control id → the value to write.
 */
export function spreadResetValues(play: Pick<PlayRecord, 'controls' | 'spreads'>, spreadId: string): Map<string, number> {
  const sp = play.spreads?.find(s => s.id === spreadId);
  const out = new Map<string, number>();
  for (const id of sp?.members ?? []) {
    const c = play.controls.find(x => x.id === id);
    if (c && c.kind === 'float') out.set(id, Math.min(c.min, c.max));
  }
  return out;
}

/**
 * Every member's value now, for the card and the tests: its base (what drives
 * it, else its slider) plus Amount × its share × its range, clamped.
 */
export function spreadValues(sp: PlaySpread, controls: readonly PlayControl[], baseOf: (id: string) => number | undefined, amount = sp.amount, shift = sp.shift): Array<{ id: string; base: number; value: number; weight: number }> {
  const w = spWeights(sp.members.length, shift, sp.curve, sp.curveY, !!sp.invert);
  return sp.members.map((id, i) => {
    const c = controls.find(x => x.id === id);
    const base = baseOf(id) ?? c?.min ?? 0;
    return { id, base, weight: w[i], value: c ? spValue(base, c.min, c.max, amount, w[i]) : base };
  });
}
