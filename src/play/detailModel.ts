/**
 * detailModel.ts — what the detail window says about a control, a source or a
 * signal (implementation guide 7.3), derived from the record. Pure.
 *
 *   comesFrom    what drives a control: each source routed onto it, and pair mappings
 *   signalsOn    the rules that watch it (a condition on the control, or on the layer number it is)
 *   goesTo       the controls it drives in turn (a source reading it)
 *   doOn         the rules that act on its layer
 *   listenedBy   for a signal: the rules, mappings and sources that take it
 */
import { sgPulseLinks } from './kit/signals.js';
import { rtSourcesOf } from './kit/routes.js';
import { sourceLabel } from './playSources';
import { routesInto } from './routeOps';
import { SIGNAL_ACTION, type PlayRecord, type TriggerSpec } from '../types/play';

export interface DetailLink { label: string; ref?: { kind: 'control' | 'source' | 'signal'; id: string } }

/** The value paths a control is read by in conditions: `ctl:<id>`, and the layer number it stands for. */
function pathsOf(play: PlayRecord, controlId: string): string[] {
  const c = play.controls.find(x => x.id === controlId);
  const out = [`ctl:${controlId}`];
  if (c?.target.startsWith('layer:')) out.push(c.target);
  return out;
}

const triggersOfRule = (s: NonNullable<PlayRecord['signals']>[number]): TriggerSpec[] => [
  ...(s.when?.kind === 'trigger' ? [s.when.trigger] : []),
  ...(s.inputs ?? []).flatMap(x => (x.kind === 'trigger' ? [x.trigger] : [])),
];

export function comesFrom(play: PlayRecord, controlId: string): DetailLink[] {
  const out: DetailLink[] = routesInto(play, controlId).map(r => ({ label: `${r.label}${r.mode === 'add' ? ' · adds' : ''}`, ref: { kind: 'source' as const, id: r.sourceId } }));
  for (const m of play.pairMappings ?? []) {
    const pair = play.pairs?.find(p => p.id === m.pairId);
    if (m.enabled && pair && (pair.a === controlId || pair.b === controlId)) out.push({ label: `${pair.label} (pair)` });
  }
  return out;
}

export function signalsOn(play: PlayRecord, controlId: string): DetailLink[] {
  const paths = pathsOf(play, controlId);
  return (play.signals ?? []).filter(s => triggersOfRule(s).some(t => t.on === 'value' && paths.includes(t.value))).map(s => ({ label: s.name, ref: { kind: 'signal' as const, id: s.id } }));
}

export function goesTo(play: PlayRecord, controlId: string): DetailLink[] {
  const out: DetailLink[] = [];
  for (const s of rtSourcesOf(play)) {
    if (!s.enabled || s.source.kind !== 'control' || s.source.controlId !== controlId) continue;
    for (const o of s.outputs) for (const r of o.routes) {
      const c = play.controls.find(x => x.id === r.to);
      if (c) out.push({ label: c.label, ref: { kind: 'control', id: c.id } });
    }
  }
  return out;
}

export function doOn(play: PlayRecord, controlId: string): DetailLink[] {
  const c = play.controls.find(x => x.id === controlId);
  const layerId = c?.target.startsWith('layer:') ? c.target.slice(6, c.target.indexOf('::')) : '';
  if (!layerId) return [];
  return (play.signals ?? []).filter(s => (s.do ?? []).some(r => r.layerId === layerId)).map(s => ({ label: s.name, ref: { kind: 'signal' as const, id: s.id } }));
}

export function listenedBy(play: PlayRecord, signalId: string): DetailLink[] {
  const out: DetailLink[] = [];
  const signals = play.signals ?? [];
  for (const s of signals) {
    if (s.id === signalId) continue;
    const viaInput = (s.inputs ?? []).some(x => x.kind === 'signal' && x.signal === signalId) || (s.when?.kind === 'logic' && s.when.inputs.includes(signalId))
      || triggersOfRule(s).some(t => t.on === 'signal' && t.signal === signalId);
    const viaLink = sgPulseLinks(signals).find(x => x.id === signalId)?.links?.some(l => l.to === s.id);
    if (viaInput || viaLink) out.push({ label: s.name, ref: { kind: 'signal', id: s.id } });
  }
  for (const s of signals) for (const r of s.do ?? []) if (r.do === SIGNAL_ACTION && r.signal === signalId && s.id !== signalId) out.push({ label: `Sent by ${s.name}`, ref: { kind: 'signal', id: s.id } });
  for (const s of rtSourcesOf(play)) {
    const src = s.source;
    const hears = (src.kind === 'trigger' && src.trigger.on === 'signal' && src.trigger.signal === signalId) || (src.kind === 'captured' && src.signal === signalId)
      || s.outputs.some(o => o.kind === 'step' && o.step.on === 'trigger' && o.step.trigger.on === 'signal' && o.step.trigger.signal === signalId);
    if (hears) out.push({ label: s.label ?? sourceLabel(src, play.controls, play.layers), ref: { kind: 'source', id: s.id } });
  }
  return out;
}

/** What a rule listens to that has a page of its own: the controls and sources its conditions read, and the rules it takes. */
export function listensTo(play: PlayRecord, signalId: string): DetailLink[] {
  const s = play.signals?.find(x => x.id === signalId);
  if (!s) return [];
  const out: DetailLink[] = [];
  const seen = new Set<string>();
  const add = (l: DetailLink) => { const k = `${l.ref?.kind}:${l.ref?.id}`; if (!seen.has(k)) { seen.add(k); out.push(l); } };
  for (const t of triggersOfRule(s)) {
    if (t.on !== 'value') continue;
    const c = t.value.startsWith('ctl:') ? play.controls.find(x => x.id === t.value.slice(4)) : play.controls.find(x => x.target === t.value);
    if (c) add({ label: c.label, ref: { kind: 'control', id: c.id } });
    const sid = t.value.startsWith('src:') || t.value.startsWith('map:') ? t.value.slice(4) : '';
    const src = sid ? rtSourcesOf(play).find(x => x.id === sid) : undefined;
    if (src) add({ label: src.label ?? sourceLabel(src.source, play.controls, play.layers), ref: { kind: 'source', id: src.id } });
  }
  for (const x of s.inputs ?? []) {
    if (x.kind !== 'signal') continue;
    const o = play.signals?.find(y => y.id === x.signal);
    if (o) add({ label: `${o.name}${x.as === 'rise' ? ' · starts' : x.as === 'fall' ? ' · stops' : ''}`, ref: { kind: 'signal', id: o.id } });
  }
  return out;
}
