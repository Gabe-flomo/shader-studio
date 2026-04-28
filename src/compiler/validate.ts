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
      // exprNode/expr/customFn store actual output type in params.outputType —
      // the socket always declares 'vec3' as a placeholder, so read the real type here.
      const sourceOutputType: string | undefined =
        (sourceNode.type === 'exprNode' || sourceNode.type === 'expr' || sourceNode.type === 'customFn')
          ? ((sourceNode.params?.outputType as string | undefined) ??
             sourceNode.outputs[input.connection.outputKey]?.type)
          : (sourceNode.outputs[input.connection.outputKey]?.type ??
             sourceDef?.outputs[input.connection.outputKey]?.type);

      if (!sourceOutputType) {
        errors.push(
          `Node ${node.id}: source "${sourceNode.id}" has no output "${input.connection.outputKey}"`,
        );
        continue;
      }

      // Prefer the live socket type on the node instance (may have been updated by
      // changeNodeVectorType or updateNodeSockets) over the static definition type.
      const liveInput = node.inputs[inputKey];
      const targetType = liveInput?.type ?? def.inputs[inputKey]?.type;
      if (!targetType) continue; // dynamic socket not in def — skip

      // Allow float → vec2/vec3 broadcast coercion (GLSL fract/mix/etc work on any numeric type)
      const compatible =
        sourceOutputType === targetType ||
        (sourceOutputType === 'float' && targetType === 'vec3') ||
        (sourceOutputType === 'float' && targetType === 'vec2');

      if (!compatible) {
        errors.push(
          `Node ${node.id} [source:${sourceNode.id}]: type mismatch on input "${inputKey}". ` +
          `Expected ${targetType}, got ${sourceOutputType}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}
