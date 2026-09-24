import type { DataType } from '../types/nodeGraph';

/**
 * The one table of type promotions the graph allows on a wire. Every other
 * place that needs to know whether `from` can feed `to` — the wire-drop
 * highlight, validate(), the assembler's input resolution and the bypass
 * pass-through — reads it through coerce() / typesCompatible(), so they can't
 * disagree.
 *
 *  - float → vec2 / vec3 / vec4   broadcast       vecN(x)
 *  - vec2  → vec3                 pad             vec3(xy, 0.0)
 *  - vec3  → vec4                 opaque alpha    vec4(rgb, 1.0)
 *  - vec3  → vec2                 truncate        (v).xy
 */
const PROMOTIONS: Record<string, (expr: string) => string> = {
  'float>vec2': e => `vec2(${e})`,
  'float>vec3': e => `vec3(${e})`,
  'float>vec4': e => `vec4(${e})`,
  'vec2>vec3':  e => `vec3(${e}, 0.0)`,
  'vec3>vec4':  e => `vec4(${e}, 1.0)`,
  'vec3>vec2':  e => `(${e}).xy`,
};

/**
 * GLSL expression that converts `expr` of type `from` into type `to`, or
 * `null` when the graph doesn't allow that promotion. Same type → `expr`.
 */
export function coerce(expr: string, from: DataType | string, to: DataType | string): string | null {
  if (from === to) return expr;
  const rule = PROMOTIONS[`${from}>${to}`];
  return rule ? rule(expr) : null;
}

/**
 * Bypass pass-through: like coerce(), but a vector may also collapse to a
 * float (its `.x`) so a bypassed node with a float output still emits
 * something sensible. Falls back to the raw expression when no rule applies —
 * callers only use this when they must emit *some* value.
 */
export function coerceLossy(expr: string, from: DataType | string, to: DataType | string): string {
  const c = coerce(expr, from, to);
  if (c !== null) return c;
  if (to === 'float' && (from === 'vec2' || from === 'vec3' || from === 'vec4')) return `${expr}.x`;
  return expr;
}

/** Returns true if a wire from sourceType can feed into an input of targetType. */
export function typesCompatible(sourceType: DataType | string, targetType: DataType | string): boolean {
  return coerce('x', sourceType, targetType) !== null;
}
