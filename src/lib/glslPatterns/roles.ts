/**
 * Roles: what a value stands for, so the same `* 3.0` reads as "zoom out 3×" on space, "3×
 * brighter" on a colour and "3× faster" on time.
 *
 * A name's role comes from, strongest first: what feeds it in the graph (a UV node, Time…),
 * its name (uv, p, col, d, t…), then its type (vec2 → space, vec3 / vec4 → colour, float →
 * value). Every other node's role follows from its operation (length of space is a distance,
 * atan is an angle, smoothstep gives a mask…). `because` records which rule decided, so a UI
 * can say why.
 */
import type { Expr, GlslType } from './ast';

export type Role = 'space' | 'colour' | 'value' | 'mask' | 'distance' | 'angle' | 'time' | 'direction' | 'cell' | 'unknown';

export interface RoleInfo { role: Role; because: 'graph' | 'name' | 'type' | 'operation' | 'none' }

/** Roles a host knows for certain (a socket wired from a UV node, say). */
export interface RoleEnv { [name: string]: Role | undefined }

const NAME_RULES: Array<{ re: RegExp; role: Role; types?: GlslType[] }> = [
  { re: /^(?:uv|st|p|q|pos|position|coord|coords|xy|fragcoord|vuv|point|pt|z|uv[0-9a-z]?|p[0-9]|q[0-9]|gv|lp|wp)$/i, role: 'space', types: ['vec2', 'vec3', 'unknown'] },
  { re: /^(?:col|color|colour|rgb|tint|albedo|bg|fg|c|base|light|diffuse|tex|texel|sample)\d*$/i, role: 'colour', types: ['vec3', 'vec4', 'unknown'] },
  { re: /^(?:d|dist|distance|sd|sdf|de|d[0-9]|dd|df)$/i, role: 'distance', types: ['float', 'unknown'] },
  { re: /^(?:t|time|u_time|itime|tt|now|phase)$/i, role: 'time', types: ['float', 'unknown'] },
  { re: /^(?:a|ang|angle|theta|phi|rot|rotation|spin|turn)\d*$/i, role: 'angle', types: ['float', 'unknown'] },
  { re: /^(?:mask|m|alpha|edge|shape|fill|stroke)\d*$/i, role: 'mask', types: ['float', 'unknown'] },
  { re: /^(?:dir|direction|rd|ray|n|nor|nrm|nrml|norm|normal|v|vel|velocity|flow|ld|lightdir|sundir|l)\d*$/i, role: 'direction', types: ['vec2', 'vec3', 'unknown'] },
  { re: /^(?:id|cell|cellid|tile|ipos|i)\d*$/i, role: 'cell', types: ['vec2', 'unknown'] },
];

/** The role a name suggests on its own, or null. */
export function roleFromName(name: string, type: GlslType = 'unknown'): Role | null {
  for (const r of NAME_RULES) if (r.re.test(name) && (!r.types || r.types.includes(type))) return r.role;
  if (name === 'gl_FragCoord' || name === 'u_mouse' || name === 'iMouse') return 'space';
  if (name === 'u_resolution' || name === 'iResolution') return 'space';
  return null;
}

export function roleFromType(type: GlslType): Role {
  if (type === 'vec2') return 'space';
  if (type === 'vec3' || type === 'vec4') return 'colour';
  if (type === 'float' || type === 'int') return 'value';
  return 'unknown';
}

/** Graph node types that say what their output is. */
export const SOURCE_NODE_ROLES: Record<string, Role> = {
  uv: 'space', uvCoords: 'space', screenUv: 'space', centeredUv: 'space', uvTransform2D: 'space', uvTransform: 'space', polar: 'space',
  time: 'time', clock: 'time', lfo: 'value',
  color: 'colour', constColor: 'colour', palette: 'colour', gradient: 'colour', textureInput: 'colour', cosinePalette: 'colour',
  circleSdf: 'distance', boxSdf: 'distance', sdfCircle: 'distance', sdfBox: 'distance',
  mouse: 'space',
};

/** The role of a graph node's output, by its type id (and output type when the type says nothing). */
/** What a node's output is by the output's own key, whatever the node: a March Loop's Normal is a direction. */
const OUTPUT_KEY_ROLES: Array<{ re: RegExp; role: Role; types?: GlslType[] }> = [
  { re: /^(normal|nrm|nor|n|surfacenormal|rn)$/i, role: 'direction', types: ['vec3', 'vec2'] },
  { re: /^(rd|raydir|dir|direction|lightdir|sundir)$/i, role: 'direction', types: ['vec3', 'vec2'] },
  { re: /^(pos|position|hitpos|hp|p|worldpos|ro|rayorigin)$/i, role: 'space', types: ['vec3', 'vec2'] },
  { re: /^(dist|distance|depth|sdf|d)$/i, role: 'distance', types: ['float'] },
  { re: /^(hit|mask|ao|shadow|occlusion|alpha)$/i, role: 'mask', types: ['float'] },
];

export function roleOfSourceNode(nodeType: string, outType?: GlslType, outputKey?: string): Role | null {
  if (outputKey) for (const r of OUTPUT_KEY_ROLES) if (r.re.test(outputKey) && (!r.types || !outType || r.types.includes(outType))) return r.role;
  if (SOURCE_NODE_ROLES[nodeType]) return SOURCE_NODE_ROLES[nodeType];
  const t = nodeType.toLowerCase();
  if (/sdf|distance/.test(t)) return 'distance';
  if (/uv|space|warp|rotate|twist|tile|polar|kaleid|mirror|repeat/.test(t) && outType === 'vec2') return 'space';
  if (/colou?r|palette|tint|tone|gradient/.test(t) && (outType === 'vec3' || outType === 'vec4')) return 'colour';
  if (/time|clock/.test(t) && outType === 'float') return 'time';
  return null;
}

/** Every node's role, by id. */
export function inferRoles(e: Expr, types: Map<number, GlslType>, env: RoleEnv = {}): Map<number, RoleInfo> {
  const out = new Map<number, RoleInfo>();
  const ty = (n: Expr) => types.get(n.id) ?? 'unknown';
  const go = (n: Expr): RoleInfo => {
    let r: RoleInfo;
    const t = ty(n);
    switch (n.kind) {
      case 'num': r = { role: 'value', because: 'type' }; break;
      case 'ident': {
        const g = env[n.name];
        if (g) { r = { role: g, because: 'graph' }; break; }
        const byName = roleFromName(n.name, t);
        if (byName) { r = { role: byName, because: 'name' }; break; }
        const byType = roleFromType(t);
        r = { role: byType, because: byType === 'unknown' ? 'none' : 'type' };
        break;
      }
      case 'unary': r = go(n.arg); break;
      case 'member': {
        const o = go(n.object);
        // One component of space is still a coordinate; of a colour, a channel (a value)
        r = o.role === 'space' && n.field.length >= 2 ? o : o.role === 'colour' && n.field.length >= 3 ? o : { role: o.role === 'space' ? 'space' : 'value', because: 'operation' };
        if (o.role === 'colour' && n.field.length === 1) r = { role: 'value', because: 'operation' };
        break;
      }
      case 'index': go(n.index); r = { role: 'value', because: 'operation' }; go(n.object); break;
      case 'ternary': { go(n.test); const a = go(n.then); go(n.else); r = a; break; }
      case 'binary': {
        const a = go(n.left), b = go(n.right);
        if (['<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(n.op)) { r = { role: 'mask', because: 'operation' }; break; }
        const ta = ty(n.left), tb = ty(n.right);
        // A vector keeps the role of the vector operand; a literal never decides.
        const lit = (x: Expr) => x.kind === 'num' || (x.kind === 'unary' && x.arg.kind === 'num');
        if (t !== 'float' && t !== 'int' && t !== 'unknown' && t !== 'bool') {
          // The result is a vector: it is what its vector operand is (the one that isn't a plain value, if both are)
          const ops: Array<[Expr, RoleInfo, GlslType]> = [[n.left, a, ta], [n.right, b, tb]];
          const vecs = ops.filter(([x, , tt]) => tt === t && !lit(x));
          const pick = vecs.find(([, ri]) => ri.role !== 'value') ?? vecs[0];
          r = pick ? pick[1] : { role: roleFromType(t), because: 'type' };
          // A plain value only takes its type's role when nothing better said what it is
          if (r.role === 'unknown' || (r.role === 'value' && r.because !== 'operation')) r = { role: roleFromType(t), because: 'type' };
        } else if (lit(n.right)) r = a;
        else if (lit(n.left)) r = b;
        else if (a.role === b.role) r = a;
        else if (n.op === '*' && (a.role === 'mask' || b.role === 'mask')) r = a.role === 'mask' ? b : a;
        else if (n.op === '-' && a.role === 'distance') r = a;
        else r = { role: 'value', because: 'operation' };
        break;
      }
      case 'call': {
        const args = n.args.map(go);
        const c = n.callee;
        const first = args[0] ?? { role: 'unknown', because: 'none' };
        if (/^(length|distance)$/.test(c)) r = { role: 'distance', because: 'operation' };
        else if (c === 'atan') r = { role: 'angle', because: 'operation' };
        else if (/^(smoothstep|step)$/.test(c)) r = { role: 'mask', because: 'operation' };
        else if (c === 'normalize') r = { role: 'direction', because: 'operation' };
        else if (c === 'floor' && first.role === 'space') r = { role: 'cell', because: 'operation' };
        else if (/^(fract|mod|abs|min|max|clamp|mix|pow|sign|floor|ceil|round)$/.test(c)) {
          r = c === 'mix' ? (args[0].role === 'value' && args[1] ? args[1] : first) : first;
          if (r.role === 'time' && c !== 'mod' && c !== 'fract') r = { role: 'value', because: 'operation' };
        }
        else if (/^(sin|cos|tan|exp|exp2|log|log2|sqrt|inversesqrt|dot|asin|acos)$/.test(c)) r = { role: t === 'vec3' ? 'colour' : 'value', because: 'operation' };
        else if (/^vec[234]$/.test(c)) r = { role: roleFromType(t), because: 'type' };
        else if (/^sd[A-Z]/.test(c)) r = { role: 'distance', because: 'operation' };
        else if (c === 'palette' || /^texture/.test(c)) r = { role: 'colour', because: 'operation' };
        else if (c === 'rotate' || /^op[A-Z]/.test(c)) r = { role: 'space', because: 'operation' };
        else { const byType = roleFromType(t); r = { role: byType, because: byType === 'unknown' ? 'none' : 'type' }; }
        break;
      }
    }
    out.set(n.id, r);
    return r;
  };
  go(e);
  return out;
}
