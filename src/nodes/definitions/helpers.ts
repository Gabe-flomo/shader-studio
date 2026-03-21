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

// Helper: emit a vec3 literal
export function vec3Str(v: number[]): string {
  return `vec3(${v.map(n => n.toFixed(2)).join(', ')})`;
}

// Helper: emit a vec4 literal
export function vec4Str(v: number[]): string {
  return `vec4(${v.map(n => n.toFixed(2)).join(', ')})`;
}

// Fallback zero value per type
export function zeroFor(type: string): string {
  if (type === 'vec2') return 'vec2(0.0)';
  if (type === 'vec3') return 'vec3(0.0)';
  return '0.0';
}

export type NodeRegistry = Record<string, NodeDefinition>;
