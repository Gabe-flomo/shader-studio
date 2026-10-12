/**
 * blocks.ts — transform blocks for the 2D Scene Builder's space (docs/scene-builder-2d.md, "Space
 * blocks").
 *
 * A block is up to three lines in Expression Block style, each assigning to `uv.x`, `uv.y` or `uv`
 * with `=`, `+=`, `-=` or `*=`; a line left empty leaves uv as it is. Inside a line:
 *
 *   x, y   the point as it is now (uv.x and uv.y, after the lines above)
 *   uv     the whole point (vec2)
 *   t      time in seconds
 *   …      the block's own numbers (sliders), by name
 *
 * so Graphtoy-style expressions work: `uv.x += sin(y * 4 + t) * amp`. Whole numbers are written
 * out as floats for GLSL (`4` → `4.0`), `x` and `y` become `uv.x` and `uv.y`, and every line is
 * checked the way the GPU will (glslPatterns typecheck) with errors in plain words.
 *
 * Blocks chain: each SpaceOp's uv feeds the next. A combine runs two blocks on the same uv and
 * joins their results (add, subtract, multiply, blend).
 *
 * The same lines run on the CPU (glslPatterns evaluate) for the thumbnails and the space view.
 * Pure: no React, no store.
 */
import { allNodes, checkTypes, compileExpr, parseExpr, type Expr, type EvalEnv, type Value } from '../lib/glslPatterns';
import { functionInfo } from '../lib/glslPatterns/functions';
import { suggest } from '../lang/fuzzy';

export type BlockTarget = 'uv.x' | 'uv.y' | 'uv';
export type BlockOp = '=' | '+=' | '-=' | '*=';
export const BLOCK_TARGETS: readonly BlockTarget[] = ['uv.x', 'uv.y', 'uv'];
export const BLOCK_OPS: readonly BlockOp[] = ['=', '+=', '-=', '*='];
export const MAX_LINES = 3;
export const MAX_TIMES = 8;
/** A looped block's most Iterations (its Expression Block's Max iterations: the slider runs to it live). */
export const MAX_LOOP_TIMES = 64;

/**
 * An orbit trap: during a looped block's passes, the closest the point came to a shape. Its shade
 * (exp(−3·distance), 1 where the orbit came close) is the block node's `trap` output, and Look →
 * Colour by trap reads it.
 */
export type TrapKind = 'point' | 'cross' | 'ring';
export const TRAP_KINDS: Array<{ kind: TrapKind; label: string; glsl: string; blurb: string }> = [
  { kind: 'point', label: 'Point', glsl: 'length(uv)', blurb: 'the closest the point came to the centre' },
  { kind: 'cross', label: 'Cross', glsl: 'min(abs(uv.x), abs(uv.y))', blurb: 'the closest the point came to either axis' },
  { kind: 'ring', label: 'Ring', glsl: 'abs(length(uv) - 1.0)', blurb: 'the closest the point came to the unit circle' },
];
export const TRAP_BY_KIND = Object.fromEntries(TRAP_KINDS.map(k => [k.kind, k])) as Record<TrapKind, typeof TRAP_KINDS[number]>;
/** Names a looped block's lines can read besides x, y, uv and t: the point before the block, and the loop's own. */
export const LOOP_BLOCK_NAMES: ReadonlyArray<{ name: string; type: 'float' | 'vec2'; doc: string }> = [
  { name: 'uv0', type: 'vec2', doc: 'The point before the block: Mandelbox and Julia-style loops add it back each pass.' },
  { name: 'fi', type: 'float', doc: 'The pass, 0 at the first.' },
  { name: 'k', type: 'float', doc: 'How far through the loop: 0 at the first pass, 1 at the last.' },
  { name: 'n', type: 'float', doc: 'How many passes run (Iterations).' },
];

export interface BlockLine {
  target: BlockTarget;
  op: BlockOp;
  /** The right-hand side as typed; empty leaves uv as it is. */
  rhs: string;
}

/** A number the block exposes as a slider, used in its lines by name. */
export interface BlockParam { name: string; value: number; min: number; max: number }

export interface SpaceBlock {
  /** The library entry it came from (blockLibrary.ts), while its lines are the entry's. */
  lib?: string;
  /** The saved block (savedBlocks.ts, "My blocks") it came from, by name: recipes print `my="…"`. */
  my?: string;
  /** What it is called in the stack and on its node. */
  name?: string;
  lines: BlockLine[];
  params: BlockParam[];
  /** Run the lines this many times (1–8; a looped block's Iterations, 1–64): fractal folds and repeats. */
  times: number;
  /**
   * Looped: built as an Expression Block in Loop mode (nodes/exprLoop.ts), the lines once inside a
   * `for` loop, so Iterations (`times`) is a live slider on its node; uv0, fi, k and n are there.
   */
  loop?: boolean;
  /** A looped block's orbit trap (its node's `trap` output; Look → Colour by trap). */
  trap?: TrapKind | null;
}

export type CombineMode = 'add' | 'subtract' | 'multiply' | 'blend';
export const COMBINE_MODES: Array<{ mode: CombineMode; label: string; blurb: string; glsl: string }> = [
  { mode: 'add', label: 'Add', blurb: 'Both bends at once: A’s push and B’s push added together.', glsl: 'a + b - uv' },
  { mode: 'subtract', label: 'Subtract', blurb: 'A’s bend with B’s taken away (B pushes the other way).', glsl: 'uv + a - b' },
  { mode: 'multiply', label: 'Multiply', blurb: 'A × B, part by part: a copy of uv multiplied back into uv.', glsl: 'a * b' },
  { mode: 'blend', label: 'Blend', blurb: 'Part way from A to B: Amount 0 is all A, 1 is all B.', glsl: 'mix(a, b, amount)' },
];
export const COMBINE_BY_MODE = Object.fromEntries(COMBINE_MODES.map(m => [m.mode, m])) as Record<CombineMode, typeof COMBINE_MODES[number]>;

export interface CombineSpec {
  mode: CombineMode; /** Blend only: 0 is A, 1 is B. */ amount: number; a: SpaceBlock; b: SpaceBlock;
  /** The saved combine (savedBlocks.ts) it came from, by name. */
  my?: string;
}

/** Names a block's own numbers can't take: the variables, the Expression Block's scratch `p`, GLSL's words. */
const RESERVED = new Set(['x', 'y', 'uv', 't', 'p', 'PI', 'TAU', 'true', 'false', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4',
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'discard', 'in', 'out', 'inout', 'uniform', 'const', 'void', 'struct', 'lowp', 'mediump', 'highp', 'precision']);
/** Constants the shader defines (shaderAssembler: #define PI, TAU). */
const CONSTANTS: Record<string, number> = { PI: Math.PI, TAU: Math.PI * 2 };
const CONSTRUCTORS = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2']);
/** Functions a block may call: GLSL built-ins and Playfield's always-there helpers that work per pixel. */
const NO_CALL = new Set(['texture', 'texture2D', 'textureLod', 'texelFetch', 'dFdx', 'dFdy', 'fwidth']);

export const emptyLine = (target: BlockTarget = 'uv'): BlockLine => ({ target, op: '=', rhs: '' });
export function emptyBlock(): SpaceBlock {
  return { name: 'My block', lines: [{ target: 'uv.x', op: '+=', rhs: '' }, { target: 'uv.y', op: '+=', rhs: '' }, { target: 'uv', op: '*=', rhs: '' }], params: [], times: 1 };
}

/** Can `name` be a block number? Null when it can, else why not. */
export function paramNameProblem(name: string, taken: Iterable<string> = []): string | null {
  if (!/^[A-Za-z_]\w*$/.test(name)) return 'A name is letters, digits and _ (starting with a letter).';
  if (RESERVED.has(name)) return `“${name}” is taken: x, y, uv, t and GLSL's own words can't be slider names.`;
  if (functionInfo(name)) return `“${name}” is a GLSL function.`;
  if ([...taken].includes(name)) return `There is already a “${name}”.`;
  return null;
}

/** A slider range around a value: 0–1 for small numbers, else 0 to about twice it (symmetric when negative). */
export function rangeFor(value: number): { min: number; max: number } {
  const a = Math.abs(value);
  if (a <= 1) return value < 0 ? { min: -1, max: 1 } : { min: 0, max: 1 };
  const want = a * 2, p = Math.pow(10, Math.floor(Math.log10(want)));
  const top = [1, 2, 5, 10].map(m => m * p).find(v => v >= want) ?? want;
  return value < 0 ? { min: -top, max: top } : { min: 0, max: top };
}

// ── Text → lines ──────────────────────────────────────────────────────────────

export interface LineParse { line: BlockLine | null; error?: string }

/**
 * One typed line, `uv.x += sin(y)`: the target (uv.x, uv.y or uv; `x` and `y` read as uv.x and
 * uv.y), the operator and the rest. A trailing `;` is fine.
 */
export function parseLineText(text: string): LineParse {
  const s = text.trim().replace(/;\s*$/, '');
  if (!s) return { line: null };
  const m = /^(uv\s*\.\s*x|uv\s*\.\s*y|uv|x|y)\s*(\+=|-=|\*=|\/=|=)(?!=)\s*([\s\S]*)$/.exec(s);
  if (!m) {
    const lhs = /^([^=+\-*/]*)/.exec(s)?.[1]?.trim() ?? s;
    return { line: null, error: `A line starts with uv.x, uv.y or uv (or x, y), then =, +=, -= or *=. “${lhs.slice(0, 24)}” isn't one of those.` };
  }
  const t = m[1].replace(/\s+/g, '');
  const target: BlockTarget = t === 'x' || t === 'uv.x' ? 'uv.x' : t === 'y' || t === 'uv.y' ? 'uv.y' : 'uv';
  if (m[2] === '/=') return { line: null, error: 'Divide-assign (/=) isn’t one of the operators: write *= 1.0 / … or = uv / … instead.' };
  if (!m[3].trim()) return { line: null, error: `Nothing after ${m[2]}: write what ${target} becomes.` };
  return { line: { target, op: m[2] as BlockOp, rhs: m[3].trim() } };
}

/** A block's lines as text, one per line (`uv.x += …`). */
export function linesText(lines: BlockLine[]): string {
  return lines.filter(l => l.rhs.trim()).map(l => `${l.target} ${l.op} ${l.rhs}`).join('\n');
}

/** Several lines of text (new lines or `;`) into block lines: at most three. */
export function parseBlockText(text: string): { lines: BlockLine[]; errors: string[] } {
  const parts = splitTopLevel(text);
  const lines: BlockLine[] = [];
  const errors: string[] = [];
  parts.forEach((p, i) => {
    const r = parseLineText(p);
    if (r.error) errors.push(`Line ${i + 1}: ${r.error}`);
    else if (r.line) lines.push(r.line);
  });
  if (lines.length > MAX_LINES) errors.push(`A block has at most ${MAX_LINES} lines; this has ${lines.length}. Chain another block for more.`);
  return { lines: lines.slice(0, MAX_LINES), errors };
}

/** Split on new lines and on `;` outside brackets. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === '\n' || ch === ';') && depth === 0) { if (cur.trim()) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── Checking and GLSL ─────────────────────────────────────────────────────────

export interface LineCheck {
  ok: boolean;
  /** Empty: the line leaves uv as it is. */
  empty: boolean;
  /** Plain-words problem, when not ok. */
  error?: string;
  /** The right-hand side as GLSL (x → uv.x, whole numbers → floats), when ok. */
  glsl?: string;
  expr?: Expr;
}

/**
 * Check one line against the block's numbers: it parses, every name is known (x, y, uv, t, PI,
 * TAU, a slider), every call is a function GLSL (or Playfield) has, and the types fit the target.
 */
export function checkLine(line: BlockLine, params: readonly BlockParam[], looped = false): LineCheck {
  const rhs = line.rhs.trim();
  if (!rhs) return { ok: true, empty: true };
  if (!BLOCK_TARGETS.includes(line.target)) return { ok: false, empty: false, error: `${line.target} isn't a target: use uv.x, uv.y or uv.` };
  if (!BLOCK_OPS.includes(line.op)) return { ok: false, empty: false, error: `${line.op} isn't an operator here: use =, +=, -= or *=.` };
  const parsed = parseExpr(rhs);
  if (!parsed.ok) return { ok: false, empty: false, error: `Can't read “${rhs.slice(0, 40)}”: ${parsed.error.replace(/^Unexpected/, 'unexpected')}.` };
  const names = new Set(params.map(p => p.name));
  const known = ['x', 'y', 'uv', 't', ...Object.keys(CONSTANTS), ...names, ...(looped ? LOOP_BLOCK_NAMES.map(v => v.name) : [])];
  const nodes = allNodes(parsed.expr);
  for (const n of nodes) {
    if (n.kind === 'ident' && !known.includes(n.name)) {
      const s = suggest(n.name, known);
      return { ok: false, empty: false, error: `“${n.name}” isn't known. Use x, y, uv, t, PI, TAU${looped ? ', uv0, fi, k, n' : ''}${names.size ? ` or a slider (${[...names].join(', ')})` : ' or add a slider by that name'}.${s ? ` Did you mean “${s}”?` : ''}` };
    }
    if (n.kind === 'call') {
      if (NO_CALL.has(n.callee)) return { ok: false, empty: false, error: `${n.callee}() can't be used in a space block.` };
      if (!CONSTRUCTORS.has(n.callee) && !functionInfo(n.callee)) {
        const s = suggest(n.callee, ['sin', 'cos', 'tan', 'atan', 'abs', 'fract', 'floor', 'mod', 'length', 'dot', 'normalize', 'exp', 'log', 'pow', 'sqrt', 'mix', 'smoothstep', 'step', 'clamp', 'min', 'max', 'sign', 'tanh', 'rot2D', 'rotate', 'valueNoise']);
        return { ok: false, empty: false, error: `${n.callee}() isn't a function GLSL knows.${s ? ` Did you mean ${s}()?` : ''}` };
      }
    }
    if (n.kind === 'binary' && n.op === '%') return { ok: false, empty: false, error: '% works on whole numbers only in GLSL: use mod(a, b).' };
  }
  const glsl = toGlsl(rhs, parsed.expr);
  const again = parseExpr(glsl);
  if (!again.ok) return { ok: false, empty: false, error: again.error };
  const env = { uv: 'vec2', t: 'float', ...(looped ? Object.fromEntries(LOOP_BLOCK_NAMES.map(v => [v.name, v.type])) : {}), ...Object.fromEntries(params.map(p => [p.name, 'float'])) } as const;
  const tc = checkTypes(again.expr, env as never);
  if (!tc.ok) return { ok: false, empty: false, error: plainType(tc.errors[0] ?? 'the types don’t fit') };
  const ty = tc.type;
  if (line.target !== 'uv') {
    if (ty !== 'float' && ty !== 'unknown') return { ok: false, empty: false, error: `${line.target} is one number, but this gives a ${ty}. Take one part (….x) or assign to uv.` };
  } else if (ty !== 'unknown') {
    if (ty !== 'vec2' && ty !== 'float') return { ok: false, empty: false, error: `uv is a vec2 (two numbers), but this gives a ${ty}.` };
    if (ty === 'float' && line.op === '=') return { ok: false, empty: false, error: 'uv = needs two numbers: write vec2(…, …), or use *= / += to apply one number to both.' };
  }
  return { ok: true, empty: false, glsl, expr: again.expr };
}

function plainType(e: string): string {
  return `${e.charAt(0).toUpperCase()}${e.slice(1)}${/[.!?]$/.test(e) ? '' : '.'}`;
}

/**
 * The right-hand side as GLSL: `x` → `uv.x`, `y` → `uv.y`, whole numbers → floats (`4` → `4.0`,
 * except an index like `uv[0]`). The rest of the text stays as typed.
 */
function toGlsl(src: string, e: Expr): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const indexNums = new Set<number>();
  for (const n of allNodes(e)) if (n.kind === 'index') for (const k of allNodes(n.index)) indexNums.add(k.id);
  for (const n of allNodes(e)) {
    if (n.kind === 'ident' && (n.name === 'x' || n.name === 'y')) edits.push({ start: n.start, end: n.end, text: `uv.${n.name}` });
    else if (n.kind === 'num' && n.int && !indexNums.has(n.id)) edits.push({ start: n.start, end: n.end, text: `${n.raw}.0` });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const ed of edits) out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  return out;
}

export interface BlockCheck {
  ok: boolean;
  /** Per line (same order as block.lines). */
  lines: LineCheck[];
  /** Block-level problems (bad slider names, too many lines). */
  errors: string[];
  /** Sliders no line uses. */
  unused: string[];
}

export function checkBlock(block: SpaceBlock): BlockCheck {
  const errors: string[] = [];
  if (block.lines.length > MAX_LINES) errors.push(`A block has at most ${MAX_LINES} lines.`);
  const seen: string[] = [];
  for (const p of block.params) {
    const why = paramNameProblem(p.name, seen);
    if (why) errors.push(`Slider ${p.name}: ${why}`);
    else if (block.loop && (LOOP_BLOCK_NAMES.some(v => v.name === p.name) || p.name === 'trap')) errors.push(`Slider ${p.name}: “${p.name}” is the loop’s own name in a looped block.`);
    seen.push(p.name);
  }
  const lines = block.lines.map(l => checkLine(l, block.params, !!block.loop));
  const used = new Set(lines.flatMap(l => (l.expr ? allNodes(l.expr).filter(n => n.kind === 'ident').map(n => (n as { name: string }).name) : [])));
  const unused = block.params.map(p => p.name).filter(n => !used.has(n));
  return { ok: !errors.length && lines.every(l => l.ok), lines, errors, unused };
}

/** The Expression Block lines for a block (its lines `times` over), or null when it doesn't check. */
export function blockGlslLines(block: SpaceBlock): Array<{ lhs: string; op: string; rhs: string }> | null {
  const chk = checkBlock(block);
  if (!chk.ok) return null;
  const once = block.lines.map((l, i) => ({ l, c: chk.lines[i] })).filter(x => !x.c.empty).map(x => ({ lhs: x.l.target, op: x.l.op, rhs: x.c.glsl! }));
  // A looped block's lines run inside its node's loop: written once
  if (block.loop) return once.map(x => ({ ...x }));
  const times = clampTimes(block.times);
  return Array.from({ length: times }, () => once).flat().map(x => ({ ...x }));
}

/** Run ×: 1–8, or a looped block's Iterations, 1–64. */
export const clampTimes = (n: unknown, looped = false) => Math.max(1, Math.min(looped ? MAX_LOOP_TIMES : MAX_TIMES, Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 1)));

/** Does a looped block read the point before it (uv0)? */
export function blockReadsUv0(block: SpaceBlock): boolean {
  return !!block.loop && block.lines.some(l => { const r = parseExpr(l.rhs || '0'); return r.ok && allNodes(r.expr).some(n => n.kind === 'ident' && n.name === 'uv0'); });
}

/**
 * A looped block's Expression Block loop (nodes/exprLoop.ts): Before (uv0, the trap's start), After
 * (the trap's shade), and the trap's line added to the looped lines. Null for a block that isn't looped.
 */
export function blockLoopParts(block: SpaceBlock): { before: Array<{ lhs: string; op: string; rhs: string }>; extra: Array<{ lhs: string; op: string; rhs: string }>; after: Array<{ lhs: string; op: string; rhs: string }> } | null {
  if (!block.loop) return null;
  const trap = block.trap ? TRAP_BY_KIND[block.trap] : null;
  return {
    before: [...(blockReadsUv0(block) ? [{ lhs: 'vec2 uv0', op: '=', rhs: 'uv' }] : []), ...(trap ? [{ lhs: 'float trap', op: '=', rhs: '1e3' }] : [])],
    extra: trap ? [{ lhs: 'trap', op: '=', rhs: `min(trap, ${trap.glsl})` }] : [],
    after: trap ? [{ lhs: 'trap', op: '=', rhs: 'exp(-3.0 * trap)' }] : [],
  };
}

/** The time names a block reads: does it move? */
export function blockUsesTime(block: SpaceBlock): boolean {
  return block.lines.some(l => { const r = parseExpr(l.rhs || '0'); return r.ok && allNodes(r.expr).some(n => n.kind === 'ident' && n.name === 't'); });
}

// ── On the CPU ────────────────────────────────────────────────────────────────

export type Map2 = (x: number, y: number) => [number, number];
const ident: Map2 = (x, y) => [x, y];

/**
 * Where a block sends a point, at time `t`: its checked lines on the CPU. A block that doesn't
 * check, or a line the evaluator can't run, leaves points where they are.
 */
export function blockMap(block: SpaceBlock, t = 0): Map2 {
  const chk = checkBlock(block);
  if (!chk.ok) return ident;
  let steps: Array<{ target: BlockTarget; op: BlockOp; run: (env: EvalEnv) => Value }>;
  try {
    steps = block.lines.map((l, i) => ({ l, c: chk.lines[i] })).filter(x => !x.c.empty).map(x => ({ target: x.l.target, op: x.l.op, run: compileExpr(x.c.expr!) }));
  } catch { return ident; }
  const times = clampTimes(block.times, !!block.loop);
  const base: EvalEnv = { t, ...CONSTANTS, ...Object.fromEntries(block.params.map(p => [p.name, p.value])) };
  return (x0, y0) => {
    let ux = x0, uy = y0;
    try {
      for (let k = 0; k < times; k++) {
        // A looped block's own names: the point before it and the pass
        const loopEnv: EvalEnv = block.loop ? { uv0: [x0, y0], fi: k, n: times, k: k / Math.max(times - 1, 1) } : {};
        for (const s of steps) {
          const env: EvalEnv = { ...base, ...loopEnv, uv: [ux, uy] };
          const v = s.run(env);
          if (s.target === 'uv') {
            const vx = Array.isArray(v) ? v[0] : v, vy = Array.isArray(v) ? v[1] : v;
            [ux, uy] = [apply(s.op, ux, vx), apply(s.op, uy, vy)];
          } else {
            const n = Array.isArray(v) ? v[0] : v;
            if (s.target === 'uv.x') ux = apply(s.op, ux, n); else uy = apply(s.op, uy, n);
          }
        }
      }
    } catch { return [x0, y0]; }
    return [ux, uy];
  };
}

const apply = (op: BlockOp, cur: number, v: number) => (op === '=' ? v : op === '+=' ? cur + v : op === '-=' ? cur - v : cur * v);

/** Where a combine sends a point. */
export function combineMap(c: CombineSpec, t = 0): Map2 {
  const A = blockMap(c.a, t), B = blockMap(c.b, t);
  const k = c.amount;
  return (x, y) => {
    const [ax, ay] = A(x, y), [bx, by] = B(x, y);
    switch (c.mode) {
      case 'add': return [ax + bx - x, ay + by - y];
      case 'subtract': return [x + ax - bx, y + ay - by];
      case 'multiply': return [ax * bx, ay * by];
      default: return [ax * (1 - k) + bx * k, ay * (1 - k) + by * k];
    }
  };
}

/** A block's main value for a chip: its first line, short. */
export function blockSummary(block: SpaceBlock): string {
  const first = block.lines.find(l => l.rhs.trim());
  if (!first) return 'as it is';
  const s = `${first.target} ${first.op} ${first.rhs.trim()}`;
  return s.length > 34 ? `${s.slice(0, 33)}…` : s;
}

/** A plain copy of a block (lines and params cloned). */
export const cloneBlock = (b: SpaceBlock): SpaceBlock => ({ ...b, lines: b.lines.map(l => ({ ...l })), params: b.params.map(p => ({ ...p })) });

/** What a looped block's trap does, in words (its node's note, the editor). */
export function trapWords(kind: TrapKind): string {
  return `${TRAP_BY_KIND[kind].label} trap: ${TRAP_BY_KIND[kind].blurb} over the passes, as a shade (1 close, fading out)`;
}
