/**
 * generated.ts — moves made by type rather than mined (docs/expression-builder-plan.md §1).
 *
 * Families that are rare in any one shader but are exactly the space worth exploring:
 *  - swizzles: `x.yx`, `x.zxy`, projections `x.xz`, lifts `vec3(x, #a)`;
 *  - one component driving another: `vec2(x.x + #a * sin(x.y * #b), x.y)`, for every ordered pair
 *    of components and f ∈ {sin, cos, abs, fract};
 *  - products across dimensions: `x.x * x.y`, `x * x.yx`, `x.xy * x.z`…;
 *  - rotations in each plane: `rotate(x, #a)` in 2D; xy / xz / yz in 3D; and turning with time.
 *
 * Marked `generated: true`, with no sources; their contexts list the dimensions they apply in.
 *
 * Roles: a swizzle (and a lift `vec3(x, #a)`) keeps whatever `x` stood for (`sig.keep`), so it
 * offers itself on space and colour alike; one component driving another, rotations and products
 * act on space (a product down to one number is a plain value).
 */
import { inferTypes, parseExpr, type GlslType, type Role, type TypeEnv } from '../lib/glslPatterns';
import { HELPER_ENV, moveId, templateKey, validTemplate, varDefault } from './shared';
import type { Dimension, Move, MoveFamily, MoveHole, MoveSignature } from './moves';

interface Spec {
  template: string;
  in: 'float' | 'vec2' | 'vec3';
  family: MoveFamily;
  holes?: Array<{ name: string; default: number; min: number; max: number } | { name: string; role: Role; type: GlslType }>;
}

/** The role a family's generated moves act on ('unknown': any, the result keeping it). */
const FAMILY_ROLE: Partial<Record<MoveFamily, Role>> = { couple: 'space', product: 'space', rotate: 'space' };

const DIMS: Record<Spec['in'], Dimension[]> = {
  float: ['1d-time', '2d'],
  vec2: ['2d', '3d-world', '3d-surface'],
  // A 2D picture lifted to 3D (`vec3(x, #a)`) or a colour gets them too.
  vec3: ['3d-world', '3d-surface', '2d'],
};

const C2 = ['x', 'y'], C3 = ['x', 'y', 'z'];
const FNS = ['sin', 'cos', 'abs', 'fract'];
const AMP = { name: '#a', default: 0.2, min: 0, max: 1 };
const FREQ = { name: '#b', default: 3, min: 0, max: 10 };
const ANGLE = { name: '#a', default: 0.5, min: -3.1416, max: 3.1416 };
const SPEED = { name: '#a', default: 0.5, min: -2, max: 2 };
const TIME = { name: '$t', role: 'time' as Role, type: 'float' as GlslType };
const LIFT = { name: '#a', default: 0, min: -1, max: 1 };

function permutations(xs: string[]): string[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));
}

function specs(): Spec[] {
  const out: Spec[] = [];
  // Swizzles
  for (const s of ['yx', 'xx', 'yy']) out.push({ template: `x.${s}`, in: 'vec2', family: 'swizzle' });
  out.push({ template: 'vec2(x.y, -x.x)', in: 'vec2', family: 'swizzle' });
  out.push({ template: 'vec3(x, #a)', in: 'vec2', family: 'swizzle', holes: [LIFT] });
  out.push({ template: 'vec3(x.x, #a, x.y)', in: 'vec2', family: 'swizzle', holes: [LIFT] });
  for (const p of permutations(C3)) if (p.join('') !== 'xyz') out.push({ template: `x.${p.join('')}`, in: 'vec3', family: 'swizzle' });
  for (const s of ['xy', 'xz', 'yz']) out.push({ template: `x.${s}`, in: 'vec3', family: 'swizzle' });
  // One component driving another
  const couple = (cs: string[], type: 'vec2' | 'vec3') => {
    for (const i of cs) for (const j of cs) {
      if (i === j) continue;
      for (const f of FNS) {
        const parts = cs.map(c => (c === i ? `x.${i} + #a * ${f}(x.${j} * #b)` : `x.${c}`));
        out.push({ template: `${type}(${parts.join(', ')})`, in: type, family: 'couple', holes: [AMP, FREQ] });
      }
    }
  };
  couple(C2, 'vec2');
  couple(C3, 'vec3');
  // Products across dimensions
  for (const t of ['x.x * x.y', 'x * x.yx', 'x * x.x', 'x * x.y']) out.push({ template: t, in: 'vec2', family: 'product' });
  for (const t of ['x.x * x.y * x.z', 'x * x.yzx', 'x.xy * x.z', 'x * x.x', 'vec3(x.y * x.z, x.z * x.x, x.x * x.y)']) out.push({ template: t, in: 'vec3', family: 'product' });
  // Rotations
  out.push({ template: 'rotate(x, #a)', in: 'vec2', family: 'rotate', holes: [ANGLE] });
  out.push({ template: 'rotate(x, #a * $t)', in: 'vec2', family: 'rotate', holes: [SPEED, TIME] });
  const planes: Array<[string, string]> = [
    ['xy', 'vec3(rotate(x.xy, ANGLE), x.z)'],
    ['xz', 'vec3(rotate(x.xz, ANGLE), x.y).xzy'],
    ['yz', 'vec3(x.x, rotate(x.yz, ANGLE))'],
  ];
  for (const [, t] of planes) {
    out.push({ template: t.replace('ANGLE', '#a'), in: 'vec3', family: 'rotate', holes: [ANGLE] });
    out.push({ template: t.replace('ANGLE', '#a * $t'), in: 'vec3', family: 'rotate', holes: [SPEED, TIME] });
  }
  return out;
}

let cache: Move[] | null = null;

/** Every generated move (built once). */
export function generatedMoves(): Move[] {
  if (cache) return cache;
  const out: Move[] = [];
  for (const s of specs()) {
    const holes: MoveHole[] = (s.holes ?? []).map(h => ('role' in h
      ? { name: h.name, kind: 'var', type: h.type, role: h.role, names: [], default: varDefault(h.type, h.role) }
      : { name: h.name, kind: 'number', type: 'float', default: h.default, range: { min: h.min, max: h.max }, seenMin: h.default, seenMax: h.default, vals: [] }));
    const env: TypeEnv = { ...HELPER_ENV, x: s.in };
    for (const h of holes) env[h.name] = h.type;
    const r = parseExpr(s.template);
    if (!r.ok) throw new Error(`Generated move “${s.template}” doesn't parse`);
    const outType = inferTypes(r.expr, env).get(r.expr.id) ?? 'unknown';
    if (outType === 'unknown') throw new Error(`Generated move “${s.template}” doesn't type`);
    // Strictly (GLSL ES 3.0): every generated move must compile on its own type.
    if (!validTemplate(s.template, env, outType)) throw new Error(`Generated move “${s.template}” doesn't type-check strictly`);
    const role: Role = FAMILY_ROLE[s.family] ?? 'unknown';
    const sig: MoveSignature = role === 'unknown'
      ? { in: s.in, out: outType, role, outRole: 'unknown', keep: true }
      : { in: s.in, out: outType, role, outRole: outType === 'float' ? 'value' : role };
    const key = templateKey(s.template, s.in, role, env)!;
    out.push({
      id: moveId(key), key, template: s.template, family: s.family,
      sig,
      holes, count: 0, sources: [], sourceCount: 0,
      contexts: DIMS[s.in].map(dim => ({ dim, feed: 'unknown', into: 'unknown', techniques: [], n: 0 })),
      generated: true,
    });
  }
  cache = out;
  return out;
}
