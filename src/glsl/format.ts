/**
 * Tidy — pasted GLSL rewritten as the GLSL Playfield works best on: the
 * dialect translated to ours (Shadertoy, GLSL Sandbox, twigl, ES 3.00 names
 * and entry point), then the text itself made regular: Unix line endings,
 * four-space indentation by brace depth, no trailing spaces, at most one
 * blank line in a row, `#` directives at the margin. Tokens are never
 * changed, so a tidied shader compiles to the same program.
 */
import { translateToStudio, type Translation } from './dialects';

export interface Tidied extends Translation { changed: boolean }

/** Re-indent by brace depth, line by line. Strings and comments are left as they are. */
export function reindent(src: string, indent = '    '): string {
  const out: string[] = [];
  let depth = 0, blank = 0, inBlockComment = false;
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, indent).trimEnd();
    const t = line.trim();
    if (!t) { if (++blank <= 1) out.push(''); continue; }
    blank = 0;
    if (inBlockComment) { out.push(line); if (t.includes('*/')) inBlockComment = false; continue; }
    if (t.startsWith('#')) { out.push(t); continue; }
    // Closing braces at the start of a line sit at the outer depth.
    const leading = /^[})\]]+/.exec(t)?.[0].split('').filter(c => c === '}').length ?? 0;
    const level = Math.max(0, depth - leading);
    out.push(indent.repeat(level) + t);
    // Count braces outside strings and comments.
    let i = 0, inStr = false;
    while (i < t.length) {
      const c = t[i], n = t[i + 1];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; }
      else if (c === '/' && n === '/') break;
      else if (c === '/' && n === '*') { const e = t.indexOf('*/', i + 2); if (e === -1) { inBlockComment = true; break; } i = e + 1; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      i++;
    }
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n') + '\n';
}

export function tidyGlsl(source: string): Tidied {
  const tr = translateToStudio(source);
  const code = reindent(tr.code);
  return { ...tr, code, changed: code !== source };
}
