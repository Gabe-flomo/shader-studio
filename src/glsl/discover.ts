/**
 * Function discovery — find reusable functions in GLSL text.
 *
 * Given saved shaders (or any GLSL), this reads every function definition,
 * works out what each one depends on, and offers the ones that stand on
 * their own as candidates for the Functions library:
 *
 *   - level 0: calls no other function in the file (a helper that does one thing)
 *   - level 1: calls only level-0 functions (a pair that together do one thing)
 *   - level n: calls something of level n−1
 *
 * A function that reads a global the file declares (a uniform other than the
 * Studio ones, a mutable global, a varying) is not self-contained: it needs
 * state the library can't carry, so it is marked and, by default, left out.
 * Object-like #defines it uses (PI, TAU, a tuning constant) are collected so
 * they can travel with it.
 *
 * Text in, plain data out; the modal does the choosing and the saving.
 */

import type { DataType } from '../types/nodeGraph';

export interface DiscoveredParam { type: string; name: string; qualifier: 'in' | 'out' | 'inout' }

export interface DiscoveredFn {
  /** Stable within one scan: `${sourceId}:${name}#${ordinal}` (overloads get ordinals). */
  id: string;
  sourceId: string;
  sourceName: string;
  name: string;
  returnType: string;
  params: DiscoveredParam[];
  /** `vec3 palette(float t)`, as written but on one line. */
  signature: string;
  /** The complete definition, header through closing brace, as in the file. */
  text: string;
  /** Offsets and 1-based lines in the source. */
  start: number; end: number; startLine: number; endLine: number;
  /** Names of functions in the same file that this one calls (not itself). */
  calls: string[];
  /** Every function this one needs, in definition order, excluding itself. */
  dependencies: DiscoveredFn[];
  /** 0 = calls nothing; otherwise 1 + the deepest dependency. -1 = recursive. */
  level: number;
  /** Globals the file declares that the body reads: uniforms (other than u_time/u_resolution/u_mouse), mutable globals, varyings, samplers. */
  globals: string[];
  /** `#define NAME value` lines the body (or a dependency's) uses, ready to prepend. */
  defines: string[];
  /** True when nothing outside the function (and its dependencies) is needed. */
  selfContained: boolean;
}

export interface DiscoverSource { id: string; name: string; code: string }

export interface DiscoverFilter {
  /** Return types to keep; empty = any. */
  returnTypes?: string[];
  /** Highest dependency level to keep; undefined = any. */
  maxLevel?: number;
  /** Parameter count bounds, inclusive. */
  minParams?: number;
  maxParams?: number;
  /** Every parameter must be one of these types; empty = any. */
  paramTypes?: string[];
  /** Keep functions that read the file's globals (default false). */
  allowGlobals?: boolean;
  /** Text that must appear in the function's name (case-insensitive). */
  nameContains?: string;
}

const TYPE_RE = 'float|int|bool|uint|vec[234]|ivec[234]|bvec[234]|uvec[234]|mat[234](?:x[234])?|void|sampler2D|samplerCube';
/** Uniforms the Studio shader always provides: a function that reads them still stands on its own. */
export const STUDIO_UNIFORMS = new Set(['u_time', 'u_resolution', 'u_mouse', 'gl_FragCoord', 'gl_FragColor']);
const KEYWORDS = new Set(['if', 'for', 'while', 'do', 'switch', 'return', 'else', 'discard', 'break', 'continue', 'true', 'false']);

/** Comments blanked to spaces (newlines kept), so braces and names inside them don't count and offsets still line up. */
export function blankComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i], n = s[i + 1];
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

const matchBrace = (s: string, open: number): number => { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return i; } return -1; };
const matchParen = (s: string, open: number): number => { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i; } return -1; };
const lineOf = (s: string, at: number): number => { let n = 1; for (let i = 0; i < at && i < s.length; i++) if (s[i] === '\n') n++; return n; };

function parseParams(text: string): DiscoveredParam[] {
  const t = text.trim();
  if (!t || t === 'void') return [];
  const parts: string[] = []; let depth = 0, cur = '';
  for (const c of t) { if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
  parts.push(cur);
  return parts.map((part, i) => {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    let qualifier: DiscoveredParam['qualifier'] = 'in';
    const rest: string[] = [];
    for (const tk of toks) {
      if (tk === 'in' || tk === 'out' || tk === 'inout') qualifier = tk;
      else if (tk === 'const' || tk === 'highp' || tk === 'mediump' || tk === 'lowp') continue;
      else rest.push(tk);
    }
    const type = rest[0] ?? 'float';
    const name = (rest[1] ?? `p${i}`).replace(/\[.*$/, '');
    return { type, name, qualifier };
  });
}

interface RawFn { name: string; returnType: string; params: DiscoveredParam[]; start: number; end: number; bodyOpen: number; text: string }

function rawFunctions(code: string, blanked: string): RawFn[] {
  const out: RawFn[] = [];
  const re = new RegExp(`(^|[;}\\n])[ \\t]*(?:(?:highp|mediump|lowp)\\s+)?(${TYPE_RE})\\s+([A-Za-z_]\\w*)\\s*\\(`, 'g');
  for (const m of blanked.matchAll(re)) {
    const name = m[3];
    if (KEYWORDS.has(name)) continue;
    const start = m.index! + m[1].length + (m[0].slice(m[1].length).match(/^[ \t]*/)?.[0].length ?? 0);
    const parenOpen = m.index! + m[0].length - 1;
    const parenClose = matchParen(blanked, parenOpen); if (parenClose < 0) continue;
    const after = blanked.slice(parenClose + 1).match(/^\s*\{/); if (!after) continue; // a prototype
    const bodyOpen = parenClose + 1 + after[0].length - 1;
    const end = matchBrace(blanked, bodyOpen); if (end < 0) continue;
    out.push({ name, returnType: m[2], params: parseParams(blanked.slice(parenOpen + 1, parenClose)), start, end: end + 1, bodyOpen, text: code.slice(start, end + 1) });
  }
  return out;
}

/** Top-level names the file declares that a function may lean on: uniforms, varyings, mutable globals, samplers. Const globals and #defines are handled separately. */
function fileGlobals(blanked: string, fns: RawFn[]): Set<string> {
  const inFn = (i: number) => fns.some(f => i > f.bodyOpen && i < f.end);
  const names = new Set<string>();
  const re = new RegExp(`(^|[;}\\n])[ \\t]*((?:uniform|varying|attribute|in|out)\\s+)?(?:(?:highp|mediump|lowp)\\s+)?(?:${TYPE_RE})\\s+([^;{}()]*);`, 'g');
  for (const m of blanked.matchAll(re)) {
    const at = m.index! + m[1].length;
    if (inFn(at)) continue;
    if (/\bconst\s*$/.test(blanked.slice(Math.max(0, at - 8), at))) continue;
    for (const decl of m[3].split(',')) {
      const nm = decl.trim().match(/^([A-Za-z_]\w*)/)?.[1];
      if (nm && !STUDIO_UNIFORMS.has(nm)) names.add(nm);
    }
  }
  return names;
}

/** Object-like macros: name → the whole line. */
function fileDefines(blanked: string, code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of blanked.matchAll(/^[ \t]*#\s*define\s+([A-Za-z_]\w*)(?![\w(])[ \t]+[^\n]*$/gm)) {
    out.set(m[1], code.slice(m.index!, m.index! + m[0].length).trim());
  }
  return out;
}

const identifiers = (body: string): Set<string> => new Set([...body.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map(m => m[1]));

/** The named defines plus any define their values mention, in file order. */
function defineClosure(names: string[], defines: Map<string, string>): string[] {
  const need = new Set<string>();
  const visit = (n: string) => {
    if (need.has(n) || !defines.has(n)) return;
    need.add(n);
    const value = defines.get(n)!.replace(/^[ \t]*#\s*define\s+\w+/, '');
    for (const m of value.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) visit(m[1]);
  };
  names.forEach(visit);
  return [...defines.keys()].filter(n => need.has(n)).map(n => defines.get(n)!);
}

/** Every function in one source, analysed. */
export function discoverInSource(src: DiscoverSource): DiscoveredFn[] {
  const blanked = blankComments(src.code);
  const raws = rawFunctions(src.code, blanked);
  const globals = fileGlobals(blanked, raws);
  const defines = fileDefines(blanked, src.code);
  const byName = new Map<string, RawFn[]>();
  for (const r of raws) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const counts = new Map<string, number>();
  const fns: DiscoveredFn[] = raws.map(r => {
    const ordinal = counts.get(r.name) ?? 0; counts.set(r.name, ordinal + 1);
    const body = blanked.slice(r.bodyOpen, r.end);
    const ids = identifiers(body);
    const called = [...new Set([...body.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]))];
    const recursive = called.includes(r.name);
    const calls = called.filter(n => n !== r.name && byName.has(n));
    const used = [...ids].filter(n => globals.has(n) && !r.params.some(p => p.name === n)).sort();
    const defs = defineClosure([...ids].filter(n => defines.has(n)), defines);
    return {
      id: `${src.id}:${r.name}#${ordinal}`, sourceId: src.id, sourceName: src.name,
      name: r.name, returnType: r.returnType, params: r.params,
      signature: `${r.returnType} ${r.name}(${r.params.map(p => `${p.qualifier === 'in' ? '' : `${p.qualifier} `}${p.type} ${p.name}`).join(', ')})`,
      text: r.text, start: r.start, end: r.end, startLine: lineOf(src.code, r.start), endLine: lineOf(src.code, r.end - 1),
      calls, dependencies: [], level: recursive ? -1 : 0, globals: used, defines: defs, selfContained: used.length === 0,
    };
  });
  // Levels and closures. Overloads share a name, so a call pulls in every definition of that name.
  const index = new Map<string, DiscoveredFn[]>();
  for (const f of fns) index.set(f.name, [...(index.get(f.name) ?? []), f]);
  const levelOf = (f: DiscoveredFn, stack: Set<string>): number => {
    if (stack.has(f.name) || f.level < 0) return -1;
    if (!f.calls.length) return 0;
    stack.add(f.name);
    let deepest = 0;
    for (const c of f.calls) for (const g of index.get(c) ?? []) { const l = levelOf(g, stack); if (l < 0) { stack.delete(f.name); return -1; } deepest = Math.max(deepest, l); }
    stack.delete(f.name);
    return deepest + 1;
  };
  for (const f of fns) f.level = levelOf(f, new Set());
  for (const f of fns) {
    const seen = new Set<DiscoveredFn>();
    const visit = (g: DiscoveredFn) => { for (const c of g.calls) for (const h of index.get(c) ?? []) { if (h === f || seen.has(h)) continue; seen.add(h); visit(h); } };
    visit(f);
    f.dependencies = fns.filter(g => seen.has(g)); // definition order, so the file's own order is kept
    const allGlobals = new Set([...f.globals, ...f.dependencies.flatMap(d => d.globals)]);
    f.globals = [...allGlobals].sort();
    f.selfContained = f.globals.length === 0 && f.level >= 0;
    f.defines = [...defines.values()].filter(line => f.defines.includes(line) || f.dependencies.some(d => d.defines.includes(line)));
  }
  return fns;
}

const ENTRY_POINTS = new Set(['main', 'mainImage']);

export function matchesFilter(f: DiscoveredFn, filter: DiscoverFilter): boolean {
  if (ENTRY_POINTS.has(f.name)) return false;
  if (filter.returnTypes?.length && !filter.returnTypes.includes(f.returnType)) return false;
  if (filter.maxLevel !== undefined && (f.level < 0 || f.level > filter.maxLevel)) return false;
  if (filter.minParams !== undefined && f.params.length < filter.minParams) return false;
  if (filter.maxParams !== undefined && f.params.length > filter.maxParams) return false;
  if (filter.paramTypes?.length && !f.params.every(p => filter.paramTypes!.includes(p.type))) return false;
  if (!filter.allowGlobals && !f.selfContained) return false;
  if (filter.nameContains && !f.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false;
  return true;
}

export interface DiscoverResult {
  matches: DiscoveredFn[];
  /** Every function found before filtering, for counts. */
  total: number;
  /** Functions whose text (with dependencies) was identical to an earlier match, dropped: name → how many. */
  duplicates: Map<string, number>;
}

/** Scan several sources, filter, and drop byte-identical repeats (the same hash() pasted into many shaders). */
export function discoverFunctions(sources: DiscoverSource[], filter: DiscoverFilter = {}): DiscoverResult {
  const all = sources.flatMap(discoverInSource);
  const seen = new Map<string, DiscoveredFn>();
  const duplicates = new Map<string, number>();
  const matches: DiscoveredFn[] = [];
  for (const f of all) {
    if (!matchesFilter(f, filter)) continue;
    const key = bundleText(f).replace(/\s+/g, ' ');
    if (seen.has(key)) { duplicates.set(f.name, (duplicates.get(f.name) ?? 0) + 1); continue; }
    seen.set(key, f);
    matches.push(f);
  }
  return { matches, total: all.length, duplicates };
}

/** The function with everything it needs, in order: defines, dependencies, then itself. */
export function bundleText(f: DiscoveredFn): string {
  return [...f.defines, ...f.dependencies.map(d => d.text), f.text].join('\n\n');
}

const SOCKET_TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);
const OUTPUT_TYPES = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** What the function looks like as a Custom Function preset, or why it can't be one. */
export function toCustomFnPreset(f: DiscoveredFn, label = f.name, comment?: string):
  | { ok: true; data: { label: string; inputs: Array<{ name: string; type: DataType; slider: null }>; outputType: DataType; body: string; glslFunctions: string; comment?: string } }
  | { ok: false; error: string } {
  if (!OUTPUT_TYPES.has(f.returnType)) return { ok: false, error: `Returns ${f.returnType}; a Custom Function returns float, vec2, vec3 or vec4.` };
  if (f.level < 0) return { ok: false, error: 'Calls itself; GLSL functions can’t recurse.' };
  if (!f.selfContained) return { ok: false, error: `Reads ${f.globals.join(', ')} from its shader; a library function can’t carry that.` };
  const bad = f.params.find(p => !SOCKET_TYPES.has(p.type));
  if (bad) return { ok: false, error: `Parameter ${bad.name} is ${/^[aeiou]/.test(bad.type) ? 'an' : 'a'} ${bad.type}, which can't be a socket (float, vec2, vec3, vec4, mat2 or mat3).` };
  const outs = f.params.filter(p => p.qualifier !== 'in');
  if (outs.length) return { ok: false, error: `Has ${outs.length === 1 ? 'an out parameter' : 'out parameters'} (${outs.map(p => p.name).join(', ')}); publish it as a Code node instead.` };
  const inputs = f.params.map(p => ({ name: p.name, type: p.type as DataType, slider: null }));
  return { ok: true, data: { label, inputs, outputType: f.returnType as DataType, body: `${f.name}(${inputs.map(i => i.name).join(', ')})`, glslFunctions: bundleText(f), comment } };
}
