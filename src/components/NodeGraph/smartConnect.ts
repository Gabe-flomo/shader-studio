import type { GraphNode } from '../../types/nodeGraph';
import { typesCompatible } from '../../lib/typesCompatible';

/**
 * Smart connect: the three most likely places to wire a clicked socket, among nodes already on
 * the canvas (see the Smart connect board).
 *
 * 1. Only open sockets that accept the type. Wired inputs, incompatible types and anything that
 *    would make a cycle are skipped.
 * 2. Exact type first: a float output ranks float inputs above the ones it would broadcast into.
 * 3. Then nearest, in the direction data flows. From an output, only nodes to its right; from an
 *    input, only nodes to its left.
 * 4. Never more than three. Everything else is one step away in "Add a new node…".
 * 5. From an output, the graph's Output node is always offered as well — pinned after the
 *    three, wherever it sits and even if something already feeds it — so "just show me
 *    this" is one keypress away. New nodes to add and wire live in quickAdds.ts.
 * 6. Inputs that are already wired are offered too, after the open ones and marked as a
 *    replacement (up to two, nearest first): swapping a UV or a colour source into a socket
 *    that something else feeds is a common edit, and the menu says what it would displace.
 */

export interface Suggestion {
  nodeId: string;
  /** The other end's socket key (an input key from an output, an output key from an input) */
  key: string;
  nodeLabel: string;
  socketLabel: string;
  type: string;
  exact: boolean;
  /** World-space distance between the two sockets */
  distance: number;
  /** Offered regardless of ranking (the Output node) */
  pinned?: boolean;
  /** The socket is already fed; picking this replaces that wire. Label of the current source, e.g. "UV · UV". */
  replaces?: string;
}

export const MAX_REPLACEMENTS = 2;

const OUTPUT_TYPES = new Set(['output', 'vec4Output']);

export const MAX_SUGGESTIONS = 3;

type Pt = { x: number; y: number };

/** ids reachable by following `next` from `start` (excluding start) */
function reach(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...next(start)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return seen;
}

export function suggestConnections(opts: {
  nodes: GraphNode[];
  from: { nodeId: string; key: string; dir: 'in' | 'out' };
  /** Live socket position in world space, when the socket has been measured */
  socketPos: (nodeId: string, dir: 'in' | 'out', key: string) => Pt | null;
  labelOf: (node: GraphNode) => string;
}): Suggestion[] {
  const { nodes, from, socketPos, labelOf } = opts;
  const origin = nodes.find(n => n.id === from.nodeId);
  if (!origin) return [];
  const originSocket = from.dir === 'out' ? origin.outputs[from.key] : origin.inputs[from.key];
  if (!originSocket) return [];
  const type = originSocket.type;
  const originPos = socketPos(origin.id, from.dir, from.key) ?? origin.position;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const upstreamOf = (id: string) => Object.values(byId.get(id)?.inputs ?? {}).flatMap(i => i.connection ? [i.connection.nodeId] : []);
  const downstreamOf = (id: string) => nodes.filter(n => Object.values(n.inputs).some(i => i.connection?.nodeId === id)).map(n => n.id);
  // Wiring origin → X (or X → origin) must not close a loop
  const forbidden = from.dir === 'out' ? reach(origin.id, upstreamOf) : reach(origin.id, downstreamOf);

  const out: Suggestion[] = [];
  const replace: Suggestion[] = [];
  for (const node of nodes) {
    if (node.id === origin.id || forbidden.has(node.id)) continue;
    const onFlowSide = from.dir === 'out' ? node.position.x > origin.position.x : node.position.x < origin.position.x;
    if (!onFlowSide) continue;
    if (from.dir === 'out') {
      for (const [key, input] of Object.entries(node.inputs)) {
        if (key.startsWith('__') || !typesCompatible(type, input.type)) continue;
        // Already fed by this very socket: nothing to do
        if (input.connection?.nodeId === origin.id && input.connection.outputKey === from.key) continue;
        const p = socketPos(node.id, 'in', key) ?? node.position;
        const s: Suggestion = { nodeId: node.id, key, nodeLabel: labelOf(node), socketLabel: input.label, type: input.type, exact: input.type === type, distance: Math.hypot(p.x - originPos.x, p.y - originPos.y) };
        if (input.connection) {
          const src = byId.get(input.connection.nodeId);
          s.replaces = src ? `${labelOf(src)} · ${src.outputs[input.connection.outputKey]?.label ?? input.connection.outputKey}` : 'another node';
          replace.push(s);
        } else {
          out.push(s);
        }
      }
    } else {
      for (const [key, output] of Object.entries(node.outputs)) {
        if (key.startsWith('__') || !typesCompatible(output.type, type)) continue;
        const p = socketPos(node.id, 'out', key) ?? node.position;
        out.push({ nodeId: node.id, key, nodeLabel: labelOf(node), socketLabel: output.label, type: output.type, exact: output.type === type, distance: Math.hypot(p.x - originPos.x, p.y - originPos.y) });
      }
    }
  }
  const rank = (a: Suggestion, b: Suggestion) => (a.exact === b.exact ? 0 : a.exact ? -1 : 1) || a.distance - b.distance;
  out.sort(rank);
  const top = out.slice(0, MAX_SUGGESTIONS);
  replace.sort(rank);
  top.push(...replace.filter(r => !OUTPUT_TYPES.has(byId.get(r.nodeId)?.type ?? '')).slice(0, MAX_REPLACEMENTS));

  if (from.dir === 'out') {
    const outputNode = nodes.find(n => OUTPUT_TYPES.has(n.type) && n.id !== origin.id && !forbidden.has(n.id));
    const [key, input] = outputNode ? Object.entries(outputNode.inputs)[0] ?? [] : [];
    const alreadyThere = outputNode && input?.connection?.nodeId === origin.id && input.connection.outputKey === from.key;
    if (outputNode && key && input && !alreadyThere && typesCompatible(type, input.type) && !top.some(s => s.nodeId === outputNode.id)) {
      const p = socketPos(outputNode.id, 'in', key) ?? outputNode.position;
      top.push({ nodeId: outputNode.id, key, nodeLabel: labelOf(outputNode), socketLabel: input.label, type: input.type, exact: input.type === type, distance: Math.hypot(p.x - originPos.x, p.y - originPos.y), pinned: true });
    }
  }
  return top;
}
