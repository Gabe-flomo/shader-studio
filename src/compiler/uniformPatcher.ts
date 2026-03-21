import type { GraphNode, NodeDefinition, DataType } from '../types/nodeGraph';

/** Node types whose params must remain as baked compile-time constants. */
export const SKIP_UNIFORM_TYPES = new Set(['loopStart', 'loopEnd', 'loop', 'forLoop']);

/** Default GLSL zero literal for a given type. */
export function defaultGlslVal(type: DataType | string): string {
  if (type === 'float') return '0.0';
  if (type === 'vec2')  return 'vec2(0.0)';
  if (type === 'vec3')  return 'vec3(0.0)';
  if (type === 'vec4')  return 'vec4(0.0)';
  return '0.0';
}

/**
 * For each eligible float paramDef, replace the numeric value in `node.params`
 * with a uniform name string (e.g. `'u_p_nodeId_scale'`).
 *
 * The `p()` helper in node definitions treats any string param as a pre-resolved
 * GLSL expression, so node defs work identically in both bake and uniform mode.
 *
 * Skips:
 * - Nodes whose type is in SKIP_UNIFORM_TYPES (loop control nodes)
 * - Integer-step params (`step === 1`) — loop counts, octave counts, etc.
 * - Non-float paramDefs (vec3, select, string)
 *
 * Returns `{ patchedNode, uniforms }` where `uniforms` maps name → current value.
 */
export function patchNodeParamsForUniforms(
  node: GraphNode,
  def: NodeDefinition,
): { patchedNode: GraphNode; uniforms: Record<string, number> } {
  const uniforms: Record<string, number> = {};

  if (SKIP_UNIFORM_TYPES.has(node.type) || !def.paramDefs) {
    return { patchedNode: node, uniforms };
  }

  const patchedParams = { ...node.params };
  for (const [key, paramDef] of Object.entries(def.paramDefs)) {
    if (paramDef.type !== 'float') continue;  // only scalar floats
    if (paramDef.step === 1) continue;         // integer param — keep baked
    const val = node.params[key];
    if (typeof val !== 'number') continue;
    const uniformName = `u_p_${node.id}_${key}`;
    patchedParams[key] = uniformName;
    uniforms[uniformName] = val;
  }

  return { patchedNode: { ...node, params: patchedParams }, uniforms };
}
