import type { GraphNode, DataType, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { topologicalSort } from './topoSort';
import type { LoopPairChain } from './topoSort';
import { defaultGlslVal, patchNodeParamsForUniforms } from './uniformPatcher';

// ── Runtime output-type helper ────────────────────────────────────────────────

/**
 * Get the actual GLSL output type for a node's output socket.
 * For Expr and CustomFn nodes the output type is stored in `params.outputType`
 * at runtime; their definition hardcodes `float` as a placeholder.
 */
function getNodeOutputType(node: GraphNode, defType: DataType): DataType {
  if (node.type === 'expr' || node.type === 'customFn') {
    const pt = node.params.outputType as string | undefined;
    if (pt === 'float' || pt === 'vec2' || pt === 'vec3' || pt === 'vec4') return pt as DataType;
  }
  return defType;
}

// ── Input-variable resolution ─────────────────────────────────────────────────

/**
 * Resolve the GLSL variable names that should be passed into a node's
 * `generateGLSL` call as its `inputVars` map.
 *
 * Priority:
 * 1. Connected source node's output variable
 * 2. CustomFn slider value from node.params
 * 3. Socket defaultValue
 * 4. Implicit UV / time fallbacks
 */
export function resolveInputVars(
  node: GraphNode,
  nodeOutputs: Map<string, Record<string, string>>,
  /** Full node map (used for type look-ups across the graph) */
  nodeMap: Map<string, GraphNode>,
): Record<string, string> {
  const inputVars: Record<string, string> = {};

  for (const [inputKey, input] of Object.entries(node.inputs)) {
    if (input.connection) {
      const sourceNode = nodeMap.get(input.connection.nodeId);
      const sourceDef = sourceNode ? getNodeDefinition(sourceNode.type) : undefined;
      const sourceOutputType =
        sourceNode?.outputs[input.connection.outputKey]?.type ??
        sourceDef?.outputs[input.connection.outputKey]?.type;
      const sourceOutputs = nodeOutputs.get(input.connection.nodeId);
      if (sourceOutputs) {
        const rawVar = sourceOutputs[input.connection.outputKey];
        // Auto-coerce float → vec3 when the target socket expects vec3
        if (sourceOutputType === 'float' && input.type === 'vec3') {
          inputVars[inputKey] = `vec3(${rawVar})`;
        } else {
          inputVars[inputKey] = rawVar;
        }
      }
    } else if (node.type === 'customFn' && typeof node.params[inputKey] === 'number') {
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
        const vals = input.defaultValue.map((v: number) => v.toFixed(1)).join(', ');
        inputVars[inputKey] = `${input.type}(${vals})`;
      }
    } else if (input.type === 'vec2' && (inputKey === 'uv' || inputKey === 'p' || inputKey === 'uv2')) {
      inputVars[inputKey] = 'g_uv';
    } else if (input.type === 'float' && (inputKey === 'time' || inputKey === 't')) {
      inputVars[inputKey] = 'u_time';
    }
  }

  return inputVars;
}

// ── Loop helpers ──────────────────────────────────────────────────────────────

/** Resolve input vars for a node inside a loop body (modal or wired pair). */
function resolveLoopBodyInputVars(
  bodyNode: GraphNode,
  _carryType: DataType,
  iterCarry: string,
  nodeOutputs: Map<string, Record<string, string>>,
  chainNodeIds: Set<string>,
): Record<string, string> {
  const inputVars: Record<string, string> = {};
  for (const [k, sock] of Object.entries(bodyNode.inputs)) {
    // Only inject the carry for sockets explicitly wired to a chain node.
    // Type-match inference was removed: it would falsely inject carry into float
    // param sockets on nodes that use a float carry type.
    const isCarryConn = sock.connection && chainNodeIds.has(sock.connection.nodeId);
    if (isCarryConn) {
      inputVars[k] = iterCarry;
    } else if (sock.connection) {
      const src = nodeOutputs.get(sock.connection.nodeId);
      inputVars[k] = src?.[sock.connection.outputKey] ?? defaultGlslVal(sock.type);
    } else if (bodyNode.type === 'customFn' && typeof bodyNode.params[k] === 'number') {
      const cfInputs = (bodyNode.params.inputs as Array<{ name: string; slider?: unknown }>) ?? [];
      const cfInp = cfInputs.find(c => c.name === k);
      if (cfInp?.slider != null) {
        const v = bodyNode.params[k] as number;
        inputVars[k] = Number.isInteger(v) ? `${v}.0` : `${v}`;
      }
    } else if (sock.defaultValue !== undefined) {
      if (typeof sock.defaultValue === 'number') {
        const sv = sock.defaultValue;
        inputVars[k] = Number.isInteger(sv) ? `${sv}.0` : `${sv}`;
      } else if (Array.isArray(sock.defaultValue)) {
        const vals = sock.defaultValue.map((v: number) => v.toFixed(1)).join(', ');
        inputVars[k] = `${sock.type}(${vals})`;
      }
    } else if (sock.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) {
      inputVars[k] = 'g_uv';
    } else if (sock.type === 'float' && (k === 'time' || k === 't')) {
      inputVars[k] = 'u_time';
    }
  }
  return inputVars;
}

/** Collect glslFunction strings from a list of node IDs. */
function collectFunctions(
  nodeIds: string[],
  allNodeMap: Map<string, GraphNode>,
  functions: Set<string>,
) {
  for (const id of nodeIds) {
    const n = allNodeMap.get(id);
    if (!n) continue;
    const def = getNodeDefinition(n.type);
    if (def?.glslFunction) functions.add(def.glslFunction);
    def?.glslFunctions?.forEach(f => functions.add(f));
    if (n.type === 'customFn' && typeof n.params.glslFunctions === 'string') {
      const h = (n.params.glslFunctions as string).trim();
      if (h) functions.add(h);
    }
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function generateFragmentShader(
  sortedNodes: GraphNode[],
  allNodes: GraphNode[],
  _loopInternalIds: Set<string>,
  loopPairChains: Map<string, LoopPairChain> = new Map(),
): { fragmentShader: string; nodeOutputVars: Map<string, Record<string, string>>; paramUniforms: Record<string, number>; textureUniforms: Record<string, string>; audioUniforms: Record<string, string>; isStateful: boolean } {
  const nodeMap    = new Map(sortedNodes.map(n => [n.id, n]));
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));
  const functions  = new Set<string>();
  const mainCode: string[] = [];
  const paramUniforms: Record<string, number> = {};
  const textureUniforms: Record<string, string> = {};  // uniformName → nodeId
  const audioUniforms: Record<string, string> = {};    // uniformName → nodeId
  const nodeOutputs = new Map<string, Record<string, string>>();

  // Pre-scan for textureInput, audioInput, and prevFrame nodes — their uniforms go in the preamble
  let isStateful = false;
  for (const node of sortedNodes) {
    if (node.type === 'textureInput') {
      textureUniforms[`u_tex_${node.id}`] = node.id;
    }
    if (node.type === 'audioInput') {
      const rawBands = node.params._bands;
      const bands: unknown[] = Array.isArray(rawBands) ? rawBands : [200];
      for (let i = 0; i < bands.length; i++) {
        audioUniforms[`u_audio_${node.id}_${i}`] = node.id;
      }
    }
    if (node.type === 'prevFrame' || node.type === 'radianceCascadesApprox') {
      isStateful = true;
    }
  }

  for (const node of sortedNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    // Collect GLSL helper functions (deduplicated)
    if (def.glslFunction) functions.add(def.glslFunction);
    def.glslFunctions?.forEach(f => functions.add(f));
    if (node.type === 'customFn' && typeof node.params.glslFunctions === 'string') {
      const h = (node.params.glslFunctions as string).trim();
      if (h) functions.add(h);
    }

    const inputVars = resolveInputVars(node, nodeOutputs, nodeMap);

    // ── Loop Start: register carry var — loopEnd owns the actual GLSL emission ─
    if (node.type === 'loopStart') {
      // Resolve the correct carryType: prefer chain lookup, then node's own
      // carryType param.  The param fallback is needed when the paired loopEnd
      // is absent from the subgraph (e.g. node-preview compilation).
      let startCarryType: DataType = 'vec2';
      for (const chain of loopPairChains.values()) {
        if (chain.startNodeId === node.id) { startCarryType = chain.carryType; break; }
      }
      const cp = node.params.carryType;
      if (cp === 'float' || cp === 'vec3' || cp === 'vec4') startCarryType = cp as DataType;
      const carryVar = inputVars['carry'] ?? defaultGlslVal(startCarryType);
      nodeOutputs.set(node.id, { carry: carryVar, iter_index: '0.0' });
      continue;
    }

    // ── Loop End: emit a real GLSL for loop over the body chain ─────────────
    if (node.type === 'loopEnd') {
      const chain = loopPairChains.get(node.id);
      if (!chain) {
        nodeOutputs.set(node.id, { result: 'vec2(0.0)' });
        continue;
      }

      const { bodyIds, startNodeId, carryType, iterations: iters } = chain;
      const id = node.id;

      // Initial carry value comes from the loopStart's registered carry var
      const initialCarry = startNodeId
        ? (nodeOutputs.get(startNodeId)?.['carry'] ?? defaultGlslVal(carryType))
        : (inputVars['carry'] ?? defaultGlslVal(carryType));

      collectFunctions(bodyIds, allNodeMap, functions);

      const carryVar  = `${id}_val`;
      const indexVar  = `${id}_i`;
      const chainNodeIds = new Set<string>(bodyIds);
      if (startNodeId) chainNodeIds.add(startNodeId);

      let code = '';

      // Declare and initialise the carry accumulator outside the loop
      code += `    ${carryType} ${carryVar} = ${initialCarry};\n`;

      // Emit a real GLSL for loop — one copy of the body, GPU iterates
      code += `    for (int ${indexVar} = 0; ${indexVar} < ${iters}; ${indexVar}++) {\n`;

      for (const bodyId of bodyIds) {
        const bodyNode = allNodeMap.get(bodyId);
        if (!bodyNode) continue;
        const bodyDef = getNodeDefinition(bodyNode.type);
        if (!bodyDef) continue;

        const bodyInputVars = resolveLoopBodyInputVars(
          bodyNode, carryType, carryVar, nodeOutputs, chainNodeIds,
        );
        // Inject the iteration index so body nodes can use it via a float input
        bodyInputVars['iter_index'] = `float(${indexVar})`;

        const bodyResult = bodyDef.generateGLSL(bodyNode, bodyInputVars);

        // Prefix all vars with loop ID to avoid collisions with the outer scope
        const prefixed = bodyResult.code.replace(
          new RegExp(`\\b${bodyId}_`, 'g'),
          `${id}_b_${bodyId}_`,
        );
        code += prefixed;

        // Update the carry accumulator from this body node's first output
        const firstOutKey = Object.keys(bodyResult.outputVars)[0];
        if (firstOutKey) {
          const rawVar = bodyResult.outputVars[firstOutKey];
          const prefixedVar = rawVar.replace(
            new RegExp(`\\b${bodyId}_`, 'g'),
            `${id}_b_${bodyId}_`,
          );
          code += `        ${carryVar} = ${prefixedVar};\n`;
        }
      }

      code += `    }\n`;
      mainCode.push(code);
      nodeOutputs.set(node.id, { result: carryVar });
      continue;
    }

    // ── Group: compile the subgraph inline (with optional iteration unrolling) ─
    if (node.type === 'group') {
      const subgraph = node.params.subgraph as SubgraphData | undefined;
      if (!subgraph || subgraph.nodes.length === 0) {
        nodeOutputs.set(node.id, {});
        continue;
      }

      const iters = Math.max(1, Math.min(16, Math.round(
        typeof node.params.iterations === 'number' ? node.params.iterations : 1,
      )));

      /** Compile one pass of the subgraph using the given port overrides and ID prefix. */
      const compileSubgraphPass = (iterPrefix: string, portInputOverrides: Map<string, string>, carryModeNaturalVars: Map<string, string> = new Map()) => {
        const prefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
          // Apply group-level param overrides: group.params stores `innerNodeId::paramKey` → value
          const overridePrefix = `${subNode.id}::`;
          const paramOverrides: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(node.params)) {
            if (key.startsWith(overridePrefix)) {
              paramOverrides[key.slice(overridePrefix.length)] = val;
            }
          }
          // ps_ external socket connections override slider values with GLSL vars
          const snDefForOverrides = getNodeDefinition(subNode.type);
          if (snDefForOverrides?.paramDefs) {
            for (const paramKey of Object.keys(snDefForOverrides.paramDefs)) {
              const psKey = `ps_${subNode.id}_${paramKey}`;
              const externalVar = inputVars[psKey];
              if (externalVar) {
                paramOverrides[paramKey] = externalVar;
              }
            }
          }
          return {
            ...subNode,
            id: iterPrefix + subNode.id,
            params: Object.keys(paramOverrides).length > 0 ? { ...subNode.params, ...paramOverrides } : subNode.params,
            inputs: Object.fromEntries(
              Object.entries(subNode.inputs).map(([k, inp]) => [
                k,
                inp.connection
                  ? { ...inp, connection: { nodeId: iterPrefix + inp.connection.nodeId, outputKey: inp.connection.outputKey } }
                  : inp,
              ]),
            ),
          };
        });
        // Exclude loopCarry nodes from the topo sort — they're pre-injected into nodeOutputs
        // and their next→value feedback creates a cycle that would throw in Kahn's algorithm.
        const sortedSub = topologicalSort(prefixedNodes.filter(sn => sn.type !== 'loopCarry'));
        for (const subNode of sortedSub) {
          const subDef = getNodeDefinition(subNode.type);
          if (!subDef) continue;
          // Skip nodes already pre-computed before this pass (e.g. loopIndex nodes
          // whose output was pre-injected with the real loop variable before the pass ran).
          if (nodeOutputs.has(subNode.id)) continue;

          // ── Nested group: recursively inline its subgraph (max 2 levels) ─────────
          if (subNode.type === 'group') {
            const innerSubgraph = subNode.params.subgraph as SubgraphData | undefined;
            if (!innerSubgraph || innerSubgraph.nodes.length === 0) {
              nodeOutputs.set(subNode.id, {});
              continue;
            }
            const innerPrefix = `${subNode.id}_g_`;
            // Resolve the nested group's own input vars from portInputOverrides + nodeOutputs
            const nestedOrigId = subNode.id.slice(iterPrefix.length);
            const nestedInputVars: Record<string, string> = {};
            for (const [k, inp] of Object.entries(subNode.inputs)) {
              const portKey = `${nestedOrigId}:${k}`;
              if (portInputOverrides.has(portKey)) {
                nestedInputVars[k] = portInputOverrides.get(portKey)!;
              } else if (inp.connection) {
                const srcOutputs = nodeOutputs.get(inp.connection.nodeId);
                if (srcOutputs?.[inp.connection.outputKey]) nestedInputVars[k] = srcOutputs[inp.connection.outputKey];
              }
              if (!nestedInputVars[k]) {
                if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) nestedInputVars[k] = 'g_uv';
                else if (inp.type === 'float' && (k === 'time' || k === 't')) nestedInputVars[k] = 'u_time';
                else if (inp.defaultValue !== undefined) {
                  if (typeof inp.defaultValue === 'number') nestedInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                  else if (Array.isArray(inp.defaultValue)) nestedInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                }
              }
            }
            // Build inner port overrides from the nested group's resolved input vars
            const innerPortOverrides = new Map<string, string>();
            for (const port of (innerSubgraph.inputPorts ?? [])) {
              const outerVar = nestedInputVars[port.key];
              if (outerVar) innerPortOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
            }
            // Collect GLSL helpers from inner subgraph nodes
            for (const inn of innerSubgraph.nodes) {
              const innDef = getNodeDefinition(inn.type);
              if (innDef?.glslFunction) functions.add(innDef.glslFunction);
              innDef?.glslFunctions?.forEach(f => functions.add(f));
              if (inn.type === 'customFn' && typeof inn.params.glslFunctions === 'string') {
                const h = (inn.params.glslFunctions as string).trim();
                if (h) functions.add(h);
              }
            }
            // Pre-inject loopIndex nodes (single-pass: i = 0.0)
            for (const inn of innerSubgraph.nodes) {
              if (inn.type === 'loopIndex') {
                nodeOutputs.set(innerPrefix + inn.id, { i: '0.0' });
              }
            }
            // Build prefixed inner nodes, applying param overrides from two sources:
            // 1-level: subNode.params["inn.id::paramKey"] (inner group's own overrides)
            // 2-level: node.params["nestedOrigId::inn.id::paramKey"] (outer group's surfaced param overrides)
            const innerPrefixedNodes: GraphNode[] = innerSubgraph.nodes.map(inn => {
              const override1Prefix = `${inn.id}::`;
              const override2Prefix = `${nestedOrigId}::${inn.id}::`;
              const innOverrides: Record<string, unknown> = {};
              // Apply 1-level overrides from inner group node's own params
              for (const [k, v] of Object.entries(subNode.params)) {
                if (typeof k === 'string' && k.startsWith(override1Prefix)) {
                  innOverrides[k.slice(override1Prefix.length)] = v;
                }
              }
              // Apply 2-level overrides from outer group node's params (surfaced params)
              for (const [k, v] of Object.entries(node.params)) {
                if (typeof k === 'string' && k.startsWith(override2Prefix)) {
                  innOverrides[k.slice(override2Prefix.length)] = v;
                }
              }
              // Check for 2-level ps_ socket wiring: if outer group's ps_innerGroupId_innId_paramKey is wired,
              // inject the GLSL var string as the param override (passes through p() as-is)
              const innDef = getNodeDefinition(inn.type);
              if (innDef?.paramDefs) {
                for (const paramKey of Object.keys(innDef.paramDefs)) {
                  const psKey2 = `ps_${nestedOrigId}_${inn.id}_${paramKey}`;
                  const externalVar = inputVars[psKey2];
                  if (externalVar) innOverrides[paramKey] = externalVar;
                }
              }
              return {
                ...inn,
                id: innerPrefix + inn.id,
                params: Object.keys(innOverrides).length > 0 ? { ...inn.params, ...innOverrides } : inn.params,
                inputs: Object.fromEntries(
                  Object.entries(inn.inputs).map(([k, inp]) => [
                    k,
                    inp.connection
                      ? { ...inp, connection: { nodeId: innerPrefix + inp.connection.nodeId, outputKey: inp.connection.outputKey } }
                      : inp,
                  ]),
                ),
              };
            });
            const sortedInner = topologicalSort(innerPrefixedNodes.filter(inn => inn.type !== 'loopCarry'));
            for (const inn of sortedInner) {
              if (nodeOutputs.has(inn.id)) continue;
              const innDef = getNodeDefinition(inn.type);
              if (!innDef) continue;
              const innOrigId = inn.id.slice(innerPrefix.length);
              const innInputVars: Record<string, string> = {};
              for (const [k, inp] of Object.entries(inn.inputs)) {
                const portKey = `${innOrigId}:${k}`;
                if (innerPortOverrides.has(portKey)) {
                  innInputVars[k] = innerPortOverrides.get(portKey)!;
                } else if (inp.connection) {
                  const srcOut = nodeOutputs.get(inp.connection.nodeId);
                  if (srcOut?.[inp.connection.outputKey]) innInputVars[k] = srcOut[inp.connection.outputKey];
                }
                if (!innInputVars[k]) {
                  if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) innInputVars[k] = 'g_uv';
                  else if (inp.type === 'float' && (k === 'time' || k === 't')) innInputVars[k] = 'u_time';
                  else if (inp.defaultValue !== undefined) {
                    if (typeof inp.defaultValue === 'number') innInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                    else if (Array.isArray(inp.defaultValue)) innInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                  }
                }
              }
              const { patchedNode: patchedInn, uniforms: innUniforms } = patchNodeParamsForUniforms(inn, innDef);
              Object.assign(paramUniforms, innUniforms);
              const innResult = innDef.generateGLSL(patchedInn, innInputVars);
              mainCode.push(innResult.code);
              nodeOutputs.set(inn.id, innResult.outputVars);
            }
            // Map inner group output ports → compiled vars
            const innerGroupOutVars: Record<string, string> = {};
            for (const port of innerSubgraph.outputPorts) {
              const fromOut = nodeOutputs.get(innerPrefix + port.fromNodeId);
              if (fromOut?.[port.fromOutputKey]) innerGroupOutVars[port.key] = fromOut[port.fromOutputKey];
            }
            nodeOutputs.set(subNode.id, innerGroupOutVars);
            continue;
          }

          if (subDef.glslFunction) functions.add(subDef.glslFunction);
          subDef.glslFunctions?.forEach(f => functions.add(f));
          const originalId = subNode.id.slice(iterPrefix.length);
          const subInputVars: Record<string, string> = {};
          for (const [k, inp] of Object.entries(subNode.inputs)) {
            const portKey = `${originalId}:${k}`;
            if (portInputOverrides.has(portKey)) {
              subInputVars[k] = portInputOverrides.get(portKey)!;
            } else if (inp.connection) {
              const srcOutputs = nodeOutputs.get(inp.connection.nodeId);
              if (srcOutputs?.[inp.connection.outputKey]) subInputVars[k] = srcOutputs[inp.connection.outputKey];
            }
            if (!subInputVars[k]) {
              if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) subInputVars[k] = 'g_uv';
              else if (inp.type === 'float' && (k === 'time' || k === 't')) subInputVars[k] = 'u_time';
              else if (inp.defaultValue !== undefined) {
                if (typeof inp.defaultValue === 'number') subInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                else if (Array.isArray(inp.defaultValue)) subInputVars[k] = `${inp.type}(${inp.defaultValue.map((v: number) => v.toFixed(1)).join(', ')})`;
              }
            }
          }
          // Apply __param_X input connections as param overrides (string GLSL vars skip uniform patching)
          let effectiveSubNode = subNode;
          for (const [k, v] of Object.entries(subInputVars)) {
            if (k.startsWith('__param_') && v) {
              const paramKey = k.slice('__param_'.length);
              effectiveSubNode = {
                ...effectiveSubNode,
                params: { ...effectiveSubNode.params, [paramKey]: v },
              };
            }
          }
          const { patchedNode: patchedSub, uniforms: subUniforms } = patchNodeParamsForUniforms(effectiveSubNode, subDef);
          Object.assign(paramUniforms, subUniforms);
          const subResult = subDef.generateGLSL(patchedSub, subInputVars);
          // For carry-mode nodes: strip the type from the declaration so we get
          // `    varName = f(varName);` instead of `    T varName = f(varName);`
          // If the node also has an assignOp (e.g. *=), apply it to the carry assignment:
          // `    varName *= f(varName);`
          // The variable was already forward-declared outside the loop.
          const naturalVar = carryModeNaturalVars.get(originalId);
          let codeToEmit = subResult.code;
          if (naturalVar) {
            const escaped = naturalVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const snForCarryOp = subgraph.nodes.find(n => n.id === originalId);
            const carryAssignOp = snForCarryOp?.assignOp && snForCarryOp.assignOp !== '=' ? snForCarryOp.assignOp : null;
            if (carryAssignOp) {
              // `    T varName = expr` → `    varName OP= expr`
              codeToEmit = codeToEmit.replace(
                new RegExp(`^(\\s+)(?:float|vec2|vec3|vec4)\\s+(${escaped})\\s*=`, 'm'),
                `$1$2 ${carryAssignOp}`,
              );
            } else {
              // `    T varName = expr` → `    varName = expr`
              codeToEmit = codeToEmit.replace(
                new RegExp(`^(\\s+)(?:float|vec2|vec3|vec4)\\s+(${escaped}\\s*=)`, 'm'),
                '$1$2',
              );
            }
          }
          mainCode.push(codeToEmit);
          nodeOutputs.set(subNode.id, subResult.outputVars);
        }
      };

      if (iters <= 1) {
        // ── Single pass (original behavior) ──────────────────────────────────
        const prefix = `${node.id}_g_`;
        const portInputOverrides = new Map<string, string>();
        for (const port of (subgraph.inputPorts ?? [])) {
          const outerVar = inputVars[port.key];
          if (outerVar) portInputOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
        }
        compileSubgraphPass(prefix, portInputOverrides);
        const groupOutputVars: Record<string, string> = {};
        for (const port of (subgraph.outputPorts ?? [])) {
          const fromOutputs = nodeOutputs.get(prefix + port.fromNodeId);
          if (fromOutputs?.[port.fromOutputKey]) groupOutputVars[port.key] = fromOutputs[port.fromOutputKey];
        }
        nodeOutputs.set(node.id, groupOutputVars);
      } else {
        // ── Iterated group: emit a GLSL for loop ──────────────────────────────
        const prefix = `${node.id}_g_`;

        // Carry pairs: outputPorts[i] ↔ inputPorts[i] where types match.
        // Carry vars are declared outside the loop and persist across iterations.
        // Non-matched inputs are "fixed" — use the outer var every iteration.
        const inPorts  = subgraph.inputPorts  ?? [];
        const outPorts = subgraph.outputPorts ?? [];
        const carryPairs: Array<{ inPort: SubgraphData['inputPorts'][0]; outPort: SubgraphData['outputPorts'][0] }> = [];
        const minLen = Math.min(inPorts.length, outPorts.length);
        for (let i = 0; i < minLen; i++) {
          if (inPorts[i].type === outPorts[i].type) {
            carryPairs.push({ inPort: inPorts[i], outPort: outPorts[i] });
          }
        }
        const carryInKeys = new Set(carryPairs.map(cp => cp.inPort.key));
        const carryOutKeys = new Set(carryPairs.map(cp => cp.outPort.key));

        // 1. Declare carry variables outside the loop
        const carryVarNames: Record<string, string> = {};
        for (const { inPort } of carryPairs) {
          const varName = `${node.id}_c${inPort.key}`;
          carryVarNames[inPort.key] = varName;
          const initVal = inputVars[inPort.key] ?? defaultGlslVal(inPort.type as DataType);
          mainCode.push(`    ${inPort.type} ${varName} = ${initVal};\n`);
        }

        // 1b. Declare outer "result" vars for non-carry outputs so they survive the loop scope
        //     We don't know the inner var names yet — fill them in after compileSubgraphPass.
        //     Store placeholder names keyed by output port key.
        const nonCarryOutVarNames: Record<string, string> = {};
        for (const port of outPorts) {
          if (!carryOutKeys.has(port.key)) {
            const varName = `${node.id}_out_${port.key}`;
            nonCarryOutVarNames[port.key] = varName;
            // Type will be determined after compilation; use the port's declared type
            mainCode.push(`    ${port.type} ${varName} = ${defaultGlslVal(port.type as DataType)};\n`);
          }
        }

        // Build portInputOverrides early — needed for carry-mode node init resolution below.
        const portInputOverrides = new Map<string, string>();
        for (const port of inPorts) {
          const outerVar = carryInKeys.has(port.key)
            ? carryVarNames[port.key]   // carry: use the persistent carry var
            : inputVars[port.key];      // fixed: same outer var every iteration
          if (outerVar) portInputOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
        }

        // 1c. Carry-mode nodes: forward-declare the node's natural output var outside the loop,
        //     initialize it, then feed it back as the carry input each iteration.
        //     Pattern: `T d; d = init; for (...) { d = f(d); }`
        //     The type is NOT re-declared inside the loop — compileSubgraphPass strips it.
        const carryModeNaturalVars = new Map<string, string>();  // originalNodeId → naturalVarName
        for (const sn of subgraph.nodes) {
          if (!sn.carryMode) continue;
          const def = getNodeDefinition(sn.type);
          if (!def) continue;
          const firstOutEntry = Object.entries(def.outputs)[0];
          if (!firstOutEntry) continue;
          const [firstOutKey, firstOutSock] = firstOutEntry;
          // Use the actual runtime output type (Expr/CustomFn store it in params.outputType)
          const actualOutType = getNodeOutputType(sn, firstOutSock.type);
          // Find first input with the same type as the primary output (the carry input).
          // Fall back to the first input for nodes like Expr where definition types
          // don't reflect the actual wired types (all Expr inputs are 'float' in the def).
          // For CustomFn, def.inputs is empty — inputs are stored in params.inputs.
          type InputEntry = [string, { type: DataType; label: string }];
          let carryInputEntry: InputEntry | undefined =
            (Object.entries(def.inputs).find(([, s]) => s.type === actualOutType)
            ?? Object.entries(def.inputs)[0]) as InputEntry | undefined;
          if (!carryInputEntry && sn.type === 'customFn') {
            const cfInputs = (sn.params.inputs as Array<{ name: string; type: string }> | undefined) ?? [];
            const match = cfInputs.find(ci => ci.type === actualOutType) ?? cfInputs[0];
            if (match) carryInputEntry = [match.name, { type: match.type as DataType, label: match.name }];
          }
          if (!carryInputEntry) continue;
          const [carryInputKey] = carryInputEntry;

          // Natural output var name matches what generateGLSL will produce inside the loop
          const naturalVarName = `${prefix}${sn.id}_${firstOutKey}`;
          carryModeNaturalVars.set(sn.id, naturalVarName);

          // Resolve initial value: portInputOverrides takes priority, then subgraph connection
          let initVar = defaultGlslVal(actualOutType);
          const portKey = `${sn.id}:${carryInputKey}`;
          if (portInputOverrides.has(portKey)) {
            initVar = portInputOverrides.get(portKey)!;
          } else {
            const conn = sn.inputs[carryInputKey]?.connection;
            if (conn) {
              const srcOut = nodeOutputs.get(conn.nodeId)?.[conn.outputKey]
                          ?? nodeOutputs.get(prefix + conn.nodeId)?.[conn.outputKey];
              if (srcOut) initVar = srcOut;
            }
          }

          // Forward-declare without init (T d;), then assign (d = init;)
          // This lets us reuse the same variable name inside the loop without re-declaring.
          mainCode.push(`    ${actualOutType} ${naturalVarName};\n`);
          mainCode.push(`    ${naturalVarName} = ${initVar};\n`);
          // Feed the carry var as the carry input so the node uses it each iteration
          portInputOverrides.set(portKey, naturalVarName);
          void firstOutKey;
        }

        // 1e. Declare outer accumulator vars for nodes with assignOp != '='
        //     These nodes' outputs persist across iterations and accumulate.
        //     Carry-mode nodes are excluded: their assignOp is already applied directly
        //     to the carry assignment inside the loop (handled in compileSubgraphPass above).
        const accumNodeVarNames: Record<string, Record<string, string>> = {};  // nodeId → { outKey → outerVarName }
        for (const sn of subgraph.nodes) {
          const op = sn.assignOp;
          if (!op || op === '=') continue;
          if (sn.carryMode) continue;  // carry-mode nodes handle assignOp via the carry mechanism
          const def = getNodeDefinition(sn.type);
          if (!def) continue;
          // Neutral initializer: 0 for +/-, 1 for *//
          const isMultiply = op === '*=' || op === '/=';
          const outVars: Record<string, string> = {};
          for (const [outKey, outSock] of Object.entries(def.outputs)) {
            // Use the actual runtime type (Expr/CustomFn store it in params.outputType)
            const actualType = getNodeOutputType(sn, outSock.type);
            const varName = `${node.id}_ao_${sn.id}_${outKey}`;
            outVars[outKey] = varName;
            const neutral = isMultiply ? `${actualType}(1.0)` : defaultGlslVal(actualType);
            const initExpr = sn.assignInit?.trim() || neutral;
            mainCode.push(`    ${actualType} ${varName} = ${initExpr};\n`);
          }
          accumNodeVarNames[sn.id] = outVars;
        }

        // 2. Open the for loop
        const loopVar = `${node.id}_i`;
        mainCode.push(`    for (float ${loopVar} = 0.0; ${loopVar} < ${iters}.0; ${loopVar}++) {\n`);

        // Pre-inject loop index for any loopIndex nodes in the subgraph
        for (const sn of subgraph.nodes) {
          if (sn.type === 'loopIndex') {
            nodeOutputs.set(prefix + sn.id, { i: loopVar });
          }
        }

        // Pre-inject LoopCarry nodes — declare carry vars outside loop, inject current value
        const loopCarryNodes = subgraph.nodes.filter(sn => sn.type === 'loopCarry');
        const loopCarryVarNames: Record<string, string> = {};
        for (const sn of loopCarryNodes) {
          const carryType = (sn.params.dataType as string | undefined) ?? (sn.outputs.value?.type ?? 'vec2');
          const carryVarName = `${node.id}_lc_${sn.id}`;
          loopCarryVarNames[sn.id] = carryVarName;

          // Resolve init value: check portInputOverrides for `init` input, then connection
          let initVar = defaultGlslVal(carryType as import('../types/nodeGraph').DataType);
          const initConn = sn.inputs['init']?.connection;
          if (initConn) {
            // init connected to another inner node already processed before loop
            const srcOut = nodeOutputs.get(prefix + initConn.nodeId)?.[initConn.outputKey];
            if (srcOut) initVar = srcOut;
            // Also check portInputOverrides for this source node
            const overrideKey = `${initConn.nodeId}:${initConn.outputKey}`;
            if (portInputOverrides.has(overrideKey)) initVar = portInputOverrides.get(overrideKey)!;
          }
          // Check if portInputOverrides maps directly to this node's init input
          const directKey = `${sn.id}:init`;
          if (portInputOverrides.has(directKey)) initVar = portInputOverrides.get(directKey)!;

          mainCode.push(`    ${carryType} ${carryVarName} = ${initVar};\n`);
          // Pre-inject so compileSubgraphPass sees this node as already done
          nodeOutputs.set(prefix + sn.id, { value: carryVarName });
        }

        // 3. Compile subgraph body.
        //    carryModeNaturalVars tells the pass to strip the type from carry-mode node output
        //    declarations, producing `d = f(d);` instead of `T d = f(d);` inside the loop.
        compileSubgraphPass(prefix, portInputOverrides, carryModeNaturalVars);

        // 3b. Update LoopCarry vars from their `next` inputs (end of iteration)
        for (const sn of loopCarryNodes) {
          const nextConn = sn.inputs['next']?.connection;
          if (nextConn) {
            const nextVar = nodeOutputs.get(prefix + nextConn.nodeId)?.[nextConn.outputKey];
            if (nextVar) {
              mainCode.push(`    ${loopCarryVarNames[sn.id]} = ${nextVar};\n`);
            }
          }
        }

        // 3c. Apply assignOp accumulations for nodes marked with += / -= / *= / /=
        //     Emit `outerVar OP innerVar;` then update nodeOutputs to point to the outer var.
        //     Downstream nodes inside the loop see the inner (fresh) var; the group output
        //     sees the outer (accumulated) var.
        //     Carry-mode nodes are excluded: their accumulation happens via the carry assignment.
        for (const sn of subgraph.nodes) {
          const op = sn.assignOp;
          if (!op || op === '=') continue;
          if (sn.carryMode) continue;  // handled via carry mechanism
          const outVars = accumNodeVarNames[sn.id];
          if (!outVars) continue;
          const freshOutputs = nodeOutputs.get(prefix + sn.id);
          if (!freshOutputs) continue;
          const updatedOutputs: Record<string, string> = {};
          for (const [outKey, outerVarName] of Object.entries(outVars)) {
            const freshVar = freshOutputs[outKey];
            if (freshVar) {
              mainCode.push(`    ${outerVarName} ${op} ${freshVar};\n`);
            }
            // Point nodeOutputs to the outer accumulated var for downstream reads
            updatedOutputs[outKey] = outerVarName;
          }
          nodeOutputs.set(prefix + sn.id, updatedOutputs);
        }

        // 4. Update carry vars from this iteration's outputs (inside the loop)
        for (const { inPort, outPort } of carryPairs) {
          const fromOutputs = nodeOutputs.get(prefix + outPort.fromNodeId);
          if (fromOutputs?.[outPort.fromOutputKey]) {
            mainCode.push(`    ${carryVarNames[inPort.key]} = ${fromOutputs[outPort.fromOutputKey]};\n`);
          }
        }

        // 4b. Copy non-carry output vars to their outer counterparts (before closing brace)
        for (const port of outPorts) {
          if (!carryOutKeys.has(port.key)) {
            const fromOutputs = nodeOutputs.get(prefix + port.fromNodeId);
            const innerVar = fromOutputs?.[port.fromOutputKey];
            if (innerVar) {
              mainCode.push(`    ${nonCarryOutVarNames[port.key]} = ${innerVar};\n`);
            }
          }
        }

        // 5. Close the for loop
        mainCode.push(`    }\n`);

        // 6. Map group outputs: carry pairs use their persistent vars; non-carry use outer result vars
        const groupOutputVars: Record<string, string> = {};
        for (const port of outPorts) {
          if (carryOutKeys.has(port.key)) {
            const matchPair = carryPairs.find(cp => cp.outPort.key === port.key);
            if (matchPair) groupOutputVars[port.key] = carryVarNames[matchPair.inPort.key];
          } else {
            if (nonCarryOutVarNames[port.key]) groupOutputVars[port.key] = nonCarryOutVarNames[port.key];
          }
        }
        nodeOutputs.set(node.id, groupOutputVars);
      }
      continue;
    }

    // ── Scene Group: compile subgraph as a named GLSL function ───────────────
    if (node.type === 'sceneGroup') {
      const subgraph = node.params.subgraph as SubgraphData | undefined;
      if (!subgraph || subgraph.nodes.length === 0) {
        nodeOutputs.set(node.id, { scene: 'MISSING_SCENE' });
        continue;
      }

      const fnName = `mapScene_${node.id.replace(/-/g, '_')}`;
      const sgPrefix = `${node.id}_sg_`;
      const sceneFnLines: string[] = [];

      // Pre-register ScenePosNode outputs so they resolve to 'p' (the fn parameter)
      for (const sn of subgraph.nodes) {
        if (sn.type === 'scenePos') {
          nodeOutputs.set(sgPrefix + sn.id, { pos: 'p' });
        }
      }

      // Apply port input overrides from the sceneGroup's own outer inputs
      const sgPortOverrides = new Map<string, string>();
      for (const port of (subgraph.inputPorts ?? [])) {
        const outerVar = inputVars[port.key];
        if (outerVar) sgPortOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
      }

      // Prefix all subgraph node IDs + connections, applying any nodeId::paramKey overrides
      const sgPrefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
        // Collect param overrides stored on the outer sceneGroup node as "innerNodeId::paramKey"
        const overridePrefix = `${subNode.id}::`;
        const paramOverrides: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.params)) {
          if (key.startsWith(overridePrefix)) {
            paramOverrides[key.slice(overridePrefix.length)] = val;
          }
        }

        return {
          ...subNode,
          id: sgPrefix + subNode.id,
          params: { ...subNode.params, ...paramOverrides },
          inputs: Object.fromEntries(
            Object.entries(subNode.inputs).map(([k, inp]) => [
              k,
              inp.connection
                ? { ...inp, connection: { nodeId: sgPrefix + inp.connection.nodeId, outputKey: inp.connection.outputKey } }
                : inp,
            ]),
          ),
        };
      });

      const sgSorted = topologicalSort(sgPrefixedNodes);
      let sgLastFloatVar = '100.0';  // default return value (large dist = miss)

      for (const sn of sgSorted) {
        if (nodeOutputs.has(sn.id)) continue;  // scenePos already registered
        const snDef = getNodeDefinition(sn.type);
        if (!snDef) continue;

        // Collect GLSL helper functions
        if (snDef.glslFunction) functions.add(snDef.glslFunction);
        if (snDef.glslFunctions) snDef.glslFunctions.forEach(h => functions.add(h));

        // Resolve input vars
        const origId = sn.id.slice(sgPrefix.length);
        const snInputVars: Record<string, string> = {};
        for (const [k, inp] of Object.entries(sn.inputs)) {
          const portKey = `${origId}:${k}`;
          if (sgPortOverrides.has(portKey)) {
            snInputVars[k] = sgPortOverrides.get(portKey)!;
          } else if (inp.connection) {
            const srcOut = nodeOutputs.get(inp.connection.nodeId);
            if (srcOut?.[inp.connection.outputKey]) snInputVars[k] = srcOut[inp.connection.outputKey];
          }
          // Fallbacks
          if (!snInputVars[k]) {
            if (inp.defaultValue !== undefined) {
              if (typeof inp.defaultValue === 'number') snInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
              else if (Array.isArray(inp.defaultValue)) snInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
            }
          }
        }

        const snResult = snDef.generateGLSL(sn, snInputVars);
        sceneFnLines.push(snResult.code);
        nodeOutputs.set(sn.id, snResult.outputVars);

        // Track last float output as candidate return value
        for (const [outKey, varName] of Object.entries(snResult.outputVars)) {
          const outType = snDef.outputs[outKey]?.type;
          if (outType === 'float') sgLastFloatVar = varName;
        }
      }

      // Find return value from the subgraph's output port (if defined)
      for (const port of (subgraph.outputPorts ?? [])) {
        if (port.type === 'float') {
          const srcOut = nodeOutputs.get(sgPrefix + port.fromNodeId);
          if (srcOut?.[port.fromOutputKey]) sgLastFloatVar = srcOut[port.fromOutputKey];
        }
      }

      // Emit the GLSL function
      const fnBody = sceneFnLines.join('');
      const fnDef = `float ${fnName}(vec3 p) {\n${fnBody}    return ${sgLastFloatVar};\n}`;
      functions.add(fnDef);

      nodeOutputs.set(node.id, { scene: fnName });
      continue;
    }

    // ── Bypass: pass first input through to all outputs ───────────────────────
    if (node.bypassed) {
      const inputEntries = Object.entries(inputVars);
      const bypassOutputVars: Record<string, string> = {};
      let bypassCode = '';

      if (inputEntries.length > 0) {
        const [, passthroughVar] = inputEntries[0];
        const outputEntries = Object.entries(def.outputs);
        for (const [outKey, outSocket] of outputEntries) {
          const varName = `${node.id}_${outKey}`;
          const srcType = (Object.values(def.inputs)[0]?.type ?? 'float');
          let coerced = passthroughVar;
          if (srcType !== outSocket.type) {
            if (outSocket.type === 'float' && srcType === 'vec2') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'float' && srcType === 'vec3') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'float' && srcType === 'vec4') coerced = `${passthroughVar}.x`;
            else if (outSocket.type === 'vec2' && srcType === 'float') coerced = `vec2(${passthroughVar})`;
            else if (outSocket.type === 'vec3' && srcType === 'float') coerced = `vec3(${passthroughVar})`;
            else if (outSocket.type === 'vec3' && srcType === 'vec2') coerced = `vec3(${passthroughVar}, 0.0)`;
            else if (outSocket.type === 'vec4' && srcType === 'float') coerced = `vec4(${passthroughVar})`;
            else if (outSocket.type === 'vec4' && srcType === 'vec3') coerced = `vec4(${passthroughVar}, 1.0)`;
            const matchingInput = inputEntries.find(([, v]) => v !== passthroughVar);
            if (matchingInput) coerced = matchingInput[1];
          }
          bypassCode += `    ${outSocket.type} ${varName} = ${coerced};\n`;
          bypassOutputVars[outKey] = varName;
        }
        if (outputEntries.length === 0) {
          const result = def.generateGLSL(node, inputVars);
          bypassCode = result.code;
          Object.assign(bypassOutputVars, result.outputVars);
        }
      } else {
        const result = def.generateGLSL(node, inputVars);
        bypassCode = result.code;
        Object.assign(bypassOutputVars, result.outputVars);
      }
      mainCode.push(bypassCode);
      nodeOutputs.set(node.id, bypassOutputVars);
      continue;
    }

    // ── Standard node ─────────────────────────────────────────────────────────
    const { patchedNode, uniforms: nodeUniforms } = patchNodeParamsForUniforms(node, def);
    Object.assign(paramUniforms, nodeUniforms);

    const override = typeof node.params.__codeOverride === 'string'
      ? (node.params.__codeOverride as string).trim()
      : null;

    if (override) {
      const placeholderResult = def.generateGLSL(patchedNode, inputVars);
      mainCode.push(override + '\n');
      nodeOutputs.set(node.id, placeholderResult.outputVars);
    } else {
      const result = def.generateGLSL(patchedNode, inputVars);

      // ── assignOp in the MAIN GRAPH ─────────────────────────────────────────
      // When assignOp is set (and not the default '='), declare an accumulator
      // variable initialised with assignInit (or the neutral element), run the
      // node's generated code, then apply the compound op.  Downstream nodes
      // see the accumulated variable instead of the raw output.
      if (node.assignOp && node.assignOp !== '=') {
        const isMultiply = node.assignOp === '*=' || node.assignOp === '/=';
        const accVars: Record<string, string> = {};
        for (const outKey of Object.keys(result.outputVars)) {
          const outSock = def.outputs[outKey];
          const actualType = outSock?.type ?? 'float';
          const neutral = isMultiply ? `${actualType}(1.0)` : defaultGlslVal(actualType as DataType);
          const initExpr = node.assignInit?.trim() || neutral;
          const accVar = `${node.id}_ao_${outKey}`;
          mainCode.push(`    ${actualType} ${accVar} = ${initExpr};\n`);
          accVars[outKey] = accVar;
        }
        mainCode.push(result.code);
        for (const [outKey, accVar] of Object.entries(accVars)) {
          const freshVar = result.outputVars[outKey];
          if (freshVar) mainCode.push(`    ${accVar} ${node.assignOp} ${freshVar};\n`);
        }
        nodeOutputs.set(node.id, accVars);
      } else {
        mainCode.push(result.code);
        nodeOutputs.set(node.id, result.outputVars);
      }
    }
  }

  // ── Build the fragment shader string ─────────────────────────────────────
  const functionCode = Array.from(functions).join('\n');
  const paramUniformDecls = Object.keys(paramUniforms)
    .map(name => `uniform float ${name};`)
    .join('\n');
  const textureUniformDecls = [
    ...Object.keys(textureUniforms).map(name => `uniform sampler2D ${name};`),
    ...(isStateful ? ['uniform sampler2D u_prevFrame;'] : []),
  ].join('\n');
  const audioUniformDecls = Object.keys(audioUniforms)
    .map(name => `uniform float ${name};`)
    .join('\n');

  const fragmentShader = `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
${paramUniformDecls ? paramUniformDecls + '\n' : ''}${textureUniformDecls ? textureUniformDecls + '\n' : ''}${audioUniformDecls ? audioUniformDecls + '\n' : ''}
varying vec2 vUv;

// ── Built-in helpers (always available to all nodes / custom functions) ──────
vec2 noiseHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noiseHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(noiseHash1(i), noiseHash1(i+vec2(1,0)), u.x),
               mix(noiseHash1(i+vec2(0,1)), noiseHash1(i+vec2(1,1)), u.x), u.y);
}
// Rotate a 2D vector by angle (radians)
vec2 rotate(vec2 v, float angle) {
    return vec2(v.x * cos(angle) - v.y * sin(angle),
                v.x * sin(angle) + v.y * cos(angle));
}
// Signed distance — axis-aligned box
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// Signed distance — line segment
float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
// Signed distance — ellipse
float sdEllipse(vec2 p, vec2 ab) {
    p = abs(p);
    if (p.x > p.y) { p = p.yx; ab = ab.yx; }
    float l = ab.y*ab.y - ab.x*ab.x;
    float m = ab.x*p.x/l; float m2 = m*m;
    float n = ab.y*p.y/l; float n2 = n*n;
    float c = (m2+n2-1.0)/3.0; float c3 = c*c*c;
    float q = c3 + m2*n2*2.0; float d2 = c3 + m2*n2; float g = m + m*n2;
    float co;
    if (d2 < 0.0) {
        float h2 = acos(q/c3)/3.0;
        float s2 = cos(h2); float t2 = sin(h2)*sqrt(3.0);
        float rx2 = sqrt(-c*(s2+t2+2.0)+m2); float ry2 = sqrt(-c*(s2-t2+2.0)+m2);
        co = (ry2+sign(l)*rx2+abs(g)/(rx2*ry2)-m)/2.0;
    } else {
        float h2 = 2.0*m*n*sqrt(d2);
        float s2 = sign(q+h2)*pow(abs(q+h2), 1.0/3.0);
        float t2 = sign(q-h2)*pow(abs(q-h2), 1.0/3.0);
        float rx2 = -(s2+t2)-c*4.0+2.0*m2; float ry2 = (s2-t2)*sqrt(3.0);
        float rm2 = sqrt(rx2*rx2+ry2*ry2);
        co = (ry2/sqrt(rm2-rx2)+2.0*g/rm2-m)/2.0;
    }
    vec2 r2 = ab*vec2(co, sqrt(1.0-co*co));
    return length(r2-p)*sign(p.y-r2.y);
}
// Domain repetition — tile space with period s
vec2 opRepeat(vec2 p, float s) {
    return mod(p + s*0.5, s) - s*0.5;
}
// Polar domain repetition — n-fold symmetry
vec2 opRepeatPolar(vec2 p, float n) {
    float angle = TAU / n;
    float a = atan(p.y, p.x) + angle * 0.5;
    a = mod(a, angle) - angle * 0.5;
    return vec2(cos(a), sin(a)) * length(p);
}
// ─────────────────────────────────────────────────────────────────────────

${functionCode}

void main() {
    vec2 g_uv = (vUv - 0.5) * 2.0;
    g_uv.x *= u_resolution.x / u_resolution.y;
${mainCode.join('')}}`.trim();

  return { fragmentShader, nodeOutputVars: nodeOutputs, paramUniforms, textureUniforms, audioUniforms, isStateful };
}
