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
import { LAYER_NUMERIC_PROPS, parseLayerTarget } from '../types/play';
import { getNodeDefinition } from '../nodes/definitions';
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
  const def = getNodeDefinition(node.type);
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
      const def = getNodeDefinition(node.type);
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
  return [...floats, ...collectColourCandidates(nodes)].filter(c => bindingKeyOf(c.target) in paramBindings);
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
  const top = nodes.find(n => n.id === parts[0]);
  if (!top || parts.length < 3) return top;
  const inner = top.params.subgraph as SubgraphData | undefined;
  return inner?.nodes.find(n => n.id === parts[1]);
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
    const kind = play?.layers.find(l => l.id === lt.layerId)?.kind;
    const hint = kind ? LAYER_NUMERIC_PROPS[kind].find(d => d.key === lt.key)?.hint : undefined;
    return hint ? { hint } : {};
  }
  const node = findTargetNode(nodes, target);
  if (!node) return {};
  const key = target.split('::').pop() ?? '';
  const hint = getNodeDefinition(node.type)?.paramDefs?.[key]?.hint;
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
  const parts = target.split('::');
  const top = nodes.find(n => n.id === parts[0]);
  if (!top) return undefined;
  const key = parts[parts.length - 1];
  if (parts.length >= 3) {
    const override = top.params[`${parts[1]}::${key}`];
    if (typeof override === 'number' || colourValue(override)) return override as number | number[];
    const inner = (top.params.subgraph as SubgraphData | undefined)?.nodes.find(n => n.id === parts[1]);
    const v = inner?.params[key];
    return typeof v === 'number' ? v : colourValue(v) ?? undefined;
  }
  const v = top.params[key];
  return typeof v === 'number' ? v : colourValue(v) ?? undefined;
}

/** Does the control's target still exist (in the graph, or as a layer)? */
export function controlExists(nodes: GraphNode[], control: PlayControl, play?: PlayRecord): boolean {
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
    if (v === undefined || parseLayerTarget(c.target)) continue;
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
