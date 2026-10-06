/**
 * The deterministic expression explainer. No AI, no network: idioms first (idioms.ts), then
 * the rest inside-out with one template per function and operator, worded by the role of
 * what it acts on (roles.ts). Unknown functions get literal wording ("calls foo(a, b)"); the
 * explainer never guesses past its rules.
 *
 *   explainExpression('fract(sin(uv * 3.0) * 2.0)', { types: { uv: 'vec2' } })
 *   → sentence: "Repeating 0–1 ramps of sine waves of uv zoomed out 3×, doubled."
 *     steps:    A = uv * 3.0     zooms uv out 3× (3× as much fits)
 *               B = sin(A)       takes the sine of each coordinate of the zoomed space: waves from −1 to 1
 *               C = B * 2.0      doubles the wave (now −2…2)
 *               fract(C)         keeps the fractional part of the doubled wave: repeating 0…1 ramps
 */
import { childrenOf, type Expr, type GlslType } from './ast';
import { parseExpr, parseLine, type ParsedLine } from './parse';
import { inferTypes, type TypeEnv } from './types';
import { inferRoles, type Role, type RoleEnv, type RoleInfo } from './roles';
import { IDIOMS, type Idiom, type IdiomText } from './idioms';
import { constValue, matchNormalized, compilePattern, normalize, type Bindings, type N } from './match';

export interface ExplainContext {
  /** Types of the names in scope (inputs, locals, parameters). Globals (u_time, uv…) are known already. */
  types?: TypeEnv;
  /** Roles known for certain, e.g. from the graph: an input wired from a UV node is space. */
  roles?: RoleEnv;
  /** Turn idiom recognition off (tests, or to see the plain composition). */
  noIdioms?: boolean;
}

/** One recognised idiom in an expression. */
export interface IdiomHit {
  idiom: Idiom;
  /** The node it matched. */
  node: Expr;
  bindings: Bindings;
  /** The spelling (one of `idiom.patterns`) that matched. */
  pattern: string;
}

/** What one node of the tree is, in words. */
export interface Desc {
  node: Expr;
  code: string;
  type: GlslType;
  role: Role;
  /** Leaves (names, numbers, `p.x`) make no step of their own. */
  leaf: boolean;
  /** A noun phrase for the value, composed from its parts ("sine waves of uv zoomed out 3×"). */
  noun: string;
  /** A short noun phrase used when later steps refer to it ("the wave"). */
  short: string;
  /** What this node does, as a verb phrase. */
  how: string;
  /** Known value range per component, when the rules can tell. */
  range?: [number, number];
  value?: number;
  idiom?: IdiomHit;
  /** Its step's label (A, B, …), when it has a step. */
  label?: string;
}

/** One line of the "First … then …" breakdown. */
export interface Step {
  label: string;
  /** The node's code, with earlier steps' parts replaced by their labels: `sin(A)`. */
  code: string;
  /** What it does. */
  text: string;
  /** The span to highlight, in the explained text's coordinates. */
  start: number;
  end: number;
  node: Expr;
  idiom?: { id: string; name: string };
  type: GlslType;
  role: Role;
}

export interface Explanation {
  ok: true;
  /** One short sentence for the whole thing. */
  sentence: string;
  /** Inside-out, the order GLSL computes them. */
  steps: Step[];
  /** The steps as prose: "First, … Then, … Finally, …". */
  breakdown: string;
  type: GlslType;
  role: Role;
  idioms: IdiomHit[];
  root: Expr;
  /** The text the spans refer to. */
  source: string;
  descs: Map<number, Desc>;
}

export type ExplainResult = Explanation | { ok: false; error: string };

// ── Number formatting for prose ───────────────────────────────────────────────

/** 3 → "3", 0.25 → "0.25", 6.2832 → "2π", -1 → "−1". */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  for (const [k, s] of [[1, 'π'], [2, '2π'], [0.5, 'π/2'], [0.25, 'π/4'], [4, '4π']] as const) {
    if (Math.abs(a - k * Math.PI) < 2e-4 * k * Math.PI) return sign + s;
  }
  const r = parseFloat(a.toPrecision(4));
  return sign + String(r);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const rangeText = (r?: [number, number]) => (r ? `${fmt(r[0])}…${fmt(r[1])}` : '');

// ── Templates ─────────────────────────────────────────────────────────────────

interface TC {
  node: Expr;
  a: Desc[];
  type: GlslType;
  role: Role;
  /** A part as a phrase inside a noun (full noun when short enough). */
  n(i: number): string;
  /** A part as a phrase inside a step's text (its short noun, or its code for a leaf). */
  s(i: number): string;
  /** A part inside a list (a vector's components): its code when short, else its short noun. */
  p(i: number): string;
  /** A part's value when it is a constant. */
  lit(i: number): number | undefined;
}

interface Words { noun: string; short: string; how: string; range?: [number, number] }

const scaleRange = (r: [number, number] | undefined, k: number): [number, number] | undefined => (r ? (k >= 0 ? [r[0] * k, r[1] * k] : [r[1] * k, r[0] * k]) : undefined);
const shiftRange = (r: [number, number] | undefined, k: number): [number, number] | undefined => (r ? [r[0] + k, r[1] + k] : undefined);

/** `x * k` with a literal k, by what x stands for. */
function scaleWords(c: TC, xi: number, k: number): Words {
  const x = c.a[xi];
  const r = scaleRange(x.range, k);
  const now = r && x.range ? ` (now ${rangeText(r)})` : '';
  if (k === 1) return { noun: c.n(xi), short: x.short, how: `multiplies ${c.s(xi)} by 1, which changes nothing`, range: x.range };
  if (k === 0) return { noun: 'zero', short: 'zero', how: `multiplies ${c.s(xi)} by 0: always 0`, range: [0, 0] };
  switch (x.role) {
    case 'space': {
      if (k === -1) return { noun: `${c.n(xi)} mirrored`, short: 'the mirrored space', how: `mirrors ${c.s(xi)} through the origin (turns it half a turn)`, range: r };
      const m = Math.abs(k);
      const mirror = k < 0 ? 'mirrors and ' : '';
      if (m > 1) return { noun: `${c.n(xi)} zoomed out ${fmt(m)}×`, short: 'the zoomed space', how: `${mirror}zooms ${c.s(xi)} out ${fmt(m)}× (${fmt(m)}× as much fits; anything drawn in it gets ${fmt(m)}× smaller)`, range: r };
      return { noun: `${c.n(xi)} zoomed in ${fmt(1 / m)}×`, short: 'the zoomed space', how: `${mirror}zooms ${c.s(xi)} in ${fmt(1 / m)}× (anything drawn in it gets ${fmt(1 / m)}× bigger)`, range: r };
    }
    case 'colour':
      if (k > 1) return { noun: `${c.n(xi)}, ${fmt(k)}× brighter`, short: 'the brighter colour', how: `makes ${c.s(xi)} ${fmt(k)}× brighter`, range: r };
      if (k > 0) return { noun: `${c.n(xi)}, darkened to ${fmt(k * 100)}%`, short: 'the darker colour', how: `darkens ${c.s(xi)} to ${fmt(k * 100)}% of its brightness`, range: r };
      return { noun: `${c.n(xi)} times ${fmt(k)}`, short: 'the negated colour', how: `multiplies ${c.s(xi)} by ${fmt(k)}: negative channels draw as black`, range: r };
    case 'time':
      if (k > 0) return { noun: `${c.n(xi)} ${k > 1 ? `${fmt(k)}× faster` : `${fmt(1 / k)}× slower`}`, short: 'the scaled time', how: k > 1 ? `runs ${c.s(xi)} ${fmt(k)}× faster` : `runs ${c.s(xi)} ${fmt(1 / k)}× slower`, range: r };
      return { noun: `${c.n(xi)} running backwards`, short: 'the reversed time', how: `runs ${c.s(xi)} backwards${k !== -1 ? `, ${fmt(-k)}× as fast` : ''}`, range: r };
    case 'angle':
      return { noun: `${c.n(xi)} × ${fmt(k)}`, short: 'the angle', how: `multiplies the angle ${c.s(xi)} by ${fmt(k)}`, range: r };
    case 'distance':
      return { noun: `${c.n(xi)} scaled ${fmt(k)}×`, short: 'the scaled distance', how: `scales the distance ${c.s(xi)} by ${fmt(k)}${k > 1 ? ', so it changes faster (sharper edges, smaller glows)' : ''}`, range: r };
    default: {
      if (Math.abs(Math.abs(k) - 2 * Math.PI) < 1e-3 && x.range && x.range[0] >= 0 && x.range[1] <= 1) {
        return { noun: `${c.n(xi)} as an angle`, short: 'the angle', how: `turns ${c.s(xi)} (0…1) into an angle: a full turn, 0…2π`, range: r };
      }
      const word = k === 2 ? 'doubles' : k === 0.5 ? 'halves' : k === -1 ? 'negates' : null;
      if (word) return { noun: `${c.n(xi)}, ${word === 'doubles' ? 'doubled' : word === 'halves' ? 'halved' : 'negated'}`, short: `the ${word === 'doubles' ? 'doubled' : word === 'halves' ? 'halved' : 'negated'} ${x.short.replace(/^the /, '')}`, how: `${word} ${c.s(xi)}${now}`, range: r };
      return { noun: `${c.n(xi)} × ${fmt(k)}`, short: `the scaled ${x.short.replace(/^the /, '')}`, how: `scales ${c.s(xi)} by ${fmt(k)}${now}`, range: r };
    }
  }
}

/** `x + k` with a literal k (k may be negative: `x - 0.5`). */
function shiftWords(c: TC, xi: number, k: number): Words {
  const x = c.a[xi];
  const r = shiftRange(x.range, k);
  const now = r && x.range ? ` (now ${rangeText(r)})` : '';
  const by = fmt(Math.abs(k));
  switch (x.role) {
    case 'space': return { noun: `${c.n(xi)} shifted by ${fmt(k)}`, short: 'the shifted space', how: `shifts ${c.s(xi)} by ${fmt(k)}, which moves whatever is drawn in it by ${fmt(-k)}`, range: r };
    case 'colour': return k > 0
      ? { noun: `${c.n(xi)} lifted by ${by}`, short: 'the lifted colour', how: `adds ${by} to every channel of ${c.s(xi)}: brighter and greyer`, range: r }
      : { noun: `${c.n(xi)} lowered by ${by}`, short: 'the lowered colour', how: `takes ${by} off every channel of ${c.s(xi)}: darker, more contrast in the darks`, range: r };
    case 'time': return { noun: `time ${k > 0 ? 'plus' : 'minus'} ${by}`, short: 'the offset time', how: `offsets ${c.s(xi)} by ${fmt(k)} seconds`, range: r };
    case 'distance': return k < 0
      ? { noun: `${c.n(xi)} grown by ${by}`, short: 'the grown shape', how: `subtracts ${by} from the distance ${c.s(xi)}: the shape grows by ${by} (rounder corners)`, range: r }
      : { noun: `${c.n(xi)} shrunk by ${by}`, short: 'the shrunk shape', how: `adds ${by} to the distance ${c.s(xi)}: the shape shrinks by ${by}`, range: r };
    default: return { noun: `${c.n(xi)} ${k > 0 ? 'plus' : 'minus'} ${by}`, short: `the shifted ${x.short.replace(/^the /, '')}`, how: `${k > 0 ? 'adds' : 'subtracts'} ${by} ${k > 0 ? 'to' : 'from'} ${c.s(xi)}${now}`, range: r };
  }
}

function binaryWords(c: TC, op: string): Words {
  const [A, B] = c.a;
  const la = c.lit(0), lb = c.lit(1);
  if (op === '*') {
    if (lb !== undefined && la === undefined) return scaleWords(c, 0, lb);
    if (la !== undefined && lb === undefined) return scaleWords(c, 1, la);
    if (A.type.startsWith('mat') || B.type.startsWith('mat')) {
      const [m, v] = A.type.startsWith('mat') ? [0, 1] : [1, 0];
      return { noun: `${c.n(v)} transformed by ${c.n(m)}`, short: 'the transformed point', how: `transforms ${c.s(v)} by the matrix ${c.s(m)}` };
    }
    if (A.role === 'colour' && B.role === 'colour') return { noun: `${c.n(0)}, tinted by ${c.n(1)}`, short: 'the tinted colour', how: `tints ${c.s(0)} by ${c.s(1)}, channel by channel (multiply)` };
    const col = A.role === 'colour' ? 0 : B.role === 'colour' ? 1 : -1;
    if (col >= 0 && c.a[1 - col].type === 'float') {
      const o = 1 - col;
      return { noun: `${c.n(col)}, masked by ${c.n(o)}`, short: 'the masked colour', how: `shows ${c.s(col)} where ${c.s(o)} is 1 and fades it to black where it is 0` };
    }
    const sp = A.role === 'space' ? 0 : B.role === 'space' ? 1 : -1;
    if (sp >= 0 && c.a[1 - sp].type === 'float') return { noun: `${c.n(sp)} scaled by ${c.n(1 - sp)}`, short: 'the scaled space', how: `scales ${c.s(sp)} by ${c.s(1 - sp)}: bigger values zoom out` };
    const tm = A.role === 'time' ? 0 : B.role === 'time' ? 1 : -1;
    if (tm >= 0) return { noun: `${c.n(tm)} times ${c.n(1 - tm)}`, short: 'the scaled time', how: `multiplies the time ${c.s(tm)} by ${c.s(1 - tm)} (a speed)` };
    const mk = A.role === 'mask' ? 0 : B.role === 'mask' ? 1 : -1;
    if (mk >= 0) return { noun: `${c.n(1 - mk)} masked by ${c.n(mk)}`, short: 'the masked value', how: `keeps ${c.s(1 - mk)} where ${c.s(mk)} is 1, 0 where it is 0` };
    return { noun: `${c.n(0)} times ${c.n(1)}`, short: 'the product', how: `multiplies ${c.s(0)} by ${c.s(1)}` };
  }
  if (op === '/') {
    if (lb !== undefined && lb !== 0 && la === undefined) {
      const w = scaleWords(c, 0, 1 / lb);
      if (A.role === 'space' || A.role === 'colour' || A.role === 'time') return w;
      return { ...w, how: `divides ${c.s(0)} by ${fmt(lb)}${w.range && A.range ? ` (now ${rangeText(w.range)})` : ''}` };
    }
    if (la !== undefined && lb === undefined) return { noun: `${fmt(la)} divided by ${c.n(1)}`, short: 'the inverse', how: `divides ${fmt(la)} by ${c.s(1)}: large where it is small, shooting up near 0` };
    if (A.role === 'space') return { noun: `${c.n(0)} divided by ${c.n(1)}`, short: 'the scaled space', how: `divides ${c.s(0)} by ${c.s(1)}: bigger values zoom in` };
    return { noun: `${c.n(0)} divided by ${c.n(1)}`, short: 'the ratio', how: `divides ${c.s(0)} by ${c.s(1)}` };
  }
  if (op === '+') {
    if (lb !== undefined && la === undefined) return shiftWords(c, 0, lb);
    if (la !== undefined && lb === undefined) return shiftWords(c, 1, la);
    if (A.role === 'colour' && B.role === 'colour') return { noun: `${c.n(0)} plus ${c.n(1)}`, short: 'the combined light', how: `adds the light of ${c.s(1)} to ${c.s(0)}` };
    if (A.role === 'space' && B.type === A.type) return { noun: `${c.n(0)} offset by ${c.n(1)}`, short: 'the offset space', how: `offsets ${c.s(0)} by ${c.s(1)}` };
    if (B.role === 'time' || A.role === 'time') { const t = B.role === 'time' ? 1 : 0; return { noun: `${c.n(1 - t)} moving with ${c.n(t)}`, short: 'the moving value', how: `adds ${c.s(t)} to ${c.s(1 - t)}, so it moves over time` }; }
    return { noun: `${c.n(0)} plus ${c.n(1)}`, short: 'the sum', how: `adds ${c.s(0)} and ${c.s(1)}` };
  }
  if (op === '-') {
    if (lb !== undefined && la === undefined) return shiftWords(c, 0, -lb);
    if (la !== undefined && lb === undefined) {
      return { noun: `${fmt(la)} minus ${c.n(1)}`, short: `the flipped ${B.short.replace(/^the /, '')}`, how: `subtracts ${c.s(1)} from ${fmt(la)}${B.range ? ` (now ${rangeText([la - B.range[1], la - B.range[0]])})` : ''}`, range: B.range ? [la - B.range[1], la - B.range[0]] : undefined };
    }
    if (A.role === 'space' && B.type === A.type) return { noun: `${c.n(0)} relative to ${c.n(1)}`, short: 'the moved space', how: `measures ${c.s(0)} from ${c.s(1)}: ${c.s(1)} becomes the new origin` };
    if (A.role === 'distance' && B.type === 'float') return { noun: `${c.n(0)} grown by ${c.n(1)}`, short: 'the grown shape', how: `subtracts ${c.s(1)} from the distance ${c.s(0)}: the shape grows by that much` };
    if (A.role === 'colour' && B.role === 'colour') return { noun: `${c.n(0)} minus ${c.n(1)}`, short: 'the difference', how: `takes ${c.s(1)} away from ${c.s(0)}, channel by channel` };
    if (B.role === 'time') return { noun: `${c.n(0)} moving with time`, short: 'the moving value', how: `subtracts ${c.s(1)} from ${c.s(0)}, so it moves over time` };
    return { noun: `${c.n(0)} minus ${c.n(1)}`, short: 'the difference', how: `subtracts ${c.s(1)} from ${c.s(0)}` };
  }
  if (op === '%') return { noun: `${c.n(0)} modulo ${c.n(1)}`, short: 'the remainder', how: `takes the remainder of ${c.s(0)} divided by ${c.s(1)}` };
  const cmp: Record<string, string> = { '<': 'is less than', '>': 'is greater than', '<=': 'is at most', '>=': 'is at least', '==': 'equals', '!=': 'differs from' };
  if (cmp[op]) return { noun: `${c.n(0)} ${cmp[op]} ${c.n(1)}`, short: 'the test', how: `tests whether ${c.s(0)} ${cmp[op]} ${c.s(1)} (true or false)` };
  if (op === '&&') return { noun: `${c.n(0)} and ${c.n(1)}`, short: 'the test', how: `is true only when ${c.s(0)} and ${c.s(1)} are both true` };
  if (op === '||') return { noun: `${c.n(0)} or ${c.n(1)}`, short: 'the test', how: `is true when ${c.s(0)} or ${c.s(1)} is true` };
  return { noun: `${c.n(0)} ${op} ${c.n(1)}`, short: 'the result', how: `computes ${c.s(0)} ${op} ${c.s(1)}` };
}

const SWZ_NAME: Record<string, string> = { x: 'x', y: 'y', z: 'z', w: 'w', r: 'red', g: 'green', b: 'blue', a: 'alpha', s: 's', t: 't', p: 'p', q: 'q' };

function memberWords(c: TC, field: string): Words {
  const o = c.a[0];
  if (field.length === 1) {
    const nm = SWZ_NAME[field] ?? field;
    const what = /[rgba]/.test(field) || o.role === 'colour' ? `the ${nm === field ? field : nm} channel` : `the ${nm} coordinate`;
    return { noun: `${what} of ${c.n(0)}`, short: what, how: `takes ${what} of ${c.s(0)}`, range: o.range };
  }
  if (/^(xyz|rgb)$/.test(field) && o.type === 'vec4') return { noun: `${c.n(0)} without its fourth component`, short: o.short, how: `drops the fourth component (alpha) of ${c.s(0)}` };
  if (/^(xyz|rgb)$/.test(field)) return { noun: c.n(0), short: o.short, how: `takes all three components of ${c.s(0)}, unchanged` };
  if (/^(yx|gr)$/.test(field)) return { noun: `${c.n(0)} with x and y swapped`, short: 'the swapped point', how: `swaps the x and y of ${c.s(0)} (a mirror along the diagonal)` };
  if (/^(xy|rg|st)$/.test(field)) return { noun: `the first two components of ${c.n(0)}`, short: o.short, how: `takes the first two components of ${c.s(0)}` };
  return { noun: `components .${field} of ${c.n(0)}`, short: `${c.s(0)}.${field}`, how: `picks components .${field} of ${c.s(0)}` };
}

const FN_RANGE: Record<string, [number, number]> = { sin: [-1, 1], cos: [-1, 1], fract: [0, 1], smoothstep: [0, 1], step: [0, 1], sign: [-1, 1] };

function callWords(c: TC, callee: string): Words {
  const k = (i: number) => c.lit(i);
  const isSpace = c.a[0]?.role === 'space' && c.a[0]?.type !== 'float';
  const r0 = c.a[0]?.range;
  switch (callee) {
    case 'sin': case 'cos': {
      const nm = callee === 'sin' ? 'sine' : 'cosine';
      return isSpace
        ? { noun: `${nm} waves of ${c.n(0)}`, short: 'the waves', how: `takes the ${nm} of each coordinate of ${c.s(0)}: waves from −1 to 1, one every 2π`, range: [-1, 1] }
        : { noun: `a ${nm} wave of ${c.n(0)}`, short: 'the wave', how: `takes the ${nm} of ${c.s(0)}: a wave from −1 to 1 that repeats every 2π`, range: [-1, 1] };
    }
    case 'tan': return { noun: `the tangent of ${c.n(0)}`, short: 'the tangent', how: `takes the tangent of ${c.s(0)}: repeats every π and shoots off to ±infinity` };
    case 'asin': case 'acos': return { noun: `the angle whose ${callee === 'asin' ? 'sine' : 'cosine'} is ${c.n(0)}`, short: 'the angle', how: `finds the angle (radians) whose ${callee === 'asin' ? 'sine' : 'cosine'} is ${c.s(0)}` };
    case 'atan':
      if (c.a.length === 2) return { noun: `the angle of (${c.n(1)}, ${c.n(0)})`, short: 'the angle', how: `measures the angle of the point (x = ${c.s(1)}, y = ${c.s(0)}) around the origin, −π…π`, range: [-Math.PI, Math.PI] };
      return { noun: `the arctangent of ${c.n(0)}`, short: 'the angle', how: `takes the arctangent of ${c.s(0)}: an angle between −π/2 and π/2`, range: [-Math.PI / 2, Math.PI / 2] };
    case 'exp': return { noun: `the exponential of ${c.n(0)}`, short: 'the exponential', how: `raises e to the power ${c.s(0)}: 1 at 0, growing fast above and dying away below` };
    case 'exp2': return { noun: `2 to the power ${c.n(0)}`, short: 'the power of two', how: `raises 2 to the power ${c.s(0)}` };
    case 'log': return { noun: `the natural log of ${c.n(0)}`, short: 'the log', how: `takes the natural logarithm of ${c.s(0)}: squeezes big values together` };
    case 'log2': return { noun: `the base-2 log of ${c.n(0)}`, short: 'the log', how: `takes the base-2 logarithm of ${c.s(0)}` };
    case 'sqrt': return { noun: `the square root of ${c.n(0)}`, short: 'the root', how: `takes the square root of ${c.s(0)}: lifts small values` };
    case 'inversesqrt': return { noun: `1 over the square root of ${c.n(0)}`, short: 'the inverse root', how: `takes 1 ÷ √${c.s(0)}` };
    case 'pow': {
      const e = k(1);
      if (e === 2) return { noun: `${c.n(0)} squared`, short: 'the square', how: `squares ${c.s(0)}: small values get smaller, a sharper falloff` };
      if (e === 0.5) return { noun: `the square root of ${c.n(0)}`, short: 'the root', how: `takes the square root of ${c.s(0)}` };
      if (e !== undefined && e > 1) return { noun: `${c.n(0)} to the power ${fmt(e)}`, short: 'the sharpened value', how: `raises ${c.s(0)} to the power ${fmt(e)}: values under 1 drop, so the bright part sharpens` };
      if (e !== undefined && e > 0) return { noun: `${c.n(0)} to the power ${fmt(e)}`, short: 'the softened value', how: `raises ${c.s(0)} to the power ${fmt(e)}: low values lift, so it softens` };
      return { noun: `${c.n(0)} to the power ${c.n(1)}`, short: 'the power', how: `raises ${c.s(0)} to the power ${c.s(1)}` };
    }
    case 'abs': {
      const range: [number, number] | undefined = r0 ? [r0[0] <= 0 && r0[1] >= 0 ? 0 : Math.min(Math.abs(r0[0]), Math.abs(r0[1])), Math.max(Math.abs(r0[0]), Math.abs(r0[1]))] : undefined;
      if (isSpace) return { noun: `${c.n(0)} folded`, short: 'the folded space', how: `mirrors ${c.s(0)} across both axes: every quarter shows the same thing`, range };
      if (c.a[0].role === 'distance') return { noun: `${c.n(0)} without its sign`, short: 'the unsigned distance', how: `drops the sign of ${c.s(0)}: inside and outside both count as positive`, range };
      return { noun: `${c.n(0)} without its sign`, short: `the folded ${c.a[0].short.replace(/^the /, '')}`, how: `drops the sign of ${c.s(0)}: negatives mirror up${range ? ` (now ${rangeText(range)})` : ''}`, range };
    }
    case 'sign': return { noun: `the sign of ${c.n(0)}`, short: 'the sign', how: `gives −1, 0 or 1: the sign of ${c.s(0)}`, range: [-1, 1] };
    case 'floor': case 'ceil': case 'round': case 'trunc': {
      const dir = callee === 'floor' ? 'down' : callee === 'ceil' ? 'up' : callee === 'round' ? 'to the nearest' : 'toward 0';
      if (isSpace) return { noun: `which cell ${c.n(0)} is in`, short: 'the cell id', how: `rounds ${c.s(0)} ${dir} to whole numbers: the id of its unit cell` };
      return { noun: `${c.n(0)} rounded ${dir}`, short: 'the steps', how: `rounds ${c.s(0)} ${dir} to a whole number: steps of 1` };
    }
    case 'fract': {
      const span = r0 ? r0[1] - r0[0] : undefined;
      const extra = span !== undefined && span > 1.01 ? ` (its ${rangeText(r0)} range becomes ${fmt(Math.round(span * 100) / 100)} ramps)` : '';
      if (isSpace) return { noun: `${c.n(0)} repeating every unit`, short: 'the tiles', how: `keeps the fractional part of each coordinate of ${c.s(0)}: a grid of 0…1 tiles, one per unit`, range: [0, 1] };
      return { noun: `repeating 0–1 ramps of ${c.n(0)}`, short: 'the ramps', how: `keeps the fractional part of ${c.s(0)}: repeating 0…1 ramps${extra}`, range: [0, 1] };
    }
    case 'mod': {
      const p = k(1);
      return { noun: `${c.n(0)} wrapped every ${c.n(1)}`, short: 'the wrapped value', how: `wraps ${c.s(0)} back to 0 every ${c.s(1)}: repeats with period ${c.s(1)}`, range: p !== undefined && p > 0 ? [0, p] : undefined };
    }
    case 'min': case 'max': {
      const big = callee === 'max';
      const li = k(1) !== undefined ? 1 : k(0) !== undefined ? 0 : -1;
      if (li >= 0) {
        const o = 1 - li, v = k(li)!;
        if (big) return { noun: `${c.n(o)}, at least ${fmt(v)}`, short: c.a[o].short, how: v === 0 ? `cuts the negative part of ${c.s(o)} to 0` : `keeps ${c.s(o)} from going below ${fmt(v)}` };
        return { noun: `${c.n(o)}, at most ${fmt(v)}`, short: c.a[o].short, how: `caps ${c.s(o)} at ${fmt(v)}` };
      }
      return { noun: `the ${big ? 'larger' : 'smaller'} of ${c.n(0)} and ${c.n(1)}`, short: `the ${big ? 'larger' : 'smaller'} one`, how: `takes the ${big ? 'larger' : 'smaller'} of ${c.s(0)} and ${c.s(1)}${c.a[0].type !== 'float' ? ', component by component' : ''}` };
    }
    case 'clamp': {
      const lo = k(1), hi = k(2);
      return { noun: `${c.n(0)} kept between ${c.n(1)} and ${c.n(2)}`, short: c.a[0].short, how: `keeps ${c.s(0)} between ${c.s(1)} and ${c.s(2)}`, range: lo !== undefined && hi !== undefined ? [lo, hi] : undefined };
    }
    case 'mix': {
      const t = k(2);
      if (t !== undefined) return { noun: `${c.n(0)} with ${fmt(Math.round(t * 100))}% of ${c.n(1)}`, short: 'the blend', how: `mixes ${fmt(Math.round(t * 100))}% of ${c.s(1)} into ${c.s(0)}` };
      return { noun: `a blend of ${c.n(0)} and ${c.n(1)}`, short: 'the blend', how: `blends from ${c.s(0)} (when ${c.s(2)} is 0) to ${c.s(1)} (when it is 1)` };
    }
    case 'step': return { noun: `where ${c.n(1)} reaches ${c.n(0)}`, short: 'the edge', how: `gives 0 where ${c.s(1)} is below ${c.s(0)} and 1 from there on: a hard edge`, range: [0, 1] };
    case 'smoothstep': {
      const e0 = k(0), e1 = k(1);
      if (e0 !== undefined && e1 !== undefined && e0 > e1) return { noun: `a smooth fall of ${c.n(2)} from ${fmt(e1)} to ${fmt(e0)}`, short: 'the ramp', how: `goes smoothly from 1 down to 0 as ${c.s(2)} goes from ${fmt(e1)} to ${fmt(e0)}`, range: [0, 1] };
      return { noun: `a smooth ramp of ${c.n(2)}`, short: 'the ramp', how: `goes smoothly from 0 to 1 as ${c.s(2)} goes from ${c.s(0)} to ${c.s(1)} (an S-curve, flat at both ends)`, range: [0, 1] };
    }
    case 'length':
      if (isSpace) return { noun: `the distance of ${c.n(0)} from the origin`, short: 'the distance', how: `measures how far ${c.s(0)} is from the origin: 0 at the centre, growing outward in circles` };
      return { noun: `the length of ${c.n(0)}`, short: 'the length', how: `measures the length of ${c.s(0)}` };
    case 'distance': return { noun: `the distance between ${c.n(0)} and ${c.n(1)}`, short: 'the distance', how: `measures the distance between ${c.s(0)} and ${c.s(1)}` };
    case 'dot': return { noun: `the dot product of ${c.n(0)} and ${c.n(1)}`, short: 'the dot product', how: `multiplies ${c.s(0)} and ${c.s(1)} component by component and adds them up (how much they point the same way)` };
    case 'cross': return { noun: `the cross product of ${c.n(0)} and ${c.n(1)}`, short: 'the perpendicular', how: `takes the cross product of ${c.s(0)} and ${c.s(1)}: a vector at right angles to both` };
    case 'normalize': return { noun: `the direction of ${c.n(0)}`, short: 'the direction', how: `scales ${c.s(0)} to length 1, keeping only its direction` };
    case 'reflect': return { noun: `${c.n(0)} reflected`, short: 'the reflection', how: `bounces ${c.s(0)} off a surface facing ${c.s(1)}` };
    case 'refract': return { noun: `${c.n(0)} refracted`, short: 'the refraction', how: `bends ${c.s(0)} through a surface facing ${c.s(1)} with ratio ${c.s(2)}` };
    case 'radians': return { noun: `${c.n(0)} in radians`, short: 'the angle', how: `converts ${c.s(0)} from degrees to radians` };
    case 'degrees': return { noun: `${c.n(0)} in degrees`, short: 'the angle', how: `converts ${c.s(0)} from radians to degrees` };
    case 'texture': case 'texture2D': case 'textureLod': return { noun: `the colour of ${c.n(0)} at ${c.n(1)}`, short: 'the sampled colour', how: `reads the colour of the image ${c.s(0)} at ${c.s(1)}` };
    case 'fwidth': return { noun: `how fast ${c.n(0)} changes per pixel`, short: 'the pixel width', how: `measures how much ${c.s(0)} changes across one pixel (for edges that stay sharp but smooth at any zoom)` };
    case 'dFdx': case 'dFdy': return { noun: `the change of ${c.n(0)} along ${callee === 'dFdx' ? 'x' : 'y'}`, short: 'the slope', how: `measures how much ${c.s(0)} changes to the next pixel along ${callee === 'dFdx' ? 'x' : 'y'}` };
    case 'float': return { noun: c.n(0), short: c.a[0].short, how: `turns ${c.s(0)} into a float` };
    case 'int': return { noun: `${c.n(0)} as a whole number`, short: 'the whole number', how: `turns ${c.s(0)} into a whole number, dropping the fraction` };
    case 'vec2': case 'vec3': case 'vec4': {
      const n = Number(callee[3]);
      if (c.a.length === 1) return { noun: `${c.n(0)} in all ${n} components`, short: c.a[0].short, how: `repeats ${c.s(0)} in all ${n} components` };
      if (callee === 'vec4' && c.a.length === 2 && c.a[0].type === 'vec3') return { noun: `${c.n(0)} with alpha ${c.n(1)}`, short: 'the colour', how: `adds alpha ${c.s(1)} to the colour ${c.s(0)}` };
      const parts = c.a.map((_, i) => c.s(i)).join(', ');
      if (c.role === 'colour' || callee !== 'vec2') return { noun: `the ${callee === 'vec2' ? 'pair' : c.role === 'colour' ? 'colour' : 'vector'} (${c.a.map((_, i) => c.p(i)).join(', ')})`, short: c.role === 'colour' ? 'the colour' : 'the vector', how: c.role === 'colour' ? `builds a colour from red ${c.s(0)}, green ${c.s(1)}${c.a[2] ? `, blue ${c.s(2)}` : ''}${c.a[3] ? `, alpha ${c.s(3)}` : ''}` : `builds the ${callee} (${parts})` };
      return { noun: `the point (${c.a.map((_, i) => c.p(i)).join(', ')})`, short: 'the point', how: `builds a 2D point with x = ${c.s(0)} and y = ${c.s(1)}` };
    }
    case 'mat2': case 'mat3': case 'mat4': return { noun: `a ${callee[3]}×${callee[3]} matrix`, short: 'the matrix', how: `builds a ${callee[3]}×${callee[3]} matrix from ${c.a.map((_, i) => c.s(i)).join(', ')}` };
    // Playfield's always-available helpers
    case 'rotate': return { noun: `${c.n(0)} rotated by ${c.n(1)}`, short: 'the rotated space', how: `rotates ${c.s(0)} around the origin by ${c.s(1)} radians` };
    case 'palette': return { noun: `a palette colour for ${c.n(0)}`, short: 'the palette colour', how: `picks a colour for ${c.s(0)} from a cosine palette` };
    case 'sdBox': return { noun: `the signed distance to a box of half-size ${c.n(1)}`, short: 'the box', how: `measures the signed distance from ${c.s(0)} to a box of half-size ${c.s(1)}` };
    case 'sdSegment': return { noun: `the distance to a line segment`, short: 'the segment', how: `measures the distance from ${c.s(0)} to the segment from ${c.s(1)} to ${c.s(2)}` };
    case 'sdEllipse': return { noun: `the distance to an ellipse`, short: 'the ellipse', how: `measures the distance from ${c.s(0)} to an ellipse with radii ${c.s(1)}` };
    case 'opRepeat': return { noun: `${c.n(0)} repeated every ${c.n(1)}`, short: 'the repeated space', how: `repeats ${c.s(0)} every ${c.s(1)}, each copy centred` };
    case 'opRepeatPolar': return { noun: `${c.n(0)} repeated ${c.n(1)} times around`, short: 'the repeated space', how: `repeats ${c.s(0)} ${c.s(1)} times around the origin` };
    case 'valueNoise': return { noun: `smooth noise at ${c.n(0)}`, short: 'the noise', how: `samples smooth value noise at ${c.s(0)}: 0…1, changing smoothly, one bump per unit`, range: [0, 1] };
    case 'noiseHash1': return { noun: `a random number for ${c.n(0)}`, short: 'the random number', how: `hashes ${c.s(0)} into a random number 0…1`, range: [0, 1] };
    case 'noiseHash2': return { noun: `a random 2D vector for ${c.n(0)}`, short: 'the random vector', how: `hashes ${c.s(0)} into a random vector, −1…1 per component`, range: [-1, 1] };
    default: {
      // Not a rule we have: say literally what happens, never what it might mean
      const args = c.a.map((_, i) => c.s(i)).join(', ');
      const literal = `${callee}(${c.a.map(a => a.leaf ? a.noun : '…').join(', ')})`;
      return { noun: `the result of ${literal}`, short: `the result of ${callee}`, how: `calls ${callee}(${args}), a function this explainer doesn’t know` };
    }
  }
}

// ── The engine ────────────────────────────────────────────────────────────────

interface State {
  src: string;
  types: Map<number, GlslType>;
  roles: Map<number, RoleInfo>;
  env: TypeEnv;
  roleEnv: RoleEnv;
  descs: Map<number, Desc>;
  steps: Step[];
  hits: IdiomHit[];
  noIdioms: boolean;
  norm: Map<number, N>;
}

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const labelFor = (i: number) => (i < 26 ? LABELS[i] : `${LABELS[Math.floor(i / 26) - 1]}${LABELS[i % 26]}`);

function typeOf(st: State, e: Expr): GlslType {
  return st.types.get(e.id) ?? inferTypes(e, st.env).get(e.id) ?? 'unknown';
}
function roleOf(st: State, e: Expr): RoleInfo {
  const r = st.roles.get(e.id);
  if (r) return r;
  const t = inferTypes(e, st.env);
  return inferRoles(e, t, st.roleEnv).get(e.id) ?? { role: 'unknown', because: 'none' };
}

function isLeaf(e: Expr): boolean {
  if (e.kind === 'num' || e.kind === 'ident') return true;
  if (constValue(e) !== undefined) return true;
  if (e.kind === 'member' && (e.object.kind === 'ident' || e.object.kind === 'num') && e.field.length === 1) return true;
  if (e.kind === 'call' && /^(vec[234]|float)$/.test(e.callee) && e.args.every(a => constValue(a) !== undefined)) return true;
  return false;
}

function leafDesc(st: State, e: Expr): Desc {
  const code = st.src ? st.src.slice(e.start, e.end).trim() || '' : '';
  const text = code || printShort(e);
  const v = constValue(e);
  const type = typeOf(st, e);
  const role = roleOf(st, e).role;
  const d: Desc = { node: e, code: text, type, role, leaf: true, noun: text, short: text, how: '', value: v, range: v !== undefined ? [v, v] : undefined };
  if (v !== undefined) { d.noun = fmt(v); d.short = fmt(v); }
  if (e.kind === 'member' && e.object.kind === 'ident') {
    const f = e.field;
    if (f.length === 1) d.short = d.noun = `${e.object.name}.${f}`;
  }
  return d;
}

function printShort(e: Expr): string {
  // Only used without a source text (synthetic nodes)
  switch (e.kind) {
    case 'num': return e.raw;
    case 'ident': return e.name;
    case 'member': return `${printShort(e.object)}.${e.field}`;
    default: return '…';
  }
}

function normOf(st: State, e: Expr): N {
  let n = st.norm.get(e.id);
  if (!n) { n = normalize(e); st.norm.set(e.id, n); }
  return n;
}

function holeText(st: State, b: Bindings, descOf: (name: string) => Desc | undefined): IdiomText {
  return {
    h: name => { const d = descOf(name); return !d ? '' : d.leaf ? d.noun : d.short; },
    n: name => { const v = b[name]?.value; return v !== undefined ? fmt(v) : (descOf(name)?.short ?? ''); },
    v: name => b[name]?.value,
    code: name => { const x = b[name]; return x ? (st.src ? st.src.slice(x.expr.start, x.expr.end).trim() : printShort(x.expr)) : ''; },
    role: name => { const x = b[name]; return x ? roleOf(st, x.expr).role : 'unknown'; },
    type: name => { const x = b[name]; return x ? typeOf(st, x.expr) : 'unknown'; },
  };
}

/** The first idiom that matches this node, with its holes' conditions met. */
function findIdiom(st: State, e: Expr): IdiomHit | null {
  if (st.noIdioms) return null;
  const target = normOf(st, e);
  for (const idiom of IDIOMS) {
    for (const p of idiom.patterns) {
      const b = matchNormalized(compilePattern(p), target);
      if (!b) continue;
      if (!holesOk(st, idiom, b)) continue;
      if (idiom.where && !idiom.where(holeText(st, b, () => undefined))) continue;
      return { idiom, node: e, bindings: b, pattern: p };
    }
  }
  return null;
}

function holesOk(st: State, idiom: Idiom, b: Bindings): boolean {
  for (const [name, spec] of Object.entries(idiom.holes ?? {})) {
    const x = b[name];
    if (!x) continue;
    if (spec.types) {
      const t = typeOf(st, x.expr);
      if (t === 'unknown' ? spec.strict : !spec.types.includes(t === 'int' ? 'float' : t)) return false;
    }
    if (spec.roles) {
      const r = roleOf(st, x.expr);
      // A role only read off a type is weak evidence: it passes unless the hole is strict
      const weak = r.role === 'unknown' || (r.because === 'type' && !spec.strict);
      if (!weak && !spec.roles.includes(r.role)) return false;
      if (r.role === 'unknown' && spec.strict) return false;
    }
  }
  return true;
}

/** The code of a node with its explained parts replaced by their labels. */
function labelledCode(st: State, e: Expr, parts: Desc[]): string {
  const text = st.src.slice(e.start, e.end);
  const subs = parts.filter(p => p.label && p.node.start >= e.start && p.node.end <= e.end && p.node.id >= 0)
    .sort((a, b) => a.node.start - b.node.start);
  let out = '';
  let at = e.start;
  for (const p of subs) {
    if (p.node.start < at) continue; // overlapping (synthetic) spans: keep the text
    out += st.src.slice(at, p.node.start) + p.label;
    at = p.node.end;
  }
  out += st.src.slice(at, e.end);
  return (subs.length ? out : text).replace(/\s+/g, ' ').trim();
}

function pushStep(st: State, d: Desc, parts: Desc[]) {
  d.label = labelFor(st.steps.length);
  st.steps.push({
    label: d.label, code: labelledCode(st, d.node, parts), text: d.how, start: d.node.start, end: d.node.end, node: d.node,
    idiom: d.idiom ? { id: d.idiom.idiom.id, name: d.idiom.idiom.name } : undefined, type: d.type, role: d.role,
  });
}

function walkNode(st: State, e: Expr): Desc {
  const done = st.descs.get(e.id);
  if (done) return done;
  if (isLeaf(e)) { const d = leafDesc(st, e); st.descs.set(e.id, d); return d; }

  const type = typeOf(st, e);
  const roleInfo = roleOf(st, e);
  const hit = findIdiom(st, e);
  if (hit) {
    st.hits.push(hit);
    // Explain the holes first, in source order
    const holeDescs: Record<string, Desc> = {};
    const entries = Object.entries(hit.bindings).sort((a, b) => a[1].expr.start - b[1].expr.start);
    for (const [name, bnd] of entries) holeDescs[name] = walkNode(st, bnd.expr);
    const ht = holeText(st, hit.bindings, name => holeDescs[name]);
    const noun = hit.idiom.noun(ht);
    const short = hit.idiom.short ?? `the ${hit.idiom.name.replace(/\s*\(.*\)$/, '').replace(/^./, ch => ch.toLowerCase())}`;
    const d: Desc = {
      node: e, code: st.src.slice(e.start, e.end).trim(), type, role: hit.idiom.role ?? roleInfo.role, leaf: false,
      noun, short, how: hit.idiom.how(ht), idiom: hit,
      range: hit.idiom.role === 'mask' ? [0, 1] : undefined,
    };
    st.descs.set(e.id, d);
    pushStep(st, d, Object.values(holeDescs));
    return d;
  }

  const kids = childrenOf(e).map(k => walkNode(st, k));
  const tc: TC = {
    node: e, a: kids, type, role: roleInfo.role,
    n: i => { const d = kids[i]; if (!d) return ''; return d.leaf ? d.noun : d.noun.length <= 48 ? d.noun : d.short; },
    s: i => { const d = kids[i]; if (!d) return ''; return d.leaf ? d.noun : d.short; },
    p: i => { const d = kids[i]; if (!d) return ''; return d.leaf ? d.noun : d.code.length <= 16 ? d.code : d.short; },
    lit: i => kids[i]?.value,
  };
  let w: Words;
  switch (e.kind) {
    case 'binary': w = binaryWords(tc, e.op); break;
    case 'unary':
      w = e.op === '!' ? { noun: `not ${tc.n(0)}`, short: 'the opposite', how: `flips the test ${tc.s(0)}` }
        : e.op === '+' ? { noun: tc.n(0), short: kids[0].short, how: `keeps ${tc.s(0)} as it is` }
        : kids[0].role === 'space' && kids[0].type !== 'float'
          ? { noun: `${tc.n(0)} mirrored`, short: 'the mirrored space', how: `mirrors ${tc.s(0)} through the origin`, range: scaleRange(kids[0].range, -1) }
          : { noun: `minus ${tc.n(0)}`, short: `the negated ${kids[0].short.replace(/^the /, '')}`, how: `negates ${tc.s(0)}`, range: scaleRange(kids[0].range, -1) };
      break;
    case 'member': w = memberWords(tc, e.field); break;
    case 'index': w = { noun: `component ${tc.n(1)} of ${tc.n(0)}`, short: 'the component', how: `picks component ${tc.s(1)} of ${tc.s(0)}` }; break;
    case 'ternary': w = { noun: `${tc.n(1)} where ${tc.n(0)}, otherwise ${tc.n(2)}`, short: 'the choice', how: `chooses ${tc.s(1)} where ${tc.n(0)}, and ${tc.s(2)} everywhere else` }; break;
    case 'call': {
      w = callWords(tc, e.callee);
      if (!w.range && FN_RANGE[e.callee]) w.range = FN_RANGE[e.callee];
      break;
    }
    default: w = { noun: '', short: '', how: '' };
  }
  const d: Desc = { node: e, code: st.src.slice(e.start, e.end).trim(), type, role: roleInfo.role, leaf: false, ...w };
  st.descs.set(e.id, d);
  pushStep(st, d, kids);
  return d;
}

function makeState(src: string, root: Expr, ctx: ExplainContext): State {
  const env = ctx.types ?? {};
  const types = inferTypes(root, env);
  const roles = inferRoles(root, types, ctx.roles ?? {});
  return { src, types, roles, env, roleEnv: ctx.roles ?? {}, descs: new Map(), steps: [], hits: [], noIdioms: !!ctx.noIdioms, norm: new Map() };
}

/** "First, A = uv * 3.0: zooms… Then, … Finally, fract(C): …" */
export function breakdownText(steps: Step[]): string {
  if (steps.length === 0) return '';
  if (steps.length === 1) return `It ${steps[0].text}.`;
  return steps.map((s, i) => {
    const lead = i === 0 ? 'First' : i === steps.length - 1 ? 'Finally' : 'Then';
    const name = i === steps.length - 1 ? s.code : `${s.label} = ${s.code}`;
    return `${lead}, ${name}: ${s.text}.`;
  }).join(' ');
}

/** Explain an already-parsed expression whose spans refer to `src`. */
export function explainTree(root: Expr, src: string, ctx: ExplainContext = {}): Explanation {
  const st = makeState(src, root, ctx);
  const d = walkNode(st, root);
  // Don't capitalise a sentence that starts with a name from the code ("uv centred…")
  const names = new Set<string>();
  const collect = (n: Expr) => { if (n.kind === 'ident') names.add(n.name); if (n.kind === 'call') names.add(n.callee); childrenOf(n).forEach(collect); };
  collect(root);
  const firstWord = /^[A-Za-z_]\w*/.exec(d.noun)?.[0];
  const sentence = d.leaf
    ? (d.value !== undefined ? `The constant ${d.noun}.` : `Just ${d.code}${d.type !== 'unknown' ? ` (a ${d.type})` : ''}.`)
    : `${firstWord && names.has(firstWord) ? d.noun : cap(d.noun)}.`;
  return {
    ok: true, sentence, steps: st.steps, breakdown: breakdownText(st.steps), type: d.type, role: d.role,
    idioms: st.hits, root, source: src, descs: st.descs,
  };
}

/** Explain an expression. */
export function explainExpression(src: string, ctx: ExplainContext = {}): ExplainResult {
  const r = parseExpr(src);
  if (!r.ok) return r;
  return explainTree(r.expr, src, ctx);
}

/** An explained line: what it assigns, and the explanation of what it computes. */
export interface LineExplanation extends Explanation { line: ParsedLine; /** The whole line's sentence ("d is …", "Returns …"). */ lineSentence: string }

/**
 * Explain one line: `float d = length(p) - 0.3;`, `p *= 2.0`, `return col;`, or a bare
 * expression. A compound assignment (`p *= 2.0`) is explained as `p * 2.0`.
 */
export function explainLine(text: string, ctx: ExplainContext = {}): LineExplanation | { ok: false; error: string } {
  const r = parseLine(text);
  if (!r.ok) return r;
  const line = r.line;
  let root = line.expr;
  const types = { ...(ctx.types ?? {}) };
  if (line.declType && line.target && !(line.target in types)) types[line.target] = line.declType as GlslType;
  if (line.op && line.op !== '=' && line.target) {
    // `p *= k` reads as `p * (k)`: the target is the left operand, spanned where it sits in the line
    const tStart = text.indexOf(line.target.split(/[.[]/)[0]);
    const tr = parseExpr(line.target, tStart >= 0 ? tStart : 0);
    if (tr.ok) {
      root = { kind: 'binary', op: line.op[0] as '+', left: tr.expr, right: line.expr, id: -9_000_000 - tr.expr.id, start: tr.expr.start, end: line.expr.end };
    }
  }
  const ex = explainTree(root, text, { ...ctx, types });
  const body = ex.sentence.replace(/\.$/, '');
  const lower = body ? body[0].toLowerCase() + body.slice(1) : body;
  const lineSentence = line.isReturn ? `Returns ${lower}.`
    : line.target && line.op && line.op !== '=' ? `${line.target} becomes ${lower}.`
    : line.target ? `${line.target} is ${lower}.`
    : ex.sentence;
  return { ...ex, line, lineSentence };
}
