import type { GraphNode, NodeGraph } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export interface CompilationResult {
  vertexShader: string;
  fragmentShader: string;
  success: boolean;
  errors?: string[];
}

export function compileGraph(graph: NodeGraph): CompilationResult {
  try {
    const { nodes } = graph;

    // 1. Validate graph
    const validation = validateGraph(nodes);
    if (!validation.valid) {
      return {
        vertexShader: '',
        fragmentShader: '',
        success: false,
        errors: validation.errors,
      };
    }

    // 2. Topological sort (execution order)
    const sortedNodes = topologicalSort(nodes);

    // 3. Generate GLSL code
    const fragmentShader = generateFragmentShader(sortedNodes);
    const vertexShader = VERTEX_SHADER;

    return {
      vertexShader,
      fragmentShader,
      success: true,
    };
  } catch (error) {
    return {
      vertexShader: '',
      fragmentShader: '',
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

function validateGraph(nodes: GraphNode[]): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  // Must have exactly one output node (either vec3 'output' or vec4 'vec4Output')
  const outputNodes = nodes.filter(n => n.type === 'output' || n.type === 'vec4Output');
  if (outputNodes.length === 0) {
    errors.push('Graph must have an Output node');
  }
  if (outputNodes.length > 1) {
    errors.push('Graph can only have one Output node');
  }

  // All nodes must be valid types
  for (const node of nodes) {
    const def = getNodeDefinition(node.type);
    if (!def) {
      errors.push(`Unknown node type: ${node.type}`);
    }
  }

  // All connections must be valid (type-safe)
  for (const node of nodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    for (const [inputKey, input] of Object.entries(node.inputs)) {
      if (input.connection) {
        const sourceNode = nodes.find(n => n.id === input.connection!.nodeId);
        if (!sourceNode) {
          errors.push(`Node ${node.id}: Connected to non-existent node ${input.connection.nodeId}`);
          continue;
        }

        const sourceDef = getNodeDefinition(sourceNode.type);
        if (!sourceDef) continue;

        // Use the node instance's output type (reflects runtime params like Expr outputType)
        // falling back to the def's static output type
        const sourceOutputInstanceType = sourceNode.outputs[input.connection.outputKey]?.type;
        const sourceOutput = {
          ...(sourceDef.outputs[input.connection.outputKey] ?? {}),
          type: sourceOutputInstanceType ?? sourceDef.outputs[input.connection.outputKey]?.type,
        };

        if (!sourceOutput.type) {
          errors.push(`Node ${node.id}: Source node "${sourceNode.id}" has no output "${input.connection.outputKey}"`);
          continue;
        }

        // Skip type validation for customFn nodes — their sockets are dynamic
        if (node.type === 'customFn') continue;

        const targetInput = def.inputs[inputKey];
        if (!targetInput) continue; // dynamic socket not in def, skip

        // Allow float → vec3 coercion (float is broadcast to all channels)
        const typesCompatible =
          sourceOutput.type === targetInput.type ||
          (sourceOutput.type === 'float' && targetInput.type === 'vec3');

        if (!typesCompatible) {
          errors.push(
            `Node ${node.id}: Type mismatch on input "${inputKey}". ` +
            `Expected ${targetInput.type}, got ${sourceOutput.type}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function topologicalSort(nodes: GraphNode[]): GraphNode[] {
  // Build dependency graph
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build edges (dependencies)
  for (const node of nodes) {
    for (const input of Object.values(node.inputs)) {
      if (input.connection) {
        const sourceId = input.connection.nodeId;
        adjacencyList.get(sourceId)?.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const sorted: GraphNode[] = [];

  // Start with nodes that have no dependencies
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodes.find(n => n.id === nodeId)!;
    sorted.push(node);

    // Reduce in-degree for dependent nodes
    for (const dependentId of adjacencyList.get(nodeId) || []) {
      const newDegree = (inDegree.get(dependentId) || 0) - 1;
      inDegree.set(dependentId, newDegree);
      if (newDegree === 0) {
        queue.push(dependentId);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Circular dependency detected in node graph');
  }

  return sorted;
}

function generateFragmentShader(sortedNodes: GraphNode[]): string {
  const functions = new Set<string>();
  const mainCode: string[] = [];

  // Track output variables from each node
  const nodeOutputs = new Map<string, Record<string, string>>();

  for (const node of sortedNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    // Collect GLSL functions (deduplicated)
    if (def.glslFunction) {
      functions.add(def.glslFunction);
    }
    // CustomFn nodes can also inject helper functions
    if (node.type === 'customFn' && typeof node.params.glslFunctions === 'string') {
      const helperFns = (node.params.glslFunctions as string).trim();
      if (helperFns) functions.add(helperFns);
    }

    // Resolve input variables
    const inputVars: Record<string, string> = {};
    for (const [inputKey, input] of Object.entries(node.inputs)) {
      if (input.connection) {
        const sourceNode = sortedNodes.find(n => n.id === input.connection!.nodeId);
        const sourceDef = sourceNode ? getNodeDefinition(sourceNode.type) : undefined;
        // Use instance output type first (reflects dynamic params like Expr outputType), then def type
        const sourceOutputType =
          sourceNode?.outputs[input.connection.outputKey]?.type ??
          sourceDef?.outputs[input.connection.outputKey]?.type;
        const sourceOutputs = nodeOutputs.get(input.connection.nodeId);
        if (sourceOutputs) {
          const rawVar = sourceOutputs[input.connection.outputKey];
          // Auto-coerce float → vec3 if target socket expects vec3
          if (sourceOutputType === 'float' && input.type === 'vec3') {
            inputVars[inputKey] = `vec3(${rawVar})`;
          } else {
            inputVars[inputKey] = rawVar;
          }
        }
      } else if (input.defaultValue !== undefined) {
        if (typeof input.defaultValue === 'number') {
          const n = input.defaultValue;
          inputVars[inputKey] = Number.isInteger(n) ? `${n}.0` : `${n}`;
        } else if (Array.isArray(input.defaultValue)) {
          const type = input.type;
          const values = input.defaultValue.map((v: number) => v.toFixed(1)).join(', ');
          inputVars[inputKey] = `${type}(${values})`;
        }
      }
    }

    // If node has a __codeOverride, use it verbatim (derive outputVars from normal generateGLSL)
    const override = typeof node.params.__codeOverride === 'string' ? (node.params.__codeOverride as string).trim() : null;
    if (override) {
      const placeholderResult = def.generateGLSL(node, inputVars);
      mainCode.push(override + '\n');
      nodeOutputs.set(node.id, placeholderResult.outputVars);
    } else {
      // Generate code for this node
      const result = def.generateGLSL(node, inputVars);
      mainCode.push(result.code);
      nodeOutputs.set(node.id, result.outputVars);
    }
  }

  const functionCode = Array.from(functions).join('\n');

  return `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

varying vec2 vUv;
${functionCode}

void main() {
${mainCode.join('')}}`.trim();
}

const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();


// Hello claude my algorthm friend, can you look throught all the files in this project to gain a deep understanding of it then help me write some learn docs that acts as a mini crash course to learn the program, Ill send you even more context