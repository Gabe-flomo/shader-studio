import type { GraphNode, NodeGraph, DataType } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export interface CompilationResult {
  vertexShader: string;
  fragmentShader: string;
  success: boolean;
  errors?: string[];
  /**
   * Maps nodeId → { outputKey → glslVarName } for every node that was compiled.
   * Used by ShaderCanvas to probe runtime values via 1-pixel render targets.
   */
  nodeOutputVars: Map<string, Record<string, string>>;
}

/** Returns the set of node IDs that are referenced as loop steps (modal Loop node) —
 *  compiled inline inside the loop body and skipped in the main pass. */
function collectLoopInternalIds(nodes: GraphNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'loop') {
      const steps = (node.params.steps as string[]) ?? [];
      for (const id of steps) ids.add(id);
    }
  }
  return ids;
}

/**
 * For the wired Loop Start/End pair system:
 * Walk backwards from each loopEnd's carry input, following the connection chain
 * until we hit a loopStart.  All intermediate nodes are "loop-pair-internal" —
 * they are compiled inline inside the unroll and skipped in the main pass.
 *
 * Returns a Map from loopEnd node ID → ordered array of body node IDs
 * (from loopStart output → loopEnd input order).
 */
function collectLoopPairChains(
  nodes: GraphNode[],
): Map<string, string[]> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const chains = new Map<string, string[]>();

  const loopEnds = nodes.filter(n => n.type === 'loopEnd');
  for (const endNode of loopEnds) {
    const bodyIds: string[] = [];
    // Walk backwards from loopEnd's carry input
    let currentInput = endNode.inputs['carry']?.connection;
    while (currentInput) {
      const srcNode = nodeMap.get(currentInput.nodeId);
      if (!srcNode) break;
      if (srcNode.type === 'loopStart') break; // reached the start — stop
      bodyIds.unshift(srcNode.id); // prepend so order = start→end
      // Continue backwards: follow the first carry-type input of this body node
      // that doesn't have a loopStart as its source
      const nextConn = Object.values(srcNode.inputs).find(i => i.connection)?.connection;
      currentInput = nextConn ?? undefined;
    }
    chains.set(endNode.id, bodyIds);
  }
  return chains;
}

/** Returns set of all body node IDs across all loop-pair chains (excluded from main pass). */
function collectLoopPairInternalIds(chains: Map<string, string[]>): Set<string> {
  const ids = new Set<string>();
  for (const bodyIds of chains.values()) {
    for (const id of bodyIds) ids.add(id);
  }
  return ids;
}

export function compileGraph(graph: NodeGraph): CompilationResult {
  const emptyNodeOutputVars = new Map<string, Record<string, string>>();
  try {
    const { nodes } = graph;

    // Collect node IDs used as modal loop steps — excluded from main pass
    const loopInternalIds = collectLoopInternalIds(nodes);

    // Collect wired loop-pair body nodes — also excluded from main pass
    const loopPairChains   = collectLoopPairChains(nodes);
    const loopPairInternal = collectLoopPairInternalIds(loopPairChains);

    // Merge both exclusion sets
    const allInternalIds = new Set<string>([...loopInternalIds, ...loopPairInternal]);

    // 1. Validate graph (excluding all loop-internal nodes)
    const validation = validateGraph(nodes, allInternalIds);
    if (!validation.valid) {
      return {
        vertexShader: '',
        fragmentShader: '',
        success: false,
        errors: validation.errors,
        nodeOutputVars: emptyNodeOutputVars,
      };
    }

    // 2. Topological sort (execution order), excluding all loop-internal nodes
    const sortedNodes = topologicalSort(nodes, allInternalIds);

    // 3. Generate GLSL code + capture nodeOutputVars
    const { fragmentShader, nodeOutputVars } = generateFragmentShader(sortedNodes, nodes, allInternalIds, loopPairChains);
    const vertexShader = VERTEX_SHADER;

    return {
      vertexShader,
      fragmentShader,
      success: true,
      nodeOutputVars,
    };
  } catch (error) {
    return {
      vertexShader: '',
      fragmentShader: '',
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      nodeOutputVars: emptyNodeOutputVars,
    };
  }
}

function validateGraph(nodes: GraphNode[], loopInternalIds = new Set<string>()): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  // Exclude loop-internal nodes from main-pass validation
  const visibleNodes = nodes.filter(n => !loopInternalIds.has(n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n])); // keep full map for connection lookups

  // Must have exactly one output node (either vec3 'output' or vec4 'vec4Output')
  const outputNodes = visibleNodes.filter(n => n.type === 'output' || n.type === 'vec4Output');
  if (outputNodes.length === 0) {
    errors.push('Graph must have an Output node');
  }
  if (outputNodes.length > 1) {
    errors.push('Graph can only have one Output node');
  }

  // All nodes must be valid types
  for (const node of visibleNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) {
      errors.push(`Unknown node type: ${node.type}`);
    }
  }

  // All connections must be valid (type-safe)
  for (const node of visibleNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    for (const [inputKey, input] of Object.entries(node.inputs)) {
      if (input.connection) {
        const sourceNode = nodeMap.get(input.connection!.nodeId);
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
        // Skip type validation for loopStart/loopEnd — carry type is inferred from wire
        if (node.type === 'loopStart' || node.type === 'loopEnd') continue;

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

function topologicalSort(nodes: GraphNode[], loopInternalIds = new Set<string>()): GraphNode[] {
  // Exclude loop-internal nodes — they are compiled inside the loop body, not in the main pass
  const visibleNodes = nodes.filter(n => !loopInternalIds.has(n.id));
  // Build dependency graph
  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize
  for (const node of visibleNodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build edges (dependencies)
  for (const node of visibleNodes) {
    for (const input of Object.values(node.inputs)) {
      if (input.connection) {
        const sourceId = input.connection.nodeId;
        // Only track edges where both ends are in the visible (non-loop-internal) set
        if (nodeMap.has(sourceId)) {
          adjacencyList.get(sourceId)?.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
        }
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
    const node = nodeMap.get(nodeId)!;
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

  if (sorted.length !== visibleNodes.length) {
    throw new Error('Circular dependency detected in node graph');
  }

  return sorted;
}

/** Default GLSL literal for a given type */
function defaultGlslVal(type: DataType | string): string {
  if (type === 'float') return '0.0';
  if (type === 'vec2')  return 'vec2(0.0)';
  if (type === 'vec3')  return 'vec3(0.0)';
  if (type === 'vec4')  return 'vec4(0.0)';
  return '0.0';
}

function generateFragmentShader(
  sortedNodes: GraphNode[],
  allNodes: GraphNode[],
  _loopInternalIds: Set<string>,
  loopPairChains: Map<string, string[]> = new Map(),
): { fragmentShader: string; nodeOutputVars: Map<string, Record<string, string>> } {
  const nodeMap = new Map(sortedNodes.map(n => [n.id, n]));
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));
  const functions = new Set<string>();
  const mainCode: string[] = [];

  // Track output variables from each node (returned alongside the shader)
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
        const sourceNode = nodeMap.get(input.connection!.nodeId);
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
      } else if (node.type === 'customFn' && typeof node.params[inputKey] === 'number') {
        // CustomFn slider input — value lives in node.params, not socket.defaultValue
        const cfInputs = (node.params.inputs as Array<{ name: string; slider?: unknown }>) ?? [];
        const cfInp = cfInputs.find(c => c.name === inputKey);
        if (cfInp?.slider != null) {
          const v = node.params[inputKey] as number;
          inputVars[inputKey] = Number.isInteger(v) ? `${v}.0` : `${v}`;
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

    // ── Loop node: inline-unroll step nodes N times ───────────────────────────
    if (node.type === 'loop') {
      const steps       = (node.params.steps as string[]) ?? [];
      const carryType   = ((node.params.carryType as DataType) ?? 'vec2') as DataType;
      const iters       = Math.max(1, Math.min(16, Math.round(
        typeof node.params.iterations === 'number' ? node.params.iterations : 4
      )));
      const carryVar    = inputVars['carry'] ?? defaultGlslVal(carryType);
      const id          = node.id;

      // Collect glslFunctions from step nodes up-front
      for (const stepId of steps) {
        const stepNode = allNodeMap.get(stepId);
        if (!stepNode) continue;
        const stepDef = getNodeDefinition(stepNode.type);
        if (stepDef?.glslFunction) functions.add(stepDef.glslFunction);
        if (stepNode.type === 'customFn' && typeof stepNode.params.glslFunctions === 'string') {
          const h = (stepNode.params.glslFunctions as string).trim();
          if (h) functions.add(h);
        }
      }

      let loopCode = `    ${carryType} ${id}_val = ${carryVar};\n`;

      for (let n = 0; n < iters; n++) {
        let iterCarry = `${id}_val`;
        for (const stepId of steps) {
          const stepNode = allNodeMap.get(stepId);
          if (!stepNode) continue;
          const stepDef = getNodeDefinition(stepNode.type);
          if (!stepDef) continue;

          // Resolve step's inputVars:
          // - carry-type sockets without a connection → inject current iterCarry
          // - sockets with a connection → resolve from nodeOutputs (external, already compiled)
          // - sockets with defaultValue → use that
          const stepInputVars: Record<string, string> = {};
          for (const [k, sock] of Object.entries(stepNode.inputs)) {
            if (sock.type === carryType && !sock.connection) {
              stepInputVars[k] = iterCarry;
            } else if (sock.connection) {
              const src = nodeOutputs.get(sock.connection.nodeId);
              stepInputVars[k] = src?.[sock.connection.outputKey] ?? defaultGlslVal(sock.type);
            } else if (stepNode.type === 'customFn' && typeof stepNode.params[k] === 'number') {
              const cfInputs = (stepNode.params.inputs as Array<{ name: string; slider?: unknown }>) ?? [];
              const cfInp = cfInputs.find(c => c.name === k);
              if (cfInp?.slider != null) {
                const v = stepNode.params[k] as number;
                stepInputVars[k] = Number.isInteger(v) ? `${v}.0` : `${v}`;
              }
            } else if (sock.defaultValue !== undefined) {
              if (typeof sock.defaultValue === 'number') {
                const sv = sock.defaultValue;
                stepInputVars[k] = Number.isInteger(sv) ? `${sv}.0` : `${sv}`;
              } else if (Array.isArray(sock.defaultValue)) {
                const vals = sock.defaultValue.map((v: number) => v.toFixed(1)).join(', ');
                stepInputVars[k] = `${sock.type}(${vals})`;
              }
            }
          }

          // Generate step GLSL, then rename all its vars with a per-iteration suffix
          // to avoid collisions across unrolled iterations
          const stepResult = stepDef.generateGLSL(stepNode, stepInputVars);
          const prefixed   = stepResult.code.replace(
            new RegExp(`\\b${stepId}_`, 'g'),
            `${stepId}_L${n}_`,
          );
          loopCode += prefixed;

          // The first output key becomes the new carry for the next step
          const firstOutKey = Object.keys(stepResult.outputVars)[0];
          if (firstOutKey) {
            iterCarry = `${stepId}_L${n}_${firstOutKey}`;
          }
        }
        loopCode += `    ${id}_val = ${iterCarry};\n`;
      }

      mainCode.push(loopCode);
      nodeOutputs.set(node.id, { result: `${id}_val` });
      continue;
    }

    // ── Loop Start: pass-through (outputs current carry var for downstream) ──
    if (node.type === 'loopStart') {
      // Emit the carry as-is — body nodes will inject their own carry from nodeOutputs
      const carryVar = inputVars['carry'] ?? defaultGlslVal(
        (Object.values(node.outputs)[0]?.type as DataType) ?? 'vec2'
      );
      const outType = (Object.values(node.outputs)[0]?.type as DataType) ?? 'vec2';
      const varName = `${node.id}_carry`;
      mainCode.push(`    ${outType} ${varName} = ${carryVar};\n`);
      nodeOutputs.set(node.id, { carry: varName });
      continue;
    }

    // ── Loop End: unroll the body chain N times ───────────────────────────────
    if (node.type === 'loopEnd') {
      const bodyIds = loopPairChains.get(node.id) ?? [];
      const iters   = Math.max(1, Math.min(16, Math.round(
        typeof node.params.iterations === 'number' ? node.params.iterations : 4
      )));
      const id = node.id;

      // Determine carry type from the inbound wire (loopEnd's carry input)
      const carryConn = node.inputs['carry']?.connection;
      let carryType: DataType = 'vec2';
      if (carryConn) {
        const srcNode = allNodeMap.get(carryConn.nodeId);
        const srcType = srcNode?.outputs[carryConn.outputKey]?.type;
        if (srcType === 'float' || srcType === 'vec2' || srcType === 'vec3' || srcType === 'vec4') {
          carryType = srcType as DataType;
        }
      }

      // Initial carry value: whatever the loopStart (or last body node) resolved to
      const initialCarry = inputVars['carry'] ?? defaultGlslVal(carryType);

      // Collect glslFunctions from body nodes
      for (const bodyId of bodyIds) {
        const bodyNode = allNodeMap.get(bodyId);
        if (!bodyNode) continue;
        const bodyDef = getNodeDefinition(bodyNode.type);
        if (bodyDef?.glslFunction) functions.add(bodyDef.glslFunction);
        if (bodyNode.type === 'customFn' && typeof bodyNode.params.glslFunctions === 'string') {
          const h = (bodyNode.params.glslFunctions as string).trim();
          if (h) functions.add(h);
        }
      }

      let loopCode = `    ${carryType} ${id}_val = ${initialCarry};\n`;

      for (let n = 0; n < iters; n++) {
        let iterCarry = `${id}_val`;
        for (const bodyId of bodyIds) {
          const bodyNode = allNodeMap.get(bodyId);
          if (!bodyNode) continue;
          const bodyDef = getNodeDefinition(bodyNode.type);
          if (!bodyDef) continue;

          // Resolve body node inputs:
          // - sockets of carryType with no external connection → inject iterCarry
          // - sockets with an external connection → resolve from nodeOutputs
          // - customFn slider params → from node.params
          // - defaultValue → use that
          const bodyInputVars: Record<string, string> = {};
          for (const [k, sock] of Object.entries(bodyNode.inputs)) {
            if (!sock.connection && (sock.type as string) === (carryType as string)) {
              bodyInputVars[k] = iterCarry;
            } else if (sock.connection) {
              // External connection (e.g. time, UV, params from outside the loop)
              const srcOutputs = nodeOutputs.get(sock.connection.nodeId);
              bodyInputVars[k] = srcOutputs?.[sock.connection.outputKey] ?? defaultGlslVal(sock.type);
            } else if (bodyNode.type === 'customFn' && typeof bodyNode.params[k] === 'number') {
              const cfInputs = (bodyNode.params.inputs as Array<{ name: string; slider?: unknown }>) ?? [];
              const cfInp = cfInputs.find(c => c.name === k);
              if (cfInp?.slider != null) {
                const v = bodyNode.params[k] as number;
                bodyInputVars[k] = Number.isInteger(v) ? `${v}.0` : `${v}`;
              }
            } else if (sock.defaultValue !== undefined) {
              if (typeof sock.defaultValue === 'number') {
                const sv = sock.defaultValue;
                bodyInputVars[k] = Number.isInteger(sv) ? `${sv}.0` : `${sv}`;
              } else if (Array.isArray(sock.defaultValue)) {
                const vals = sock.defaultValue.map((v: number) => v.toFixed(1)).join(', ');
                bodyInputVars[k] = `${sock.type}(${vals})`;
              }
            }
          }

          // Generate body GLSL, prefix all vars with iteration suffix to avoid collisions
          const bodyResult = bodyDef.generateGLSL(bodyNode, bodyInputVars);
          const prefixed   = bodyResult.code.replace(
            new RegExp(`\\b${bodyId}_`, 'g'),
            `${bodyId}_P${n}_`,
          );
          loopCode += prefixed;

          // First output of this body node becomes the next iterCarry
          const firstOutKey = Object.keys(bodyResult.outputVars)[0];
          if (firstOutKey) {
            iterCarry = `${bodyId}_P${n}_${firstOutKey}`;
          }
        }
        loopCode += `    ${id}_val = ${iterCarry};\n`;
      }

      mainCode.push(loopCode);
      nodeOutputs.set(node.id, { result: `${id}_val` });
      continue;
    }

    // ── Bypass: pass the primary input through to each output ────────────────
    if (node.bypassed) {
      // Find the first connected input variable (or any resolved inputVar)
      const inputEntries = Object.entries(inputVars);
      const bypassOutputVars: Record<string, string> = {};
      let bypassCode = '';
      if (inputEntries.length > 0) {
        // Use the first resolved input as the pass-through value
        const [, passthroughVar] = inputEntries[0];
        const outputEntries = Object.entries(def.outputs);
        for (const [outKey, outSocket] of outputEntries) {
          const varName = `${node.id}_${outKey}`;
          // Coerce type if needed: float→vecN, vec2→float, etc.
          const srcType = (() => {
            // Try to determine source type from variable name in already-emitted code
            // or fall back to the def's first input type
            const firstInputDef = Object.values(def.inputs)[0];
            return firstInputDef?.type ?? 'float';
          })();
          let coerced = passthroughVar;
          if (srcType !== outSocket.type) {
            // Simple coercions
            if (outSocket.type === 'float' && srcType === 'vec2') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'float' && srcType === 'vec3') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'float' && srcType === 'vec4') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'vec2' && srcType === 'float') coerced = `vec2(${passthroughVar})`;
            else if (outSocket.type === 'vec3' && srcType === 'float') coerced = `vec3(${passthroughVar})`;
            else if (outSocket.type === 'vec3' && srcType === 'vec2') coerced = `vec3(${passthroughVar}, 0.0)`;
            else if (outSocket.type === 'vec4' && srcType === 'float') coerced = `vec4(${passthroughVar})`;
            else if (outSocket.type === 'vec4' && srcType === 'vec3') coerced = `vec4(${passthroughVar}, 1.0)`;
            // Matching secondary inputs if available (e.g. vec3 in → vec2 out, try a vec2 input)
            const matchingInput = inputEntries.find(([, v]) => v !== passthroughVar);
            if (matchingInput) coerced = matchingInput[1];
          }
          bypassCode += `    ${outSocket.type} ${varName} = ${coerced};\n`;
          bypassOutputVars[outKey] = varName;
        }
        // If no outputs defined just re-use the normal path outputs
        if (outputEntries.length === 0) {
          const result = def.generateGLSL(node, inputVars);
          bypassCode = result.code;
          Object.assign(bypassOutputVars, result.outputVars);
        }
      } else {
        // No connected inputs — fall back to normal generation so we get valid vars
        const result = def.generateGLSL(node, inputVars);
        bypassCode = result.code;
        Object.assign(bypassOutputVars, result.outputVars);
      }
      mainCode.push(bypassCode);
      nodeOutputs.set(node.id, bypassOutputVars);
      continue;
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

  const fragmentShader = `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

varying vec2 vUv;
${functionCode}

void main() {
${mainCode.join('')}}`.trim();

  return { fragmentShader, nodeOutputVars: nodeOutputs };
}

const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();


// Hello claude my algorthm friend, can you look throught all the files in this project to gain a deep understanding of it then help me write some learn docs that acts as a mini crash course to learn the program, Ill send you even more context