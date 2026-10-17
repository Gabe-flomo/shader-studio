/**
 * colourGradient.ts — a colour setting that is a gradient instead of one colour (docs/gradients.md).
 *
 * A colour param (`vec3color`) whose ParamDef lists `gradient` drivers can switch between
 * Solid (its own [r, g, b], unchanged) and Gradient: 2–8 colour stops (place + colour), a blend
 * (Smooth / Linear / Constant) and an "along": what picks the place on the gradient at each pixel
 * (Height, Distance from centre, Normal, Depth, UV X…). The node's context supplies the GLSL for the
 * drivers it can (a march loop has the hit point and normal; a fill has the pixel and its SDF).
 *
 * Saved as flat params beside the colour, so a stop edit is a uniform write and never recompiles:
 *
 *   `${key}__grad`         { on, along, interp, n }  structure; changing it recompiles
 *   `${key}__gc0…7`        each stop's colour, a vec3 uniform
 *   `${key}__gp0…7`        each stop's place 0–1, a float uniform
 *   `${key}__gfrom / __gto`  the driver's range mapped onto 0–1, float uniforms
 *
 * The colour param itself is untouched, so switching back to Solid gives the old colour, and a
 * graph that never used a gradient compiles to exactly the shader it always did.
 *
 * The blend is the Stops Palette's (nodes/definitions/color.ts): Smooth eases with f·f·(3 − 2f),
 * Linear mixes straight, Constant is its Bands (each colour held to the next stop).
 */
import type { GradientStop, RGB } from '../components/ui/gradientStops';
import { p, pv3 } from '../nodes/definitions/helpers';

export type GradientInterp = 'smooth' | 'linear' | 'constant';
export type GradientDriver =
  // 3D: a surface point (and its normal, the camera)
  | 'height' | 'centre' | 'axisX' | 'axisZ' | 'normal' | 'depth' | 'noise'
  // A distance the node already has: to a surface (a glow), into a shape (a fill), a field's value
  | 'surface' | 'inside' | 'field'
  // 2D: the pixel
  | 'uvX' | 'uvY' | 'radial' | 'angle';

export interface ColourGradient {
  along: GradientDriver;
  interp: GradientInterp;
  /** Sorted by place, 2–8 of them. */
  stops: GradientStop[];
  /** The driver's value that sits at place 0 … and at place 1. */
  from: number;
  to: number;
}

export const GRADIENT_MAX_STOPS = 8;
export const GRADIENT_MIN_STOPS = 2;

/** What a context can hand the drivers, as GLSL expressions. */
export interface GradientContext {
  /** A 3D point on the surface (world space). */
  pos?: string;
  /** Its unit normal. */
  normal?: string;
  /** The camera's position. */
  eye?: string;
  /** The node's own float (a distance or a field's value), for surface / inside / field. */
  value?: string;
  /** The pixel's place (defaults to g_uv). */
  uv?: string;
}

interface DriverInfo {
  label: string;
  hint: string;
  /** Default range: the driver's value at place 0 and at place 1. */
  range: [number, number];
  glsl: (c: GradientContext) => string | null;
}

const uvOf = (c: GradientContext) => c.uv ?? 'g_uv';

export const GRADIENT_DRIVERS: Record<GradientDriver, DriverInfo> = {
  height: { label: 'Height', hint: 'World Y: bottom to top.', range: [-1, 1], glsl: c => (c.pos ? `(${c.pos}).y` : null) },
  centre: { label: 'Distance from centre', hint: 'How far the point is from the scene\'s centre (0, 0, 0).', range: [0, 1.5], glsl: c => (c.pos ? `length(${c.pos})` : null) },
  axisX: { label: 'Along X', hint: 'World X: left to right.', range: [-1, 1], glsl: c => (c.pos ? `(${c.pos}).x` : null) },
  axisZ: { label: 'Along Z', hint: 'World Z: back to front.', range: [-1, 1], glsl: c => (c.pos ? `(${c.pos}).z` : null) },
  normal: { label: 'Normal (up → down)', hint: 'Which way the surface faces: the first stop on up-facing surfaces, the last on down-facing ones.', range: [1, -1], glsl: c => (c.normal ? `(${c.normal}).y` : null) },
  depth: { label: 'Depth', hint: 'Distance from the camera: near to far.', range: [2, 8], glsl: c => (c.pos && c.eye ? `length((${c.pos}) - (${c.eye}))` : null) },
  noise: { label: 'Noise', hint: 'A soft 3D noise over the surface: blotches of the stops.', range: [0, 1], glsl: c => (c.pos ? `pfGradNoise((${c.pos}) * 2.0)` : null) },
  surface: { label: 'Distance to surface', hint: 'How far from the shape: the first stop at its edge, the last where the glow fades.', range: [0, 0.3], glsl: c => (c.value ? `(${c.value})` : null) },
  inside: { label: 'Edge → inside', hint: 'How deep inside the shape: the first stop at its edge, the last towards its middle.', range: [0, 0.3], glsl: c => (c.value ? `(-(${c.value}))` : null) },
  field: { label: 'Field brightness', hint: 'The Field\'s own value: the first stop where it is 0, the last where it is 1.', range: [0, 1], glsl: c => (c.value ? `(${c.value})` : null) },
  uvX: { label: 'UV X', hint: 'Across the picture: left to right.', range: [-1, 1], glsl: c => `(${uvOf(c)}).x` },
  uvY: { label: 'UV Y', hint: 'Up the picture: bottom to top.', range: [-1, 1], glsl: c => `(${uvOf(c)}).y` },
  radial: { label: 'Radial', hint: 'Distance from the middle of the picture.', range: [0, 1], glsl: c => `length(${uvOf(c)})` },
  angle: { label: 'Angle', hint: 'Round the middle of the picture, one full turn.', range: [0, 1], glsl: c => `(atan((${uvOf(c)}).y, (${uvOf(c)}).x) / 6.28318 + 0.5)` },
};

/** Driver lists for the usual contexts (a ParamDef's `gradient`). */
export const DRIVERS_3D_SURFACE: readonly GradientDriver[] = ['height', 'centre', 'axisX', 'axisZ', 'normal', 'depth', 'noise'];
/** A Color node with a Point (and Normal) wired in: no camera, so no Depth. */
export const DRIVERS_3D_POINT: readonly GradientDriver[] = ['height', 'centre', 'axisX', 'axisZ', 'normal', 'noise'];
export const DRIVERS_2D: readonly GradientDriver[] = ['uvX', 'uvY', 'radial', 'angle'];

export const INTERP_OPTIONS: ReadonlyArray<{ value: GradientInterp; label: string }> = [
  { value: 'smooth', label: 'Smooth' }, { value: 'linear', label: 'Linear' }, { value: 'constant', label: 'Constant' },
];

// ── Params ────────────────────────────────────────────────────────────────────

export const gradKey = (key: string) => `${key}__grad`;
export const stopColourKey = (key: string, i: number) => `${key}__gc${i}`;
export const stopPosKey = (key: string, i: number) => `${key}__gp${i}`;
export const fromKey = (key: string) => `${key}__gfrom`;
export const toKey = (key: string) => `${key}__gto`;

interface GradHeader { on: boolean; along: GradientDriver; interp: GradientInterp; n: number }

const isRgb = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number');
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

function headerOf(params: Record<string, unknown>, key: string): GradHeader | null {
  const h = params[gradKey(key)] as Partial<GradHeader> | undefined;
  if (!h || typeof h !== 'object') return null;
  const along = (typeof h.along === 'string' && h.along in GRADIENT_DRIVERS ? h.along : 'height') as GradientDriver;
  const interp: GradientInterp = h.interp === 'linear' || h.interp === 'constant' ? h.interp : 'smooth';
  const n = Math.max(GRADIENT_MIN_STOPS, Math.min(GRADIENT_MAX_STOPS, Math.round(Number(h.n) || 2)));
  return { on: h.on === true, along, interp, n };
}

/** Is this colour setting a gradient right now? */
export function gradientOn(params: Record<string, unknown>, key: string): boolean {
  return headerOf(params, key)?.on === true;
}

/** The gradient a colour setting holds (on or off), or null when it never had one. Values only (not uniform names). */
export function readGradient(params: Record<string, unknown>, key: string): ColourGradient | null {
  const h = headerOf(params, key);
  if (!h) return null;
  const stops: GradientStop[] = [];
  for (let i = 0; i < h.n; i++) {
    const c = params[stopColourKey(key, i)];
    const pos = params[stopPosKey(key, i)];
    stops.push({ pos: typeof pos === 'number' ? clamp01(pos) : h.n > 1 ? i / (h.n - 1) : 0, color: isRgb(c) ? [c[0], c[1], c[2]] : [0.5, 0.5, 0.5] });
  }
  const r = GRADIENT_DRIVERS[h.along].range;
  const from = params[fromKey(key)], to = params[toKey(key)];
  return { along: h.along, interp: h.interp, stops, from: typeof from === 'number' ? from : r[0], to: typeof to === 'number' ? to : r[1] };
}

/** Stops sorted by place, clamped to 2–8 (extra ones dropped; a lone stop doubled). */
export function normaliseStops(stops: readonly GradientStop[]): GradientStop[] {
  const s = [...stops].map(x => ({ pos: clamp01(x.pos), color: [x.color[0], x.color[1], x.color[2]] as RGB })).sort((a, b) => a.pos - b.pos).slice(0, GRADIENT_MAX_STOPS);
  if (s.length === 0) return [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }];
  if (s.length === 1) return [{ pos: 0, color: s[0].color }, { pos: 1, color: [...s[0].color] as RGB }];
  return s;
}

/** The params for a colour setting holding `g` (`on`: shown as a gradient, else kept for later behind Solid). */
export function gradientParams(key: string, g: ColourGradient, on = true): Record<string, unknown> {
  const stops = normaliseStops(g.stops);
  const out: Record<string, unknown> = { [gradKey(key)]: { on, along: g.along, interp: g.interp, n: stops.length } };
  stops.forEach((s, i) => { out[stopColourKey(key, i)] = [...s.color]; out[stopPosKey(key, i)] = s.pos; });
  out[fromKey(key)] = g.from;
  out[toKey(key)] = g.to;
  return out;
}

/** Just the live values (stop colours and places, the range): a uniform-only edit when the stop count is unchanged. */
export function gradientValueParams(key: string, g: ColourGradient): Record<string, unknown> {
  const all = gradientParams(key, g);
  delete all[gradKey(key)];
  return all;
}

/** A first gradient for a colour: from a darker shade of it to a lighter one, along `along`. */
export function starterGradient(colour: readonly number[], along: GradientDriver): ColourGradient {
  const c = isRgb(colour) ? colour : [0.8, 0.8, 0.8];
  const dark: RGB = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35];
  const light: RGB = [c[0] + (1 - c[0]) * 0.6, c[1] + (1 - c[1]) * 0.6, c[2] + (1 - c[2]) * 0.6];
  const r = GRADIENT_DRIVERS[along].range;
  return { along, interp: 'smooth', stops: [{ pos: 0, color: dark }, { pos: 0.5, color: [c[0], c[1], c[2]] }, { pos: 1, color: light }], from: r[0], to: r[1] };
}

/** The live params a gradient puts in a shader (stop colours, places, range), for the uniform patcher. */
export function gradientLiveKeys(params: Record<string, unknown>, key: string): Array<{ key: string; kind: 'vec3' | 'float' }> {
  const h = headerOf(params, key);
  if (!h?.on) return [];
  const out: Array<{ key: string; kind: 'vec3' | 'float' }> = [];
  for (let i = 0; i < h.n; i++) out.push({ key: stopColourKey(key, i), kind: 'vec3' }, { key: stopPosKey(key, i), kind: 'float' });
  out.push({ key: fromKey(key), kind: 'float' }, { key: toKey(key), kind: 'float' });
  return out;
}

// ── Evaluating (the shader's maths, in JS, for swatches and tests) ────────────

/** Place on the gradient for a driver value: (v − from) / (to − from), clamped to 0–1. */
export function gradientT(v: number, from: number, to: number): number {
  const span = Math.abs(to - from) < 1e-5 ? (to >= from ? 1e-5 : -1e-5) : to - from;
  return clamp01((v - from) / span);
}

/** The colour at place `t` (0–1), exactly as pfGradient computes it. */
export function evalGradient(stops: readonly GradientStop[], t: number, interp: GradientInterp = 'smooth'): RGB {
  const s = normaliseStops(stops);
  const x = clamp01(t);
  if (x <= s[0].pos) return [...s[0].color] as RGB;
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i].pos) {
      const a = s[i - 1], b = s[i];
      const f = clamp01((x - a.pos) / Math.max(b.pos - a.pos, 1e-5));
      const w = interp === 'constant' ? (x >= b.pos ? 1 : 0) : interp === 'linear' ? f : f * f * (3 - 2 * f);
      return [a.color[0] + (b.color[0] - a.color[0]) * w, a.color[1] + (b.color[1] - a.color[1]) * w, a.color[2] + (b.color[2] - a.color[2]) * w];
    }
  }
  return [...s[s.length - 1].color] as RGB;
}

/** A CSS linear-gradient of a gradient, for its bar and preset swatches. */
export function gradientCssOf(g: Pick<ColourGradient, 'stops' | 'interp'>, angle = 90): string {
  const s = normaliseStops(g.stops);
  const css = (c: readonly number[]) => `rgb(${c.map(v => Math.round(clamp01(v) * 255)).join(' ')})`;
  if (g.interp === 'constant') {
    const parts = s.map((st, i) => `${css(st.color)} ${(st.pos * 100).toFixed(1)}% ${((s[i + 1]?.pos ?? 1) * 100).toFixed(1)}%`);
    return `linear-gradient(${angle}deg, ${css(s[0].color)} 0% ${(s[0].pos * 100).toFixed(1)}%, ${parts.join(', ')})`;
  }
  return `linear-gradient(${angle}deg, ${s.map(st => `${css(st.color)} ${(st.pos * 100).toFixed(1)}%`).join(', ')})`;
}

// ── GLSL ──────────────────────────────────────────────────────────────────────

/**
 * The gradient's shader functions (one copy per shader). pfGradient takes eight stops; only the
 * first n are read (the stops are sorted, so the last segment the place has passed wins). Blend:
 * 0 smooth, 1 linear, 2 constant (each stop's colour held from its place to the next).
 */
export const PF_GRADIENT_GLSL = `
float pfGradT(float v, float from, float to) {
    float span = to - from;
    if (abs(span) < 1e-5) span = span < 0.0 ? -1e-5 : 1e-5;
    return clamp((v - from) / span, 0.0, 1.0);
}
float pfGradHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pfGradNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(pfGradHash(i), pfGradHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(pfGradHash(i + vec3(0.0, 1.0, 0.0)), pfGradHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(pfGradHash(i + vec3(0.0, 0.0, 1.0)), pfGradHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(pfGradHash(i + vec3(0.0, 1.0, 1.0)), pfGradHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float pfGradW(float t, float a, float b, int interp) {
    float f = clamp((t - a) / max(b - a, 1e-5), 0.0, 1.0);
    return interp == 2 ? step(b, t) : interp == 1 ? f : f * f * (3.0 - 2.0 * f);
}
vec3 pfGradient(float t, int n, int interp, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5, vec3 c6, vec3 c7,
                float p0, float p1, float p2, float p3, float p4, float p5, float p6, float p7) {
    t = clamp(t, 0.0, 1.0);
    vec3 col = c0;
    if (n > 1 && t > p0) col = mix(c0, c1, pfGradW(t, p0, p1, interp));
    if (n > 2 && t > p1) col = mix(c1, c2, pfGradW(t, p1, p2, interp));
    if (n > 3 && t > p2) col = mix(c2, c3, pfGradW(t, p2, p3, interp));
    if (n > 4 && t > p3) col = mix(c3, c4, pfGradW(t, p3, p4, interp));
    if (n > 5 && t > p4) col = mix(c4, c5, pfGradW(t, p4, p5, interp));
    if (n > 6 && t > p5) col = mix(c5, c6, pfGradW(t, p5, p6, interp));
    if (n > 7 && t > p6) col = mix(c6, c7, pfGradW(t, p6, p7, interp));
    return col;
}`;

/**
 * The GLSL for a colour setting: the gradient call when it is on and its driver works here, else
 * null (the caller keeps its solid colour). Stop colours, places and the range come from the params,
 * which in uniform mode the compiler has swapped for uniform names (p / pv3 pass those through).
 */
export function gradientColourGlsl(params: Record<string, unknown>, key: string, ctx: GradientContext, allowed?: readonly string[]): string | null {
  const h = headerOf(params, key);
  if (!h?.on) return null;
  if (allowed && !allowed.includes(h.along)) return null;
  const drive = GRADIENT_DRIVERS[h.along].glsl(ctx);
  if (!drive) return null;
  const r = GRADIENT_DRIVERS[h.along].range;
  const cs: string[] = [], ps: string[] = [];
  for (let i = 0; i < GRADIENT_MAX_STOPS; i++) {
    const j = Math.min(i, h.n - 1);
    cs.push(pv3(params[stopColourKey(key, j)], [0.5, 0.5, 0.5]));
    ps.push(i < h.n ? p(params[stopPosKey(key, j)], h.n > 1 ? j / (h.n - 1) : 0) : '2.0');
  }
  const t = `pfGradT(${drive}, ${p(params[fromKey(key)], r[0])}, ${p(params[toKey(key)], r[1])})`;
  const mode = h.interp === 'constant' ? 2 : h.interp === 'linear' ? 1 : 0;
  return `pfGradient(${t}, ${h.n}, ${mode}, ${cs.join(', ')}, ${ps.join(', ')})`;
}

/** Does any of these colour settings of a node hold an active gradient (so its shader needs PF_GRADIENT_GLSL)? */
export function anyGradientOn(params: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some(k => gradientOn(params, k));
}
