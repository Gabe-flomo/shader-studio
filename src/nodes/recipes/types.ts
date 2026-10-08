/**
 * types.ts — the shape of a starter recipe (docs/starter-recipes.md).
 *
 * A recipe is a small, readable setup round a node that was just added: a few helper nodes,
 * wired, with plain-language notes, and (usually) the result on the Output. Recipes are pure:
 * they return nodes with temporary ids, positioned relative to the new node's top-left corner
 * (the new node is at 0, 0; a column is 420 wide). `applyRecipe` (apply.ts) gives them fresh
 * ids, places them in free space and wires them in.
 */
import type { GraphNode } from '../../types/nodeGraph';

/** A wire source: [node id, output key]. `SELF` names the node the recipe is for. */
export type Wire = [nodeId: string, outputKey: string];

/** Stands for the new node in a recipe's wires (its real id is filled in when applied). */
export const SELF = '$self';

export interface RecipeContext {
  /** The node just added, as it is in the graph now (wires made after the add included). */
  self: GraphNode;
  /** The graph level it is in (the top level). */
  nodes: GraphNode[];
  /** What the Output shows now (its Color wire), when it isn't the new node itself; null when nothing. */
  shown: Wire | null;
}

export interface RecipeBuild {
  /** The helper nodes (temporary ids, positions relative to the new node). Every one carries a `__comment`. */
  nodes: GraphNode[];
  /** Wires into the new node's inputs. An input that is already wired keeps its wire. */
  wire?: Record<string, Wire>;
  /** Params set on the new node (a `__comment` here only lands when the node has none yet). */
  params?: Record<string, unknown>;
  /** What goes on the Output (one is added when the graph has none). */
  show?: Wire;
  /** Ids of nodes already in the graph to take out first (a rig being replaced); wires into them are cut. */
  remove?: string[];
}

export interface StarterRecipe {
  id: string;
  /** Button text: the goal, in a few words ("Shapes don't clip"). */
  label: string;
  /** One sentence under it: what gets added and why. */
  description: string;
  build: (ctx: RecipeContext) => RecipeBuild;
}
