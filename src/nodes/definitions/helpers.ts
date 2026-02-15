import type { NodeDefinition } from '../../types/nodeGraph';

// Helper: emit a number as a GLSL float literal (e.g. 5 → "5.0")
export function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
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
