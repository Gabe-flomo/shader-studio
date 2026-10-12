/**
 * readableGlsl — the Generated code panel's Readable view (docs/readable-code.md).
 *
 * A pure transform from a compiled fragment shader plus the compiler's own maps (nodeSlugMap,
 * paramBindings, nodeOutputVars) and the graph to an easier-to-read program that compiles and
 * renders the same:
 *   1. helper functions main() never reaches are left out;
 *   2. single-use pure copies (`vec2 t = uv;`, `float k = 1.0;`) are folded into their one use;
 *   3. spacing, indentation and float literals are tidied;
 *   4. main()'s statements get a `// Node → what it feeds` header wherever the node changes;
 *   5. every node's names are renamed from its label (`circlesdf_3_d` → `circle_d`), slider
 *      uniforms from their slider labels (`u_p_circlesdfx3_radius` → `radius`), and
 *      u_time / u_resolution / u_mouse to time / resolution / mouse, avoiding clashes, GLSL
 *      keywords and builtins.
 * Renaming is a whole-token, whole-program substitution onto names that appear nowhere else, so it
 * cannot change meaning. Steps 1–4 never reorder statements. Exact (the compiled code) is still what
 * runs; this is for reading and copying.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export interface ReadableMeta {
  /** The compiled (root) graph's nodes. */
  nodes: GraphNode[];
  /** nodeId → slug, from the compile (CompilationResult.nodeSlugMap). */
  nodeSlugMap: Map<string, string>;
  /** `${nodeId}::${paramKey}` → uniform, from the compile (CompilationResult.paramBindings). */
  paramBindings?: Record<string, string>;
  /** nodeId → { output → GLSL expression }, from the compile (CompilationResult.nodeOutputVars). */
  nodeOutputVars?: Map<string, Record<string, string>>;
}

export interface ReadableResult {
  code: string;
  /** Per line of `code`: the root graph node it belongs to, or null. */
  lineNodes: (string | null)[];
  /** Per line of `code`: the same line before renaming (Exact names), for slug-based highlighting. */
  sourceLines: string[];
  /** Exact name → Readable name for every renamed identifier. */
  renames: Map<string, string>;
}

// ── GLSL words a name must never become ─────────────────────────────────────────────────────────

const KEYWORDS = `attribute const uniform varying break continue do for while if else in out inout float int uint void bool true false
lowp mediump highp precision invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4 sampler2D samplerCube sampler3D sampler2DArray sampler2DShadow
isampler2D usampler2D struct layout centroid flat smooth switch case default asm class union enum typedef template this packed goto
inline noinline volatile public static extern external interface long short double half fixed unsigned superp input output
hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler1D sampler1DShadow sampler2DRect sampler3DRect sampler2DRectShadow
sizeof cast namespace using resource patch sample subroutine common partition active filter image buffer shared coherent restrict readonly writeonly
main`;
const BUILTINS = `radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt abs sign
floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf floatBitsToInt floatBitsToUint
intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16 length
distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan
lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture texture2D texture2DProj texture2DLod
texture2DProjLod textureCube textureCubeLod texture2DLodEXT texture2DGradEXT textureLod textureProj textureOffset texelFetch
texelFetchOffset textureGrad textureSize dFdx dFdy fwidth`;
const RESERVED = new Set(`${KEYWORDS} ${BUILTINS}`.split(/\s+/).filter(Boolean));

/** Is `name` safe as a new identifier (not a keyword/builtin, not gl_, no double underscore, a valid name)? */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name) && !name.startsWith('gl_') && !name.includes('__');
}
const isBuiltinCall = (name: string) => RESERVED.has(name);

// ── Tokens (whitespace and comments kept, so code prints back exactly) ─────────────────────────

type Kind = 'ws' | 'comment' | 'num' | 'id' | 'op';
interface Tok { k: Kind; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\s+)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\d+\.\d*(?:[eE][-+]?\d+)?[fF]?|\.\d+(?:[eE][-+]?\d+)?[fF]?|0[xX][0-9a-fA-F]+[uU]?|\d+(?:[eE][-+]?\d+)?[uU]?)|([A-Za-z_]\w*)|(\+\+|--|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\|=|\^=|==|!=|<=|>=|&&|\|\||\^\^|<<|>>|[\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ k: 'ws', v: m[1] });
    else if (m[2]) out.push({ k: 'comment', v: m[2] });
    else if (m[3]) out.push({ k: 'num', v: m[3] });
    else if (m[4]) out.push({ k: 'id', v: m[4] });
    else out.push({ k: 'op', v: m[5] });
  }
  return out;
}
const join = (t: Tok[]) => t.map(x => x.v).join('');
const sig = (t: Tok) => t.k !== 'ws' && t.k !== 'comment';
function nextSig(t: Tok[], i: number): number { for (let j = i + 1; j < t.length; j++) if (sig(t[j])) return j; return -1; }
function prevSig(t: Tok[], i: number): number { for (let j = i - 1; j >= 0; j--) if (sig(t[j])) return j; return -1; }

const TYPE_WORDS = new Set('float int uint bool void vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4 mat2 mat3 mat4 sampler2D samplerCube'.split(' '));
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=', '++', '--']);

/** Is the identifier at `i` written to (an lvalue: `x =`, `x.y +=`, `x++`, `++x`, `x[0] =`)? */
function isWritten(t: Tok[], i: number): boolean {
  const p = prevSig(t, i);
  if (p >= 0 && (t[p].v === '++' || t[p].v === '--')) return true;
  let j = nextSig(t, i);
  while (j >= 0) {
    if (t[j].v === '.') { j = nextSig(t, nextSig(t, j)); continue; }
    if (t[j].v === '[') { let d = 0; for (; j < t.length; j++) { if (t[j].v === '[') d++; else if (t[j].v === ']' && --d === 0) break; } j = nextSig(t, j); continue; }
    break;
  }
  return j >= 0 && ASSIGN_OPS.has(t[j].v);
}

/** Is the identifier at `i` an entire argument of a user-defined function call (which may be `out`/`inout`)? */
function isUserCallArg(t: Tok[], i: number): boolean {
  const p = prevSig(t, i), n = nextSig(t, i);
  if (p < 0 || n < 0) return false;
  if (!(t[p].v === '(' || t[p].v === ',') || !(t[n].v === ')' || t[n].v === ',')) return false;
  // Find the call's opening paren.
  let d = 0, j = i - 1;
  for (; j >= 0; j--) {
    const v = t[j].v;
    if (v === ')' || v === ']') d++;
    else if (v === '(' || v === '[') { if (d === 0) break; d--; }
  }
  if (j < 0 || t[j].v !== '(') return false;
  const f = prevSig(t, j);
  return f >= 0 && t[f].k === 'id' && !isBuiltinCall(t[f].v) && !TYPE_WORDS.has(t[f].v);
}

// ── Helper functions main() never reaches ───────────────────────────────────────────────────────

interface FnSpan { name: string; start: number; end: number; body: [number, number] | null }

/** Top-level function definitions and prototypes, as token spans [start, end). */
function topLevelFunctions(t: Tok[]): FnSpan[] {
  const out: FnSpan[] = [];
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const v = t[i].v;
    if (v === '{') { depth++; continue; }
    if (v === '}') { depth--; continue; }
    if (depth !== 0 || t[i].k !== 'id') continue;
    const open = nextSig(t, i);
    if (open < 0 || t[open].v !== '(') continue;
    const ty = prevSig(t, i);
    if (ty < 0 || t[ty].k !== 'id') continue;
    // The declaration starts at its line (return type and qualifiers).
    let start = ty;
    while (start > 0 && !(t[start - 1].k === 'ws' && t[start - 1].v.includes('\n')) && t[start - 1].v !== ';' && t[start - 1].v !== '}') start--;
    let d = 0, j = open;
    for (; j < t.length; j++) { if (t[j].v === '(') d++; else if (t[j].v === ')' && --d === 0) break; }
    const after = nextSig(t, j);
    if (after < 0) break;
    if (t[after].v === ';') { out.push({ name: t[i].v, start, end: after + 1, body: null }); i = after; continue; }
    if (t[after].v !== '{') continue;
    let b = 0, k = after;
    for (; k < t.length; k++) { if (t[k].v === '{') b++; else if (t[k].v === '}' && --b === 0) break; }
    out.push({ name: t[i].v, start, end: k + 1, body: [after, k + 1] });
    i = k;
  }
  return out;
}

/** Drop helper functions (and their prototypes) that main(), global initialisers and macros never reach. */
export function dropUnusedFunctions(code: string): string {
  const t = tokenize(code);
  const fns = topLevelFunctions(t);
  if (!fns.some(f => f.name === 'main')) return code;
  const inFn = new Uint8Array(t.length);
  for (const f of fns) for (let i = f.start; i < f.end; i++) inFn[i] = 1;
  const idsIn = (a: number, b: number) => { const s = new Set<string>(); for (let i = a; i < b; i++) if (t[i].k === 'id') s.add(t[i].v); return s; };
  const bodies = new Map<string, Set<string>>();
  for (const f of fns) {
    const s = bodies.get(f.name) ?? new Set<string>();
    for (const id of idsIn(f.start, f.end)) if (id !== f.name) s.add(id);
    bodies.set(f.name, s);
  }
  const live = new Set<string>(['main']);
  // Code outside functions (globals, #define lines) roots whatever it names.
  for (let i = 0; i < t.length; i++) if (!inFn[i] && t[i].k === 'id' && bodies.has(t[i].v)) live.add(t[i].v);
  const queue = [...live];
  while (queue.length) {
    const n = queue.pop()!;
    for (const id of bodies.get(n) ?? []) if (bodies.has(id) && !live.has(id)) { live.add(id); queue.push(id); }
  }
  const drop = new Uint8Array(t.length);
  for (const f of fns) if (!live.has(f.name)) {
    // Its doc comment goes with it: `//` lines directly above (no blank line between).
    let start = f.start;
    for (;;) {
      const nl = start - 1, c = start - 2;
      if (c < 0 || t[nl].k !== 'ws' || (t[nl].v.match(/\n/g) ?? []).length !== 1) break;
      // A section rule (`// ── Helpers ──`) is not the function's own comment.
      if (t[c].k !== 'comment' || !t[c].v.startsWith('//') || t[c].v.startsWith('// ──')) break;
      const before = c - 1;
      if (before >= 0 && !(t[before].k === 'ws' && t[before].v.includes('\n'))) break;
      start = c;
    }
    for (let i = start; i < f.end; i++) drop[i] = 1;
    // …and the rest of its last line.
    let j = f.end;
    while (j < t.length && t[j].k === 'ws' && !t[j].v.includes('\n')) drop[j++] = 1;
    if (j < t.length && t[j].k === 'ws') { t[j] = { k: 'ws', v: t[j].v.replace(/^[^\n]*\n/, '') }; }
  }
  return t.filter((_, i) => !drop[i]).map(x => x.v).join('');
}

// ── Inline single-use pure copies ───────────────────────────────────────────────────────────────

/** The token range of main()'s body (inside its braces), or null. */
function mainBody(t: Tok[]): [number, number] | null {
  const f = topLevelFunctions(t).find(x => x.name === 'main' && x.body);
  return f?.body ? [f.body[0] + 1, f.body[1] - 1] : null;
}

/**
 * Fold `T name = src;` into the one place `name` is read, where src is a plain name (optionally
 * swizzled) or a non-negative number, at the top level of main(). Conservative: skipped when the
 * name or the source is ever written afterwards, passed whole to a user function (it may be inout),
 * declared more than once, or the declaration shares its line with anything else.
 */
export function inlineTrivialCopies(code: string): string {
  for (let pass = 0; pass < 8; pass++) {
    const next = inlineOnce(code);
    if (next === code) return code;
    code = next;
  }
  return code;
}

function inlineOnce(code: string): string {
  const t = tokenize(code);
  const body = mainBody(t);
  if (!body) return code;
  const occ = new Map<string, number[]>();
  const afterDot = new Set<string>();
  for (let i = 0; i < t.length; i++) if (t[i].k === 'id') {
    const p = prevSig(t, i);
    if (p >= 0 && t[p].v === '.') { afterDot.add(t[i].v); continue; }
    (occ.get(t[i].v) ?? occ.set(t[i].v, []).get(t[i].v)!).push(i);
  }
  const declCount = (name: string) => (occ.get(name) ?? []).filter(i => { const p = prevSig(t, i); return p >= 0 && (TYPE_WORDS.has(t[p].v) || (t[p].k === 'id' && !RESERVED.has(t[p].v) && /^[A-Z]/.test(t[p].v))); }).length;
  let depth = 0;
  let stmtStart = true;
  for (let i = body[0]; i < body[1]; i++) {
    const v = t[i].v;
    if (!sig(t[i])) continue;
    if (v === '{') { depth++; stmtStart = true; continue; }
    if (v === '}') { depth--; stmtStart = true; continue; }
    if (v === ';') { stmtStart = true; continue; }
    if (!stmtStart) continue;
    stmtStart = false;
    if (depth !== 0) continue;
    // [const] TYPE name = INIT ;
    let a = i;
    if (t[a].v === 'const') a = nextSig(t, a);
    if (a < 0 || !TYPE_WORDS.has(t[a].v)) continue;
    const nameI = nextSig(t, a);
    if (nameI < 0 || t[nameI].k !== 'id') continue;
    const eq = nextSig(t, nameI);
    if (eq < 0 || t[eq].v !== '=') continue;
    const init: number[] = [];
    let j = nextSig(t, eq);
    while (j >= 0 && t[j].v !== ';' && t[j].v !== ',') { init.push(j); j = nextSig(t, j); }
    if (j < 0 || t[j].v !== ';') continue;
    const semi = j;
    const initText = init.map(x => t[x].v).join('');
    const isNum = init.length === 1 && t[init[0]].k === 'num';
    const isName = /^[A-Za-z_]\w*(\.[xyzwrgbastpq]{1,4})?$/.test(initText) && t[init[0]].k === 'id' && !RESERVED.has(t[init[0]].v);
    if (!isNum && !isName) continue;
    const name = t[nameI].v;
    if (afterDot.has(name) || name === 'main') continue;
    const uses = (occ.get(name) ?? []).filter(x => x !== nameI);
    if (uses.length !== 1 || declCount(name) !== 1) continue;
    const use = uses[0];
    if (use < semi || use >= body[1]) continue;
    if (isWritten(t, use) || isUserCallArg(t, use)) continue;
    if (isName) {
      const src = t[init[0]].v;
      if (afterDot.has(src) && occ.get(src) === undefined) continue;
      if (declCount(src) > 1) continue;
      const touched = (occ.get(src) ?? []).some(x => x > semi && x < body[1] && (isWritten(t, x) || isUserCallArg(t, x)));
      if (touched) continue;
    }
    // The declaration must sit alone on its line (no trailing comment or second statement).
    let ls = i; while (ls > 0 && !(t[ls - 1].k === 'ws' && t[ls - 1].v.includes('\n'))) { if (sig(t[ls - 1])) break; ls--; }
    if (ls > 0 && !(t[ls - 1].k === 'ws' && t[ls - 1].v.includes('\n'))) continue;
    const after = semi + 1;
    if (after < t.length && !(t[after].k === 'ws' && t[after].v.includes('\n'))) continue;
    // Splice: the use becomes the source text; the declaration line goes.
    const out = t.slice();
    out[use] = { k: 'id', v: initText };
    for (let x = ls; x <= semi; x++) out[x] = { k: 'ws', v: '' };
    out[after] = { k: 'ws', v: t[after].v.replace(/^[^\n]*\n/, '') };
    // Drop the declaration line's own leading indent (part of the previous newline token).
    if (ls > 0) out[ls - 1] = { k: 'ws', v: t[ls - 1].v.replace(/[ \t]*$/, '') };
    return join(out);
  }
  return code;
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────

/** `1.00000` → `1.0`, `0.250` → `0.25`; other literals as written. */
export function trimFloat(lit: string): string {
  const m = /^(\d+)\.(\d+)$/.exec(lit);
  if (!m) return lit;
  const frac = m[2].replace(/0+$/, '');
  return `${m[1]}.${frac || '0'}`;
}

/** Single spaces inside lines, 4-space indents by brace depth, trimmed floats, at most one blank line. */
export function tidy(code: string): string {
  const lines = code.split('\n');
  const out: string[] = [];
  let depth = 0, paren = 0;
  let inBlockComment = false;
  for (const raw of lines) {
    if (inBlockComment) { out.push(raw); if (raw.includes('*/')) inBlockComment = false; continue; }
    const line = raw.trim();
    if (!line) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (line.startsWith('#')) { out.push(line); continue; }
    const t = tokenize(line);
    // Collapse runs of spaces between tokens, trim floats.
    const parts: string[] = [];
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      if (x.k === 'ws') { parts.push(' '); continue; }
      if (x.k === 'num') { parts.push(trimFloat(x.v)); continue; }
      parts.push(x.v);
    }
    const body = parts.join('').trim();
    const startsClose = /^[}\]]/.test(body) || /^\)/.test(body);
    const ind = Math.max(0, depth - (body.startsWith('}') ? 1 : 0)) + (paren > 0 && !startsClose ? 1 : 0);
    out.push('    '.repeat(ind) + body);
    for (const x of t) {
      if (x.k === 'comment' && x.v.startsWith('/*') && !x.v.endsWith('*/')) inBlockComment = true;
      if (!sig(x)) continue;
      if (x.v === '{') depth++;
      else if (x.v === '}') depth = Math.max(0, depth - 1);
      else if (x.v === '(') paren++;
      else if (x.v === ')') paren = Math.max(0, paren - 1);
    }
    if (/\/\*/.test(line) && !/\*\//.test(line.slice(line.indexOf('/*')))) inBlockComment = true;
  }
  // A section title whose section is now empty (its helpers were left out) goes with its closing rule.
  for (let i = out.length - 2; i >= 0; i--) {
    if (/^\/\/ ─+ .+ ─+$/.test(out[i]) && /^\/\/ ─+$/.test(out[i + 1])) {
      out.splice(i, 2);
      if (out[i] === '' && (i === 0 || out[i - 1] === '')) out.splice(i, 1);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

// ── Ownership: which node a name, a line, a statement belongs to ───────────────────────────────

interface Owners {
  /** identifier → root node id */
  of: (id: string) => string | null;
  rootSlugs: Array<[string, string]>; // [slug, nodeId], longest first
  outputId: string | null;
}

function buildOwners(meta: ReadableMeta): Owners {
  const rootIds = new Set(meta.nodes.map(n => n.id));
  const slugToNode = new Map<string, string>();
  for (const [id, slug] of meta.nodeSlugMap) if (rootIds.has(id)) slugToNode.set(slug, id);
  const rootSlugs = [...slugToNode].sort((a, b) => b[0].length - a[0].length);
  // Inner (group) nodes fold onto the root node whose slug their own slug extends.
  const toRoot = (nodeId: string): string | null => {
    if (rootIds.has(nodeId)) return nodeId;
    const s = meta.nodeSlugMap.get(nodeId);
    if (!s) return null;
    for (const [rs, rid] of rootSlugs) if (s.startsWith(`${rs}_`)) return rid;
    return null;
  };
  const exact = new Map<string, string>();
  for (const [nodeId, outs] of meta.nodeOutputVars ?? []) {
    const root = toRoot(nodeId);
    if (!root) continue;
    for (const v of Object.values(outs)) if (/^[A-Za-z_]\w*$/.test(v) && !exact.has(v)) exact.set(v, root);
  }
  for (const [key, uni] of Object.entries(meta.paramBindings ?? {})) {
    const root = toRoot(key.split('::')[0]);
    if (root && !exact.has(uni)) exact.set(uni, root);
  }
  const cache = new Map<string, string | null>();
  const of = (id: string): string | null => {
    if (cache.has(id)) return cache.get(id)!;
    let r: string | null = exact.get(id) ?? null;
    if (!r) for (const [s, nid] of rootSlugs) if (id === s || id.startsWith(`${s}_`)) { r = nid; break; }
    cache.set(id, r);
    return r;
  };
  const outs = meta.nodes.filter(n => n.type === 'output' || n.type === 'vec4Output');
  return { of, rootSlugs, outputId: outs.length === 1 ? outs[0].id : null };
}

/** The first node-owned identifier on a line, or null; the line that writes the picture is the Output's. */
function lineOwner(line: string, owners: Owners): string | null {
  if (owners.outputId && /^\s*gl_FragColor\s*=/.test(line)) return owners.outputId;
  const re = /(\/\/.*$)|([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  let prevDot = false;
  while ((m = re.exec(line))) {
    if (m[1]) break;
    const before = line.slice(0, m.index).trimEnd();
    prevDot = before.endsWith('.');
    if (prevDot) continue;
    const o = owners.of(m[2]);
    if (o) return o;
  }
  return null;
}

/** The node whose name a line declares or assigns (`float a = …`, `a.x += …`), or null. */
function writeOwner(line: string, owners: Owners): string | null {
  if (owners.outputId && /^\s*gl_FragColor\s*=/.test(line)) return owners.outputId;
  const re = /(?:^|[^.\w])([A-Za-z_]\w*)(?:\.[xyzwrgbastpq]{1,4}|\[[^\]]*\])?\s*(?:[-+*/]?=)(?!=)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const o = owners.of(m[1]);
    if (o) return o;
  }
  return null;
}

/** Per line: the root node each line of a shader belongs to (its first node-owned name, else the enclosing block's). */
export function shaderLineNodes(code: string, meta: ReadableMeta): (string | null)[] {
  const owners = buildOwners(meta);
  return linesWithOwners(code.split('\n'), owners).map(x => x.owner);
}

interface LineInfo { owner: string | null; depth: number; depthAfter: number; stmtStart: boolean }

function linesWithOwners(lines: string[], owners: Owners): LineInfo[] {
  const out: LineInfo[] = [];
  let depth = 0;
  let blockOwner: string | null = null;
  let continuing = false;
  const writes = lines.map(l => writeOwner(l.replace(/\/\/.*$/, ''), owners));
  for (let li = 0; li < lines.length; li++) {
    const code = lines[li].replace(/\/\/.*$/, '');
    const trimmed = code.trim();
    let own = trimmed ? writes[li] ?? lineOwner(code, owners) : null;
    // `if (…) {` / `for (…) {` belongs to the node whose variable its block writes.
    if (trimmed && !writes[li] && /^(if|else|for|while|do)\b|^\{/.test(trimmed) && depth <= 1) {
      let d = depth;
      for (let k = li; k < lines.length; k++) {
        if (k > li && writes[k]) { own = writes[k]; break; }
        for (const ch of lines[k].replace(/\/\/.*$/, '')) { if (ch === '{') d++; else if (ch === '}') d--; }
        if (k > li && d <= depth) break;
      }
    }
    const stmtStart = !continuing && trimmed !== '' && !trimmed.startsWith('}') && !trimmed.startsWith('#');
    const startDepth = depth;
    if (startDepth <= 1 && stmtStart) blockOwner = own;
    for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
    out.push({ owner: own ?? (startDepth >= 1 && trimmed ? blockOwner : null), depth: startDepth, depthAfter: depth, stmtStart });
    if (trimmed) continuing = !/[;{}]\s*$/.test(trimmed) && !trimmed.startsWith('#');
    if (depth === 0) blockOwner = null;
  }
  return out;
}

// ── Names ───────────────────────────────────────────────────────────────────────────────────────

/** A label as a lower-case identifier fragment (`Circle SDF` → `circle_sdf`); camelCase titles kept. */
export function labelToName(label: string): string {
  const s = label.trim();
  if (/^[a-z][A-Za-z0-9]*$/.test(s) && /[A-Z]/.test(s) && s.length <= 24) return s;
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/g, '')
    .slice(0, 20)
    .replace(/_+$/g, '');
}

export function nodeDisplayLabel(node: GraphNode): string {
  const own = typeof node.params?.label === 'string' ? node.params.label.trim() : '';
  if (own) return own;
  return getNodeDefinition(node.type)?.label ?? node.type;
}

function paramLabel(node: GraphNode | undefined, key: string): string {
  if (!node) return key;
  const def = getNodeDefinition(node.type);
  const defs = def?.paramDefsFor?.(node) ?? def?.paramDefs;
  const l = defs?.[key]?.label;
  return typeof l === 'string' && l.trim() ? l : key;
}

/**
 * Exact name → Readable name. Deterministic: candidates are tried in a fixed order and nodes are
 * numbered in order of first appearance in the code. Every new name is unique, safe, and appears
 * nowhere in the program already.
 */
export function buildRenames(code: string, meta: ReadableMeta): Map<string, string> {
  const t = tokenize(code);
  const order: string[] = [];
  const seen = new Set<string>();
  const afterDot = new Set<string>();
  for (let i = 0; i < t.length; i++) if (t[i].k === 'id') {
    const p = prevSig(t, i);
    if (p >= 0 && t[p].v === '.') { afterDot.add(t[i].v); continue; }
    if (!seen.has(t[i].v)) { seen.add(t[i].v); order.push(t[i].v); }
  }
  const owners = buildOwners(meta);
  const byId = new Map(meta.nodes.map(n => [n.id, n]));
  // Node bases, numbered in order of first appearance.
  const nodeBase = new Map<string, string>();
  const baseCount = new Map<string, number>();
  const slugOf = new Map(owners.rootSlugs.map(([s, id]) => [id, s]));
  const assignBase = (nodeId: string) => {
    if (nodeBase.has(nodeId)) return nodeBase.get(nodeId)!;
    const node = byId.get(nodeId);
    let base = labelToName(node ? nodeDisplayLabel(node) : '') || 'node';
    if (!/^[A-Za-z]/.test(base)) base = `n_${base}`;
    const n = (baseCount.get(base) ?? 0) + 1;
    baseCount.set(base, n);
    const b = n === 1 ? base : /\d$/.test(base) ? `${base}_${n}` : `${base}${n}`;
    nodeBase.set(nodeId, b);
    return b;
  };
  for (const id of order) { const o = owners.of(id); if (o && slugOf.has(o)) assignBase(o); }
  // A base that equals another node's numbered base (`layer2` the label vs the second `layer`) is fine:
  // final names are checked against each other below.

  const uniformOf = new Map<string, { nodeId: string; key: string }>();
  for (const [k, uni] of Object.entries(meta.paramBindings ?? {})) {
    const [nodeId, key] = k.split('::');
    uniformOf.set(uni, { nodeId, key });
  }
  const paramWant = new Map<string, string>();
  for (const id of order) {
    const u = uniformOf.get(id);
    if (!u) continue;
    const root = owners.of(id);
    paramWant.set(id, labelToName(paramLabel(byId.get(u.nodeId) ?? (root ? byId.get(root) : undefined), u.key)) || labelToName(u.key) || 'param');
  }
  const wantCount = new Map<string, number>();
  for (const w of paramWant.values()) wantCount.set(w, (wantCount.get(w) ?? 0) + 1);

  const candidates = (id: string): string[] => {
    if (id === 'u_time') return ['time', 'iTime'];
    if (id === 'u_resolution') return ['resolution'];
    if (id === 'u_mouse') return ['mouse'];
    if (paramWant.has(id)) {
      const w = paramWant.get(id)!;
      const root = owners.of(id);
      const nb = root ? nodeBase.get(root) ?? assignBase(root) : null;
      const pref = nb ? `${nb}_${w}` : `u_${w}`;
      // A one- or two-letter slider (`R`, `B`) reads better with its node's name.
      return (wantCount.get(w) ?? 0) > 1 || w.length < 3 ? [pref] : [w, pref];
    }
    // Node names: replace the node's slug (wherever it sits on segment boundaries) with its base.
    let changed = false;
    let out = id;
    for (const [slug, nid] of owners.rootSlugs) {
      const base = nodeBase.get(nid);
      if (!base) continue;
      const re = new RegExp(`(^|_)${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=_|$)`);
      if (re.test(out)) { out = out.replace(re, (_m, pre) => `${pre}${base}`); changed = true; break; }
    }
    if (!changed) return [];
    // `uv_uv` → `uv`, `time_time` → `time`.
    const dup = /^([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)_\1$/.exec(out);
    return dup ? [dup[1], out] : [out];
  };

  const taken = new Set(order.concat([...afterDot]));
  const renames = new Map<string, string>();
  const assigned = new Set<string>();
  for (const id of order) {
    if (afterDot.has(id)) continue;
    if (RESERVED.has(id) || id.startsWith('gl_')) continue;
    const cands = candidates(id);
    if (!cands.length) continue;
    let pick: string | null = null;
    for (const c of cands) {
      const name = c.replace(/__+/g, '_');
      if (name === id) { pick = id; break; }
      if (isSafeName(name) && !taken.has(name) && !assigned.has(name)) { pick = name; break; }
    }
    if (!pick) {
      const base = cands[cands.length - 1].replace(/__+/g, '_').replace(/_+$/, '');
      for (let n = 2; n < 1000; n++) {
        const name = `${base}_${n}`;
        if (isSafeName(name) && !taken.has(name) && !assigned.has(name)) { pick = name; break; }
      }
    }
    if (!pick || pick === id) continue;
    renames.set(id, pick);
    assigned.add(pick);
  }
  return renames;
}

function applyRenames(code: string, renames: Map<string, string>): string {
  if (!renames.size) return code;
  const t = tokenize(code);
  for (let i = 0; i < t.length; i++) {
    if (t[i].k !== 'id') continue;
    const r = renames.get(t[i].v);
    if (!r) continue;
    const p = prevSig(t, i);
    if (p >= 0 && t[p].v === '.') continue;
    t[i] = { k: 'id', v: r };
  }
  return join(t);
}

// ── Node headers ────────────────────────────────────────────────────────────────────────────────

function feedsOf(nodeId: string, nodes: GraphNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.id === nodeId) continue;
    if (Object.values(n.inputs ?? {}).some(s => s?.connection?.nodeId === nodeId)) {
      const l = nodeDisplayLabel(n);
      if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

function headerFor(nodeId: string, meta: ReadableMeta): string {
  const node = meta.nodes.find(n => n.id === nodeId);
  if (!node) return '';
  const label = nodeDisplayLabel(node).replace(/\s+/g, ' ');
  if (node.type === 'output' || node.type === 'vec4Output') return `// ${label} → screen`;
  const feeds = feedsOf(nodeId, meta.nodes);
  const shown = feeds.length > 3 ? `${feeds.slice(0, 3).join(', ')} +${feeds.length - 3}` : feeds.join(', ');
  return shown ? `// ${label} → ${shown}` : `// ${label}`;
}

/** Insert a header before each run of main()'s top-level statements that belong to one node. */
function addHeaders(code: string, meta: ReadableMeta): { lines: string[]; owners: (string | null)[] } {
  const owners = buildOwners(meta);
  const lines = code.replace(/\n$/, '').split('\n');
  const info = linesWithOwners(lines, owners);
  const out: string[] = [];
  const outOwners: (string | null)[] = [];
  const push = (l: string, o: string | null) => { out.push(l); outOwners.push(o); };
  let inMain = false;
  let current: string | null = null;
  let pending: string[] = []; // comment / blank lines waiting for their statement
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const { owner, depth, depthAfter, stmtStart } = info[i];
    if (!inMain) {
      push(line, owner);
      if (depth === 0 && /^void\s+main\s*\(/.test(trimmed) && depthAfter === 1) { inMain = true; current = null; }
      continue;
    }
    if (depth === 1 && depthAfter === 0) {
      for (const p of pending) push(p, null);
      pending = [];
      push(line, null);
      inMain = false;
      continue;
    }
    if (depth !== 1) { push(line, owner); continue; }
    if (trimmed === '' || trimmed.startsWith('//')) { pending.push(line); continue; }
    if (stmtStart && owner && owner !== current) {
      // Blank line, header, then the comments that were waiting.
      while (out.length && out[out.length - 1].trim() === '') { out.pop(); outOwners.pop(); }
      pending = pending.filter(l => l.trim() !== '');
      const head = headerFor(owner, meta);
      if (head) {
        if (out.length && !/\{\s*$/.test(out[out.length - 1])) push('', null);
        push('    ' + head, owner);
      }
      current = owner;
    }
    const own = owner ?? (stmtStart ? null : current);
    for (const p of pending) push(p, p.trim() ? own : null);
    pending = [];
    push(line, own);
  }
  for (const p of pending) push(p, null);
  return { lines: out, owners: outOwners };
}

// ── The whole transform ─────────────────────────────────────────────────────────────────────────

export function readableGlsl(code: string, meta: ReadableMeta): ReadableResult {
  let c = dropUnusedFunctions(code);
  c = inlineTrivialCopies(c);
  c = tidy(c);
  const { lines, owners } = addHeaders(c, meta);
  const sourceLines = lines;
  const before = lines.join('\n') + '\n';
  const renames = buildRenames(before, meta);
  const after = applyRenames(before, renames);
  const outLines = after.replace(/\n$/, '').split('\n');
  return { code: after, lineNodes: owners.slice(0, outLines.length), sourceLines, renames };
}
