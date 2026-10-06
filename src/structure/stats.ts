/**
 * stats.ts — how often each order of stages appears in a set of graphs (the bundled examples):
 * the numbers behind docs/structure-hints.md. Used by its test, which also prints them.
 *
 * A "link" is a staged node and the nearest staged node feeding it, skipping nodes that go
 * anywhere (maths, time, functions): UV → Multiply → Circle SDF is one Space → Shape link.
 */
import type { GraphNode } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { allNodes, detectFlow, stageOfNode, upstream } from './flow';
import { FLOWS, inFlow, stageOfType, type FlowId, type StageId } from './stages';

type Sub = { nodes?: GraphNode[] } | undefined;
const subOf = (n: GraphNode): GraphNode[] | null => {
  const sg = n.params?.subgraph as Sub;
  return sg && Array.isArray(sg.nodes) ? sg.nodes : null;
};

export type LinkKind = 'forward' | 'same' | 'feedback' | 'tint' | 'backward';

export interface StageLink {
  from: StageId;
  to: StageId;
  kind: LinkKind;
}

/** Stages a flow's loop goes back to: what a trail or a pass feeds is next frame's input. */
const LOOP_INTO: Partial<Record<FlowId, ReadonlySet<StageId>>> = {
  pass: new Set<StageId>(['pass']),
  agents: new Set<StageId>(['sense', 'steer', 'move']),
};
const LOOP_FROM: Partial<Record<FlowId, ReadonlySet<StageId>>> = {
  pass: new Set<StageId>(['source', 'pass', 'rule', 'readout', 'colour', 'post']),
  agents: new Set<StageId>(['trail', 'draw']),
};

/**
 * One link's kind: forward / same stage by the flow's order; `feedback` when it closes the
 * flow's loop (anything drawn into a Pass, a trail read by the next step); `tint` when a colour
 * goes into an earlier node's colour input (a picture laid into a grid, a glow's tint); else
 * backward.
 */
export function linkKind(flow: FlowId, from: StageId, to: StageId, inputType: string): LinkKind {
  const order = FLOWS[flow].stages;
  const d = order.indexOf(to) - order.indexOf(from);
  if (d > 0) return 'forward';
  if (d === 0) return 'same';
  if (LOOP_INTO[flow]?.has(to) && LOOP_FROM[flow]?.has(from)) return 'feedback';
  if (inputType === 'vec3' && (from === 'colour' || from === 'post')) return 'tint';
  return 'backward';
}

/** Stage links in one graph (every level), in `flow`'s terms. */
export function stageLinks(nodes: readonly GraphNode[], flow: FlowId): StageLink[] {
  const out: StageLink[] = [];
  const walk = (level: readonly GraphNode[]) => {
    const byId = new Map(level.map(n => [n.id, n]));
    const staged = (n: GraphNode) => inFlow(stageOfNode(n, flow), flow);
    // Nearest staged nodes upstream of a node (itself when staged), through unstaged ones.
    const memo = new Map<string, Set<string>>();
    const nearest = (m: GraphNode, guard: Set<string>): Set<string> => {
      if (staged(m)) return new Set([m.id]);
      const hit = memo.get(m.id);
      if (hit) return hit;
      const res = new Set<string>();
      if (guard.has(m.id)) return res;
      guard.add(m.id);
      for (const [key, inp] of Object.entries(m.inputs ?? {})) {
        if (m.type === 'loopCarry' && key === 'next') continue;
        const c = inp?.connection;
        const f = c && c.nodeId !== GROUP_PORT_SENTINEL ? byId.get(c.nodeId) : undefined;
        if (f) for (const x of nearest(f, guard)) res.add(x);
      }
      guard.delete(m.id);
      memo.set(m.id, res);
      return res;
    };
    for (const n of level) {
      const sub = subOf(n);
      if (sub) walk(sub);
      const to = staged(n);
      if (!to) continue;
      for (const [key, inp] of Object.entries(n.inputs ?? {})) {
        if (n.type === 'loopCarry' && key === 'next') continue;
        const c = inp?.connection;
        const f = c && c.nodeId !== GROUP_PORT_SENTINEL ? byId.get(c.nodeId) : undefined;
        if (!f) continue;
        for (const id of nearest(f, new Set())) {
          const from = staged(byId.get(id)!);
          if (from) out.push({ from: from.stage, to: to.stage, kind: linkKind(flow, from.stage, to.stage, inp.type) });
        }
      }
    }
  };
  walk(nodes);
  return out;
}

export interface FlowStats {
  flow: FlowId;
  graphs: number;
  links: number;
  /** Links by kind. */
  kinds: Record<LinkKind, number>;
  /** "a>b" → number of graphs with at least one such link (feedback and tint links left out). */
  pairs: Map<string, number>;
  /** Graphs with at least one backward link. */
  graphsWithBackward: number;
  /** The stages feeding the Output, in the flow's order ("space shape shapeIt post") → graphs. */
  chains: Map<string, number>;
}

/** The flow's stages that feed the Output (inside groups too), in the flow's order. */
export function outputChain(nodes: readonly GraphNode[], flow: FlowId): StageId[] {
  const outs = nodes.filter(n => n.type === 'output' || n.type === 'vec4Output');
  const have = new Set<StageId>();
  for (const n of upstream(nodes, outs)) for (const m of allNodes([n])) {
    const s = inFlow(stageOfType(m.type), flow);
    if (s) have.add(s.stage);
  }
  return FLOWS[flow].stages.filter(s => have.has(s));
}

export interface StageStats {
  total: number;
  byFlow: Record<FlowId, FlowStats>;
}

export function computeStageStats(graphs: ReadonlyArray<readonly GraphNode[]>): StageStats {
  const mk = (flow: FlowId): FlowStats => ({ flow, graphs: 0, links: 0, kinds: { forward: 0, same: 0, feedback: 0, tint: 0, backward: 0 }, pairs: new Map(), graphsWithBackward: 0, chains: new Map() });
  const byFlow: Record<FlowId, FlowStats> = { '2d': mk('2d'), '3d': mk('3d'), pass: mk('pass'), agents: mk('agents') };
  let total = 0;
  for (const nodes of graphs) {
    if (!nodes.length) continue;
    total++;
    const flow = detectFlow(nodes);
    const st = byFlow[flow];
    st.graphs++;
    const seen = new Set<string>();
    let back = false;
    for (const l of stageLinks(nodes, flow)) {
      st.links++;
      st.kinds[l.kind]++;
      if (l.kind === 'backward') back = true;
      if (l.kind === 'forward' || l.kind === 'backward') seen.add(`${l.from}>${l.to}`);
    }
    if (back) st.graphsWithBackward++;
    for (const k of seen) st.pairs.set(k, (st.pairs.get(k) ?? 0) + 1);
    const chain = outputChain(nodes, flow).join(' ');
    st.chains.set(chain, (st.chains.get(chain) ?? 0) + 1);
  }
  return { total, byFlow };
}

/**
 * For two stages of a flow: in how many graphs A feeds B, and B feeds A. The share A-first is how
 * strongly the examples agree with the flow's order.
 */
export function orderAgreement(st: FlowStats, a: StageId, b: StageId): { ab: number; ba: number } {
  return { ab: st.pairs.get(`${a}>${b}`) ?? 0, ba: st.pairs.get(`${b}>${a}`) ?? 0 };
}
