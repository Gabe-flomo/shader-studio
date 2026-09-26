import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';

/**
 * Cell — what a field socket is evaluating right now.
 *
 * A node wired into a field socket (Grid Pattern's Shape or Picture, the
 * Array node's Shape) is compiled as a function the consumer calls once per
 * cell or per copy. Inside that chain this node hands out the call's
 * arguments: the cell's id, the affect point's influence on it, the copy's
 * index, and the local position. Hash the Cell ID into a Circle SDF's radius
 * and every cell gets its own size on one wire.
 *
 * Anywhere else (not upstream of a field socket) it outputs zeros and the
 * canvas UV, so a graph still compiles while it is being wired.
 *
 * The assembler tells it which case it is in through `inputVars.__inField`.
 */
export const FieldCellNode: NodeDefinition = {
  type: 'fieldCell',
  label: 'Cell',
  category: 'Sources',
  description: 'Inside a shape wired into a field socket (Grid Pattern’s Shape or Picture, Array’s Shape): the cell or copy being drawn. Cell ID and Influence come from Grid Pattern, Index from Array. Hash the Cell ID into a radius or colour for per-cell variation on one wire. Outside such a chain it outputs zeros.',
  inputs: {},
  outputs: {
    cellID:    { type: 'vec2',  label: 'Cell ID', hint: 'Grid Pattern: the cell’s column and row. Array: the copy’s column and row (grid) or index (line, ring). Hash it for per-cell variation.' },
    influence: { type: 'float', label: 'Influence', hint: 'Grid Pattern: how much the affect point reaches this cell, 0–1. Array: 0.' },
    index:     { type: 'float', label: 'Index', hint: 'Array: which copy, 0 … count − 1. Grid Pattern: 0.' },
    local:     { type: 'vec2',  label: 'Local', hint: 'The position the shape is being evaluated at (the same thing a UV node gives inside the chain).' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const inField = inputVars.__inField === '1';
    const lines = inField
      ? [
          `    vec2  ${id}_cell  = fieldCell;`,
          `    float ${id}_inf   = fieldInfluence;`,
          `    float ${id}_idx   = fieldIndex;`,
          `    vec2  ${id}_local = g_uv;`,
        ]
      : [
          `    vec2  ${id}_cell  = vec2(0.0);`,
          `    float ${id}_inf   = 0.0;`,
          `    float ${id}_idx   = 0.0;`,
          `    vec2  ${id}_local = g_uv;`,
        ];
    return {
      code: lines.join('\n') + '\n',
      outputVars: { cellID: `${id}_cell`, influence: `${id}_inf`, index: `${id}_idx`, local: `${id}_local` },
    };
  },
};
