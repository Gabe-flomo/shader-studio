/**
 * nodeCategory.ts — the category a placed node is coloured and counted by.
 *
 * Its definition's, except a Transform's, which follows its Dimension (docs/transform-node.md):
 * 2D Space, 3D Transforms or 4D, so a 3D Transform reads as a 3D node in the outline, the graph
 * stats and on its card's dimension chip.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinitionFor } from './definitions';
import { transformDefFor, transformDim } from './definitions/transformAny';

export function nodeCategory(node: Pick<GraphNode, 'type' | 'params'>): string | undefined {
  if (node.type === 'transform') return transformDefFor(transformDim(node)).category;
  return getNodeDefinitionFor(node as GraphNode)?.category;
}
