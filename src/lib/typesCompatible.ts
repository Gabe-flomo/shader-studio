import type { DataType } from '../types/nodeGraph';

/**
 * Returns true if a wire from sourceType can feed into an input of targetType.
 *
 * Rules (per user spec):
 *  - float → float, vec2, vec3  (float is "widened" automatically)
 *  - vec2  → vec2 only
 *  - vec3  → vec3 only
 *  - vec4  → vec4 only
 */
export function typesCompatible(sourceType: DataType | string, targetType: DataType | string): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'float') return targetType === 'vec2' || targetType === 'vec3';
  return false;
}
