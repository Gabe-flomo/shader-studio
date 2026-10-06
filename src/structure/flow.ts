/**
 * flow.ts — reading a graph's structure against the flows (docs/structure-hints.md): which flow
 * it is (2D, 3D, passes, agents), which stages it has, where the Output's picture has got to,
 * and which stage usually comes next.
 *
 * Pure: graphs in, answers out.
 */
import type { GraphNode } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { FLOWS, FLOW_MARKERS, inFlow, stageOfType, type FlowId, type StageId, type StageOf } from './stages';

type Sub = { nodes?: GraphNode[] } | undefined;
const subOf = (n: GraphNode): GraphNode[] | null => {
  const sg = n.params?.subgraph as Sub;
  return sg && Array.isArray(sg.nodes) ? sg.nodes : null;
};

/** Every node at every level (groups' insides too). */
export function allNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const out: GraphNode[] = [];
  const walk = (list: readonly GraphNode[]) => {
    for (const n of list) {
      out.push(n);
      const sub = subOf(n);
      if (sub) walk(sub);
    }
  };
  walk(nodes);
  return out;
}

/** A node's stage: its type's, or for a group whose type says nothing, the furthest stage inside it in `flow`. */
export function stageOfNode(n: GraphNode, flow?: FlowId): StageOf {
  const own = stageOfType(n.type);
  if (own !== 'any' || !flow) return own;
  const sub = subOf(n);
  if (!sub) return own;
  let best: { stage: StageId; index: number } | null = null;
  for (const m of allNodes(sub)) {
    const s = inFlow(stageOfType(m.type), flow);
    if (s && (!best || s.index > best.index)) best = s;
  }
  return best?.stage ?? 'any';
}

/** How many marker nodes of each flow the graph has (all levels). */
export function flowVotes(nodes: readonly GraphNode[]): Record<FlowId, number> {
  const votes: Record<FlowId, number> = { '2d': 0, '3d': 0, pass: 0, agents: 0 };
  for (const n of allNodes(nodes)) {
    const s = stageOfType(n.type);
    if (s === 'any') continue;
    for (const f of ['3d', 'pass', 'agents'] as const) if (FLOW_MARKERS[f].has(s)) votes[f]++;
  }
  return votes;
}

/**
 * Which flow the graph follows: the one with the most marker nodes (a Ray March, a Pass, a Sense…),
 * agents before passes before 3D on a tie; 2D when it has none.
 */
export function detectFlow(nodes: readonly GraphNode[]): FlowId {
  const v = flowVotes(nodes);
  let best: FlowId = '2d';
  let n = 0;
  for (const f of ['agents', 'pass', '3d'] as const) if (v[f] > n) { best = f; n = v[f]; }
  return best;
}

/** The flow's stages that the graph has (all levels). */
export function stagesPresent(nodes: readonly GraphNode[], flow: FlowId): Set<StageId> {
  const out = new Set<StageId>();
  for (const n of allNodes(nodes)) {
    const s = inFlow(stageOfType(n.type), flow);
    if (s) out.add(s.stage);
  }
  return out;
}

const OUTPUT_TYPES = new Set(['output', 'vec4Output']);

/** The ids feeding `id` within one level (port sentinels and unknown ids skipped). */
function feeders(n: GraphNode, byId: Map<string, GraphNode>): GraphNode[] {
  const out: GraphNode[] = [];
  for (const [key, inp] of Object.entries(n.inputs ?? {})) {
    if (n.type === 'loopCarry' && key === 'next') continue;
    const c = inp?.connection;
    if (!c || c.nodeId === GROUP_PORT_SENTINEL) continue;
    const m = byId.get(c.nodeId);
    if (m) out.push(m);
  }
  return out;
}

/** Everything upstream of `start` in `level` (start included). */
export function upstream(level: readonly GraphNode[], start: GraphNode[]): GraphNode[] {
  const byId = new Map(level.map(n => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...start];
  const out: GraphNode[] = [];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    stack.push(...feeders(n, byId));
  }
  return out;
}

/**
 * Where the picture on the Output has got to: the furthest stage among everything that feeds it
 * (inside groups too). Null when there is no Output or nothing staged feeds it.
 */
export function outputStage(nodes: readonly GraphNode[], flow: FlowId): StageId | null {
  const outs = nodes.filter(n => OUTPUT_TYPES.has(n.type));
  if (!outs.length) return null;
  let best: { stage: StageId; index: number } | null = null;
  for (const n of upstream(nodes, outs)) {
    const list = subOf(n) ? allNodes([n]) : [n];
    for (const m of list) {
      const s = inFlow(stageOfType(m.type), flow);
      if (s && (!best || s.index > best.index)) best = s;
    }
  }
  return best?.stage ?? null;
}

/** The stage after `current` in the flow (the first stage when nothing is there yet); null at the end. */
export function nextStage(flow: FlowId, current: StageId | null): StageId | null {
  const st = FLOWS[flow].stages;
  if (!current) return st[0];
  const i = st.indexOf(current);
  if (i < 0) return null;
  return st[i + 1] ?? null;
}

export interface FlowReading {
  flow: FlowId;
  present: Set<StageId>;
  current: StageId | null;
  next: StageId | null;
}

/** Everything the flow strip shows, in one pass. */
export function readFlow(nodes: readonly GraphNode[]): FlowReading {
  const flow = detectFlow(nodes);
  const present = stagesPresent(nodes, flow);
  const current = outputStage(nodes, flow);
  return { flow, present, current, next: nextStage(flow, current) };
}
