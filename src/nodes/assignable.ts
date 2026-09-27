/**
 * Which cards offer the assign operator (= += -= *= /=) in their header.
 *
 * The operator accumulates one value across a loop's iterations (a glow
 * summed per step, a colour added per fold; see docs/iterated-groups.md). It
 * makes sense on a card that makes one value from its inputs: math, colour,
 * shapes, lights. It doesn't on
 *  - code cards (Expression Block, Custom Function, Float Warp): the
 *    expression says what it means, `+=` included;
 *  - cards with several outputs (Grid, Grid Pattern, Mandelbrot…): only one
 *    output would accumulate;
 *  - sources, outputs, groups, loop plumbing and scene containers.
 *
 * A definition can say so itself with `assignable` (Light has three outputs
 * but its glow is the classic `+=` accumulator; Volume Glow sits with the 3D
 * scene nodes but is one). A graph saved with an operator on a card that
 * doesn't offer one keeps it and compiles as before; the card shows it as a
 * badge that resets to `=`.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';
import { getNodeDefinitionFor } from './definitions';

/** Categories whose cards never offer the operator. */
const NOT_ASSIGNABLE_CATEGORIES = new Set(['Sources', 'Output', 'Utility', 'Functions', 'Loops', '3D Scene', 'Grid']);
/** Structural types, whatever their category. */
const NOT_ASSIGNABLE_TYPES = new Set(['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group']);

export function isAssignableDef(def: NodeDefinition | undefined): boolean {
  if (!def || NOT_ASSIGNABLE_TYPES.has(def.type)) return false;
  if (def.assignable !== undefined) return def.assignable;
  if (NOT_ASSIGNABLE_CATEGORIES.has(def.category)) return false;
  return Object.keys(def.outputs).length === 1;
}

/** Does this card offer the assign operator menu? */
export function isAssignable(node: GraphNode): boolean {
  if (NOT_ASSIGNABLE_TYPES.has(node.type)) return false;
  return isAssignableDef(getNodeDefinitionFor(node));
}

/** An operator the card no longer offers but the graph still uses (shown as a badge that resets to `=`). */
export function legacyAssignOp(node: GraphNode): GraphNode['assignOp'] | null {
  const op = node.assignOp;
  return op && op !== '=' && !isAssignable(node) && !NOT_ASSIGNABLE_TYPES.has(node.type) ? op : null;
}
