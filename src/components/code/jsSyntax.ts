/**
 * jsSyntax — colour a line of JavaScript with the same palette the GLSL
 * editor uses, for the Script layer's editor. Keywords, the sketch's helper
 * names and common globals, strings, numbers, comments, members after a dot,
 * operators and punctuation. One line at a time, like the GLSL tokenizer, so
 * a block comment or template literal spanning lines colours line by line.
 */
import { C, type Token } from '../glslSyntax';
import { KL_SKETCH_NAMES } from '../../play/kit/layers.js';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'new', 'this',
  'class', 'extends', 'super', 'of', 'in', 'typeof', 'instanceof', 'switch', 'case', 'default', 'try', 'catch', 'finally',
  'throw', 'async', 'await', 'yield', 'delete', 'void', 'import', 'export', 'static', 'get', 'set',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const GLOBALS = new Set([
  'Math', 'console', 'Object', 'Array', 'Number', 'String', 'Boolean', 'JSON', 'Date', 'Map', 'Set', 'Promise', 'Symbol',
  'window', 'document', 'requestAnimationFrame', 'performance', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout',
  'setup', 'draw', 'params',
]);
const HELPERS = new Set<string>(KL_SKETCH_NAMES);
const OPS = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>'];

/** Split a JavaScript line into coloured tokens. `pal` defaults to the dark colours. */
export function tokenizeJsLine(line: string, pal: typeof C = C): Token[] {
  const out: Token[] = [];
  const push = (text: string, color: string) => { if (text) out.push({ text, color }); };
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { let j = i; while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++; push(line.slice(i, j), pal.ident); i = j; continue; }
    if (ch === '/' && line[i + 1] === '/') { push(line.slice(i), pal.comment); break; }
    if (ch === '/' && line[i + 1] === '*') { const e = line.indexOf('*/', i + 2); const t = e < 0 ? line.slice(i) : line.slice(i, e + 2); push(t, pal.comment); i += t.length; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      push(line.slice(i, Math.min(line.length, j + 1)), pal.typeVec3); i = j + 1; continue;
    }
    const prev = i > 0 ? line[i - 1] : '';
    if (/\d/.test(ch) && !/[A-Za-z0-9_$]/.test(prev)) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(\.\d*)?([eE][+-]?\d+)?n?)/.exec(line.slice(i));
      if (m) { push(m[0], pal.number); i += m[0].length; continue; }
    }
    if (ch === '.' && /\d/.test(line[i + 1] ?? '')) { const m = /^\.\d+([eE][+-]?\d+)?/.exec(line.slice(i))!; push(m[0], pal.number); i += m[0].length; continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(line.slice(i))!;
      const w = m[0];
      const afterDot = prev === '.' || (prev === '?' && false);
      let color = pal.ident;
      if (afterDot) color = pal.swizzle;
      else if (KEYWORDS.has(w)) color = pal.keyword;
      else if (LITERALS.has(w)) color = pal.number;
      else if (HELPERS.has(w) || GLOBALS.has(w)) color = pal.builtin;
      else if (w === 's' || w === 'ctx') color = pal.typeVec2;
      push(w, color); i += w.length; continue;
    }
    if (ch === '.') { push('.', pal.punct); i++; continue; }
    const three = line.slice(i, i + 4);
    const op = OPS.find(o => three.startsWith(o));
    if (op) { push(op, pal.operator); i += op.length; continue; }
    if (/[+\-*/%=<>!&|^~?:]/.test(ch)) { push(ch, pal.operator); i++; continue; }
    if (/[(){}[\],;]/.test(ch)) { push(ch, pal.punct); i++; continue; }
    push(ch, pal.ident); i++;
  }
  return out;
}
