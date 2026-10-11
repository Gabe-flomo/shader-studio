/**
 * The tests' stand-in for the Grid scene node's motion line (build.ts motionInputs): each shape's
 * motion array (glsl.ts motionLen) filled in main(), its Angle and spin from a uniform (rA…, so a
 * test can turn it live) and a drawn path's numbers as literals.
 */
import { motionExtra, shapeArgs } from '../glsl';
import type { GridSceneSpec } from '../spec';

const lit = (n: number) => n.toFixed(6);

/** `uniform vec2 rA;` per shape. */
export const motionDecls = (spec: GridSceneSpec) => spec.shapes.map(s => `uniform vec2 ${shapeArgs(s.id).r};`);

/** The lines in main() that fill each shape's array. */
export const motionLines = (spec: GridSceneSpec) => spec.shapes.flatMap(s => {
  const a = shapeArgs(s.id);
  const v = motionExtra(s, spec);
  return [`  float ${a.x}[${v.length}];`, `  ${a.x}[0] = ${a.r}.x;`, `  ${a.x}[1] = ${a.r}.y;`, ...v.slice(2).map((n, i) => `  ${a.x}[${i + 2}] = ${lit(n)};`)];
});

/** rA… at the spec's values (radians). */
export const motionUniforms = (spec: GridSceneSpec): Record<string, number[]> =>
  Object.fromEntries(spec.shapes.map(s => [shapeArgs(s.id).r, motionExtra(s).slice(0, 2)]));
