/**
 * The function registry behind the click-a-function card (docs/expression-explainer.md,
 * "Function cards"): every GLSL ES 3.0 built-in the app's highlighter knows, the type
 * constructors, and Playfield's always-available helpers (hash, noise, palette, smin, rotate,
 * the 2D SDFs). Each has its overloads with types, a plain meaning (a noun phrase that reads
 * after "Gives …", worded with the parameter names), an optional use tag, and, for functions of
 * one number, how to plot it.
 *
 *   functionInfo('smoothstep').meaning
 *   → "a soft ramp from 0 to 1 as x goes from edge0 to edge1 (an S-curve, flat at both ends)"
 *
 * The tests check that every name in glslSyntax's BUILTINS and every function in the shader
 * prelude (ALWAYS_HELPERS_GLSL) has an entry with a meaning.
 */

/** One parameter of an overload. `q` is a parameter qualifier (`out`, `inout`). */
export interface FnParam { type: string; name: string; q?: 'out' | 'inout' }

export interface FnOverload { returns: string; params: FnParam[] }

export type FnKind = 'builtin' | 'constructor' | 'helper' | 'user';

export type FnCategory =
  | 'Angle & trig' | 'Exponential' | 'Common' | 'Geometric' | 'Matrix' | 'Vector compare' | 'Texture' | 'Derivatives'
  | 'Packing' | 'Bits' | 'Geometry shader' | 'Constructor' | 'Noise & hash' | 'Shapes (SDF)' | 'Space' | 'Colour';

export interface FnPlot {
  /** Which argument is the input (x on the plot). */
  x: number;
  /** Each argument's value when the call doesn't give a literal one (the x slot is ignored). */
  defaults: string[];
}

export interface FnInfo {
  name: string;
  kind: Exclude<FnKind, 'user'>;
  category: FnCategory;
  overloads: FnOverload[];
  /** The plain meaning, a noun phrase in terms of the first overload's parameter names. */
  meaning: string;
  /** The common job, shown as a tag ("a soft edge"). */
  use?: string;
  /** Set for functions of one number: what to plot. */
  plot?: FnPlot;
  /** The snippet library entry (suggestions/snippets.ts) that writes the same thing, by id. */
  snippet?: string;
  /** Reference page. */
  docs?: string;
  /** Not available in WebGL 2 shaders (GLSL ES 3.10 or geometry-only). */
  notInWebGL?: boolean;
}

/** `genType` and friends, as the overload tables write them. */
export const GENERIC_TYPES: Record<string, string> = {
  genType: 'float, vec2, vec3 or vec4',
  genIType: 'int, ivec2, ivec3 or ivec4',
  genUType: 'uint, uvec2, uvec3 or uvec4',
  genBType: 'bool, bvec2, bvec3 or bvec4',
  vec: 'vec2, vec3 or vec4',
  ivec: 'ivec2, ivec3 or ivec4',
  uvec: 'uvec2, uvec3 or uvec4',
  bvec: 'bvec2, bvec3 or bvec4',
  mat: 'mat2, mat3 or mat4 (and the non-square ones)',
  gsampler2D: 'sampler2D, isampler2D or usampler2D',
  gvec4: 'vec4, ivec4 or uvec4',
};

const KHRONOS = (name: string) => `https://registry.khronos.org/OpenGL-Refpages/es3.0/html/${name}.xhtml`;

/** `'genType x, out genType i'` → params. */
function params(src: string): FnParam[] {
  if (!src.trim()) return [];
  return src.split(',').map(p => {
    const w = p.trim().split(/\s+/);
    const q = w[0] === 'out' || w[0] === 'inout' ? (w.shift() as 'out' | 'inout') : undefined;
    return { type: w[0], name: w[1] ?? '', ...(q ? { q } : {}) };
  });
}
/** One overload: return type and parameter list. */
const o = (returns: string, ps: string): FnOverload => ({ returns, params: params(ps) });

type Spec = Omit<FnInfo, 'name' | 'kind' | 'category' | 'docs'> & { docs?: string | false };

function group(kind: FnInfo['kind'], category: FnCategory, specs: Record<string, Spec>): FnInfo[] {
  return Object.entries(specs).map(([name, s]) => {
    const { docs, ...rest } = s;
    const url = docs === false ? undefined : docs ?? (kind === 'builtin' && !s.notInWebGL ? KHRONOS(name) : undefined);
    return { name, kind, category, ...rest, ...(url ? { docs: url } : {}) };
  });
}

const g1 = (n = 'x') => [o('genType', `genType ${n}`)];
const p1 = (defaults: string[] = ['x']): FnPlot => ({ x: 0, defaults });

const TRIG = group('builtin', 'Angle & trig', {
  radians: { overloads: g1('degrees'), meaning: 'the angle degrees converted to radians (× π/180)', plot: p1() },
  degrees: { overloads: g1('radians'), meaning: 'the angle radians converted to degrees (× 180/π)', plot: p1() },
  sin: { overloads: g1('angle'), meaning: 'a wave from −1 to 1 that repeats every 2π (≈ 6.28) of angle', use: 'waves, wobble, pulses', plot: p1() },
  cos: { overloads: g1('angle'), meaning: 'the same wave as sin, a quarter turn ahead: 1 at 0, repeating every 2π', use: 'waves, circles (with sin)', plot: p1() },
  tan: { overloads: g1('angle'), meaning: 'sin ÷ cos: repeats every π and shoots off to ±infinity at each half turn', plot: p1() },
  asin: { overloads: g1(), meaning: 'the angle (−π/2…π/2) whose sine is x; x must be −1…1', plot: p1() },
  acos: { overloads: g1(), meaning: 'the angle (0…π) whose cosine is x; x must be −1…1', plot: p1() },
  atan: {
    overloads: [o('genType', 'genType y, genType x'), o('genType', 'genType y_over_x')],
    meaning: 'the angle of the point (x, y) around the origin, from −π to π (with one argument: the angle whose tangent is y_over_x)',
    use: 'polar coordinates, angles around a centre',
    snippet: 'polar',
  },
  sinh: { overloads: g1(), meaning: 'the hyperbolic sine: (eˣ − e⁻ˣ) / 2, an S-shape that keeps growing', plot: p1() },
  cosh: { overloads: g1(), meaning: 'the hyperbolic cosine: (eˣ + e⁻ˣ) / 2, a U-shaped curve, 1 at 0', plot: p1() },
  tanh: { overloads: g1(), meaning: 'a smooth S-curve from −1 to 1 through 0: big values squash toward ±1', use: 'soft limiting', plot: p1() },
  asinh: { overloads: g1(), meaning: 'the inverse of sinh: grows like a logarithm in both directions', plot: p1() },
  acosh: { overloads: g1(), meaning: 'the inverse of cosh, for x ≥ 1' },
  atanh: { overloads: g1(), meaning: 'the inverse of tanh, for x between −1 and 1', plot: p1() },
});

const EXPONENTIAL = group('builtin', 'Exponential', {
  pow: { overloads: [o('genType', 'genType x, genType y')], meaning: 'x raised to the power y: above 1 it sharpens a 0…1 value, below 1 it softens it (x must not be negative)', use: 'curves, contrast, falloff', plot: { x: 0, defaults: ['x', '2.0'] } },
  exp: { overloads: g1(), meaning: 'eˣ, Euler’s number (≈ 2.718) raised to x: 1 at 0, growing fast above and dying away toward 0 below', use: 'glows (exp(−k·d))', plot: p1() },
  log: { overloads: g1(), meaning: 'the natural logarithm of x: squeezes big values together; only for x > 0', plot: p1() },
  exp2: { overloads: g1(), meaning: '2 raised to x: doubles for every step of 1', use: 'octaves, zoom levels', plot: p1() },
  log2: { overloads: g1(), meaning: 'how many doublings make x (the base-2 logarithm); only for x > 0', plot: p1() },
  sqrt: { overloads: g1(), meaning: 'the square root of x: lifts small values, 1 stays 1', plot: p1() },
  inversesqrt: { overloads: g1(), meaning: '1 ÷ √x: large near 0, falling off slowly', plot: p1() },
});

const COMMON = group('builtin', 'Common', {
  abs: { overloads: [o('genType', 'genType x'), o('genIType', 'genIType x')], meaning: 'x without its sign: negatives mirror up, so −0.3 becomes 0.3', use: 'mirroring, symmetric shapes', plot: { x: 0, defaults: ['x'] } },
  sign: { overloads: [o('genType', 'genType x'), o('genIType', 'genIType x')], meaning: '−1 where x is negative, 0 at 0, 1 where it is positive', plot: p1() },
  floor: { overloads: g1(), meaning: 'x rounded down to a whole number: a staircase with steps of 1', use: 'cell ids, posterising', plot: p1() },
  trunc: { overloads: g1(), meaning: 'x with its fraction cut off (rounded toward 0)', plot: p1() },
  round: { overloads: g1(), meaning: 'x rounded to the nearest whole number', plot: p1() },
  roundEven: { overloads: g1(), meaning: 'x rounded to the nearest whole number, halves going to the even one (2.5 → 2)', plot: p1() },
  ceil: { overloads: g1(), meaning: 'x rounded up to a whole number', plot: p1() },
  fract: { overloads: g1(), meaning: 'the fractional part of x (x − floor(x)): a 0…1 ramp that starts again at every whole number', use: 'repetition, tiling', plot: p1() },
  mod: { overloads: [o('genType', 'genType x, float y'), o('genType', 'genType x, genType y')], meaning: 'x wrapped back to 0 every y: a 0…y ramp that repeats', use: 'repetition with a period', plot: { x: 0, defaults: ['x', '1.0'] }, snippet: 'opRepeat' },
  modf: { overloads: [o('genType', 'genType x, out genType i')], meaning: 'the fractional part of x, with the whole part written to i', docs: KHRONOS('modf') },
  min: {
    overloads: [o('genType', 'genType x, genType y'), o('genType', 'genType x, float y'), o('genIType', 'genIType x, genIType y'), o('genIType', 'genIType x, int y'), o('genUType', 'genUType x, genUType y'), o('genUType', 'genUType x, uint y')],
    meaning: 'the smaller of x and y: with a number, a cap that x can’t go above; with two distances, both shapes together (a union)', use: 'caps, union of shapes', plot: { x: 0, defaults: ['x', '0.5'] }, snippet: 'smin',
  },
  max: {
    overloads: [o('genType', 'genType x, genType y'), o('genType', 'genType x, float y'), o('genIType', 'genIType x, genIType y'), o('genIType', 'genIType x, int y'), o('genUType', 'genUType x, genUType y'), o('genUType', 'genUType x, uint y')],
    meaning: 'the larger of x and y: with a number, a floor that x can’t go below; with two distances, only where both shapes overlap', use: 'floors, intersection of shapes', plot: { x: 0, defaults: ['x', '0.5'] }, snippet: 'smax',
  },
  clamp: {
    overloads: [o('genType', 'genType x, genType minVal, genType maxVal'), o('genType', 'genType x, float minVal, float maxVal'), o('genIType', 'genIType x, genIType minVal, genIType maxVal'), o('genIType', 'genIType x, int minVal, int maxVal'), o('genUType', 'genUType x, genUType minVal, genUType maxVal'), o('genUType', 'genUType x, uint minVal, uint maxVal')],
    meaning: 'x kept between minVal and maxVal: it follows x in between and stays flat outside', use: 'keeping values in range', plot: { x: 0, defaults: ['x', '0.0', '1.0'] },
  },
  mix: {
    overloads: [o('genType', 'genType x, genType y, genType a'), o('genType', 'genType x, genType y, float a'), o('genType', 'genType x, genType y, genBType a')],
    meaning: 'a straight blend from x (when a is 0) to y (when a is 1); a = 0.5 is halfway', use: 'blending colours, values, positions', plot: { x: 2, defaults: ['0.0', '1.0', 'a'] },
  },
  step: {
    overloads: [o('genType', 'genType edge, genType x'), o('genType', 'float edge, genType x')],
    meaning: 'a hard switch: 0 while x is below edge, 1 from edge on', use: 'hard masks, thresholds', plot: { x: 1, defaults: ['0.5', 'x'] },
  },
  smoothstep: {
    overloads: [o('genType', 'genType edge0, genType edge1, genType x'), o('genType', 'float edge0, float edge1, genType x')],
    meaning: 'a soft ramp from 0 to 1 as x goes from edge0 to edge1 (an S-curve, flat at both ends)', use: 'soft edges, fades', plot: { x: 2, defaults: ['0.0', '1.0', 'x'] },
  },
  isnan: { overloads: [o('genBType', 'genType x')], meaning: 'true where x is not a number (the result of 0 ÷ 0, √−1 …)' },
  isinf: { overloads: [o('genBType', 'genType x')], meaning: 'true where x is infinite (the result of 1 ÷ 0 …)' },
  floatBitsToInt: { overloads: [o('genIType', 'genType value')], meaning: 'the raw bits of the float value, read as an int (no conversion)', use: 'hashing' },
  floatBitsToUint: { overloads: [o('genUType', 'genType value')], meaning: 'the raw bits of the float value, read as an unsigned int (no conversion)', use: 'hashing' },
  intBitsToFloat: { overloads: [o('genType', 'genIType value')], meaning: 'the bits of the int value, read as a float (no conversion)' },
  uintBitsToFloat: { overloads: [o('genType', 'genUType value')], meaning: 'the bits of the unsigned int value, read as a float (no conversion)', use: 'hashing' },
});

const PACKING = group('builtin', 'Packing', {
  packSnorm2x16: { overloads: [o('uint', 'vec2 v')], meaning: 'two −1…1 numbers squeezed into one 32-bit uint, 16 bits each' },
  unpackSnorm2x16: { overloads: [o('vec2', 'uint p')], meaning: 'the two −1…1 numbers packed into p by packSnorm2x16' },
  packUnorm2x16: { overloads: [o('uint', 'vec2 v')], meaning: 'two 0…1 numbers squeezed into one 32-bit uint, 16 bits each' },
  unpackUnorm2x16: { overloads: [o('vec2', 'uint p')], meaning: 'the two 0…1 numbers packed into p by packUnorm2x16' },
  packHalf2x16: { overloads: [o('uint', 'vec2 v')], meaning: 'two floats stored as half-precision floats in one 32-bit uint' },
  unpackHalf2x16: { overloads: [o('vec2', 'uint v')], meaning: 'the two half-precision floats packed into v' },
});

const GEOMETRIC = group('builtin', 'Geometric', {
  length: { overloads: [o('float', 'genType x')], meaning: 'how long x is: for a point, its distance from the origin (0 at the centre, growing outward in circles)', use: 'circles, radial gradients' },
  distance: { overloads: [o('float', 'genType p0, genType p1')], meaning: 'how far apart p0 and p1 are (length(p0 − p1))', use: 'circles around a point' },
  dot: { overloads: [o('float', 'genType x, genType y')], meaning: 'x and y multiplied component by component and added up: how much they point the same way (1 for the same unit direction, 0 at right angles)', use: 'lighting, projections, hashing' },
  cross: { overloads: [o('vec3', 'vec3 x, vec3 y')], meaning: 'a vector at right angles to both x and y, as long as the area they span', use: '3D normals, camera axes' },
  normalize: { overloads: [o('genType', 'genType x')], meaning: 'x scaled to length 1: only its direction is kept', use: 'directions, normals' },
  faceforward: { overloads: [o('genType', 'genType N, genType I, genType Nref')], meaning: 'N flipped if needed so it faces against I (N when dot(Nref, I) < 0, else −N)' },
  reflect: { overloads: [o('genType', 'genType I, genType N')], meaning: 'the direction I bounced off a surface whose normal is N (N should be length 1)', use: 'mirrors, reflections' },
  refract: { overloads: [o('genType', 'genType I, genType N, float eta')], meaning: 'the direction I bent through a surface with normal N, eta being the ratio of the two materials’ indices (glass ≈ 1/1.5)', use: 'glass, water' },
});

const MATRIX = group('builtin', 'Matrix', {
  matrixCompMult: { overloads: [o('mat', 'mat x, mat y')], meaning: 'x and y multiplied entry by entry (not the matrix product)' },
  outerProduct: { overloads: [o('mat', 'vec c, vec r')], meaning: 'the matrix whose entry (i, j) is c[i] × r[j]' },
  transpose: { overloads: [o('mat', 'mat m')], meaning: 'm with rows and columns swapped; for a rotation, the opposite rotation' },
  determinant: { overloads: [o('float', 'mat m')], meaning: 'how much m scales areas (volumes in 3D); negative when it mirrors, 0 when it flattens' },
  inverse: { overloads: [o('mat', 'mat m')], meaning: 'the matrix that undoes m' },
});

const COMPARE = group('builtin', 'Vector compare', {
  lessThan: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y')], meaning: 'for each component, whether x is less than y' },
  lessThanEqual: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y')], meaning: 'for each component, whether x is at most y' },
  greaterThan: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y')], meaning: 'for each component, whether x is greater than y' },
  greaterThanEqual: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y')], meaning: 'for each component, whether x is at least y' },
  equal: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y'), o('bvec', 'bvec x, bvec y')], meaning: 'for each component, whether x equals y' },
  notEqual: { overloads: [o('bvec', 'vec x, vec y'), o('bvec', 'ivec x, ivec y'), o('bvec', 'uvec x, uvec y'), o('bvec', 'bvec x, bvec y')], meaning: 'for each component, whether x differs from y' },
  any: { overloads: [o('bool', 'bvec x')], meaning: 'true if at least one component of x is true' },
  all: { overloads: [o('bool', 'bvec x')], meaning: 'true only if every component of x is true' },
  not: { overloads: [o('bvec', 'bvec x')], meaning: 'each component of x flipped (true ↔ false)' },
});

const sampled = 'the colour (RGBA) of the image sampler';
const TEXTURE = group('builtin', 'Texture', {
  texture: {
    overloads: [o('gvec4', 'gsampler2D sampler, vec2 P'), o('gvec4', 'gsampler2D sampler, vec2 P, float bias'), o('gvec4', 'gsampler3D sampler, vec3 P'), o('gvec4', 'gsamplerCube sampler, vec3 P'), o('float', 'sampler2DShadow sampler, vec3 P')],
    meaning: `${sampled} at P (0…1 across the image), smoothly blended between pixels`, use: 'reading images, video, feedback',
  },
  texture2D: { overloads: [o('vec4', 'sampler2D sampler, vec2 coord')], meaning: `the old WebGL 1 name for texture(): ${sampled} at coord`, docs: KHRONOS('texture') },
  textureCube: { overloads: [o('vec4', 'samplerCube sampler, vec3 coord')], meaning: 'the old WebGL 1 name for texture() on a cube map: the colour seen in direction coord', docs: KHRONOS('texture') },
  textureProj: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P'), o('gvec4', 'gsampler2D sampler, vec4 P')], meaning: `${sampled} at P.xy divided by its last component (a projected lookup)` },
  textureLod: { overloads: [o('gvec4', 'gsampler2D sampler, vec2 P, float lod'), o('gvec4', 'gsamplerCube sampler, vec3 P, float lod')], meaning: `${sampled} at P from mipmap level lod (0 sharpest, higher blurrier)`, use: 'blur by mip level' },
  textureOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec2 P, ivec2 offset')], meaning: `${sampled} at P moved by a whole number of pixels (offset)` },
  texelFetch: { overloads: [o('gvec4', 'gsampler2D sampler, ivec2 P, int lod')], meaning: 'the exact pixel P (in whole pixels, not 0…1) of the image, with no blending', use: 'reading data textures' },
  texelFetchOffset: { overloads: [o('gvec4', 'gsampler2D sampler, ivec2 P, int lod, ivec2 offset')], meaning: 'the exact pixel P + offset of the image, with no blending' },
  textureSize: { overloads: [o('ivec2', 'gsampler2D sampler, int lod'), o('ivec3', 'gsampler3D sampler, int lod')], meaning: 'the image’s size in pixels at mipmap level lod' },
  textureProjOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P, ivec2 offset')], meaning: `${sampled}, projected (P.xy ÷ P.z) and moved by offset pixels` },
  textureLodOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec2 P, float lod, ivec2 offset')], meaning: `${sampled} at P from mip level lod, moved by offset pixels` },
  textureProjLod: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P, float lod')], meaning: `${sampled}, projected, from mip level lod` },
  textureProjLodOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P, float lod, ivec2 offset')], meaning: `${sampled}, projected, from mip level lod, moved by offset pixels` },
  textureGrad: { overloads: [o('gvec4', 'gsampler2D sampler, vec2 P, vec2 dPdx, vec2 dPdy')], meaning: `${sampled} at P, blurred as if P changed by dPdx and dPdy per pixel` },
  textureGradOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec2 P, vec2 dPdx, vec2 dPdy, ivec2 offset')], meaning: `${sampled} at P with explicit derivatives, moved by offset pixels` },
  textureProjGrad: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P, vec2 dPdx, vec2 dPdy')], meaning: `${sampled}, projected, with explicit derivatives` },
  textureProjGradOffset: { overloads: [o('gvec4', 'gsampler2D sampler, vec3 P, vec2 dPdx, vec2 dPdy, ivec2 offset')], meaning: `${sampled}, projected, with explicit derivatives, moved by offset pixels` },
});

const DERIVATIVES = group('builtin', 'Derivatives', {
  dFdx: { overloads: g1('p'), meaning: 'how much p changes from this pixel to the next one to the right', use: 'edge widths, normals from height' },
  dFdy: { overloads: g1('p'), meaning: 'how much p changes from this pixel to the next one up', use: 'edge widths, normals from height' },
  fwidth: { overloads: g1('p'), meaning: 'how much p changes across one pixel (|dFdx| + |dFdy|): the width of a pixel in p’s units', use: 'anti-aliased edges at any zoom' },
});

const BITS = group('builtin', 'Bits', {
  bitfieldExtract: { overloads: [o('genIType', 'genIType value, int offset, int bits'), o('genUType', 'genUType value, int offset, int bits')], meaning: 'the bits bits of value starting at bit offset', notInWebGL: true },
  bitfieldInsert: { overloads: [o('genIType', 'genIType base, genIType insert, int offset, int bits'), o('genUType', 'genUType base, genUType insert, int offset, int bits')], meaning: 'base with bits bits at offset replaced by those of insert', notInWebGL: true },
  bitfieldReverse: { overloads: [o('genIType', 'genIType value'), o('genUType', 'genUType value')], meaning: 'value with its bits in reverse order', notInWebGL: true },
  bitCount: { overloads: [o('genIType', 'genIType value'), o('genIType', 'genUType value')], meaning: 'how many bits of value are 1', notInWebGL: true },
  findLSB: { overloads: [o('genIType', 'genIType value'), o('genIType', 'genUType value')], meaning: 'the position of the lowest 1 bit of value (−1 for 0)', notInWebGL: true },
  findMSB: { overloads: [o('genIType', 'genIType value'), o('genIType', 'genUType value')], meaning: 'the position of the highest 1 bit of value (−1 for 0)', notInWebGL: true },
  umulExtended: { overloads: [o('void', 'genUType x, genUType y, out genUType msb, out genUType lsb')], meaning: 'the full 64-bit product of x and y, split into its high (msb) and low (lsb) halves', notInWebGL: true },
  imulExtended: { overloads: [o('void', 'genIType x, genIType y, out genIType msb, out genIType lsb')], meaning: 'the full 64-bit signed product of x and y, split into its high (msb) and low (lsb) halves', notInWebGL: true },
});

const GEOMETRY_SHADER = group('builtin', 'Geometry shader', {
  emit: { overloads: [o('void', '')], meaning: 'sends the current vertex on (geometry shaders only, which WebGL doesn’t have)', notInWebGL: true },
  endPrimitive: { overloads: [o('void', '')], meaning: 'finishes the current shape (geometry shaders only, which WebGL doesn’t have)', notInWebGL: true },
});

const CONSTRUCTORS = group('constructor', 'Constructor', {
  float: { overloads: [o('float', 'int x'), o('float', 'bool x'), o('float', 'uint x')], meaning: 'x as a float (true is 1.0)', docs: false },
  int: { overloads: [o('int', 'float x'), o('int', 'bool x'), o('int', 'uint x')], meaning: 'x as a whole number, its fraction dropped (toward 0)', docs: false },
  uint: { overloads: [o('uint', 'float x'), o('uint', 'int x')], meaning: 'x as an unsigned whole number', docs: false },
  bool: { overloads: [o('bool', 'float x'), o('bool', 'int x')], meaning: 'whether x is not 0', docs: false },
  vec2: { overloads: [o('vec2', 'float x, float y'), o('vec2', 'float s'), o('vec2', 'vec3 v')], meaning: 'a 2D vector (a point or two numbers) built from x and y; one number fills both', docs: false },
  vec3: { overloads: [o('vec3', 'float x, float y, float z'), o('vec3', 'float s'), o('vec3', 'vec2 xy, float z'), o('vec3', 'vec4 v')], meaning: 'a 3D vector, or a colour (red, green, blue), built from its parts; one number fills all three (a grey)', docs: false },
  vec4: { overloads: [o('vec4', 'float x, float y, float z, float w'), o('vec4', 'float s'), o('vec4', 'vec3 rgb, float a'), o('vec4', 'vec2 xy, vec2 zw')], meaning: 'a 4D vector, or a colour with alpha (red, green, blue, alpha), built from its parts', docs: false },
  ivec2: { overloads: [o('ivec2', 'int x, int y'), o('ivec2', 'vec2 v')], meaning: 'two whole numbers (a pixel position, a cell id)', docs: false },
  ivec3: { overloads: [o('ivec3', 'int x, int y, int z')], meaning: 'three whole numbers', docs: false },
  ivec4: { overloads: [o('ivec4', 'int x, int y, int z, int w')], meaning: 'four whole numbers', docs: false },
  mat2: { overloads: [o('mat2', 'float a, float b, float c, float d'), o('mat2', 'vec2 col0, vec2 col1'), o('mat2', 'float s')], meaning: 'a 2×2 matrix, filled column by column (one number: that many times the identity); mostly a 2D rotation or scale', use: 'rotating 2D space', docs: false, snippet: 'rotate2d' },
  mat3: { overloads: [o('mat3', 'vec3 col0, vec3 col1, vec3 col2'), o('mat3', 'float s'), o('mat3', 'mat4 m')], meaning: 'a 3×3 matrix, filled column by column: a 3D rotation, a camera’s axes', docs: false },
  mat4: { overloads: [o('mat4', 'vec4 col0, vec4 col1, vec4 col2, vec4 col3'), o('mat4', 'float s')], meaning: 'a 4×4 matrix, filled column by column', docs: false },
});

const IQ = 'https://iquilezles.org/articles';
const HELPERS = group('helper', 'Noise & hash', {
  noiseHash1: { overloads: [o('float', 'vec2 p')], meaning: 'a random-looking number from 0 to 1 for each p: the same p always gets the same number, neighbours look unrelated', use: 'per-cell randomness, grain', snippet: 'hash21' },
  noiseHash2: { overloads: [o('vec2', 'vec2 p')], meaning: 'a random-looking 2D vector, −1…1 per component, for each p (the same p always gets the same one)', use: 'random offsets, gradients' },
  valueNoise: { overloads: [o('float', 'vec2 p')], meaning: 'smooth noise from 0 to 1: random values at whole-number corners, blended smoothly between them (one bump per unit of p)', use: 'clouds, wobble, organic variation', snippet: 'valueNoise' },
}).concat(group('helper', 'Space', {
  rotate: { overloads: [o('vec2', 'vec2 v, float angle')], meaning: 'v turned around the origin by angle radians (counter-clockwise)', use: 'rotating space', snippet: 'rotate2d' },
  rot2D: { overloads: [o('mat2', 'float a')], meaning: 'a 2×2 rotation matrix for the angle a: multiply a point by it to turn the point by a', use: 'rotating space', snippet: 'rotate2d' },
  opRepeat: { overloads: [o('vec2', 'vec2 p, float s')], meaning: 'space p repeated on a grid every s, each copy centred on its cell: one shape drawn in it appears in every cell', use: 'tiling shapes', snippet: 'opRepeat', docs: `${IQ}/sdfrepetition/` },
  opRepeatPolar: { overloads: [o('vec2', 'vec2 p, float n')], meaning: 'space p repeated n times around the origin, like slices of a pie: one shape becomes a ring of n', use: 'radial copies, flowers, gears', docs: `${IQ}/sdfrepetition/` },
}), group('helper', 'Shapes (SDF)', {
  smin: { overloads: [o('float', 'float a, float b, float k')], meaning: 'the smaller of two distances, melted together over k: two shapes flow into one with a rounded seam', use: 'blobby unions', plot: { x: 0, defaults: ['a', '0.5', '0.25'] }, snippet: 'smin', docs: `${IQ}/smin/` },
  sdBox: { overloads: [o('float', 'vec2 p, vec2 b')], meaning: 'the signed distance from p to a box centred on the origin with half-size b: negative inside, 0 on the edge, positive outside', use: 'rectangles', docs: `${IQ}/distfunctions2d/` },
  sdSegment: { overloads: [o('float', 'vec2 p, vec2 a, vec2 b')], meaning: 'the distance from p to the line segment from a to b (0 on it): subtract a width for a thick line', use: 'lines, strokes', docs: `${IQ}/distfunctions2d/` },
  sdEllipse: { overloads: [o('float', 'vec2 p, vec2 ab')], meaning: 'the signed distance from p to an ellipse centred on the origin with radii ab', use: 'ellipses, ovals', docs: `${IQ}/ellipsedist/` },
}), group('helper', 'Colour', {
  palette: { overloads: [o('vec3', 'float t, vec3 offset, vec3 amplitude, vec3 freq, vec3 phase')], meaning: 'a colour for t from a cosine palette: offset + amplitude·cos(2π(freq·t + phase)), cycling smoothly as t grows', use: 'colour ramps from a number', snippet: 'cosPalette', docs: `${IQ}/palettes/` },
}));

export const FUNCTION_REGISTRY: readonly FnInfo[] = [
  ...TRIG, ...EXPONENTIAL, ...COMMON, ...PACKING, ...GEOMETRIC, ...MATRIX, ...COMPARE, ...TEXTURE, ...DERIVATIVES, ...BITS, ...GEOMETRY_SHADER,
  ...CONSTRUCTORS, ...HELPERS,
];

const BY_NAME = new Map(FUNCTION_REGISTRY.map(f => [f.name, f]));

/** The registry entry for a name, if the app knows it. */
export function functionInfo(name: string): FnInfo | undefined { return BY_NAME.get(name); }

/** Every GLSL built-in in the registry (not constructors or helpers). */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = FUNCTION_REGISTRY.filter(f => f.kind === 'builtin').map(f => f.name);

/** `float smoothstep(float edge0, float edge1, float x)` */
export function signatureText(name: string, ov: FnOverload): string {
  return `${ov.returns} ${name}(${ov.params.map(p => `${p.q ? `${p.q} ` : ''}${p.type} ${p.name}`.trim()).join(', ')})`;
}

/** The generic type names an overload list uses, for the legend under the table. */
export function genericTypesIn(overloads: readonly FnOverload[]): string[] {
  const seen = new Set<string>();
  for (const ov of overloads) for (const t of [ov.returns, ...ov.params.map(p => p.type)]) if (t in GENERIC_TYPES) seen.add(t);
  return [...seen];
}
