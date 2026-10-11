/**
 * Guided Convert, recognised idioms as library nodes (docs/guided-convert.md, "Recognised patterns"):
 * for each idiom the Explain panel's matcher knows (glslPatterns) that a library node draws, the
 * recipe that wires that node from the idiom's parts. The converter calls a recipe with the call's
 * arguments (`NodeCall`); the recipe makes the nodes and says which output is the value.
 *
 * `exact` says the node computes the same arithmetic as the code; the others (a different but equal
 * formula, a slightly different constant) are only offered when the pixel check passes (check.ts).
 */
import type { CallArg, CallMaker, CallWire, NodeCall } from '../../glslToGraph';

type Ty = 'float' | 'vec2' | 'vec3' | 'vec4';

export interface Recipe {
  /** Our id, stable: it names the pseudo function and keys the step's choice. */
  kind: string;
  /** The glslPatterns idiom whose patterns find it. */
  idiom: string;
  /** Only these of the idiom's patterns (by index); all when absent. */
  patterns?: number[];
  /** What it is, in words ("a soft circle"). */
  what: string;
  /** The node(s) it becomes ("Circle SDF + SDF Mask"). */
  node: string;
  exact: boolean;
  /** The types each hole may have (the pseudo function's parameters, in this order). */
  holes: Record<string, Ty[]>;
  /** The types the whole may have. */
  ret: Ty[];
  /** The nodes, for the pattern matched (`variant`: the index of the idiom pattern that matched). */
  make: (variant: number) => NodeCall;
}

const arg = (name: string): CallWire => ({ arg: name });
/** A number argument as the socket's slider, else the wire. */
const num = (args: Readonly<Record<string, CallArg>>, name: string, scale = 1): CallWire | undefined => {
  const a = args[name];
  return a.lit !== undefined ? { lit: a.lit * scale } : scale === 1 ? arg(name) : undefined;
};
/** `x * k` as a Multiply card (a number folds into its slider). */
function times(m: CallMaker, args: Readonly<Record<string, CallArg>>, name: string, k: number): CallWire {
  const a = args[name];
  if (a.lit !== undefined || k === 0) return { lit: (a.lit ?? 0) * k };
  return { node: m.node('multiply', { outputType: 'float', b: k }, { a: arg(name) }), out: 'result' };
}
const circle = (m: CallMaker, args: Readonly<Record<string, CallArg>>, type = 'circleSDF') =>
  m.node(type, { posX: 0, posY: 0 }, { position: arg('p'), radius: num(args, 'r') ?? arg('r') });

/**
 * Soft discs: `1 - smoothstep(r, r + w, length(p))` and its spellings are a Circle SDF filled by an
 * SDF Mask, `1 - smoothstep(t - s, t + s, d)`: the edges, measured from the circle's edge, are its
 * threshold ± softness. `lo`/`hi` say where the edges sit, as multiples of w past r.
 */
function softDisc(lo: number, hi: number): NodeCall {
  return (args, m) => {
    const d = circle(m, args);
    const thr = times(m, args, 'w', (lo + hi) / 2);
    const soft = times(m, args, 'w', (hi - lo) / 2);
    return { node: m.node('sdfMask', {}, { sdf: { node: d, out: 'distance' }, threshold: thr, softness: soft }), out: 'mask' };
  };
}
/** Soft circles (0 inside, 1 outside): a Circle SDF through a Smoothstep with the edges measured from the circle's edge. */
function softCircle(lo: number, hi: number): NodeCall {
  return (args, m) => {
    const d = circle(m, args);
    return { node: m.node('smoothstep', { outputType: 'float' }, { value: { node: d, out: 'distance' }, edge0: times(m, args, 'w', lo), edge1: times(m, args, 'w', hi) }), out: 'result' };
  };
}
/** A vec3 argument as the Palette's colour param when it is numbers, else a wire. */
const vec3Param = (args: Readonly<Record<string, CallArg>>, name: string): number[] | undefined => {
  const a = args[name];
  if (a?.vec?.length === 3) return a.vec;
  return a?.lit !== undefined ? [a.lit, a.lit, a.lit] : undefined;
};
function palette(withFreq: boolean): NodeCall {
  return (args, m) => {
    const params: Record<string, unknown> = { preset: 'custom', scale: 1, speed: 1, anim: 0 };
    const wires: Record<string, CallWire | undefined> = { value: arg('t') };
    const slots: [string, string][] = [['offset', 'a'], ['amplitude', 'b'], ['phase', 'd'], ...(withFreq ? [['freq', 'c'] as [string, string]] : [])];
    for (const [key, hole] of slots) {
      const v = vec3Param(args, hole);
      if (v) params[key] = v;
      else if (args[hole].type === 'vec3') wires[key] = arg(hole);
      else return null; // a float bias / amplitude: GLSL widens it, the node's socket doesn't
    }
    if (!withFreq) params.freq = [1, 1, 1];
    return { node: m.node('palette', params, wires), out: 'color' };
  };
}
/** A rotation `M * p` / `p * M`: a 2D Transform turning p by ±a (`sign`), a number angle on its Rotate slider (degrees). */
function rotation(sign: 1 | -1): NodeCall {
  return (args, m) => {
    const a = args.a;
    if (a.lit !== undefined) return { node: m.node('transform', { dim: '2', mode: 'space', rotate: sign * a.lit * 180 / Math.PI }, { p: arg('p') }), out: 'p' };
    const turn: CallWire = sign === 1 ? arg('a') : { node: m.node('negate', { outputType: 'float' }, { input: arg('a') }), out: 'output' };
    return { node: m.node('transform', { dim: '2', mode: 'space' }, { p: arg('p'), turn }), out: 'p' };
  };
}

export const RECIPES: Recipe[] = [
  // Shapes first: a soft disc holds a circle SDF, so the bigger match wins.
  {
    kind: 'softDisc', idiom: 'soft-circle-inside', what: 'a soft disc', node: 'Circle SDF + SDF Mask', exact: false,
    holes: { p: ['vec2'], r: ['float'], w: ['float'] }, ret: ['float'],
    // 1 - smoothstep(r, r+w, …), smoothstep(r+w, r, …): edges at r, r+w. 1 - smoothstep(r-w, r, …), smoothstep(r, r-w, …): at r-w, r.
    make: v => (v <= 1 ? softDisc(0, 1) : softDisc(-1, 0)),
  },
  {
    kind: 'softCircle', idiom: 'soft-circle', what: 'a soft-edged circle', node: 'Circle SDF + Smoothstep', exact: false,
    holes: { p: ['vec2'], r: ['float'], w: ['float'] }, ret: ['float'],
    make: v => (v === 0 ? softCircle(0, 1) : v === 1 ? softCircle(-1, 1) : softCircle(-1, 0)),
  },
  {
    kind: 'ring', idiom: 'ring-sdf', what: 'a ring', node: 'Ring SDF', exact: true,
    holes: { p: ['vec2'], r: ['float'], w: ['float'] }, ret: ['float'],
    make: v => (args, m) => {
      const ring = circle(m, args, 'ringSDF');
      if (v === 0) return { node: ring, out: 'distance' };
      return { node: m.node('subtract', { outputType: 'float', ...(args.w.lit !== undefined ? { b: args.w.lit } : {}) }, { a: { node: ring, out: 'distance' }, ...(args.w.lit === undefined ? { b: arg('w') } : {}) }), out: 'result' };
    },
  },
  {
    kind: 'circle', idiom: 'circle-sdf', what: 'a circle', node: 'Circle SDF', exact: true,
    holes: { p: ['vec2'], r: ['float'] }, ret: ['float'],
    make: () => (args, m) => ({ node: circle(m, args), out: 'distance' }),
  },
  {
    kind: 'box', idiom: 'box-sdf', patterns: [0], what: 'a box', node: 'Box SDF', exact: true,
    holes: { p: ['vec2'], b: ['vec2'] }, ret: ['float'],
    make: () => (args, m) => {
      const dims = args.b.vec;
      return { node: m.node('boxSDF', { posX: 0, posY: 0, ...(dims ? { width: dims[0], height: dims[1] } : {}) }, { position: arg('p'), ...(dims ? {} : { dimensions: arg('b') }) }), out: 'distance' };
    },
  },
  // Space.
  {
    kind: 'rotate', idiom: 'rotate-mat', what: 'a rotation', node: 'Transform', exact: true,
    holes: { p: ['vec2'], a: ['float'] }, ret: ['vec2'],
    // The variant here is ours (recognise.ts): 1 when the turn is +a, -1 when -a.
    make: v => rotation(v === 1 ? 1 : -1),
  },
  {
    kind: 'tileCentred', idiom: 'tile-centred', patterns: [0], what: 'tiled space, centred', node: 'Tile', exact: true,
    holes: { p: ['vec2'], n: ['float'] }, ret: ['vec2'],
    make: () => (args, m) => ({ node: m.node('fract', {}, { input: arg('p'), scale: num(args, 'n') }), out: 'output' }),
  },
  {
    kind: 'tile', idiom: 'tile', what: 'tiled space', node: 'Grid UV', exact: true,
    holes: { p: ['vec2'], n: ['float'] }, ret: ['vec2'],
    make: () => (args, m) => ({ node: m.node('gridUV', { stagger: 0 }, { uv: arg('p'), scale: num(args, 'n') }), out: 'cellUV' }),
  },
  {
    kind: 'cellId', idiom: 'cell-id', patterns: [0], what: 'the cell id', node: 'Tile (Cell ID)', exact: true,
    holes: { p: ['vec2'], n: ['float'] }, ret: ['vec2'],
    make: () => (args, m) => ({ node: m.node('fract', {}, { input: arg('p'), scale: num(args, 'n') }), out: 'cellID' }),
  },
  // Colour.
  {
    kind: 'palette', idiom: 'iq-palette', what: 'a cosine palette', node: 'Palette', exact: false,
    holes: { a: ['vec3', 'float'], b: ['vec3', 'float'], c: ['vec3', 'float'], d: ['vec3', 'float'], t: ['float'] }, ret: ['vec3'],
    make: () => palette(true),
  },
  {
    kind: 'palette1', idiom: 'cos-palette-1', patterns: [0], what: 'a cosine palette', node: 'Palette', exact: false,
    holes: { a: ['vec3', 'float'], b: ['vec3', 'float'], d: ['vec3', 'float'], t: ['float'] }, ret: ['vec3'],
    make: () => palette(false),
  },
  // Blends.
  {
    kind: 'saturateRemap', idiom: 'saturate', patterns: [0], what: 'a clamped remap', node: 'Remap', exact: false,
    // clamp((x - a) / (b - a), 0, 1): recognise.ts checks the inside is an inverse mix, and binds x, a, b.
    holes: { x: ['float'], a: ['float'], b: ['float'] }, ret: ['float'],
    make: () => (args, m) => ({ node: m.node('remap', { outMin: 0, outMax: 1, clamp: true, smooth: 'linear' }, { value: arg('x'), inMin: num(args, 'a') ?? arg('a'), inMax: num(args, 'b') ?? arg('b') }), out: 'result' }),
  },
  {
    kind: 'remap', idiom: 'inverse-lerp', what: 'where a value sits between two', node: 'Remap', exact: false,
    holes: { x: ['float'], a: ['float'], b: ['float'] }, ret: ['float'],
    make: () => (args, m) => ({ node: m.node('remap', { outMin: 0, outMax: 1, clamp: false, smooth: 'linear' }, { value: arg('x'), inMin: num(args, 'a') ?? arg('a'), inMax: num(args, 'b') ?? arg('b') }), out: 'result' }),
  },
  {
    kind: 'smoothCurve', idiom: 'smoothstep-hand', what: 'a smoothstep written out', node: 'Smoothstep', exact: false,
    holes: { x: ['float'] }, ret: ['float'],
    make: () => (_args, m) => ({ node: m.node('smoothstep', { outputType: 'float', edge0: 0, edge1: 1 }, { value: arg('x') }), out: 'result' }),
  },
  {
    kind: 'lerp', idiom: 'mix', patterns: [1, 2], what: 'a mix written out', node: 'Mix', exact: false,
    holes: { a: ['float', 'vec2', 'vec3', 'vec4'], b: ['float', 'vec2', 'vec3', 'vec4'], t: ['float'] }, ret: ['float', 'vec2', 'vec3', 'vec4'],
    make: () => (args, m) => {
      if (args.a.type !== args.b.type) return null;
      return { node: m.node('mix', { outputType: args.a.type, ...(args.t.lit !== undefined ? { t: args.t.lit } : {}) }, { a: arg('a'), b: arg('b'), ...(args.t.lit === undefined ? { t: arg('t') } : {}) }), out: 'result' };
    },
  },
  {
    kind: 'clamp01', idiom: 'saturate', patterns: [1, 2], what: 'a clamp written as min and max', node: 'Clamp', exact: true,
    holes: { x: ['float', 'vec2', 'vec3', 'vec4'] }, ret: ['float', 'vec2', 'vec3', 'vec4'],
    make: () => (args, m) => ({ node: m.node('clamp', { outputType: args.x.type, lo: 0, hi: 1 }, { input: arg('x') }), out: 'result' }),
  },
];

/**
 * Helper functions recognised whole (their body is one of the idioms above, or a known recipe of
 * their own): a call to one becomes the node. `fbm()` is the common one; its noise is the shader's
 * own, so the FBM node's rarely matches, and the pixel check decides.
 */
export interface FnRecipe { kind: string; what: string; node: string; make: (shape: FbmShape) => NodeCall }
export interface FbmShape { octaves: number; gain: number; lacunarity: number }
export const FBM_RECIPE: FnRecipe = {
  kind: 'fbm', what: 'fractal noise (fbm)', node: 'Fractal Noise (FBM)',
  make: shape => (_args, m) => ({ node: m.node('fbm', { octaves: shape.octaves, gain: shape.gain, lacunarity: shape.lacunarity, scale: 1, time_scale: 0 }, { uv: arg('p') }), out: 'value' }),
};

export const recipeByKind = (kind: string): Recipe | undefined => RECIPES.find(r => r.kind === kind);
