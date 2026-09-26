/**
 * Preview shader for a discovered function: a whole fragment shader that
 * calls it once per pixel with arguments chosen from each parameter's role
 * (UV into a position, Time into a time, a circle's distance into a
 * distance…) and paints the result in a way that suits what it returns
 * (a distance as a signed field, a colour as itself, a vec2 as a
 * red–green map). The bindings are editable; this only builds the source.
 */
import type { DiscoveredFn } from './discover';
import { bundleText } from './discover';
import type { ParamRole, RoleGuess, ValueRole } from './roles';

export type BindingKind = 'uv' | 'uv01' | 'mouse' | 'time' | 'distance' | 'direction' | 'seed' | 'const';
export interface Binding { kind: BindingKind; /** For const: the numbers (1, 2 or 3 of them). */ value: number[] }

export const BINDING_LABEL: Record<BindingKind, string> = {
  uv: 'UV (centred, −1…1)', uv01: 'UV (0…1)', mouse: 'Mouse', time: 'Time', distance: 'Circle distance', direction: 'View ray', seed: 'Cell id', const: 'Constant',
};

/** Which bindings make sense for a parameter type. */
export function bindingsFor(type: string): BindingKind[] {
  if (type === 'float') return ['time', 'distance', 'uv01', 'seed', 'const'];
  if (type === 'vec2') return ['uv', 'uv01', 'mouse', 'seed', 'const'];
  if (type === 'vec3') return ['direction', 'uv', 'const'];
  if (type === 'vec4') return ['uv', 'const'];
  return ['const'];
}

/** The binding a role suggests. */
export function defaultBinding(p: ParamRole): Binding {
  const c = (...v: number[]): Binding => ({ kind: 'const', value: v });
  switch (p.type) {
    case 'float':
      if (p.role === 'time') return { kind: 'time', value: [] };
      if (p.role === 'distance') return { kind: 'distance', value: [] };
      if (p.role === 'seed') return { kind: 'seed', value: [] };
      if (p.role === 'angle') return c(0.6);
      if (p.role === 'scale') return c(1.0);
      return c(0.5);
    case 'vec2':
      if (p.role === 'uv01') return { kind: 'uv01', value: [] };
      if (p.role === 'seed') return { kind: 'seed', value: [] };
      return { kind: 'uv', value: [] };
    case 'vec3':
      if (p.role === 'direction' || p.role === 'normal') return { kind: 'direction', value: [] };
      if (p.role === 'position') return { kind: 'uv', value: [] };
      return c(1.0, 0.6, 0.3);
    case 'vec4': return { kind: 'uv', value: [] };
    default: return c(0.0);
  }
}

const lit = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

function argExpr(type: string, b: Binding): string {
  const k = b.kind;
  const v = b.value;
  const asType = (e2: string, e3: string, e4: string, e1: string) => (type === 'vec2' ? e2 : type === 'vec3' ? e3 : type === 'vec4' ? e4 : e1);
  switch (k) {
    case 'uv': return asType('pv_uv', 'vec3(pv_uv, 0.0)', 'vec4(pv_uv, 0.0, 1.0)', 'pv_uv.x');
    case 'uv01': return asType('pv_uv01', 'vec3(pv_uv01, 0.0)', 'vec4(pv_uv01, 0.0, 1.0)', 'pv_uv01.x');
    case 'mouse': return asType('pv_mouse', 'vec3(pv_mouse, 0.0)', 'vec4(pv_mouse, 0.0, 1.0)', 'pv_mouse.x');
    case 'time': return asType('vec2(u_time)', 'vec3(u_time)', 'vec4(u_time)', 'u_time');
    case 'distance': return asType('vec2(pv_dist)', 'vec3(pv_dist)', 'vec4(pv_dist)', 'pv_dist');
    case 'direction': return asType('normalize(pv_uv)', 'normalize(vec3(pv_uv, 1.5))', 'vec4(normalize(vec3(pv_uv, 1.5)), 0.0)', 'pv_uv.x');
    case 'seed': return asType('floor(pv_uv * 6.0)', 'vec3(floor(pv_uv * 6.0), 0.0)', 'vec4(floor(pv_uv * 6.0), 0.0, 1.0)', 'floor(pv_uv.x * 6.0)');
    case 'const': {
      const n = type === 'vec2' ? 2 : type === 'vec3' ? 3 : type === 'vec4' ? 4 : type === 'int' ? 1 : type === 'bool' ? 1 : 1;
      const vals = Array.from({ length: n }, (_, i) => v[i] ?? v[0] ?? 0);
      if (type === 'int') return `${Math.round(vals[0])}`;
      if (type === 'bool') return vals[0] ? 'true' : 'false';
      return n === 1 ? lit(vals[0]) : `${type}(${vals.map(lit).join(', ')})`;
    }
  }
}

/** How the returned value is painted. */
function paint(type: string, role: ValueRole): string {
  if (type === 'float') {
    if (role === 'distance') {
      // The classic signed-field look: blue outside, orange inside, rings every 0.1, a bright zero line.
      return `vec3 col = (pv_v > 0.0) ? vec3(0.35, 0.55, 1.0) : vec3(1.0, 0.6, 0.25);
  col *= 1.0 - exp(-4.0 * abs(pv_v));
  col *= 0.8 + 0.2 * cos(60.0 * pv_v);
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.015, abs(pv_v)));`;
    }
    return `vec3 col = vec3(clamp(pv_v, 0.0, 1.0));
  if (pv_v < 0.0) col = vec3(clamp(-pv_v, 0.0, 1.0) * 0.5, 0.0, clamp(-pv_v, 0.0, 1.0));`;
  }
  if (type === 'vec2') return `vec3 col = vec3(fract(pv_v * 0.5 + 0.5), 0.35);`;
  if (type === 'vec3') return `vec3 col = clamp(pv_v, 0.0, 1.0);`;
  if (type === 'vec4') return `vec3 col = clamp(pv_v.rgb, 0.0, 1.0);`;
  if (type === 'int') return `vec3 col = vec3(float(pv_v) * 0.1);`;
  if (type === 'bool') return `vec3 col = vec3(pv_v ? 1.0 : 0.1);`;
  return `vec3 col = vec3(0.0);`;
}

/** The fragment shader, or the reason there can't be one. */
export function previewShaderFor(fn: DiscoveredFn, roles: ParamRole[], ret: RoleGuess, bindings: Binding[]): { ok: true; source: string } | { ok: false; error: string } {
  if (!fn.selfContained) return { ok: false, error: `Reads ${fn.globals.join(', ')} from its shader, so it can’t run on its own.` };
  if (fn.level < 0) return { ok: false, error: 'Calls itself.' };
  if (fn.returnType === 'void' || fn.params.some(p => p.qualifier !== 'in')) return { ok: false, error: 'Returns through out parameters; nothing to paint.' };
  if (!['float', 'vec2', 'vec3', 'vec4', 'int', 'bool'].includes(fn.returnType)) return { ok: false, error: `Returns ${fn.returnType}.` };
  const bad = fn.params.find(p => !['float', 'vec2', 'vec3', 'vec4', 'int', 'bool'].includes(p.type));
  if (bad) return { ok: false, error: `Takes ${bad.type} ${bad.name}; no way to make one up.` };
  const args = fn.params.map((p, i) => argExpr(p.type, bindings[i] ?? defaultBinding(roles[i] ?? { name: p.name, type: p.type, role: 'unknown', confidence: 0, because: [] }))).join(', ');
  const source = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
${bundleText(fn)}

void main() {
  vec2 pv_uv01 = gl_FragCoord.xy / u_resolution;
  vec2 pv_uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y * 2.0;
  vec2 pv_mouse = (u_mouse - 0.5 * u_resolution) / u_resolution.y * 2.0;
  float pv_dist = length(pv_uv) - 0.6;
  ${fn.returnType} pv_v = ${fn.name}(${args});
  ${paint(fn.returnType, ret.role)}
  gl_FragColor = vec4(col, 1.0);
}
`;
  return { ok: true, source };
}
