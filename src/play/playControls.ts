/**
 * playControls.ts — which params can be Play controls, and how to read and
 * write one by its target path.
 *
 * A control's target is the publish dialog's candidate path
 * (`nodeId::paramKey`, or `groupId::innerNodeId::paramKey` one level into a
 * group). The eligibility rule is the compiler's: the param has to be a live
 * uniform in the last compile, so the candidate list is the publish
 * collector's floats (plus colour params) filtered through `paramBindings`.
 * Integer steppers, compile-time params, hidden params and keyframed params
 * are baked into the shader, so they never appear.
 */

import type { GraphNode, ParamDef, SubgraphData } from '../types/nodeGraph';
import type { PlayControl, PlayControlKind, PlayRecord } from '../types/play';
import { layerNumericProps, parseActionTarget, parseLayerTarget } from '../types/play';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { driverOf, nodeLabelOf, paramDrivers, type ParamDriver } from './paramDrivers';
import { collectParamCandidates } from '../nodes/userNodes/paramCandidates';
import { isParamVisible } from '../compiler/uniformPatcher';
import { bindingKeyOf } from '../lib/playEngine';

export interface PlayCandidate {
  target: string;
  kind: PlayControlKind;
  nodeLabel: string;
  groupLabel?: string;
  paramLabel: string;
  min: number;
  max: number;
  step?: number;
  value: number | number[];
  /** The param's docstring from its node definition. */
  hint?: string;
}

const SKIP_TYPES = new Set(['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'loopIndex', 'loopCarry', 'group', 'exprNode', 'customFn']);

function labelOf(node: GraphNode): string {
  const def = getNodeDefinitionFor(node);
  return (typeof node.params.label === 'string' && node.params.label.trim()) || def?.label || node.type;
}

function isColourDef(pd: ParamDef): boolean {
  return pd.type === 'vec3' || pd.type === 'vec3color';
}

function colourValue(v: unknown): number[] | null {
  return Array.isArray(v) && v.length >= 3 && v.every(n => typeof n === 'number') ? [v[0], v[1], v[2]] : null;
}

/** Colour params the publish collector doesn't cover, same walk (top level + one group in). */
function collectColourCandidates(nodes: GraphNode[]): PlayCandidate[] {
  const out: PlayCandidate[] = [];
  const visit = (list: GraphNode[], prefix: string, groupLabel: string | undefined, overrides: Record<string, unknown>) => {
    for (const node of list) {
      if (SKIP_TYPES.has(node.type)) continue;
      const def = getNodeDefinitionFor(node);
      if (!def?.paramDefs) continue;
      for (const [key, pd] of Object.entries(def.paramDefs)) {
        if (!isColourDef(pd) || pd.compileTime) continue;
        if (!isParamVisible(pd, node.params, def.defaultParams)) continue;
        if (node.inputs[`__param_${key}`]?.connection) continue;
        const value = colourValue(overrides[`${node.id}::${key}`]) ?? colourValue(node.params[key]) ?? colourValue(def.defaultParams?.[key]);
        if (!value) continue;
        out.push({ target: `${prefix}${node.id}::${key}`, kind: 'color', nodeLabel: labelOf(node), groupLabel, paramLabel: pd.label, min: 0, max: 1, value, ...(pd.hint ? { hint: pd.hint } : {}) });
      }
    }
  };
  visit(nodes, '', undefined, {});
  for (const g of nodes) {
    if (g.type !== 'group') continue;
    const inner = g.params.subgraph as SubgraphData | undefined;
    if (inner) visit(inner.nodes, `${g.id}::`, labelOf(g), g.params);
  }
  return out;
}

/**
 * Every param in the graph that can be a Play control right now. `paramBindings`
 * is the last compile's `nodeId::paramKey → uniform` map: a param not in it is
 * baked, so it is left out.
 */
export function collectPlayCandidates(nodes: GraphNode[], paramBindings: Record<string, string>): PlayCandidate[] {
  const floats: PlayCandidate[] = collectParamCandidates({ nodes, inputPorts: [], outputPorts: [] }).map(c => ({
    target: c.sourcePath, kind: 'float', nodeLabel: c.nodeLabel, groupLabel: c.groupLabel, paramLabel: c.paramLabel,
    min: c.min, max: c.max, step: c.step, value: c.value, ...(c.hint ? { hint: c.hint } : {}),
  }));
  // A group inside a group (what an outer group card "surfaces"): its nodes' sliders, two levels in.
  const nested: PlayCandidate[] = [];
  for (const outer of nodes) {
    if (outer.type !== 'group') continue;
    for (const inner of ((outer.params.subgraph as SubgraphData | undefined)?.nodes ?? [])) {
      const sub = inner.type === 'group' ? inner.params.subgraph as SubgraphData | undefined : undefined;
      if (!sub) continue;
      for (const c of collectParamCandidates(sub)) {
        if (c.sourcePath.split('::').length !== 2) continue;
        const over = outer.params[`${inner.id}::${c.sourcePath}`] ?? inner.params[c.sourcePath];
        nested.push({
          target: `${outer.id}::${inner.id}::${c.sourcePath}`, kind: 'float', nodeLabel: c.nodeLabel, groupLabel: `${labelOf(outer)} › ${labelOf(inner)}`,
          paramLabel: c.paramLabel, min: c.min, max: c.max, step: c.step, value: typeof over === 'number' ? over : c.value, ...(c.hint ? { hint: c.hint } : {}),
        });
      }
    }
  }
  const seen = new Set(floats.map(c => c.target));
  return [...floats, ...nested.filter(c => !seen.has(c.target)), ...collectColourCandidates(nodes)]
    .filter(c => bindingKeyOf(c.target) in paramBindings)
    // Play takes free sliders only: one a wire has taken over (Center X under a wired Center) does nothing.
    .filter(c => { const n = findTargetNode(nodes, c.target); const key = c.target.split('::').pop()!; return !n || !driverOf(n, key); });
}

/** Where a taken-over slider's value really comes from, and the free sliders there. */
export interface UpstreamControls {
  driver: ParamDriver;
  /** The node feeding the wire, when it's in this graph. */
  source: GraphNode | null;
  sourceLabel: string;
  /** Its free sliders, as Play candidates. */
  candidates: PlayCandidate[];
  /** When it has none: a wire taking over its sliders too (one hop up, named, not followed). */
  blockedBy: { param: string; from: string } | null;
}

/**
 * For a slider a wire has taken over: the node the wire comes from and the
 * controls Play can make there instead. One hop only: if that node's sliders
 * are wired too, say so and stop.
 */
export function upstreamControls(nodes: GraphNode[], candidates: readonly PlayCandidate[], node: GraphNode, paramKey: string): UpstreamControls | null {
  const driver = driverOf(node, paramKey);
  if (!driver) return null;
  const source = findTargetNode(nodes, `${driver.connection.nodeId}::x`) ?? null;
  const sourceLabel = source ? nodeLabelOf(source) : 'another node';
  const own = candidates.filter(c => { const p = c.target.split('::'); return p[p.length - 2] === driver.connection.nodeId; });
  let blockedBy: UpstreamControls['blockedBy'] = null;
  if (source && !own.length) {
    const d = paramDrivers(source);
    const first = [...d.entries()][0];
    if (first) {
      const from = findTargetNode(nodes, `${first[1].connection.nodeId}::x`);
      const pd = getNodeDefinitionFor(source)?.paramDefs?.[first[0]];
      blockedBy = { param: pd?.label ?? first[0], from: from ? nodeLabelOf(from) : 'another node' };
    }
  }
  return { driver, source, sourceLabel, candidates: own, blockedBy };
}

/** The candidate for one node's param (its target may carry a group in front), if it can be a control. */
export function candidateFor(candidates: readonly PlayCandidate[], nodeId: string, paramKey: string): PlayCandidate | undefined {
  // A group card's slider names its inner node too ("inner::radius", or "innerGroup::inner::radius").
  const exact = candidates.find(c => c.target === `${nodeId}::${paramKey}`);
  if (exact || paramKey.includes('::')) return exact;
  return candidates.find(c => { const p = c.target.split('::'); return p[p.length - 2] === nodeId && p[p.length - 1] === paramKey; });
}

/** Default panel label for a candidate: "Node · Param" (with the group in front when nested). */
export function candidateLabel(c: Pick<PlayCandidate, 'nodeLabel' | 'groupLabel' | 'paramLabel'>): string {
  return `${c.groupLabel ? `${c.groupLabel} › ` : ''}${c.nodeLabel} · ${c.paramLabel}`;
}

/** Split a target path into the node the store edits and the param key it takes. */
export function targetParts(target: string): { nodeId: string; paramKey: string } {
  const parts = target.split('::');
  if (parts.length >= 3) return { nodeId: parts[0], paramKey: parts.slice(1).join('::') };
  return { nodeId: parts[0], paramKey: parts[1] ?? '' };
}

/** The node a target path names, walking one group in when needed. */
export function findTargetNode(nodes: GraphNode[], target: string): GraphNode | undefined {
  const parts = target.split('::');
  let list: GraphNode[] | undefined = nodes, n: GraphNode | undefined;
  for (let i = 0; i < Math.max(1, parts.length - 1); i++) {
    n = list?.find(x => x.id === parts[i]);
    if (!n) return undefined;
    list = (n.params.subgraph as SubgraphData | undefined)?.nodes;
  }
  return n;
}

/**
 * What the Play page can say about a control: the param's hint from its node
 * definition, and the comment written on the node in the graph (a group's
 * comment when the node inside it has none). Layer properties get their
 * built-in description.
 */
export function controlHelp(nodes: GraphNode[], target: string, play?: PlayRecord): { hint?: string; comment?: string } {
  const lt = parseLayerTarget(target);
  if (lt) {
    const layer = play?.layers.find(l => l.id === lt.layerId);
    const hint = layer ? layerNumericProps(layer).find(d => d.key === lt.key)?.hint : undefined;
    return hint ? { hint } : {};
  }
  const node = findTargetNode(nodes, target);
  if (!node) return {};
  const key = target.split('::').pop() ?? '';
  const hint = getNodeDefinitionFor(node)?.paramDefs?.[key]?.hint;
  const commentOf = (n: GraphNode | undefined) => typeof n?.params.__comment === 'string' ? (n.params.__comment as string).trim() : '';
  const comment = commentOf(node) || commentOf(nodes.find(n => n.id === target.split('::')[0]));
  return { ...(hint ? { hint } : {}), ...(comment ? { comment } : {}) };
}

/** A layer property's current value from the record, or undefined when the layer is gone. */
export function readLayerValue(play: PlayRecord | undefined, target: string): number | undefined {
  const lt = parseLayerTarget(target);
  if (!lt || !play) return undefined;
  const layer = play.layers.find(l => l.id === lt.layerId);
  const v = layer ? (layer as unknown as Record<string, unknown>)[lt.key] : undefined;
  return typeof v === 'number' ? v : undefined;
}

/** The control's current value: a graph param (a group override wins over the inner node's own value) or a layer property. */
export function readControlValue(nodes: GraphNode[], target: string, play?: PlayRecord): number | number[] | undefined {
  if (parseLayerTarget(target)) return readLayerValue(play, target);
  if (parseActionTarget(target)) return undefined;
  // "group::…::node::param": an outer group's override of the rest of the path wins (that's what its
  // card's slider sets), then the next group's, then the node's own value.
  const parts = target.split('::');
  const key = parts[parts.length - 1];
  let list: GraphNode[] | undefined = nodes;
  for (let i = 0; i < parts.length - 1; i++) {
    const n: GraphNode | undefined = list?.find(x => x.id === parts[i]);
    if (!n) return undefined;
    if (i === parts.length - 2) { const v = n.params[key]; return typeof v === 'number' ? v : colourValue(v) ?? undefined; }
    const override = n.params[parts.slice(i + 1).join('::')];
    if (typeof override === 'number' || colourValue(override)) return override as number | number[];
    list = (n.params.subgraph as SubgraphData | undefined)?.nodes;
  }
  return undefined;
}

/** Does the control's target still exist (in the graph, or as a layer)? */
export function controlExists(nodes: GraphNode[], control: PlayControl, play?: PlayRecord): boolean {
  const at = parseActionTarget(control.target);
  if (at) return !!play?.layers.some(l => l.id === at.layerId);
  return readControlValue(nodes, control.target, play) !== undefined;
}

/** Store values of every control, keyed by control id (the engine's base values). */
export function readBaseValues(nodes: GraphNode[], play: PlayRecord): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>();
  for (const c of play.controls) {
    const v = readControlValue(nodes, c.target, play);
    if (v !== undefined) out.set(c.id, v);
  }
  return out;
}

/** A copy of `play` with driven layer properties written into their layers (for a play file export). */
export function bakeLayerValues(play: PlayRecord, values: Map<string, number | number[]>): PlayRecord {
  let layers = play.layers;
  for (const c of play.controls) {
    const lt = parseLayerTarget(c.target);
    const v = values.get(c.id);
    if (!lt || typeof v !== 'number') continue;
    layers = layers.map(l => l.id === lt.layerId ? { ...l, [lt.key]: v } as typeof l : l);
  }
  return layers === play.layers ? play : { ...play, layers };
}

/**
 * A copy of `nodes` with each control's value written into its param. Used
 * when exporting a play file while mappings are driving controls: the file
 * then opens looking exactly as the picture did at export time.
 */
export function bakeControlValues(nodes: GraphNode[], play: PlayRecord, values: Map<string, number | number[]>): GraphNode[] {
  if (values.size === 0) return nodes;
  let out = nodes;
  for (const c of play.controls) {
    const v = values.get(c.id);
    if (v === undefined || parseLayerTarget(c.target) || parseActionTarget(c.target)) continue;
    const value = Array.isArray(v) ? [v[0], v[1], v[2]] : v;
    const parts = c.target.split('::');
    const key = parts[parts.length - 1];
    out = out.map(n => {
      if (n.id !== parts[0]) return n;
      if (parts.length < 3) return { ...n, params: { ...n.params, [key]: value } };
      const sg = n.params.subgraph as SubgraphData | undefined;
      const inner = sg ? { ...sg, nodes: sg.nodes.map(sn => sn.id === parts[1] ? { ...sn, params: { ...sn.params, [key]: value } } : sn) } : sg;
      return { ...n, params: { ...n.params, [`${parts[1]}::${key}`]: value, ...(inner ? { subgraph: inner } : {}) } };
    });
  }
  return out;
}

let seq = 0;
/** Ids for controls and mappings: unique within a session, readable in a file. */
export function playId(prefix: 'ctl' | 'map' | 'layer' | 'act'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** What became of a graph control's slider: still there, moved into a group, or gone. */
export type TargetFate =
  | { status: 'ok' }
  | { status: 'moved'; target: string; groups: string[] }
  | { status: 'param' }
  | { status: 'deleted' };

/**
 * Where a control's node is now. A node wrapped into a group (or a group
 * into another) keeps its id, so it's found by id at its new depth, and the
 * control can be pointed at the new path (group::…::node::param).
 */
export function locateTarget(nodes: GraphNode[], target: string): TargetFate {
  if (parseLayerTarget(target) || parseActionTarget(target)) return { status: 'ok' };
  if (readControlValue(nodes, target) !== undefined) return { status: 'ok' };
  const parts = target.split('::');
  const nodeId = parts[parts.length - 2], key = parts[parts.length - 1];
  const find = (list: GraphNode[], path: GraphNode[]): { node: GraphNode; path: GraphNode[] } | null => {
    for (const n of list) {
      if (n.id === nodeId) return { node: n, path };
      const sub = n.params.subgraph as SubgraphData | undefined;
      if (sub?.nodes) { const f = find(sub.nodes, [...path, n]); if (f) return f; }
    }
    return null;
  };
  const hit = find(nodes, []);
  if (!hit) return { status: 'deleted' };
  const moved = [...hit.path.map(g => g.id), nodeId, key].join('::');
  if (moved === target || readControlValue(nodes, moved) === undefined) return { status: 'param' };
  return { status: 'moved', target: moved, groups: hit.path.map(labelOf) };
}
