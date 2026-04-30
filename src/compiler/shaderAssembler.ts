import type { GraphNode, DataType, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { topologicalSort } from './topoSort';
import type { LoopPairChain } from './topoSort';
import { defaultGlslVal, patchNodeParamsForUniforms } from './uniformPatcher';
import { computeNodeSlug } from './nodeSlug';

// ── Built-in SDF helper constants ─────────────────────────────────────────────
// These are always added to the functions Set so they are available to any node
// or custom function without needing to re-declare them.  The Set deduplicates
// so even if a node (e.g. SmoothMinNode) previously declared smin via glslFunction
// the exact same string ensures no duplicate body errors in the GLSL output.

export const GLSL_SMIN = `float smin(float a, float b, float k) { float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*h*k*(1./6.); }`;
export const GLSL_SD_BOX = `float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`;
export const GLSL_SD_SEGMENT = `float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}`;
export const GLSL_SD_ELLIPSE = `float sdEllipse(vec2 p, vec2 ab) {
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
}`;
export const GLSL_OP_REPEAT = `vec2 opRepeat(vec2 p, float s) {
    return mod(p + s*0.5, s) - s*0.5;
}`;
export const GLSL_OP_REPEAT_POLAR = `vec2 opRepeatPolar(vec2 p, float n) {
    float angle = TAU / n;
    float a = atan(p.y, p.x) + angle * 0.5;
    a = mod(a, angle) - angle * 0.5;
    return vec2(cos(a), sin(a)) * length(p);
}`;

// Always-available noise and rotation helpers — included in every shader preamble.
// Exported so the Function Builder can import the same block.
export const BUILTIN_HELPERS_GLSL = `vec2 noiseHash2(vec2 p) {
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
vec2 rotate(vec2 v, float angle) {
    return vec2(v.x * cos(angle) - v.y * sin(angle),
                v.x * sin(angle) + v.y * cos(angle));
}
mat2 rot2D(float a) { float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }`;

// ── Runtime output-type helper ────────────────────────────────────────────────

/**
 * Get the actual GLSL output type for a node's output socket.
 * For Expr and CustomFn nodes the output type is stored in `params.outputType`
 * at runtime; their definition hardcodes `float` as a placeholder.
 */
function getNodeOutputType(node: GraphNode, defType: DataType): DataType {
  if (node.type === 'expr' || node.type === 'exprNode' || node.type === 'customFn') {
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
    } else if ((node.type === 'customFn' || node.type === 'exprNode') && typeof node.params[inputKey] === 'number') {
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
    } else if ((bodyNode.type === 'customFn' || bodyNode.type === 'exprNode') && typeof bodyNode.params[k] === 'number') {
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

/** Returns true if `v` is a GLSL variable reference rather than a literal value.
 *  Used to detect when an external variable is embedded in a scene function body
 *  and needs to become a function parameter instead. */
function isGlslVarRef(v: string): boolean {
  if (!v) return false;
  if (/^-?[0-9]/.test(v)) return false;
  if (/^(float|vec[234]|mat[234]|int|ivec[234]|bool|bvec[234]|true|false)\b/.test(v)) return false;
  return true;
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function generateFragmentShader(
  sortedNodes: GraphNode[],
  allNodes: GraphNode[],
  _loopInternalIds: Set<string>,
  loopPairChains: Map<string, LoopPairChain> = new Map(),
): { fragmentShader: string; nodeOutputVars: Map<string, Record<string, string>>; paramUniforms: Record<string, number>; textureUniforms: Record<string, string>; audioUniforms: Record<string, string>; isStateful: boolean; nodeSlugMap: Map<string, string>; mlgDynamicOutputs: Map<string, Record<string, { type: string; label: string }>> } {
  const nodeMap    = new Map(sortedNodes.map(n => [n.id, n]));
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));
  const functions  = new Set<string>();
  // Seed with SDF built-ins so they're always available and deduplicated
  functions.add(GLSL_SMIN);
  functions.add(GLSL_SD_BOX);
  functions.add(GLSL_SD_SEGMENT);
  functions.add(GLSL_SD_ELLIPSE);
  functions.add(GLSL_OP_REPEAT);
  functions.add(GLSL_OP_REPEAT_POLAR);
  const mainCode: string[] = [];
  const paramUniforms: Record<string, number> = {};
  const textureUniforms: Record<string, string> = {};  // uniformName → nodeId
  const audioUniforms: Record<string, string> = {};    // uniformName → nodeId
  const nodeOutputs = new Map<string, Record<string, string>>();
  const mlgDynamicOutputs = new Map<string, Record<string, { type: string; label: string }>>();
  // Tracks extra parameters needed by each compiled scene function (for external var references).
  // Keys are GLSL function names; values are ordered param descriptors to add to the signature.
  const sceneFnExtraParams = new Map<string, Array<{name: string; type: string}>>();

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
    if (node.type === 'prevFrame' || node.type === 'radianceCascadesApprox' ||
        node.type === 'gaussianBlur' || node.type === 'radialBlur' ||
        node.type === 'tiltShiftBlur' || node.type === 'lensBlur' ||
        node.type === 'motionBlur' || node.type === 'depthOfField') {
      isStateful = true;
    }
  }

  const usedSlugs = new Set<string>();
  const nodeSlugMap = new Map<string, string>(); // nodeId → slug

  for (const node of sortedNodes) {
    const def = getNodeDefinition(node.type);
    if (!def) continue;

    // Collect GLSL helper functions (deduplicated)
    if (def.glslFunction) functions.add(def.glslFunction);
    def.glslFunctions?.forEach(f => functions.add(f));
    if ((node.type === 'customFn' || node.type === 'exprNode') && typeof node.params.glslFunctions === 'string') {
      const h = (node.params.glslFunctions as string).trim();
      if (h) functions.add(h);
    }

    const inputVars = resolveInputVars(node, nodeOutputs, nodeMap);

    // Compute slug once per node for all GLSL variable naming (NOT for nodeOutputs keys)
    const nodeSlug = computeNodeSlug(node, usedSlugs);
    nodeSlugMap.set(node.id, nodeSlug);

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

      // Build slug map for ALL subgraph nodes BEFORE building prefixedNodes
      const subSlugMap = new Map<string, string>();
      for (const subNode of subgraph.nodes) {
        subSlugMap.set(subNode.id, computeNodeSlug(subNode, usedSlugs));
      }

      /**
       * Compile one pass of the subgraph using the given port overrides and ID prefix.
       * portInputOverrides keys must use SLUG-based IDs (i.e. `slug:inputKey`).
       * carryModeNaturalVars keys are ORIGINAL node IDs (pre-slug, used to look up subgraph.nodes).
       */
      const compileSubgraphPass = (iterPrefix: string, portInputOverrides: Map<string, string>, carryModeNaturalVars: Map<string, string> = new Map(), exprBlockCarryVars: Map<string, Map<string, string>> = new Map()) => {
        const prefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
          const subSlug = subSlugMap.get(subNode.id)!;
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
            id: iterPrefix + subSlug,
            params: Object.keys(paramOverrides).length > 0 ? { ...subNode.params, ...paramOverrides } : subNode.params,
            inputs: Object.fromEntries(
              Object.entries(subNode.inputs).map(([k, inp]) => [
                k,
                inp.connection
                  ? { ...inp, connection: {
                      nodeId: iterPrefix + (subSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                      outputKey: inp.connection.outputKey,
                    }}
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
            // nestedSlug = slug portion of subNode.id (already slug-based after prefix)
            const nestedSlug = subNode.id.slice(iterPrefix.length);

            // Build inner slug map for the nested group's subgraph nodes
            const innerSlugMap = new Map<string, string>();
            for (const inn of innerSubgraph.nodes) {
              innerSlugMap.set(inn.id, computeNodeSlug(inn, usedSlugs));
            }

            // Resolve the nested group's own input vars from portInputOverrides + nodeOutputs
            const nestedInputVars: Record<string, string> = {};
            for (const [k, inp] of Object.entries(subNode.inputs)) {
              const portKey = `${nestedSlug}:${k}`;
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
            // Build inner port overrides from the nested group's resolved input vars (slug-keyed)
            const innerPortOverrides = new Map<string, string>();
            for (const port of (innerSubgraph.inputPorts ?? [])) {
              const outerVar = nestedInputVars[port.key];
              const mappedToNodeId = innerSlugMap.get(port.toNodeId) ?? port.toNodeId;
              if (outerVar) innerPortOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
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
                const innSlug = innerSlugMap.get(inn.id) ?? inn.id;
                nodeOutputs.set(innerPrefix + innSlug, { i: '0.0' });
              }
            }
            // Build prefixed inner nodes, applying param overrides from two sources:
            // 1-level: subNode.params["inn.id::paramKey"] (inner group's own overrides)
            // 2-level: node.params["nestedOrigId::inn.id::paramKey"] (outer group's surfaced param overrides)
            // nestedOrigId here is the ORIGINAL id of the inner group node (before slugging)
            const nestedOrigId = subgraph.nodes.find(sn => subSlugMap.get(sn.id) === nestedSlug)?.id ?? nestedSlug;
            const innerPrefixedNodes: GraphNode[] = innerSubgraph.nodes.map(inn => {
              const innSlug = innerSlugMap.get(inn.id)!;
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
                id: innerPrefix + innSlug,
                params: Object.keys(innOverrides).length > 0 ? { ...inn.params, ...innOverrides } : inn.params,
                inputs: Object.fromEntries(
                  Object.entries(inn.inputs).map(([k, inp]) => [
                    k,
                    inp.connection
                      ? { ...inp, connection: {
                          nodeId: innerPrefix + (innerSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                          outputKey: inp.connection.outputKey,
                        }}
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
              // innSlugId = slug portion of inn.id (already slug after innerPrefix)
              const innSlugId = inn.id.slice(innerPrefix.length);
              const innInputVars: Record<string, string> = {};
              for (const [k, inp] of Object.entries(inn.inputs)) {
                const portKey = `${innSlugId}:${k}`;
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
            // Map inner group output ports → compiled vars (using slug-based ids)
            const innerGroupOutVars: Record<string, string> = {};
            for (const port of innerSubgraph.outputPorts) {
              const mappedFromId = innerSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
              const fromOut = nodeOutputs.get(innerPrefix + mappedFromId);
              if (fromOut?.[port.fromOutputKey]) innerGroupOutVars[port.key] = fromOut[port.fromOutputKey];
            }
            nodeOutputs.set(subNode.id, innerGroupOutVars);
            continue;
          }

          if (subDef.glslFunction) functions.add(subDef.glslFunction);
          subDef.glslFunctions?.forEach(f => functions.add(f));
          // slugId = the slug portion of subNode.id (after iterPrefix has been stripped)
          const slugId = subNode.id.slice(iterPrefix.length);
          // originalId = the original node id (pre-slug) — needed for carryModeNaturalVars lookup
          const originalId = subgraph.nodes.find(sn => subSlugMap.get(sn.id) === slugId)?.id ?? slugId;
          const subInputVars: Record<string, string> = {};
          for (const [k, inp] of Object.entries(subNode.inputs)) {
            const portKey = `${slugId}:${k}`;
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
          // Inject carry var names for ExprBlock nodes with carry inputs
          const exprCarries = exprBlockCarryVars.get(originalId);
          if (exprCarries) {
            for (const [inputName, carryVarName] of exprCarries) {
              subInputVars[`__carry_${inputName}`] = carryVarName;
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
        const prefix = `${nodeSlug}_g_`;
        const portInputOverrides = new Map<string, string>();
        for (const port of (subgraph.inputPorts ?? [])) {
          const outerVar = inputVars[port.key];
          if (outerVar) {
            const mappedToNodeId = subSlugMap.get(port.toNodeId) ?? port.toNodeId;
            portInputOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
          }
        }
        compileSubgraphPass(prefix, portInputOverrides);
        const groupOutputVars: Record<string, string> = {};
        for (const port of (subgraph.outputPorts ?? [])) {
          const mappedFromNodeId = subSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
          const fromOutputs = nodeOutputs.get(prefix + mappedFromNodeId);
          if (fromOutputs?.[port.fromOutputKey]) groupOutputVars[port.key] = fromOutputs[port.fromOutputKey];
        }
        nodeOutputs.set(node.id, groupOutputVars);
      } else {
        // ── Iterated group: emit a GLSL for loop ──────────────────────────────
        const prefix = `${nodeSlug}_g_`;

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
          const varName = `${nodeSlug}_c${inPort.key}`;
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
            const varName = `${nodeSlug}_out_${port.key}`;
            nonCarryOutVarNames[port.key] = varName;
            // Type will be determined after compilation; use the port's declared type
            mainCode.push(`    ${port.type} ${varName} = ${defaultGlslVal(port.type as DataType)};\n`);
          }
        }

        // Build portInputOverrides early — needed for carry-mode node init resolution below.
        // Keys use SLUG-based ids (matching compileSubgraphPass's slug-keyed lookup).
        const portInputOverrides = new Map<string, string>();
        for (const port of inPorts) {
          const outerVar = carryInKeys.has(port.key)
            ? carryVarNames[port.key]   // carry: use the persistent carry var
            : inputVars[port.key];      // fixed: same outer var every iteration
          if (outerVar) {
            const mappedToNodeId = subSlugMap.get(port.toNodeId) ?? port.toNodeId;
            portInputOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
          }
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

          // Natural output var name matches what generateGLSL will produce inside the loop.
          // The var is named using the SLUG (since generateGLSL sees the slugged node id).
          const snSlug = subSlugMap.get(sn.id) ?? sn.id;
          const naturalVarName = `${prefix}${snSlug}_${firstOutKey}`;
          carryModeNaturalVars.set(sn.id, naturalVarName);

          // Resolve initial value: portInputOverrides takes priority (slug-keyed), then connection
          let initVar = defaultGlslVal(actualOutType);
          const portKey = `${snSlug}:${carryInputKey}`;
          if (portInputOverrides.has(portKey)) {
            initVar = portInputOverrides.get(portKey)!;
          } else {
            const conn = sn.inputs[carryInputKey]?.connection;
            if (conn) {
              const connSlug = subSlugMap.get(conn.nodeId) ?? conn.nodeId;
              const srcOut = nodeOutputs.get(conn.nodeId)?.[conn.outputKey]
                          ?? nodeOutputs.get(prefix + connSlug)?.[conn.outputKey];
              if (srcOut) initVar = srcOut;
            }
          }

          // Forward-declare without init (T d;), then assign (d = init;)
          // This lets us reuse the same variable name inside the loop without re-declaring.
          mainCode.push(`    ${actualOutType} ${naturalVarName};\n`);
          mainCode.push(`    ${naturalVarName} = ${initVar};\n`);
          // Feed the carry var as the carry input so the node uses it each iteration (slug-keyed)
          portInputOverrides.set(portKey, naturalVarName);
          void firstOutKey;
        }

        // 1e. Declare outer accumulator vars for nodes with assignOp != '='
        //     These nodes' outputs persist across iterations and accumulate.
        //     Carry-mode nodes are excluded: their assignOp is already applied directly
        //     to the carry assignment inside the loop (handled in compileSubgraphPass above).
        const accumNodeVarNames: Record<string, Record<string, string>> = {};  // origNodeId → { outKey → outerVarName }
        for (const sn of subgraph.nodes) {
          const op = sn.assignOp;
          if (!op || op === '=') continue;
          if (sn.carryMode) continue;  // carry-mode nodes handle assignOp via the carry mechanism
          const def = getNodeDefinition(sn.type);
          if (!def) continue;
          // Neutral initializer: 0 for +/-, 1 for *//
          const isMultiply = op === '*=' || op === '/=';
          const snSlugAcc = subSlugMap.get(sn.id) ?? sn.id;
          const outVars: Record<string, string> = {};
          for (const [outKey, outSock] of Object.entries(def.outputs)) {
            // Use the actual runtime type (Expr/CustomFn store it in params.outputType)
            const actualType = getNodeOutputType(sn, outSock.type);
            const varName = `${nodeSlug}_ao_${snSlugAcc}_${outKey}`;
            outVars[outKey] = varName;
            const neutral = isMultiply ? `${actualType}(1.0)` : defaultGlslVal(actualType);
            const initExpr = sn.assignInit?.trim() || neutral;
            mainCode.push(`    ${actualType} ${varName} = ${initExpr};\n`);
          }
          accumNodeVarNames[sn.id] = outVars;
        }

        // 2. Open the for loop
        const loopVar = `${nodeSlug}_i`;
        mainCode.push(`    for (float ${loopVar} = 0.0; ${loopVar} < ${iters}.0; ${loopVar}++) {\n`);

        // Pre-inject loop index for any loopIndex nodes in the subgraph
        for (const sn of subgraph.nodes) {
          if (sn.type === 'loopIndex') {
            const snSlugLoop = subSlugMap.get(sn.id) ?? sn.id;
            nodeOutputs.set(prefix + snSlugLoop, { i: loopVar });
          }
        }

        // Pre-inject LoopCarry nodes — declare carry vars outside loop, inject current value
        const loopCarryNodes = subgraph.nodes.filter(sn => sn.type === 'loopCarry');
        const loopCarryVarNames: Record<string, string> = {};
        for (const sn of loopCarryNodes) {
          const carryType = (sn.params.dataType as string | undefined) ?? (sn.outputs.value?.type ?? 'vec2');
          const snSlugLc = subSlugMap.get(sn.id) ?? sn.id;
          const carryVarName = `${nodeSlug}_lc_${snSlugLc}`;
          loopCarryVarNames[sn.id] = carryVarName;

          // Resolve init value: check portInputOverrides for `init` input (slug-keyed), then connection
          let initVar = defaultGlslVal(carryType as import('../types/nodeGraph').DataType);
          const initConn = sn.inputs['init']?.connection;
          if (initConn) {
            // init connected to another inner node already processed before loop
            const initConnSlug = subSlugMap.get(initConn.nodeId) ?? initConn.nodeId;
            const srcOut = nodeOutputs.get(prefix + initConnSlug)?.[initConn.outputKey];
            if (srcOut) initVar = srcOut;
            // Also check portInputOverrides for this source node (slug-keyed)
            const overrideKey = `${initConnSlug}:${initConn.outputKey}`;
            if (portInputOverrides.has(overrideKey)) initVar = portInputOverrides.get(overrideKey)!;
          }
          // Check if portInputOverrides maps directly to this node's init input (slug-keyed)
          const directKey = `${snSlugLc}:init`;
          if (portInputOverrides.has(directKey)) initVar = portInputOverrides.get(directKey)!;

          mainCode.push(`    ${carryType} ${carryVarName} = ${initVar};\n`);
          // Pre-inject so compileSubgraphPass sees this node as already done
          nodeOutputs.set(prefix + snSlugLc, { value: carryVarName });
        }

        // 2d. Pre-loop carry declarations for ExprBlock nodes with carry inputs.
        //     For each carry input: forward-declare outside the loop, resolve init from
        //     `${name}_init` connection (or `${name}` connection, or type zero fallback).
        //     The carry var name is injected into subInputVars via exprBlockCarryVars.
        const exprBlockCarryVars = new Map<string, Map<string, string>>();
        for (const sn of subgraph.nodes) {
          if (sn.type !== 'exprNode') continue;
          const dynInputs = sn.params.inputs as Array<{ name: string; type: string; carry?: boolean }> | undefined;
          if (!Array.isArray(dynInputs)) continue;
          const carryInputs = dynInputs.filter(inp => inp.carry);
          if (carryInputs.length === 0) continue;

          const snSlug = subSlugMap.get(sn.id) ?? sn.id;
          const nodeCarryVars = new Map<string, string>();

          for (const inp of carryInputs) {
            const carryVarName = `${nodeSlug}_ec_${snSlug}_${inp.name}`;
            nodeCarryVars.set(inp.name, carryVarName);

            // Priority: _init connection > regular connection > portInputOverrides > type zero
            let initVar = defaultGlslVal(inp.type);

            const initConn = sn.inputs[`${inp.name}_init`]?.connection;
            if (initConn) {
              const initSlug = subSlugMap.get(initConn.nodeId) ?? initConn.nodeId;
              const srcOut = nodeOutputs.get(prefix + initSlug)?.[initConn.outputKey]
                          ?? nodeOutputs.get(initConn.nodeId)?.[initConn.outputKey];
              if (srcOut) initVar = srcOut;
            }
            if (initVar === defaultGlslVal(inp.type)) {
              const conn = sn.inputs[inp.name]?.connection;
              if (conn) {
                const connSlug = subSlugMap.get(conn.nodeId) ?? conn.nodeId;
                const srcOut = nodeOutputs.get(prefix + connSlug)?.[conn.outputKey]
                            ?? nodeOutputs.get(conn.nodeId)?.[conn.outputKey];
                if (srcOut) initVar = srcOut;
              }
            }
            const poKeyInit = `${snSlug}:${inp.name}_init`;
            if (portInputOverrides.has(poKeyInit)) initVar = portInputOverrides.get(poKeyInit)!;
            else {
              const poKey = `${snSlug}:${inp.name}`;
              if (initVar === defaultGlslVal(inp.type) && portInputOverrides.has(poKey)) {
                initVar = portInputOverrides.get(poKey)!;
              }
            }

            mainCode.push(`    ${inp.type} ${carryVarName} = ${initVar};\n`);
          }

          exprBlockCarryVars.set(sn.id, nodeCarryVars);
        }

        // 3. Compile subgraph body.
        //    carryModeNaturalVars tells the pass to strip the type from carry-mode node output
        //    declarations, producing `d = f(d);` instead of `T d = f(d);` inside the loop.
        compileSubgraphPass(prefix, portInputOverrides, carryModeNaturalVars, exprBlockCarryVars);

        // 3b. Update LoopCarry vars from their `next` inputs (end of iteration)
        for (const sn of loopCarryNodes) {
          const nextConn = sn.inputs['next']?.connection;
          if (nextConn) {
            const nextConnSlug = subSlugMap.get(nextConn.nodeId) ?? nextConn.nodeId;
            const nextVar = nodeOutputs.get(prefix + nextConnSlug)?.[nextConn.outputKey];
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
          const snSlugAcc2 = subSlugMap.get(sn.id) ?? sn.id;
          const freshOutputs = nodeOutputs.get(prefix + snSlugAcc2);
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
          nodeOutputs.set(prefix + snSlugAcc2, updatedOutputs);
        }

        // 4. Update carry vars from this iteration's outputs (inside the loop)
        for (const { inPort, outPort } of carryPairs) {
          const mappedFromNodeId = subSlugMap.get(outPort.fromNodeId) ?? outPort.fromNodeId;
          const fromOutputs = nodeOutputs.get(prefix + mappedFromNodeId);
          if (fromOutputs?.[outPort.fromOutputKey]) {
            mainCode.push(`    ${carryVarNames[inPort.key]} = ${fromOutputs[outPort.fromOutputKey]};\n`);
          }
        }

        // 4b. Copy non-carry output vars to their outer counterparts (before closing brace)
        for (const port of outPorts) {
          if (!carryOutKeys.has(port.key)) {
            const mappedFromNodeId = subSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
            const fromOutputs = nodeOutputs.get(prefix + mappedFromNodeId);
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

      // nodeSlug was computed at top of this node's iteration
      const fnName = `mapScene_${nodeSlug}`;
      const sgPrefix = `${nodeSlug}_sg_`;
      const sceneFnLines: string[] = [];

      // Build slug map for ALL sceneGroup subgraph nodes BEFORE pre-registration
      const sgSubSlugMap = new Map<string, string>();
      for (const sn of subgraph.nodes) {
        sgSubSlugMap.set(sn.id, computeNodeSlug(sn, usedSlugs));
      }

      // Pre-register ScenePosNode outputs so they resolve to 'p' (the fn parameter)
      for (const sn of subgraph.nodes) {
        if (sn.type === 'scenePos') {
          const spSlug = sgSubSlugMap.get(sn.id) ?? sn.id;
          nodeOutputs.set(sgPrefix + spSlug, { pos: 'p' });
        }
      }

      // Apply port input overrides from the sceneGroup's own outer inputs (slug-keyed)
      const sgPortOverrides = new Map<string, string>();
      for (const port of (subgraph.inputPorts ?? [])) {
        const outerVar = inputVars[port.key];
        if (outerVar) {
          const mappedToNodeId = sgSubSlugMap.get(port.toNodeId) ?? port.toNodeId;
          sgPortOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
        }
      }

      // Collect external variable references that will be embedded in the scene function body.
      // These come from main()-scope variables wired into ps_ param overrides or input ports.
      // They must become extra function parameters so the preamble function can access them.
      const sgExternalVarMap = new Map<string, string>(); // GLSL var name → GLSL type
      for (const port of (subgraph.inputPorts ?? [])) {
        const outerVar = inputVars[port.key];
        if (outerVar && isGlslVarRef(outerVar)) sgExternalVarMap.set(outerVar, port.type);
      }
      for (const subNode of subgraph.nodes) {
        const snDefScan = getNodeDefinition(subNode.type);
        if (snDefScan?.paramDefs) {
          for (const paramKey of Object.keys(snDefScan.paramDefs)) {
            const psKey = `ps_${subNode.id}_${paramKey}`;
            const externalVar = inputVars[psKey];
            if (externalVar && isGlslVarRef(externalVar) && !sgExternalVarMap.has(externalVar)) {
              sgExternalVarMap.set(externalVar, 'float');
            }
          }
        }
      }
      const sgExtraParams = Array.from(sgExternalVarMap.entries()).map(([name, type]) => ({ name, type }));

      // Prefix all subgraph node IDs + connections using slug-based ids
      const sgPrefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
        const subSlug = sgSubSlugMap.get(subNode.id)!;
        // Collect param overrides stored on the outer sceneGroup node as "innerNodeId::paramKey"
        const overridePrefix = `${subNode.id}::`;
        const paramOverrides: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.params)) {
          if (key.startsWith(overridePrefix)) {
            paramOverrides[key.slice(overridePrefix.length)] = val;
          }
        }
        // ps_ external socket connections: wire GLSL vars into inner node params
        // e.g. outer input key "ps_hd_tr_ty" → innerNodeId="hd_tr", paramKey="ty"
        const snDef = getNodeDefinition(subNode.type);
        if (snDef?.paramDefs) {
          for (const paramKey of Object.keys(snDef.paramDefs)) {
            const psKey = `ps_${subNode.id}_${paramKey}`;
            const externalVar = inputVars[psKey];
            if (externalVar) paramOverrides[paramKey] = externalVar;
          }
        }

        return {
          ...subNode,
          id: sgPrefix + subSlug,
          params: { ...subNode.params, ...paramOverrides },
          inputs: Object.fromEntries(
            Object.entries(subNode.inputs).map(([k, inp]) => [
              k,
              inp.connection
                ? { ...inp, connection: {
                    nodeId: sgPrefix + (sgSubSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                    outputKey: inp.connection.outputKey,
                  }}
                : inp,
            ]),
          ),
        };
      });

      const sgSorted = topologicalSort(sgPrefixedNodes);
      let sgLastFloatVar = '100.0';  // default return value (large dist = miss)

      for (const sn of sgSorted) {
        if (nodeOutputs.has(sn.id)) continue;  // scenePos already registered

        // ── Inline regular group nodes inside the scene function ──────────────
        if (sn.type === 'group') {
          const grpSubgraph = sn.params.subgraph as SubgraphData | undefined;
          if (!grpSubgraph || grpSubgraph.nodes.length === 0) { nodeOutputs.set(sn.id, {}); continue; }
          const grpSlugMap = new Map<string, string>();
          for (const gn of grpSubgraph.nodes) grpSlugMap.set(gn.id, computeNodeSlug(gn, usedSlugs));
          const grpPrefix = `${sn.id}_g_`;
          const grpPortOverrides = new Map<string, string>();
          for (const port of (grpSubgraph.inputPorts ?? [])) {
            const portInp = sn.inputs[port.key];
            let srcVar: string | undefined;
            if (portInp?.connection) srcVar = nodeOutputs.get(portInp.connection.nodeId)?.[portInp.connection.outputKey];
            if (!srcVar) srcVar = sgPortOverrides.get(`${sn.id.slice(sgPrefix.length)}:${port.key}`);
            if (srcVar) grpPortOverrides.set(`${grpSlugMap.get(port.toNodeId) ?? port.toNodeId}:${port.toInputKey}`, srcVar);
          }
          const grpPrefixed: GraphNode[] = grpSubgraph.nodes.map(gn => {
            // Apply slider overrides stored as 'innerNodeId::paramKey' on the group node's params
            const overridePrefix = `${gn.id}::`;
            const paramOverrides: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(sn.params)) {
              if (typeof key === 'string' && key.startsWith(overridePrefix)) {
                paramOverrides[key.slice(overridePrefix.length)] = val;
              }
            }
            // Apply ps_ socket connections as GLSL var overrides (automation)
            const gnDefForOverrides = getNodeDefinition(gn.type);
            if (gnDefForOverrides?.paramDefs) {
              for (const paramKey of Object.keys(gnDefForOverrides.paramDefs)) {
                const psKey = `ps_${gn.id}_${paramKey}`;
                const psInp = sn.inputs[psKey];
                if (psInp?.connection) {
                  const srcVar = nodeOutputs.get(psInp.connection.nodeId)?.[psInp.connection.outputKey];
                  if (srcVar) paramOverrides[paramKey] = srcVar;
                }
              }
            }
            return {
              ...gn,
              id: grpPrefix + grpSlugMap.get(gn.id)!,
              params: Object.keys(paramOverrides).length > 0 ? { ...gn.params, ...paramOverrides } : gn.params,
              inputs: Object.fromEntries(Object.entries(gn.inputs).map(([k, inp]) => [k, inp.connection
                ? { ...inp, connection: { nodeId: grpPrefix + (grpSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId), outputKey: inp.connection.outputKey } }
                : inp])),
            };
          });
          for (const gn of topologicalSort(grpPrefixed)) {
            if (nodeOutputs.has(gn.id)) continue;
            const gDef = getNodeDefinition(gn.type);
            if (!gDef) continue;
            if (gDef.glslFunction) functions.add(gDef.glslFunction);
            gDef.glslFunctions?.forEach(h => functions.add(h));
            const gnOrigId = gn.id.slice(grpPrefix.length);
            const gnInputVars: Record<string, string> = {};
            for (const [k, inp] of Object.entries(gn.inputs)) {
              const portKey = `${gnOrigId}:${k}`;
              if (grpPortOverrides.has(portKey)) gnInputVars[k] = grpPortOverrides.get(portKey)!;
              else if (inp.connection) { const s = nodeOutputs.get(inp.connection.nodeId); if (s?.[inp.connection.outputKey]) gnInputVars[k] = s[inp.connection.outputKey]; }
              if (!gnInputVars[k]) {
                // Skip defaultValue for param-backed sockets — generateGLSL reads node.params directly
                const isParamBacked = !!gDef.paramDefs?.[k];
                if (!isParamBacked && inp.defaultValue !== undefined) {
                  if (typeof inp.defaultValue === 'number') gnInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                  else if (Array.isArray(inp.defaultValue)) gnInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                } else if (inp.type === 'float' && (k === 'time' || k === 't')) gnInputVars[k] = 'u_time';
              }
            }
            const gnResult = gDef.generateGLSL(gn, gnInputVars);
            sceneFnLines.push(gnResult.code);
            nodeOutputs.set(gn.id, gnResult.outputVars);
            for (const [outKey, varName] of Object.entries(gnResult.outputVars)) {
              if (gDef.outputs[outKey]?.type === 'float') sgLastFloatVar = varName;
            }
          }
          const grpOutVars: Record<string, string> = {};
          for (const port of (grpSubgraph.outputPorts ?? [])) {
            const s = nodeOutputs.get(grpPrefix + (grpSlugMap.get(port.fromNodeId) ?? port.fromNodeId));
            if (s?.[port.fromOutputKey]) {
              grpOutVars[port.key] = s[port.fromOutputKey];
              if (port.type === 'float') sgLastFloatVar = s[port.fromOutputKey];
            }
          }
          nodeOutputs.set(sn.id, grpOutVars);
          continue;
        }

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
          // Fallbacks — skip defaultValue for param-backed sockets (generateGLSL reads node.params)
          if (!snInputVars[k]) {
            if (!snDef.paramDefs?.[k] && inp.defaultValue !== undefined) {
              if (typeof inp.defaultValue === 'number') snInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
              else if (Array.isArray(inp.defaultValue)) snInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
            }
          }
        }

        let effectiveSn = sn;
        for (const [k, v] of Object.entries(snInputVars)) {
          if (k.startsWith('__param_') && v) {
            const paramKey = k.slice('__param_'.length);
            effectiveSn = { ...effectiveSn, params: { ...effectiveSn.params, [paramKey]: v } };
          }
        }
        const snResult = snDef.generateGLSL(effectiveSn, snInputVars);
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
          const mappedFromNodeId = sgSubSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
          const srcOut = nodeOutputs.get(sgPrefix + mappedFromNodeId);
          if (srcOut?.[port.fromOutputKey]) sgLastFloatVar = srcOut[port.fromOutputKey];
        }
      }

      // Emit the GLSL function — with extra params for any external variable references
      const fnBody = sceneFnLines.join('');
      const sgExtraDecls = sgExtraParams.map(v => `${v.type} ${v.name}`).join(', ');
      const fnDef = `float ${fnName}(vec3 p${sgExtraDecls ? ', ' + sgExtraDecls : ''}) {\n${fnBody}    return ${sgLastFloatVar};\n}`;
      functions.add(fnDef);
      if (sgExtraParams.length > 0) sceneFnExtraParams.set(fnName, sgExtraParams);

      nodeOutputs.set(node.id, { scene: fnName });
      continue;
    }

    // ── March Loop Group: compile subgraph as a position-warp helper + march loop ─
    if (node.type === 'marchLoopGroup') {
      const subgraph = node.params.subgraph as SubgraphData | undefined;

      // Resolve external inputs
      const mlRo  = inputVars.ro || 'vec3(0.0, 0.0, 3.0)';
      const mlRd  = inputVars.rd || 'vec3(0.0, 0.0, -1.0)';
      const mlMaxSteps = Math.max(16, Math.min(256, Number(node.params.maxSteps) || 80));
      // Local float param formatter (mirrors p() from helpers.ts)
      const fmtP = (val: unknown, fb: number): string => {
        if (typeof val === 'string') return val;
        const n = typeof val === 'number' ? val : fb;
        return Number.isInteger(n) ? `${n}.0` : String(n);
      };
      const mlMaxDist    = fmtP(node.params.maxDist,  20.0);
      const mlStepScale  = fmtP(node.params.stepScale,  1.0);
      const mlVolumetric = !!node.params.volumetric;
      const mlPassthrough = fmtP(node.params.passthrough, 0.1);
      const mlJitter     = fmtP(node.params.jitter, 0.0);
      const bgr  = fmtP(node.params.bgR,      0.0);
      const bgg  = fmtP(node.params.bgG,      0.0);
      const bgb  = fmtP(node.params.bgB,      0.0);
      const albr = fmtP(node.params.albedoR,  0.6);
      const albg = fmtP(node.params.albedoG,  0.7);
      const albb = fmtP(node.params.albedoB,  0.9);

      // Determine if subgraph uses new-style anchor (marchLoopInputs) vs legacy separate nodes
      const mlInputsNodeRaw = subgraph?.nodes.find(n => n.type === 'marchLoopInputs') ?? null;
      const mlHasNewStyle = !!mlInputsNodeRaw;
      const mlExtraInputs: Array<{key: string; type: string}> = mlHasNewStyle
        ? ((mlInputsNodeRaw!.params.extraInputs ?? []) as Array<{key: string; type: string}>)
        : [];

      // ── Compile subgraph as a warp body function ────────────────────────────
      // The function signature is:
      //   vec3 marchBody_<slug>(vec3 <slug>_mp, float <slug>_bt)
      // MarchPos nodes pre-register their `pos` output as `<slug>_mp`.
      // MarchDist nodes pre-register their `dist` (and `t`) output as `<slug>_bt`.
      // SceneGroup nodes found in the body are compiled inline → sceneFnName.
      // The warp body function returns the last vec3 before SceneGroup.
      let warpBodyFn = '';  // empty = identity (no body function emitted)
      // sceneFnName: set from SceneGroup inside body, or fall back to inputVars.scene
      let sceneFnName = '';
      // Extra params needed by marchBody_* for main()-scope vars referenced inside
      let mlBodyExtraParams: Array<{name: string; type: string}> = [];
      // Inout accumulator vars for body nodes with assignOp != '=' (declared outside if block for scope)
      let mlBodyAccumulators: Array<{ varName: string; type: string; initExpr: string; label: string }> = [];

      if (subgraph && subgraph.nodes.length > 0) {
        const warpFnName = `marchBody_${nodeSlug}`;
        const mlPrefix   = `${nodeSlug}_ml_`;
        const bodyLines: string[] = [];

        // Build slug map for all subgraph nodes
        const mlSubSlugMap = new Map<string, string>();
        for (const sn of subgraph.nodes) {
          mlSubSlugMap.set(sn.id, computeNodeSlug(sn, usedSlugs));
        }

        // Pre-register marchPos outputs as the function's position parameter
        // Pre-register marchDist outputs as the function's distance parameter
        // (both 'dist' and 't' keys for backward compatibility)
        for (const sn of subgraph.nodes) {
          if (sn.type === 'marchPos') {
            const slug = mlSubSlugMap.get(sn.id) ?? sn.id;
            nodeOutputs.set(mlPrefix + slug, { pos: `${nodeSlug}_mp` });
          }
          if (sn.type === 'marchDist') {
            const slug = mlSubSlugMap.get(sn.id) ?? sn.id;
            nodeOutputs.set(mlPrefix + slug, { dist: `${nodeSlug}_bt`, t: `${nodeSlug}_bt` });
          }
          if (sn.type === 'marchLoopInputs') {
            const slug = mlSubSlugMap.get(sn.id) ?? sn.id;
            const extraVarMap: Record<string, string> = {};
            for (const ex of mlExtraInputs) {
              extraVarMap[ex.key] = `${nodeSlug}_ex_${ex.key}`;
            }
            nodeOutputs.set(mlPrefix + slug, {
              ro:        `${nodeSlug}_ro`,
              rd:        `${nodeSlug}_rd`,
              marchPos:  `${nodeSlug}_mp`,
              marchDist: `${nodeSlug}_bt`,
              ...extraVarMap,
            });
          }
        }

        // Port input overrides from the outer node's inputs (slug-keyed)
        const mlPortOverrides = new Map<string, string>();
        for (const port of (subgraph.inputPorts ?? [])) {
          const outerVar = inputVars[port.key];
          if (outerVar) {
            const mappedToNodeId = mlSubSlugMap.get(port.toNodeId) ?? port.toNodeId;
            mlPortOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
          }
        }

        // Collect main()-scope var refs that will be embedded in the body function.
        // These must be passed as extra parameters so the preamble function can access them.
        const mlBodyExternalVarMap = new Map<string, string>(); // varName → GLSL type
        for (const v of mlPortOverrides.values()) {
          if (isGlslVarRef(v) && !v.startsWith('u_')) {
            if (!mlBodyExternalVarMap.has(v)) mlBodyExternalVarMap.set(v, 'float');
          }
        }
        for (const subNode of subgraph.nodes) {
          const snDefScan = getNodeDefinition(subNode.type);
          if (snDefScan?.paramDefs) {
            for (const paramKey of Object.keys(snDefScan.paramDefs)) {
              const psKey = `ps_${subNode.id}_${paramKey}`;
              const extVar = inputVars[psKey];
              if (extVar && isGlslVarRef(extVar) && !extVar.startsWith('u_') && !mlBodyExternalVarMap.has(extVar))
                mlBodyExternalVarMap.set(extVar, 'float');
            }
          }
        }
        mlBodyExtraParams = Array.from(mlBodyExternalVarMap.entries()).map(([name, type]) => ({ name, type }));

        // Prefix all subgraph node IDs + connections using slug-based ids
        const mlPrefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
          const subSlug = mlSubSlugMap.get(subNode.id)!;
          const overridePrefix = `${subNode.id}::`;
          const paramOverrides: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(node.params)) {
            if (key.startsWith(overridePrefix)) {
              paramOverrides[key.slice(overridePrefix.length)] = val;
            }
          }
          const snDef = getNodeDefinition(subNode.type);
          if (snDef?.paramDefs) {
            for (const paramKey of Object.keys(snDef.paramDefs)) {
              const psKey = `ps_${subNode.id}_${paramKey}`;
              const externalVar = inputVars[psKey];
              if (externalVar) paramOverrides[paramKey] = externalVar;
            }
          }
          return {
            ...subNode,
            id: mlPrefix + subSlug,
            params: { ...subNode.params, ...paramOverrides },
            inputs: Object.fromEntries(
              Object.entries(subNode.inputs).map(([k, inp]) => [
                k,
                inp.connection
                  ? { ...inp, connection: {
                      nodeId: mlPrefix + (mlSubSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                      outputKey: inp.connection.outputKey,
                    }}
                  : inp,
              ]),
            ),
          };
        });

        // Pre-scan: accumulator nodes (assignOp != '=') in the body need inout params
        for (const sn of subgraph.nodes) {
          const op = sn.assignOp;
          if (!op || op === '=') continue;
          const snDefAcc = getNodeDefinition(sn.type);
          if (!snDefAcc) continue;
          const snSlugAcc = mlSubSlugMap.get(sn.id) ?? sn.id;
          const isMultiplyAcc = op === '*=' || op === '/=';
          for (const [outKey, outSock] of Object.entries(snDefAcc.outputs)) {
            if (outSock.type !== 'float') continue;
            const accVar = `${nodeSlug}_mlgacc_${snSlugAcc}_${outKey}`;
            const neutral = isMultiplyAcc ? '1.0' : '0.0';
            const initExpr = sn.assignInit?.trim() || neutral;
            mlBodyAccumulators.push({ varName: accVar, type: 'float', initExpr, label: outSock.label });
          }
        }
        // Also pre-scan accumulator nodes nested inside group nodes within the MLG body.
        // Uses raw node IDs (not slugs) to avoid slug collision with the later processing pass.
        for (const outerGrpSn of subgraph.nodes) {
          if (outerGrpSn.type !== 'group') continue;
          const outerSlugForAcc = mlSubSlugMap.get(outerGrpSn.id) ?? outerGrpSn.id;
          const innerSg = outerGrpSn.params?.subgraph as SubgraphData | undefined;
          if (!innerSg) continue;
          for (const innerGn of innerSg.nodes) {
            const op = innerGn.assignOp;
            if (!op || op === '=') continue;
            const innerDef = getNodeDefinition(innerGn.type);
            if (!innerDef) continue;
            const isMultiplyAcc = op === '*=' || op === '/=';
            const safeInnerNodeId = innerGn.id.replace(/[^a-zA-Z0-9]/g, '');
            for (const [outKey, outSock] of Object.entries(innerDef.outputs)) {
              if (outSock.type !== 'float') continue;
              const accVar = `${nodeSlug}_mlgacc_${outerSlugForAcc}_ng_${safeInnerNodeId}_${outKey}`;
              const neutral = isMultiplyAcc ? '1.0' : '0.0';
              const initExpr = innerGn.assignInit?.trim() || neutral;
              mlBodyAccumulators.push({ varName: accVar, type: 'float', initExpr, label: outSock.label });
            }
          }
        }

        const mlSorted = topologicalSort(mlPrefixedNodes);
        // Ensure sceneGroup is processed before marchSceneDist (needs sceneFnName set first)
        const mlProcessOrder = [
          ...mlSorted.filter(sn => sn.type === 'sceneGroup'),
          ...mlSorted.filter(sn => sn.type !== 'sceneGroup'),
        ];
        // Default return value: identity warp (march pos unchanged)
        let mlLastVec3Var = `${nodeSlug}_mp`;

        for (const sn of mlProcessOrder) {
          if (nodeOutputs.has(sn.id)) continue;  // marchPos/marchDist already pre-registered
          const snDef = getNodeDefinition(sn.type);
          if (!snDef) continue;

          // ── Time / Mouse passthrough inside body ──────────────────────────
          if (sn.type === 'time') {
            nodeOutputs.set(sn.id, { time: 'u_time' });
            continue;
          }
          if (sn.type === 'mousePos' || sn.type === 'mouse') {
            // Emit normalized mouse (same space as UV node) into body function.
            // Exposes .x and .y so Mouse node outputs work inside MLG body.
            const mId = sn.id;
            bodyLines.push(`    vec2 ${mId}_uv = (u_mouse / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0;\n`);
            bodyLines.push(`    float ${mId}_x = ${mId}_uv.x;\n`);
            bodyLines.push(`    float ${mId}_y = ${mId}_uv.y;\n`);
            nodeOutputs.set(sn.id, { mouse: `${mId}_uv`, xy: `${mId}_uv`, x: `${mId}_x`, y: `${mId}_y` });
            continue;
          }

          // ── SceneGroup inside body: compile inline as mapScene function ────
          if (sn.type === 'sceneGroup') {
            const sgSubgraph = sn.params.subgraph as SubgraphData | undefined;
            if (sgSubgraph && sgSubgraph.nodes.length > 0) {
              // Slug for THIS sceneGroup node (slug portion after mlPrefix)
              const sgSlugInBody = sn.id.slice(mlPrefix.length);
              const sceneFnNameLocal = `mapScene_${sgSlugInBody}`;
              const sgInnerPrefix = `${sgSlugInBody}_sg_`;

              // Build slug map for inner SceneGroup subgraph nodes
              const sgInnerSlugMap = new Map<string, string>();
              for (const inn of sgSubgraph.nodes) {
                sgInnerSlugMap.set(inn.id, computeNodeSlug(inn, usedSlugs));
              }

              // Pre-register ScenePosNode outputs as 'p' (the function parameter)
              for (const inn of sgSubgraph.nodes) {
                if (inn.type === 'scenePos') {
                  const spSlug = sgInnerSlugMap.get(inn.id) ?? inn.id;
                  nodeOutputs.set(sgInnerPrefix + spSlug, { pos: 'p' });
                }
              }

              // Resolve this scene group node's own inputs from the MLG body context
              const sgOuterInputVarsInline: Record<string, string> = {};
              for (const [k, inp] of Object.entries(sn.inputs)) {
                if (inp.connection) {
                  const srcOut = nodeOutputs.get(inp.connection.nodeId);
                  if (srcOut?.[inp.connection.outputKey]) sgOuterInputVarsInline[k] = srcOut[inp.connection.outputKey];
                }
              }

              // Build port overrides from scene group's inputPorts (wired from MLG body)
              const sgPortOverridesInline = new Map<string, string>();
              for (const port of (sgSubgraph.inputPorts ?? [])) {
                const outerVar = sgOuterInputVarsInline[port.key];
                if (outerVar) {
                  const mappedToNodeId = sgInnerSlugMap.get(port.toNodeId) ?? port.toNodeId;
                  sgPortOverridesInline.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
                }
              }

              // Collect external var references (main()-scope vars embedded in the scene fn body)
              const sgInlineExternalVarMap = new Map<string, string>();
              for (const [, val] of sgPortOverridesInline) {
                if (isGlslVarRef(val)) sgInlineExternalVarMap.set(val, 'float');
              }
              for (const inn of sgSubgraph.nodes) {
                const innDefScan = getNodeDefinition(inn.type);
                if (innDefScan?.paramDefs) {
                  for (const paramKey of Object.keys(innDefScan.paramDefs)) {
                    const overrideKey = `${inn.id}::${paramKey}`;
                    const overrideVal = sn.params[overrideKey];
                    if (typeof overrideVal === 'string' && isGlslVarRef(overrideVal) && !sgInlineExternalVarMap.has(overrideVal)) {
                      sgInlineExternalVarMap.set(overrideVal, 'float');
                    }
                  }
                }
              }
              const sgInlineExtraParams = Array.from(sgInlineExternalVarMap.entries()).map(([name, type]) => ({ name, type }));

              // Build prefixed inner nodes
              const sgInnerPrefixedNodes: GraphNode[] = sgSubgraph.nodes.map(inn => {
                const innSlug = sgInnerSlugMap.get(inn.id)!;
                const overridePrefix2 = `${inn.id}::`;
                const innerParamOverrides: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(sn.params)) {
                  if (typeof k === 'string' && k.startsWith(overridePrefix2)) {
                    innerParamOverrides[k.slice(overridePrefix2.length)] = v;
                  }
                }
                // ps_ external socket connections from the outer MLG inputVars
                const innDefPs = getNodeDefinition(inn.type);
                if (innDefPs?.paramDefs) {
                  for (const paramKey of Object.keys(innDefPs.paramDefs)) {
                    const psKey = `ps_${inn.id}_${paramKey}`;
                    const extVar = inputVars[psKey];
                    if (extVar) {
                      innerParamOverrides[paramKey] = extVar;
                      if (isGlslVarRef(extVar) && !sgInlineExternalVarMap.has(extVar)) {
                        sgInlineExternalVarMap.set(extVar, 'float');
                        sgInlineExtraParams.push({ name: extVar, type: 'float' });
                      }
                    }
                  }
                }
                return {
                  ...inn,
                  id: sgInnerPrefix + innSlug,
                  params: Object.keys(innerParamOverrides).length > 0
                    ? { ...inn.params, ...innerParamOverrides }
                    : inn.params,
                  inputs: Object.fromEntries(
                    Object.entries(inn.inputs).map(([k, inp]) => [
                      k,
                      inp.connection
                        ? { ...inp, connection: {
                            nodeId: sgInnerPrefix + (sgInnerSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                            outputKey: inp.connection.outputKey,
                          }}
                        : inp,
                    ]),
                  ),
                };
              });

              const sgInnerSorted = topologicalSort(sgInnerPrefixedNodes);
              let sgLastFloatVar = '100.0';
              const sceneFnLines: string[] = [];

              for (const sgn of sgInnerSorted) {
                if (nodeOutputs.has(sgn.id)) continue; // scenePos already registered

                // Inline nested group nodes inside the scene function
                if (sgn.type === 'group') {
                  const igrpSub = sgn.params.subgraph as SubgraphData | undefined;
                  if (!igrpSub || igrpSub.nodes.length === 0) { nodeOutputs.set(sgn.id, {}); continue; }
                  const igrpSlugMap = new Map<string, string>();
                  for (const gn of igrpSub.nodes) igrpSlugMap.set(gn.id, computeNodeSlug(gn, usedSlugs));
                  const igrpPrefix = `${sgn.id}_g_`;
                  const igrpPortOverrides = new Map<string, string>();
                  for (const port of (igrpSub.inputPorts ?? [])) {
                    const portInp = sgn.inputs[port.key];
                    let srcVar: string | undefined;
                    if (portInp?.connection) srcVar = nodeOutputs.get(portInp.connection.nodeId)?.[portInp.connection.outputKey];
                    if (!srcVar) srcVar = sgPortOverridesInline.get(`${sgn.id.slice(sgInnerPrefix.length)}:${port.key}`);
                    if (srcVar) igrpPortOverrides.set(`${igrpSlugMap.get(port.toNodeId) ?? port.toNodeId}:${port.toInputKey}`, srcVar);
                  }
                  const igrpPrefixed: GraphNode[] = igrpSub.nodes.map(gn => ({
                    ...gn, id: igrpPrefix + igrpSlugMap.get(gn.id)!,
                    inputs: Object.fromEntries(Object.entries(gn.inputs).map(([k, inp]) => [k, inp.connection
                      ? { ...inp, connection: { nodeId: igrpPrefix + (igrpSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId), outputKey: inp.connection.outputKey } }
                      : inp])),
                  }));
                  for (const gn of topologicalSort(igrpPrefixed)) {
                    if (nodeOutputs.has(gn.id)) continue;
                    const gDef = getNodeDefinition(gn.type); if (!gDef) continue;
                    if (gDef.glslFunction) functions.add(gDef.glslFunction);
                    gDef.glslFunctions?.forEach(h => functions.add(h));
                    const gnOrigId2 = gn.id.slice(igrpPrefix.length);
                    const gnInputVars2: Record<string, string> = {};
                    for (const [k, inp] of Object.entries(gn.inputs)) {
                      const pk = `${gnOrigId2}:${k}`;
                      if (igrpPortOverrides.has(pk)) gnInputVars2[k] = igrpPortOverrides.get(pk)!;
                      else if (inp.connection) { const s = nodeOutputs.get(inp.connection.nodeId); if (s?.[inp.connection.outputKey]) gnInputVars2[k] = s[inp.connection.outputKey]; }
                      if (!gnInputVars2[k]) {
                        if (inp.defaultValue !== undefined) {
                          if (typeof inp.defaultValue === 'number') gnInputVars2[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                          else if (Array.isArray(inp.defaultValue)) gnInputVars2[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                        } else if (inp.type === 'float' && (k === 'time' || k === 't')) gnInputVars2[k] = 'u_time';
                      }
                    }
                    const gnResult2 = gDef.generateGLSL(gn, gnInputVars2);
                    sceneFnLines.push(gnResult2.code); nodeOutputs.set(gn.id, gnResult2.outputVars);
                    for (const [ok, vn] of Object.entries(gnResult2.outputVars)) { if (gDef.outputs[ok]?.type === 'float') sgLastFloatVar = vn; }
                  }
                  const igrpOutVars: Record<string, string> = {};
                  for (const port of (igrpSub.outputPorts ?? [])) {
                    const s = nodeOutputs.get(igrpPrefix + (igrpSlugMap.get(port.fromNodeId) ?? port.fromNodeId));
                    if (s?.[port.fromOutputKey]) { igrpOutVars[port.key] = s[port.fromOutputKey]; if (port.type === 'float') sgLastFloatVar = s[port.fromOutputKey]; }
                  }
                  nodeOutputs.set(sgn.id, igrpOutVars); continue;
                }

                const sgnDef = getNodeDefinition(sgn.type);
                if (!sgnDef) continue;

                if (sgnDef.glslFunction) functions.add(sgnDef.glslFunction);
                sgnDef.glslFunctions?.forEach(h => functions.add(h));

                const sgnOrigId = sgn.id.slice(sgInnerPrefix.length);
                const sgnInputVars: Record<string, string> = {};
                for (const [k, inp] of Object.entries(sgn.inputs)) {
                  const portKey2 = `${sgnOrigId}:${k}`;
                  if (sgPortOverridesInline.has(portKey2)) {
                    sgnInputVars[k] = sgPortOverridesInline.get(portKey2)!;
                  } else if (inp.connection) {
                    const srcOut = nodeOutputs.get(inp.connection.nodeId);
                    if (srcOut?.[inp.connection.outputKey]) sgnInputVars[k] = srcOut[inp.connection.outputKey];
                  }
                  if (!sgnInputVars[k]) {
                    if (inp.defaultValue !== undefined) {
                      if (typeof inp.defaultValue === 'number') {
                        sgnInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                      } else if (Array.isArray(inp.defaultValue)) {
                        sgnInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                      }
                    } else if (inp.type === 'float' && (k === 'time' || k === 't')) {
                      sgnInputVars[k] = 'u_time';
                    }
                  }
                }

                const sgnResult = sgnDef.generateGLSL(sgn, sgnInputVars);
                sceneFnLines.push(sgnResult.code);
                nodeOutputs.set(sgn.id, sgnResult.outputVars);

                // Track last float output as candidate return value
                for (const [outKey, varName] of Object.entries(sgnResult.outputVars)) {
                  if (sgnDef.outputs[outKey]?.type === 'float') sgLastFloatVar = varName;
                }
              }

              // Check outputPorts for explicit return value
              for (const port of (sgSubgraph.outputPorts ?? [])) {
                if (port.type === 'float') {
                  const mappedFromId = sgInnerSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
                  const srcOut = nodeOutputs.get(sgInnerPrefix + mappedFromId);
                  if (srcOut?.[port.fromOutputKey]) sgLastFloatVar = srcOut[port.fromOutputKey];
                }
              }

              // Emit the GLSL scene function — with extra params for external var references
              const sgFnBody = sceneFnLines.join('');
              const sgInlineExtraDecls = sgInlineExtraParams.map(v => `${v.type} ${v.name}`).join(', ');
              const sgFnDef = `float ${sceneFnNameLocal}(vec3 p${sgInlineExtraDecls ? ', ' + sgInlineExtraDecls : ''}) {\n${sgFnBody}    return ${sgLastFloatVar};\n}`;
              functions.add(sgFnDef);
              if (sgInlineExtraParams.length > 0) sceneFnExtraParams.set(sceneFnNameLocal, sgInlineExtraParams);
              // Forward scene-fn external vars through marchBody_ so they're in scope when mapScene_ is called
              for (const ep of sgInlineExtraParams) {
                if (!mlBodyExtraParams.some(p => p.name === ep.name)) {
                  mlBodyExtraParams.push(ep);
                }
              }
              sceneFnName = sceneFnNameLocal;
              nodeOutputs.set(sn.id, { scene: sceneFnNameLocal });
            }
            continue; // SceneGroup does not contribute to bodyLines
          }

          // ── Inline regular group nodes inside the MLG warp body ──────────────
          if (sn.type === 'group') {
            const mlGrpSubgraph = sn.params.subgraph as SubgraphData | undefined;
            if (!mlGrpSubgraph || mlGrpSubgraph.nodes.length === 0) { nodeOutputs.set(sn.id, {}); continue; }
            const mlGrpSlugMap = new Map<string, string>();
            for (const gn of mlGrpSubgraph.nodes) mlGrpSlugMap.set(gn.id, computeNodeSlug(gn, usedSlugs));
            // Reverse map: slug → original GraphNode, used for assignOp + raw-ID lookup
            const mlGrpSlugToOrigNode = new Map<string, GraphNode>();
            for (const origGn of mlGrpSubgraph.nodes) {
              const slug = mlGrpSlugMap.get(origGn.id);
              if (slug) mlGrpSlugToOrigNode.set(slug, origGn);
            }
            const mlGrpPrefix = `${sn.id}_g_`;
            const mlGrpPortOverrides = new Map<string, string>();
            for (const port of (mlGrpSubgraph.inputPorts ?? [])) {
              const portInp = sn.inputs[port.key];
              let srcVar: string | undefined;
              if (portInp?.connection) srcVar = nodeOutputs.get(portInp.connection.nodeId)?.[portInp.connection.outputKey];
              if (!srcVar) srcVar = mlPortOverrides.get(`${sn.id.slice(mlPrefix.length)}:${port.key}`);
              if (srcVar) mlGrpPortOverrides.set(`${mlGrpSlugMap.get(port.toNodeId) ?? port.toNodeId}:${port.toInputKey}`, srcVar);
            }
            const mlGrpPrefixed: GraphNode[] = mlGrpSubgraph.nodes.map(gn => ({
              ...gn, id: mlGrpPrefix + mlGrpSlugMap.get(gn.id)!,
              inputs: Object.fromEntries(Object.entries(gn.inputs).map(([k, inp]) => [k, inp.connection
                ? { ...inp, connection: { nodeId: mlGrpPrefix + (mlGrpSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId), outputKey: inp.connection.outputKey } }
                : inp])),
            }));
            for (const gn of topologicalSort(mlGrpPrefixed)) {
              if (nodeOutputs.has(gn.id)) continue;
              const gDef = getNodeDefinition(gn.type); if (!gDef) continue;
              if (gDef.glslFunction) functions.add(gDef.glslFunction);
              gDef.glslFunctions?.forEach(h => functions.add(h));
              const gnOrigId = gn.id.slice(mlGrpPrefix.length);
              const gnInputVars: Record<string, string> = {};
              for (const [k, inp] of Object.entries(gn.inputs)) {
                const pk = `${gnOrigId}:${k}`;
                if (mlGrpPortOverrides.has(pk)) gnInputVars[k] = mlGrpPortOverrides.get(pk)!;
                else if (inp.connection) { const s = nodeOutputs.get(inp.connection.nodeId); if (s?.[inp.connection.outputKey]) gnInputVars[k] = s[inp.connection.outputKey]; }
                if (!gnInputVars[k]) {
                  if (inp.type === 'float' && (k === 'time' || k === 't')) gnInputVars[k] = 'u_time';
                  else if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) gnInputVars[k] = 'g_uv';
                  else if (inp.defaultValue !== undefined) {
                    if (typeof inp.defaultValue === 'number') gnInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                    else if (Array.isArray(inp.defaultValue)) gnInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
                  }
                }
              }
              // Special case: marchSceneDist inside inline group → emit real scene function call
              if (gn.type === 'marchSceneDist') {
                const resolvedSceneFn2 = sceneFnName || inputVars.scene || 'MISSING_SCENE_FN';
                const resolvedExtraParams2 = sceneFnExtraParams.get(resolvedSceneFn2) ?? [];
                const resolvedExtraStr2 = resolvedExtraParams2.length > 0
                  ? ', ' + resolvedExtraParams2.map(v => v.name).join(', ') : '';
                const posVar2 = gnInputVars.pos || `${nodeSlug}_mp`;
                const rawVar2 = `${gn.id}_sd_raw`;
                const outVar2 = `${gn.id}_sd`;
                if (mlVolumetric) {
                  bodyLines.push(`    float ${rawVar2} = ${resolvedSceneFn2}(${posVar2}${resolvedExtraStr2});\n`);
                  bodyLines.push(`    float ${outVar2} = max(${rawVar2}, ${mlPassthrough});\n`);
                  nodeOutputs.set(gn.id, { dist: outVar2, rawDist: rawVar2 });
                } else {
                  bodyLines.push(`    float ${outVar2} = ${resolvedSceneFn2}(${posVar2}${resolvedExtraStr2});\n`);
                  nodeOutputs.set(gn.id, { dist: outVar2 });
                }
                continue;
              }
              const gnResult = gDef.generateGLSL(gn, gnInputVars);
              bodyLines.push(gnResult.code);
              // Handle assignOp accumulators nested inside this inline group
              const gnSlugKey = gn.id.slice(mlGrpPrefix.length);
              const origGnForAcc = mlGrpSlugToOrigNode.get(gnSlugKey);
              if (origGnForAcc?.assignOp && origGnForAcc.assignOp !== '=') {
                const outerGroupSlug = sn.id.slice(mlPrefix.length);
                const sanitizedOrigId = origGnForAcc.id.replace(/[^a-zA-Z0-9]/g, '');
                const accOutVars: Record<string, string> = {};
                for (const [outKey, tempVar] of Object.entries(gnResult.outputVars)) {
                  const accVar = `${nodeSlug}_mlgacc_${outerGroupSlug}_ng_${sanitizedOrigId}_${outKey}`;
                  bodyLines.push(`    ${accVar} ${origGnForAcc.assignOp} ${tempVar};\n`);
                  accOutVars[outKey] = accVar;
                }
                nodeOutputs.set(gn.id, accOutVars);
              } else {
                nodeOutputs.set(gn.id, gnResult.outputVars);
                for (const [ok, vn] of Object.entries(gnResult.outputVars)) { if (gDef.outputs[ok]?.type === 'vec3') mlLastVec3Var = vn; }
              }
            }
            const mlGrpOutVars: Record<string, string> = {};
            for (const port of (mlGrpSubgraph.outputPorts ?? [])) {
              const s = nodeOutputs.get(mlGrpPrefix + (mlGrpSlugMap.get(port.fromNodeId) ?? port.fromNodeId));
              if (s?.[port.fromOutputKey]) {
                mlGrpOutVars[port.key] = s[port.fromOutputKey];
                if (port.type === 'vec3') mlLastVec3Var = s[port.fromOutputKey];
              }
            }
            nodeOutputs.set(sn.id, mlGrpOutVars); continue;
          }

          if (snDef.glslFunction) functions.add(snDef.glslFunction);
          if (snDef.glslFunctions) snDef.glslFunctions.forEach(h => functions.add(h));

          const origId = sn.id.slice(mlPrefix.length);
          // Apply param overrides stored on the outer MLG node using "innerNodeId::paramName" keys
          // (same pattern used by GroupParamPicker so sliders on the MLG affect body nodes)
          const bodyParamOverrides: Record<string, unknown> = {};
          const bodyOverridePrefix = `${origId}::`;
          for (const [k, v] of Object.entries(node.params)) {
            if (typeof k === 'string' && k.startsWith(bodyOverridePrefix)) {
              bodyParamOverrides[k.slice(bodyOverridePrefix.length)] = v;
            }
          }
          const snEffective = Object.keys(bodyParamOverrides).length > 0
            ? { ...sn, params: { ...sn.params, ...bodyParamOverrides } }
            : sn;

          const snInputVars: Record<string, string> = {};
          for (const [k, inp] of Object.entries(sn.inputs)) {
            const portKey = `${origId}:${k}`;
            if (mlPortOverrides.has(portKey)) {
              snInputVars[k] = mlPortOverrides.get(portKey)!;
            } else if (inp.connection) {
              const srcOut = nodeOutputs.get(inp.connection.nodeId);
              if (srcOut?.[inp.connection.outputKey]) snInputVars[k] = srcOut[inp.connection.outputKey];
            }
            if (!snInputVars[k]) {
              // Uniform passthrough nodes inside the body helper emit globals directly
              if (inp.type === 'float' && (k === 'time' || k === 't')) snInputVars[k] = 'u_time';
              else if (inp.type === 'vec2' && (k === 'uv' || k === 'p' || k === 'uv2')) snInputVars[k] = 'g_uv';
              else if (inp.defaultValue !== undefined) {
                if (typeof inp.defaultValue === 'number') snInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
                else if (Array.isArray(inp.defaultValue)) snInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
              }
            }
          }

          // ── marchSceneDist: emit a direct call to the scene SDF function ────────
          if (sn.type === 'marchSceneDist') {
            const resolvedSceneFn = sceneFnName || inputVars.scene || 'MISSING_SCENE_FN';
            const resolvedExtraParams = sceneFnExtraParams.get(resolvedSceneFn) ?? [];
            const resolvedExtraStr = resolvedExtraParams.length > 0
              ? ', ' + resolvedExtraParams.map(v => v.name).join(', ')
              : '';
            const posVar = snInputVars.pos || `${nodeSlug}_mp`;
            const rawVar = `${sn.id}_sd_raw`;
            const outVar = `${sn.id}_sd`;
            if (mlVolumetric) {
              // In volumetric mode expose both raw d and max(d, passthrough) clamped vol
              bodyLines.push(`    float ${rawVar} = ${resolvedSceneFn}(${posVar}${resolvedExtraStr});\n`);
              bodyLines.push(`    float ${outVar} = max(${rawVar}, ${mlPassthrough});\n`);
              nodeOutputs.set(sn.id, { dist: outVar, rawDist: rawVar });
            } else {
              bodyLines.push(`    float ${outVar} = ${resolvedSceneFn}(${posVar}${resolvedExtraStr});\n`);
              nodeOutputs.set(sn.id, { dist: outVar });
            }
            continue;
          }

          const snResult = snDef.generateGLSL(snEffective, snInputVars);

          // ── assignOp in body: route output through inout accumulator ──────────
          if (sn.assignOp && sn.assignOp !== '=') {
            bodyLines.push(snResult.code);
            const accOutVars: Record<string, string> = {};
            for (const [outKey, tempVar] of Object.entries(snResult.outputVars)) {
              const accVar = `${nodeSlug}_mlgacc_${origId}_${outKey}`;
              bodyLines.push(`    ${accVar} ${sn.assignOp} ${tempVar};\n`);
              accOutVars[outKey] = accVar;
            }
            nodeOutputs.set(sn.id, accOutVars);
            continue;
          }

          bodyLines.push(snResult.code);
          nodeOutputs.set(sn.id, snResult.outputVars);

          // Track last vec3 output as the warp return value
          for (const [outKey, varName] of Object.entries(snResult.outputVars)) {
            const outType = snDef.outputs[outKey]?.type;
            if (outType === 'vec3') mlLastVec3Var = varName;
          }
        }

        // Override return value from the subgraph's output port (if defined)
        for (const port of (subgraph.outputPorts ?? [])) {
          if (port.type === 'vec3') {
            const mappedFromNodeId = mlSubSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
            const srcOut = nodeOutputs.get(mlPrefix + mappedFromNodeId);
            if (srcOut?.[port.fromOutputKey]) mlLastVec3Var = srcOut[port.fromOutputKey];
          }
        }

        // Emit the named GLSL body function into the preamble
        const fnBody = bodyLines.join('');
        let mlFnSig: string;
        const mlBodyExtraDecls = mlBodyExtraParams.map(v => `${v.type} ${v.name}`).join(', ');
        const mlBodyAccDecls = mlBodyAccumulators.map(a => `inout ${a.type} ${a.varName}`).join(', ');
        if (mlHasNewStyle) {
          const extraParamDecls = mlExtraInputs.map(ex => `${ex.type} ${nodeSlug}_ex_${ex.key}`).join(', ');
          const allExtra = [extraParamDecls, mlBodyExtraDecls, mlBodyAccDecls].filter(Boolean).join(', ');
          mlFnSig = `vec3 ${nodeSlug}_mp, float ${nodeSlug}_bt, vec3 ${nodeSlug}_ro, vec3 ${nodeSlug}_rd${allExtra ? `, ${allExtra}` : ''}`;
        } else {
          const allBodyExtra = [mlBodyExtraDecls, mlBodyAccDecls].filter(Boolean).join(', ');
          mlFnSig = `vec3 ${nodeSlug}_mp, float ${nodeSlug}_bt${allBodyExtra ? `, ${allBodyExtra}` : ''}`;
        }
        const fnDef = `vec3 ${warpFnName}(${mlFnSig}) {\n${fnBody}    return ${mlLastVec3Var};\n}`;
        functions.add(fnDef);
        warpBodyFn = warpFnName;
      }

      // Resolve the scene function: body SceneGroup takes priority, then external scene wire
      const mlSceneFn = sceneFnName || inputVars.scene || 'MISSING_SCENE_FN';
      const mlHasScene = mlSceneFn !== 'MISSING_SCENE_FN';

      // ── Emit the march loop into main ──────────────────────────────────────
      const mlExtraArgsList = mlExtraInputs.map(ex => {
        const v = inputVars[ex.key];
        if (v) return v;
        if (ex.type === 'vec2') return 'vec2(0.0)';
        if (ex.type === 'vec3') return 'vec3(0.0)';
        if (ex.type === 'vec4') return 'vec4(0.0)';
        return '0.0';
      });
      const mlExtraArgsStr = mlExtraArgsList.length > 0 ? ', ' + mlExtraArgsList.join(', ') : '';
      const mlBodyExtraArgsStr = mlBodyExtraParams.length > 0 ? ', ' + mlBodyExtraParams.map(v => v.name).join(', ') : '';
      const mlBodyAccArgsStr = mlBodyAccumulators.length > 0 ? ', ' + mlBodyAccumulators.map(a => a.varName).join(', ') : '';
      const warpPos = (expr: string, t: string): string => {
        if (!warpBodyFn) return expr;
        if (mlHasNewStyle) return `${warpBodyFn}(${expr}, ${t}, ${mlRo}, ${mlRd}${mlExtraArgsStr}${mlBodyExtraArgsStr}${mlBodyAccArgsStr})`;
        return `${warpBodyFn}(${expr}, ${t}${mlBodyExtraArgsStr}${mlBodyAccArgsStr})`;
      };
      // Build extra args for scene function calls (passes external vars from main() scope)
      const mlSceneExtraParams = sceneFnExtraParams.get(mlSceneFn) ?? [];
      const mlSceneExtraArgsStr = mlSceneExtraParams.length > 0 ? ', ' + mlSceneExtraParams.map(v => v.name).join(', ') : '';
      const callScene = (posExpr: string): string => `${mlSceneFn}(${posExpr}${mlSceneExtraArgsStr})`;

      // Declare inout accumulator vars in main() before the march loop
      const accumDecls = mlBodyAccumulators.map(a => `    ${a.type} ${a.varName} = ${a.initExpr};\n`).join('');

      // Jitter: offset the first step by a hash of ray origin to remove banding
      const jitterDecl = mlJitter !== '0.0'
        ? `    float ${nodeSlug}_jh = fract(sin(dot(${mlRo}.xy + ${mlRd}.xy, vec2(127.1, 311.7))) * 43758.5453);\n`
        + `    float ${nodeSlug}_t   = 0.001 + ${mlJitter} * ${nodeSlug}_jh * (${mlMaxDist} / float(${mlMaxSteps}));\n`
        : `    float ${nodeSlug}_t   = 0.001;\n`;

      const marchLoopLines = mlVolumetric ? [
        // Volumetric mode: no hit detection, runs all steps.
        // If scene connected: step by max(sdf, passthrough). If not: step by passthrough (pure density).
        accumDecls,
        jitterDecl,
        `    float ${nodeSlug}_hit = 0.0;\n`,
        `    int   ${nodeSlug}_si  = 0;\n`,
        `    for (int ${nodeSlug}_i = 0; ${nodeSlug}_i < ${mlMaxSteps}; ${nodeSlug}_i++) {\n`,
        `        vec3  ${nodeSlug}_rp_raw = ${mlRo} + ${nodeSlug}_t * ${mlRd};\n`,
        `        vec3  ${nodeSlug}_rp = ${warpPos(`${nodeSlug}_rp_raw`, `${nodeSlug}_t`)};\n`,
        mlHasScene
          ? `        float ${nodeSlug}_vol = max(${callScene(`${nodeSlug}_rp`)}, ${mlPassthrough});\n`
          : `        float ${nodeSlug}_vol = ${mlPassthrough};\n`,
        `        ${nodeSlug}_t += ${nodeSlug}_vol;\n`,
        `        if (${nodeSlug}_t > ${mlMaxDist}) { ${nodeSlug}_si = ${nodeSlug}_i; break; }\n`,
        `    }\n`,
      ] : [
        // Standard raymarching: hit detection + stepScale
        accumDecls,
        jitterDecl,
        `    float ${nodeSlug}_hit = 0.0;\n`,
        `    int   ${nodeSlug}_si  = 0;\n`,
        `    for (int ${nodeSlug}_i = 0; ${nodeSlug}_i < ${mlMaxSteps}; ${nodeSlug}_i++) {\n`,
        `        vec3  ${nodeSlug}_rp_raw = ${mlRo} + ${nodeSlug}_t * ${mlRd};\n`,
        `        vec3  ${nodeSlug}_rp = ${warpPos(`${nodeSlug}_rp_raw`, `${nodeSlug}_t`)};\n`,
        `        float ${nodeSlug}_d  = ${callScene(`${nodeSlug}_rp`)};\n`,
        `        if (${nodeSlug}_d < 0.0005) { ${nodeSlug}_hit = 1.0; ${nodeSlug}_si = ${nodeSlug}_i; break; }\n`,
        `        ${nodeSlug}_t += ${nodeSlug}_d * ${mlStepScale};\n`,
        `        if (${nodeSlug}_t > ${mlMaxDist}) { ${nodeSlug}_si = ${nodeSlug}_i; break; }\n`,
        `    }\n`,
      ];
      const marchCode = [
        ...marchLoopLines,
        `    float ${nodeSlug}_iter      = float(${nodeSlug}_si) / float(${mlMaxSteps});\n`,
        `    float ${nodeSlug}_iterCount = float(${nodeSlug}_si);\n`,
        `    vec3  ${nodeSlug}_hp_raw  = ${mlRo} + ${nodeSlug}_t * ${mlRd};\n`,
        `    vec3  ${nodeSlug}_hp  = ${warpPos(`${nodeSlug}_hp_raw`, `${nodeSlug}_t`)};\n`,
        // Normal estimation: skip in volumetric mode (no surface) or when no scene is connected
        ...(mlVolumetric || !mlHasScene ? [
          `    vec3  ${nodeSlug}_n   = vec3(0.0, 1.0, 0.0);\n`,
        ] : [
          `    float ${nodeSlug}_e   = 0.001;\n`,
          `    vec3  ${nodeSlug}_n   = normalize(vec3(\n`,
          `        ${callScene(warpPos(`${nodeSlug}_hp_raw+vec3(${nodeSlug}_e,0.0,0.0)`, `${nodeSlug}_t`))} - ${callScene(warpPos(`${nodeSlug}_hp_raw-vec3(${nodeSlug}_e,0.0,0.0)`, `${nodeSlug}_t`))},\n`,
          `        ${callScene(warpPos(`${nodeSlug}_hp_raw+vec3(0.0,${nodeSlug}_e,0.0)`, `${nodeSlug}_t`))} - ${callScene(warpPos(`${nodeSlug}_hp_raw-vec3(0.0,${nodeSlug}_e,0.0)`, `${nodeSlug}_t`))},\n`,
          `        ${callScene(warpPos(`${nodeSlug}_hp_raw+vec3(0.0,0.0,${nodeSlug}_e)`, `${nodeSlug}_t`))} - ${callScene(warpPos(`${nodeSlug}_hp_raw-vec3(0.0,0.0,${nodeSlug}_e)`, `${nodeSlug}_t`))}\n`,
          `    ));\n`,
        ]),
        `    float ${nodeSlug}_dist   = ${nodeSlug}_t;\n`,
        `    float ${nodeSlug}_depth  = clamp(${nodeSlug}_t / ${mlMaxDist}, 0.0, 1.0);\n`,
        `    vec3  ${nodeSlug}_normal = ${nodeSlug}_n * ${nodeSlug}_hit;\n`,
        `    vec3  ${nodeSlug}_bg     = vec3(${bgr}, ${bgg}, ${bgb});\n`,
        `    vec3  ${nodeSlug}_ld     = normalize(vec3(1.5, 2.0, 1.0));\n`,
        `    float ${nodeSlug}_diff   = max(0.0, dot(${nodeSlug}_n, ${nodeSlug}_ld));\n`,
        `    vec3  ${nodeSlug}_alb    = vec3(${albr}, ${albg}, ${albb});\n`,
        `    vec3  ${nodeSlug}_color  = ${nodeSlug}_hit > 0.5 ? ${nodeSlug}_alb * (0.15 + 0.85 * ${nodeSlug}_diff) : ${nodeSlug}_bg;\n`,
      ].join('');

      mainCode.push(marchCode);
      const mlgAccOutputs: Record<string, string> = {};
      const mlgAccSockets: Record<string, { type: string; label: string }> = {};
      mlBodyAccumulators.forEach((acc, i) => {
        mlgAccOutputs[`acc${i}`] = acc.varName;
        mlgAccSockets[`acc${i}`] = { type: acc.type, label: acc.label };
      });
      if (Object.keys(mlgAccSockets).length > 0) mlgDynamicOutputs.set(node.id, mlgAccSockets);
      nodeOutputs.set(node.id, {
        color:     `${nodeSlug}_color`,
        dist:      `${nodeSlug}_dist`,
        depth:     `${nodeSlug}_depth`,
        normal:    `${nodeSlug}_normal`,
        iter:      `${nodeSlug}_iter`,
        iterCount: `${nodeSlug}_iterCount`,
        hit:       `${nodeSlug}_hit`,
        pos:       `${nodeSlug}_hp`,
        ...mlgAccOutputs,
      });
      continue;
    }

    // ── Space Warp Group: compile subgraph as a vec3→vec3 warp GLSL function ────
    if (node.type === 'spaceWarpGroup') {
      const subgraph = node.params.subgraph as SubgraphData | undefined;
      if (!subgraph || subgraph.nodes.length === 0) {
        nodeOutputs.set(node.id, { warp: '' });
        continue;
      }

      const fnName   = `warpSpace_${nodeSlug}`;
      const swPrefix = `${nodeSlug}_sw_`;
      const warpFnLines: string[] = [];

      // Build slug map for ALL subgraph nodes BEFORE pre-registration
      const swSubSlugMap = new Map<string, string>();
      for (const sn of subgraph.nodes) {
        swSubSlugMap.set(sn.id, computeNodeSlug(sn, usedSlugs));
      }

      // Pre-register ScenePosNode outputs as 'p' (the function parameter)
      for (const sn of subgraph.nodes) {
        if (sn.type === 'scenePos') {
          const spSlug = swSubSlugMap.get(sn.id) ?? sn.id;
          nodeOutputs.set(swPrefix + spSlug, { pos: 'p' });
        }
      }

      // Port input overrides from the outer node's inputs (slug-keyed)
      const swPortOverrides = new Map<string, string>();
      for (const port of (subgraph.inputPorts ?? [])) {
        const outerVar = inputVars[port.key];
        if (outerVar) {
          const mappedToNodeId = swSubSlugMap.get(port.toNodeId) ?? port.toNodeId;
          swPortOverrides.set(`${mappedToNodeId}:${port.toInputKey}`, outerVar);
        }
      }

      // Prefix all subgraph node IDs + connections using slug-based ids
      const swPrefixedNodes: GraphNode[] = subgraph.nodes.map(subNode => {
        const subSlug = swSubSlugMap.get(subNode.id)!;
        const overridePrefix = `${subNode.id}::`;
        const paramOverrides: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.params)) {
          if (key.startsWith(overridePrefix)) {
            paramOverrides[key.slice(overridePrefix.length)] = val;
          }
        }
        // ps_ external socket connections inject GLSL vars as param overrides
        const snDef = getNodeDefinition(subNode.type);
        if (snDef?.paramDefs) {
          for (const paramKey of Object.keys(snDef.paramDefs)) {
            const psKey = `ps_${subNode.id}_${paramKey}`;
            const externalVar = inputVars[psKey];
            if (externalVar) paramOverrides[paramKey] = externalVar;
          }
        }
        return {
          ...subNode,
          id: swPrefix + subSlug,
          params: { ...subNode.params, ...paramOverrides },
          inputs: Object.fromEntries(
            Object.entries(subNode.inputs).map(([k, inp]) => [
              k,
              inp.connection
                ? { ...inp, connection: {
                    nodeId: swPrefix + (swSubSlugMap.get(inp.connection.nodeId) ?? inp.connection.nodeId),
                    outputKey: inp.connection.outputKey,
                  }}
                : inp,
            ]),
          ),
        };
      });

      const swSorted = topologicalSort(swPrefixedNodes);
      let swLastVec3Var = 'p';  // default: identity warp

      for (const sn of swSorted) {
        if (nodeOutputs.has(sn.id)) continue;  // scenePos already pre-registered
        const snDef = getNodeDefinition(sn.type);
        if (!snDef) continue;

        if (snDef.glslFunction) functions.add(snDef.glslFunction);
        if (snDef.glslFunctions) snDef.glslFunctions.forEach(h => functions.add(h));

        const origId = sn.id.slice(swPrefix.length);
        const snInputVars: Record<string, string> = {};
        for (const [k, inp] of Object.entries(sn.inputs)) {
          const portKey = `${origId}:${k}`;
          if (swPortOverrides.has(portKey)) {
            snInputVars[k] = swPortOverrides.get(portKey)!;
          } else if (inp.connection) {
            const srcOut = nodeOutputs.get(inp.connection.nodeId);
            if (srcOut?.[inp.connection.outputKey]) snInputVars[k] = srcOut[inp.connection.outputKey];
          }
          if (!snInputVars[k]) {
            if (inp.defaultValue !== undefined) {
              if (typeof inp.defaultValue === 'number') snInputVars[k] = Number.isInteger(inp.defaultValue) ? `${inp.defaultValue}.0` : `${inp.defaultValue}`;
              else if (Array.isArray(inp.defaultValue)) snInputVars[k] = `${inp.type}(${(inp.defaultValue as number[]).map((v: number) => v.toFixed(1)).join(', ')})`;
            }
          }
        }

        let effectiveSn = sn;
        for (const [k, v] of Object.entries(snInputVars)) {
          if (k.startsWith('__param_') && v) {
            const paramKey = k.slice('__param_'.length);
            effectiveSn = { ...effectiveSn, params: { ...effectiveSn.params, [paramKey]: v } };
          }
        }
        const snResult = snDef.generateGLSL(effectiveSn, snInputVars);
        warpFnLines.push(snResult.code);
        nodeOutputs.set(sn.id, snResult.outputVars);

        // Track last vec3 output as the warp return value
        for (const [outKey, varName] of Object.entries(snResult.outputVars)) {
          const outType = snDef.outputs[outKey]?.type;
          if (outType === 'vec3') swLastVec3Var = varName;
        }
      }

      // Find return value from the subgraph's output port (if defined)
      for (const port of (subgraph.outputPorts ?? [])) {
        if (port.type === 'vec3') {
          const mappedFromNodeId = swSubSlugMap.get(port.fromNodeId) ?? port.fromNodeId;
          const srcOut = nodeOutputs.get(swPrefix + mappedFromNodeId);
          if (srcOut?.[port.fromOutputKey]) swLastVec3Var = srcOut[port.fromOutputKey];
        }
      }

      // Emit the named GLSL function
      const fnBody = warpFnLines.join('');
      const fnDef = `vec3 ${fnName}(vec3 p) {\n${fnBody}    return ${swLastVec3Var};\n}`;
      functions.add(fnDef);

      nodeOutputs.set(node.id, { warp: fnName });
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
          const varName = `${nodeSlug}_${outKey}`;
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
          const result = def.generateGLSL({ ...node, id: nodeSlug }, inputVars);
          bypassCode = result.code;
          Object.assign(bypassOutputVars, result.outputVars);
        }
      } else {
        const result = def.generateGLSL({ ...node, id: nodeSlug }, inputVars);
        bypassCode = result.code;
        Object.assign(bypassOutputVars, result.outputVars);
      }
      mainCode.push(bypassCode);
      nodeOutputs.set(node.id, bypassOutputVars);
      continue;
    }

    // ── Standard node ─────────────────────────────────────────────────────────
    const sluggedNode = { ...node, id: nodeSlug };
    const { patchedNode, uniforms: nodeUniforms } = patchNodeParamsForUniforms(sluggedNode, def);
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
        // Find the primary vector output type (if any) so scalar sub-components
        // can have their assignInit extracted correctly (e.g. vec2 → .x / .y).
        const vectorOutputEntry = Object.entries(def.outputs).find(
          ([, sock]) => sock.type === 'vec2' || sock.type === 'vec3' || sock.type === 'vec4'
        );
        const vectorOutputType = vectorOutputEntry?.[1].type as string | undefined;
        const vectorDims = vectorOutputType === 'vec4' ? 4 : vectorOutputType === 'vec3' ? 3 : vectorOutputType === 'vec2' ? 2 : 0;
        const compOrder = ['x', 'y', 'z', 'w'];
        for (const outKey of Object.keys(result.outputVars)) {
          const outSock = def.outputs[outKey];
          const actualType = outSock?.type ?? 'float';
          const neutral = isMultiply ? `${actualType}(1.0)` : defaultGlslVal(actualType as DataType);
          let initExpr: string;
          if (node.assignInit?.trim()) {
            const raw = node.assignInit.trim();
            if (actualType === 'float' && compOrder.includes(outKey)) {
              // Float sub-component of a vector node: extract the matching component
              // from assignInit, or use neutral if the dimension doesn't cover it.
              const compIdx = compOrder.indexOf(outKey);
              initExpr = compIdx < vectorDims ? `(${raw}).${outKey}` : neutral;
            } else {
              initExpr = raw;
            }
          } else {
            initExpr = neutral;
          }
          const accVar = `${nodeSlug}_ao_${outKey}`;
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

  const fragmentShader = `precision highp float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
${paramUniformDecls ? paramUniformDecls + '\n' : ''}${textureUniformDecls ? textureUniformDecls + '\n' : ''}${audioUniformDecls ? audioUniformDecls + '\n' : ''}
varying vec2 vUv;

// ── Always-available helpers (noise, rotation) ───────────────────────────────
${BUILTIN_HELPERS_GLSL}
// ─────────────────────────────────────────────────────────────────────────

${functionCode}

void main() {
    vec2 g_uv = (vUv - 0.5) * 2.0;
    g_uv.x *= u_resolution.x / u_resolution.y;
${mainCode.join('')}}`.trim();

  return { fragmentShader, nodeOutputVars: nodeOutputs, paramUniforms, textureUniforms, audioUniforms, isStateful, nodeSlugMap, mlgDynamicOutputs };
}
