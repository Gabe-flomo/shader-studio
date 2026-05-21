import type { DataType } from '../types/nodeGraph';

/**
 * Returns true if a wire from sourceType can feed into an input of targetType.
 *
 * Exact match always works. Coercions:
 *  - float → vec2  (vec2(x))
 *  - float → vec3  (vec3(x))
 *  - vec2  → vec3  (vec3(xy, 0.0))
 *  - vec3  → vec2  (.xy)
 */
export function typesCompatible(sourceType: DataType | string, targetType: DataType | string): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'float') return targetType === 'vec2' || targetType === 'vec3';
  if (sourceType === 'vec2'  && targetType === 'vec3') return true;
  if (sourceType === 'vec3'  && targetType === 'vec2') return true;
  return false;
}
