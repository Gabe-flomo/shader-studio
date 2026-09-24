import type { GraphNode, NodeDefinition, DataType } from '../types/nodeGraph';
import { getKeyframeConfig, generateKeyframeGLSL, isKeyframeBypassed } from './keyframes';

/** Node types whose params must remain as baked compile-time constants.
 *
 * Add a type here when its generateGLSL uses param values in JS-side conditionals
 * (e.g. to decide loop bounds, choose formula branches, or split DS pairs) rather
 * than just passing them through p() into the emitted GLSL.  Params on these nodes
 * always trigger a full shader recompile on change instead of a uniform update.
 */
export const SKIP_UNIFORM_TYPES = new Set([
  'loop', 'forLoop',
  // loopCarry is handled specially by the compiler; no params to uniform-patch
  'loopCarry',
  // Mandelbrot/Julia: zoom, max_iter, center_x/y, precision all affect code structure
  // and the center coordinates need JS-side DS splitting — must stay baked.
  'mandelbrot',
  // audioInput: freq_center and freq_range are read by the audio engine in JS — they
  // must NOT be converted to u_p_* uniform names; they stay as plain numbers in node.params.
  'audioInput',
  // particleEmitter: uses `speed` and `max_particles` in JS-side conditionals to choose
  // between field-flow mode (backward trace) and spawn-point mode (different GLSL branches).
  // Slider changes trigger a full recompile; use input sockets for real-time animation.
  'particleEmitter',
]);

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
 * with a uniform name string (e.g. `'u_p_nodeId_scale'`) — or, if that param
 * has its own keyframe track (a param-only slider with no backing input
 * socket, like Scatter's Frequency/Amplitude — a real socket's keyframes are
 * already handled by resolveInputVars), a `kf_...(u_time)` call expression
 * instead. Keyframes win over a plain uniform when both would apply.
 *
 * The `p()` helper in node definitions treats any string param as a pre-resolved
 * GLSL expression, so node defs work identically in bake, uniform, and keyframe
 * mode without knowing which one they're in.
 *
 * Skips:
 * - Nodes whose type is in SKIP_UNIFORM_TYPES (loop control nodes)
 * - Integer-step params (`step === 1`) — loop counts, octave counts, etc.
 * - Non-float paramDefs (vec3, select, string)
 * - Keyframing a key that's also a real input socket (that key's static
 *   fallback param value is never read when the socket exists — the socket's
 *   own resolveInputVars path already owns its keyframes)
 *
 * @param registerFn - sink for keyframe curve-evaluator GLSL functions
 *   (`this.functions.add`, same convention resolveInputVars uses). Omit to
 *   uniform-patch only, e.g. call sites that don't need keyframe support.
 * @param bindingId - the node's ORIGINAL graph id (before slugging / group
 *   prefixing). `node.id` at this point is usually the slug the uniform name
 *   is derived from, which the store never sees; the binding map is keyed by
 *   the id the store does know so the slider fast path can find its uniform
 *   without re-deriving the compiler's naming. Defaults to `node.id`.
 *
 * Returns `{ patchedNode, uniforms, bindings }` where `uniforms` maps uniform
 * name → current value and `bindings` maps `${bindingId}::${paramKey}` →
 * uniform name for every param that became a uniform.
 */
export function patchNodeParamsForUniforms(
  node: GraphNode,
  def: NodeDefinition,
  registerFn?: (glsl: string) => void,
  bindingId: string = node.id,
): { patchedNode: GraphNode; uniforms: Record<string, number>; bindings: Record<string, string> } {
  const uniforms: Record<string, number> = {};
  const bindings: Record<string, string> = {};

  if (SKIP_UNIFORM_TYPES.has(node.type) || !def.paramDefs) {
    return { patchedNode: node, uniforms, bindings };
  }

  // Sanitize node IDs: underscores in IDs create double-underscore sequences
  // like u_p_const__31_value which are reserved identifiers in GLSL ES.
  const safeId = node.id.replace(/_/g, 'x');
  const patchedParams = { ...node.params };
  for (const [key, paramDef] of Object.entries(def.paramDefs)) {
    if (paramDef.type !== 'float') continue;  // only scalar floats
    if (paramDef.step === 1) continue;         // integer param — keep baked
    if (!(key in node.inputs) && registerFn && !isKeyframeBypassed(node, key)) {
      const kfCfg = getKeyframeConfig(node, key);
      if (kfCfg) {
        const fnName = `kf_${safeId}_${key}`;
        const { glslFunction, sharedFunction, expr } = generateKeyframeGLSL(fnName, kfCfg);
        registerFn(sharedFunction);
        registerFn(glslFunction);
        patchedParams[key] = expr;
        continue;
      }
    }
    const val = node.params[key];
    if (typeof val !== 'number') continue;
    const uniformName = `u_p_${safeId}_${key}`;
    patchedParams[key] = uniformName;
    uniforms[uniformName] = val;
    bindings[paramBindingKey(bindingId, key)] = uniformName;
  }

  return { patchedNode: { ...node, params: patchedParams }, uniforms, bindings };
}

/**
 * Key of the param → uniform binding map: `${nodeId}::${paramKey}`. For a
 * node inside a group, `nodeId` is the inner node's own id, which is also how
 * the group node stores its overrides (`params["innerId::paramKey"]`), so the
 * same key works for both editing inside the group and editing the override.
 */
export function paramBindingKey(nodeId: string, paramKey: string): string {
  return `${nodeId}::${paramKey}`;
}
