/**
 * Mutable globals → parameters.
 *
 * Shadertoy-style shaders often keep a global (`vec2 mouse;`) that main()
 * assigns and helper functions read. A graph has no globals, but the same
 * value can travel as an argument: every function that reads the global (and
 * every function that calls one of those) gets it as a trailing parameter,
 * every call passes it on, and the declaration moves into main() as a local.
 * The shader means the same thing; the converter then sees only locals and
 * parameters, which it already handles.
 *
 * Only a global that nothing but main() assigns is threaded: one a helper
 * writes is shared state between calls, which a parameter can't carry, so it
 * is left for the converter to report as before.
 *
 * Text in, text out, same line count (the declaration line is blanked, the
 * local goes on main's opening line), so error lines still map to the paste.
 */

interface Fn { name: string; headerStart: number; parenClose: number; bodyOpen: number; bodyClose: number; params: string }

const TYPES = 'float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234]';
const PRECISION = '(?:(?:highp|mediump|lowp)\\s+)?';

const matchBrace = (s: string, open: number): number => { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return i; } return -1; };
const matchParen = (s: string, open: number): number => { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i; } return -1; };
/** Comments blanked (same length), so names inside them don't count and offsets still line up. */
function blankComments(s: string): string {
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

function functions(s: string): Fn[] {
  const out: Fn[] = [];
  const re = new RegExp(`(^|[;}\\n])\\s*(?:${TYPES}|void)\\s+([A-Za-z_]\\w*)\\s*\\(`, 'g');
  for (const m of s.matchAll(re)) {
    const headerStart = m.index! + m[1].length;
    const parenOpen = m.index! + m[0].length - 1;
    const parenClose = matchParen(s, parenOpen); if (parenClose < 0) continue;
    const after = s.slice(parenClose + 1).match(/^\s*\{/); if (!after) continue; // a prototype, not a definition
    const bodyOpen = parenClose + 1 + after[0].length - 1;
    const bodyClose = matchBrace(s, bodyOpen); if (bodyClose < 0) continue;
    out.push({ name: m[2], headerStart, parenClose, bodyOpen, bodyClose, params: s.slice(parenOpen + 1, parenClose).trim() });
  }
  return out;
}

export interface ThreadResult { code: string; notes: string[] }

export function threadGlobals(source: string): ThreadResult {
  const notes: string[] = [];
  let code = source;
  for (let round = 0; round < 16; round++) {
    const s = blankComments(code);
    const fns = functions(s);
    const main = fns.find(f => f.name === 'main');
    if (!main) break;
    const inFn = (i: number) => fns.some(f => i > f.bodyOpen && i < f.bodyClose);
    // A top-level, non-const, non-uniform declaration of one scalar/vector/matrix.
    const declRe = new RegExp(`(^|[;}\\n])([ \\t]*)${PRECISION}(${TYPES})\\s+([A-Za-z_]\\w*)(\\s*\\[[^\\]]*\\])?(\\s*=\\s*[^;]+)?;`, 'g');
    let done = false;
    for (const m of s.matchAll(declRe)) {
      const at = m.index! + m[1].length;
      if (inFn(at)) continue;
      const before = s.slice(0, at);
      if (/\b(const|uniform|varying|attribute|in|out)\s*$/.test(before.slice(-12))) continue;
      const type = m[3], name = m[4], dims = (m[5] ?? '').trim(), init = (m[6] ?? '').trim();
      const word = new RegExp(`(?<![\\w.])${name}\\b`, 'g');
      const assigns = new RegExp(`(?<![\\w.])${name}(\\.[xyzwrgba]+)?\\s*([-+*/]?=(?!=)|\\+\\+|--)|(\\+\\+|--)\\s*${name}\\b`, 'g');
      const readers = fns.filter(f => f.name !== 'main' && word.test(s.slice(f.bodyOpen, f.bodyClose)));
      if (dims && readers.length) continue; // an array read by helpers: left as it is (arrays don't travel as parameters here)
      if (readers.some(f => assigns.test(s.slice(f.bodyOpen, f.bodyClose)))) continue; // a helper writes it: real shared state
      // Only main uses it: it simply becomes a local of main.
      // Callers of readers need it too, transitively (overloads share a name, so all get it).
      const need = new Set(readers.map(f => f.name));
      for (let grew = true; grew;) {
        grew = false;
        for (const f of fns) {
          if (f.name === 'main' || need.has(f.name)) continue;
          if ([...need].some(n => new RegExp(`(?<![\\w.])${n}\\s*\\(`).test(s.slice(f.bodyOpen, f.bodyClose)))) { need.add(f.name); grew = true; }
        }
      }
      // Edits, applied back to front so offsets hold: call sites get `, name`, headers get `, type name`,
      // the declaration line is blanked, main opens with the local.
      const edits: Array<{ at: number; del: number; text: string }> = [];
      for (const f of fns) {
        if (!need.size) break; // main-only: nothing to pass along
        for (const c of s.slice(f.bodyOpen, f.bodyClose).matchAll(new RegExp(`(?<![\\w.])(${[...need].join('|')})\\s*\\(`, 'g'))) {
          const open = f.bodyOpen + c.index! + c[0].length - 1;
          const close = matchParen(s, open); if (close < 0) continue;
          const empty = !s.slice(open + 1, close).trim();
          edits.push({ at: close, del: 0, text: empty ? name : `, ${name}` });
        }
        if (need.has(f.name)) edits.push({ at: f.parenClose, del: 0, text: f.params && f.params !== 'void' ? `, ${type} ${name}` : `${type} ${name}` });
      }
      // The header's own `(void)` becomes the one parameter.
      for (const f of fns) if (need.has(f.name) && f.params === 'void') edits.push({ at: f.parenClose - 4, del: 4, text: '' });
      edits.push({ at: main.bodyOpen + 1, del: 0, text: ` ${type} ${name}${dims}${init ? ` ${init}` : ''};` });
      edits.push({ at: at + m[2].length, del: m[0].length - m[1].length - m[2].length, text: '' });
      edits.sort((a, b) => b.at - a.at);
      let next = code;
      for (const e of edits) next = next.slice(0, e.at) + e.text + next.slice(e.at + e.del);
      code = next;
      notes.push(need.size ? `Global ${name} passed to ${[...need].join(', ')} as a parameter` : `Global ${name} made a local of main()`);
      done = true;
      break; // offsets changed: rescan
    }
    if (!done) break;
  }
  return { code, notes };
}
