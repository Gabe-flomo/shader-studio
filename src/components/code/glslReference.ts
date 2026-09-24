import type { DataType } from '../../types/nodeGraph';

/**
 * The functions and constants code fields know about: shown as insert chips in the reference
 * panel and offered by autocomplete. `insert` is what a chip click puts in the code (empty
 * parens get the cursor, or wrap the selection); `sig` and `returns` describe it.
 */
export interface GlslRef {
  name: string;
  group: string;
  sig?: string;
  returns?: string;
  doc: string;
  insert: string;
}

const fn = (group: string, name: string, sig: string, returns: string, doc: string, insert = `${name}(${', '.repeat(Math.max(0, sig.split(',').length - 1))})`): GlslRef =>
  ({ group, name, sig: `(${sig})`, returns, doc, insert });
const constant = (group: string, name: string, returns: string, doc: string): GlslRef => ({ group, name, returns, doc, insert: name });

export const GLSL_REFERENCE: readonly GlslRef[] = [
  fn('Trig', 'sin', 'float x', 'float', 'Sine of x (radians).'),
  fn('Trig', 'cos', 'float x', 'float', 'Cosine of x (radians).'),
  fn('Trig', 'tan', 'float x', 'float', 'Tangent of x (radians).'),
  fn('Trig', 'asin', 'float x', 'float', 'Arc sine: the angle whose sine is x.'),
  fn('Trig', 'acos', 'float x', 'float', 'Arc cosine: the angle whose cosine is x.'),
  fn('Trig', 'atan', 'float y, float x', 'float', 'Angle of the vector (x, y), from −π to π.'),
  fn('Exp / log', 'exp', 'float x', 'float', 'e raised to x.'),
  fn('Exp / log', 'log', 'float x', 'float', 'Natural logarithm of x.'),
  fn('Exp / log', 'exp2', 'float x', 'float', '2 raised to x.'),
  fn('Exp / log', 'log2', 'float x', 'float', 'Base-2 logarithm of x.'),
  fn('Exp / log', 'sqrt', 'float x', 'float', 'Square root of x.'),
  fn('Exp / log', 'inversesqrt', 'float x', 'float', '1 / sqrt(x).'),
  fn('Exp / log', 'pow', 'float x, float y', 'float', 'x raised to y. Undefined for negative x.'),
  fn('Rounding', 'floor', 'float x', 'float', 'Largest whole number ≤ x.'),
  fn('Rounding', 'ceil', 'float x', 'float', 'Smallest whole number ≥ x.'),
  fn('Rounding', 'fract', 'float x', 'float', 'Fractional part: x − floor(x).'),
  fn('Rounding', 'round', 'float x', 'float', 'Nearest whole number.'),
  fn('Math', 'abs', 'float x', 'float', 'Absolute value.'),
  fn('Math', 'sign', 'float x', 'float', '−1, 0 or 1 depending on the sign of x.'),
  fn('Math', 'mod', 'float x, float y', 'float', 'x modulo y, always with the sign of y.'),
  fn('Math', 'min', 'float a, float b', 'float', 'The smaller of a and b.'),
  fn('Math', 'max', 'float a, float b', 'float', 'The larger of a and b.'),
  fn('Math', 'clamp', 'float x, float lo, float hi', 'float', 'x limited to the range lo – hi.'),
  fn('Math', 'mix', 'float a, float b, float t', 'float', 'Linear blend from a (t = 0) to b (t = 1).'),
  fn('Math', 'step', 'float edge, float x', 'float', '0 below edge, 1 at or above it.'),
  fn('Math', 'smoothstep', 'float edge0, float edge1, float x', 'float', 'Smooth 0 → 1 ramp as x goes from edge0 to edge1. Clamped outside.'),
  fn('Vector', 'length', 'vec2 v', 'float', 'Length of v.'),
  fn('Vector', 'distance', 'vec2 a, vec2 b', 'float', 'Distance between a and b.'),
  fn('Vector', 'dot', 'vec2 a, vec2 b', 'float', 'Dot product.'),
  fn('Vector', 'cross', 'vec3 a, vec3 b', 'vec3', 'Cross product (vec3 only).'),
  fn('Vector', 'normalize', 'vec2 v', 'vec2', 'v scaled to length 1.'),
  fn('Vector', 'reflect', 'vec2 i, vec2 n', 'vec2', 'Reflects i off the surface with normal n.'),
  fn('Vector', 'vec2', 'float x, float y', 'vec2', 'Builds a vec2.'),
  fn('Vector', 'vec3', 'float x, float y, float z', 'vec3', 'Builds a vec3.'),
  fn('Vector', 'vec4', 'float x, float y, float z, float w', 'vec4', 'Builds a vec4.'),
  fn('Custom', 'palette', 'float t, vec3 a, vec3 b, vec3 c, vec3 d', 'vec3', 'Cosine colour palette: a + b·cos(2π(c·t + d)).',
    'palette(, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))'),
  fn('Custom', 'rotate', 'vec2 p, float angle', 'vec2', 'Rotates p around the origin by angle (radians).'),
  fn('Custom', 'smin', 'float a, float b, float k', 'float', 'Smooth minimum: blends two distances with radius k.'),
  fn('SDF', 'sdBox', 'vec2 p, vec2 halfSize', 'float', 'Signed distance to a box centred on the origin.'),
  fn('SDF', 'sdSegment', 'vec2 p, vec2 a, vec2 b', 'float', 'Distance to the segment from a to b.'),
  fn('SDF', 'sdEllipse', 'vec2 p, vec2 radii', 'float', 'Signed distance to an ellipse.'),
  fn('SDF', 'opRepeat', 'vec2 p, float spacing', 'vec2', 'Repeats space on a grid.'),
  fn('SDF', 'opRepeatPolar', 'vec2 p, float count', 'vec2', 'Repeats space around the origin.'),
  constant('Constants', 'PI', 'float', 'π ≈ 3.14159'),
  constant('Constants', 'TAU', 'float', '2π ≈ 6.28319'),
  constant('Constants', 'u_time', 'float', 'Seconds since the preview started.'),
  constant('Constants', 'u_resolution', 'vec2', 'Preview size in pixels.'),
];

export const REFERENCE_GROUPS: readonly string[] = Array.from(new Set(GLSL_REFERENCE.map(r => r.group)));

/** Words autocomplete offers besides functions: types and control flow. */
export const GLSL_KEYWORDS: readonly string[] = [
  'float', 'vec2', 'vec3', 'vec4', 'int', 'bool', 'mat2', 'mat3', 'return', 'if', 'else', 'for', 'const',
];

export interface Completion {
  kind: 'var' | 'fn' | 'const' | 'keyword';
  name: string;
  /** Shown after the name, dimmed: "(float x)". */
  detail?: string;
  /** Right-hand column: return or variable type. */
  type?: string;
  doc?: string;
  /** Text that replaces the typed word. */
  insert: string;
}

/** Everything a code field can complete, given the node's own variables. */
export function buildCompletions(variables: ReadonlyArray<{ name: string; type: DataType | string }>): Completion[] {
  const vars: Completion[] = variables.filter(v => v.name).map(v => ({ kind: 'var', name: v.name, type: v.type, detail: '', doc: `Input ${v.name} (${v.type}).`, insert: v.name }));
  const refs: Completion[] = GLSL_REFERENCE.map(r => r.sig
    ? { kind: 'fn', name: r.name, detail: r.sig, type: r.returns, doc: r.doc, insert: `${r.name}()` }
    : { kind: 'const', name: r.name, type: r.returns, doc: r.doc, insert: r.name });
  const kws: Completion[] = GLSL_KEYWORDS.map(k => ({ kind: 'keyword', name: k, insert: k }));
  return [...vars, ...refs, ...kws];
}

/** Ranked matches for a typed prefix: exact-case prefix, then any-case prefix, then substring. */
export function matchCompletions(all: readonly Completion[], word: string, limit = 6): Completion[] {
  if (!word) return [];
  const lower = word.toLowerCase();
  const scored = all
    .filter(c => c.name !== word && c.name.toLowerCase().includes(lower))
    .map(c => ({ c, score: c.name.startsWith(word) ? 0 : c.name.toLowerCase().startsWith(lower) ? 1 : 2 }))
    .sort((a, b) => a.score - b.score || (a.c.kind === 'var' ? -1 : 0) - (b.c.kind === 'var' ? -1 : 0) || a.c.name.length - b.c.name.length);
  return scored.slice(0, limit).map(s => s.c);
}
