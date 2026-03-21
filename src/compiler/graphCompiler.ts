import type { GraphNode, NodeGraph, DataType, SubgraphData } from '../types/nodeGraph';
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
  /**
   * Maps uniform name (e.g. "u_p_nodeId_scale") → current numeric value.
   * These are float params extracted from paramDefs as GPU uniforms so that
   * slider changes can update them without a full shader recompile.
   */
  paramUniforms: Record<string, number>;
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
        paramUniforms: {},
      };
    }

    // 2. Topological sort (execution order), excluding all loop-internal nodes
    const sortedNodes = topologicalSort(nodes, allInternalIds);

    // 3. Generate GLSL code + capture nodeOutputVars and paramUniforms
    const { fragmentShader, nodeOutputVars, paramUniforms } = generateFragmentShader(sortedNodes, nodes, allInternalIds, loopPairChains);
    const vertexShader = VERTEX_SHADER;

    return {
      vertexShader,
      fragmentShader,
      success: true,
      nodeOutputVars,
      paramUniforms,
    };
  } catch (error) {
    return {
      vertexShader: '',
      fragmentShader: '',
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      nodeOutputVars: emptyNodeOutputVars,
      paramUniforms: {},
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

// Nodes whose params must stay as baked compile-time constants (loop unroll counts, etc.)
const SKIP_UNIFORM_TYPES = new Set(['loopStart', 'loopEnd', 'loop', 'forLoop']);

/**
 * Patch a node's params so that eligible float paramDef entries become uniform
 * name strings (e.g. 'u_p_nodeId_scale').  The p() helper in node defs treats
 * strings as pre-resolved GLSL expressions and passes them through unchanged.
 *
 * Returns { patchedNode, uniforms } where uniforms maps name → current value.
 * Integer-step params and non-float paramDefs are left as baked constants.
 */
function patchNodeParamsForUniforms(
  node: GraphNode,
  def: import('../types/nodeGraph').NodeDefinition,
): { patchedNode: GraphNode; uniforms: Record<string, number> } {
  const uniforms: Record<string, number> = {};
  if (SKIP_UNIFORM_TYPES.has(node.type) || !def.paramDefs) {
    return { patchedNode: node, uniforms };
  }
  const patchedParams = { ...node.params };
  for (const [key, paramDef] of Object.entries(def.paramDefs)) {
    if (paramDef.type !== 'float') continue;           // only scalar floats
    if (paramDef.step === 1) continue;                  // integer param — keep baked
    const val = node.params[key];
    if (typeof val !== 'number') continue;
    const uniformName = `u_p_${node.id}_${key}`;
    patchedParams[key] = uniformName;                   // inject uniform name as string
    uniforms[uniformName] = val;
  }
  return { patchedNode: { ...node, params: patchedParams }, uniforms };
}

function generateFragmentShader(
  sortedNodes: GraphNode[],
  allNodes: GraphNode[],
  _loopInternalIds: Set<string>,
  loopPairChains: Map<string, string[]> = new Map(),
): { fragmentShader: string; nodeOutputVars: Map<string, Record<string, string>>; paramUniforms: Record<string, number> } {
  const nodeMap = new Map(sortedNodes.map(n => [n.id, n]));
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));
  const functions = new Set<string>();
  const mainCode: string[] = [];
  const paramUniforms: Record<string, number> = {};

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
      } else if (input.type === 'vec2' && (inputKey === 'uv' || inputKey === 'p' || inputKey === 'uv2')) {
        // Implicit UV: unconnected UV/position sockets receive the global aspect-corrected UV
        inputVars[inputKey] = 'g_uv';
      } else if (input.type === 'float' && (inputKey === 'time' || inputKey === 't')) {
        // Implicit time: unconnected time sockets receive u_time directly
        inputVars[inputKey] = 'u_time';
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
            } else if (sock.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) {
              stepInputVars[k] = 'g_uv';
            } else if (sock.type === 'float' && (k === 'time' || k === 't')) {
              stepInputVars[k] = 'u_time';
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
      // Determine actual carry type from the source connected to this loopStart's input
      let startType: DataType = 'vec2';
      const startConn = node.inputs['carry']?.connection;
      if (startConn) {
        const srcNode = nodeMap.get(startConn.nodeId);
        const srcType = srcNode?.outputs[startConn.outputKey]?.type;
        if (srcType === 'float' || srcType === 'vec2' || srcType === 'vec3' || srcType === 'vec4') {
          startType = srcType as DataType;
        }
      }
      const carryVar = inputVars['carry'] ?? defaultGlslVal(startType);
      const varName = `${node.id}_carry`;
      mainCode.push(`    ${startType} ${varName} = ${carryVar};\n`);
      nodeOutputs.set(node.id, { carry: varName });
      continue;
    }

    // ── Loop End: unroll the body chain N times ───────────────────────────────
    if (node.type === 'loopEnd') {
      const bodyIds = loopPairChains.get(node.id) ?? [];
      const id = node.id;
      // iters resolved after we find startNodeId below; placeholder here
      let iters = Math.max(1, Math.min(16, Math.round(
        typeof node.params.iterations === 'number' ? node.params.iterations : 4
      )));

      // Determine carry type from the inbound wire (loopEnd's carry input).
      // Walk backwards through the chain to find the loopStart node.
      const loopEndCarryConn = node.inputs['carry']?.connection;
      let carryType: DataType = 'vec2';
      let startNodeId: string | null = null;
      if (loopEndCarryConn) {
        let walkId: string | undefined = loopEndCarryConn.nodeId;
        while (walkId) {
          const wn = allNodeMap.get(walkId);
          if (!wn) break;
          if (wn.type === 'loopStart') {
            startNodeId = wn.id;
            // Carry type = the type of loopStart's carry input (what's wired into it)
            const stConn = wn.inputs['carry']?.connection;
            if (stConn) {
              const stSrc = allNodeMap.get(stConn.nodeId);
              const stType = stSrc?.outputs[stConn.outputKey]?.type;
              if (stType === 'float' || stType === 'vec2' || stType === 'vec3' || stType === 'vec4') {
                carryType = stType as DataType;
              }
            }
            break;
          }
          // Also check the direct source type from loopEnd's carry conn (last body node output)
          const srcNode = allNodeMap.get(walkId);
          if (srcNode) {
            const outType = srcNode.outputs[loopEndCarryConn.outputKey]?.type;
            if (outType === 'float' || outType === 'vec2' || outType === 'vec3' || outType === 'vec4') {
              carryType = outType as DataType;
            }
          }
          const wn2 = allNodeMap.get(walkId);
          const nextConn = wn2 ? Object.values(wn2.inputs).find(i => i.connection)?.connection : undefined;
          walkId = nextConn?.nodeId;
        }
      }

      // Prefer iterations from loopStart (new behaviour); fall back to loopEnd for old graphs
      if (startNodeId) {
        const startNode = allNodeMap.get(startNodeId);
        if (typeof startNode?.params.iterations === 'number') {
          iters = Math.max(1, Math.min(16, Math.round(startNode.params.iterations)));
        }
      }

      // Build set of all chain-internal node IDs (loopStart + body nodes)
      // Connections from these are carry-path connections, not external dependencies
      const chainNodeIds = new Set<string>(bodyIds);
      if (startNodeId) chainNodeIds.add(startNodeId);

      // Initial carry value: read from loopStart's compiled output in nodeOutputs
      let initialCarry = defaultGlslVal(carryType);
      if (startNodeId) {
        const startOutputs = nodeOutputs.get(startNodeId);
        if (startOutputs) {
          const firstKey = Object.keys(startOutputs)[0];
          if (firstKey) initialCarry = startOutputs[firstKey];
        }
      } else {
        // No loopStart found (loopEnd wired directly to something else)
        initialCarry = inputVars['carry'] ?? defaultGlslVal(carryType);
      }

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
          // - sockets connected to a chain node (loopStart or previous body) → inject iterCarry
          //   (these are the "carry path" connections, not external dependencies)
          // - sockets of carryType with no connection → also inject iterCarry
          // - sockets with an external connection (outside the chain) → resolve from nodeOutputs
          // - customFn slider params → from node.params
          // - defaultValue → use that
          const bodyInputVars: Record<string, string> = {};
          for (const [k, sock] of Object.entries(bodyNode.inputs)) {
            const isCarryConn = sock.connection && chainNodeIds.has(sock.connection.nodeId);
            if (isCarryConn || (!sock.connection && (sock.type as string) === (carryType as string))) {
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
            } else if (sock.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) {
              bodyInputVars[k] = 'g_uv';
            } else if (sock.type === 'float' && (k === 'time' || k === 't')) {
              bodyInputVars[k] = 'u_time';
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

    // ── Group: compile the subgraph inline ────────────────────────────────────
    if (node.type === 'group') {
      const subgraph = node.params.subgraph as SubgraphData | undefined;
      if (!subgraph || subgraph.nodes.length === 0) {
        nodeOutputs.set(node.id, {});
        continue;
      }

      const prefix = `${node.id}_g_`;

      // Map "originalSubNodeId:inputKey" → outer resolved GLSL variable (from inputPorts)
      const portInputOverrides = new Map<string, string>();
      for (const port of subgraph.inputPorts) {
        const outerVar = inputVars[port.key];
        if (outerVar) portInputOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
      }

      // Clone subgraph nodes with prefixed IDs, remapping internal connections
      const prefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => ({
        ...subNode,
        id: prefix + subNode.id,
        inputs: Object.fromEntries(
          Object.entries(subNode.inputs).map(([k, inp]) => [
            k,
            inp.connection
              ? { ...inp, connection: { nodeId: prefix + inp.connection.nodeId, outputKey: inp.connection.outputKey } }
              : inp,
          ])
        ),
      }));

      // Sort and compile subgraph nodes
      const sortedSub = topologicalSort(prefixedNodes);
      for (const subNode of sortedSub) {
        const subDef = getNodeDefinition(subNode.type);
        if (!subDef) continue;
        if (subDef.glslFunction) functions.add(subDef.glslFunction);

        // Resolve input vars for this subgraph node
        const subInputVars: Record<string, string> = {};
        const originalId = subNode.id.slice(prefix.length);
        for (const [k, inp] of Object.entries(subNode.inputs)) {
          const portKey = `${originalId}:${k}`;
          if (portInputOverrides.has(portKey)) {
            subInputVars[k] = portInputOverrides.get(portKey)!;
          } else if (inp.connection) {
            const srcOutputs = nodeOutputs.get(inp.connection.nodeId);
            if (srcOutputs?.[inp.connection.outputKey]) {
              subInputVars[k] = srcOutputs[inp.connection.outputKey];
            }
          }
          // Implicit UV / time fallbacks
          if (!subInputVars[k]) {
            if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) {
              subInputVars[k] = 'g_uv';
            } else if (inp.type === 'float' && (k === 'time' || k === 't')) {
              subInputVars[k] = 'u_time';
            } else if (inp.defaultValue !== undefined) {
              if (typeof inp.defaultValue === 'number') {
                subInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
              } else if (Array.isArray(inp.defaultValue)) {
                subInputVars[k] = `${inp.type}(${inp.defaultValue.map((v: number) => v.toFixed(1)).join(', ')})`;
              }
            }
          }
        }

        const { patchedNode: patchedSub, uniforms: subUniforms } = patchNodeParamsForUniforms(subNode, subDef);
        Object.assign(paramUniforms, subUniforms);

        const subResult = subDef.generateGLSL(patchedSub, subInputVars);
        mainCode.push(subResult.code);
        nodeOutputs.set(subNode.id, subResult.outputVars);
      }

      // Map group output ports to resolved subgraph vars
      const groupOutputVars: Record<string, string> = {};
      for (const port of subgraph.outputPorts) {
        const prefixedFromId = prefix + port.fromNodeId;
        const fromOutputs = nodeOutputs.get(prefixedFromId);
        if (fromOutputs?.[port.fromOutputKey]) {
          groupOutputVars[port.key] = fromOutputs[port.fromOutputKey];
        }
      }
      nodeOutputs.set(node.id, groupOutputVars);
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

    // Patch eligible float params to uniform names and collect them
    const { patchedNode, uniforms: nodeUniforms } = patchNodeParamsForUniforms(node, def);
    Object.assign(paramUniforms, nodeUniforms);

    // If node has a __codeOverride, use it verbatim (derive outputVars from normal generateGLSL)
    const override = typeof node.params.__codeOverride === 'string' ? (node.params.__codeOverride as string).trim() : null;
    if (override) {
      const placeholderResult = def.generateGLSL(patchedNode, inputVars);
      mainCode.push(override + '\n');
      nodeOutputs.set(node.id, placeholderResult.outputVars);
    } else {
      // Generate code for this node
      const result = def.generateGLSL(patchedNode, inputVars);
      mainCode.push(result.code);
      nodeOutputs.set(node.id, result.outputVars);
    }
  }

  const functionCode = Array.from(functions).join('\n');

  // Emit one `uniform float` declaration per extracted param uniform
  const paramUniformDecls = Object.keys(paramUniforms)
    .map(name => `uniform float ${name};`)
    .join('\n');

  const fragmentShader = `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
${paramUniformDecls ? paramUniformDecls + '\n' : ''}
varying vec2 vUv;
${functionCode}

void main() {
    vec2 g_uv = (vUv - 0.5) * 2.0;
    g_uv.x *= u_resolution.x / u_resolution.y;
${mainCode.join('')}}`.trim();

  return { fragmentShader, nodeOutputVars: nodeOutputs, paramUniforms };
}

const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();


// Hello claude my algorthm friend, can you look throught all the files in this project to gain a deep understanding of it then help me write some learn docs that acts as a mini crash course to learn the program, Ill send you even more context