/**
 * lift.ts — lift a GLSL function (and what it needs) out of a piece of code, renamed so it compiles
 * beside everything else (docs/surprise.md, "Inspired by").
 *
 * `glslFunctions(text)` lists the top-level functions with plain signatures. `liftFunction(text, name, ns)`
 * returns the function, the helper functions it calls, the `const` globals and simple `#define`s it uses,
 * every one of those names prefixed with `ns_` (so two lifts of `hash` never meet), Shadertoy's `iTime` and
 * `iResolution` mapped onto Playfield's uniforms. A function that reads a texture, the frame position or
 * other Shadertoy inputs isn't liftable (null). Pure text in, text out.
 */

export type LiftType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat2';
export interface GlslParam { type: string; name: string; qual?: string }
export interface GlslFn { name: string; ret: string; params: GlslParam[]; start: number; end: number; text: string }

const FN_HEAD = /(^|\n)[ \t]*(float|vec2|vec3|vec4|mat2|mat3|int|bool|void)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g;
/** Inputs a lifted function can't have: the frame, textures, the mouse, Shadertoy's other uniforms. */
const UNLIFTABLE = /\b(gl_FragCoord|fragCoord|fragColor|gl_FragColor|iChannel\d|iMouse|iFrame|iDate|iTimeDelta|iSampleRate|texture2D|texture|texelFetch|textureLod|u_tex\w*|vUv|discard|main|mainImage)\b/;

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Comments out: line and block comments become spaces (so offsets still mean something). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

/** The top-level functions with a body, in order. */
export function glslFunctions(raw: string): GlslFn[] {
  const text = stripComments(raw);
  const out: GlslFn[] = [];
  FN_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FN_HEAD.exec(text))) {
    const start = m.index + m[1].length;
    const open = m.index + m[0].length - 1;
    const end = matchBrace(text, open);
    if (end < 0) break;
    const params = m[4].trim() && m[4].trim() !== 'void' ? m[4].split(',').map(s => {
      const w = s.trim().split(/\s+/);
      const name = w.pop() ?? '';
      const type = w.pop() ?? '';
      return { type, name, ...(w.length ? { qual: w.join(' ') } : {}) };
    }) : [];
    out.push({ name: m[3], ret: m[2], params, start, end, text: text.slice(start, end) });
    FN_HEAD.lastIndex = end;
  }
  return out;
}

interface Global { name: string; text: string; start: number }

/** `const` globals and `#define`s (object- or function-like, continuation lines joined), outside functions. */
function globalsOf(text: string, fns: GlslFn[]): Global[] {
  const inside = (i: number) => fns.some(f => i >= f.start && i < f.end);
  const out: Global[] = [];
  const def = /(^|\n)[ \t]*#define[ \t]+([A-Za-z_]\w*)((?:[^\n\\]|\\\n|\\)*)/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(text))) {
    const start = m.index + m[1].length;
    if (!inside(start)) out.push({ name: m[2], text: text.slice(start, def.lastIndex).replace(/\\\n/g, ' '), start });
  }
  const cst = /(^|\n)[ \t]*const\s+(float|int|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*=[^;]*;/g;
  while ((m = cst.exec(text))) {
    const start = m.index + m[1].length;
    if (!inside(start)) out.push({ name: m[3], text: text.slice(start, cst.lastIndex), start });
  }
  return out;
}

const words = (s: string) => new Set(s.match(/[A-Za-z_]\w*/g) ?? []);

export interface Lifted {
  /** The renamed code: globals, then helpers, then the function (source order). */
  code: string;
  /** The function's new name. */
  fn: string;
  /** The renamed names, old → new. */
  renamed: Record<string, string>;
}

/** A GLSL-safe namespace from any text: a letter, then a short hash. */
export function namespaceFor(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `ip${(h >>> 0).toString(36).slice(0, 5)}`;
}

/** Rename whole-word identifiers (not after a `.`, so swizzles and fields stay). */
export function renameIdents(code: string, map: Record<string, string>): string {
  const keys = Object.keys(map);
  if (!keys.length) return code;
  const re = new RegExp(`(^|[^.\\w])(${keys.map(k => k.replace(/[$]/g, '\\$')).join('|')})\\b`, 'g');
  return code.replace(re, (_m, pre: string, name: string) => pre + map[name]);
}

/** Lift `name` (every overload) and what it needs out of `raw`, renamed into `ns`. Null when it can't stand alone. */
export function liftFunction(raw: string, name: string, ns: string): Lifted | null {
  const text = stripComments(raw);
  const fns = glslFunctions(text);
  const globals = globalsOf(text, fns);
  const byName = new Map<string, GlslFn[]>();
  for (const f of fns) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  const gByName = new Map(globals.map(g => [g.name, g]));
  if (!byName.has(name)) return null;
  // What it needs, followed through helpers and globals.
  const needFns = new Set<string>([name]);
  const needGlobals = new Set<string>();
  const queue = [name];
  while (queue.length) {
    const cur = queue.pop()!;
    const bodies = byName.get(cur)?.map(f => f.text) ?? [gByName.get(cur)?.text ?? ''];
    for (const body of bodies) for (const w of words(body)) {
      if (w === cur) continue;
      if (byName.has(w) && !needFns.has(w)) { needFns.add(w); queue.push(w); }
      else if (gByName.has(w) && !needGlobals.has(w)) { needGlobals.add(w); queue.push(w); }
    }
  }
  const pieces: Array<{ start: number; text: string }> = [
    ...[...needGlobals].map(g => gByName.get(g)!),
    ...[...needFns].flatMap(n => byName.get(n)!),
  ].sort((a, b) => a.start - b.start);
  let code = pieces.map(p => p.text.trim()).join('\n');
  if (UNLIFTABLE.test(code)) return null;
  // A user-defined struct or an array parameter: leave it.
  if (/\bstruct\b/.test(code)) return null;
  const renamed: Record<string, string> = {};
  for (const n of [...needFns, ...needGlobals]) renamed[n] = `${ns}_${n}`;
  code = renameIdents(code, renamed);
  code = code.replace(/\biTime\b/g, 'u_time').replace(/\biResolution\b/g, 'vec3(u_resolution, 1.0)');
  return { code, fn: renamed[name], renamed };
}
