/**
 * pathMods.ts — the Grid builder's Math paths and path modifiers (docs/grid-builder.md "Math
 * paths", "Path modifiers"). Pure: no store, no React.
 *
 * Math path: a point (x, y) for each moment of the cycle, t = 0 … 1, in pad units (the XY reach
 * stretches it into cells, the Angle turns it). Two kinds:
 *   - Formula: x = …, y = … typed in the 2D Scene Builder's space-block language (x, y, t, PI, TAU,
 *     the path's own sliders; whole numbers as floats; errors in plain words as you type). The y
 *     line runs after the x line, so it can read x.
 *   - Curve: Curve Trace's curves (Lissajous, rotary loops, counter-rotating stars, harmonograph
 *     spirals), built by the same `curvePoint`, its numbers as sliders.
 *
 * Path modifiers: a small stack applied to any path but Travel and Hop, in order. Ease and Repeat
 * change the progress along the path (before it is read); the rest change the offset (cells):
 * Wave along (a sine along the path's normal), Noise (a smooth looping wobble), Scale, Rotate (and
 * spin), Mirror, Twist (the radius swells with progress, and the path can turn as it goes). Each
 * has a mute (a live number: nothing rebuilds).
 *
 * Every number here is live: it rides in the shape's motion array (glsl.ts), a slider on the
 * built Shape node. The neighbour search bounds the modified path from those numbers, live: a
 * reach R (cells, Euclidean, round the home) and a rate V (cells per cycle; 1e9 when it can jump).
 */
import type { GraphNode } from '../types/nodeGraph';
import { checkBlock, blockGlslLines, type BlockParam, type SpaceBlock } from '../sceneBuilder2d/blocks';
import { compileExpr, type EvalEnv } from '../lib/glslPatterns';
/** The names a formula knows besides t and its sliders (as the 2D builder's blocks). */
const CONSTANTS: Record<string, number> = { PI: Math.PI, TAU: Math.PI * 2 };
import { curvePoint } from '../nodes/definitions/curveTrace';
import type { Vec2 } from './spec';

// ── Math paths ────────────────────────────────────────────────────────────────

export const CURVE_WAVES = ['sine', 'triangle', 'square', 'saw'] as const;
export type CurveWave = typeof CURVE_WAVES[number];
export const CURVE_MODES = ['lateral', 'rotary', 'counter'] as const;
export type CurveMode = typeof CURVE_MODES[number];
export const CURVE_MODE_LABELS: Record<CurveMode, string> = { lateral: 'Lateral (Lissajous)', rotary: 'Rotary: loops', counter: 'Rotary: stars, flowers' };

export interface CurveSpec {
  mode: CurveMode;
  waveX: CurveWave;
  waveY: CurveWave;
  freqX: number; freqY: number;
  phaseX: number; phaseY: number;
  ampX: number; ampY: number;
  damping: number;
  turns: number;
}

export interface MathPath {
  kind: 'formula' | 'curve';
  /** Formula: x = … and y = … (t: 0 … 1 round the cycle). */
  x: string;
  y: string;
  /** Formula: its own sliders, by name. */
  params: BlockParam[];
  curve: CurveSpec;
}

const CURVE_BASE: CurveSpec = { mode: 'lateral', waveX: 'sine', waveY: 'sine', freqX: 1, freqY: 1, phaseX: Math.PI / 2, phaseY: 0, ampX: 1, ampY: 1, damping: 0, turns: 1 };

/** Ready-made curves (Curve Trace's library), as a starting point: all of their numbers stay sliders. */
export const CURVE_PRESETS: Array<{ key: string; label: string; curve: CurveSpec }> = [
  { key: 'circle', label: 'Circle', curve: { ...CURVE_BASE } },
  { key: 'lissajous', label: 'Lissajous 3 : 2', curve: { ...CURVE_BASE, freqX: 3, freqY: 2, phaseX: Math.PI / 2 } },
  { key: 'eight', label: 'Figure eight 1 : 2', curve: { ...CURVE_BASE, freqX: 1, freqY: 2, phaseX: 0 } },
  { key: 'pretzel', label: 'Pretzel 5 : 4', curve: { ...CURVE_BASE, freqX: 5, freqY: 4, phaseX: Math.PI / 2 } },
  { key: 'loops', label: 'Loops (rotary 1 : 5)', curve: { ...CURVE_BASE, mode: 'rotary', freqX: 1, freqY: 5, phaseX: 0, ampX: 0.7, ampY: 0.3 } },
  { key: 'star', label: 'Star (counter 2 : 3)', curve: { ...CURVE_BASE, mode: 'counter', freqX: 2, freqY: 3, phaseX: 0, ampX: 0.6, ampY: 0.4 } },
  { key: 'flower', label: 'Flower (counter 1 : 6)', curve: { ...CURVE_BASE, mode: 'counter', freqX: 1, freqY: 6, phaseX: 0, ampX: 0.7, ampY: 0.3 } },
  { key: 'harmonograph', label: 'Harmonograph spiral', curve: { ...CURVE_BASE, freqX: 2, freqY: 3, phaseX: Math.PI / 2, damping: 0.12, turns: 3 } },
];

/** Ready-made formulas, as a starting point. */
export const FORMULA_PRESETS: Array<{ key: string; label: string; x: string; y: string; params: BlockParam[] }> = [
  { key: 'circle', label: 'Circle', x: 'cos(TAU * t)', y: 'sin(TAU * t)', params: [] },
  { key: 'heart', label: 'Heart', x: '0.06 * pow(sin(TAU * t), 3) * 16', y: '0.06 * (13 * cos(TAU * t) - 5 * cos(2 * TAU * t) - 2 * cos(3 * TAU * t) - cos(4 * TAU * t))', params: [] },
  { key: 'rose', label: 'Rose (k petals)', x: 'cos(k * TAU * t) * cos(TAU * t)', y: 'cos(k * TAU * t) * sin(TAU * t)', params: [{ name: 'k', value: 3, min: 1, max: 9 }] },
  { key: 'squircle', label: 'Squircle', x: 'sign(cos(TAU * t)) * pow(abs(cos(TAU * t)), e)', y: 'sign(sin(TAU * t)) * pow(abs(sin(TAU * t)), e)', params: [{ name: 'e', value: 0.4, min: 0.1, max: 2 }] },
  { key: 'wobble', label: 'Wobbly circle', x: '(1 + w * sin(n * TAU * t)) * cos(TAU * t)', y: '(1 + w * sin(n * TAU * t)) * sin(TAU * t)', params: [{ name: 'w', value: 0.2, min: 0, max: 0.6 }, { name: 'n', value: 5, min: 1, max: 12 }] },
];

export const defaultMath = (): MathPath => ({ kind: 'curve', x: 'cos(TAU * t)', y: 'sin(TAU * t)', params: [], curve: { ...CURVE_PRESETS[1].curve } });

/** The formula as a space block (x line, then y): the 2D builder's checker reads it. */
export const formulaBlock = (m: Pick<MathPath, 'x' | 'y' | 'params'>): SpaceBlock => ({
  name: 'path', times: 1, params: m.params,
  lines: [{ target: 'uv.x', op: '=', rhs: m.x }, { target: 'uv.y', op: '=', rhs: m.y }],
});

/** The formula's problems in plain words (empty: it checks). An empty line counts as 0. */
export function formulaProblems(m: Pick<MathPath, 'x' | 'y' | 'params'>): string[] {
  const chk = checkBlock(formulaBlock(m));
  return [...chk.errors, ...chk.lines.flatMap((l, i) => (l.ok ? [] : [`${i ? 'y' : 'x'}: ${l.error}`]))];
}

const fnCache = new WeakMap<MathPath, (u: number) => Vec2>();
const CIRCLE = (u: number): Vec2 => [Math.cos(u * Math.PI * 2), Math.sin(u * Math.PI * 2)];

/** The math path's point at progress u (0 … 1), pad units, at the spec's values (cached per path). */
export function mathPoint(m: MathPath, u: number): Vec2 {
  let f = fnCache.get(m);
  if (!f) { f = m.kind === 'curve' ? curveFn(m.curve) : formulaFn(m); fnCache.set(m, f); }
  return f(u);
}

function formulaFn(m: MathPath): (u: number) => Vec2 {
  const chk = checkBlock(formulaBlock(m));
  if (!chk.ok) return CIRCLE;
  const fx = chk.lines[0].empty ? null : compileExpr(chk.lines[0].expr!);
  const fy = chk.lines[1].empty ? null : compileExpr(chk.lines[1].expr!);
  const base: EvalEnv = { ...CONSTANTS, ...Object.fromEntries(m.params.map(p => [p.name, p.value])) };
  const one = (v: unknown) => (Array.isArray(v) ? v[0] as number : v as number);
  return u => {
    try {
      const x = fx ? one(fx({ ...base, t: u, uv: [0, 0] })) : 0;
      const y = fy ? one(fy({ ...base, t: u, uv: [x, 0] })) : 0;
      return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
    } catch { return [0, 0]; }
  };
}

const wave = (w: CurveWave, a: number) => {
  switch (w) {
    case 'triangle': return 0.63662 * Math.asin(Math.sin(a));
    case 'square': return Math.sign(Math.sin(a));
    case 'saw': { const v = a / 6.28318 + 0.5; return 2 * (v - Math.floor(v)) - 1; }
    default: return Math.sin(a);
  }
};

/** Curve Trace's point (curveTrace.ts curvePoint) on the CPU. */
function curveFn(c: CurveSpec): (u: number) => Vec2 {
  return u => {
    const t = u * c.turns * Math.PI * 2;
    const damp = Math.exp(-c.damping * t);
    if (c.mode === 'lateral') return [c.ampX * damp * wave(c.waveX, c.freqX * t + c.phaseX), c.ampY * damp * wave(c.waveY, c.freqY * t + c.phaseY)];
    const s = c.mode === 'counter' ? -1 : 1;
    return [
      damp * (c.ampX * Math.cos(c.freqX * t + c.phaseX) + c.ampY * Math.cos(c.freqY * t + c.phaseY)),
      damp * (c.ampX * Math.sin(c.freqX * t + c.phaseX) + s * c.ampY * Math.sin(c.freqY * t + c.phaseY)),
    ];
  };
}

/** The curve's numbers as sliders, in their order in the motion array. */
const CURVE_KEYS = ['freqX', 'freqY', 'phaseX', 'phaseY', 'ampX', 'ampY', 'damping', 'turns'] as const;
const CURVE_RANGE: Record<typeof CURVE_KEYS[number], [number, number]> = {
  freqX: [0, 12], freqY: [0, 12], phaseX: [-6.2832, 6.2832], phaseY: [-6.2832, 6.2832], ampX: [0, 1.5], ampY: [0, 1.5], damping: [0, 1], turns: [0.1, 8],
};

// ── Modifiers ─────────────────────────────────────────────────────────────────

export const MOD_KINDS = ['wave', 'noise', 'scale', 'rotate', 'mirror', 'twist', 'repeat', 'ease'] as const;
export type ModKind = typeof MOD_KINDS[number];
export interface ModParamDef { key: string; label: string; min: number; max: number; def: number; hint: string; integer?: boolean }
export const MOD_DEFS: Record<ModKind, { label: string; blurb: string; params: ModParamDef[] }> = {
  wave: { label: 'Wave along', blurb: 'A sine wobble across the path (along its normal).', params: [
    { key: 'amp', label: 'Amount', min: 0, max: 1, def: 0.15, hint: 'How far it wobbles to each side, in cells.' },
    { key: 'freq', label: 'Waves', min: 0, max: 16, def: 4, hint: 'Wobbles a cycle: whole numbers loop seamlessly.' },
    { key: 'speed', label: 'Speed', min: -4, max: 4, def: 0, hint: 'How fast the wobble runs along the path, cycles a second.' },
  ] },
  noise: { label: 'Noise', blurb: 'A smooth random wobble that loops with the path.', params: [
    { key: 'amp', label: 'Amount', min: 0, max: 1, def: 0.15, hint: 'How far it strays, in cells.' },
    { key: 'freq', label: 'Bumps', min: 1, max: 16, def: 5, integer: true, hint: 'Bumps a cycle (whole: it loops seamlessly).' },
    { key: 'speed', label: 'Drift', min: -2, max: 2, def: 0.2, hint: 'How fast the bumps drift along the path, cycles a second.' },
    { key: 'seed', label: 'Seed', min: 0, max: 99, def: 1, integer: true, hint: 'Another random pattern.' },
  ] },
  scale: { label: 'Scale', blurb: 'Stretches the path across (X) and up (Y).', params: [
    { key: 'sx', label: 'X', min: -3, max: 3, def: 1, hint: 'Across; negative flips it.' },
    { key: 'sy', label: 'Y', min: -3, max: 3, def: 1, hint: 'Up; negative flips it.' },
  ] },
  rotate: { label: 'Rotate', blurb: 'Turns the path, and spins it.', params: [
    { key: 'angle', label: 'Angle', min: -180, max: 180, def: 30, hint: 'Degrees.' },
    { key: 'spin', label: 'Spin', min: -360, max: 360, def: 0, hint: 'Degrees a second.' },
  ] },
  mirror: { label: 'Mirror', blurb: 'Flips the path across (X), up (Y), or both.', params: [
    { key: 'axis', label: 'Axis', min: 0, max: 2, def: 0, integer: true, hint: '0 flips across (left ↔ right), 1 up and down, 2 both.' },
  ] },
  twist: { label: 'Twist', blurb: 'The radius swells and shrinks with progress, and the path can turn as it goes.', params: [
    { key: 'amount', label: 'Swell', min: -1, max: 1, def: 0.3, hint: 'How much the radius changes.' },
    { key: 'waves', label: 'Waves', min: 0, max: 8, def: 1, hint: 'Swells a cycle (whole: seamless).' },
    { key: 'turns', label: 'Turns', min: -4, max: 4, def: 0, hint: 'Turns the path makes as it goes round a cycle (whole: seamless).' },
  ] },
  repeat: { label: 'Repeat', blurb: 'Goes round the path this many times a cycle.', params: [
    { key: 'times', label: 'Times', min: 1, max: 8, def: 2, hint: 'Loops a cycle (whole: seamless).' },
  ] },
  ease: { label: 'Ease', blurb: 'Slow at the start and end of each lap, fast in the middle.', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, def: 1, hint: '0: an even speed.' },
  ] },
};
export const isPhaseMod = (k: ModKind) => k === 'repeat' || k === 'ease';

export interface PathMod {
  id: string;
  kind: ModKind;
  /** Its numbers, in MOD_DEFS order. */
  v: number[];
  muted?: boolean;
}
export const MAX_MODS = 6;

export function newMod(kind: ModKind, taken: readonly PathMod[]): PathMod {
  let n = 1;
  while (taken.some(m => m.id === `m${n}`)) n++;
  return { id: `m${n}`, kind, v: MOD_DEFS[kind].params.map(p => p.def) };
}
const modVal = (m: PathMod, i: number) => (typeof m.v[i] === 'number' && Number.isFinite(m.v[i]) ? m.v[i] : MOD_DEFS[m.kind].params[i].def);

// ── The live numbers (the Shape node's sliders, the motion array's tail) ──────

export interface LiveParam { name: string; value: number; min: number; max: number; hidden?: boolean; label: string }

/** The path's own source: a formula's sliders, or a curve's numbers. */
function sourceParams(m: MathPath): LiveParam[] {
  if (m.kind === 'formula') return m.params.map(p => ({ name: `f_${p.name}`, value: p.value, min: p.min, max: p.max, label: p.name }));
  return CURVE_KEYS.map(k => ({ name: `curve${k[0].toUpperCase()}${k.slice(1)}`, value: m.curve[k], min: CURVE_RANGE[k][0], max: CURVE_RANGE[k][1], label: k }));
}

/** The modifiers' numbers: per modifier its on (hidden: the mute) then its sliders. */
function modParams(mods: readonly PathMod[]): LiveParam[] {
  return mods.flatMap(m => [
    { name: `${m.id}on`, value: m.muted ? 0 : 1, min: 0, max: 1, hidden: true, label: 'on' },
    ...MOD_DEFS[m.kind].params.map((p, i) => ({ name: `${m.id}${p.key}`, value: modVal(m, i), min: p.min, max: p.max, label: `${MOD_DEFS[m.kind].label} ${p.label}` })),
  ]);
}

export interface PathExtras { path: string; math?: MathPath; mods?: PathMod[] }
/** Modifiers apply to every path but Travel and Hop (those wrap round the grid). */
export const modsOf = (m: PathExtras): PathMod[] => (m.path === 'travel' || m.path === 'hop' || m.path === 'still' ? [] : m.mods ?? []);
const DEFAULT_MATH = defaultMath();
export const mathOf = (m: PathExtras): MathPath => m.math ?? DEFAULT_MATH;

/** Every live number of a shape's path beyond its Angle and drawn path, in their order. */
export function pathLiveParams(m: PathExtras): LiveParam[] {
  return [...(m.path === 'math' ? sourceParams(mathOf(m)) : []), ...modParams(modsOf(m))];
}

// ── On the CPU: the modified offset and its bound ─────────────────────────────

const TAU = Math.PI * 2;
const fract = (v: number) => v - Math.floor(v);
const smooth01 = (x: number) => x * x * (3 - 2 * x);
const rot = (v: Vec2, a: number): Vec2 => [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1]];
/** The noise's hash and its looping value noise (the shader's gs_hash, gs_lnoise). */
const hash = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
function lnoise(u: number, cells: number, seed: number): number {
  const f = u * cells, i = Math.floor(f), k = smooth01(f - i);
  const a = hash(((i % cells) + cells) % cells + seed * 17.0), b = hash((((i + 1) % cells) + cells) % cells + seed * 17.0);
  return (a + (b - a) * k) * 2 - 1;
}

/** The progress after the phase modifiers (Repeat, Ease), in order. */
export function modPhase(mods: readonly PathMod[], ph: number): number {
  for (const m of mods) {
    if (m.muted) continue;
    if (m.kind === 'repeat') ph *= modVal(m, 0);
    else if (m.kind === 'ease') { const u = fract(ph); ph = Math.floor(ph) + u + (smooth01(u) - u) * modVal(m, 0); }
  }
  return ph;
}

/** The offset after the offset modifiers, in order (`base` the unmodified path, for Wave along's normal). */
export function modOffset(mods: readonly PathMod[], o: Vec2, ph: number, t: number, base: (ph: number) => Vec2): Vec2 {
  const u = fract(ph);
  for (const m of mods) {
    if (m.muted || isPhaseMod(m.kind)) continue;
    const v = (i: number) => modVal(m, i);
    switch (m.kind) {
      case 'wave': {
        const a = base(ph + 1e-3), b = base(ph - 1e-3);
        const d: Vec2 = [a[0] - b[0], a[1] - b[1]];
        const L = Math.hypot(d[0], d[1]);
        const n: Vec2 = L > 1e-6 ? [-d[1] / L, d[0] / L] : [0, 1];
        const w = v(0) * Math.sin(TAU * v(1) * u + TAU * v(2) * t);
        o = [o[0] + n[0] * w, o[1] + n[1] * w];
        break;
      }
      case 'noise': {
        const cells = Math.max(1, Math.round(v(1)));
        const s = u + v(2) * t;
        o = [o[0] + v(0) * lnoise(s, cells, v(3)), o[1] + v(0) * lnoise(s, cells, v(3) + 0.5)];
        break;
      }
      case 'scale': o = [o[0] * v(0), o[1] * v(1)]; break;
      case 'rotate': o = rot(o, (v(0) + v(1) * t) * Math.PI / 180); break;
      case 'mirror': { const ax = Math.round(v(0)); o = [ax !== 1 ? -o[0] : o[0], ax !== 0 ? -o[1] : o[1]]; break; }
      case 'twist': { const k = 1 + v(0) * Math.sin(TAU * v(1) * u); o = rot([o[0] * k, o[1] * k], TAU * v(2) * u); break; }
      default: break;
    }
  }
  return o;
}

/** A far rate: the path can jump (or its rate isn't known), so with lag the search is bounded by its reach. */
export const JUMP = 1e9;

/**
 * How the modifiers widen a path's reach R and rate V (cells; V per cycle of progress), the
 * shader's gs_bound: conservative, from the live numbers.
 */
export function modBound(mods: readonly PathMod[], R: number, V: number): [number, number] {
  let P = 1;
  for (const m of mods) {
    if (m.muted) continue;
    const v = (i: number) => modVal(m, i);
    switch (m.kind) {
      case 'repeat': P *= Math.abs(v(0)); break;
      case 'ease': P *= 1 + 0.5 * Math.abs(v(0)); break;
      case 'wave': R += Math.abs(v(0)); V = JUMP; break;
      case 'noise': { const c = Math.max(1, Math.round(v(1))); R += Math.abs(v(0)) * Math.SQRT2; V += Math.abs(v(0)) * Math.SQRT2 * 3 * c; break; }
      case 'scale': { const k = Math.max(Math.abs(v(0)), Math.abs(v(1))); R *= k; V *= k; break; }
      case 'twist': {
        const k = Math.abs(v(0));
        // Whole waves and turns loop seamlessly; otherwise the lap's end jumps.
        const whole = (n: number) => Math.abs(n - Math.round(n)) < 1e-3;
        V = whole(v(1)) && whole(v(2)) ? (1 + k) * V + k * TAU * Math.abs(v(1)) * R + TAU * Math.abs(v(2)) * R * (1 + k) : JUMP;
        R *= 1 + k;
        break;
      }
      default: break;
    }
  }
  return [R, Math.min(JUMP, V * P)];
}

/** A formula path's reach, sampled as the shader does (MATH_SAMPLES points plus the largest step). */
export const MATH_SAMPLES = 48;
export function sampledReach(f: (u: number) => Vec2, xy: Vec2): number {
  let R = 0, step = 0;
  let prev: Vec2 | null = null;
  for (let i = 0; i < MATH_SAMPLES; i++) {
    const p = f(i / MATH_SAMPLES);
    const q: Vec2 = [p[0] * xy[0], p[1] * xy[1]];
    R = Math.max(R, Math.hypot(q[0], q[1]));
    if (prev) step = Math.max(step, Math.hypot(q[0] - prev[0], q[1] - prev[1]));
    prev = q;
  }
  return R + step;
}

// ── In the shader ─────────────────────────────────────────────────────────────

/**
 * The math path's function `gs_math<id>$(float X_[K], float t)` → its point at progress t
 * (pad units), its numbers read from the motion array from `at`. A formula that doesn't check
 * draws a circle (the builder shows why).
 */
export function mathGlsl(id: string, m: MathPath, K: number, at: number): string {
  const head = `vec2 gs_math${id}$(float X_[${K}], float t) {`;
  if (m.kind === 'curve') {
    const node = {
      id: `gsc${id}`, type: 'curveTrace', inputs: {}, outputs: {}, position: { x: 0, y: 0 },
      params: {
        mode: m.curve.mode, waveX: m.curve.waveX, waveY: m.curve.waveY, offX: 0, offY: 0, draw: 'whole', morphOn: false,
        ...Object.fromEntries(CURVE_KEYS.map((k, i) => [k, `X_[${at + i}]`])),
      },
    } as unknown as GraphNode;
    const { point } = curvePoint(node, {}, ['X', 'Y']);
    return [head, `  float u = t;`, `  t = u * X_[${at + 7}] * 6.2831853;`, `  float gsc${id}_damp = exp(-X_[${at + 6}] * t);`, `  return ${point};`, '}'].join('\n');
  }
  const lines = blockGlslLines(formulaBlock(m));
  if (!lines) return [head, '  return vec2(cos(6.2831853 * t), sin(6.2831853 * t));', '}'].join('\n');
  return [head, '  vec2 uv = vec2(0.0);',
    ...m.params.map((p, i) => `  float ${p.name} = X_[${at + i}];`),
    ...lines.map(l => `  ${l.lhs} ${l.op} ${l.rhs};`),
    '  return uv;', '}'].join('\n');
}

/** The curve's reach per axis (pad units, Curve Trace's bounds), as GLSL over the motion array `x`. */
export function curveBoundGlsl(id: string, m: MathPath, at: number): string {
  const node = {
    id: `gsc${id}`, type: 'curveTrace', inputs: {}, outputs: {}, position: { x: 0, y: 0 },
    params: { mode: m.curve.mode, waveX: m.curve.waveX, waveY: m.curve.waveY, offX: 0, offY: 0, draw: 'whole', morphOn: false, ...Object.fromEntries(CURVE_KEYS.map((k, i) => [k, `x[${at + i}]`])) },
  } as unknown as GraphNode;
  const b = curvePoint(node, {}, ['X', 'Y']).bounds;
  return b ? `vec2(${b[0]}, ${b[1]})` : 'vec2(1.5)';
}

/** The curve's bound on the CPU (the same as curveBoundGlsl's). */
export function curveBound(c: CurveSpec): Vec2 {
  if (c.mode === 'lateral') return [Math.abs(c.ampX), Math.abs(c.ampY)];
  const r = Math.abs(c.ampX) + Math.abs(c.ampY);
  return [r, r];
}

/** Where each modifier's numbers sit in the motion array (after the path's own), and the lines that apply them. */
export function modLayout(mods: readonly PathMod[], at: number): Array<{ mod: PathMod; on: number; v: (i: number) => string }> {
  let k = at;
  return mods.map(mod => {
    const on = k;
    const first = k + 1;
    k += 1 + MOD_DEFS[mod.kind].params.length;
    return { mod, on, v: (i: number) => `x[${first + i}]` };
  });
}

/** The phase modifiers' lines (in gs_move, on `ph`). */
export function modPhaseGlsl(mods: readonly PathMod[], at: number): string[] {
  return modLayout(mods, at).flatMap(({ mod, on, v }) => {
    if (mod.kind === 'repeat') return [`  if (x[${on}] > 0.5) ph *= ${v(0)};`];
    if (mod.kind === 'ease') return [`  if (x[${on}] > 0.5) { float uu = fract(ph); ph = floor(ph) + uu + (smoothstep(0.0, 1.0, uu) - uu) * ${v(0)}; }`];
    return [];
  });
}

/** The offset modifiers' lines (in gs_move, on `o`, with `ph`, `t`; `base(e)` the unmodified path at ph + e). */
export function modOffsetGlsl(mods: readonly PathMod[], at: number, base: (e: string) => string): string[] {
  return modLayout(mods, at).flatMap(({ mod, on, v }) => {
    const g = (body: string) => [`  if (x[${on}] > 0.5) { ${body} }`];
    switch (mod.kind) {
      case 'wave': return g(`vec2 dd = ${base('1.0e-3')} - ${base('-1.0e-3')}; vec2 nn = length(dd) > 1.0e-6 ? normalize(vec2(-dd.y, dd.x)) : vec2(0.0, 1.0); o += nn * ${v(0)} * sin(6.2831853 * ${v(1)} * fract(ph) + 6.2831853 * ${v(2)} * t);`);
      case 'noise': return g(`float cc = max(1.0, floor(${v(1)} + 0.5)); float ss = fract(ph) + ${v(2)} * t; o += ${v(0)} * vec2(gs_lnoise$(ss, cc, ${v(3)}), gs_lnoise$(ss, cc, ${v(3)} + 0.5));`);
      case 'scale': return g(`o *= vec2(${v(0)}, ${v(1)});`);
      case 'rotate': return g(`o = gs_rot$(o, radians(${v(0)} + ${v(1)} * t));`);
      case 'mirror': return g(`float ax = floor(${v(0)} + 0.5); o *= vec2(abs(ax - 1.0) < 0.5 ? 1.0 : -1.0, abs(ax) < 0.5 ? 1.0 : -1.0);`);
      case 'twist': return g(`float uu = fract(ph); o = gs_rot$(o * (1.0 + ${v(0)} * sin(6.2831853 * ${v(1)} * uu)), 6.2831853 * ${v(2)} * uu);`);
      default: return [];
    }
  });
}

/** The bound's lines (in gs_bound, on R and V, then P the progress's speed-up). */
export function modBoundGlsl(mods: readonly PathMod[], at: number): string[] {
  const out = ['  float P = 1.0;'];
  for (const { mod, on, v } of modLayout(mods, at)) {
    const g = (body: string) => out.push(`  if (x[${on}] > 0.5) { ${body} }`);
    switch (mod.kind) {
      case 'repeat': g(`P *= abs(${v(0)});`); break;
      case 'ease': g(`P *= 1.0 + 0.5 * abs(${v(0)});`); break;
      case 'wave': g(`R += abs(${v(0)}); V = ${JUMP.toExponential(1)};`); break;
      case 'noise': g(`float cc = max(1.0, floor(${v(1)} + 0.5)); R += abs(${v(0)}) * 1.4142136; V += abs(${v(0)}) * 1.4142136 * 3.0 * cc;`); break;
      case 'scale': g(`float kk = max(abs(${v(0)}), abs(${v(1)})); R *= kk; V *= kk;`); break;
      case 'twist': g(`float kk = abs(${v(0)}); bool wh = abs(${v(1)} - floor(${v(1)} + 0.5)) < 1.0e-3 && abs(${v(2)} - floor(${v(2)} + 0.5)) < 1.0e-3; V = wh ? (1.0 + kk) * V + kk * 6.2831853 * abs(${v(1)}) * R + 6.2831853 * abs(${v(2)}) * R * (1.0 + kk) : ${JUMP.toExponential(1)}; R *= 1.0 + kk;`); break;
      default: break;
    }
  }
  out.push(`  V = min(${JUMP.toExponential(1)}, V * P);`);
  return out;
}

/** The looping value noise the Noise modifier reads (lnoise above). */
export const NOISE_GLSL = [
  'float gs_hash$(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }',
  'float gs_lnoise$(float u, float cells, float seed) {',
  '  float f = u * cells; float i = floor(f); float k = smoothstep(0.0, 1.0, f - i);',
  '  float a = gs_hash$(mod(i, cells) + seed * 17.0); float b = gs_hash$(mod(i + 1.0, cells) + seed * 17.0);',
  '  return mix(a, b, k) * 2.0 - 1.0;',
  '}',
].join('\n');

/** How many of the live numbers are the path's own (a math path's), before the modifiers'. */
export const sourceLen = (m: PathExtras): number => (m.path === 'math' ? sourceParams(mathOf(m)).length : 0);
