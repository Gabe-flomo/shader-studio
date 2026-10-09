/**
 * fnSource.ts — pieces of source the function card hands to Explain: the statement a call sits in, and
 * a user function's whole declaration (signature and body). Pure.
 */
import { declaredFunctions, splitStatements } from '../lib/glslPatterns';

/** The statement of `code` that contains `pos`, or null (a call between statements, in a declaration's signature). */
export function statementAt(code: string, pos: number): string | null {
  for (const s of splitStatements(code)) if (pos >= s.start && pos <= s.end) return s.text;
  return null;
}

/** `float f(vec2 p) { … }` as written, found by name in `source` (the first overload), or null. */
export function functionSource(source: string, name: string): string | null {
  const d = declaredFunctions(source).find(f => f.name === name);
  if (!d) return null;
  const open = source.indexOf('{', d.start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(d.start, i + 1);
  }
  return null;
}
