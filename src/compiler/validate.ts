import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate that the graph has exactly one output node, all node types are
 * registered, and all connections are type-compatible.
 *
 * `loopInternalIds` are excluded from the main-pass checks because they are
 * compiled inside loop bodies and are intentionally disconnected from the
 * outer graph's output path.
 */
export function validateGraph(
  nodes: GraphNode[],
  loopInternalIds = new Set<string>(),
): ValidationResult {
  const errors: string[] = [];
  const visibleNodes = nodes.filter(n => !loopInternalIds.has(n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Exactly one output node
  const outputNodes = visibleNodes.filter(n => n.type === 'output' || n.type === 'vec4Output');
  if (outputNodes.length === 0) errors.push('Graph must have an Output node');
  if (outputNodes.length > 1) errors.push('Graph can only have one Output node');

  // All types registered
  for (const node of visibleNodes) {
    if (!getNodeDefinition(node.type)) {
      errors.push(`Unknown node type: ${node.type}`);
    }
  }

  // Type-safe connections
  for (const node of visibleNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    for (const [inputKey, input] of Object.entries(node.inputs)) {
      if (!input.connection) continue;

      const sourceNode = nodeMap.get(input.connection.nodeId);
      if (!sourceNode) {
        errors.push(`Node ${node.id}: connected to non-existent node ${input.connection.nodeId}`);
        continue;
      }

      // customFn and loopStart/loopEnd have dynamic / inferred types — skip
      if (node.type === 'customFn') continue;
      if (node.type === 'loopStart' || node.type === 'loopEnd') continue;

      const sourceDef = getNodeDefinition(sourceNode.type);
      const sourceOutputType =
        sourceNode.outputs[input.connection.outputKey]?.type ??
        sourceDef?.outputs[input.connection.outputKey]?.type;

      if (!sourceOutputType) {
        errors.push(
          `Node ${node.id}: source "${sourceNode.id}" has no output "${input.connection.outputKey}"`,
        );
        continue;
      }

      const targetInput = def.inputs[inputKey];
      if (!targetInput) continue; // dynamic socket not in def — skip

      // Allow float → vec3 broadcast coercion
      const compatible =
        sourceOutputType === targetInput.type ||
        (sourceOutputType === 'float' && targetInput.type === 'vec3');

      if (!compatible) {
        errors.push(
          `Node ${node.id}: type mismatch on input "${inputKey}". ` +
          `Expected ${targetInput.type}, got ${sourceOutputType}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}
