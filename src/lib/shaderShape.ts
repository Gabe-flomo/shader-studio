/**
 * shaderShape — cheap static counts on a fragment shader that hint at cost.
 * Not a cost model (the GPU compiler reshapes everything), but the numbers
 * people can act on: loop bounds, texture fetches, transcendental calls.
 */
export interface ShaderShape {
  /** Lines in the whole file and inside main() */
  lines: number;
  mainLines: number;
  /** `for` loops and their literal upper bounds where the loop is `i < N` */
  loops: number;
  loopBounds: number[];
  /** Nested loop depth (rough, brace based) */
  maxLoopDepth: number;
  /** texture2D / texture calls */
  textureSamples: number;
  /** sin cos tan exp log pow sqrt atan — the slow-ish builtins */
  transcendentals: number;
  /** `if` statements (branches on a GPU cost when they diverge) */
  branches: number;
  uniforms: number;
  functions: number;
}

const TRANSCENDENTAL = /\b(sin|cos|tan|asin|acos|atan|exp|exp2|log|log2|pow|sqrt|inversesqrt)\s*\(/g;

export function shaderShape(fs: string): ShaderShape {
  const lines = fs ? fs.split('\n').length : 0;
  const mainStart = fs.search(/void\s+main\s*\(/);
  const mainLines = mainStart >= 0 ? mainBody(fs, mainStart).split('\n').length : 0;
  const loopBounds: number[] = [];
  let loops = 0;
  for (const m of fs.matchAll(/\bfor\s*\(([^;]*);([^;]*);/g)) {
    loops++;
    const bound = /<=?\s*(\d+)\b/.exec(m[2]);
    if (bound) loopBounds.push(Number(bound[1]) + (m[2].includes('<=') ? 1 : 0));
  }
  return {
    lines,
    mainLines,
    loops,
    loopBounds,
    maxLoopDepth: loopDepth(fs),
    textureSamples: count(fs, /\btexture(2D|2DLod|Lod)?\s*\(/g),
    transcendentals: count(fs, TRANSCENDENTAL),
    branches: count(fs, /\bif\s*\(/g),
    uniforms: count(fs, /^\s*uniform\s/gm),
    functions: count(fs, /^\s*(float|vec[234]|mat[234]|int|bool|void)\s+[A-Za-z_]\w*\s*\([^;{]*\)\s*\{/gm) - (mainStart >= 0 ? 1 : 0),
  };
}

function count(s: string, re: RegExp): number { return (s.match(re) ?? []).length; }

function mainBody(fs: string, from: number): string {
  const open = fs.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < fs.length; i++) {
    if (fs[i] === '{') depth++;
    else if (fs[i] === '}' && --depth === 0) return fs.slice(open + 1, i);
  }
  return fs.slice(open + 1);
}

function loopDepth(fs: string): number {
  // Walk braces; a `for` seen right before an opening brace raises the depth of that block
  let depth = 0, max = 0;
  const stack: boolean[] = [];
  const tokens = fs.matchAll(/\bfor\s*\(|[{}]/g);
  let pendingFor = false;
  for (const t of tokens) {
    if (t[0] === '{') { stack.push(pendingFor); if (pendingFor) { depth++; max = Math.max(max, depth); } pendingFor = false; }
    else if (t[0] === '}') { if (stack.pop()) depth--; }
    else pendingFor = true;
  }
  return max;
}
