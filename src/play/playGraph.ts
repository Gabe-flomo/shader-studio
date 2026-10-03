/**
 * playGraph.ts — a Play setup as a graph to draw (the Rules page's Graph
 * view, docs/graph-view.md): who feeds whom, derived from the record. Pure;
 * nothing is stored.
 *
 *   sources    the record's own and the old mappings (rtSourcesOf). A source
 *              that reads a control (kind 'control') is drawn as wires from
 *              that control to the ones it drives, not as a box, unless
 *              nothing else would show it (no routes).
 *   rules      every rule (the record read as rules, play/rules.ts asRules),
 *              in sub-columns by how deep it sits in a chain of rules, with
 *              its structure label (chain, branch, merge, loop:
 *              signalFlow.ts signalStructure)
 *   controls   in one group per layer they belong to (`layer:<id>::…`,
 *              `act:<id>::…`), then one for the shader graph, one for Finish
 *              and one for anything else
 *   layers     the layers a rule acts on (its reactions), one box each
 *
 * Edges are value wires (a route: source → control, or control → control
 * through a control source; labelled Set or Add) or signal wires (a rule's
 * input from another rule, a source `src:`/`map:` or a control `ctl:`; a
 * rule sending a signal; a source that hears a rule; a rule's reactions on a
 * layer). Edges between rules of one loop are marked `loop`, found the way
 * the Rules page finds loops (the link planner's strongly connected
 * components over signalEdges).
 *
 * Columns are logical: 0 sources, 1..R rules by depth, then controls, then
 * layers. Layout (playGraphLayout.ts) turns them into positions.
 */
import { rtSourcesOf } from './kit/routes.js';
import { sgLinkPlan } from './kit/signals.js';
import { sourceLabel } from './playSources';
import { asRules } from './rules';
import { signalEdges, signalStructure, type SignalShape } from '../components/play/signalFlow';
import { actionLabel } from '../components/play/layers/help';
import { SIGNAL_ACTION, type PlayRecord, type TriggerSpec } from '../types/play';

export type GraphNodeKind = 'source' | 'rule' | 'control' | 'layer';

export interface GraphNode {
  /** `src:<id>`, `rule:<id>`, `ctl:<id>` or `do:<layerId>`. */
  id: string;
  kind: GraphNodeKind;
  /** The record id it stands for (a source, signal, control or layer id). */
  ref: string;
  label: string;
  /** The group (box) it is drawn in: its own id, or a control group's. */
  group: string;
  /** Rules: where it sits among the rules. */
  shape?: SignalShape;
  /** Nothing wires into or out of it (drawn faint). */
  idle?: boolean;
}

export interface GraphGroup {
  id: string;
  kind: GraphNodeKind;
  /** A heading, for control groups (single nodes have none). */
  label?: string;
  column: number;
  /** Its nodes, in record order. */
  nodes: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'value' | 'signal';
  label?: string;
  /** Between two rules of one loop. */
  loop?: boolean;
}

export interface PlayGraph { nodes: GraphNode[]; groups: GraphGroup[]; edges: GraphEdge[]; columns: number }

const triggersOf = (s: NonNullable<PlayRecord['signals']>[number]): TriggerSpec[] =>
  (s.inputs ?? []).flatMap(x => (x.kind === 'trigger' ? [x.trigger] : []));

/** Seconds as a short label: 0.25 s, 1 s, 2.5 s. */
const secs = (n: number) => `${Math.round(n * 100) / 100} s`;

/** Which group a control goes in: its layer's, or the shader graph, Finish or other. */
export function controlGroupOf(target: string): { id: string; layerId?: string; label?: string } {
  const m = /^(?:layer|act):([^:]+)::/.exec(target);
  if (m) return { id: `grp:layer:${m[1]}`, layerId: m[1] };
  if (target.startsWith('finish:')) return { id: 'grp:finish', label: 'Finish' };
  if (/^[a-z]+:(?!:)/.test(target)) return { id: 'grp:other', label: 'Other' };
  return { id: 'grp:graph', label: 'Shader graph' };
}

export function playGraph(raw: PlayRecord): PlayGraph {
  const play = asRules(raw);
  const rules = play.signals ?? [];
  const sources = rtSourcesOf(play);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const has = new Set<string>();
  const edgeKeys = new Set<string>();
  const addEdge = (e: Omit<GraphEdge, 'id'>) => {
    if (!has.has(e.from) || !has.has(e.to)) return;
    const id = `${e.kind}|${e.from}|${e.to}|${e.label ?? ''}`;
    if (edgeKeys.has(id)) return;
    edgeKeys.add(id);
    edges.push({ id, ...e });
  };

  // Controls first (sources and rules point at them), grouped.
  const controlGroups = new Map<string, GraphGroup>();
  for (const c of play.controls) {
    const g = controlGroupOf(c.target);
    let group = controlGroups.get(g.id);
    if (!group) {
      const label = g.layerId ? play.layers.find(l => l.id === g.layerId)?.label ?? 'A deleted layer' : g.label;
      group = { id: g.id, kind: 'control', label, column: -1, nodes: [] };
      controlGroups.set(g.id, group);
    }
    const id = `ctl:${c.id}`;
    group.nodes.push(id);
    nodes.push({ id, kind: 'control', ref: c.id, label: c.label, group: g.id });
    has.add(id);
  }

  // Sources: a control source becomes control → control wires.
  const sourceNodes: string[] = [];
  const controlSources: typeof sources = [];
  for (const s of sources) {
    const routes = s.outputs.flatMap(o => o.routes);
    if (s.source.kind === 'control' && routes.length && has.has(`ctl:${s.source.controlId}`)) { controlSources.push(s); continue; }
    const id = `src:${s.id}`;
    nodes.push({ id, kind: 'source', ref: s.id, label: s.label ?? sourceLabel(s.source, play.controls, play.layers), group: id });
    has.add(id);
    sourceNodes.push(id);
  }
  // A route's label: Set or Add, and its delay when it has one.
  const routeLabel = (r: { mode: 'replace' | 'add'; delayMs?: number }) => `${r.mode === 'add' ? 'Add' : 'Set'}${r.delayMs ? ` · ${secs(r.delayMs / 1000)}` : ''}`;
  for (const s of sources) {
    if (!s.enabled) continue;
    const from = controlSources.includes(s) && s.source.kind === 'control' ? `ctl:${s.source.controlId}` : `src:${s.id}`;
    for (const o of s.outputs) for (const r of o.routes) if (r.enabled) addEdge({ from, to: `ctl:${r.to}`, kind: 'value', label: routeLabel(r) });
  }

  // Rules.
  const shapes = signalStructure(play);
  for (const r of rules) {
    const id = `rule:${r.id}`;
    nodes.push({ id, kind: 'rule', ref: r.id, label: r.name, group: id, shape: shapes.get(r.id) });
    has.add(id);
  }

  // Layers acted on.
  const doNodes: string[] = [];
  for (const r of rules) for (const x of r.do ?? []) {
    if (x.do === SIGNAL_ACTION || !x.layerId) continue;
    const id = `do:${x.layerId}`;
    if (has.has(id)) continue;
    nodes.push({ id, kind: 'layer', ref: x.layerId, label: play.layers.find(l => l.id === x.layerId)?.label ?? 'A deleted layer', group: id });
    has.add(id);
    doNodes.push(id);
  }

  // Signal wires into and out of rules.
  const pathFrom = (value: string): string | null => {
    if (value.startsWith('ctl:')) return `ctl:${value.slice(4)}`;
    if (value.startsWith('src:') || value.startsWith('map:')) {
      const sid = value.slice(4);
      if (has.has(`src:${sid}`)) return `src:${sid}`;
      // A control source has no box: its reading is the control it reads.
      const cs = controlSources.find(s => s.id === sid);
      return cs?.source.kind === 'control' ? `ctl:${cs.source.controlId}` : null;
    }
    const c = play.controls.find(x => x.target === value);
    return c ? `ctl:${c.id}` : null;
  };
  for (const r of rules) {
    const to = `rule:${r.id}`;
    for (const t of triggersOf(r)) {
      if (t.on === 'value') { const from = pathFrom(t.value); if (from) addEdge({ from, to, kind: 'signal' }); }
      if (t.on === 'signal') addEdge({ from: `rule:${t.signal}`, to, kind: 'signal' });
    }
    for (const x of r.inputs ?? []) {
      if (x.kind !== 'signal') continue;
      const words = [x.as === 'rise' ? 'starts' : x.as === 'fall' ? 'stops' : '', x.delay ? `+${secs(x.delay)}` : ''].filter(Boolean).join(' ');
      addEdge({ from: `rule:${x.signal}`, to, kind: 'signal', label: words || undefined });
    }
    // Reactions: a signal sent on, or the layers it acts on (one wire a layer, its verbs as the label).
    const byLayer = new Map<string, string[]>();
    for (const x of r.do ?? []) {
      if (!x.enabled) continue;
      if (x.do === SIGNAL_ACTION) { if (x.signal) addEdge({ from: to, to: `rule:${x.signal}`, kind: 'signal', label: 'sends' }); continue; }
      if (!x.layerId) continue;
      const l = play.layers.find(y => y.id === x.layerId);
      const words = byLayer.get(x.layerId) ?? [];
      const w = actionLabel(x.do, l);
      if (!words.includes(w)) words.push(w);
      byLayer.set(x.layerId, words);
    }
    for (const [layerId, words] of byLayer) addEdge({ from: to, to: `do:${layerId}`, kind: 'signal', label: words.join(', ') });
  }
  // Sources that hear a rule (a trigger or captured source on its signal).
  for (const s of sources) {
    const src = s.source;
    const hears = src.kind === 'trigger' && src.trigger.on === 'signal' ? src.trigger.signal : src.kind === 'captured' ? src.signal : '';
    if (hears) addEdge({ from: `rule:${hears}`, to: `src:${s.id}`, kind: 'signal' });
  }

  // Loops: the Rules page's own (every rule-to-rule edge fed to the link planner).
  const ruleEdges = signalEdges(play);
  const loopOf = sgLinkPlan(rules.map(s => ({ id: s.id, links: ruleEdges.filter(e => e.from === s.id).map(e => ({ to: e.to, delay: 0 })) }))).loopOf;
  const loopKey = (nodeId: string) => (nodeId.startsWith('rule:') ? loopOf.get(nodeId.slice(5))?.key : undefined);
  for (const e of edges) {
    const k = loopKey(e.from);
    if (k && k === loopKey(e.to)) e.loop = true;
  }

  // Rule depth: the longest chain of rules into it, loops' inner edges left out (what remains has no cycles).
  const depth = new Map(rules.map(r => [`rule:${r.id}`, 0]));
  const between = edges.filter(e => !e.loop && e.from !== e.to && depth.has(e.from) && depth.has(e.to));
  for (let pass = 0; pass < rules.length; pass++) {
    let moved = false;
    for (const e of between) {
      const d = depth.get(e.from)! + 1;
      if (d > depth.get(e.to)!) { depth.set(e.to, d); moved = true; }
    }
    if (!moved) break;
  }
  const ruleCols = rules.length ? Math.max(...depth.values()) + 1 : 0;
  const ctlCol = 1 + ruleCols;

  // Idle: nothing in or out.
  const touched = new Set(edges.flatMap(e => [e.from, e.to]));
  for (const n of nodes) if (!touched.has(n.id)) n.idle = true;

  const groups: GraphGroup[] = [
    ...sourceNodes.map(id => ({ id, kind: 'source' as const, column: 0, nodes: [id] })),
    ...rules.map(r => { const id = `rule:${r.id}`; return { id, kind: 'rule' as const, column: 1 + depth.get(id)!, nodes: [id] }; }),
    // Layer groups in the layers' order, then the shader graph, Finish and other.
    ...[...controlGroups.values()].sort((a, b) => groupRank(a.id, play) - groupRank(b.id, play)).map(g => ({ ...g, column: ctlCol })),
    ...doNodes.map(id => ({ id, kind: 'layer' as const, column: ctlCol + 1, nodes: [id] })),
  ];
  return { nodes, groups, edges, columns: ctlCol + (doNodes.length ? 2 : 1) };
}

function groupRank(id: string, play: PlayRecord): number {
  if (id.startsWith('grp:layer:')) { const i = play.layers.findIndex(l => l.id === id.slice(10)); return i < 0 ? 999 : i; }
  return { 'grp:graph': 1000, 'grp:finish': 1001, 'grp:other': 1002 }[id] ?? 1003;
}
