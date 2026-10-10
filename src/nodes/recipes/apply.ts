/**
 * apply.ts — a starter recipe applied to the graph: its helper nodes get fresh ids, land in free
 * space round the new node (never on a card), are wired in, and the result goes on the Output.
 * Pure; the store (applyStarterRecipe) runs it with one undo step, a compile and a toast.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { freshIds, cardHeight } from '../../store/agentSetup';
import { graphOutput } from '../scene3dDefaults';
import { n } from '../../store/graphBuilder';
import { SELF, type RecipeContext, type StarterRecipe, type Wire } from './types';

const CARD_W = 360;
/** Space kept between a recipe's cards and any other card. */
const GAP = 40;

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (nd: GraphNode, heightOf: (nd: GraphNode) => number): Box => ({ x: nd.position.x, y: nd.position.y, w: CARD_W, h: heightOf(nd) });
const hits = (a: Box, b: Box) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * `added` (absolute positions) moved so none sits on a card in `obstacles` or on each other:
 * column by column, top to bottom, a card that would cover another slides down below it.
 * The columns the recipe laid out stay.
 */
export function placeNear(obstacles: GraphNode[], added: GraphNode[], heightOf: (nd: GraphNode) => number = cardHeight): GraphNode[] {
  const taken = obstacles.map(nd => boxOf(nd, heightOf));
  const at = new Map<string, { x: number; y: number }>();
  const order = [...added].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  for (const nd of order) {
    const b = boxOf(nd, heightOf);
    for (let moved = true, guard = 0; moved && guard < 400; guard++) {
      moved = false;
      for (const t of taken) if (hits(b, t)) { b.y = t.y + t.h + GAP; moved = true; }
    }
    taken.push(b);
    at.set(nd.id, { x: Math.round(b.x), y: Math.round(b.y) });
  }
  return added.map(nd => ({ ...nd, position: at.get(nd.id)! }));
}

/** The recipe's view of the graph round `self`. */
export function recipeContext(nodes: GraphNode[], self: GraphNode, options?: Record<string, boolean>): RecipeContext {
  const c = graphOutput(nodes)?.inputs.color?.connection;
  return { self, nodes, shown: c && c.nodeId !== self.id ? [c.nodeId, c.outputKey] : null, ...(options ? { options } : {}) };
}

export interface AppliedRecipe {
  nodes: GraphNode[];
  /** Ids of the nodes the recipe added (an Output it had to add included). */
  added: string[];
  /** Whether the Output now shows the recipe's result. */
  shown: boolean;
}

/** The graph with `recipe` built round node `selfId`; null when the node isn't there. */
export function applyRecipe(nodes: GraphNode[], selfId: string, recipe: StarterRecipe, nextId: () => string, heightOf: (nd: GraphNode) => number = cardHeight, options?: Record<string, boolean>): AppliedRecipe | null {
  let self = nodes.find(nd => nd.id === selfId);
  if (!self) return null;
  const build = recipe.build(recipeContext(nodes, self, options));
  // A rig being replaced: its nodes go, and any wire into them is cut.
  const gone = new Set((build.remove ?? []).filter(id => id !== selfId));
  if (gone.size) {
    nodes = nodes.filter(nd => !gone.has(nd.id)).map(nd => Object.values(nd.inputs).some(i => i.connection && gone.has(i.connection.nodeId))
      ? { ...nd, inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && gone.has(i.connection.nodeId) ? { ...i, connection: undefined } : i])) }
      : nd);
    self = nodes.find(nd => nd.id === selfId)!;
  }
  const { nodes: fresh, idOf } = freshIds(build.nodes, nextId);
  const real = (w: Wire): Wire => [w[0] === SELF ? self.id : idOf(w[0]), w[1]];

  // Relative → absolute, and the new node's own id in the helpers' wires.
  let added = fresh.map(nd => ({
    ...nd,
    position: { x: self.position.x + nd.position.x, y: self.position.y + nd.position.y },
    inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection?.nodeId === SELF
      ? { ...i, connection: { ...i.connection, nodeId: self.id } } : i])),
  }));

  let output = graphOutput(nodes);
  if (build.show && !output) {
    const right = Math.max(self.position.x, ...added.map(nd => nd.position.x)) + 420;
    const out = n('output', nextId(), right, self.position.y, { __comment: 'Output: what the canvas shows. Added by the starter recipe, since the graph had none.' });
    added = [...added, out];
    output = out;
  }
  added = placeNear(nodes, added, heightOf);

  // The new node: its free inputs wired, its params set.
  const wiredSelf: GraphNode = { ...self, inputs: { ...self.inputs }, params: { ...self.params } };
  for (const [key, w] of Object.entries(build.wire ?? {})) {
    const input = wiredSelf.inputs[key];
    if (input && !input.connection) {
      const [nodeId, outputKey] = real(w);
      wiredSelf.inputs[key] = { ...input, connection: { nodeId, outputKey } };
    }
  }
  for (const [k, v] of Object.entries(build.params ?? {})) {
    if (k === '__comment' && String(self.params.__comment ?? '').trim()) continue;
    wiredSelf.params[k] = v;
  }

  const patches = new Map((build.patch ?? []).map(pt => [pt.id, pt]));
  let next = [...nodes.map(nd => {
    const base = nd.id === self.id ? wiredSelf : nd;
    const pt = patches.get(nd.id);
    return pt ? { ...base, params: { ...base.params, ...(pt.params ?? {}) }, outputs: pt.outputs ?? base.outputs } : base;
  }), ...added];
  let shown = false;
  if (build.show && output && output.inputs.color?.type === 'vec3') {
    const [nodeId, outputKey] = real(build.show);
    const outId = output.id;
    next = next.map(nd => nd.id === outId ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId, outputKey } } } } : nd);
    shown = true;
  }
  return { nodes: next, added: added.map(nd => nd.id), shown };
}
