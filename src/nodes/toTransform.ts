/**
 * toTransform.ts — "Switch to Transform": an old single-purpose transform node replaced in place by
 * the universal Transform that computes the same thing (docs/transform-node.md).
 *
 * Each old type has a mapping: its settings onto Transform's (some renamed, some converted: radians
 * to degrees), its sockets onto Transform's (a wired setting goes to the socket that does the same:
 * an Angle to Turn, a Translate to Offset, a Scale to Grow). The switch is offered only when the result
 * is the same picture; otherwise the plan says why not (the card shows the button disabled with it):
 *
 *   - a wired socket with no counterpart (Translate 3D's X wired alone, a vec2 Scale);
 *   - a setting whose units change (an angle in radians) while it is animated: keyframed, on a Play
 *     control or set from the group's card, where its values would need converting too;
 *   - Rotate 2D with nothing wired into Input (it turns the point (0, 0); Transform would read the UV).
 *
 * The plan has the shape the Switch picker's plans have (nodes/switchNode.ts), so the store applies it
 * the same way: same id, consumers re-pointed through the output map, Play controls retargeted.
 * Pure.
 */
import type { GraphNode, InputSocket, SubgraphData } from '../types/nodeGraph';
import { emptyPlayRecord, type PlayRecord } from '../types/play';
import { TransformNode, transformSockets, type TransformDim } from './definitions/transformAny';
import { applySwitchToList, retargetPlay, type SwitchPlan } from './switchNode';
import { getNodeDefinition } from './definitions';

const R2D = 180 / Math.PI;

/** One setting carried over: old key → new key, times a factor (radians to degrees). */
type ParamMove = { from: string; to: string; factor?: number };

interface Mapping {
  dim: TransformDim;
  /** Settings Transform gets whatever the old node had (its mode, a stretch switch…). */
  fixed?: Record<string, unknown>;
  params: ParamMove[];
  /** Old input → Transform input. A wired input that is not here can't be switched. */
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  /** Why this node can't switch as it is, or null. Runs after the generic checks. */
  check?: (n: GraphNode) => string | null;
  /** Settings that a wired input replaces in the old node (they become 0 / 1 on Transform). */
  replacedBy?: Record<string, Record<string, unknown>>;
}

const wired = (n: GraphNode, k: string) => !!n.inputs[k]?.connection;

export const TO_TRANSFORM: Record<string, Mapping> = {
  place2D: {
    dim: '2',
    params: [{ from: 'x', to: 'x' }, { from: 'y', to: 'y' }, { from: 'rotate', to: 'rotate' }, { from: 'scale', to: 'scale' }],
    inputs: { uv: 'p', offset: 'offset', turn: 'turn', grow: 'grow' },
    outputs: { p: 'p', scale: 'scale' },
  },
  uvTransform2d: {
    dim: '2', fixed: { mode: 'space', stretch: true },
    params: [
      { from: 'tx', to: 'x' }, { from: 'ty', to: 'y' }, { from: 'angle', to: 'rotate', factor: R2D },
      { from: 'sx', to: 'sx' }, { from: 'sy', to: 'sy' }, { from: 'pivotX', to: 'px' }, { from: 'pivotY', to: 'py' },
    ],
    inputs: { uv: 'p', translate: 'offset', angle: 'turn' },
    outputs: { result: 'p' },
    // A wired Translate / Angle replaces the slider in UV Transform 2D; on Transform it adds to Move / Rotate.
    replacedBy: { translate: { x: 0, y: 0 }, angle: { rotate: 0 } },
    check: n => (wired(n, 'scale') ? 'Its Scale is wired as a vec2: Transform\'s Grow takes one number (use Stretch per axis by hand)' : null),
  },
  rotate2d: {
    dim: '2', fixed: { mode: 'space' },
    params: [{ from: 'angle', to: 'rotate', factor: R2D }],
    inputs: { input: 'p', angle: 'turn' },
    outputs: { output: 'p' },
    replacedBy: { angle: { rotate: 0 } },
    check: n => (wired(n, 'input') ? null : 'Nothing is wired into its Input, so it turns the point (0, 0); a Transform would turn the picture\'s UV'),
  },
  translate3D: {
    dim: '3',
    params: [{ from: 'tx', to: 'x' }, { from: 'ty', to: 'y' }, { from: 'tz', to: 'z' }],
    inputs: { pos: 'p' },
    outputs: { pos: 'p' },
  },
  rotate3D: {
    dim: '3', fixed: { mode: 'space' },
    params: [],
    inputs: { pos: 'p' },
    outputs: { pos: 'p' },
    check: n => (wired(n, 'angle') ? 'Its Angle is wired: Transform\'s Turn takes all three axes as one vec3' : null),
  },
  scale3d: {
    dim: '3', fixed: { mode: 'space' },
    params: [{ from: 'scale', to: 'scale' }],
    inputs: { p: 'p', dist: 'dist', scale: 'grow' },
    outputs: { p: 'p', dist: 'dist' },
    replacedBy: { scale: { scale: 1 } },
  },
  translate4D: {
    dim: '4',
    params: [{ from: 'tx', to: 'x' }, { from: 'ty', to: 'y' }, { from: 'tz', to: 'z' }, { from: 'tw', to: 'w' }],
    inputs: { p4: 'p' },
    outputs: { p4: 'p' },
  },
  rotate4D: {
    dim: '4',
    params: [{ from: 'spin', to: 'spin' }],
    inputs: { p4: 'p' },
    outputs: { p4: 'p' },
    check: n => (wired(n, 'angle') ? 'Its Angle is wired in degrees: Transform\'s Turn takes radians' : null),
  },
  scale4D: {
    dim: '4',
    params: [{ from: 'scale', to: 'scale' }],
    inputs: { p4: 'p', dist: 'dist', scale: 'grow' },
    outputs: { p4: 'p', dist: 'dist' },
    replacedBy: { scale: { scale: 1 } },
  },
};

/** The old types that switch to Transform. */
export const TO_TRANSFORM_TYPES: ReadonlySet<string> = new Set(Object.keys(TO_TRANSFORM));

/** The settings that depend on the old node's own choices (Rotate 3D's axis, Rotate 4D's plane). */
function dynamicParams(n: GraphNode): ParamMove[] {
  if (n.type === 'rotate3D') {
    const axis = ['x', 'y', 'z'].includes(String(n.params.axis)) ? String(n.params.axis) : 'y';
    return [{ from: 'angle', to: `r${axis}`, factor: R2D }];
  }
  if (n.type === 'rotate4D') {
    const plane = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'].includes(String(n.params.plane)) ? String(n.params.plane) : 'xw';
    return [{ from: 'angle', to: `r${plane}` }];
  }
  return [];
}

/** Why a setting can't move with a unit change: something besides its slider sets it. */
export interface BoundCheck {
  /** Play controls (or anything else outside the node) that set `key` on this node. */
  playTargets?: (key: string) => boolean;
  /** The enclosing group's card sets it (`<id>::<key>` on the group). */
  groupOverride?: (key: string) => boolean;
}

const PER_SOCKET = /^(__keyframes|__kfMode|__kfLoopBack|__kfBypass|__kfOffset|__kfLoopCount|__inExpr)_(.+?)(_[xyz])?$/;

export type TransformPlan = SwitchPlan & {
  /** Group-card overrides to rename: old key → new key (with factor). */
  overrides: ParamMove[];
  /**
   * Set when the switch is allowed but not bit-for-bit: an angle carried from radians to degrees
   * (UV Transform 2D, Rotate 2D's slider, Rotate 3D) gives the same picture up to float rounding
   * (about 1e-6). The card asks before switching; Switch all lists these apart.
   */
  inexact?: string;
};

/** What the card and Switch all say about a switch that differs by float rounding only. */
export const INEXACT_NOTE = 'Output may differ by a tiny rounding amount';
const INEXACT_WHY = `${INEXACT_NOTE} (about one part in a million): its angle converts from radians to degrees`;

/** Plan replacing `old` with a Transform. `scope` is its level (for the wires out of it). Null for other types. */
export function planToTransform(scope: readonly GraphNode[], old: GraphNode, bound: BoundCheck = {}): TransformPlan | null {
  const m = TO_TRANSFORM[old.type];
  if (!m) return null;
  const moves = [...m.params, ...dynamicParams(old)];
  let reason: string | null = null;

  // Translate's X / Y / Z wired one at a time: Transform's Offset is one vector.
  if (old.type === 'translate3D' || old.type === 'translate4D') {
    const w = ['tx', 'ty', 'tz', 'tw'].filter(k => wired(old, k));
    if (w.length) reason = `Its ${w.map(k => k.slice(1).toUpperCase()).join(', ')} ${w.length === 1 ? 'is' : 'are'} wired one by one: a Transform takes the move as one Offset`;
  }
  // The type's own rule (a vec2 Scale wire, an empty Input) says it best, before the generic one.
  reason ??= m.check?.(old) ?? null;
  // Wired inputs: each needs a place, and a wired one that replaces a slider sets that slider to its neutral value.
  const fixed: Record<string, unknown> = { ...(m.fixed ?? {}) };
  for (const [k, s] of Object.entries(old.inputs)) {
    if (!s.connection) continue;
    if (!m.inputs[k]) { reason ??= `Its ${s.label ?? k} is wired, and a Transform has no socket that does the same`; continue; }
    Object.assign(fixed, m.replacedBy?.[k] ?? {});
  }

  // Settings: a unit change can't follow keyframes, Play or a group override.
  const animated = (k: string) => Object.keys(old.params).some(p => p === `__keyframes_${k}` && Array.isArray(old.params[p]) && (old.params[p] as unknown[]).length > 0)
    || !!bound.playTargets?.(k) || !!bound.groupOverride?.(k);
  for (const mv of moves) {
    // (A setting a wire replaces doesn't matter: it becomes 0 on the Transform.)
    if (mv.factor && mv.factor !== 1 && fixed[mv.to] === undefined && animated(mv.from)) {
      reason ??= `Its ${mv.from === 'angle' ? 'Angle' : mv.from} is animated in radians (keyframes, Play or the group's card) and Transform's is in degrees`;
    }
  }

  // The Transform: same id and place, its Dimension's sockets.
  const sockets = transformSockets(m.dim);
  const params: Record<string, unknown> = { ...TransformNode.defaultParams, dim: m.dim };
  const paramMap: Record<string, string> = {};
  // A non-zero angle carried radians → degrees: the same picture up to float rounding, not bit for bit.
  let inexact = false;
  for (const mv of moves) {
    const v = old.params[mv.from];
    if (typeof v === 'number') params[mv.to] = mv.factor ? v * mv.factor : v;
    if (!mv.factor || mv.factor === 1) paramMap[mv.from] = mv.to;
    else if (typeof v === 'number' && v !== 0 && fixed[mv.to] === undefined) inexact = true;
  }
  if (old.type === 'rotate4D') params.spinPlane = String(old.params.plane ?? 'xw');
  Object.assign(params, fixed);
  // Metadata: a note, a label; keyframes and input expressions with their setting / socket.
  const socketMove = (k: string) => m.inputs[k] ?? paramMap[k] ?? null;
  for (const [k, v] of Object.entries(old.params)) {
    if (k === 'label' || k === '__comment' || k === '__credit') { params[k] = v; continue; }
    const pm = PER_SOCKET.exec(k);
    if (pm) { const to = socketMove(pm[2]); if (to) params[`${pm[1]}_${to}${pm[3] ?? ''}`] = v; }
  }
  const inputs: Record<string, InputSocket> = {};
  const inputMap: Record<string, string> = {};
  for (const [k, s] of Object.entries(sockets.inputs)) inputs[k] = { ...s };
  for (const [k, s] of Object.entries(old.inputs)) {
    const to = m.inputs[k];
    if (s.connection && to) { inputs[to] = { ...inputs[to], connection: s.connection }; inputMap[k] = to; }
  }
  // Wires out: through the output map.
  let outWires = 0, dropped = 0;
  for (const n of scope) for (const s of Object.values(n.inputs)) {
    if (s.connection?.nodeId !== old.id) continue;
    if (m.outputs[s.connection.outputKey]) outWires++;
    else { dropped++; reason ??= `Its ${old.outputs[s.connection.outputKey]?.label ?? s.connection.outputKey} output is wired, and a Transform has no output like it`; }
  }
  const node: GraphNode = {
    id: old.id, type: 'transform', position: { ...old.position }, inputs, outputs: { ...sockets.outputs }, params,
    ...(old.bypassed ? { bypassed: true } : {}),
  };
  const overrides = moves.filter(mv => mv.from !== mv.to || mv.factor);
  return {
    type: 'transform', label: 'Transform', ok: !reason, ...(reason ? { reason } : {}), score: 0,
    inputMap, outputMap: { ...m.outputs }, keptWires: Object.keys(inputMap).length + outWires, droppedWires: dropped,
    node, paramMap, lostParams: [], lostLabels: [], overrides,
    ...(inexact && !reason ? { inexact: INEXACT_WHY } : {}),
  };
}

// ── Applying: one node, a selection or the whole graph ──────────────────────

export interface SwitchResult {
  nodes: GraphNode[];
  play: PlayRecord;
  /** Nodes switched (their ids, in the graph). */
  switched: string[];
  /** The switched nodes whose output differs by float rounding (TransformPlan.inexact), with their labels. */
  inexact: Array<{ id: string; label: string }>;
  /** The switched nodes that give exactly the same numbers, with their labels. */
  exact: Array<{ id: string; label: string }>;
  /** Nodes that would switch but can't, with why. */
  skipped: Array<{ id: string; label: string; reason: string }>;
}

const subOf = (n: GraphNode): SubgraphData | null => {
  const sg = n.params.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : null;
};

/**
 * Switch old transform nodes to Transform, at every level (groups included), where `want(node)` says so
 * and the switch is exact. Consumers follow the output map, a group's output ports too, Play controls on
 * renamed settings are retargeted and a group card's overrides renamed (and converted). Pure.
 */
export function switchToTransformIn(nodes: GraphNode[], play: PlayRecord, want: (n: GraphNode) => boolean, opts: { onLoad?: boolean } = {}): SwitchResult {
  const switched: string[] = [];
  const skipped: SwitchResult['skipped'] = [];
  const exact: SwitchResult['exact'] = [];
  const inexact: SwitchResult['inexact'] = [];
  const labelOf = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;
  let pl = play;
  // On load the choice must not depend on the Play record (the nodes and the record are migrated apart): a setting
  // whose units change counts as animated, so only switches that carry every setting as it is are made.
  const playHas = (id: string, key: string) => !!opts.onLoad || (pl.controls ?? []).some(c => { const p = c.target.split('::'); return p.length >= 2 && p[p.length - 2] === id && p[p.length - 1] === key; });

  const level = (list: GraphNode[], parent: GraphNode | null): { list: GraphNode[]; parentParams: Record<string, unknown> | null; outPorts: Record<string, Record<string, string>> } => {
    let out = list.map(n => {
      const sg = subOf(n);
      if (!sg) return n;
      const r = level(sg.nodes, n);
      if (r.list === sg.nodes && !r.parentParams) return n;
      const outputPorts = (sg.outputPorts ?? []).map(p => (r.outPorts[p.fromNodeId]?.[p.fromOutputKey] ? { ...p, fromOutputKey: r.outPorts[p.fromNodeId][p.fromOutputKey] } : p));
      return { ...n, params: { ...(r.parentParams ?? n.params), subgraph: { ...sg, nodes: r.list, outputPorts } } };
    });
    let parentParams: Record<string, unknown> | null = null;
    const outPorts: Record<string, Record<string, string>> = {};
    for (const old of list) {
      if (!TO_TRANSFORM_TYPES.has(old.type) || !want(old)) continue;
      const pp = () => parentParams ?? parent?.params ?? {};
      const plan = planToTransform(out, out.find(n => n.id === old.id)!, {
        playTargets: k => playHas(old.id, k),
        groupOverride: k => parent !== null && `${old.id}::${k}` in pp(),
      });
      if (!plan) continue;
      if (!plan.ok) { skipped.push({ id: old.id, label: labelOf(old), reason: plan.reason ?? '' }); continue; }
      if (opts.onLoad && plan.inexact) { skipped.push({ id: old.id, label: labelOf(old), reason: plan.inexact }); continue; }
      out = applySwitchToList(out, plan);
      pl = retargetPlay(pl, old.id, plan).play;
      outPorts[old.id] = plan.outputMap;
      if (parent) {
        const params = { ...pp() };
        for (const mv of plan.overrides) {
          const k = `${old.id}::${mv.from}`;
          if (!(k in params)) continue;
          const v = params[k];
          delete params[k];
          params[`${old.id}::${mv.to}`] = typeof v === 'number' && mv.factor ? v * mv.factor : v;
        }
        parentParams = params;
      }
      switched.push(old.id);
      (plan.inexact ? inexact : exact).push({ id: old.id, label: labelOf(old) });
    }
    return { list: out, parentParams, outPorts };
  };
  const top = level(nodes, null);
  return { nodes: top.list, play: pl, switched, skipped, exact, inexact };
}

/** What Switch all would do, before doing it: the exact switches, the ones off by rounding, and the ones left. */
export interface SwitchAllPreview {
  exact: SwitchResult['exact'];
  inexact: SwitchResult['inexact'];
  skipped: SwitchResult['skipped'];
}
export function previewSwitchAll(nodes: GraphNode[], play: PlayRecord): SwitchAllPreview {
  const r = switchToTransformIn(nodes, play, () => true);
  return { exact: r.exact, inexact: r.inexact, skipped: r.skipped };
}

/**
 * The nodes Switch all's list says to switch: each group's tick (exact, rounding), less the nodes
 * unticked one by one. Pure, for the dialog and its tests.
 */
export function switchAllChoice(preview: SwitchAllPreview, pick: { exact: boolean; inexact: boolean; off?: ReadonlySet<string> }): Set<string> {
  const off = pick.off ?? new Set<string>();
  return new Set([...(pick.exact ? preview.exact : []), ...(pick.inexact ? preview.inexact : [])].map(x => x.id).filter(id => !off.has(id)));
}

/**
 * Where an old transform node's setting lives on its Transform: the key and the factor its value is
 * multiplied by (radians to degrees). Null when it has no place (Rotate 3D's Axis is in the key). For a
 * rebuild that turns an old builder node into a Transform (sceneBuilder/apply.ts).
 */
export function transformParamFor(old: GraphNode, key: string): { to: string; factor: number } | null {
  const m = TO_TRANSFORM[old.type];
  if (!m) return null;
  const mv = [...m.params, ...dynamicParams(old)].find(x => x.from === key);
  return mv ? { to: mv.to, factor: mv.factor ?? 1 } : null;
}

// ── On load: the retired transform nodes (docs/node-retirements.md, the catalogue sweep) ──────────────────

/**
 * A loaded graph's old transform nodes (Transform 2D, UV Transform 2D, Rotate 2D, Translate / Rotate / Scale 3D
 * and 4D) as Transforms, wherever the switch gives exactly the same numbers: no unit change (an angle in radians
 * carried to degrees is left as it is), every wire with a place. The rest keep their old node, which still loads
 * and renders (they are hidden from the library, not removed). Pure; the same nodes when none switched.
 */
export function migrateTransformsOnLoad(nodes: GraphNode[]): GraphNode[] {
  if (!hasOldTransform(nodes)) return nodes;
  const r = switchToTransformIn(nodes, emptyPlayRecord(), () => true, { onLoad: true });
  return r.switched.length ? r.nodes : nodes;
}

/** The Play record of a graph whose nodes migrateTransformsOnLoad switches: controls on renamed settings follow. */
export function migrateTransformsPlay(savedNodes: GraphNode[], play: PlayRecord): PlayRecord {
  if (!hasOldTransform(savedNodes)) return play;
  return switchToTransformIn(savedNodes, play, () => true, { onLoad: true }).play;
}

function hasOldTransform(nodes: GraphNode[]): boolean {
  return nodes.some(n => TO_TRANSFORM_TYPES.has(n.type) || (subOf(n) ? hasOldTransform(subOf(n)!.nodes) : false));
}
