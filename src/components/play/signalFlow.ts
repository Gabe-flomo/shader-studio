/**
 * signalFlow.ts — signals as a graph, for the Rules page: each one's place
 * among the others (chain, branch, merge, loop), links and loop settings, and
 * Set / Move a layer from what a signal captured. Pure.
 */
import { SIGNAL_ACTION, SIGNAL_ANCHOR, SIGNAL_LINKS_MAX, type PlayLoop, type PlayRecord, type SignalLink } from '../../types/play';
import { sgLinkPlan } from '../../play/kit/signals.js';
import { layerPositionPair, newPairMapping } from '../../play/pairs';
import { mapSourceTo, type MapTarget } from './layerOps';

/** Set: `target` (a control, made first if needed) takes what the signal captured, jumping (no glide) and staying. */
export function setFromSignal(p: PlayRecord, signalId: string, target: MapTarget): { play: PlayRecord; controlLabel?: string } {
  const r = mapSourceTo(p, { kind: 'captured', signal: signalId, release: 'stay' }, target, 0);
  return { play: r.play, controlLabel: r.control?.label };
}

/**
 * Move a layer to where the signal captured a position: its X and Y as a
 * position pair (made if needed), driven by the anchor `sig:<id>` with no
 * glide, so it jumps there on each capture and stays.
 */
export function moveLayerToSignal(p: PlayRecord, layerId: string, signalId: string): { play: PlayRecord; ok: boolean } {
  const { play, pairId } = layerPositionPair(p, layerId, 'x');
  const pm = pairId ? newPairMapping(play, pairId, { kind: 'position', anchor: `${SIGNAL_ANCHOR}${signalId}` }) : null;
  if (!pm) return { play: p, ok: false };
  return { play: { ...play, pairMappings: [...(play.pairMappings ?? []), { ...pm, a: { ...pm.a, smoothMs: 0 }, b: { ...pm.b, smoothMs: 0 } }] }, ok: true };
}

// ── Structure: where each signal sits ───────────────────────────────────────

export type SignalShape = 'isolated' | 'start' | 'middle' | 'end' | 'branch' | 'merge' | 'loop';

export const SIGNAL_SHAPE_LABELS: Record<SignalShape, string> = {
  isolated: 'on its own', start: 'starts a chain', middle: 'in a chain', end: 'ends a chain', branch: 'branches', merge: 'merges', loop: 'in a loop',
};

/** Signal-to-signal edges: links, combinations (an input feeds what combines it) and actions that relay one signal into another. */
export function signalEdges(play: PlayRecord): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const s of play.signals ?? []) {
    for (const l of s.links ?? []) out.push({ from: s.id, to: l.to });
    if (s.when?.kind === 'logic') for (const i of s.when.inputs) out.push({ from: i, to: s.id });
    // A rule's signal inputs feed it; a reaction sending a signal relays it on.
    for (const x of s.inputs ?? []) if (x.kind === 'signal') out.push({ from: x.signal, to: s.id });
    for (const r of s.do ?? []) if (r.enabled && r.do === SIGNAL_ACTION && r.signal) out.push({ from: s.id, to: r.signal });
  }
  for (const a of play.actions ?? []) if (a.enabled && a.trigger.on === 'signal' && a.trigger.signal && a.do === SIGNAL_ACTION && a.signal) out.push({ from: a.trigger.signal, to: a.signal });
  return out;
}

/**
 * Each signal's place in the graph of signals (the plan's structure labels):
 * in a loop (a cycle through links, combinations or relays), merging (more
 * than one signal feeds it), branching (it feeds more than one), a chain's
 * start, middle or end, or on its own. Derived; nothing stored.
 */
export function signalStructure(play: PlayRecord): Map<string, SignalShape> {
  const sigs = play.signals ?? [];
  const edges = signalEdges(play);
  const inn = new Map<string, number>(), out = new Map<string, number>();
  for (const e of edges) { inn.set(e.to, (inn.get(e.to) ?? 0) + 1); out.set(e.from, (out.get(e.from) ?? 0) + 1); }
  // Cycles over every edge: the link planner's strongly connected components, fed all of them as links.
  const cyclic = sgLinkPlan(sigs.map(s => ({ id: s.id, links: edges.filter(e => e.from === s.id).map(e => ({ to: e.to, delay: 0 })) }))).loopOf;
  const shape = new Map<string, SignalShape>();
  for (const s of sigs) {
    const i = inn.get(s.id) ?? 0, o = out.get(s.id) ?? 0;
    shape.set(s.id, cyclic.has(s.id) ? 'loop' : i > 1 ? 'merge' : o > 1 ? 'branch' : i === 0 && o === 0 ? 'isolated' : i === 0 ? 'start' : o === 0 ? 'end' : 'middle');
  }
  return shape;
}

/** A link from one signal to another (at most SIGNAL_LINKS_MAX each). */
export function addLink(p: PlayRecord, from: string, link: SignalLink): PlayRecord {
  return { ...p, signals: (p.signals ?? []).map(s => (s.id === from ? { ...s, links: [...(s.links ?? []), link].slice(0, SIGNAL_LINKS_MAX) } : s)) };
}

export function removeLink(p: PlayRecord, from: string, index: number): PlayRecord {
  return { ...p, signals: (p.signals ?? []).map(s => {
    if (s.id !== from) return s;
    const links = (s.links ?? []).filter((_, i) => i !== index);
    const n = { ...s };
    if (links.length) n.links = links; else delete n.links;
    return n;
  }) };
}

/** Change a loop's settings (kept by its members' key). */
export function setLoop(p: PlayRecord, key: string, patch: Partial<PlayLoop>): PlayRecord {
  const loops = p.loops ?? [];
  const has = loops.some(l => l.key === key);
  return { ...p, loops: has ? loops.map(l => (l.key === key ? { ...l, ...patch } : l)) : [...loops, { key, ...patch }] };
}
