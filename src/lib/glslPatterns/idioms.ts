/**
 * The idiom library: well-known shader expressions, recognised structurally (see match.ts) and
 * described in plain words from their matched parts.
 *
 * Adding one (docs/expression-explainer.md, "Adding a pattern"):
 *   - `patterns`: one or more spellings. `$x` matches any sub-expression, `#k` only a number.
 *     Don't list reorderings of `+`/`*`, `TAU` vs `6.28318`, or `vec3(0.5)` vs `vec3(0.5, 0.5, 0.5)`:
 *     the matcher already treats those as the same.
 *   - `holes`: optional per-hole conditions (types, roles) and the input name the hole becomes
 *     when the idiom is made into a node (`input`).
 *   - `where`: an extra condition on the match (a literal's size, say).
 *   - `noun` / `how`: the words. `c.h('x')` is the phrase for hole x (its own explanation's noun,
 *     or its code when short), `c.n('k')` the number a literal hole matched, formatted.
 * Order matters: the first idiom that matches a node wins, so specific ones go first.
 */
import type { GlslType } from './ast';
import type { Role } from './roles';

export interface IdiomText {
  /** The phrase for a hole: its explanation's noun phrase, or its code when that's short. */
  h(name: string): string;
  /** A literal hole's number, formatted for prose (π multiples as π). */
  n(name: string): string;
  /** A literal hole's value, if it bound a number. */
  v(name: string): number | undefined;
  /** The code a hole matched. */
  code(name: string): string;
  role(name: string): Role;
  type(name: string): GlslType;
}

export interface HoleSpec {
  /** The hole's type must be one of these (an unknown type passes unless `strict`). */
  types?: GlslType[];
  /** The hole's role must be one of these (an unknown role passes). */
  roles?: Role[];
  strict?: boolean;
  /** The input this hole becomes when the idiom is made into a node. */
  input?: string;
}

export type IdiomCategory = 'space' | 'shape' | 'colour' | 'wave' | 'random' | 'blend' | 'maths';

export interface Idiom {
  id: string;
  name: string;
  category: IdiomCategory;
  patterns: string[];
  holes?: Record<string, HoleSpec>;
  where?: (c: IdiomText) => boolean;
  /** A short noun phrase for the result. */
  noun: (c: IdiomText) => string;
  /** What it does, as a verb phrase ("makes a soft circle …"). */
  how: (c: IdiomText) => string;
  /** The result's role, when the idiom decides it. */
  role?: Role;
  /** The made function's name. */
  fnName: string;
  /** A short noun phrase later steps use to refer to the result ("the disc"). */
  short?: string;
  /** Extra search words (for the node browser and Find uses). */
  keywords?: string[];
}

const V2: GlslType[] = ['vec2'];
const V23: GlslType[] = ['vec2', 'vec3'];
const COL: GlslType[] = ['vec3', 'vec4'];
const F: GlslType[] = ['float', 'int'];

const big = (c: IdiomText, k: string) => (c.v(k) ?? 0) > 100;

export const IDIOMS: Idiom[] = [
  // ── Randomness ──────────────────────────────────────────────────────────────
  {
    id: 'hash-sin-dot', name: 'Sine hash', category: 'random', fnName: 'hash21', short: 'the random number',
    patterns: ['fract(sin(dot($p, vec2(#a, #b))) * #k)'],
    holes: { p: { types: V2, input: 'p' }, a: { input: 'seedX' }, b: { input: 'seedY' }, k: { input: 'scale' } },
    where: c => big(c, 'k'),
    noun: c => `a pseudo-random number for each ${c.h('p')}`,
    how: c => `hashes ${c.h('p')} into a pseudo-random number from 0 to 1 (the classic fract(sin(dot(…))) hash: the same input always gives the same number, neighbours look unrelated)`,
    role: 'value', keywords: ['random', 'hash', 'noise', '12.9898', '43758'],
  },
  {
    id: 'hash-sin', name: 'Sine hash (1D)', category: 'random', fnName: 'hash11', short: 'the random number',
    patterns: ['fract(sin($x) * #k)'],
    holes: { x: { input: 'x' }, k: { input: 'scale' } },
    where: c => big(c, 'k'),
    noun: c => `a pseudo-random number for each ${c.h('x')}`,
    how: c => `hashes ${c.h('x')} into a pseudo-random number from 0 to 1 (sine times a large number, keeping the fraction)`,
    role: 'value', keywords: ['random', 'hash'],
  },
  // ── Space ───────────────────────────────────────────────────────────────────
  {
    id: 'centre-uv', name: 'Centre UV (−1…1)', category: 'space', fnName: 'centred', short: 'the centred space',
    patterns: ['$uv * 2.0 - 1.0', '($uv - 0.5) * 2.0', '2.0 * ($uv - 0.5)', '$uv * 2.0 - vec2(1.0)'],
    holes: { uv: { types: V23, roles: ['space', 'unknown', 'value'], input: 'uv' } },
    noun: c => `${c.h('uv')} centred, from −1 to 1`,
    how: c => `centres ${c.h('uv')}: 0…1 becomes −1…1, with 0 in the middle of the picture`,
    role: 'space', keywords: ['centre', 'center', 'uv', 'normalize'],
  },
  {
    id: 'remap-01', name: 'Remap −1…1 to 0…1', category: 'wave', fnName: 'to01', short: 'the 0…1 value',
    patterns: ['$x * 0.5 + 0.5', '($x + 1.0) * 0.5', '($x + 1.0) / 2.0'],
    holes: { x: { input: 'x' } },
    noun: c => /^(sin|cos)\(/.test(c.code('x')) ? `${c.h('x')}, moved to 0…1` : `${c.h('x')} remapped to 0…1`,
    how: c => /^(sin|cos)\(/.test(c.code('x'))
      ? `moves ${c.h('x')} from −1…1 up to 0…1, so it can be used as a brightness or a mix amount`
      : `remaps ${c.h('x')} from −1…1 to 0…1 (halve it, add a half)`,
    keywords: ['remap', 'normalize', 'sin', 'wave', '0.5'],
  },
  {
    id: 'centre-half', name: 'Origin to the middle', category: 'space', fnName: 'centreOrigin', short: 'the centred space',
    patterns: ['$uv - 0.5', '$uv - vec2(0.5)'],
    holes: { uv: { types: V2, strict: true, input: 'uv' } },
    noun: c => `${c.h('uv')} with the origin in the middle`,
    how: c => `moves the origin of ${c.h('uv')} to the middle: 0…1 becomes −0.5…0.5`,
    role: 'space', keywords: ['centre', 'center', 'uv'],
  },
  {
    id: 'screen-uv', name: 'Screen UV', category: 'space', fnName: 'screenUv', short: 'the screen position',
    patterns: ['gl_FragCoord.xy / u_resolution.xy', 'gl_FragCoord.xy / u_resolution'],
    noun: () => 'the pixel’s position, 0…1 across the screen',
    how: () => 'divides the pixel’s position by the picture’s size: 0…1 across the screen, (0, 0) at the bottom left',
    role: 'space', keywords: ['uv', 'screen', 'fragcoord'],
  },
  {
    id: 'centred-aspect-uv', name: 'Centred, aspect-correct UV', category: 'space', fnName: 'centredUv', short: 'the centred space',
    patterns: ['(2.0 * gl_FragCoord.xy - u_resolution.xy) / u_resolution.y', '(gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y', '(gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y'],
    noun: () => 'centred, aspect-correct coordinates',
    how: () => 'centres the pixel’s position and divides by the height: (0, 0) in the middle, squares stay square',
    role: 'space', keywords: ['uv', 'aspect', 'centre'],
  },
  {
    id: 'aspect', name: 'Aspect correction', category: 'space', fnName: 'aspectCorrect', short: 'the corrected space',
    patterns: ['$x * (u_resolution.x / u_resolution.y)', '$x * u_resolution.x / u_resolution.y'],
    holes: { x: { input: 'x' } },
    noun: c => `${c.h('x')} stretched by the picture’s aspect ratio`,
    how: c => `multiplies ${c.h('x')} by width ÷ height, so circles stay round on a wide picture`,
    keywords: ['aspect', 'resolution'],
  },
  {
    id: 'tile', name: 'Tiling (fract)', category: 'space', fnName: 'tile', short: 'the tiled space',
    patterns: ['fract($p * #n)'],
    holes: { p: { types: V23, roles: ['space', 'unknown'], input: 'p' }, n: { input: 'count' } },
    noun: c => `${c.h('p')} tiled ${c.n('n')} × ${c.n('n')}`,
    how: c => `tiles ${c.h('p')} into a ${c.n('n')} × ${c.n('n')} grid of repeating cells, 0…1 inside each`,
    role: 'space', keywords: ['tile', 'repeat', 'grid', 'fract'],
  },
  {
    id: 'tile-centred', name: 'Tiling, centred cells', category: 'space', fnName: 'tileCentred', short: 'the tiled space',
    patterns: ['fract($p * #n) - 0.5', 'fract($p) - 0.5'],
    holes: { p: { types: V23, roles: ['space', 'unknown'], input: 'p' }, n: { input: 'count' } },
    noun: c => `${c.h('p')} tiled, each cell centred`,
    how: c => c.v('n') !== undefined ? `tiles ${c.h('p')} into a ${c.n('n')} × ${c.n('n')} grid with the origin in the middle of each cell (−0.5…0.5)` : `repeats ${c.h('p')} every unit with the origin in the middle of each cell (−0.5…0.5)`,
    role: 'space', keywords: ['tile', 'repeat', 'grid'],
  },
  {
    id: 'cell-id', name: 'Cell id (floor)', category: 'space', fnName: 'cellId', short: 'the cell id',
    patterns: ['floor($p * #n)', 'floor($p)'],
    holes: { p: { types: V23, roles: ['space', 'unknown'], strict: false, input: 'p' }, n: { input: 'count' } },
    where: c => c.type('p') !== 'float' && c.type('p') !== 'int',
    noun: c => `which grid cell ${c.h('p')} is in`,
    how: c => c.v('n') !== undefined ? `finds which cell of a ${c.n('n')} × ${c.n('n')} grid ${c.h('p')} falls in: whole numbers, the same for every pixel in a cell` : `finds which unit cell ${c.h('p')} falls in: whole numbers, the same for every pixel in a cell`,
    role: 'cell', keywords: ['cell', 'id', 'grid', 'floor'],
  },
  {
    id: 'mod-repeat-centred', name: 'Repetition, centred (mod)', category: 'space', fnName: 'repeatCentred', short: 'the repeated space',
    patterns: ['mod($p + 0.5 * $c, $c) - 0.5 * $c', 'mod($p, $c) - 0.5 * $c', 'mod($p, $c) - $c * 0.5', 'mod($p + $c * 0.5, $c) - $c * 0.5'],
    holes: { p: { input: 'p' }, c: { input: 'period' } },
    noun: c => `${c.h('p')} repeated every ${c.h('c')}, centred`,
    how: c => `repeats ${c.h('p')} every ${c.h('c')}, with each copy centred on 0`,
    role: 'space', keywords: ['repeat', 'mod', 'domain repetition'],
  },
  {
    id: 'polar', name: 'Polar coordinates', category: 'space', fnName: 'toPolar', short: 'the polar coordinates',
    patterns: ['vec2(length($p), atan($p.y, $p.x))', 'vec2(atan($p.y, $p.x), length($p))'],
    holes: { p: { types: V2, input: 'p' } },
    noun: c => `${c.h('p')} in polar coordinates`,
    how: c => `turns ${c.h('p')} into polar coordinates: distance from the centre and angle around it`,
    role: 'space', keywords: ['polar', 'radial', 'angle'],
  },
  {
    id: 'angle', name: 'Angle around the origin', category: 'space', fnName: 'angleOf', short: 'the angle',
    patterns: ['atan($p.y, $p.x)'],
    holes: { p: { types: V23, input: 'p' } },
    noun: c => `the angle of ${c.h('p')}`,
    how: c => `measures the angle of ${c.h('p')} around the origin, in radians from −π to π (0 points right)`,
    role: 'angle', keywords: ['angle', 'atan', 'polar'],
  },
  {
    id: 'rotate-mat', name: 'Rotation by a matrix', category: 'space', fnName: 'rotate2d', short: 'the rotated space',
    patterns: ['mat2(cos($a), -sin($a), sin($a), cos($a)) * $p', 'mat2(cos($a), sin($a), -sin($a), cos($a)) * $p', '$p * mat2(cos($a), -sin($a), sin($a), cos($a))', '$p * mat2(cos($a), sin($a), -sin($a), cos($a))'],
    holes: { a: { input: 'angle' }, p: { types: V2, input: 'p' } },
    noun: c => `${c.h('p')} rotated by ${c.h('a')}`,
    how: c => `rotates ${c.h('p')} around the origin by ${c.h('a')} radians`,
    role: 'space', keywords: ['rotate', 'rotation', 'mat2', 'spin'],
  },
  {
    id: 'rotation-matrix', name: 'Rotation matrix', category: 'space', fnName: 'rotation', short: 'the rotation',
    patterns: ['mat2(cos($a), -sin($a), sin($a), cos($a))', 'mat2(cos($a), sin($a), -sin($a), cos($a))'],
    holes: { a: { input: 'angle' } },
    noun: c => `a rotation by ${c.h('a')}`,
    how: c => `builds a 2×2 rotation matrix for an angle of ${c.h('a')} radians: multiply a point by it to turn it around the origin`,
    keywords: ['rotate', 'rotation', 'mat2'],
  },
  {
    id: 'normalize', name: 'Direction (normalise)', category: 'maths', fnName: 'direction', short: 'the direction',
    patterns: ['normalize($v)', '$v / length($v)'],
    holes: { v: { input: 'v' } },
    noun: c => `the direction of ${c.h('v')}`,
    how: c => `keeps only the direction of ${c.h('v')}: the same way, length 1`,
    role: 'direction', keywords: ['normalize', 'unit', 'direction'],
  },
  // ── Shapes ──────────────────────────────────────────────────────────────────
  {
    id: 'soft-circle-inside', name: 'Soft circle (filled)', category: 'shape', fnName: 'softDisc', short: 'the disc',
    patterns: ['1.0 - smoothstep($r, $r + $w, length($p))', 'smoothstep($r + $w, $r, length($p))', '1.0 - smoothstep($r - $w, $r, length($p))', 'smoothstep($r, $r - $w, length($p))'],
    holes: { r: { input: 'radius' }, w: { input: 'softness' }, p: { types: V23, input: 'p' } },
    noun: c => `a soft disc of radius ${c.h('r')}`,
    where: c => (c.v('w') ?? 1) > 0,
    how: c => `draws a filled disc of radius ${c.h('r')} around the origin of ${c.h('p')}: 1 inside, fading to 0 over ${c.h('w')}`,
    role: 'mask', keywords: ['circle', 'disc', 'soft', 'smoothstep', 'mask'],
  },
  {
    id: 'soft-circle', name: 'Soft circle', category: 'shape', fnName: 'softCircle', short: 'the soft circle',
    patterns: ['smoothstep($r, $r + $w, length($p))', 'smoothstep($r - $w, $r + $w, length($p))', 'smoothstep($r - $w, $r, length($p))'],
    holes: { r: { input: 'radius' }, w: { input: 'width' }, p: { types: V23, input: 'p' } },
    noun: c => `a soft-edged circle of radius ${c.h('r')}`,
    where: c => (c.v('w') ?? 1) > 0,
    how: c => `makes a soft-edged circle of radius ${c.h('r')} around the origin of ${c.h('p')}: 0 inside, rising to 1 over ${c.h('w')} outside it`,
    role: 'mask', keywords: ['circle', 'soft', 'smoothstep', 'mask', 'radius'],
  },
  {
    id: 'circle-sdf', name: 'Circle SDF', category: 'shape', fnName: 'sdCircle', short: 'the circle',
    patterns: ['length($p) - $r'],
    holes: { p: { types: V23, input: 'p' }, r: { input: 'radius' } },
    noun: c => `the signed distance to a circle of radius ${c.h('r')}`,
    how: c => `measures the signed distance from ${c.h('p')} to a circle of radius ${c.h('r')}: negative inside, 0 on the edge, positive outside`,
    role: 'distance', keywords: ['circle', 'sdf', 'distance', 'radius'],
  },
  {
    id: 'ring-sdf', name: 'Ring (circle outline)', category: 'shape', fnName: 'sdRing', short: 'the ring',
    patterns: ['abs(length($p) - $r)', 'abs(length($p) - $r) - $w'],
    holes: { p: { types: V23, input: 'p' }, r: { input: 'radius' }, w: { input: 'thickness' } },
    noun: c => `the distance to a ring of radius ${c.h('r')}`,
    how: c => `measures the distance from ${c.h('p')} to the outline of a circle of radius ${c.h('r')}${c.code('w') ? `, thickened by ${c.h('w')}` : ''}: 0 on the ring`,
    role: 'distance', keywords: ['ring', 'circle', 'outline', 'sdf'],
  },
  {
    id: 'box-sdf', name: 'Box SDF', category: 'shape', fnName: 'sdBox2', short: 'the box',
    patterns: ['length(max(abs($p) - $b, 0.0)) + min(max($q.x, $q.y), 0.0)', 'length(max($q, 0.0)) + min(max($q.x, $q.y), 0.0)'],
    holes: { p: { types: V2, input: 'p' }, b: { input: 'halfSize' }, q: { input: 'q' } },
    noun: () => 'the signed distance to a box',
    how: c => c.code('b') ? `measures the signed distance from ${c.h('p')} to a box of half-size ${c.h('b')}: negative inside, positive outside` : `turns the per-axis offsets ${c.h('q')} into the signed distance to a box: the outside part’s length plus the inside part`,
    role: 'distance', keywords: ['box', 'rectangle', 'sdf', 'distance'],
  },
  {
    id: 'box-sdf-outside', name: 'Box distance (outside only)', category: 'shape', fnName: 'udBox', short: 'the box',
    patterns: ['length(max(abs($p) - $b, 0.0))'],
    holes: { p: { types: V2, input: 'p' }, b: { input: 'halfSize' } },
    noun: c => `the distance to a box of half-size ${c.h('b')}`,
    how: c => `measures how far ${c.h('p')} is outside a box of half-size ${c.h('b')} (0 anywhere inside)`,
    role: 'distance', keywords: ['box', 'rectangle', 'distance'],
  },
  {
    id: 'box-offsets', name: 'Box offsets', category: 'shape', fnName: 'boxOffsets', short: 'the box offsets',
    patterns: ['abs($p) - $b'],
    holes: { p: { types: V2, strict: true, input: 'p' }, b: { input: 'halfSize' } },
    noun: c => `${c.h('p')}’s offsets from a box of half-size ${c.h('b')}`,
    how: c => `folds ${c.h('p')} into one quarter and subtracts the half-size ${c.h('b')}: per axis, how far outside a box it is (the first step of a box SDF)`,
    role: 'space', keywords: ['box', 'sdf'],
  },
  {
    id: 'onion', name: 'Outline of a shape', category: 'shape', fnName: 'outline', short: 'the outline',
    patterns: ['abs($d) - $w'],
    holes: { d: { roles: ['distance'], strict: true, input: 'd' }, w: { input: 'thickness' } },
    noun: c => `an outline of ${c.h('d')}`,
    how: c => `turns the shape ${c.h('d')} into an outline of thickness ${c.h('w')} on each side of its edge`,
    role: 'distance', keywords: ['outline', 'onion', 'stroke', 'sdf'],
  },
  {
    id: 'fill-soft', name: 'Soft fill of a distance', category: 'shape', fnName: 'fillSoft', short: 'the fill',
    patterns: ['smoothstep(#w, 0.0, $d)', '1.0 - smoothstep(0.0, #w, $d)', 'smoothstep($w, 0.0, $d)', '1.0 - smoothstep(0.0, $w, $d)'],
    holes: { d: { roles: ['distance', 'unknown', 'value'], input: 'd' }, w: { input: 'softness' } },
    noun: c => `${c.h('d')} filled, with a soft edge`,
    how: c => `fills the shape ${c.h('d')}: 1 inside, fading to 0 over ${c.h('w')} past its edge`,
    role: 'mask', keywords: ['fill', 'shape', 'antialias', 'smoothstep'],
  },
  {
    id: 'fill-hard', name: 'Hard fill of a distance', category: 'shape', fnName: 'fillHard', short: 'the fill',
    patterns: ['step($d, 0.0)', '1.0 - step(0.0, $d)'],
    holes: { d: { input: 'd' } },
    noun: c => `${c.h('d')} filled`,
    how: c => `fills the shape ${c.h('d')}: 1 wherever it is 0 or below (inside), 0 outside`,
    role: 'mask', keywords: ['fill', 'step'],
  },
  {
    id: 'sdf-union', name: 'Union of two shapes', category: 'shape', fnName: 'opUnion', short: 'the union',
    patterns: ['min($a, $b)'],
    holes: { a: { roles: ['distance'], strict: true, input: 'a' }, b: { roles: ['distance'], strict: true, input: 'b' } },
    noun: c => `${c.h('a')} together with ${c.h('b')}`,
    how: c => `combines the shapes ${c.h('a')} and ${c.h('b')}: the nearer distance wins, so both are drawn`,
    role: 'distance', keywords: ['union', 'min', 'sdf', 'combine'],
  },
  {
    id: 'sdf-subtract', name: 'Shape minus shape', category: 'shape', fnName: 'opSubtract', short: 'the cut shape',
    patterns: ['max($a, -$b)'],
    holes: { a: { roles: ['distance'], input: 'a' }, b: { roles: ['distance'], input: 'b' } },
    noun: c => `${c.h('a')} with ${c.h('b')} cut out`,
    how: c => `cuts the shape ${c.h('b')} out of ${c.h('a')}`,
    role: 'distance', keywords: ['subtract', 'cut', 'sdf'],
  },
  {
    id: 'sdf-intersect', name: 'Intersection of two shapes', category: 'shape', fnName: 'opIntersect', short: 'the overlap',
    patterns: ['max($a, $b)'],
    holes: { a: { roles: ['distance'], strict: true, input: 'a' }, b: { roles: ['distance'], strict: true, input: 'b' } },
    noun: c => `where ${c.h('a')} and ${c.h('b')} overlap`,
    how: c => `keeps only where the shapes ${c.h('a')} and ${c.h('b')} overlap: the farther distance wins`,
    role: 'distance', keywords: ['intersect', 'max', 'sdf'],
  },
  {
    id: 'smin-poly', name: 'Smooth minimum (polynomial)', category: 'shape', fnName: 'smin', short: 'the smooth union',
    patterns: ['mix($b, $a, $h) - $k * $h * (1.0 - $h)'],
    holes: { a: { input: 'a' }, b: { input: 'b' }, h: { input: 'h' }, k: { input: 'smoothness' } },
    noun: c => `a smooth blend of ${c.h('a')} and ${c.h('b')}`,
    how: c => `blends ${c.h('a')} and ${c.h('b')} with a rounded join of size ${c.h('k')} (Inigo Quilez’s polynomial smooth minimum, weight ${c.h('h')})`,
    role: 'distance', keywords: ['smin', 'smooth union', 'blend', 'metaball'],
  },
  {
    id: 'smin-weight', name: 'Smooth minimum weight', category: 'shape', fnName: 'sminWeight', short: 'the blend weight',
    patterns: ['clamp(0.5 + 0.5 * ($b - $a) / $k, 0.0, 1.0)'],
    holes: { a: { input: 'a' }, b: { input: 'b' }, k: { input: 'smoothness' } },
    noun: c => `the blend weight between ${c.h('a')} and ${c.h('b')}`,
    how: c => `works out how much of ${c.h('a')} versus ${c.h('b')} to use near where they meet, over a width of ${c.h('k')} (the weight of a polynomial smooth minimum)`,
    role: 'mask', keywords: ['smin', 'smooth union'],
  },
  {
    id: 'smin-exp', name: 'Smooth minimum (exponential)', category: 'shape', fnName: 'sminExp', short: 'the smooth union',
    patterns: ['-log(exp(-$k * $a) + exp(-$k * $b)) / $k', '-$k * log(exp(-$a / $k) + exp(-$b / $k))'],
    holes: { a: { input: 'a' }, b: { input: 'b' }, k: { input: 'sharpness' } },
    noun: c => `a smooth blend of ${c.h('a')} and ${c.h('b')}`,
    how: c => `blends ${c.h('a')} and ${c.h('b')} with a soft, rounded join (exponential smooth minimum, ${c.h('k')} sets how soft)`,
    role: 'distance', keywords: ['smin', 'smooth union', 'exponential'],
  },
  {
    id: 'smin-root', name: 'Smooth minimum (root)', category: 'shape', fnName: 'sminRoot', short: 'the smooth union',
    patterns: ['0.5 * (($a + $b) - sqrt(($a - $b) * ($a - $b) + $k))', '0.5 * ($a + $b - sqrt(($a - $b) * ($a - $b) + $k))'],
    holes: { a: { input: 'a' }, b: { input: 'b' }, k: { input: 'smoothness' } },
    noun: c => `a smooth blend of ${c.h('a')} and ${c.h('b')}`,
    how: c => `blends ${c.h('a')} and ${c.h('b')} with a rounded join (square-root smooth minimum, ${c.h('k')} sets the roundness)`,
    role: 'distance', keywords: ['smin', 'smooth union'],
  },
  // ── Glow ────────────────────────────────────────────────────────────────────
  {
    id: 'glow-exp', name: 'Exponential glow', category: 'shape', fnName: 'glowExp', short: 'the glow',
    patterns: ['exp(-#k * $d)', 'exp(-$k * $d)', 'exp(-$d / #k)'],
    holes: { k: { input: 'falloff' }, d: { input: 'd' } },
    noun: c => `a glow around ${c.h('d')}`,
    how: c => `makes a glow from ${c.h('d')}: 1 where it is 0, dying away smoothly as it grows${c.v('k') !== undefined ? ` (rate ${c.n('k')})` : ` (rate ${c.h('k')})`}`,
    role: 'mask', keywords: ['glow', 'exp', 'falloff', 'light'],
  },
  {
    id: 'glow-inv', name: 'Inverse glow', category: 'shape', fnName: 'glowInv', short: 'the glow',
    patterns: ['1.0 / (1.0 + #k * $d)', '1.0 / (1.0 + $k * $d)', '1.0 / (1.0 + $d)'],
    holes: { k: { input: 'falloff' }, d: { input: 'd' } },
    noun: c => `a soft glow around ${c.h('d')}`,
    how: c => `makes a glow from ${c.h('d')}: 1 where it is 0, falling off like 1/distance${c.code('k') ? ` (${c.h('k')} sets how fast)` : ''}, with a long tail`,
    role: 'mask', keywords: ['glow', 'falloff', 'light'],
  },
  {
    id: 'glow-over', name: 'Glow (k / d)', category: 'shape', fnName: 'glowOver', short: 'the glow',
    patterns: ['#k / abs($d)', '#k / $d'],
    holes: { k: { input: 'strength' }, d: { roles: ['distance', 'unknown'], input: 'd' } },
    where: c => (c.v('k') ?? 1) < 1,
    noun: c => `a bright glow around ${c.h('d')}`,
    how: c => `makes a bright glow: ${c.n('k')} divided by the distance ${c.h('d')}, so it shoots up near the edge and fades slowly`,
    role: 'mask', keywords: ['glow', 'neon'],
  },
  // ── Waves and shaping ───────────────────────────────────────────────────────
  {
    id: 'triangle', name: 'Triangle wave', category: 'wave', fnName: 'triangleWave', short: 'the triangle wave',
    patterns: ['abs(fract($x) - 0.5)', 'abs(fract($x) * 2.0 - 1.0)', 'abs(2.0 * fract($x) - 1.0)'],
    holes: { x: { input: 'x' } },
    noun: c => `a triangle wave of ${c.h('x')}`,
    how: c => `makes a triangle wave from ${c.h('x')}: rises and falls in straight lines, once every unit`,
    keywords: ['triangle', 'zigzag', 'wave', 'fract'],
  },
  {
    id: 'smoothstep-hand', name: 'Smoothstep by hand', category: 'wave', fnName: 'smoothCurve', short: 'the eased value',
    patterns: ['$x * $x * (3.0 - 2.0 * $x)'],
    holes: { x: { input: 'x' } },
    noun: c => `${c.h('x')} eased with an S-curve`,
    how: c => `eases ${c.h('x')} with smoothstep’s S-curve (3x² − 2x³): flat at 0 and 1, steepest in the middle`,
    keywords: ['smoothstep', 'ease', 'hermite', 'curve'],
  },
  {
    id: 'quintic', name: 'Quintic fade', category: 'wave', fnName: 'quinticFade', short: 'the eased value',
    patterns: ['$x * $x * $x * ($x * ($x * 6.0 - 15.0) + 10.0)'],
    holes: { x: { input: 'x' } },
    noun: c => `${c.h('x')} eased with a quintic curve`,
    how: c => `eases ${c.h('x')} with Perlin’s quintic fade (6x⁵ − 15x⁴ + 10x³): smoother than smoothstep at the ends`,
    keywords: ['fade', 'quintic', 'ease', 'perlin'],
  },
  {
    id: 'saturate', name: 'Clamp to 0…1', category: 'maths', fnName: 'saturate', short: 'the clamped value',
    patterns: ['clamp($x, 0.0, 1.0)', 'min(max($x, 0.0), 1.0)', 'max(min($x, 1.0), 0.0)'],
    holes: { x: { input: 'x' } },
    noun: c => `${c.h('x')} kept in 0…1`,
    how: c => `clamps ${c.h('x')} to 0…1 (“saturate”): anything below 0 becomes 0, anything above 1 becomes 1`,
    keywords: ['clamp', 'saturate'],
  },
  {
    id: 'step-band', name: 'Band (step − step)', category: 'shape', fnName: 'band', short: 'the band',
    patterns: ['step($a, $x) - step($b, $x)'],
    holes: { a: { input: 'from' }, b: { input: 'to' }, x: { input: 'x' } },
    noun: c => `a band where ${c.h('x')} is between ${c.h('a')} and ${c.h('b')}`,
    how: c => `makes a band: 1 where ${c.h('x')} is between ${c.h('a')} and ${c.h('b')}, 0 elsewhere`,
    role: 'mask', keywords: ['band', 'stripe', 'step', 'pulse'],
  },
  {
    id: 'quantise', name: 'Quantise into steps', category: 'maths', fnName: 'quantise', short: 'the stepped value',
    patterns: ['floor($x * $n) / $n', 'floor($x * $n + 0.5) / $n'],
    holes: { x: { input: 'x' }, n: { input: 'steps' } },
    noun: c => `${c.h('x')} in ${c.h('n')} steps`,
    how: c => `snaps ${c.h('x')} down to ${c.h('n')} steps per unit (posterise)`,
    keywords: ['quantise', 'quantize', 'posterize', 'steps', 'floor'],
  },
  {
    id: 'checker', name: 'Checkerboard', category: 'shape', fnName: 'checker', short: 'the checkerboard',
    patterns: ['mod(floor($p.x) + floor($p.y), 2.0)', 'mod($c.x + $c.y, 2.0)'],
    holes: { p: { types: V2, input: 'p' }, c: { roles: ['cell'], strict: true, input: 'cell' } },
    noun: c => `a checkerboard over ${c.h('p') || c.h('c')}`,
    how: c => `makes a checkerboard over ${c.h('p') || c.h('c')}: 0 and 1 alternating from one unit cell to the next`,
    role: 'mask', keywords: ['checker', 'checkerboard', 'grid'],
  },
  {
    id: 'rings', name: 'Rings spreading out', category: 'wave', fnName: 'ripples', short: 'the rings',
    patterns: ['sin(length($p) * $f - $t)', 'sin(length($p) * $f + $t)', 'sin($f * length($p) - $t)'],
    holes: { p: { types: V23, input: 'p' }, f: { input: 'frequency' }, t: { input: 't' } },
    noun: c => `rings around ${c.h('p')}’s origin`,
    how: c => `makes rings around the centre of ${c.h('p')}: a wave over the distance, ${c.h('f')} per unit, moving as ${c.h('t')} changes`,
    keywords: ['rings', 'ripple', 'wave', 'radial'],
  },
  // ── Colour ──────────────────────────────────────────────────────────────────
  {
    id: 'luma-601', name: 'Luminance (Rec. 601)', category: 'colour', fnName: 'luma601', short: 'the brightness',
    patterns: ['dot($c, vec3(0.299, 0.587, 0.114))', 'dot($c.rgb, vec3(0.299, 0.587, 0.114))'],
    holes: { c: { input: 'col' } },
    noun: c => `the brightness of ${c.h('c')}`,
    how: c => `measures how bright ${c.h('c')} looks: green counts most and blue least (Rec. 601 luma weights)`,
    role: 'value', keywords: ['luma', 'luminance', 'brightness', 'grey', 'gray'],
  },
  {
    id: 'luma-709', name: 'Luminance (Rec. 709)', category: 'colour', fnName: 'luma709', short: 'the brightness',
    patterns: ['dot($c, vec3(0.2126, 0.7152, 0.0722))', 'dot($c.rgb, vec3(0.2126, 0.7152, 0.0722))'],
    holes: { c: { input: 'col' } },
    noun: c => `the brightness of ${c.h('c')}`,
    how: c => `measures how bright ${c.h('c')} looks: green counts most and blue least (Rec. 709 / sRGB luminance weights)`,
    role: 'value', keywords: ['luma', 'luminance', 'brightness', 'grey', 'gray'],
  },
  {
    id: 'grey-average', name: 'Grey (channel average)', category: 'colour', fnName: 'greyAverage', short: 'the grey',
    patterns: ['($c.r + $c.g + $c.b) / 3.0', 'dot($c, vec3(1.0 / 3.0))'],
    holes: { c: { input: 'col' } },
    noun: c => `the average of ${c.h('c')}’s channels`,
    how: c => `averages the red, green and blue of ${c.h('c')}: a simple grey (it ignores that green looks brighter)`,
    role: 'value', keywords: ['grey', 'gray', 'average'],
  },
  {
    id: 'iq-palette', name: 'Cosine palette (Inigo Quilez)', category: 'colour', fnName: 'cosPalette', short: 'the palette colour',
    patterns: ['$a + $b * cos(6.28318 * ($c * $t + $d))', '$a + $b * cos(6.28318 * $c * $t + 6.28318 * $d)', '$a + $b * cos(6.28318 * ($t * $c + $d))'],
    holes: { a: { input: 'bias' }, b: { input: 'amp' }, c: { input: 'freq' }, t: { input: 't' }, d: { input: 'phase' } },
    noun: c => `a palette colour for ${c.h('t')}`,
    how: c => `picks a colour for ${c.h('t')} from Inigo Quilez’s cosine palette: each channel is a cosine wave around ${c.h('a')}, swinging by ${c.h('b')}, ${c.h('c')} times per unit, shifted by ${c.h('d')}`,
    role: 'colour', keywords: ['palette', 'cosine', 'iq', 'colour', 'gradient'],
  },
  {
    id: 'gamma-encode', name: 'Gamma correction (to display)', category: 'colour', fnName: 'gammaEncode', short: 'the corrected colour',
    patterns: ['pow($c, vec3(1.0 / 2.2))', 'pow($c, vec3(0.4545))', 'pow($c, vec4(1.0 / 2.2))'],
    holes: { c: { input: 'col' } },
    noun: c => `${c.h('c')} gamma-corrected`,
    how: c => `gamma-corrects ${c.h('c')} for the screen (power 1/2.2): linear light to roughly sRGB, lifting the darks`,
    role: 'colour', keywords: ['gamma', 'srgb', 'pow', '2.2'],
  },
  {
    id: 'gamma-decode', name: 'Gamma to linear', category: 'colour', fnName: 'gammaDecode', short: 'the linear colour',
    patterns: ['pow($c, vec3(2.2))', 'pow($c, vec4(2.2))'],
    holes: { c: { input: 'col' } },
    noun: c => `${c.h('c')} in linear light`,
    how: c => `turns the sRGB colour ${c.h('c')} into linear light (power 2.2), so mixing and lighting add up correctly`,
    role: 'colour', keywords: ['gamma', 'linear', 'pow', '2.2'],
  },
  {
    id: 'contrast', name: 'Contrast around mid-grey', category: 'colour', fnName: 'contrast', short: 'the contrasted colour',
    patterns: ['($c - 0.5) * $k + 0.5'],
    holes: { c: { input: 'col' }, k: { input: 'contrast' } },
    noun: c => `${c.h('c')} with contrast ${c.h('k')}`,
    how: c => `scales ${c.h('c')} away from mid-grey by ${c.h('k')}: above 1 more contrast, below 1 flatter`,
    keywords: ['contrast'],
  },
  {
    id: 'vignette', name: 'Vignette', category: 'colour', fnName: 'vignette', short: 'the vignette',
    patterns: ['1.0 - dot($p, $p) * $k', '1.0 - $k * dot($p, $p)', '1.0 - length($p) * $k'],
    holes: { p: { types: V2, input: 'p' }, k: { input: 'strength' } },
    noun: c => `a vignette over ${c.h('p')}`,
    how: c => `makes a vignette: 1 in the middle of ${c.h('p')}, darker toward the edges (by ${c.h('k')})`,
    role: 'mask', keywords: ['vignette', 'darken', 'edges'],
  },
  // ── Blending and maths ──────────────────────────────────────────────────────
  {
    id: 'mix-half', name: 'Halfway mix', category: 'blend', fnName: 'halfway', short: 'the midpoint',
    patterns: ['mix($a, $b, 0.5)', '($a + $b) * 0.5', '($a + $b) / 2.0'],
    holes: { a: { input: 'a' }, b: { input: 'b' } },
    noun: c => `halfway between ${c.h('a')} and ${c.h('b')}`,
    how: c => `takes the point halfway between ${c.h('a')} and ${c.h('b')} (their average)`,
    keywords: ['average', 'mix', 'midpoint'],
  },
  {
    id: 'inverse-lerp', name: 'Where between (inverse mix)', category: 'blend', fnName: 'inverseLerp', short: 'the position between',
    patterns: ['($x - $a) / ($b - $a)'],
    holes: { x: { input: 'x' }, a: { input: 'from' }, b: { input: 'to' } },
    noun: c => `where ${c.h('x')} sits between ${c.h('a')} and ${c.h('b')}`,
    how: c => `finds where ${c.h('x')} sits between ${c.h('a')} and ${c.h('b')}, as 0…1 (the opposite of mix)`,
    keywords: ['remap', 'inverse lerp', 'normalize'],
  },
  {
    id: 'dot-self', name: 'Squared length', category: 'maths', fnName: 'lengthSq', short: 'the squared length',
    patterns: ['dot($p, $p)'],
    holes: { p: { input: 'p' } },
    noun: c => `the squared length of ${c.h('p')}`,
    how: c => `measures the squared distance of ${c.h('p')} from the origin (length², cheaper than length: no square root)`,
    role: 'distance', keywords: ['dot', 'length', 'squared'],
  },
  {
    id: 'distance-between', name: 'Distance between points', category: 'maths', fnName: 'distanceTo', short: 'the distance',
    patterns: ['length($a - $b)', 'distance($a, $b)'],
    holes: { a: { input: 'a' }, b: { input: 'b' } },
    where: c => c.type('a') !== 'float' && c.type('b') !== 'float',
    noun: c => `the distance from ${c.h('b')} to ${c.h('a')}`,
    how: c => `measures how far ${c.h('a')} is from ${c.h('b')}`,
    role: 'distance', keywords: ['distance', 'length'],
  },
  {
    id: 'mod-repeat', name: 'Repetition (mod)', category: 'space', fnName: 'repeatEvery', short: 'the repeating value',
    patterns: ['mod($p, $c)'],
    holes: { p: { input: 'p' }, c: { input: 'period' } },
    noun: c => `${c.h('p')} repeating every ${c.h('c')}`,
    how: c => `wraps ${c.h('p')} back to 0 every ${c.h('c')}, so whatever is drawn in 0…${c.h('c')} repeats`,
    keywords: ['repeat', 'mod', 'wrap'],
  },
  {
    id: 'step-threshold-inv', name: 'Threshold (below)', category: 'shape', fnName: 'below', short: 'the cut',
    patterns: ['1.0 - step($e, $x)', 'step($x, $e)'],
    holes: { e: { input: 'threshold' }, x: { input: 'x' } },
    // `step(0.5, x)` is the ordinary threshold, not “0.5 below x”
    where: c => c.v('x') === undefined || c.v('e') !== undefined,
    noun: c => `where ${c.h('x')} is below ${c.h('e')}`,
    how: c => `cuts ${c.h('x')} at ${c.h('e')}: 1 below it, 0 at or above (a hard edge)`,
    role: 'mask', keywords: ['step', 'threshold', 'cut'],
  },
  {
    id: 'step-threshold', name: 'Threshold (step)', category: 'shape', fnName: 'threshold', short: 'the cut',
    patterns: ['step($e, $x)'],
    holes: { e: { input: 'threshold' }, x: { input: 'x' } },
    noun: c => `where ${c.h('x')} reaches ${c.h('e')}`,
    how: c => `cuts ${c.h('x')} at ${c.h('e')}: 0 below it, 1 at or above (a hard edge)`,
    role: 'mask', keywords: ['step', 'threshold', 'cut'],
  },
  {
    id: 'mix', name: 'Blend (mix)', category: 'blend', fnName: 'blend', short: 'the blend',
    patterns: ['mix($a, $b, $t)', '$a + ($b - $a) * $t', '$a * (1.0 - $t) + $b * $t'],
    holes: { a: { input: 'a' }, b: { input: 'b' }, t: { input: 'amount' } },
    noun: c => `a blend of ${c.h('a')} and ${c.h('b')}`,
    how: c => (c.v('t') !== undefined
      ? `mixes ${Math.round((c.v('t') as number) * 100)}% of ${c.h('b')} into ${c.h('a')}`
      : `blends from ${c.h('a')} (when ${c.h('t')} is 0) to ${c.h('b')} (when it is 1)`),
    keywords: ['mix', 'lerp', 'blend', 'interpolate'],
  },
  {
    id: 'invert', name: 'Invert (1 − x)', category: 'maths', fnName: 'invert', short: 'the flipped value',
    patterns: ['1.0 - $x'],
    holes: { x: { input: 'x' } },
    where: c => c.code('x') !== '' ,
    noun: c => c.role('x') === 'colour' ? `the negative of ${c.h('x')}` : `${c.h('x')} flipped`,
    how: c => c.role('x') === 'colour' ? `inverts the colour ${c.h('x')}: a photo negative` : `flips ${c.h('x')}: 0 becomes 1 and 1 becomes 0`,
    keywords: ['invert', 'flip', 'one minus'],
  },
];

export function idiomById(id: string): Idiom | undefined {
  return IDIOMS.find(i => i.id === id);
}

/** Register an idiom at runtime (another module's patterns). Later ones are tried last; `first` puts it in front. */
export function registerIdiom(idiom: Idiom, first = false): void {
  const at = IDIOMS.findIndex(i => i.id === idiom.id);
  if (at >= 0) IDIOMS.splice(at, 1);
  if (first) IDIOMS.unshift(idiom); else IDIOMS.push(idiom);
}

/** The literal types a hole spec allows; used by tests and the docs. */
export const HOLE_TYPE_SETS = { V2, V23, COL, F };
