/**
 * codeSource.ts — a node type written directly as GLSL.
 *
 * The user pastes one or more functions. One of them is the entry point: its
 * return value is the node's first output, its `in` parameters are the node's
 * inputs (a `sampler2D` becomes an image slot, a `float` can carry a slider),
 * and its `out` parameters are extra outputs. Every other function is a
 * helper that travels with the node.
 *
 * At publish time all of the user's functions are renamed under the node's
 * unique id, so two published nodes that both define `hash3` never collide
 * with each other or with a built-in helper (the assembler de-duplicates
 * helpers by name, first definition wins — silently).
 */

import type { DataType } from '../../types/nodeGraph';

export interface CodeParam {
  type: string;
  name: string;
  /** `out` / `inout` parameters become outputs of the node. */
  qualifier: 'in' | 'out' | 'inout';
}

export interface CodeFunction {
  name: string;
  returnType: string;
  params: CodeParam[];
  /** The complete function text, header through closing brace. */
  text: string;
  /** Offsets of `text` within the source. */
  start: number;
  end: number;
}

export type ParseCodeResult =
  /** `globals` is every top-level line that isn't a function: #defines, consts, globals, structs. */
  | { ok: true; functions: CodeFunction[]; globals: string }
  | { ok: false; error: string };

const HEADER_RE = /\b(void|float|vec[234]|int|bool|mat[234]|ivec[234]|bvec[234])\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
const QUALIFIERS = new Set(['in', 'out', 'inout', 'const', 'highp', 'mediump', 'lowp']);
const KEYWORDS = new Set(['if', 'for', 'while', 'do', 'switch', 'return', 'main']);

/** Types a socket can carry. `sampler2D` is handled separately as an image slot. */
export const SOCKET_TYPES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);
export const OUTPUT_TYPES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** Blank out line and block comments so signatures inside them aren't picked up (offsets stay stable). */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
}

export function parseCodeSource(code: string): ParseCodeResult {
  const src = blankComments(code);
  const functions: CodeFunction[] = [];
  HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_RE.exec(src))) {
    const [, returnType, name, paramStr] = m;
    if (KEYWORDS.has(name)) continue;
    // Match the closing brace of the body.
    let depth = 0; let i = m.index + m[0].length - 1; let end = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) return { ok: false, error: `Function "${name}" is missing its closing brace.` };
    const params: CodeParam[] = [];
    if (paramStr.trim()) {
      for (const part of paramStr.split(',')) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const qualifier = tokens.includes('inout') ? 'inout' : tokens.includes('out') ? 'out' : 'in';
        const cleaned = tokens.filter(t => !QUALIFIERS.has(t));
        const type = cleaned[0];
        const pname = (cleaned[1] ?? '').replace(/\[.*$/, '');
        if (!type || !pname) return { ok: false, error: `Couldn't read a parameter of "${name}": "${part.trim()}".` };
        params.push({ type, name: pname, qualifier });
      }
    }
    functions.push({ name, returnType, params, text: code.slice(m.index, end), start: m.index, end });
    HEADER_RE.lastIndex = end;
  }
  if (functions.length === 0) return { ok: false, error: 'No GLSL function found. Write something like `vec3 glow(vec2 uv, float radius) { … }`.' };
  // Everything between the functions, comments removed. Precision statements belong to the
  // host shader and are dropped; the rest (#define, const, globals, struct) travels with the node.
  let globals = '';
  let cursor = 0;
  for (const f of functions) { globals += src.slice(cursor, f.start) + '\n'; cursor = f.end; }
  globals += src.slice(cursor);
  globals = globals.split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => l.trim() && !/^\s*precision\s+\w+\s+\w+\s*;/.test(l) && !/^\s*#\s*(version|extension)\b/.test(l))
    .join('\n');
  return { ok: true, functions, globals };
}

/** Split on commas that aren't inside parentheses or brackets (`vec2 a = vec2(1., 2.), b;`). */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Names declared by a globals block: macros, structs, consts and global variables. */
export function globalNames(globals: string): string[] {
  const names = new Set<string>();
  for (const m of globals.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)) names.add(m[1]);
  for (const m of globals.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) names.add(m[1]);
  const statements = globals
    .replace(/^\s*#[^\n]*$/gm, '')          // preprocessor lines are not declarations
    .replace(/\bstruct\s+\w+\s*\{[^}]*\}/g, '') // nor are struct bodies
    .split(';');
  for (const st of statements) {
    const tokens = st.trim().replace(/\b(const|uniform|varying|attribute|lowp|mediump|highp|in|out)\b/g, ' ').trim();
    const m = /^([A-Za-z_]\w*)\s+([\s\S]+)$/.exec(tokens);
    if (!m) continue;
    for (const part of splitTopLevelCommas(m[2])) {
      const n = /^\s*([A-Za-z_]\w*)/.exec(part);
      if (n) names.add(n[1]);
    }
  }
  return [...names];
}

/** What the entry function would look like as a node. Pure validation; no renaming. */
export function describeEntry(fn: CodeFunction): { ok: true; inputs: CodeParam[]; textures: CodeParam[]; outs: CodeParam[] } | { ok: false; error: string } {
  if (fn.returnType === 'void') return { ok: false, error: `"${fn.name}" returns void. The entry function's return value is the node's output.` };
  if (!OUTPUT_TYPES.has(fn.returnType)) return { ok: false, error: `"${fn.name}" returns ${fn.returnType}; a node output must be float, vec2, vec3 or vec4.` };
  const inputs: CodeParam[] = []; const textures: CodeParam[] = []; const outs: CodeParam[] = [];
  for (const p of fn.params) {
    if (p.qualifier !== 'in') {
      if (!OUTPUT_TYPES.has(p.type)) return { ok: false, error: `out parameter "${p.name}" is ${p.type}; extra outputs must be float, vec2, vec3 or vec4.` };
      outs.push(p);
    } else if (p.type === 'sampler2D') {
      textures.push(p);
    } else if (SOCKET_TYPES.has(p.type)) {
      inputs.push(p);
    } else {
      return { ok: false, error: `Parameter "${p.name}" is ${p.type}. Inputs can be float, vec2, vec3, vec4, mat2, mat3 or sampler2D — use float for ints and bools.` };
    }
  }
  return { ok: true, inputs, textures, outs };
}

export interface RenamedCode {
  /** The entry function, renamed to `entryName` and with its header rewritten to the canonical order. */
  entryCode: string;
  /** Helper functions, renamed under the prefix. */
  helpers: string[];
  /** The source's top-level declarations with their names prefixed; emitted before the helpers. Empty when there are none. */
  preamble: string;
  /** Original name → new name. */
  renames: Record<string, string>;
}

/**
 * Rename every function under `prefix` and rewrite the entry header to the
 * canonical calling convention the node adapter uses:
 *   (sampler2D textures…, inputs…, out extras…)
 * Bodies are untouched except for calls to renamed functions.
 */
export function renameAndCanonicalise(
  functions: CodeFunction[],
  entryName: string,
  newEntryName: string,
  order: { textures: string[]; inputs: string[]; outs: string[] },
  globals = '',
): RenamedCode | { error: string } {
  const entry = functions.find(f => f.name === entryName);
  if (!entry) return { error: `Entry function "${entryName}" not found.` };
  const renames: Record<string, string> = {};
  for (const f of functions) renames[f.name] = f.name === entryName ? newEntryName : `${newEntryName}_h_${f.name}`;
  // Top-level names get the same treatment, so two imported shaders that both
  // `#define PI` or declare `const float scale` can sit in one graph.
  const globalRenames: Record<string, string> = {};
  for (const g of globalNames(globals)) if (!renames[g]) globalRenames[g] = `${newEntryName}_g_${g}`;

  const applyRenames = (text: string) => {
    let out = text;
    for (const [from, to] of Object.entries(renames)) out = out.replace(new RegExp(`\\b${from}\\s*\\(`, 'g'), `${to}(`);
    // Not after `.` (a swizzle or struct member of the same name) or inside a longer identifier.
    for (const [from, to] of Object.entries(globalRenames)) out = out.replace(new RegExp(`(?<![\\w.])${from}\\b`, 'g'), to);
    return out;
  };

  const byName = new Map(entry.params.map(p => [p.name, p]));
  const headerParams = [
    ...order.textures.map(n => `sampler2D ${n}`),
    ...order.inputs.map(n => `${byName.get(n)!.type} ${n}`),
    ...order.outs.map(n => `${byName.get(n)!.qualifier} ${byName.get(n)!.type} ${n}`),
  ];
  const bodyStart = entry.text.indexOf('{');
  const body = entry.text.slice(bodyStart);
  const entryCode = applyRenames(`${entry.returnType} ${newEntryName}(${headerParams.join(', ')}) ${body}`);
  const helpers = functions.filter(f => f.name !== entryName).map(f => applyRenames(f.text));
  const preamble = globals.trim() ? applyRenames(globals) : '';
  return { entryCode, helpers, preamble, renames: { ...renames, ...globalRenames } };
}

/** Best-effort DataType for a GLSL param type (callers validate first). */
export function toDataType(t: string): DataType {
  return t as DataType;
}
