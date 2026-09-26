import type { NodeDefinition } from '../../types/nodeGraph';

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
