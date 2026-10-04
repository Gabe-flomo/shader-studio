/**
 * lookGraphRecord.ts — the stored form of a Look effect built from nodes
 * (play/lookGraph.ts compiles it). Kept apart from the compiler so the Play
 * record's parser (types/playFinish.ts) and the library can read and check it
 * without loading every node definition.
 *
 * A graph effect is an ordinary custom effect (`kind: 'custom'` with GLSL
 * `code`) that also carries the graph it was compiled from (`graph`). The
 * renderer, exports and offline renders only ever read the code; the graph is
 * there so the effect can be opened in the node editor again.
 *
 *   { v: 1, node?: 'hueRotate', nodes: [
 *       { id: 'n1', type: 'hueRotate', x: 220, y: 40, params: { angle: 30 }, wires: { color: ['in', 'color'] } },
 *       { id: 'out', type: 'fx:out', x: 460, y: 40, wires: { color: ['n1', 'color'] } } ] }
 *
 * The inputs node (`fx:in`, id `in`) is implied: it is always there and never
 * stored. `wires` maps an input socket to [source node id, output key].
 * `node` is set when the effect is one node from + Add effect → Nodes.
 */

export const FX_IN_ID = 'in';
export const FX_OUT_ID = 'out';
export const FX_IN_TYPE = 'fx:in';
export const FX_OUT_TYPE = 'fx:out';
/** Reads the picture (as it came into the stack) at a point: `picture(uv)`. */
export const FX_PICTURE_AT_TYPE = 'fx:pictureAt';

export interface EffectGraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** The node's settings (as on a Studio card). */
  params?: Record<string, unknown>;
  /** Input socket → [source node id, its output key]. */
  wires?: Record<string, [string, string]>;
}

export interface EffectGraph {
  v: 1;
  nodes: EffectGraphNode[];
  /** Set when the effect is a single node added from + Add effect → Nodes (its type). */
  node?: string;
}

/** Most nodes one effect graph keeps. */
export const EFFECT_GRAPH_MAX_NODES = 64;

const ID_RE = /^[A-Za-z0-9_:-]{1,60}$/;

/** A graph from a file or storage: shape checked, sizes capped; null when it isn't one. Node types are checked when it compiles. */
export function parseEffectGraph(raw: unknown): EffectGraph | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.nodes)) return null;
  const nodes: EffectGraphNode[] = [];
  const ids = new Set<string>([FX_IN_ID]);
  for (const x of r.nodes.slice(0, EFFECT_GRAPH_MAX_NODES)) {
    if (!x || typeof x !== 'object') continue;
    const n = x as Record<string, unknown>;
    if (typeof n.id !== 'string' || !ID_RE.test(n.id) || ids.has(n.id) || typeof n.type !== 'string' || !n.type || n.type.length > 80 || n.type === FX_IN_TYPE) continue;
    if (n.type === FX_OUT_TYPE && nodes.some(m => m.type === FX_OUT_TYPE)) continue; // one output
    ids.add(n.id);
    const out: EffectGraphNode = {
      id: n.id, type: n.type,
      x: typeof n.x === 'number' && Number.isFinite(n.x) ? Math.round(n.x) : 0,
      y: typeof n.y === 'number' && Number.isFinite(n.y) ? Math.round(n.y) : 0,
    };
    if (n.params && typeof n.params === 'object' && !Array.isArray(n.params)) {
      // Plain JSON values only (numbers, strings, booleans, arrays of numbers): what a node's settings are.
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.params as Record<string, unknown>)) {
        if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' ? v.length <= 4000 : typeof v === 'boolean') params[k] = v;
        else if (Array.isArray(v) && v.length <= 16 && v.every(e => typeof e === 'number' && Number.isFinite(e))) params[k] = v;
      }
      if (Object.keys(params).length) out.params = params;
    }
    if (n.wires && typeof n.wires === 'object') {
      const wires: Record<string, [string, string]> = {};
      for (const [k, w] of Object.entries(n.wires as Record<string, unknown>)) {
        if (Array.isArray(w) && w.length === 2 && typeof w[0] === 'string' && typeof w[1] === 'string' && w[0] && w[1]) wires[k] = [w[0], w[1]];
      }
      if (Object.keys(wires).length) out.wires = wires;
    }
    nodes.push(out);
  }
  // Wires to nodes that aren't there go.
  for (const n of nodes) {
    if (!n.wires) continue;
    for (const [k, w] of Object.entries(n.wires)) if (!ids.has(w[0]) || w[0] === n.id) delete n.wires[k];
    if (!Object.keys(n.wires).length) delete n.wires;
  }
  if (!nodes.some(n => n.type === FX_OUT_TYPE)) return null;
  const g: EffectGraph = { v: 1, nodes };
  if (typeof r.node === 'string' && r.node && r.node.length <= 80) g.node = r.node;
  return g;
}
