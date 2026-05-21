import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateGraph(nodes: GraphNode[]): ValidationResult {
  const errors: string[] = [];
  const visibleNodes = nodes;
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

      // customFn has dynamic / inferred types — skip
      if (node.type === 'customFn') continue;

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

      // Match assembler coercions: float broadcasts to any vector; vec2↔vec3 pad/truncate
      const compatible =
        sourceOutputType === targetType ||
        (sourceOutputType === 'float' && (targetType === 'vec2' || targetType === 'vec3' || targetType === 'vec4')) ||
        (sourceOutputType === 'vec2'  && targetType === 'vec3') ||
        (sourceOutputType === 'vec3'  && targetType === 'vec2');

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
