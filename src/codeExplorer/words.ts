/**
 * words.ts — code-aware words for free-text search (docs/code-explorer-plan.md §2, §4.2).
 *
 * Identifiers are split on camelCase, snake_case and digits, and the whole
 * identifier is kept too (`fbmNoise` → fbmnoise, fbm, noise), so BM25 works
 * over code. Prose (labels, comments) is lower-cased and split on non-letters.
 */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'its', 'by', 'at', 'as', 'be', 'with', 'this', 'that', 'from', 'into', 'than', 'then', 'so']);
const CODE_STOP = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'return', 'if', 'else', 'for', 'const', 'void', 'in', 'out', 'inout', 'uniform', 'true', 'false']);

/** `fbmNoise2D` → ['fbmnoise2d', 'fbm', 'noise', '2d']; `u_time` → ['u_time', 'time']. */
export function splitIdentifier(id: string): string[] {
  const lower = id.toLowerCase();
  const parts = id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/[_\s]+/)
    .map(p => p.toLowerCase())
    .filter(p => p.length > 1);
  const out = [lower];
  for (const p of parts) if (p !== lower && !out.includes(p)) out.push(p);
  return out;
}

/** Lower-case words of prose (a label, a comment). */
export function proseWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
}

/** Split words of every identifier in a piece of code, without keywords and types. */
export function codeWords(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_]\w*/g)) {
    if (CODE_STOP.has(m[0])) continue;
    for (const w of splitIdentifier(m[0])) if (!CODE_STOP.has(w) && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

/** The text of a source's comments (`//` and block comments). */
export function commentText(code: string): string {
  const out: string[] = [];
  for (const m of code.matchAll(/\/\/([^\n]*)|\/\*([\s\S]*?)\*\//g)) out.push(m[1] ?? m[2] ?? '');
  return out.join(' ');
}
