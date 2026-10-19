import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';

// Helper: emit a number or uniform-name string as a GLSL float literal.
// Accepts a string so that p() results (uniform names) pass through unchanged.
export function f(n: number | string): string {
  if (typeof n === 'string') return n;
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Resolve a node param to a GLSL float literal or a uniform name.
 *
 * When the compiler runs in uniform mode it replaces numeric params with their
 * uniform name strings (e.g. 'u_p_nodeId_scale').  This helper returns that
 * string unchanged so node defs don't need to know whether they are in bake or
 * uniform mode.
 *
 * @param val      - node.params.whatever (unknown — could be number or injected string)
 * @param fallback - default number when val is absent or wrong type
 * @param decimals - optional decimal places; omit to use f() formatting
 */
export function p(val: unknown, fallback: number, decimals?: number): string {
  if (typeof val === 'string') return val;            // uniform name — pass through
  const n = typeof val === 'number' ? val : fallback;
  if (decimals !== undefined) return n.toFixed(decimals);
  return f(n);
}

/**
 * Resolve a vec3 / vec3color param to a GLSL vec3 expression or a uniform name.
 *
 * Like p(): in uniform mode the compiler has replaced the [r, g, b] array with
 * its `u_p_*` uniform name, which passes through unchanged. Otherwise the
 * array (or the fallback) is formatted as a vec3 literal. The result is an
 * expression, so components are `${v}.x` etc. — never `v[0]`.
 */
export function pv3(val: unknown, fallback: number[]): string {
  if (typeof val === 'string') return val;            // uniform name — pass through
  const arr = Array.isArray(val) && val.length >= 3 && val.every(n => typeof n === 'number') ? val as number[] : fallback;
  return vec3Str(arr);
}

// Helper: emit a vec3 literal (exact components, integers get a ".0" suffix)
export function vec3Str(v: number[]): string {
  return `vec3(${v.map(f).join(', ')})`;
}

// Helper: emit a vec4 literal (exact components, integers get a ".0" suffix)
export function vec4Str(v: number[]): string {
  return `vec4(${v.map(f).join(', ')})`;
}

// Fallback zero value per type
export function zeroFor(type: string): string {
  if (type === 'vec2') return 'vec2(0.0)';
  if (type === 'vec3') return 'vec3(0.0)';
  if (type === 'vec4') return 'vec4(0.0)';
  return '0.0';
}

export type NodeRegistry = Record<string, NodeDefinition>;

/**
 * Field sockets: the compiler names every field function with this prefix
 * and passes the name in `inputVars[key]`.
 */
export const FIELD_FN_PREFIX = 'fieldfn_';

/**
 * The field function wired into a field socket, or undefined. Anything else
 * (unwired, or a compile path that does not build field functions yet, such
 * as the inside of a group, which hands over the plain value) reads as
 * unwired, so the node falls back to its built-in behaviour instead of
 * emitting a call to something that is not a function.
 */
export function fieldFn(v: string | undefined): string | undefined {
  return v && v.startsWith(FIELD_FN_PREFIX) && /^\w+$/.test(v) ? v : undefined;
}

/**
 * Sockets the definition gained after nodes were saved (the Pass's Step outputs, Texture Input's
 * and Video's Texture): appended to an old node's outputs on load, so its card shows them. Only
 * the card changes; the shader reads an output only when something is wired to it.
 */
export function withNewOutputs(added: GraphNode['outputs']): (node: GraphNode) => GraphNode {
  return node => {
    const have = node.outputs;
    if (!have || !Object.keys(have).length) return node;
    const missing = Object.entries(added).filter(([k]) => !have[k]);
    return missing.length ? { ...node, outputs: { ...have, ...Object.fromEntries(missing.map(([k, v]) => [k, { type: v.type, label: v.label }])) } } : node;
  };
}

// ── Sliders you can wire ─────────────────────────────────────────────────────
//
// The card's convention: an input socket with the same key as a param overrides that slider while something is
// wired into it (or keyframed on it); unwired, the slider is the value. Hand-written definitions read it as
// `inputVars.k ?? p(node.params.k, d)`. `withParamSockets` gives a definition that convention for a list of its
// sliders at once: it adds the sockets (labelled and hinted from the sliders) and hands generateGLSL the node with
// those params replaced by what is wired in. Every float / vec3 / colour slider that isn't `compileTime` already
// reaches generateGLSL as a GLSL expression (a live uniform's name, patchNodeParamsForUniforms), so a wire's
// expression in its place is read the same way. Unwired, nothing changes: the same params, the same code.

/** Socket keys the compiler fills by itself when unwired (UV, the clock): never a slider's socket. */
const AUTO_FILLED = new Set(['uv', 'p', 'uv2', 't', 'time']);

/** Node type → the sliders withParamSockets gave sockets to (for tests and the docs). */
export const PARAM_SOCKETS = new Map<string, string[]>();

/**
 * Give `def` an input socket for each of `keys` (float, vec3 or colour sliders). `shown` lists the sockets the card
 * shows from the start; the rest come out on demand (right-click the slider → Control from outside, as on the
 * Particles node), and always while wired. `'all'` shows every one.
 */
export function withParamSockets(def: NodeDefinition, keys: readonly string[], shown: readonly string[] | 'all' = []): NodeDefinition {
  const pd = def.paramDefs ?? {};
  const inputs: NodeDefinition['inputs'] = { ...def.inputs };
  const onDemand: Record<string, string[]> = { ...(def.socketsOnDemand ?? {}) };
  for (const k of keys) {
    const d = pd[k];
    if (!d) throw new Error(`withParamSockets: ${def.type} has no slider "${k}"`);
    if (d.type !== 'float' && d.type !== 'vec3' && d.type !== 'vec3color') throw new Error(`withParamSockets: ${def.type}.${k} is a ${d.type}, not a number, vector or colour`);
    if (d.compileTime) throw new Error(`withParamSockets: ${def.type}.${k} is compile-time (it shapes the code), so it can't be wired`);
    if (AUTO_FILLED.has(k) || k in inputs) throw new Error(`withParamSockets: ${def.type} already has an input "${k}"`);
    inputs[k] = { type: d.type === 'float' ? 'float' : 'vec3', label: d.label, ...(d.hint ? { hint: d.hint } : {}) };
    if (shown !== 'all' && !shown.includes(k)) onDemand[k] = [k];
  }
  const inner = def.generateGLSL;
  const generateGLSL: NodeDefinition['generateGLSL'] = (node, inputVars) => {
    let params: Record<string, unknown> | null = null;
    for (const k of keys) {
      const v = inputVars[k];
      if (!v) continue;
      params ??= { ...node.params };
      params[k] = v;
    }
    return inner(params ? { ...node, params } : node, inputVars);
  };
  PARAM_SOCKETS.set(def.type, [...keys]);
  return { ...def, inputs, ...(Object.keys(onDemand).length ? { socketsOnDemand: onDemand } : {}), generateGLSL };
}

// ── Phase and Speed on the displace nodes ────────────────────────────────────
//
// Every displacement with a pattern (a sine, a ripple, noise) has a Phase (where the pattern is) and a Speed (how
// much Phase advances each second, on the shader clock), so the pattern moves by itself without a Time wire. Both
// stay literals at 0 (`literalAt`), and at 0 the node writes exactly the code it wrote before they existed, so old
// graphs compile to the same GLSL. Off 0 each is a live uniform, a Play target and (withParamSockets) a socket.

/** The Phase / Speed param keys (`phaseSpeed`, not `speed`: UV Warp and Domain Warp already have a Speed for their Time wire). */
export const PHASE_KEYS = ['phase', 'phaseSpeed'] as const;

/** Phase and Speed sliders. `speedLabel` when the node already has a slider called Speed. */
export function phaseParamDefs(opts: { speedLabel?: string; phaseHint?: string } = {}): Record<string, ParamDef> {
  return {
    phase: {
      label: 'Phase', type: 'float', min: -6.2832, max: 6.2832, step: 0.01, literalAt: 0,
      hint: opts.phaseHint ?? 'Shifts the pattern along (6.28 is one whole wave). Wire it, or drive it from Play, to move the pattern.',
    },
    phaseSpeed: {
      label: opts.speedLabel ?? 'Speed', type: 'float', min: -5, max: 5, step: 0.01, literalAt: 0,
      hint: 'How much Phase advances each second, so the pattern keeps moving on its own (no Time wire needed). 0 holds it still; negative runs it backwards.',
    },
  };
}

/**
 * The pattern's phase as a GLSL expression, `(phase + u_time * speed)`, or null when both are a plain 0 (or absent:
 * graphs saved before Phase existed), so the node leaves it out and writes the code it always did.
 */
export function phaseOf(node: GraphNode): string | null {
  const on = (v: unknown) => v !== undefined && v !== null && v !== 0;
  const ph = node.params.phase;
  const sp = node.params.phaseSpeed;
  const parts: string[] = [];
  if (on(ph)) parts.push(p(ph, 0));
  if (on(sp)) parts.push(`u_time * ${p(sp, 0)}`);
  return parts.length ? `(${parts.join(' + ')})` : null;
}

/** `expr + phase` when the node has a phase, else `expr` unchanged. */
export const plusPhase = (expr: string, ph: string | null) => (ph ? `${expr} + ${ph}` : expr);
