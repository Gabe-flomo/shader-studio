/**
 * buildUp.ts — the rows of the Explain panel's build-up view (docs/expression-explainer.md).
 *
 * A line is shown as it is built, the order GLSL computes it: one row per input it reads, one
 * row per step (explain.ts, inside-out), then the result (the line's target). Each row carries
 * the GLSL expression that computes it on its own, so a host can draw it (a small render, or
 * the big ▶ preview), and whether it can change across the screen:
 *
 *  - a value that is the same everywhere (a number, the clock, a slider) draws as a swatch or a
 *    number;
 *  - one that varies draws as a small picture, or, when that would cost too much, a 1D strip
 *    along the screen's horizontal middle (cpuStrip here, else one rendered row).
 *
 * Pure: no store, no GPU. The host says which names vary (it knows the wiring).
 */
import type { Expr, GlslType } from './ast';
import { allNodes } from './ast';
import { evaluate, type EvalEnv, type Value } from './evaluate';
import type { Explanation, LineExplanation } from './explain';
import { NAMED_CONSTANTS } from './match';
import { freeNames, workedVars, type WorkedVar } from './worked';

export type BuildUpKind = 'input' | 'step' | 'result';

export interface BuildUpRow {
  /** Stable within one explanation: `in:uv`, `step:B`, `result`. */
  key: string;
  kind: BuildUpKind;
  /** What the row is called: the input's name, the step's letter, the target (or "result"). */
  label: string;
  /** The code shown, earlier steps as their letters: `sin(A)`. */
  code: string;
  /** The GLSL that computes the row on its own (no letters): `sin(uv.x * 3.0)`. */
  expr: string;
  type: GlslType;
  /** The span lit in the code line, in the explained text's coordinates (an input: its first read). */
  start: number;
  end: number;
  /** The tree node, for CPU evaluation; null for a result that is a plain name. */
  node: Expr | null;
  /** The names it reads (functions and named constants left out). */
  names: string[];
  /** It can differ from pixel to pixel (it reads something that does). */
  varies: boolean;
}

/** Names every shader can read that differ per pixel. */
const SCREEN_NAMES = /^(gl_FragCoord|fragCoord|vUv|uv|g_uv|st|coord|fragUv)$/;

/**
 * The default "does this name vary across the screen" guess, for hosts that don't know the
 * wiring (the GLSL page, a Custom Function): screen coordinates and anything whose role is space
 * do; numbers, the clock and everything else are taken as the same everywhere.
 */
export function defaultVarying(ex: Explanation, name: string): boolean {
  if (SCREEN_NAMES.test(name)) return true;
  for (const n of allNodes(ex.root)) {
    if (n.kind === 'ident' && n.name === name) {
      const d = ex.descs.get(n.id);
      if (d?.role === 'space' || d?.role === 'direction' || d?.role === 'cell') return true;
    }
  }
  return /^(p|q|pos|position|xy)$/.test(name);
}

const namesIn = (e: Expr): string[] => {
  const out: string[] = [];
  for (const n of allNodes(e)) if (n.kind === 'ident' && !(n.name in NAMED_CONSTANTS) && !out.includes(n.name)) out.push(n.name);
  return out;
};

/**
 * A node's GLSL on its own. `p *= 2.0` is explained as a made-up `p * 2.0` whose span covers
 * `p *= 2.0`, so that one is printed from its parts.
 */
export function exprSource(ex: Explanation | LineExplanation, e: Expr): string {
  const src = ex.source;
  if (e.kind === 'binary' && e.id <= -9_000_000) {
    return `(${src.slice(e.left.start, e.left.end).trim()}) ${e.op} (${src.slice(e.right.start, e.right.end).trim()})`;
  }
  return src.slice(e.start, e.end).trim();
}

const isLine = (ex: Explanation | LineExplanation): ex is LineExplanation => 'leadSegs' in ex;

/** The rows: inputs, then steps in GLSL's order, then the result. */
export function buildUpRows(ex: Explanation | LineExplanation, varying: (name: string) => boolean = n => defaultVarying(ex, n)): BuildUpRow[] {
  const rows: BuildUpRow[] = [];
  const typeGuess = new Map(workedVars(ex).map(v => [v.name, v.type as GlslType]));
  const all = allNodes(ex.root);
  const vary = new Map<string, boolean>();
  const v = (name: string) => { let r = vary.get(name); if (r === undefined) { r = varying(name); vary.set(name, r); } return r; };

  for (const name of freeNames(ex)) {
    const at = all.find(n => n.kind === 'ident' && n.name === name)!;
    const t = ex.descs.get(at.id)?.type;
    rows.push({
      key: `in:${name}`, kind: 'input', label: name, code: name, expr: name,
      type: t && t !== 'unknown' ? t : typeGuess.get(name) ?? 'unknown',
      start: at.start, end: at.end, node: at, names: [name], varies: v(name),
    });
  }
  for (const s of ex.steps) {
    const names = namesIn(s.node);
    rows.push({
      key: `step:${s.label}`, kind: 'step', label: s.label, code: s.code, expr: exprSource(ex, s.node),
      type: s.type, start: s.start, end: s.end, node: s.node, names, varies: names.some(v),
    });
  }
  const names = namesIn(ex.root);
  const target = isLine(ex) ? ex.line.target : undefined;
  const last = ex.steps[ex.steps.length - 1];
  const rootIsLast = !!last && last.node === ex.root;
  rows.push({
    key: 'result', kind: 'result',
    label: target ?? (isLine(ex) && ex.line.isReturn ? 'result' : '='),
    code: rootIsLast ? last.label : ex.descs.get(ex.root.id)?.code ?? exprSource(ex, ex.root),
    expr: exprSource(ex, ex.root), type: ex.type,
    start: ex.root.start, end: ex.root.end, node: ex.root, names, varies: names.some(v),
  });
  return rows;
}

// ── Pictures: what each row draws, and the fallback ─────────────────────────

/** How a row's picture is drawn. */
export type PictureKind =
  /** The same everywhere: a colour swatch (vec3 / vec4) or a number (float, vec2). */
  | 'constant'
  /** A small real render. */
  | 'render'
  /** A 1D strip along the screen's horizontal middle, CPU-evaluated. */
  | 'strip-cpu'
  /** A 1D strip, one rendered row (the CPU can't work it out). */
  | 'strip-render'
  /** Nothing to draw (a type a picture can't show). */
  | 'none';

const DRAWABLE = new Set<GlslType>(['float', 'vec2', 'vec3', 'vec4', 'int']);

/** What makes a graph too heavy to render a picture per row (see pictureBudget). */
export interface GraphCost {
  /** Nodes upstream of the block. */
  nodes: number;
  /** Upstream node types that each cost a lot per pixel (a March Loop, a Pass, agents). */
  heavyTypes: string[];
  /** Texture reads (textures, video, audio, a Pass's buffer) in the compiled shader. */
  textures: number;
  /** The last measured compile + render time for this block's pictures, ms (0: not measured). */
  lastMs?: number;
}

/** Upstream node types that are too heavy to draw a picture per row. */
export const HEAVY_TYPE = /^(march|pass|agent|drawAgents|particle|slime|fluid|reactionDiffusion|feedback|timeCube|frameStack|baked|videoInput|textureInput)/i;
export const MAX_NODES = 40;
export const MAX_TEXTURES = 0;
/** Above this (ms per block), pictures fall back to strips. */
export const MAX_MS = 120;

/** Whether this graph can afford a small render per row, and if not, why. */
export function pictureBudget(cost: GraphCost | null): { render: boolean; why?: string } {
  if (!cost) return { render: false, why: 'no graph to render here' };
  if (cost.heavyTypes.length) return { render: false, why: `${cost.heavyTypes[0]} upstream` };
  if (cost.textures > MAX_TEXTURES) return { render: false, why: 'texture reads upstream' };
  if (cost.nodes > MAX_NODES) return { render: false, why: `${cost.nodes} nodes upstream` };
  if (cost.lastMs && cost.lastMs > MAX_MS) return { render: false, why: `${Math.round(cost.lastMs)} ms per update` };
  return { render: true };
}

/**
 * How one row draws: constant rows are swatches / numbers; varying rows render when the budget
 * allows, else a CPU strip when the evaluator can do it, else one rendered row.
 */
export function pictureKind(row: BuildUpRow, budget: { render: boolean }, cpuOk: boolean, canRender: boolean): PictureKind {
  if (!DRAWABLE.has(row.type) && row.type !== 'unknown') return 'none';
  if (!row.varies) return 'constant';
  // A render declares the row's type, so it needs one the shader can hold
  const gpu = canRender && DRAWABLE.has(row.type);
  if (gpu && budget.render) return 'render';
  if (cpuOk) return 'strip-cpu';
  return gpu ? 'strip-render' : 'none';
}

// ── The CPU strip ─────────────────────────────────────────────────────────────

/** Samples across a strip. */
export const STRIP_SAMPLES = 64;

const dims = (t: string) => (t === 'vec2' ? 2 : t === 'vec3' ? 3 : t === 'vec4' ? 4 : 1);

/**
 * The row's value along the screen's horizontal middle, left to right, from the sample inputs:
 * a varying name runs over its range along x (a position's y stays at its middle), the others
 * keep their sample value. Null when the evaluator can't do it (a texture, a user function).
 */
export function cpuStrip(row: BuildUpRow, vars: readonly WorkedVar[], varies: (name: string) => boolean, n = STRIP_SAMPLES): Value[] | null {
  if (!row.node) return null;
  const out: Value[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0.5 : i / (n - 1);
    const env: EvalEnv = {};
    for (const v of vars) {
      if (!varies(v.name)) { env[v.name] = v.value; continue; }
      const [lo, hi] = v.range;
      const along = lo + (hi - lo) * x, mid = (lo + hi) / 2;
      const d = dims(v.type);
      env[v.name] = d === 1 ? along : Array.from({ length: d }, (_, k) => (k === 0 ? along : k === 1 ? mid : Array.isArray(v.value) ? v.value[k] : mid));
    }
    let r: Value;
    try { r = evaluate(row.node, env); } catch { return null; }
    const f = Array.isArray(r) ? r : [r];
    if (!f.every(Number.isFinite)) return null;
    out.push(r);
  }
  return out;
}

/** A row's value at the sample inputs (a constant's swatch / number). Null when the CPU can't. */
export function cpuValue(row: BuildUpRow, vars: readonly WorkedVar[]): Value | null {
  if (!row.node) return null;
  try {
    const r = evaluate(row.node, Object.fromEntries(vars.map(v => [v.name, v.value])));
    const f = Array.isArray(r) ? r : [r];
    return f.every(Number.isFinite) ? r : null;
  } catch { return null; }
}

/** The min…max over every component of some values; null when empty. */
export function spanOf(values: ArrayLike<number>, stride = 1, comps = 1): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i += stride) {
    for (let c = 0; c < comps; c++) {
      const x = values[i + c];
      if (!Number.isFinite(x)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/** All the values are the same (to a tolerance relative to their size). */
export function isFlat(range: [number, number] | null): boolean {
  if (!range) return true;
  const [lo, hi] = range;
  return hi - lo <= 1e-5 * Math.max(1, Math.abs(lo), Math.abs(hi));
}
