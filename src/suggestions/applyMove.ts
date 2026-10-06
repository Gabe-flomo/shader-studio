/**
 * applyMove.ts — a move (moves.ts) applied to the graph, pure. The store's applySuggestion runs it
 * with one undo step, a compile and a toast.
 *
 *  - Placeholders: IN is the value (the output, or what fed the input: a UV node is added in front
 *    of an unwired space input), SELF the node, PICTURE what the Output shows.
 *  - Placement: the move's nodes go right of the node (after an output) or left of it (in front of
 *    an input), in free space (recipes' placeNear: never on a card).
 *  - In place: a transform after an output takes over every wire the output fed (that accepts its
 *    type); in front of an input it becomes the input's source.
 *  - Showing: a branch's light is laid over the picture with Add Colors ("layer"), put on the
 *    Output ("replace"), or shown only when the Output shows nothing ("ifEmpty"). A transform that
 *    took no wires is shown the same way when the Output is empty (a distance painted with SDF
 *    Fill, a number as grey), so applying a move always shows something on an empty canvas.
 *  - A move with a starter recipe hands over to it when the socket feeds nothing yet; Trails adds
 *    a Fade node and runs Fade's own recipe.
 */
import type { GraphNode } from '../types/nodeGraph';
import { freshIds, cardHeight } from '../store/agentSetup';
import { n } from '../store/graphBuilder';
import { graphOutput } from '../nodes/scene3dDefaults';
import { applyRecipe, placeNear, recipesFor } from '../nodes/recipes';
import { typesCompatible } from '../lib/typesCompatible';
import { IN, OTHER, PICTURE, SELF, labelOf, type Move, type MoveContext, type Wire } from './moves';
import { socketKind } from './kinds';

export interface MoveTarget {
  nodeId: string;
  /** The socket the move works on (an output key, or an input key for side 'in'). */
  key: string;
  side: 'in' | 'out';
}

export interface AppliedMove {
  nodes: GraphNode[];
  /** Ids of the nodes it added. */
  added: string[];
  /** The node holding the result (to select next), when the move made one. */
  resultNodeId: string | null;
  /** Whether the Output now shows the result. */
  shown: boolean;
  /** Wires it took over from the output (a transform in place). */
  rewired: number;
}

const COL = 420;
const UV_IN = '$uvIn';

/** Who reads output `key` of node `id` in this scope: [node id, input key]. */
export function consumersOf(nodes: GraphNode[], id: string, key: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const nd of nodes) for (const [k, i] of Object.entries(nd.inputs)) if (i.connection?.nodeId === id && i.connection.outputKey === key) out.push([nd.id, k]);
  return out;
}

/** The context a move builds with, or null when it can't go on this socket. */
export function moveContext(nodes: GraphNode[], target: MoveTarget, args: Record<string, unknown> = {}): MoveContext | null {
  const self = nodes.find(nd => nd.id === target.nodeId);
  if (!self) return null;
  const socket = target.side === 'out' ? self.outputs[target.key] : self.inputs[target.key];
  if (!socket) return null;
  const shown = graphOutput(nodes)?.inputs.color?.connection;
  return { self, key: target.key, side: target.side, type: socket.type, nodes, args, hasPicture: !!shown };
}

export interface ApplyOptions {
  heightOf?: (nd: GraphNode) => number;
  /** On the top level an Output is added when the graph has none (inside a group there is none to add). */
  topLevel?: boolean;
}

export function applyMove(nodes: GraphNode[], target: MoveTarget, move: Move, args: Record<string, unknown>, nextId: () => string, opts: ApplyOptions = {}): AppliedMove | null {
  const heightOf = opts.heightOf ?? cardHeight;
  const topLevel = opts.topLevel ?? true;
  const ctx = moveContext(nodes, target, args);
  if (!ctx) return null;
  if (!move.sides.includes(target.side) && move.shape !== 'param') return null;
  if (move.when && !move.when(ctx)) return null;
  const { self } = ctx;

  // A starter recipe of the node does this already when the socket feeds nothing yet.
  if (move.recipe && target.side === 'out' && consumersOf(nodes, self.id, target.key).length === 0) {
    const recipe = recipesFor(self.type).find(r => r.id === move.recipe);
    if (recipe) {
      const r = applyRecipe(nodes, self.id, recipe, nextId, heightOf);
      if (r) return { nodes: r.nodes, added: r.added, resultNodeId: null, shown: r.shown, rewired: 0 };
    }
  }

  // What IN stands for.
  let inWire: Wire | null = null;
  const extra: GraphNode[] = [];
  if (target.side === 'out') inWire = [self.id, target.key];
  else {
    const c = self.inputs[target.key].connection;
    if (c) inWire = [c.nodeId, c.outputKey];
    else if (ctx.type === 'vec2') {
      extra.push(n('uv', UV_IN, 0, 0, { __comment: 'UV: the position of each pixel, (0, 0) in the middle.\nWhy: the space the suggestion works on (the input had nothing wired).' }));
      inWire = [UV_IN, 'uv'];
    } else if (move.shape !== 'param') return null;
  }

  const build = move.build(ctx);
  let built = [...extra, ...build.nodes];

  // Layout: built right of the node; in front of an input, mirrored to the left.
  if (target.side === 'in' && built.length) {
    const maxX = Math.max(...build.nodes.map(nd => nd.position.x), 0);
    built = built.map(nd => nd.id === UV_IN
      ? { ...nd, position: { x: -(maxX + 2 * COL), y: 0 } }
      : { ...nd, position: { x: nd.position.x - maxX - COL, y: nd.position.y } });
  }
  built = built.map(nd => ({ ...nd, position: { x: self.position.x + nd.position.x, y: self.position.y + nd.position.y } }));

  const { nodes: fresh, idOf } = freshIds(built, nextId);
  const shownConn = graphOutput(nodes)?.inputs.color?.connection;
  const resolve = (w: Wire): Wire => {
    if (w[0] === IN) return inWire && inWire[0] === UV_IN ? [idOf(UV_IN), 'uv'] : inWire!;
    if (w[0] === SELF) return [self.id, w[1]];
    if (w[0] === PICTURE) return shownConn ? [shownConn.nodeId, shownConn.outputKey] : inWire!;
    if (w[0] === OTHER) return [String(args.other), String(args.otherKey)];
    return w;
  };
  let added = fresh.map(nd => ({
    ...nd,
    inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => {
      if (!i.connection) return [k, i];
      const [nodeId, outputKey] = resolve([i.connection.nodeId, i.connection.outputKey]);
      return [k, { ...i, connection: { nodeId, outputKey } }];
    })),
  }));
  added = added.map(nd => (String(nd.params.__comment ?? '').trim() ? nd : { ...nd, params: { ...nd.params, __comment: `${labelOf(nd)}: added by the "${move.label}" suggestion.` } }));
  const addedIds = new Set(added.map(nd => nd.id));

  const result: Wire | null = build.result ? [idOf(build.result[0]), build.result[1]] : null;
  const resultNode = result ? added.find(nd => nd.id === result[0]) : undefined;
  const resultType = resultNode?.outputs[result![1]]?.type;

  // The node itself: settings and wires.
  let selfNext: GraphNode = self;
  if (build.selfParams || build.selfWires) {
    selfNext = { ...self, params: { ...self.params, ...(build.selfParams ?? {}) }, inputs: { ...self.inputs } };
    for (const [k, w] of Object.entries(build.selfWires ?? {})) {
      if (!selfNext.inputs[k]) continue;
      const [nodeId, outputKey] = [idOf(w[0]), w[1]];
      selfNext.inputs[k] = { ...selfNext.inputs[k], connection: { nodeId, outputKey } };
    }
  }

  let next = nodes.map(nd => (nd.id === self.id ? selfNext : nd));
  let rewired = 0;
  if (result && resultType && move.shape === 'transform') {
    if (target.side === 'out') {
      for (const [cid, ck] of consumersOf(nodes, self.id, target.key)) {
        if (addedIds.has(cid)) continue;
        next = next.map(nd => {
          if (nd.id !== cid || !typesCompatible(resultType, nd.inputs[ck].type)) return nd;
          rewired++;
          return { ...nd, inputs: { ...nd.inputs, [ck]: { ...nd.inputs[ck], connection: { nodeId: result[0], outputKey: result[1] } } } };
        });
      }
    } else {
      next = next.map(nd => (nd.id === self.id
        ? { ...nd, inputs: { ...nd.inputs, [target.key]: { ...nd.inputs[target.key], connection: { nodeId: result[0], outputKey: result[1] } } } }
        : nd));
      rewired = 1;
    }
  }

  // Showing the result.
  let shown = false;
  const show = move.shape === 'branch' ? (build.show ?? 'none') : (move.shape === 'transform' && rewired === 0 ? 'ifEmpty' : 'none');
  let output = graphOutput(next);
  let newOutput: string | null = null;
  if (!output && topLevel && result && show !== 'none') {
    const right = Math.max(self.position.x, ...added.map(nd => nd.position.x)) + 2 * COL;
    output = n('output', nextId(), right, self.position.y, { __comment: 'Output: what the canvas shows. Added by the suggestion, since the graph had none.' });
    next = [...next, output];
    newOutput = output.id;
  }
  const outputEmpty = !output?.inputs.color?.connection;
  if (result && resultType && output && output.inputs.color?.type === 'vec3' && show !== 'none' && !(show === 'ifEmpty' && !outputEmpty)) {
    let wire: Wire = result;
    const at = { x: (resultNode?.position.x ?? self.position.x) + COL, y: resultNode?.position.y ?? self.position.y };
    if (resultType === 'float') {
      // A distance is painted; any other number shown as grey.
      const kind = socketKind(resultNode!.type, result[1], { type: 'float', label: resultNode!.outputs[result[1]].label }, 'out');
      const paint = kind === 'distance'
        ? n('sdfFill', nextId(), at.x, at.y, { antialias: 0.006, __comment: 'SDF Fill: paints the distance (inside filled, outside black).\nWhy: the Output showed nothing, so the suggestion shows its result.' }, { d: wire })
        : n('floatToVec3', nextId(), at.x, at.y, { __comment: 'Float → Color: the number as grey (0 black, 1 white).\nWhy: the Output showed nothing, so the suggestion shows its result.' }, { input: wire });
      added.push(paint);
      wire = [paint.id, Object.keys(paint.outputs)[0]];
    } else if (show === 'layer' && !outputEmpty && output.inputs.color.connection) {
      const c = output.inputs.color.connection;
      const over = n('addColor', nextId(), at.x, at.y, { __comment: `Add Colors: the picture with the ${move.label.toLowerCase()} added over it.\nWhy: the suggestion lays its light over what the Output showed.` },
        { a: [c.nodeId, c.outputKey], b: wire });
      added.push(over);
      wire = [over.id, 'result'];
    }
    if (typesCompatible(added.find(nd => nd.id === wire[0])?.outputs[wire[1]]?.type ?? 'vec3', 'vec3')) {
      const outId = output.id;
      next = next.map(nd => (nd.id === outId ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: wire[0], outputKey: wire[1] } } } } : nd));
      shown = true;
    }
  }

  added = placeNear(next, added, heightOf);
  next = [...next, ...added];

  // Hand over to a starter recipe of one of the added nodes (Trails → Fade's own setup).
  if (build.thenRecipe) {
    const id = idOf(build.thenRecipe.nodeId);
    const nd = next.find(x => x.id === id);
    const recipe = nd ? recipesFor(nd.type).find(r => r.id === build.thenRecipe!.recipeId) : undefined;
    if (recipe) {
      const r = applyRecipe(next, id, recipe, nextId, heightOf);
      if (r) return { nodes: r.nodes, added: [...added.map(x => x.id), ...r.added], resultNodeId: id, shown: r.shown, rewired };
    }
  }
  return { nodes: next, added: [...added.map(nd => nd.id), ...(newOutput ? [newOutput] : [])], resultNodeId: result?.[0] ?? null, shown, rewired };
}
