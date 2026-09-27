/**
 * snippetHarness.ts — any piece of GLSL a Present code block holds, made into
 * a fragment shader that draws something (the Book of Shaders idea: the code
 * next to what it does).
 *
 * A snippet can be:
 *
 *   functions   `float f(float x) { … }`, `vec3 palette(float t)`, an SDF…
 *   body        lines from inside main(): `float d = length(uv) - 0.3;`
 *   both        a node's helpers followed by its lines
 *   shader      a whole fragment shader (it has main(), or Shadertoy's
 *               mainImage)
 *
 * analyzeSnippet reads it without a GPU: its top-level pieces, the functions
 * it defines, the variables its body declares (by type), what it reads that
 * nothing declares, and the numbers worth a slider (uniforms, float consts
 * and #defines, top-level floats set to a number, a function's extra float
 * parameters, and names nothing declares). Each function and each body
 * variable becomes a thing the author can show; floats can also be plotted.
 *
 * buildHarness wraps it: the snippet's globals and functions stay at the top
 * (in their order), the helpers it calls but doesn't define come from a
 * library (the app's always-present helpers, or the source shader's own
 * functions), the body goes into `vec4 _pf_eval(vec2 _q)` with the names
 * lessons use (uv, st, g_uv, x, t, time, fragCoord, mouse…) given where the
 * snippet reads them without declaring them, and main() draws the chosen
 * thing:
 *
 *   plot    y = f(x) over a grid with axes, the curve a constant width
 *           (derivatives), animated when it reads the time
 *   field   the value as colour: floats in grey (negative in blue, like a
 *           distance), vec3/vec4 as themselves, vec2 as red/green, as a
 *           warped grid, or as arrows (each arrow evaluates the snippet at
 *           its cell's centre)
 *
 * Every harness line remembers which snippet line it came from, so compile
 * errors point at the author's lines.
 */
import { ALWAYS_HELPERS_GLSL } from '../compiler/shaderAssembler';

// ── Types ───────────────────────────────────────────────────────────────────

export type ShowType = 'float' | 'vec2' | 'vec3' | 'vec4';
export type PreviewMode = 'plot' | 'field';
export type Vec2View = 'color' | 'grid' | 'arrows';
export type Coords = 'centered' | 'unit';

export interface SnippetParam { name: string; type: string; qualifier: 'in' | 'out' | 'inout' }
export interface SnippetFn { name: string; returnType: string; params: SnippetParam[]; signature: string; line: number }
export interface SnippetVar { name: string; type: string; line: number }

/** A number the preview turns into a slider (a uniform in the harness). */
export interface SnippetSlider {
  /** The uniform the harness reads. */
  uniform: string;
  /** What the slider is called. */
  label: string;
  value: number;
  min: number;
  max: number;
  /** Where it came from. */
  kind: 'uniform' | 'const' | 'define' | 'global' | 'param' | 'free';
  /** An int parameter: the slider moves in whole steps. */
  integer?: boolean;
}

/** One thing the preview can show: a function's result, a body variable, or the shader's own colour. */
export interface ShowOption {
  id: string;
  label: string;
  type: ShowType;
  kind: 'fn' | 'var' | 'frag';
  /** Floats can be drawn as a graph. */
  plottable: boolean;
}

export interface SnippetContext {
  /** Values for uniforms the snippet declares (a source's current values). */
  uniforms?: Record<string, number | number[]>;
  /** Types of names the snippet reads without declaring (from the shader it was taken from). */
  typeHints?: Record<string, string>;
  /** Extra functions it may call (the source shader's), looked up before the app's helpers. */
  library?: string;
  /** The source shader's uniforms by type (they stay uniforms, with their values, rather than stand-ins). */
  uniformTypes?: Record<string, string>;
}

export interface SnippetAnalysis {
  kind: 'empty' | 'functions' | 'body' | 'mixed' | 'shader';
  functions: SnippetFn[];
  /** Variables the body declares at its top level, in order. */
  vars: SnippetVar[];
  options: ShowOption[];
  /** Sliders that don't depend on what's shown (a function's own parameters are added by buildHarness). */
  sliders: SnippetSlider[];
  /** The best guess of what to show, and how. */
  defaultShow: string | undefined;
  defaultMode: PreviewMode;
  /** Names the snippet reads that the harness provides, with what they are. */
  provided: Array<{ name: string; as: string }>;
  /** Names nothing declares that aren't sliders, filled in with a stand-in. */
  filled: Array<{ name: string; type: string; as: string }>;
  /** Functions it calls but doesn't define, found in the library. */
  borrowed: string[];
  /** Reads the time (so the preview animates). */
  usesTime: boolean;
  /** Reads the mouse. */
  usesMouse: boolean;
}

export interface HarnessChoice {
  mode?: PreviewMode;
  show?: string;
  view?: Vec2View;
  coords?: Coords;
  range?: { x: [number, number]; y: [number, number] };
}

export interface PlotColours { bg: string; grid: string; axis: string; curve: string }

export interface Harness {
  source: string;
  /** For each harness line (0-based), the snippet line it came from (1-based), or 0 for the wrapper's own. */
  lineMap: number[];
  sliders: SnippetSlider[];
  mode: PreviewMode;
  show: ShowOption | undefined;
  /** Uniform values to set before drawing (sliders at their values, the snippet's other uniforms from the context). */
  uniforms: Record<string, number | number[]>;
  range: { x: [number, number]; y: [number, number] };
}

// ── Words GLSL owns ─────────────────────────────────────────────────────────

const TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'mat2', 'mat3', 'mat4', 'mat2x2', 'mat3x3', 'mat4x4', 'sampler2D', 'samplerCube']);
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'discard', 'true', 'false', 'struct',
  'const', 'uniform', 'varying', 'attribute', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'precision', 'invariant', 'precise',
]);
const BUILTINS = new Set([
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'ceil', 'trunc', 'round', 'roundEven', 'fract', 'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'isnan', 'isinf',
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect', 'refract', 'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
  'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all', 'not',
  'texture2D', 'texture2DProj', 'texture2DLod', 'textureCube', 'textureCubeLod', 'texture', 'textureLod', 'texelFetch', 'textureSize',
  'dFdx', 'dFdy', 'fwidth', 'gl_FragCoord', 'gl_FragColor', 'gl_FrontFacing', 'gl_PointCoord', 'gl_FragData', 'gl_MaxDrawBuffers',
]);
/** What every harness declares itself. */
const HARNESS_GLOBALS = new Set(['u_time', 'u_resolution', 'u_mouse', 'vUv', 'PI', 'TAU']);
/** Shadertoy's names, turned into the harness's with a #define when a snippet reads them undeclared. */
const SHADERTOY: Record<string, string> = {
  iTime: 'u_time', iGlobalTime: 'u_time', iResolution: 'vec3(u_resolution, 1.0)', iMouse: 'vec4(u_mouse, 0.0, 0.0)', iFrame: '0', iTimeDelta: '0.016',
};

/** Names a lesson reads without declaring, and what the harness makes them (by mode and coordinates). */
const PROVIDED: Record<string, { type: string; describe: string }> = {
  uv: { type: 'vec2', describe: 'the position on the canvas' },
  st: { type: 'vec2', describe: 'the position, 0 to 1 across' },
  g_uv: { type: 'vec2', describe: 'the position, centred (as in the Studio)' },
  p: { type: 'vec2', describe: 'the position, centred' },
  pos: { type: 'vec2', describe: 'the position, centred' },
  x: { type: 'float', describe: 'the horizontal position (the graph’s x)' },
  t: { type: 'float', describe: 'the time in seconds' },
  time: { type: 'float', describe: 'the time in seconds' },
  fragCoord: { type: 'vec2', describe: 'the pixel' },
  mouse: { type: 'vec2', describe: 'the mouse, 0 to 1' },
  resolution: { type: 'vec2', describe: 'the canvas size in pixels' },
};

const IDENT = /[A-Za-z_]\w*/y;
const FLOAT_LITERAL = /^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/;

// ── Scanning ────────────────────────────────────────────────────────────────

/** Comments blanked to spaces (newlines kept), so offsets still line up. */
export function blankComments(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (s[i] === '/' && s[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < s.length) { out += '  '; i += 2; }
      continue;
    }
    out += s[i]; i++;
  }
  return out;
}

interface Chunk {
  kind: 'directive' | 'function' | 'statement';
  /** The text, comments blanked. */
  text: string;
  start: number;
  /** 1-based line of its first character. */
  line: number;
  fn?: SnippetFn;
  /** For a function: where its body's `{` is. */
  bodyAt?: number;
}

const FN_HEAD = /^\s*(?:(?:highp|mediump|lowp|precise)\s+)*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*$/;

function parseParams(list: string): SnippetParam[] {
  const t = list.trim();
  if (!t || t === 'void') return [];
  return t.split(',').flatMap(part => {
    const words = part.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean);
    let qualifier: SnippetParam['qualifier'] = 'in';
    const rest = words.filter(w => {
      if (w === 'in' || w === 'const' || w === 'highp' || w === 'mediump' || w === 'lowp') return false;
      if (w === 'out' || w === 'inout') { qualifier = w; return false; }
      return true;
    });
    if (rest.length < 1) return [];
    return [{ type: rest[0], name: rest[1] ?? '', qualifier }];
  });
}

function fnHead(header: string, line: number): SnippetFn | undefined {
  const m = FN_HEAD.exec(header.replace(/\s+/g, ' '));
  if (!m || KEYWORDS.has(m[1]) || KEYWORDS.has(m[2]) || m[1] === 'return') return undefined;
  const params = parseParams(m[3]);
  return { returnType: m[1], name: m[2], params, signature: `${m[1]} ${m[2]}(${params.map(p => `${p.qualifier === 'in' ? '' : `${p.qualifier} `}${p.type} ${p.name}`.trim()).join(', ')})`, line };
}

const lineAt = (s: string, offset: number) => {
  let n = 1;
  for (let i = 0; i < offset && i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/** The top level of some GLSL: directives, function definitions, and everything else split at `;` and closing braces. */
function scanTopLevel(blank: string): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  const n = blank.length;
  while (i < n) {
    while (i < n && /\s/.test(blank[i])) i++;
    if (i >= n) break;
    const start = i;
    if (blank[i] === '#') {
      while (i < n && blank[i] !== '\n') { if (blank[i] === '\\' && blank[i + 1] === '\n') i++; i++; }
      out.push({ kind: 'directive', text: blank.slice(start, i), start, line: lineAt(blank, start) });
      continue;
    }
    let paren = 0, brace = 0, firstBrace = -1;
    let kind: Chunk['kind'] = 'statement';
    let fn: SnippetFn | undefined;
    for (; i < n; i++) {
      const c = blank[i];
      if (c === '(') paren++;
      else if (c === ')') paren = Math.max(0, paren - 1);
      else if (c === '{') {
        if (brace === 0 && firstBrace < 0) {
          firstBrace = i;
          fn = paren === 0 ? fnHead(blank.slice(start, i), lineAt(blank, start)) : undefined;
        }
        brace++;
      } else if (c === '}') {
        brace = Math.max(0, brace - 1);
        if (brace === 0) {
          if (fn) { kind = 'function'; i++; break; }
          const head = blank.slice(start, firstBrace).trim();
          if (/^struct\b/.test(head) || /^do\b/.test(head)) continue; // runs on to its `;`
          // `if (…) { … } else …` carries on.
          let j = i + 1;
          while (j < n && /\s/.test(blank[j])) j++;
          if (blank.startsWith('else', j) && !/\w/.test(blank[j + 4] ?? '')) continue;
          i++; break;
        }
      } else if (c === ';' && paren === 0 && brace === 0) { i++; break; }
    }
    const text = blank.slice(start, i);
    out.push({ kind, text, start, line: lineAt(blank, start), fn: kind === 'function' ? fn : undefined, bodyAt: kind === 'function' ? firstBrace : undefined });
  }
  return out;
}

/** Identifiers in some code, skipping ones after a `.` (swizzles, fields) and numbers. */
function identifiers(code: string): Array<{ name: string; at: number; call: boolean }> {
  const out: Array<{ name: string; at: number; call: boolean }> = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] ?? ''))) { i++; while (i < code.length && /[\w.]/.test(code[i])) i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const m = IDENT.exec(code)!;
      let k = i - 1;
      while (k >= 0 && (code[k] === ' ' || code[k] === '\t')) k--;
      const afterDot = k >= 0 && code[k] === '.';
      let j = i + m[0].length;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (!afterDot) out.push({ name: m[0], at: i, call: code[j] === '(' });
      i += m[0].length;
      continue;
    }
    i++;
  }
  return out;
}

/** Declarations `type name` (and `type a = …, b`) anywhere in some code: name → type. */
function declarations(code: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?=[=;,)[]|\s*$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const [, type, name] = m;
    if (!TYPES.has(type) || KEYWORDS.has(name) || TYPES.has(name)) continue;
    if (!out.has(name)) out.set(name, type);
    // `float a = 1.0, b = 2.0;`: the names after commas at this statement's top level.
    let depth = 0;
    for (let i = re.lastIndex; i < code.length; i++) {
      const c = code[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { if (depth === 0) break; depth--; }
      else if (c === ';' || c === '{') break;
      else if (c === ',' && depth === 0) {
        const mm = /^\s*([A-Za-z_]\w*)/.exec(code.slice(i + 1));
        if (mm && !out.has(mm[1]) && !TYPES.has(mm[1])) out.set(mm[1], type);
      }
    }
  }
  return out;
}

/** Variables declared at the top level of a body (not inside its loops and ifs), in order. */
function topLevelVars(body: string, lineOf: (offset: number) => number): SnippetVar[] {
  const out: SnippetVar[] = [];
  const seen = new Set<string>();
  let depth = 0, paren = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    if (depth !== 0 || paren !== 0 || !/[A-Za-z_]/.test(c) || (i > 0 && /\w/.test(body[i - 1]))) continue;
    const m = /^(?:(?:const|highp|mediump|lowp)\s+)*(float|vec2|vec3|vec4|int|bool|mat2|mat3)\s+([A-Za-z_]\w*)\s*(?:=|;|,)/.exec(body.slice(i));
    if (!m) continue;
    if (!seen.has(m[2])) { seen.add(m[2]); out.push({ name: m[2], type: m[1], line: lineOf(i) }); }
    i += m[0].length - 1;
  }
  return out;
}

// ── Numbers for sliders ─────────────────────────────────────────────────────

const round = (v: number) => Math.round(v * 1000) / 1000;
/** A range that puts `v` somewhere sensible. */
export function sliderRange(v: number): [number, number] {
  if (!Number.isFinite(v) || v === 0) return [-1, 1];
  if (v > 0) return v <= 1 ? [0, 1] : [0, round(Math.max(1, v * 2))];
  return v >= -1 ? [-1, 1] : [round(v * 2), round(-v * 2)];
}
function slider(uniform: string, label: string, value: number, kind: SnippetSlider['kind'], integer = false): SnippetSlider {
  const [min, max] = sliderRange(value);
  return { uniform, label, value, min, max, kind, ...(integer ? { integer } : {}) };
}

const NAMED_CONSTANTS = new Set(['PI', 'TAU', 'TWO_PI', 'HALF_PI', 'PI2', 'E', 'EPS', 'EPSILON', 'INF', 'PHI', 'SQRT2']);

// ── Analysis ────────────────────────────────────────────────────────────────

interface Parsed {
  blank: string;
  chunks: Chunk[];
  /** Chunks by what they become in the harness. */
  globals: Chunk[];
  body: Chunk[];
  functions: SnippetFn[];
  vars: SnippetVar[];
  sliders: SnippetSlider[];
  /** Chunks replaced by a slider's uniform (dropped from the harness). */
  sliderChunks: Set<Chunk>;
  /** Chunks dropped: precision, #version, the harness's own uniforms and varyings. */
  dropped: Set<Chunk>;
  hasMain: boolean;
  hasMainImage: boolean;
  declared: Map<string, string>;
}

function parseSnippet(code: string, ctx: SnippetContext): Parsed {
  const blank = blankComments(code.replace(/\r/g, ''));
  const chunks = scanTopLevel(blank);
  const functions = chunks.filter(c => c.kind === 'function' && c.fn).map(c => c.fn!);
  const fnText = chunks.filter(c => c.kind === 'function').map(c => c.text).join('\n');
  const usedInFns = new Set(identifiers(fnText).map(t => t.name));
  // Names a loop bound or another constant needs: they must stay constant, so no slider.
  const mustStayConst = new Set<string>();
  for (const m of blank.matchAll(/\bfor\s*\(([^)]*)\)/g)) for (const t of identifiers(m[1])) mustStayConst.add(t.name);
  for (const c of chunks) {
    const t = c.text.trim();
    const k = /^const\b[^=]*=([\s\S]*)$/.exec(t) ?? /^#\s*define\s+\w+\s+([\s\S]*)$/.exec(t);
    if (k) for (const x of identifiers(k[1])) mustStayConst.add(x.name);
    const arr = t.matchAll(/\[([^\]]+)\]/g);
    for (const a of arr) for (const x of identifiers(a[1])) mustStayConst.add(x.name);
  }
  const globals: Chunk[] = [], body: Chunk[] = [];
  const sliders: SnippetSlider[] = [];
  const sliderChunks = new Set<Chunk>(), dropped = new Set<Chunk>();
  const ctxValue = (name: string): number | undefined => { const v = ctx.uniforms?.[name]; return typeof v === 'number' ? v : undefined; };
  for (const c of chunks) {
    const t = c.text.trim();
    if (c.kind === 'function') { globals.push(c); continue; }
    if (c.kind === 'directive') {
      if (/^#\s*(version|extension)\b/.test(t)) { dropped.add(c); continue; }
      const d = /^#\s*define\s+([A-Za-z_]\w*)\s+(\S+)\s*$/.exec(t);
      if (d && /[.eE]/.test(d[2]) && FLOAT_LITERAL.test(d[2]) && !NAMED_CONSTANTS.has(d[1]) && !HARNESS_GLOBALS.has(d[1]) && !mustStayConst.has(d[1])) {
        sliders.push(slider(d[1], d[1], Number(d[2]), 'define'));
        sliderChunks.add(c);
        continue;
      }
      globals.push(c);
      continue;
    }
    if (/^precision\b/.test(t)) { dropped.add(c); continue; }
    const uni = /^(?:(?:highp|mediump|lowp)\s+)?uniform\s+(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([^;]+);$/.exec(t);
    if (uni) {
      const [, type, names] = uni;
      const list = names.split(',').map(s => s.trim().replace(/\[.*$/, '')).filter(Boolean);
      if (list.every(nm => HARNESS_GLOBALS.has(nm))) { dropped.add(c); continue; }
      if (type === 'float' && list.length === 1) {
        const nm = list[0];
        sliders.push(slider(nm, nm, ctxValue(nm) ?? 0.5, 'uniform'));
        sliderChunks.add(c);
        continue;
      }
      // Other uniforms stay declared (a sampler reads black; a vector gets the context's value when there is one).
      if (list.some(nm => HARNESS_GLOBALS.has(nm))) { dropped.add(c); continue; }
      globals.push(c);
      continue;
    }
    if (/^(?:varying|attribute|in|out)\b/.test(t)) {
      if (/\bvUv\b/.test(t)) dropped.add(c); else globals.push(c);
      continue;
    }
    const cst = /^const\s+(?:(?:highp|mediump|lowp)\s+)?float\s+([A-Za-z_]\w*)\s*=\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*;$/.exec(t);
    if (cst && FLOAT_LITERAL.test(cst[2]) && !NAMED_CONSTANTS.has(cst[1]) && !mustStayConst.has(cst[1])) {
      sliders.push(slider(cst[1], cst[1], Number(cst[2]), 'const'));
      sliderChunks.add(c);
      continue;
    }
    if (/^(?:const|struct)\b/.test(t) || fnHead(t.replace(/;$/, ''), 0)) { globals.push(c); continue; }
    // `float speed = 2.0;` at the top of a snippet with functions: a number to play with.
    const lit = /^(?:(?:highp|mediump|lowp)\s+)?float\s+([A-Za-z_]\w*)\s*=\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*;$/.exec(t);
    if (lit && FLOAT_LITERAL.test(lit[2]) && functions.length > 0 && usedInFns.has(lit[1])) {
      sliders.push(slider(lit[1], lit[1], Number(lit[2]), 'global'));
      sliderChunks.add(c);
      continue;
    }
    // Any other declaration a function reads has to stay global.
    const decl = /^(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=|;|\[)/.exec(t);
    if (decl && TYPES.has(decl[1]) && usedInFns.has(decl[2])) { globals.push(c); continue; }
    body.push(c);
  }
  const bodyText = body.map(c => c.text).join('\n');
  const bodyStart = body[0]?.start ?? 0;
  // Offsets in the joined body map back through each chunk.
  const offsets: Array<{ from: number; start: number; len: number }> = [];
  { let at = 0; for (const c of body) { offsets.push({ from: at, start: c.start, len: c.text.length }); at += c.text.length + 1; } }
  const lineOf = (off: number) => {
    const o = offsets.find(x => off >= x.from && off <= x.from + x.len) ?? offsets[0];
    return o ? lineAt(blank, o.start + (off - o.from)) : lineAt(blank, bodyStart);
  };
  const vars = topLevelVars(bodyText, lineOf);
  const declared = declarations(blank);
  for (const f of functions) for (const p of f.params) if (p.name && !declared.has(p.name)) declared.set(p.name, p.type);
  for (const c of chunks) {
    const d = c.kind === 'directive' ? /^#\s*define\s+([A-Za-z_]\w*)/.exec(c.text.trim()) : null;
    if (d) declared.set(d[1], '#define');
    const u = /^(?:(?:highp|mediump|lowp)\s+)?uniform\s+(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([^;]+);/.exec(c.text.trim());
    if (u) for (const nm of u[2].split(',')) declared.set(nm.trim().replace(/\[.*$/, ''), u[1]);
    const s = /^struct\s+([A-Za-z_]\w*)/.exec(c.text.trim());
    if (s) declared.set(s[1], 'struct');
  }
  const hasMain = functions.some(f => f.name === 'main');
  const hasMainImage = functions.some(f => f.name === 'mainImage');
  return { blank, chunks, globals, body, functions, vars, sliders, sliderChunks, dropped, hasMain, hasMainImage, declared };
}

/** Library functions (by name, every overload) and what each one calls; and its #defines and consts by name. */
interface LibFn { name: string; text: string; calls: string[]; reads: string[] }
interface Library { fns: LibFn[]; defs: Map<string, string> }
const libCache = new Map<string, Library>();
function library(text: string): Library {
  const hit = libCache.get(text);
  if (hit) return hit;
  const blank = blankComments(text);
  const chunks = scanTopLevel(blank);
  const fns = chunks.filter(c => c.kind === 'function' && c.fn && c.fn.name !== 'main' && c.fn.name !== 'mainImage').map(c => {
    const ids = identifiers(c.text.slice((c.bodyAt ?? 0) - c.start));
    return { name: c.fn!.name, text: c.text.trim(), calls: ids.filter(t => t.call).map(t => t.name), reads: ids.filter(t => !t.call).map(t => t.name) };
  });
  const defs = new Map<string, string>();
  for (const c of chunks) {
    const t = c.text.trim();
    const d = c.kind === 'directive' ? /^#\s*define\s+([A-Za-z_]\w*)/.exec(t) : /^const\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([A-Za-z_]\w*)/.exec(t);
    if (d && !defs.has(d[1])) defs.set(d[1], t);
  }
  const out = { fns, defs };
  if (libCache.size > 40) libCache.clear();
  libCache.set(text, out);
  return out;
}

/** The functions `names` needs from the libraries (and what those need, with the #defines and consts they read), in library order. */
function borrow(names: Iterable<string>, defined: ReadonlySet<string>, libs: Library[], declared: ReadonlyMap<string, string>): { text: string[]; names: string[] } {
  const want = new Set<string>();
  const visit = (name: string) => {
    if (want.has(name) || defined.has(name)) return;
    const lib = libs.find(l => l.fns.some(f => f.name === name));
    if (!lib) return;
    want.add(name);
    for (const f of lib.fns) if (f.name === name) for (const c of f.calls) visit(c);
  };
  for (const n of names) visit(n);
  const text: string[] = [];
  const defs: string[] = [];
  const seen = new Set<string>();
  const seenDefs = new Set<string>();
  const addDef = (lib: Library, name: string) => {
    if (seenDefs.has(name) || declared.has(name) || HARNESS_GLOBALS.has(name)) return;
    const d = lib.defs.get(name);
    if (!d) return;
    seenDefs.add(name);
    for (const t of identifiers(d.replace(/^#\s*define\s+\w+/, '').replace(/^const[^=]*=/, ''))) addDef(lib, t.name);
    defs.push(d);
  };
  for (const lib of libs) for (const f of lib.fns) if (want.has(f.name) && !seen.has(f.text)) {
    seen.add(f.text);
    for (const r of f.reads) addDef(lib, r);
    text.push(f.text);
  }
  return { text: [...defs, ...text], names: [...want] };
}

/** Where a name comes from when the snippet reads it without declaring it. */
interface Unknowns {
  provided: Array<{ name: string; as: string }>;
  /** Stand-ins: in the evaluator, or (`global`) at the top where functions see them. A `uniform` one takes the context's value. */
  filled: Array<{ name: string; type: string; as: string; expr?: string; global?: boolean; uniform?: boolean }>;
  freeSliders: SnippetSlider[];
  shadertoy: string[];
  borrowed: { text: string[]; names: string[] };
  usesTime: boolean;
  usesMouse: boolean;
}

const STAND_IN: Record<string, { expr: string; as: string }> = {
  float: { expr: '0.0', as: '0 to start with' },
  vec2: { expr: 'uv', as: 'the position' },
  vec3: { expr: 'vec3(uv, 0.0)', as: 'the position, with z = 0' },
  vec4: { expr: 'vec4(0.5)', as: 'grey' },
  int: { expr: '1', as: '1' },
  bool: { expr: 'true', as: 'true' },
  mat2: { expr: 'mat2(1.0)', as: 'no transform' },
  mat3: { expr: 'mat3(1.0)', as: 'no transform' },
};
const ZERO: Record<string, string> = { float: '0.0', vec2: 'vec2(0.0)', vec3: 'vec3(0.0)', vec4: 'vec4(0.0)', int: '0', bool: 'false', mat2: 'mat2(1.0)', mat3: 'mat3(1.0)' };

function findUnknowns(p: Parsed, ctx: SnippetContext): Unknowns {
  const bodyText = p.body.map(c => c.text).join('\n');
  // Directives aside: a function-like macro's parameters aren't names to fill in.
  const fnAndGlobal = p.globals.filter(c => c.kind !== 'directive').map(c => c.text).join('\n');
  const all = identifiers(`${fnAndGlobal}\n${bodyText}`);
  const bodyIds = new Set(identifiers(bodyText).map(t => t.name));
  const defined = new Set(p.functions.map(f => f.name));
  const libs = [...(ctx.library ? [library(ctx.library)] : []), library(ALWAYS_HELPERS_GLSL())];
  const calls = new Set(all.filter(t => t.call && !BUILTINS.has(t.name) && !TYPES.has(t.name) && !defined.has(t.name)).map(t => t.name));
  const borrowed = borrow(calls, defined, libs, p.declared);
  const borrowedText = borrowed.text.join('\n');
  const borrowedDeclared = declarations(blankComments(borrowedText));
  for (const t of borrowed.text) { const d = /^#\s*define\s+([A-Za-z_]\w*)/.exec(t); if (d) borrowedDeclared.set(d[1], '#define'); }
  const borrowedIds = new Set(identifiers(borrowedText).map(x => x.name));
  const borrowedFns = new Set(borrowed.names);
  const names = new Set(all.filter(t => !t.call).map(t => t.name));
  // What borrowed functions read that nothing there declares (a source shader's uniforms): globals.
  const borrowedFree = new Set(identifiers(borrowedText.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')).filter(t => !t.call && !borrowedDeclared.has(t.name)).map(t => t.name));
  const provided: Unknowns['provided'] = [];
  const filled: Unknowns['filled'] = [];
  const freeSliders: SnippetSlider[] = [];
  const shadertoy: string[] = [];
  const allText = `${fnAndGlobal}\n${bodyText}`;
  // A name handed to texture2D()/texture() is a picture.
  const samplers = new Set([...`${allText}\n${borrowedText}`.matchAll(/\btexture(?:2D|Cube)?(?:Lod)?\s*\(\s*([A-Za-z_]\w*)/g)].map(m => m[1]));
  const skip = (name: string) => TYPES.has(name) || KEYWORDS.has(name) || BUILTINS.has(name) || p.declared.has(name) || defined.has(name) || borrowedFns.has(name) || HARNESS_GLOBALS.has(name);
  const userFns = [...defined, ...borrowedFns];
  for (const name of new Set([...names, ...borrowedFree])) {
    if (skip(name)) continue;
    if (name in SHADERTOY) { shadertoy.push(name); continue; }
    const inBorrowedOnly = !names.has(name);
    if (!inBorrowedOnly && name in PROVIDED && bodyIds.has(name)) { provided.push({ name, as: PROVIDED[name].describe }); continue; }
    const hinted = ctx.typeHints?.[name];
    const uniformType = ctx.uniformTypes?.[name];
    const v = ctx.uniforms?.[name];
    if (hinted === 'sampler2D' || uniformType === 'sampler2D' || (!hinted && (samplers.has(name) || /^u_(tex|prevFrame|echo|fontTexture|video)/.test(name)))) {
      filled.push({ name, type: 'sampler2D', as: 'an empty picture', global: true, uniform: true });
      continue;
    }
    // Read by a borrowed function: a global (the source's uniform with its value, or a zero).
    if (inBorrowedOnly) {
      const type = uniformType ?? hinted ?? 'float';
      if (type === 'float' && uniformType) { freeSliders.push(slider(name, name, typeof v === 'number' ? v : 0.5, 'free')); continue; }
      filled.push({ name, type, as: uniformType ? 'its value in the shader' : 'zero', global: true, uniform: !!uniformType, expr: ZERO[type] ?? '0.0' });
      continue;
    }
    const type = uniformType ?? hinted;
    const esc = name.replace(/[$]/g, '\\$&');
    // Written to, or handed to a function (which may write it): a variable, not a slider.
    const written = new RegExp(`\\b${esc}\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)`).test(allText)
      || (!uniformType && userFns.some(fn => new RegExp(`\\b${fn}\\s*\\([^;]*\\b${esc}\\b`).test(allText)));
    if (!type || type === 'float') {
      if (written || (type === 'float' && !uniformType && /time/i.test(name))) {
        const expr = /time/i.test(name) ? 'u_time' : '0.0';
        filled.push({ name, type: 'float', as: expr === 'u_time' ? 'the time' : STAND_IN.float.as, expr });
        continue;
      }
      freeSliders.push(slider(name, name, typeof v === 'number' ? v : 0.5, 'free'));
      continue;
    }
    if (uniformType) { filled.push({ name, type, as: 'its value in the shader', global: true, uniform: true, expr: ZERO[type] }); continue; }
    // A colour from lines not shown is a colour, not a position.
    const s = type === 'vec3' && /col|rgb|tint|albedo/i.test(name) ? { expr: 'vec3(0.95, 0.55, 0.2)', as: 'an orange' } : STAND_IN[type];
    if (s) filled.push({ name, type, as: s.as, expr: s.expr });
  }
  const reads = (n: string) => names.has(n) || borrowedIds.has(n);
  const usesTime = reads('u_time') || reads('iTime') || reads('iGlobalTime') || provided.some(x => x.name === 't' || x.name === 'time') || filled.some(f => f.expr === 'u_time');
  const usesMouse = reads('u_mouse') || reads('iMouse') || provided.some(x => x.name === 'mouse');
  return { provided, filled, freeSliders, shadertoy, borrowed, usesTime, usesMouse };
}

const SHOWABLE = new Set(['float', 'vec2', 'vec3', 'vec4', 'int', 'bool']);
const asShow = (t: string): ShowType => (t === 'int' || t === 'bool' ? 'float' : t as ShowType);
const INPUT_TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);

/** Whether a function can be called with values the harness makes up. */
function callable(f: SnippetFn): boolean {
  return SHOWABLE.has(f.returnType) && f.params.every(p => p.qualifier === 'in' && INPUT_TYPES.has(p.type));
}
/** A float function with no vector parameters can be drawn as a graph of its first parameter. */
function plottableFn(f: SnippetFn): boolean {
  return asShow(f.returnType) === 'float' && f.params.every(p => p.type === 'float' || p.type === 'int' || p.type === 'bool');
}

export function analyzeSnippet(code: string, ctx: SnippetContext = {}): SnippetAnalysis {
  const p = parseSnippet(code, ctx);
  const u = findUnknowns(p, ctx);
  const base = { functions: p.functions, vars: p.vars, provided: u.provided, filled: u.filled, borrowed: u.borrowed.names, usesTime: u.usesTime, usesMouse: u.usesMouse };
  const sliders = [...p.sliders, ...u.freeSliders];
  if (!code.trim()) return { ...base, kind: 'empty', options: [], sliders: [], defaultShow: undefined, defaultMode: 'field' };
  if (p.hasMain || p.hasMainImage) {
    return { ...base, kind: 'shader', options: [{ id: 'frag', label: 'The shader’s colour', type: 'vec4', kind: 'frag', plottable: false }], sliders, defaultShow: 'frag', defaultMode: 'field' };
  }
  const options: ShowOption[] = [];
  const called = new Set(identifiers(p.chunks.filter(c => c.kind === 'function').map(c => c.text.slice((c.bodyAt ?? c.start) - c.start)).join('\n')).filter(t => t.call).map(t => t.name));
  const fns = p.functions.filter(callable);
  for (const f of fns) options.push({ id: `fn:${f.name}`, label: `${f.name}(${f.params.map(x => x.name).join(', ')})`, type: asShow(f.returnType), kind: 'fn', plottable: plottableFn(f) });
  for (const v of p.vars) if (SHOWABLE.has(v.type)) options.push({ id: `var:${v.name}`, label: v.name, type: asShow(v.type), kind: 'var', plottable: asShow(v.type) === 'float' });
  const writesFrag = p.body.some(c => /\bgl_FragColor\s*[.=]/.test(c.text) || /\bgl_FragColor\s*[-+*/]=/.test(c.text));
  if (writesFrag) options.push({ id: 'frag', label: 'gl_FragColor', type: 'vec4', kind: 'frag', plottable: false });
  const kind: SnippetAnalysis['kind'] = p.body.length && p.functions.length ? 'mixed' : p.body.length ? 'body' : p.functions.length ? 'functions' : 'body';

  // What to show first: the body's colour, its last colour-ish variable, its last variable; or the function nothing else calls.
  let show: ShowOption | undefined;
  const bodyOpts = options.filter(o => o.kind !== 'fn');
  if (bodyOpts.length) {
    show = options.find(o => o.kind === 'frag')
      ?? [...bodyOpts].reverse().find(o => /^(col|color|colour|c|rgb|fragColor)$/i.test(o.label) && (o.type === 'vec3' || o.type === 'vec4'))
      ?? bodyOpts[bodyOpts.length - 1];
  } else {
    const top = options.filter(o => o.kind === 'fn' && !called.has(o.id.slice(3)));
    show = top[top.length - 1] ?? options[options.length - 1];
  }
  const readsX = u.provided.some(x => x.name === 'x');
  const defaultMode: PreviewMode = show?.plottable && (show.kind === 'fn' ? p.functions.find(f => `fn:${f.name}` === show!.id)!.params.length > 0 : readsX) ? 'plot' : 'field';
  return { ...base, kind, options, sliders, defaultShow: show?.id, defaultMode };
}

// ── The harness ─────────────────────────────────────────────────────────────

const fmt = (v: number) => { const s = String(round(v)); return /[.eE]/.test(s) ? s : `${s}.0`; };
function hexVec3(hex: string): string {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map(i => fmt(parseInt(h.slice(i, i + 2), 16) / 255));
  return `vec3(${c.join(', ')})`;
}
const toVec4 = (type: string, e: string) => {
  switch (type) {
    case 'vec4': return e;
    case 'vec3': return `vec4(${e}, 1.0)`;
    case 'vec2': return `vec4(${e}, 0.0, 1.0)`;
    case 'int': case 'bool': return `vec4(float(${e}), 0.0, 0.0, 1.0)`;
    default: return `vec4(${e}, 0.0, 0.0, 1.0)`;
  }
};

export const DEFAULT_PLOT_COLOURS: PlotColours = { bg: '#181825', grid: '#28293b', axis: '#585b70', curve: '#89b4fa' };
export const DEFAULT_RANGE = { x: [0, 1] as [number, number], y: [0, 1] as [number, number] };

/** Harness lines, each with the snippet line it came from. */
class Lines {
  text: string[] = [];
  map: number[] = [];
  add(s: string, from = 0) { for (const l of s.split('\n')) { this.text.push(l); this.map.push(from); } }
  /** A chunk of the snippet, keeping its line numbers. */
  chunk(c: Chunk) { c.text.split('\n').forEach((l, i) => { this.text.push(l); this.map.push(c.line + i); }); }
}

export function buildHarness(code: string, choice: HarnessChoice = {}, ctx: SnippetContext = {}, opts: { colours?: PlotColours; dpr?: number } = {}): Harness {
  const a = analyzeSnippet(code, ctx);
  const p = parseSnippet(code, ctx);
  const u = findUnknowns(p, ctx);
  const show = a.options.find(o => o.id === choice.show) ?? a.options.find(o => o.id === a.defaultShow);
  const mode: PreviewMode = choice.mode === 'plot' && show?.plottable ? 'plot' : choice.mode === 'field' || !show?.plottable ? 'field' : a.defaultMode;
  const plot = mode === 'plot';
  const coords: Coords = choice.coords ?? 'centered';
  const view: Vec2View = choice.view ?? 'color';
  const range = choice.range ?? DEFAULT_RANGE;
  const colours = opts.colours ?? DEFAULT_PLOT_COLOURS;
  const sliders = [...a.sliders];
  const uniforms: Record<string, number | number[]> = {};

  // The chosen function's extra parameters.
  const fn = show?.kind === 'fn' ? p.functions.find(f => `fn:${f.name}` === show.id) : undefined;
  const args: string[] = [];
  if (fn) {
    const hasVec = fn.params.some(x => /^vec[234]$/.test(x.type));
    let firstFloatUsed = false, firstVecUsed = false;
    for (const prm of fn.params) {
      const nm = prm.name || 'arg';
      if (/^vec[234]$/.test(prm.type) && !firstVecUsed) {
        firstVecUsed = true;
        args.push(prm.type === 'vec2' ? 'uv' : prm.type === 'vec3' ? 'vec3(uv, 0.0)' : 'vec4(uv, 0.0, 1.0)');
        continue;
      }
      if ((prm.type === 'float') && !hasVec && !firstFloatUsed) { firstFloatUsed = true; args.push('x'); continue; }
      if (prm.type === 'float' && /^(t|time|iTime|u_time)$/.test(nm)) { args.push('u_time'); continue; }
      if (prm.type === 'float' || prm.type === 'int') {
        // GLSL keeps names with "__" for itself.
        const uni = `_pf_${fn.name}_${nm}`.replace(/__+/g, '_');
        sliders.push(slider(uni, nm, prm.type === 'int' ? 1 : 0.5, 'param', prm.type === 'int'));
        args.push(prm.type === 'int' ? `int(${uni})` : uni);
        continue;
      }
      args.push(STAND_IN[prm.type]?.expr === 'uv' ? 'vec2(0.5)' : prm.type === 'vec3' ? 'vec3(0.5)' : prm.type === 'vec4' ? 'vec4(0.5)' : STAND_IN[prm.type]?.expr ?? '0.0');
    }
  }
  for (const s of sliders) uniforms[s.uniform] = s.value;
  // The snippet's other uniforms: the context's values (a source's colours).
  const filledUniforms = new Set(u.filled.filter(f => f.uniform && f.type !== 'sampler2D').map(f => f.name));
  for (const [k, v] of Object.entries(ctx.uniforms ?? {})) if (!(k in uniforms) && (p.declared.has(k) || filledUniforms.has(k))) uniforms[k] = v;

  const L = new Lines();
  L.add('#extension GL_OES_standard_derivatives : enable');
  L.add('precision highp float;');
  L.add('#ifndef PI\n#define PI 3.1415926538\n#endif\n#ifndef TAU\n#define TAU 6.2831853072\n#endif');
  L.add('uniform vec2 u_resolution;\nuniform float u_time;\nuniform vec2 u_mouse;\nuniform vec4 u_pf_range;\nuniform float u_pf_dpr;\nvarying vec2 vUv;');
  for (const name of u.shadertoy) L.add(`#define ${name} ${SHADERTOY[name]}`);
  for (const s of sliders) L.add(`uniform float ${s.uniform};`);
  // Names a function reads that nothing declares: globals, so the functions see them.
  const fnReads = new Set(identifiers(p.globals.filter(c => c.kind === 'function').map(c => c.text).join('\n')).map(t => t.name));
  const isGlobal = (f: Unknowns['filled'][number]) => !!f.global || f.type === 'sampler2D' || fnReads.has(f.name);
  for (const f of u.filled) if (isGlobal(f)) L.add(f.uniform || f.type === 'sampler2D' ? `uniform ${f.type} ${f.name};` : `${f.type} ${f.name} = ${ZERO[f.type] ?? '0.0'};`);
  for (const t of u.borrowed.text) L.add(t);
  for (const c of p.globals) {
    if (c.kind === 'function' && c.fn?.name === 'main') {
      // A whole shader: its main becomes a function the harness calls.
      L.chunk({ ...c, text: c.text.replace(/\bmain\s*\(/, '_pf_main(') });
      continue;
    }
    L.chunk(c);
  }

  // The evaluator: the body with the names lessons use.
  L.add('vec4 _pf_eval(vec2 _q) {');
  const bodyDeclares = new Set(p.vars.map(v => v.name));
  const want = (n: string) => a.provided.some(x => x.name === n) && !bodyDeclares.has(n);
  const aspect = 'vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0)';
  const centered = plot ? '_q' : `(_q - 0.5) * 2.0 * ${aspect}`;
  const unit = '_q';
  // `uv` stands in for other vec2 names, so it's always there.
  L.add(`  vec2 _pf_uv = ${coords === 'unit' ? unit : centered};`);
  L.add('  vec2 uv = _pf_uv;');
  if (want('st')) L.add(`  vec2 st = ${unit};`);
  if (want('g_uv')) L.add(`  vec2 g_uv = ${centered};`);
  if (want('p')) L.add(`  vec2 p = ${centered};`);
  if (want('pos')) L.add(`  vec2 pos = ${centered};`);
  L.add('  float x = _q.x;');
  if (want('t')) L.add('  float t = u_time;');
  if (want('time')) L.add('  float time = u_time;');
  if (want('fragCoord')) L.add(`  vec2 fragCoord = ${plot ? 'gl_FragCoord.xy' : '_q * u_resolution'};`);
  if (want('mouse')) L.add('  vec2 mouse = u_mouse / max(u_resolution, vec2(1.0));');
  if (want('resolution')) L.add('  vec2 resolution = u_resolution;');
  for (const f of u.filled) if (!isGlobal(f)) L.add(`  ${f.type} ${f.name} = ${f.expr ?? STAND_IN[f.type]?.expr ?? '0.0'};`);
  // The body's own `uv` shadows the harness's: keep it out of the way by opening a block.
  const redeclares = p.vars.some(v => v.name === 'uv' || v.name === 'x');
  if (redeclares) L.add('  {');
  for (const c of p.body) L.chunk(c);
  let result = 'vec4(0.0, 0.0, 0.0, 1.0)';
  if (a.kind === 'shader') {
    if (p.hasMain) { L.add('  _pf_main();'); result = 'gl_FragColor'; }
    else { L.add('  vec4 _pf_c = vec4(0.0);\n  mainImage(_pf_c, gl_FragCoord.xy);'); result = '_pf_c'; }
  } else if (show?.kind === 'fn' && fn) result = toVec4(fn.returnType, `${fn.name}(${args.join(', ')})`);
  else if (show?.kind === 'var') { const v = p.vars.find(x => `var:${x.name}` === show.id)!; result = toVec4(v.type, v.name); }
  else if (show?.kind === 'frag') result = 'gl_FragColor';
  L.add(`  return ${result};`);
  if (redeclares) L.add('  }');
  L.add('}');

  // main: draw it.
  L.add('float _pf_seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }');
  L.add('void main() {');
  if (plot) {
    const hw = fmt(1.25 * (opts.dpr ?? 1));
    L.add(`  float xv = mix(u_pf_range.x, u_pf_range.y, vUv.x);
  float yv = mix(u_pf_range.z, u_pf_range.w, vUv.y);
  float fy = _pf_eval(vec2(xv, yv)).x;
  vec3 col = ${hexVec3(colours.bg)};
  float sx = exp2(floor(log2((u_pf_range.y - u_pf_range.x) / 6.0) + 0.5));
  float sy = exp2(floor(log2((u_pf_range.w - u_pf_range.z) / 6.0) + 0.5));
  float gx = abs(fract(xv / sx - 0.5) - 0.5) * sx / (abs(dFdx(xv)) + 1e-4);
  float gy = abs(fract(yv / sy - 0.5) - 0.5) * sy / (abs(dFdy(yv)) + 1e-4);
  col = mix(col, ${hexVec3(colours.grid)}, 1.0 - smoothstep(0.5, 1.5, min(gx, gy)));
  float ax = abs(xv) / (abs(dFdx(xv)) + 1e-4);
  float ay = abs(yv) / (abs(dFdy(yv)) + 1e-4);
  col = mix(col, ${hexVec3(colours.axis)}, 1.0 - smoothstep(0.8, 2.0, ay));
  col = mix(col, ${hexVec3(colours.axis)}, 1.0 - smoothstep(0.8, 2.0, ax));
  if ((yv > 0.0 && yv < fy) || (yv < 0.0 && yv > fy)) col = mix(col, ${hexVec3(colours.curve)}, 0.1);
  float e = yv - fy;
  float d = abs(e) / (length(vec2(dFdx(e), dFdy(e))) + 1e-4);
  col = mix(col, ${hexVec3(colours.curve)}, 1.0 - smoothstep(${hw} - 0.75, ${hw} + 0.75, d));
  gl_FragColor = vec4(col, 1.0);`);
  } else {
    L.add('  vec4 v = _pf_eval(vUv);\n  vec3 col;');
    const t = show?.type ?? 'vec4';
    if (t === 'float') L.add('  col = v.x >= 0.0 ? vec3(clamp(v.x, 0.0, 1.0)) : vec3(0.35, 0.6, 1.0) * clamp(-v.x, 0.0, 1.0);');
    else if (t === 'vec3' || t === 'vec4') L.add('  col = v.rgb;');
    else if (view === 'grid') {
      L.add(`  vec2 w = v.xy * 4.0;
  vec2 g = abs(fract(w - 0.5) - 0.5) / max(fwidth(w), vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float checker = mod(floor(w.x) + floor(w.y), 2.0);
  col = mix(mix(vec3(0.1), vec3(0.16), checker), vec3(0.95), line);`);
    } else if (view === 'arrows') {
      L.add(`  vec2 cells = vec2(14.0 * u_resolution.x / max(u_resolution.y, 1.0), 14.0);
  vec2 cp = vUv * cells;
  vec2 cell = floor(cp) + 0.5;
  vec2 lp = cp - cell;
  vec2 dir = _pf_eval(cell / cells).xy;
  float len = length(dir);
  vec2 dn = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  float s = 0.2 + 0.2 * clamp(len, 0.0, 1.0);
  vec2 tip = dn * s;
  vec2 side = vec2(-dn.y, dn.x);
  float dd = min(_pf_seg(lp, -dn * s, tip), min(_pf_seg(lp, tip, tip - dn * 0.16 + side * 0.1), _pf_seg(lp, tip, tip - dn * 0.16 - side * 0.1)));
  float px = 1.0 / cells.y / max(fwidth(vUv.y), 1e-5);
  col = mix(vec3(0.07) + 0.18 * vec3(v.xy * 0.5 + 0.5, 0.5), vec3(0.92), 1.0 - smoothstep(0.035, 0.035 + 1.5 / px, dd));`);
    } else L.add('  col = vec3(v.xy, 0.0);');
    L.add('  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);');
  }
  L.add('}');
  uniforms.u_pf_range = [range.x[0], range.x[1], range.y[0], range.y[1]];
  return { source: L.text.join('\n'), lineMap: L.map, sliders, mode, show, uniforms, range };
}

/**
 * A compile log in the snippet's own line numbers: "Line 4: 'foo' : undeclared
 * identifier". Lines from the wrapper say so.
 */
export function mapErrors(log: string, lineMap: readonly number[]): Array<{ line: number; message: string }> {
  const out: Array<{ line: number; message: string }> = [];
  for (const raw of log.split('\n')) {
    const l = raw.replace(/\0/g, '').trim();
    if (!l) continue;
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(l);
    if (!m) { out.push({ line: 0, message: l }); continue; }
    if (/^WARNING/.test(l)) continue;
    const at = lineMap[Number(m[1]) - 1] ?? 0;
    out.push({ line: at, message: m[2].replace(/^'([^']*)'\s*:\s*/, "'$1' : ").trim() });
  }
  return out;
}

/**
 * What a snippet taken from a whole shader can lean on: that shader's
 * functions (for helpers it calls), the types of its variables (for names the
 * snippet reads from lines it left out) and its uniform values.
 */
export function contextFromShader(shader: string, uniforms?: Record<string, number | number[]>): SnippetContext {
  const typeHints: Record<string, string> = {};
  for (const [name, type] of declarations(blankComments(shader))) typeHints[name] = type;
  const uniformTypes: Record<string, string> = {};
  for (const m of shader.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*;/g)) { typeHints[m[2]] = m[1]; uniformTypes[m[2]] = m[1]; }
  return { library: shader, typeHints, uniformTypes, uniforms };
}
