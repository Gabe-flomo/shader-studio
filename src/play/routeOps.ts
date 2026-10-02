/**
 * routeOps.ts — editing sources and routes on the Inputs board
 * (implementation guide, phase 4). Map a source onto a control: an old
 * mapping becomes a source of the record first (same id, one route, so it
 * plays the same), then the new route takes the likely shape
 * (connectDefaults.ts): a number Adds ±half the control's range around its
 * slider; an on/off input sets it (off at its low end, on at its high end,
 * a short glide). Pure.
 */
import { rtAddSwing } from './kit/routes.js';
import { connectDefaults, describeConnection, type ConnectFrom } from './connectDefaults';
import { sourceLabel } from './playSources';
import { ROUTES_PER_SOURCE_MAX, type PlayControl, type PlayMapping, type PlayRecord, type PlayRoute, type PlaySource, type PlaySourceDef } from '../types/play';

let seq = 0;
const routeId = () => `rt_${Date.now().toString(36)}_${(++seq).toString(36)}`;

/** An old mapping as a source of the record: same id (its state carries over), one Replace route (the same id too). */
export function mappingToSource(m: PlayMapping): PlaySourceDef {
  const r: PlayRoute = { id: m.id, to: m.controlId, mode: 'replace', outMin: m.outMin, outMax: m.outMax, curve: m.curve, enabled: true };
  if (m.curveY) r.curveY = m.curveY;
  if (m.channel !== undefined) r.channel = m.channel;
  if (m.smoothMs) r.smoothMs = m.smoothMs;
  if (m.delayMs) r.delayMs = m.delayMs;
  return {
    id: m.id, enabled: m.enabled, source: m.source,
    outputs: [m.increment ? { kind: 'step', step: m.increment, lo: m.outMin, hi: m.outMax, routes: [r] } : { kind: 'value', routes: [r] }],
  };
}

/** Is this source on or off (a key, a button, a trigger's gate) rather than a number? */
export function sourceType(s: PlaySource): ConnectFrom {
  if (s.kind === 'key' || s.kind === 'trigger') return 'boolean';
  if (s.kind === 'gamepad' && s.control === 'button') return 'boolean';
  if (s.kind === 'mouse' && s.axis === 'down') return 'boolean';
  if (s.kind === 'captured') return 'signalValue';
  return 'number';
}

/** The record with this id as one of its own sources (an old mapping turned into one); null when there's no such source. */
export function ownSource(p: PlayRecord, id: string): { play: PlayRecord; source: PlaySourceDef } | null {
  const own = p.sources?.find(s => s.id === id);
  if (own) return { play: p, source: own };
  const m = p.mappings.find(x => x.id === id);
  if (!m) return null;
  const source = mappingToSource(m);
  return { play: { ...p, mappings: p.mappings.filter(x => x.id !== id), sources: [...(p.sources ?? []), source] }, source };
}

/** The route a source of this type makes onto this control. */
export function defaultRoute(type: ConnectFrom, c: PlayControl): PlayRoute {
  const min = c.kind === 'float' ? c.min : 0, max = c.kind === 'float' ? c.max : 1;
  const conn = connectDefaults(type, 'slider');
  if (c.kind === 'float' && conn.kind === 'route' && conn.mode === 'add') {
    // ±half the range around the slider (the owner's default for new routes).
    const swing = rtAddSwing(min, max);
    return { id: routeId(), to: c.id, mode: 'add', ...swing, curve: 'linear', enabled: true };
  }
  const r: PlayRoute = { id: routeId(), to: c.id, mode: 'replace', outMin: min, outMax: max, curve: 'linear', enabled: true };
  if (conn.kind === 'route' && conn.glideMs) r.smoothMs = conn.glideMs;
  return r;
}

/**
 * Map: a route from a source (a record source or an old mapping, by id) onto
 * a control. Unchanged (with no words) when it already drives that control,
 * the source is full, or either is missing. `said`: what it did, in words.
 */
export function routeToControl(p: PlayRecord, sourceId: string, controlId: string): { play: PlayRecord; said: string } {
  const c = p.controls.find(x => x.id === controlId);
  const own = c ? ownSource(p, sourceId) : null;
  if (!c || !own) return { play: p, said: '' };
  const out = own.source.outputs[0];
  const all = own.source.outputs.flatMap(o => o.routes);
  if (all.some(r => r.to === controlId) || all.length >= ROUTES_PER_SOURCE_MAX) return { play: p, said: '' };
  const type = out?.kind === 'step' ? 'number' : sourceType(own.source.source);
  const route = defaultRoute(type, c);
  const outputs = out ? own.source.outputs.map((o, i) => (i === 0 ? { ...o, routes: [...o.routes, route] } : o)) : [{ kind: 'value' as const, routes: [route] }];
  const play = { ...own.play, sources: (own.play.sources ?? []).map(s => (s.id === sourceId ? { ...s, outputs } : s)) };
  const name = own.source.label ?? sourceLabel(own.source.source, p.controls, p.layers);
  return { play, said: describeConnection(connectDefaults(type, 'slider'), name, c.label) };
}

export function patchSource(p: PlayRecord, id: string, patch: Partial<PlaySourceDef>): PlayRecord {
  return { ...p, sources: (p.sources ?? []).map(s => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeSource(p: PlayRecord, id: string): PlayRecord {
  const sources = (p.sources ?? []).filter(s => s.id !== id);
  const out: PlayRecord = { ...p, sources };
  if (!sources.length) delete out.sources;
  return out;
}

export function patchRoute(p: PlayRecord, sourceId: string, routeId: string, patch: Partial<PlayRoute>): PlayRecord {
  return patchSourceOutputs(p, sourceId, r => (r.id === routeId ? { ...r, ...patch } : r));
}

export function removeRoute(p: PlayRecord, sourceId: string, routeId: string): PlayRecord {
  return patchSourceOutputs(p, sourceId, r => (r.id === routeId ? null : r));
}

function patchSourceOutputs(p: PlayRecord, sourceId: string, fn: (r: PlayRoute) => PlayRoute | null): PlayRecord {
  const own = ownSource(p, sourceId);
  if (!own) return p;
  return patchSource(own.play, sourceId, { outputs: own.source.outputs.map(o => ({ ...o, routes: o.routes.map(fn).filter((r): r is PlayRoute => !!r) })) });
}

/** A new source of the record with nothing to drive yet (Map it next). */
export function addFreeSource(p: PlayRecord, source: PlaySource): { play: PlayRecord; id: string } {
  const id = `src_${Date.now().toString(36)}_${(++seq).toString(36)}`;
  return { play: { ...p, sources: [...(p.sources ?? []), { id, enabled: true, source, outputs: [{ kind: 'value', routes: [] }] }] }, id };
}

/** What drives a control, as chips: each source with a route onto it (old mappings and the record's own). */
export function routesInto(p: PlayRecord, controlId: string): Array<{ sourceId: string; routeId: string; label: string; mode: 'replace' | 'add'; mapping: boolean }> {
  const out: Array<{ sourceId: string; routeId: string; label: string; mode: 'replace' | 'add'; mapping: boolean }> = [];
  for (const m of p.mappings) if (m.enabled && m.controlId === controlId) out.push({ sourceId: m.id, routeId: m.id, label: sourceLabel(m.source, p.controls, p.layers), mode: 'replace', mapping: true });
  for (const s of p.sources ?? []) {
    if (!s.enabled) continue;
    for (const o of s.outputs) for (const r of o.routes) if (r.enabled && r.to === controlId) out.push({ sourceId: s.id, routeId: r.id, label: s.label ?? sourceLabel(s.source, p.controls, p.layers), mode: r.mode, mapping: false });
  }
  return out;
}
