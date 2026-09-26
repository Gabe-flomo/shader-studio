/**
 * Shader facts — what the saved-shader list shows beside a name: how long the
 * file is and whether it draws in 2D or 3D. Nothing is compiled; the guess is
 * read off the text.
 *
 * 3D is decided by score. Each of these adds weight, and any two or a
 * ray-march loop on its own is enough:
 *   - a ray-march loop: a `for` loop whose body calls a float function of a
 *     vec3 (the scene's `map`/`sdf`), or steps a point along `ro + rd * t`
 *   - a ray origin / direction pair (`vec3 ro`, `rd`, `rayDir`, `camPos`…)
 *   - a normal estimate (`calcNormal`, `getNormal`, `estimateNormal`)
 *   - marcher constants (`MAX_STEPS`, `SURF_DIST`, `MAX_DIST`)
 *   - 3D SDF helpers (`sdSphere`, `sdBox`, `opUnion`…) or a `float f(vec3 p)` in the file
 *   - a camera ray built from the pixel (`normalize(vec3(uv, …))`)
 * A shader that only mixes colours over `vec2 uv` scores nothing and reads as 2D.
 */
import { stripComments } from './comments';

export type ShaderDimension = '2d' | '3d';

export interface ShaderFacts {
  /** Lines of source, ignoring a trailing blank line. */
  lines: number;
  /** Functions defined in the file, main() included. */
  functions: number;
  dimension: ShaderDimension;
  /** Why it reads as 3D, in list order; empty for 2D. */
  reasons: string[];
}

const TYPES = 'float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234]|void';

interface Fn { name: string; ret: string; params: string; body: string }

function functions(s: string): Fn[] {
  const out: Fn[] = [];
  const re = new RegExp(`(?:^|[;}\\n])\\s*(${TYPES})\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{`, 'g');
  for (const m of s.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    let d = 0, i = open;
    for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) break; }
    out.push({ name: m[2], ret: m[1], params: m[3], body: s.slice(open + 1, i) });
  }
  return out;
}

/** Bodies of every `for` loop, outermost first (nested loops appear inside their parent's body too). */
function loopBodies(s: string): string[] {
  const out: string[] = [];
  const re = /\bfor\s*\(/g;
  for (const m of s.matchAll(re)) {
    let i = m.index! + m[0].length - 1, d = 0;
    for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; }
    const rest = s.slice(i + 1).match(/^\s*\{/);
    if (!rest) { out.push(s.slice(i + 1).split(/[;\n]/, 1)[0]); continue; }
    const open = i + 1 + rest[0].length - 1;
    let j = open; d = 0;
    for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
    out.push(s.slice(open + 1, j));
  }
  return out;
}

/**
 * A loop marches when it steps a point along a ray, or calls a distance field
 * on a point that the loop itself advances: the field's argument names a
 * variable the body adds to (`map(ro + rd * t)` with `t += d`, or `map(p)`
 * with `p += rd * d`). An fbm loop also calls a float(vec3) function, but on
 * a point it scales, and sums into a separate total, so it doesn't count.
 */
function marches(body: string, fieldCall: RegExp | null): boolean {
  if (STEP_ALONG.test(body)) return true;
  if (!fieldCall) return false;
  const call = body.match(new RegExp(`${fieldCall.source}([^;]*)`));
  if (!call) return false;
  // The argument: everything up to the call's closing paren.
  let d = 0, i = 0; const rest = call[0].slice(call[0].indexOf('('));
  for (; i < rest.length; i++) { if (rest[i] === '(') d++; else if (rest[i] === ')' && --d === 0) break; }
  const arg = rest.slice(1, i);
  const advanced = [...body.matchAll(/\b([A-Za-z_]\w*)(?:\.\w+)?\s*\+=/g)].map(m => m[1]);
  return advanced.some(v => new RegExp(`\\b${v}\\b`).test(arg));
}

const RAY_PAIR = /\bvec3\s+(ro|rd|rayDir|rayOrigin|rayDirection|camPos|cameraPos|cam|eye|dir)\b/;
const NORMAL_FN = /\b(calcNormal|getNormal|estimateNormal|sceneNormal|normalAt|calcNor)\s*\(/;
const MARCH_CONSTS = /\b(MAX_STEPS|MAX_DIST|SURF_DIST|MIN_DIST|MAX_MARCH|MARCH_STEPS|HIT_DIST|EPS_HIT)\b/;
const SDF_HELPERS = /\b(sdSphere|sdBox|sdTorus|sdCapsule|sdPlane|sdCylinder|sdOctahedron|sdRoundBox|opUnion|opSmoothUnion|opSubtraction|opIntersection|opRep)\s*\(/;
const CAMERA_RAY = /normalize\s*\(\s*vec3\s*\(\s*(uv|p|st|q|coord)\b/;
const STEP_ALONG = /\b(ro|rayOrigin|origin|eye|camPos)\s*\+\s*(rd|rayDir|dir|rayDirection)\s*\*|\b(rd|rayDir|dir)\s*\*\s*\w+\s*\+\s*(ro|rayOrigin|origin)\b/;

export function shaderFacts(code: string): ShaderFacts {
  const raw = code.replace(/\s+$/, '');
  const lines = raw ? raw.split('\n').length : 0;
  const s = stripComments(code);
  const fns = functions(s);
  const reasons: string[] = [];
  let score = 0;

  // A float function of a vec3 is a scene distance field (or a noise of space); a loop calling one marches.
  const fields = fns.filter(f => f.ret === 'float' && /\bvec3\s+\w+/.test(f.params) && f.name !== 'main').map(f => f.name);
  const fieldCall = fields.length ? new RegExp(`\\b(${fields.join('|')})\\s*\\(`) : null;
  const loops = loopBodies(s);
  if (loops.some(b => marches(b, fieldCall))) { reasons.push('ray-march loop'); score += 3; }
  else if (fields.length && !/\bvec2\s+\w+/.test(fns.map(f => f.params).join(','))) { reasons.push(`${fields[0]}(vec3)`); score += 1; }

  const pair = s.match(RAY_PAIR); if (pair) { reasons.push(`vec3 ${pair[1]}`); score += 2; }
  const nrm = s.match(NORMAL_FN); if (nrm) { reasons.push(nrm[1]); score += 2; }
  const cst = s.match(MARCH_CONSTS); if (cst) { reasons.push(cst[1]); score += 1; }
  const sdf = s.match(SDF_HELPERS); if (sdf) { reasons.push(sdf[1]); score += 2; }
  if (CAMERA_RAY.test(s)) { reasons.push('camera ray from uv'); score += 2; }

  return { lines, functions: fns.length, dimension: score >= 3 ? '3d' : '2d', reasons: score >= 3 ? reasons : [] };
}

/** "3D · 120 lines · 4 functions", for a tooltip or a meta line. */
export function describeFacts(f: ShaderFacts): string {
  const parts = [f.dimension === '3d' ? '3D' : '2D', `${f.lines} ${f.lines === 1 ? 'line' : 'lines'}`];
  if (f.functions > 1) parts.push(`${f.functions} functions`);
  return parts.join(' · ');
}
