/**
 * rank.ts — which moves to offer for a node, best first (docs/suggestions.md).
 *
 *   score = kind fit (0…1) + 3 × usage (0…1) + 4 × output finding (0…1)
 *
 *  - Kind fit: the node's main output 1, its other outputs 0.6, its space inputs 0.8 (0.5 when the
 *    node is itself a space: a warp after a warp is less likely than one in front of a shape).
 *  - Usage: how strongly the move's node follows this one in the learned table (learning.ts:
 *    your graphs first, the examples as a fading prior), socket to socket, else node to node.
 *  - Output: a confident finding from the node's preview (outputRules.ts) puts its fix first.
 *
 * Each move comes with a one-line why: the finding ("clips 6%"), your habit ("you often add Rings
 * after Circle SDF"), the examples ("common after Circle SDF in the examples"), or the kind.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { outputKinds, spaceInputs, type ValueKind } from './kinds';
import { MOVES, moveById, labelOf, movesFor, quickAddMoves, type Move } from './moves';

const MOVE_ORDER = new Map(MOVES.map((m, i) => [m.id, i]));
import { moveContext } from './applyMove';
import { normaliseEnd, strength, WILDCARD_TYPES, type CoTable } from './usage';
import { outputSuggestions, type OutputMeasurement } from './outputRules';

export interface RankedMove {
  move: Move;
  key: string;
  side: 'in' | 'out';
  kind: ValueKind;
  score: number;
  why: string;
  /** Where the why comes from. */
  reason: 'output' | 'you' | 'examples' | 'kind';
  /** Values the move is applied with (output rules fill some). */
  args?: Record<string, unknown>;
}

export interface RankTables {
  /** Everything: yours and the prior. */
  table: CoTable;
  /** Yours only (for "you often…"). */
  personal: CoTable;
  /** The examples only. */
  prior: CoTable;
}

const typeLabel = (t: string) => getNodeDefinition(t)?.label ?? t;

/** How strongly the move's node follows (or leads into) this socket: 0…1, with its source. */
export function usageOf(node: GraphNode, key: string, side: 'in' | 'out', move: Move, t: RankTables): { u: number; you: number; ex: number } {
  const a = move.anchor;
  if (!a || WILDCARD_TYPES.has(a.type) || WILDCARD_TYPES.has(node.type)) return { u: 0, you: 0, ex: 0 };
  const self = normaliseEnd(node.type, key, side);
  const [fromType, outKey, toType, inKey] = side === 'out' ? [self.type, self.key, a.type, a.key] : [a.type, a.out, self.type, self.key];
  const socket = strength(t.table.stat(fromType, outKey, toType, inKey));
  const typed = strength(t.table.typeStat(fromType, toType)) * 0.6;
  const you = t.personal.stat(fromType, outKey, toType, inKey).count || t.personal.typeStat(fromType, toType).count * 0.6;
  const ex = t.prior.stat(fromType, outKey, toType, inKey).count || t.prior.typeStat(fromType, toType).count * 0.6;
  return { u: Math.min(1, Math.max(socket, typed) * 2.5), you, ex };
}

function whyFor(node: GraphNode, side: 'in' | 'out', move: Move, use: { u: number; you: number; ex: number }): { why: string; reason: RankedMove['reason'] } {
  const self = labelOf(node);
  const other = move.anchor ? typeLabel(move.anchor.type) : move.label;
  if (use.u > 0.02 && use.you >= 2) {
    return { why: side === 'out' ? `you often add ${other} after ${self}` : `you often put ${other} before ${self}`, reason: 'you' };
  }
  if (use.u > 0.02 && use.ex >= 1) {
    return { why: side === 'out' ? `common after ${self} in the examples` : `common before ${self} in the examples`, reason: 'examples' };
  }
  return { why: move.why, reason: 'kind' };
}

export interface RankOptions {
  measurement?: OutputMeasurement | null;
  limit?: number;
  /** Include the quick-add rules as moves (default true). */
  quickAdds?: boolean;
}

/** The moves for a node in `scope`, ranked. */
export function rankMoves(node: GraphNode, scope: GraphNode[], t: RankTables, opts: RankOptions = {}): RankedMove[] {
  const limit = opts.limit ?? 5;
  const best = new Map<string, RankedMove>();
  const offer = (move: Move, key: string, side: 'in' | 'out', kind: ValueKind, fit: number, extra?: { output: number; why: string; args?: Record<string, unknown> }) => {
    const ctx = moveContext(scope, { nodeId: node.id, key, side }, extra?.args ?? {});
    if (!ctx || (move.when && !move.when(ctx))) return;
    if (side === 'in' && move.shape !== 'param' && !ctx.self.inputs[key]) return;
    const use = usageOf(node, key, side, move, t);
    const why = extra ? { why: extra.why, reason: 'output' as const } : whyFor(node, side, move, use);
    // The generic "custom code" move is always possible, so it only leads on your usage.
    const score = (move.id === 'code-here' ? fit * 0.4 : fit) + 3 * use.u + 4 * (extra?.output ?? 0);
    const prev = best.get(move.id);
    if (!prev || prev.score < score) best.set(move.id, { move, key, side, kind, score, ...why, ...(extra?.args ? { args: extra.args } : {}) });
  };

  const outs = outputKinds(node);
  outs.forEach((o, i) => {
    const fit = i === 0 ? 1 : 0.6;
    for (const m of movesFor(o.kind, 'out')) offer(m, o.key, 'out', o.kind, fit);
    if (opts.quickAdds !== false && i === 0) {
      // The generic adds rank under the dedicated moves unless your usage lifts them.
      for (const m of quickAddMoves(node, o.key, o.kind)) if (![...best.values()].some(b => b.move.anchor?.type === m.anchor?.type)) offer(m, o.key, 'out', o.kind, 0.4);
    }
  });
  const isSpace = outs[0]?.kind === 'space';
  for (const s of spaceInputs(node)) for (const m of movesFor('space', 'in')) offer(m, s.key, 'in', 'space', isSpace ? 0.5 : 0.8);

  for (const f of outputSuggestions(node, opts.measurement ?? null)) {
    const m = moveById(f.moveId);
    const kind = outs.find(o => o.key === f.key)?.kind ?? 'scalar';
    if (m) offer(m, f.key, 'out', kind, 0, { output: f.severity, why: f.why, args: f.args });
  }
  // Ties keep the library's order (each kind's moves are listed most useful first).
  const order = (m: Move) => { const i = MOVE_ORDER.get(m.id); return i === undefined ? 999 : i; };
  return [...best.values()].sort((a, b) => b.score - a.score || order(a.move) - order(b.move)).slice(0, limit);
}

/** Learned picks for a socket (quick add, search): node types that usually come next, with their key and strength. */
export function learnedNext(nodeType: string, key: string, dir: 'in' | 'out', t: RankTables, limit = 3): Array<{ type: string; key: string; strength: number; you: boolean }> {
  if (WILDCARD_TYPES.has(nodeType)) return [];
  const end = normaliseEnd(nodeType, key, dir);
  const list = dir === 'out'
    ? t.table.next(end.type, end.key, limit * 3).map(x => ({ type: x.toType, key: x.inKey, s: strength(x) }))
    : t.table.prev(end.type, end.key, limit * 3).map(x => ({ type: x.fromType, key: x.outKey, s: strength(x) }));
  return list
    .filter(x => x.s > 0.03 && getNodeDefinition(x.type) && !/^(output|vec4Output|passOutput)$/.test(x.type))
    .slice(0, limit)
    .map(x => ({
      type: x.type, key: x.key, strength: x.s,
      you: (dir === 'out' ? t.personal.stat(end.type, end.key, x.type, x.key) : t.personal.stat(x.type, x.key, end.type, end.key)).count >= 2,
    }));
}

/** How strongly node type `type` goes with `nodeType` (either way round), 0…1: for ordering lists. */
export function affinity(nodeType: string, type: string, t: RankTables): number {
  return Math.max(strength(t.table.typeStat(nodeType, type)), strength(t.table.typeStat(type, nodeType)));
}
