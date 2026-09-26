/**
 * Value roles — what a float, vec2 or vec3 *stands for* in a shader.
 *
 * A type says how many numbers travel; a role says what they mean: a vec2
 * is usually a position, a vec3 a colour or a direction, a float a time, a
 * distance, an angle, a seed. Knowing the role lets the app do the obvious
 * thing without asking: feed UV into a position parameter when previewing a
 * function, Time into a time parameter, draw a distance as a signed field
 * rather than a grey ramp, and describe a call site in words.
 *
 * Everything here is a heuristic over names and usage; each answer carries
 * its evidence and a confidence, so a UI can say "position (called with uv,
 * used in length())" and let the person override it.
 */
import type { DiscoveredFn } from './discover';

export type ValueRole =
  | 'position'   // a point on the picture (vec2) or in space (vec3)
  | 'uv01'       // a 0..1 texture coordinate
  | 'time'       // seconds, or a phase that grows with time
  | 'distance'   // a signed distance, negative inside
  | 'colour'     // rgb 0..1
  | 'direction'  // a unit vector (ray direction, velocity)
  | 'normal'     // a surface normal
  | 'seed'       // something hashed for randomness
  | 'angle'      // radians
  | 'scale'      // a size, radius, frequency or amount
  | 'scalar'     // a plain 0..1-ish number
  | 'unknown';

export interface RoleInfo { label: string; hint: string }
export const ROLE_INFO: Record<ValueRole, RoleInfo> = {
  position:  { label: 'position',  hint: 'A point: the pixel’s coordinates, or a point moved around them.' },
  uv01:      { label: 'uv 0–1',    hint: 'A texture coordinate from 0 to 1 across the picture.' },
  time:      { label: 'time',      hint: 'Seconds, or a phase that keeps growing.' },
  distance:  { label: 'distance',  hint: 'A signed distance: negative inside a shape, positive outside.' },
  colour:    { label: 'colour',    hint: 'Red, green, blue from 0 to 1.' },
  direction: { label: 'direction', hint: 'A unit vector: a ray or a velocity.' },
  normal:    { label: 'normal',    hint: 'The direction a surface faces.' },
  seed:      { label: 'seed',      hint: 'Fed to a hash for randomness; only its pattern matters.' },
  angle:     { label: 'angle',     hint: 'Radians.' },
  scale:     { label: 'amount',    hint: 'A size, radius, frequency or strength.' },
  scalar:    { label: 'number',    hint: 'A plain number, usually 0 to 1.' },
  unknown:   { label: 'value',     hint: 'Nothing in the code says what it stands for.' },
};

export interface RoleGuess { role: ValueRole; confidence: number; because: string[] }
export interface ParamRole extends RoleGuess { name: string; type: string }

type Score = Partial<Record<ValueRole, { s: number; why: string[] }>>;
const add = (sc: Score, role: ValueRole, s: number, why: string) => { const e = (sc[role] ??= { s: 0, why: [] }); e.s += s; if (!e.why.includes(why)) e.why.push(why); };

/** What an expression handed to a parameter suggests: names and calls in it. */
export function roleOfExpression(expr: string): Score {
  const sc: Score = {};
  const e = expr.trim();
  if (/\b(gl_FragCoord|fragCoord|iResolution|u_resolution)\b/.test(e) || /^(uv|st|p|pos|pt|q|coord|position)$/.test(e) || /^(uv|st|p|q|pos)\s*[*+\-/]/.test(e) || /\b(uv|st|pos)\b/.test(e)) add(sc, 'position', 2, `called with ${short(e)}`);
  if (/\b(u_time|iTime|iGlobalTime|time)\b/.test(e) || /^t$/.test(e)) add(sc, 'time', 3, `called with ${short(e)}`);
  if (/\b(length|distance)\s*\(/.test(e) || /\b(sd[A-Z]\w*|map|scene|dist|de)\s*\(/.test(e) || /^d$/.test(e)) add(sc, 'distance', 2, `called with ${short(e)}`);
  if (/\b(col|color|colour|rgb|albedo|tint)\w*\b/i.test(e) || /\b(palette|hsv2rgb|hsl2rgb)\s*\(/.test(e)) add(sc, 'colour', 2, `called with ${short(e)}`);
  if (/\bnormalize\s*\(/.test(e) || /\b(rd|dir|ray|rayDir|vel|velocity)\b/.test(e)) add(sc, 'direction', 2, `called with ${short(e)}`);
  if (/\b(n|nor|normal|nrm)\b/.test(e) && !/\bnoise\b/.test(e)) add(sc, 'normal', 1.5, `called with ${short(e)}`);
  if (/\b(hash|rand|random|seed)\w*\b/i.test(e) || /\bfloor\s*\(/.test(e)) add(sc, 'seed', 1.5, `called with ${short(e)}`);
  if (/\b(angle|theta|phi|rot|a)\b/.test(e) || /\batan\s*\(/.test(e) || /\bPI\b|3\.14/.test(e)) add(sc, 'angle', 1.5, `called with ${short(e)}`);
  if (/\b(r|rad|radius|size|scale|freq|frequency|amount|strength|k|w|width)\b/.test(e)) add(sc, 'scale', 1.5, `called with ${short(e)}`);
  if (/^-?\d*\.?\d+$/.test(e)) add(sc, 'scalar', 0.5, `called with the constant ${e}`);
  return sc;
}

const short = (e: string) => (e.length > 24 ? `${e.slice(0, 22)}…` : e);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the body does with a parameter. */
function roleOfUse(name: string, type: string, body: string): Score {
  const sc: Score = {};
  const n = esc(name);
  const has = (re: RegExp) => re.test(body);
  const rx = (t: string) => new RegExp(t.replace(/NAME/g, n));
  // Name alone carries a lot in shader culture.
  if (/^(uv|st|p|pos|pt|q|coord|fragCoord|position)$/i.test(name)) add(sc, 'position', 2, `named ${name}`);
  if (/^(t|time|iTime|phase)$/i.test(name)) add(sc, 'time', 2.5, `named ${name}`);
  if (/^(d|dist|sd|sdf)$/i.test(name)) add(sc, 'distance', 2, `named ${name}`);
  if (/^(col|color|colour|rgb|c|albedo|tint|base)$/i.test(name)) add(sc, 'colour', 2, `named ${name}`);
  if (/^(rd|dir|ray|rayDir|v|vel)$/i.test(name)) add(sc, 'direction', 2, `named ${name}`);
  if (/^(n|nor|normal|nrm)$/i.test(name)) add(sc, 'normal', 2, `named ${name}`);
  if (/^(seed|h|hash|id|cell)$/i.test(name)) add(sc, 'seed', 1.5, `named ${name}`);
  if (/^(a|ang|angle|theta|phi|rot)$/i.test(name)) add(sc, 'angle', 1.5, `named ${name}`);
  if (/^(r|rad|radius|s|size|scale|k|freq|amp|w|width|strength|amount)$/i.test(name)) add(sc, 'scale', 1.5, `named ${name}`);
  // Usage.
  if (has(rx(String.raw`\blength\s*\(\s*NAME\b`)) || has(rx(String.raw`\bdistance\s*\(\s*NAME\b`))) add(sc, 'position', 2, `length(${name})`);
  if (has(rx(String.raw`\bfract\s*\(\s*NAME\b`)) || has(rx(String.raw`\bfloor\s*\(\s*NAME\b`))) add(sc, type === 'float' ? 'seed' : 'position', 1, `fract/floor(${name})`);
  if (has(rx(String.raw`\bNAME\s*\.\s*[xy]\b`)) && (type === 'vec2' || type === 'vec3')) add(sc, 'position', 1, `${name}.x / .y`);
  // cos(a) on its own is an angle; sin(t * 3.0 + phase) is time or a phase.
  if (has(rx(String.raw`\b(sin|cos)\s*\(\s*NAME\s*\)`)) && type === 'float') add(sc, 'angle', 2.5, `cos(${name}) / sin(${name})`);
  else if (has(rx(String.raw`\b(sin|cos)\s*\(\s*[^;)]*\bNAME\b`))) add(sc, type === 'float' ? 'time' : 'position', 1.5, `inside sin/cos with ${name}`);
  if (has(rx(String.raw`\bNAME\s*\*\s*[\d.]+\s*\+`)) && type === 'float') add(sc, 'time', 0.5, `${name} × rate + phase`);
  if (has(rx(String.raw`\bsmoothstep\s*\([^;]*,\s*NAME\s*\)`)) || has(rx(String.raw`\babs\s*\(\s*NAME\s*\)`)) || has(rx(String.raw`\bNAME\s*<\s*0\.0*\b`)) || has(rx(String.raw`\bexp\s*\(\s*-\s*NAME\b`))) add(sc, 'distance', 1.5, `thresholded / |${name}|`);
  if (has(rx(String.raw`\bmix\s*\(\s*NAME\b`)) && type === 'vec3') add(sc, 'colour', 1.5, `mix(${name}, …)`);
  if (has(rx(String.raw`\bNAME\s*\.\s*(rgb|rg|[rgb])\b`))) add(sc, 'colour', 2, `${name}.rgb`);
  if (has(rx(String.raw`\bdot\s*\(\s*NAME\b`)) || has(rx(String.raw`\breflect\s*\([^,]*,\s*NAME\b`)) || has(rx(String.raw`\bnormalize\s*\(\s*NAME\b`))) add(sc, type === 'vec3' ? 'direction' : 'position', 1.5, `dot/normalize with ${name}`);
  if (has(rx(String.raw`\bdot\s*\(\s*NAME\s*,\s*vec[23]\s*\(\s*\d`))) add(sc, 'seed', 2, `hashed: dot(${name}, constants)`);
  if (has(rx(String.raw`\bmat2\s*\(\s*cos\s*\(\s*NAME\b`))) add(sc, 'angle', 1.5, `a rotation by ${name}`);
  if (has(rx(String.raw`\bNAME\s*\*\s*(uv|p|st|pos|q)\b`)) || has(rx(String.raw`\b(uv|p|st|pos|q)\s*\*\s*NAME\b`))) add(sc, 'scale', 1.5, `scales a position`);
  if (has(rx(String.raw`-\s*NAME\s*[;)]`)) && type === 'float') add(sc, 'scale', 1, `subtracted: a radius`);
  return sc;
}

function pick(sc: Score, fallback: ValueRole): RoleGuess {
  const entries = Object.entries(sc) as Array<[ValueRole, { s: number; why: string[] }]>;
  if (!entries.length) return { role: fallback, confidence: 0, because: [] };
  entries.sort((a, b) => b[1].s - a[1].s);
  const [role, best] = entries[0];
  const second = entries[1]?.[1].s ?? 0;
  const confidence = Math.max(0, Math.min(1, (best.s - second * 0.5) / 5));
  return { role, confidence, because: best.why.slice(0, 3) };
}

const fallbackFor = (type: string): ValueRole => (type === 'vec2' ? 'position' : type === 'vec3' ? 'colour' : type === 'float' ? 'scalar' : 'unknown');

/** A role for each parameter, from its name, how the body uses it, and what the file passes to it. */
export function inferParamRoles(fn: DiscoveredFn): ParamRole[] {
  const body = fn.text.slice(fn.text.indexOf('{'));
  return fn.params.map((p, i) => {
    const sc = roleOfUse(p.name, p.type, body);
    for (const site of fn.callSites) {
      const arg = site.args[i];
      if (!arg) continue;
      const from = roleOfExpression(arg);
      for (const [role, e] of Object.entries(from) as Array<[ValueRole, { s: number; why: string[] }]>) add(sc, role, e.s * 0.6, e.why[0]);
    }
    // Types rule some roles out.
    for (const role of Object.keys(sc) as ValueRole[]) {
      if (p.type === 'float' && (role === 'position' || role === 'colour' || role === 'direction' || role === 'normal' || role === 'uv01')) delete sc[role];
      if (p.type !== 'float' && (role === 'time' || role === 'distance' || role === 'angle' || role === 'scale' || role === 'scalar')) delete sc[role];
      if (p.type === 'vec2' && (role === 'colour' || role === 'normal')) delete sc[role];
    }
    return { name: p.name, type: p.type, ...pick(sc, fallbackFor(p.type)) };
  });
}

/** What the function returns: a distance, a colour, a position, a plain number. */
export function inferReturnRole(fn: DiscoveredFn): RoleGuess {
  const sc: Score = {};
  const body = fn.text.slice(fn.text.indexOf('{'));
  const t = fn.returnType;
  if (/^(sd|sdf)[A-Z_]/.test(fn.name) || /^(map|scene|dist|de|sdf)$/i.test(fn.name)) add(sc, 'distance', 3, `named ${fn.name}`);
  if (/\breturn\s+[^;]*\blength\s*\([^;]*\)\s*-\s*/.test(body) && t === 'float') add(sc, 'distance', 3, 'returns length(…) − r');
  if (/\breturn\s+(min|max|smin|opUnion|opSmoothUnion)\s*\(/.test(body) && t === 'float') add(sc, 'distance', 1.5, 'returns min/max of fields');
  if (/\b(palette|pal|col|color|colour|rgb|hsv2rgb|shade|tint)/i.test(fn.name) && t === 'vec3') add(sc, 'colour', 3, `named ${fn.name}`);
  if (/0\.5\s*\+\s*0\.5\s*\*\s*cos/.test(body) && t === 'vec3') add(sc, 'colour', 3, 'cosine palette');
  if (/\bclamp\s*\([^;]*,\s*0\.0*\s*,\s*1\.0*\s*\)/.test(body) && t === 'vec3') add(sc, 'colour', 1, 'clamped to 0–1');
  if (/\b(hash|rand|random|noise|fbm|vnoise|snoise)/i.test(fn.name)) add(sc, t === 'float' ? 'scalar' : 'position', 2, `named ${fn.name}`);
  if (/\b(rot|rotate|warp|twist|fold|repeat|tile|mirror|kaleido|polar)/i.test(fn.name) && t === 'vec2') add(sc, 'position', 3, `named ${fn.name}`);
  if (/\bmat2\s*\(/.test(body) && t === 'vec2') add(sc, 'position', 2, 'a rotation matrix');
  if (/\bnormalize\s*\(/.test(body) && /\breturn\s+normalize/.test(body)) add(sc, t === 'vec3' ? 'direction' : 'position', 2, 'returns normalize(…)');
  if (/\b(normal|nor|calcNormal|getNormal)/i.test(fn.name) && t === 'vec3') add(sc, 'normal', 3, `named ${fn.name}`);
  for (const role of Object.keys(sc) as ValueRole[]) {
    if (t === 'float' && (role === 'position' || role === 'colour' || role === 'direction' || role === 'normal')) delete sc[role];
    if (t !== 'float' && (role === 'distance' || role === 'time' || role === 'scalar')) delete sc[role];
  }
  return pick(sc, fallbackFor(t));
}

/** One line for a call site: “noise(uv × 4, time) → a number” in words, from the roles. */
export function describeCall(fn: DiscoveredFn, roles: ParamRole[], ret: RoleGuess): string {
  const args = roles.map(r => `${r.name} (${ROLE_INFO[r.role].label})`).join(', ');
  return `${fn.name}(${args}) → ${ROLE_INFO[ret.role].label}`;
}
