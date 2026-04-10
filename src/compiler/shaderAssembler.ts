import type { GraphNode, DataType, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { topologicalSort } from './topoSort';
import { defaultGlslVal, patchNodeParamsForUniforms } from './uniformPatcher';

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
  carryType: DataType,
  iterCarry: string,
  nodeOutputs: Map<string, Record<string, string>>,
  chainNodeIds: Set<string>,
): Record<string, string> {
  const inputVars: Record<string, string> = {};
  for (const [k, sock] of Object.entries(bodyNode.inputs)) {
    const isCarryConn = sock.connection && chainNodeIds.has(sock.connection.nodeId);
    if (isCarryConn || (!sock.connection && (sock.type as string) === (carryType as string))) {
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
  loopPairChains: Map<string, string[]> = new Map(),
): { fragmentShader: string; nodeOutputVars: Map<string, Record<string, string>>; paramUniforms: Record<string, number> } {
  const nodeMap    = new Map(sortedNodes.map(n => [n.id, n]));
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));
  const functions  = new Set<string>();
  const mainCode: string[] = [];
  const paramUniforms: Record<string, number> = {};
  const nodeOutputs = new Map<string, Record<string, string>>();

  for (const node of sortedNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    // Collect GLSL helper functions (deduplicated)
    if (def.glslFunction) functions.add(def.glslFunction);
    if (node.type === 'customFn' && typeof node.params.glslFunctions === 'string') {
      const h = (node.params.glslFunctions as string).trim();
      if (h) functions.add(h);
    }

    const inputVars = resolveInputVars(node, nodeOutputs, nodeMap);

    // ── Loop Start: emit carry init var ──────────────────────────────────────
    if (node.type === 'loopStart') {
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
      let iters = Math.max(1, Math.min(16, Math.round(
        typeof node.params.iterations === 'number' ? node.params.iterations : 4,
      )));

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
          const srcNode = allNodeMap.get(walkId);
          if (srcNode) {
            const outType = srcNode.outputs[loopEndCarryConn.outputKey]?.type;
            if (outType === 'float' || outType === 'vec2' || outType === 'vec3' || outType === 'vec4') {
              carryType = outType as DataType;
            }
          }
          const wn2 = allNodeMap.get(walkId);
          const nextConn = wn2
            ? Object.values(wn2.inputs).find(i => i.connection)?.connection
            : undefined;
          walkId = nextConn?.nodeId;
        }
      }

      if (startNodeId) {
        const startNode = allNodeMap.get(startNodeId);
        if (typeof startNode?.params.iterations === 'number') {
          iters = Math.max(1, Math.min(16, Math.round(startNode.params.iterations)));
        }
      }

      const chainNodeIds = new Set<string>(bodyIds);
      if (startNodeId) chainNodeIds.add(startNodeId);

      let initialCarry = defaultGlslVal(carryType);
      if (startNodeId) {
        const startOutputs = nodeOutputs.get(startNodeId);
        if (startOutputs) {
          const firstKey = Object.keys(startOutputs)[0];
          if (firstKey) initialCarry = startOutputs[firstKey];
        }
      } else {
        initialCarry = inputVars['carry'] ?? defaultGlslVal(carryType);
      }

      collectFunctions(bodyIds, allNodeMap, functions);

      let loopCode = `    ${carryType} ${id}_val = ${initialCarry};\n`;
      for (let n = 0; n < iters; n++) {
        let iterCarry = `${id}_val`;
        for (const bodyId of bodyIds) {
          const bodyNode = allNodeMap.get(bodyId);
          if (!bodyNode) continue;
          const bodyDef = getNodeDefinition(bodyNode.type);
          if (!bodyDef) continue;
          const bodyInputVars = resolveLoopBodyInputVars(bodyNode, carryType, iterCarry, nodeOutputs, chainNodeIds);
          const bodyResult = bodyDef.generateGLSL(bodyNode, bodyInputVars);
          loopCode += bodyResult.code.replace(new RegExp(`\\b${bodyId}_`, 'g'), `${bodyId}_P${n}_`);
          const firstOutKey = Object.keys(bodyResult.outputVars)[0];
          if (firstOutKey) iterCarry = `${bodyId}_P${n}_${firstOutKey}`;
        }
        loopCode += `    ${id}_val = ${iterCarry};\n`;
      }
      mainCode.push(loopCode);
      nodeOutputs.set(node.id, { result: `${id}_val` });
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
      const compileSubgraphPass = (iterPrefix: string, portInputOverrides: Map<string, string>) => {
        const prefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
          // Apply group-level param overrides: group.params stores `innerNodeId::paramKey` → value
          const overridePrefix = `${subNode.id}::`;
          const paramOverrides: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(node.params)) {
            if (key.startsWith(overridePrefix)) {
              paramOverrides[key.slice(overridePrefix.length)] = val;
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
        const sortedSub = topologicalSort(prefixedNodes);
        for (const subNode of sortedSub) {
          const subDef = getNodeDefinition(subNode.type);
          if (!subDef) continue;
          if (subDef.glslFunction) functions.add(subDef.glslFunction);
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
          const { patchedNode: patchedSub, uniforms: subUniforms } = patchNodeParamsForUniforms(subNode, subDef);
          Object.assign(paramUniforms, subUniforms);
          const subResult = subDef.generateGLSL(patchedSub, subInputVars);
          mainCode.push(subResult.code);
          nodeOutputs.set(subNode.id, subResult.outputVars);
        }
      };

      if (iters <= 1) {
        // ── Single pass (original behavior) ──────────────────────────────────
        const prefix = `${node.id}_g_`;
        const portInputOverrides = new Map<string, string>();
        for (const port of subgraph.inputPorts) {
          const outerVar = inputVars[port.key];
          if (outerVar) portInputOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
        }
        compileSubgraphPass(prefix, portInputOverrides);
        const groupOutputVars: Record<string, string> = {};
        for (const port of subgraph.outputPorts) {
          const fromOutputs = nodeOutputs.get(prefix + port.fromNodeId);
          if (fromOutputs?.[port.fromOutputKey]) groupOutputVars[port.key] = fromOutputs[port.fromOutputKey];
        }
        nodeOutputs.set(node.id, groupOutputVars);
      } else {
        // ── Iterated group: emit a GLSL for loop ──────────────────────────────
        // Carry pairs: outputPorts[i] ↔ inputPorts[i] where types match.
        // Carry vars are declared outside the loop and persist across iterations.
        // Non-matched inputs are "fixed" — use the outer var every iteration.
        const carryPairs: Array<{ inPort: SubgraphData['inputPorts'][0]; outPort: SubgraphData['outputPorts'][0] }> = [];
        const minLen = Math.min(subgraph.inputPorts.length, subgraph.outputPorts.length);
        for (let i = 0; i < minLen; i++) {
          if (subgraph.inputPorts[i].type === subgraph.outputPorts[i].type) {
            carryPairs.push({ inPort: subgraph.inputPorts[i], outPort: subgraph.outputPorts[i] });
          }
        }
        const carryInKeys = new Set(carryPairs.map(cp => cp.inPort.key));

        // 1. Declare carry variables outside the loop
        const carryVarNames: Record<string, string> = {};
        for (const { inPort } of carryPairs) {
          const varName = `${node.id}_c${inPort.key}`;
          carryVarNames[inPort.key] = varName;
          const initVal = inputVars[inPort.key] ?? defaultGlslVal(inPort.type as DataType);
          mainCode.push(`    ${inPort.type} ${varName} = ${initVal};\n`);
        }

        // 2. Open the for loop
        const loopVar = `${node.id}_i`;
        mainCode.push(`    for (float ${loopVar} = 0.0; ${loopVar} < ${iters}.0; ${loopVar}++) {\n`);

        // 3. Compile subgraph body (same prefix every iteration — vars are loop-scoped)
        const prefix = `${node.id}_g_`;
        const portInputOverrides = new Map<string, string>();
        for (const port of subgraph.inputPorts) {
          const outerVar = carryInKeys.has(port.key)
            ? carryVarNames[port.key]   // carry: use the persistent carry var
            : inputVars[port.key];      // fixed: same outer var every iteration
          if (outerVar) portInputOverrides.set(`${port.toNodeId}:${port.toInputKey}`, outerVar);
        }
        compileSubgraphPass(prefix, portInputOverrides);

        // 4. Update carry vars from this iteration's outputs (inside the loop)
        for (const { inPort, outPort } of carryPairs) {
          const fromOutputs = nodeOutputs.get(prefix + outPort.fromNodeId);
          if (fromOutputs?.[outPort.fromOutputKey]) {
            mainCode.push(`    ${carryVarNames[inPort.key]} = ${fromOutputs[outPort.fromOutputKey]};\n`);
          }
        }

        // 5. Close the for loop
        mainCode.push(`    }\n`);

        // 6. Map group outputs: carry pairs use their persistent vars; others use last compiled value
        const groupOutputVars: Record<string, string> = {};
        const carryOutKeys = new Set(carryPairs.map(cp => cp.outPort.key));
        for (const port of subgraph.outputPorts) {
          if (carryOutKeys.has(port.key)) {
            // Carry output: use the persistent carry var of the matching input
            const matchPair = carryPairs.find(cp => cp.outPort.key === port.key);
            if (matchPair) groupOutputVars[port.key] = carryVarNames[matchPair.inPort.key];
          } else {
            // Non-carry output: use last iteration's compiled value (still in scope for single-pass)
            const fromOutputs = nodeOutputs.get(prefix + port.fromNodeId);
            if (fromOutputs?.[port.fromOutputKey]) groupOutputVars[port.key] = fromOutputs[port.fromOutputKey];
          }
        }
        nodeOutputs.set(node.id, groupOutputVars);
      }
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
      mainCode.push(result.code);
      nodeOutputs.set(node.id, result.outputVars);
    }
  }

  // ── Build the fragment shader string ─────────────────────────────────────
  const functionCode = Array.from(functions).join('\n');
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

// ── Built-in noise helpers (always available to all nodes) ────────────────
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
// ─────────────────────────────────────────────────────────────────────────

${functionCode}

void main() {
    vec2 g_uv = (vUv - 0.5) * 2.0;
    g_uv.x *= u_resolution.x / u_resolution.y;
${mainCode.join('')}}`.trim();

  return { fragmentShader, nodeOutputVars: nodeOutputs, paramUniforms };
}
