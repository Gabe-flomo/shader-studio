/**
 * Loops in a graph: a node that, through its wires, feeds itself within one frame.
 *
 * A picture is drawn in one go, so a node can't read its own result: the compile sorts the nodes and
 * a loop has no order. Two kinds of wire carry the frame before (or the engine's side of a step)
 * and so may close a loop legally, the same ones the compile leaves out of its sort
 * (compiler/passGraph.ts): a Pass's Previous (and Repeat's Step / Steps), a wire out of an Agents
 * group, Deposit or Emit (the engine runs those between frames), and a wire out of a Feedback
 * (texture), whose buffer a loop reads as it was a frame ago (compiler/feedbackExpand.ts).
 *
 * Used in three places:
 * - wiring (store connectNodes, the Do bar's connect): `loopIfWired` refuses a wire that would close one;
 * - the compile: `findLoop` names the nodes of a loop already in a graph (an old file, a paste);
 * - the message and its tip: `loopMessage`.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { isAgentEngineOnly } from './agentGraph';
import { GRID_TYPE } from './gridRulesExpand';
import { isBeamTrace } from './curveBeamExpand';
import { SHADER_TEXTURE_TYPE } from '../nodes/definitions/shaderTexture';
import { FEEDBACK_TYPE } from '../nodes/definitions/textureFeedback';

const PASS = 'pass';

export interface LoopWire { fromNodeId: string; fromOutputKey: string; toNodeId: string; toInputKey: string }

export interface GraphLoop {
  /** The loop in the order the picture flows, first node repeated at the end ("A → B → A"). */
  nodeIds: string[];
  /** The wire that closes it: the one to remove (into the node nearest the Output). */
  closing: LoopWire;
  /** A Pass is one of its nodes (only then does the message talk about a Pass's Previous). */
  throughPass: boolean;
}

/** A wire that carries the frame before (or the engine's side of a step): it never closes a loop. */
export function isFrameDelayWire(c: { nodeId: string; outputKey: string }, byId: ReadonlyMap<string, GraphNode>): boolean {
  const src = byId.get(c.nodeId);
  if (!src) return false;
  if (src.type === PASS && (c.outputKey === 'previous' || c.outputKey === 'step' || c.outputKey === 'steps')) return true;
  // A Feedback (texture) is a buffer: a loop back into it reads the buffer a frame ago (compiler/feedbackExpand.ts).
  if (src.type === FEEDBACK_TYPE && !src.bypassed) return true;
  // So is a Data Texture: a read of it that feeds it sees last frame (compiler/dataTextureExpand.ts).
  if (src.type === 'dataTexture' && !src.bypassed) return true;
  return isAgentEngineOnly(src);
}

/**
 * A node the compile opens into a Pass and more before it sorts (a group with a Pass inside, Grid
 * Rules, a Shader Texture, a Curve Trace beam): a loop through one may be legal, so wiring leaves
 * it for the compile to judge.
 */
function mayHideFrameDelay(n: GraphNode): boolean {
  if (n.type === GRID_TYPE || n.type === SHADER_TEXTURE_TYPE || isBeamTrace(n) || n.type === FEEDBACK_TYPE) return true;
  const sg = n.params?.subgraph as SubgraphData | undefined;
  return !!sg?.nodes?.some(x => x.type === PASS || mayHideFrameDelay(x));
}

/** A node's name as its card shows it. */
export function loopNodeName(n: GraphNode | undefined): string {
  if (!n) return 'a node';
  return (typeof n.params?.label === 'string' && n.params.label.trim()) || getNodeDefinitionFor(n)?.label || n.type;
}

/** Forward edges (source → reader) that can close a loop. */
function forwardEdges(nodes: readonly GraphNode[]): Map<string, LoopWire[]> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map<string, LoopWire[]>();
  for (const n of nodes) {
    for (const [key, inp] of Object.entries(n.inputs ?? {})) {
      const c = inp.connection;
      if (!c || !byId.has(c.nodeId) || isFrameDelayWire(c, byId)) continue;
      const list = out.get(c.nodeId) ?? [];
      list.push({ fromNodeId: c.nodeId, fromOutputKey: c.outputKey, toNodeId: n.id, toInputKey: key });
      out.set(c.nodeId, list);
    }
  }
  return out;
}

/** How many wires each node is from the Output (following what it feeds); absent: it doesn't reach it. */
function stepsToOutput(nodes: readonly GraphNode[]): Map<string, number> {
  const dist = new Map<string, number>();
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = nodes.find(n => n.type === 'output' || n.type === 'vec4Output');
  if (!out) return dist;
  dist.set(out.id, 0);
  const queue = [out.id];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const inp of Object.values(byId.get(id)?.inputs ?? {})) {
      const src = inp.connection?.nodeId;
      if (!src || !byId.has(src) || dist.has(src)) continue;
      dist.set(src, dist.get(id)! + 1);
      queue.push(src);
    }
  }
  return dist;
}

/** Build the loop from its wires (in flow order), closed by the wire into the node nearest the Output. */
function shapeLoop(nodes: readonly GraphNode[], wires: LoopWire[]): GraphLoop {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const dist = stepsToOutput(nodes);
  let at = wires.length - 1;
  let best = Infinity;
  wires.forEach((w, i) => {
    const d = dist.get(w.toNodeId);
    if (d !== undefined && d < best) { best = d; at = i; }
  });
  // Rotate so the loop starts at the closing wire's reader and ends with the closing wire.
  const rotated = [...wires.slice(at + 1), ...wires.slice(0, at + 1)];
  const closing = rotated[rotated.length - 1];
  const nodeIds = [closing.toNodeId, ...rotated.map(w => w.toNodeId)];
  return { nodeIds, closing, throughPass: nodeIds.some(id => byId.get(id)?.type === PASS) };
}

/**
 * One loop in `nodes` (one level of a graph, as the compile sees it), or null. Wires that carry the
 * frame before are left out, so a Pass's feedback is not a loop.
 */
export function findLoop(nodes: readonly GraphNode[]): GraphLoop | null {
  const edges = forwardEdges(nodes);
  const state = new Map<string, 1 | 2>(); // 1: on the path, 2: done
  for (const start of nodes) {
    if (state.has(start.id)) continue;
    // Iterative DFS: a path of [node, its edges, next edge index].
    const path: Array<{ id: string; edges: LoopWire[]; i: number; via?: LoopWire }> = [{ id: start.id, edges: edges.get(start.id) ?? [], i: 0 }];
    state.set(start.id, 1);
    while (path.length) {
      const top = path[path.length - 1];
      if (top.i >= top.edges.length) { state.set(top.id, 2); path.pop(); continue; }
      const e = top.edges[top.i++];
      const s = state.get(e.toNodeId);
      if (s === 2) continue;
      if (s === 1) {
        const from = path.findIndex(p => p.id === e.toNodeId);
        const wires = [...path.slice(from + 1).map(p => p.via!), e];
        return shapeLoop(nodes, wires);
      }
      state.set(e.toNodeId, 1);
      path.push({ id: e.toNodeId, edges: edges.get(e.toNodeId) ?? [], i: 0, via: e });
    }
  }
  return null;
}

/**
 * The loop wiring `from.outputKey` into `to.inputKey` would make, or null when it makes none (or
 * might be legal: through a node the compile opens into a Pass). `nodes` is the level the wire is on.
 */
export function loopIfWired(nodes: readonly GraphNode[], fromId: string, outputKey: string, toId: string, inputKey: string): GraphLoop | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  if (isFrameDelayWire({ nodeId: fromId, outputKey }, byId)) return null;
  const wire: LoopWire = { fromNodeId: fromId, fromOutputKey: outputKey, toNodeId: toId, toInputKey: inputKey };
  if (fromId === toId) {
    return mayHideFrameDelay(byId.get(toId)!) ? null : { nodeIds: [toId, toId], closing: wire, throughPass: byId.get(toId)!.type === PASS };
  }
  // Does `to` already feed `from`? Breadth first, so the path named is the shortest.
  const edges = forwardEdges(nodes);
  const via = new Map<string, LoopWire>();
  const queue = [toId];
  const seen = new Set([toId]);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (id === fromId) break;
    for (const e of edges.get(id) ?? []) {
      if (seen.has(e.toNodeId)) continue;
      seen.add(e.toNodeId);
      via.set(e.toNodeId, e);
      queue.push(e.toNodeId);
    }
  }
  if (!seen.has(fromId)) return null;
  const path: string[] = [fromId];
  for (let id = fromId; id !== toId;) { id = via.get(id)!.fromNodeId; path.unshift(id); }
  const nodeIds = [...path, toId];
  if (nodeIds.some(id => mayHideFrameDelay(byId.get(id)!))) return null;
  return { nodeIds, closing: wire, throughPass: nodeIds.some(id => byId.get(id)?.type === PASS) };
}

/** "Draw agents → Stops Palette → Draw agents". */
export function loopPath(nodes: readonly GraphNode[], loop: GraphLoop): string {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return loop.nodeIds.map(id => loopNodeName(byId.get(id))).join(' → ');
}

/**
 * What to do instead, when the loop is a known mistake: a Draw agents' own Density (or Image)
 * coming back into its Over, to colour the background by where the walkers are.
 */
export function loopTip(nodes: readonly GraphNode[], loop: GraphLoop): string | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const draw = loop.nodeIds.map(id => byId.get(id)).find(n => n?.type === 'drawAgents');
  if (draw) {
    return `To colour the background by where the walkers are, set Background on ${loopNodeName(draw)} to “Palette by density” and leave Over unwired (or wired to a picture that doesn’t come from it).`;
  }
  return null;
}

/** The compile's message for a loop already in the graph. */
export function loopMessage(nodes: readonly GraphNode[], loop: GraphLoop): string {
  const parts = [`This graph has a loop: ${loopPath(nodes, loop)}. A node can’t use its own result in the same frame.`];
  if (loop.throughPass) parts.push('A loop through a Pass must come out of its Previous output (the picture from the frame before).');
  const tip = loopTip(nodes, loop);
  if (tip) parts.push(tip);
  return parts.join(' ');
}
