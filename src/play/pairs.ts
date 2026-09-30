/**
 * pairs.ts — pair controls and signals as record edits: pairing two controls
 * (or a property with its X/Y partner as a position), unpairing, a new pair
 * mapping, and adding, renaming and deleting signals. Pure: each takes the
 * record and returns the next one. The engine (lib/playEngine.ts) plays them.
 */
import { eventSignal, layerEvents } from './layerPorts';
import type { PairAxis, PlayControl, PlayPair, PlayPairMapping, PlayRecord, PlaySignal, PairSource } from '../types/play';
import { layerNumericProps, layerTarget, parseLayerTarget, SIGNALS_MAX } from '../types/play';
import { pairedKey } from '../components/play/layerOps';
import { playId, targetParts } from './playControls';

/** The pair a control is in, if any. */
export function pairOf(play: Pick<PlayRecord, 'pairs'>, controlId: string): PlayPair | undefined {
  return play.pairs?.find(p => p.a === controlId || p.b === controlId);
}

/** "Dot X" and "Dot Y" → "Dot": a pair's name from its two controls. */
export function pairLabel(a: string, b: string): string {
  const strip = (s: string) => s.replace(/[\s·_-]*[XxYy]$/, '').trim();
  const sa = strip(a), sb = strip(b);
  return sa && sa === sb ? sa : `${a} + ${b}`;
}

/**
 * Pair two float controls (A and B). A control already in a pair leaves it
 * first (that pair and its mappings go). Returns the record unchanged when
 * either isn't a slider on the panel.
 */
export function makePair(play: PlayRecord, a: string, b: string, position: boolean): { play: PlayRecord; pairId: string } {
  const ca = play.controls.find(c => c.id === a), cb = play.controls.find(c => c.id === b);
  if (!ca || !cb || a === b || ca.kind !== 'float' || cb.kind !== 'float') return { play, pairId: '' };
  let next = play;
  for (const p of play.pairs ?? []) if ([p.a, p.b].some(id => id === a || id === b)) next = unpair(next, p.id);
  const pair: PlayPair = { id: playId('pair'), label: pairLabel(ca.label, cb.label), a, b, position };
  return { play: { ...next, pairs: [...(next.pairs ?? []), pair] }, pairId: pair.id };
}

/** Undo a pair: the two controls stay, the pair and its mappings go. */
export function unpair(play: PlayRecord, pairId: string): PlayRecord {
  const pairs = (play.pairs ?? []).filter(p => p.id !== pairId);
  const pairMappings = (play.pairMappings ?? []).filter(m => m.pairId !== pairId);
  const out: PlayRecord = { ...play, pairs, pairMappings };
  if (!pairs.length) delete out.pairs;
  if (!pairMappings.length) delete out.pairMappings;
  return out;
}

/** What a control would be made from, for a partner that isn't on the panel yet. */
export interface ControlMaker { label: string; min: number; max: number; step?: number }

/**
 * The X/Y partner of a control's target (`…x` ↔ `…y`) and which axis the
 * partner is, or null: a layer's x and y, a node's posX and posY.
 */
export function partnerTarget(target: string): { target: string; axis: 'x' | 'y' } | null {
  const lt = parseLayerTarget(target);
  // `axis` is the partner's: Y for an X, X for a Y.
  if (lt) { const p = pairedKey(lt.key); return p ? { target: layerTarget(lt.layerId, p.other), axis: p.axis === 'x' ? 'y' : 'x' } : null; }
  if (target.startsWith('finish:') || target.startsWith('audiofx:') || target.startsWith('act:')) return null;
  const { paramKey } = targetParts(target);
  const p = pairedKey(paramKey);
  return p ? { target: target.slice(0, target.length - paramKey.length) + p.other, axis: p.axis === 'x' ? 'y' : 'x' } : null;
}

/**
 * Add as position: pair a control with its X/Y partner as a position (X is
 * A), making the partner's control when the panel lacks it. `resolve` says
 * what a graph target's slider is (its label and range).
 */
export function positionPair(play: PlayRecord, controlId: string, resolve: (target: string) => ControlMaker | null): { play: PlayRecord; pairId: string } {
  const c = play.controls.find(x => x.id === controlId);
  const partner = c && partnerTarget(c.target);
  if (!c || !partner) return { play, pairId: '' };
  let next = play;
  let other = play.controls.find(x => x.target === partner.target);
  if (!other) {
    const made = resolveTarget(play, partner.target) ?? resolve(partner.target);
    if (!made) return { play, pairId: '' };
    other = { id: playId('ctl'), target: partner.target, kind: 'float', label: made.label, min: made.min, max: made.max, ...(made.step ? { step: made.step } : {}) };
    const at = play.controls.indexOf(c);
    next = { ...play, controls: [...play.controls.slice(0, at + 1), other, ...play.controls.slice(at + 1)] };
  }
  // The partner is Y when this one is X.
  return partner.axis === 'y' ? makePair(next, c.id, other.id, true) : makePair(next, other.id, c.id, true);
}

/** A layer property's slider (label, range), for a control made from it. */
function resolveTarget(play: PlayRecord, target: string): ControlMaker | null {
  const lt = parseLayerTarget(target);
  if (!lt) return null;
  const l = play.layers.find(x => x.id === lt.layerId);
  const d = l && layerNumericProps(l).find(x => x.key === lt.key);
  return l && d ? { label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) } : null;
}

/**
 * A layer's X and Y as a position pair (from its property rows): each
 * becomes a control if it isn't one, then the two are paired.
 */
export function layerPositionPair(play: PlayRecord, layerId: string, key: string): { play: PlayRecord; pairId: string } {
  const target = layerTarget(layerId, key);
  let next = play;
  let c = play.controls.find(x => x.target === target);
  if (!c) {
    const made = resolveTarget(play, target);
    if (!made) return { play, pairId: '' };
    c = { id: playId('ctl'), target, kind: 'float', label: made.label, min: made.min, max: made.max, ...(made.step ? { step: made.step } : {}) };
    next = { ...play, controls: [...play.controls, c] };
  }
  return positionPair(next, c.id, () => null);
}

/** An axis mapped over its control's whole range. */
export function axisFor(c: PlayControl | undefined): PairAxis {
  return { outMin: c?.min ?? 0, outMax: c?.max ?? 1, curve: 'linear', smoothMs: 30 };
}

/** A new pair mapping: a position pair follows the pointer; any other pair a knob on both. */
export function newPairMapping(play: PlayRecord, pairId: string, source?: PairSource): PlayPairMapping | null {
  const p = play.pairs?.find(x => x.id === pairId);
  if (!p) return null;
  const ca = play.controls.find(c => c.id === p.a), cb = play.controls.find(c => c.id === p.b);
  return {
    id: playId('pmap'), pairId,
    source: source ?? (p.position ? { kind: 'position', anchor: 'mouse' } : { kind: 'value', source: { kind: 'mouse', axis: 'x' } }),
    affect: 'both', a: axisFor(ca), b: axisFor(cb), enabled: true,
  };
}

// ── Signals ──────────────────────────────────────────────────────────────────

/** Add a signal ("Signal 3", or the name given). */
export function addSignal(play: PlayRecord, name?: string): { play: PlayRecord; id: string } {
  const list = play.signals ?? [];
  if (list.length >= SIGNALS_MAX) return { play, id: '' };
  let n = list.length + 1;
  while (list.some(s => s.name === `Signal ${n}`)) n++;
  const sig: PlaySignal = { id: playId('sig'), name: (name ?? '').trim() || `Signal ${n}` };
  return { play: { ...play, signals: [...list, sig] }, id: sig.id };
}

export function renameSignal(play: PlayRecord, id: string, name: string): PlayRecord {
  const t = name.trim();
  if (!t) return play;
  return { ...play, signals: (play.signals ?? []).map(s => (s.id === id ? { ...s, name: t.slice(0, 60) } : s)) };
}

/** Delete a signal. What sent or listened for it stays, marked missing, so nothing else changes by surprise. */
export function deleteSignal(play: PlayRecord, id: string): PlayRecord {
  const signals = (play.signals ?? []).filter(s => s.id !== id);
  const out: PlayRecord = { ...play, signals };
  if (!signals.length) delete out.signals;
  return out;
}

/**
 * Signal fields a layer or an increment sends on its own, outside of a "Send
 * a signal" action: a Multiply layer's split/full/annihilate/cleared, a
 * Relationship layer's catch, an Increment mapping's step and wrap-back.
 */
export function layerSignalSenders(play: PlayRecord): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  // Every event a layer can send (layerPorts: Born and Died too, which the engine sends for particles and agents).
  for (const l of play.layers) for (const e of layerEvents(l)) {
    const id = eventSignal(l, e);
    if (id) out.push({ id, label: `${l.label}: ${e.label}` });
  }
  for (const m of play.mappings) {
    const inc = m.increment;
    if (!inc) continue;
    const control = play.controls.find(c => c.id === m.controlId)?.label ?? m.controlId;
    if (inc.stepSignal) out.push({ id: inc.stepSignal, label: `${control} increment: Step` });
    if (inc.resetSignal) out.push({ id: inc.resetSignal, label: `${control} increment: Wrap back` });
  }
  return out;
}

/** Signal fields that listen for a signal outside of an action or a mapping source: an Increment's Reset on. */
export function layerSignalListeners(play: PlayRecord): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const m of play.mappings) {
    const inc = m.increment;
    if (inc?.resetOn) {
      const control = play.controls.find(c => c.id === m.controlId)?.label ?? m.controlId;
      out.push({ id: inc.resetOn, label: `${control} increment: Reset` });
    }
  }
  return out;
}

/** How many actions, mappings, swaps, layers and increments send or listen for a signal. */
export function signalUses(play: PlayRecord, id: string): number {
  let n = 0;
  for (const a of play.actions ?? []) { if (a.signal === id) n++; if (a.trigger.on === 'signal' && a.trigger.signal === id) n++; }
  for (const m of play.mappings) if (m.source.kind === 'trigger' && m.source.trigger.on === 'signal' && m.source.trigger.signal === id) n++;
  for (const m of play.pairMappings ?? []) { if (m.swap?.signal === id) n++; if (m.swap?.backSignal === id) n++; }
  n += layerSignalSenders(play).filter(s => s.id === id).length;
  n += layerSignalListeners(play).filter(s => s.id === id).length;
  return n;
}
