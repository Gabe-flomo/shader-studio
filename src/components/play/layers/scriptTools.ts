/**
 * scriptTools — text edits on a sketch the editor offers as one click.
 *
 * `controlCandidate(code, selection)`: is the selected word a top-level
 * variable set to a number (`let speed = 2;`, a slider), to a boolean
 * (`let invert = false;`, a toggle), or a top-level function (`function
 * wipe(s) {}`, a button)? `makeControl(code, name)`: add it to the params
 * object (creating one if there is none); a variable keeps its declaration
 * but becomes `let`, so the kit can drive it from the control each frame.
 * Nothing else in the sketch changes: `speed` is still `speed`.
 */

export interface SliderCandidate { name: string; value: number; declStart: number; declEnd: number; keyword: 'const' | 'let' | 'var' }
export type ControlKind = 'slider' | 'toggle' | 'button';
export interface ControlCandidate { kind: ControlKind; name: string; value: number | boolean | null; declStart: number; declEnd: number; keyword?: 'const' | 'let' | 'var' }

const IDENT = /^[A-Za-z_]\w*$/;

/** The declaration `const|let|var NAME = <number>;` at the top level (start of a line), if any. */
export function findNumericDeclaration(code: string, name: string): SliderCandidate | null {
  if (!IDENT.test(name)) return null;
  const re = new RegExp(`^[ \\t]*(const|let|var)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`, 'm');
  const m = re.exec(code);
  if (!m) return null;
  return { name, value: Number(m[2]), declStart: m.index, declEnd: m.index + m[0].length, keyword: m[1] as SliderCandidate['keyword'] };
}

/** The declaration `const|let|var NAME = true|false;` at the top level, if any. */
export function findBooleanDeclaration(code: string, name: string): ControlCandidate | null {
  if (!IDENT.test(name)) return null;
  const re = new RegExp(`^[ \\t]*(const|let|var)\\s+${name}\\s*=\\s*(true|false)\\s*;`, 'm');
  const m = re.exec(code);
  if (!m) return null;
  return { kind: 'toggle', name, value: m[2] === 'true', declStart: m.index, declEnd: m.index + m[0].length, keyword: m[1] as ControlCandidate['keyword'] };
}

/** A top-level `function NAME(` that is not the sketch's own setup or draw. */
export function findFunctionDeclaration(code: string, name: string): ControlCandidate | null {
  if (!IDENT.test(name) || name === 'setup' || name === 'draw') return null;
  const re = new RegExp(`^[ \\t]*(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
  const m = re.exec(code);
  if (!m) return null;
  return { kind: 'button', name, value: null, declStart: m.index, declEnd: m.index + m[0].length };
}

/** What the editor's selection points at: a slider candidate, or null. */
export function sliderCandidate(code: string, selected: string): SliderCandidate | null {
  const c = controlCandidate(code, selected);
  return c && c.kind === 'slider' ? { name: c.name, value: c.value as number, declStart: c.declStart, declEnd: c.declEnd, keyword: c.keyword! } : null;
}

/** What the editor's selection points at: a slider, toggle or button candidate, or null. */
export function controlCandidate(code: string, selected: string): ControlCandidate | null {
  const name = selected.trim();
  if (!name || !IDENT.test(name)) return null;
  if (declaredParams(code).includes(name)) return null;
  const n = findNumericDeclaration(code, name);
  if (n) return { kind: 'slider', ...n };
  return findBooleanDeclaration(code, name) ?? findFunctionDeclaration(code, name);
}

/** Keys already in the params object, read textually (the compiler reads them properly; this is for the button). */
export function declaredParams(code: string): string[] {
  const block = paramsBlock(code);
  if (!block) return [];
  // Keys at the object's own level only: walk the text and read `name:` where no inner brace is open.
  const inner = code.slice(block.open + 1, block.close);
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 0) {
      const m = /^([A-Za-z_]\w*)\s*:/.exec(inner.slice(i));
      if (m && (i === 0 || /[\s,{]/.test(inner[i - 1]))) { out.push(m[1]); i += m[0].length - 1; }
    }
  }
  return out;
}

export function paramsBlock(code: string): { start: number; open: number; close: number } | null {
  const m = /^[ \t]*(?:const|let|var)\s+params\s*=\s*\{/m.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}' && --d === 0) return { start: m.index, open, close: i };
  }
  return null;
}

/** A sensible range for a slider whose starting value is `v`. */
export function guessRange(v: number): { min: number; max: number; step?: number } {
  const a = Math.abs(v);
  if (a === 0) return { min: 0, max: 1, step: 0.01 };
  if (Number.isInteger(v) && a >= 2) return { min: v < 0 ? v * 4 : 0, max: v < 0 ? 0 : v * 4, step: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(a)));
  const step = mag / 100 < 0.001 ? 0.001 : mag / 100;
  return v < 0 ? { min: v * 4, max: 0, step } : { min: 0, max: Math.max(1, v * 4), step };
}

const num = (n: number) => (Number.isInteger(n) ? `${n}` : `${+n.toFixed(4)}`);

/** The sketch with `entry` added to its params object (created at the top if there is none). */
export function addParamEntry(code: string, entry: string): string {
  const block = paramsBlock(code);
  if (!block) return `const params = {\n  ${entry},\n};\n\n${code}`;
  const inner = code.slice(block.open + 1, block.close);
  const indent = inner.match(/\n([ \t]+)\S/)?.[1] ?? '  ';
  // The last entry may end in a comment: its comma goes before the comment.
  const head = code.slice(0, block.close).replace(/\s*$/, '');
  const comment = /[ \t]*\/\/[^\n]*$/.exec(head)?.[0] ?? '';
  const last = head.slice(0, head.length - comment.length);
  const needsComma = !/[{,]\s*$/.test(last);
  return `${last}${needsComma ? ',' : ''}${comment}\n${indent}${entry},\n${code.slice(block.close)}`;
}

/** `const NAME = …` → `let NAME = …` at a declaration, so the control can write the variable. */
function toLet(code: string, decl: { declStart: number; declEnd: number; keyword?: string }): string {
  if (decl.keyword !== 'const') return code;
  return `${code.slice(0, decl.declStart)}${code.slice(decl.declStart, decl.declEnd).replace(/^(\s*)const\b/, '$1let')}${code.slice(decl.declEnd)}`;
}

/** The sketch with `name` as a slider: an entry in params (created if needed) and a `let` declaration. */
export function makeSlider(code: string, name: string, range = guessRange(findNumericDeclaration(code, name)?.value ?? 1)): { code: string; entry: string } | null {
  const decl = findNumericDeclaration(code, name);
  if (!decl) return null;
  const entry = `${name}: { value: ${num(decl.value)}, min: ${num(range.min)}, max: ${num(range.max)}${range.step ? `, step: ${num(range.step)}` : ''} }`;
  const out = addParamEntry(code, entry);
  // The declaration may have moved; find it again and make it a let so the slider can write it.
  return { code: toLet(out, findNumericDeclaration(out, name)!), entry };
}

/** The sketch with `name` as a control of the kind its declaration allows: a slider, a toggle (`let x = false`) or a button (a function). */
export function makeControl(code: string, name: string, kind?: ControlKind): { code: string; entry: string; kind: ControlKind } | null {
  const c = controlCandidate(code, name);
  if (!c || (kind && kind !== c.kind)) return null;
  if (c.kind === 'slider') { const r = makeSlider(code, name); return r ? { ...r, kind: 'slider' } : null; }
  if (c.kind === 'toggle') {
    const entry = `${name}: { kind: 'toggle', value: ${c.value ? 'true' : 'false'} }`;
    const out = addParamEntry(code, entry);
    return { code: toLet(out, findBooleanDeclaration(out, name)!), entry, kind: 'toggle' };
  }
  // A button: the function itself goes in params (declarations hoist, so the reference works from the top).
  const entry = `${name}: ${name}`;
  return { code: addParamEntry(code, entry), entry, kind: 'button' };
}

// ── Placing code where it belongs ────────────────────────────────────────────
// Patterns and the control builder say where their code goes: the top of the
// file (declarations, helper functions), or inside setup or draw. placeCode
// puts it there relative to the sketch's own structure instead of at the caret.

export type Where = 'top' | 'setup' | 'draw';

/** The index of the brace closing the one at `open`, skipping strings and comments; -1 when unbalanced. */
export function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** A top-level `function NAME(…) {…}`: where it starts, its braces, and its first parameter's name. */
function findFunction(code: string, name: string): { start: number; open: number; close: number; param: string | null } | null {
  const m = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'm').exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(code, open);
  if (close < 0) return null;
  return { start: m.index, open, close, param: /^\s*([A-Za-z_$][\w$]*)/.exec(m[1])?.[1] ?? null };
}

/** Names declared at the top level (lines at column 0): let/const/var, including `let a = 1, b = 2`, and functions. */
export function topLevelNames(code: string): Set<string> {
  const out = new Set<string>();
  for (const line of code.split('\n')) {
    const d = /^(?:const|let|var)\s+(.*)$/.exec(line);
    if (d) {
      out.add(/^[A-Za-z_$][\w$]*/.exec(d[1])?.[0] ?? '');
      for (const m of d[1].matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out.add(m[1]);
    }
    const f = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (f) out.add(f[1]);
  }
  out.delete('');
  return out;
}

/** Where a top-level block goes: before the first of setup / draw (and the comment right above it); null when there are neither. */
function topInsertAt(code: string): number | null {
  const fns = [findFunction(code, 'setup'), findFunction(code, 'draw')].filter(f => !!f).sort((a, b) => a.start - b.start);
  if (!fns.length) return null;
  let at = fns[0].start;
  // Keep a comment that introduces the function with it.
  while (at > 0) {
    const prev = code.lastIndexOf('\n', at - 2) + 1;
    if (!/^[ \t]*\/\//.test(code.slice(prev, at - 1))) break;
    at = prev;
  }
  return at;
}

/** `block` on its own, a blank line either side, at `at` (the end when null). */
function insertBlock(code: string, block: string, at: number | null): string {
  const before = (at === null ? code : code.slice(0, at)).replace(/\s+$/, '');
  return `${before}${before ? '\n\n' : ''}${block}\n${at === null ? '' : `\n${code.slice(at)}`}`;
}

function insertTop(code: string, text: string): string {
  const block = text.replace(/\s+$/, '');
  return block ? insertBlock(code, block, topInsertAt(code)) : code;
}

const SETTING = /^let\s+([A-Za-z_$][\w$]*\s*=\s*-?\d+(?:\.\d+)?(?:\s*,\s*[A-Za-z_$][\w$]*\s*=\s*-?\d+(?:\.\d+)?)*)\s*;[ \t]*(?:\/\/.*)?$/;

/**
 * Split out a snippet's settings: lines at its own top level like `let radius = 120, speed = 1;`.
 * They become one `let` per name at the top of the file (so Make a slider can drive them, and
 * inserting twice does not declare them twice); names the sketch already declares are dropped.
 */
function splitSettings(text: string, have: Set<string>): { settings: string; rest: string } {
  const settings: string[] = [], rest: string[] = [];
  for (const line of text.split('\n')) {
    const m = SETTING.exec(line);
    if (!m) { rest.push(line); continue; }
    for (const part of m[1].split(',')) {
      const [name, value] = part.split('=').map(x => x.trim());
      if (!have.has(name)) { settings.push(`let ${name} = ${value};`); have.add(name); }
    }
  }
  return { settings: settings.join('\n'), rest: rest.join('\n') };
}

/** A snippet's `const params = { … }` merged into the sketch's own params (keys it already has are skipped); the rest of the snippet returned. */
function mergeParams(code: string, text: string): { code: string; rest: string } {
  const theirs = paramsBlock(text);
  if (!theirs) return { code, rest: text };
  let end = theirs.close + 1;
  if (text[end] === ';') end++;
  // The sketch has no params yet: the snippet's become the sketch's, at the top of the file (even from a draw pattern).
  if (!paramsBlock(code)) {
    const block = text.slice(theirs.start, end).replace(/^[ \t]+/, '');
    return { code: code.trim() ? `${block}\n\n${code.replace(/^\s+/, '')}` : `${block}\n`, rest: text.slice(0, theirs.start) + text.slice(end) };
  }
  const have = new Set(declaredParams(code));
  const lines = text.slice(theirs.open + 1, theirs.close).split('\n').filter(line => {
    const key = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*[:(]/.exec(line)?.[1];
    return line.trim() && !(key && have.has(key));
  });
  let out = code;
  // One entry per line, without its comment; addParamEntry adds the comma.
  for (const line of lines) out = addParamEntry(out, line.trim().replace(/\s*\/\/.*$/, '').replace(/,\s*$/, ''));
  return { code: out, rest: text.slice(0, theirs.start) + text.slice(end) };
}

function indentBlock(text: string, indent: string): string {
  return text.split('\n').map(line => (line.trim() ? indent + line : '')).join('\n');
}

/**
 * `code` with `text` placed where it belongs. 'top': before setup/draw (so after the params,
 * constants and declarations above them), or at the end when there are neither. 'setup' /
 * 'draw': at the end of that function's body (before a closing `return`), creating the
 * function when the sketch has none; with `caret` on a blank line inside that function, there
 * instead. A snippet's params merge into the sketch's params, its settings (`let n = 1;`) go
 * to the top, and `s.` follows the function's own parameter name.
 */
export function placeCode(code: string, where: Where, text: string, caret?: number): string {
  const merged = mergeParams(code, text.replace(/\s+$/, ''));
  let out = merged.code;
  const { settings, rest } = splitSettings(merged.rest, topLevelNames(out));
  let body = rest.replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
  if (where === 'top') return insertTop(out, [settings, body].filter(x => x.trim()).join('\n'));

  if (body) {
    const fn = findFunction(out, where);
    if (!fn) {
      // No such function yet: a new one, setup before draw.
      const block = `function ${where}(s) {\n${indentBlock(body, '  ')}\n}`;
      out = insertBlock(out, block, where === 'setup' && findFunction(out, 'draw') ? topInsertAt(out) : null);
    } else {
      if (fn.param && fn.param !== 's') body = body.replace(/\bs\.(?=[A-Za-z_$])/g, `${fn.param}.`);
      const lineStart = (i: number) => out.lastIndexOf('\n', i - 1) + 1;
      const closeLine = lineStart(fn.close);
      const fnIndent = /^[ \t]*/.exec(out.slice(lineStart(fn.start)))![0];
      const inner = out.slice(fn.open + 1, fn.close);
      const bodyIndent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? `${fnIndent}  `;
      if (!/^[ \t]*$/.test(out.slice(closeLine, fn.close))) {
        // `function draw(s) { … }` on one line: open it up.
        const kept = inner.trim();
        out = `${out.slice(0, fn.open + 1)}\n${kept ? `${bodyIndent}${kept}\n` : ''}${indentBlock(body, bodyIndent)}\n${fnIndent}${out.slice(fn.close)}`;
      } else {
        let at = closeLine, indent = bodyIndent;
        const caretLine = caret !== undefined && caret > fn.open && caret < closeLine ? lineStart(caret) : -1;
        const caretEnd = caretLine >= 0 ? out.indexOf('\n', caretLine) + 1 : -1;
        if (caretLine > fn.open && caretEnd > 0 && caretEnd <= closeLine && !out.slice(caretLine, caretEnd).trim()) {
          // The caret is on a blank line in this function: there, at that line's indent (or the body's).
          indent = /^[ \t]*/.exec(out.slice(caretLine))![0] || bodyIndent;
          out = out.slice(0, caretLine) + out.slice(caretEnd);
          at = caretLine;
        } else {
          // Before a trailing `return …` at the body's own level.
          const lines = out.slice(fn.open + 1, closeLine).split('\n');
          let k = lines.length - 1;
          while (k > 0 && !lines[k].trim()) k--;
          if (k > 0 && new RegExp(`^${bodyIndent}return\\b`).test(lines[k])) at = fn.open + 1 + lines.slice(0, k).join('\n').length + 1;
        }
        out = `${out.slice(0, at)}${indentBlock(body, indent)}\n${out.slice(at)}`;
      }
    }
  }
  return settings ? insertTop(out, settings) : out;
}

// ── The control builder ──────────────────────────────────────────────────────

export type ControlHelper = 'none' | 'loop' | 'array' | 'if';
export interface NewControl {
  key: string;
  label?: string;
  kind: ControlKind;
  /** A slider's starting number, or a toggle's on/off. */
  value?: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Code that uses it: a loop in draw or an array kept at the slider's count (sliders), an if in draw (toggles, buttons). */
  helper?: ControlHelper;
}

const RESERVED = new Set(['setup', 'draw', 'params', 's', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'undefined', 'NaN', 'Infinity']);

/** Why `key` cannot be a new control of this sketch (`builtins`: the helper names), or null when it can. */
export function controlKeyProblem(code: string, key: string, builtins: readonly string[] = []): string | null {
  if (!key) return 'Give it a name.';
  if (!/^[A-Za-z_]\w{0,30}$/.test(key)) return 'Letters, digits and _ only, starting with a letter; up to 31.';
  if (declaredParams(code).includes(key)) return `The sketch already has a control called ${key}.`;
  if (RESERVED.has(key) || builtins.includes(key)) return `${key} is a built-in name; pick another.`;
  if (topLevelNames(code).has(key)) return `${key} is already declared in the sketch: select it in the code and use Make it a slider (or toggle, or button).`;
  return null;
}

/** Labels from keys: `dotCount` → `Dot count`, `max_size` → `Max size`. */
export function labelFromKey(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Does the key read like a number of things (so the builder offers the array first)? */
export function looksLikeCount(key: string): boolean {
  return /^(n|num|count|amount|total|number)([A-Z_\d]|$)/.test(key) || /(Count|Num|Amount|Total|_count|_num)$/.test(key);
}

/**
 * The sketch with a new control: an entry in params (created if needed), a top-level `let`
 * the control drives (sliders and toggles), and the helper's code placed in setup / draw.
 * `startAt` is the value the layer should start the control at.
 */
export function addControl(code: string, c: NewControl, builtins: readonly string[] = []): { code: string; entry: string; startAt?: number } | { error: string } {
  const key = c.key.trim();
  const problem = controlKeyProblem(code, key, builtins);
  if (problem) return { error: problem };
  const label = (c.label ?? '').trim() || labelFromKey(key);
  const q = (t: string) => `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const helper = c.helper ?? 'none';
  let out: string, entry: string, startAt: number | undefined;
  if (c.kind === 'slider') {
    const counting = helper === 'loop' || helper === 'array';
    const min = Number.isFinite(c.min) ? c.min! : 0;
    const max = Number.isFinite(c.max) ? c.max! : Math.max(1, min + 1);
    if (!(max > min)) return { error: 'Max has to be more than min.' };
    const step = Number.isFinite(c.step) && c.step! > 0 ? c.step : counting ? 1 : undefined;
    let value = typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : min;
    value = Math.min(max, Math.max(min, counting ? Math.round(value) : value));
    entry = `${key}: { value: ${num(value)}, min: ${num(min)}, max: ${num(max)}${step ? `, step: ${num(step)}` : ''}, label: ${q(label)} }`;
    out = placeCode(addParamEntry(code, entry), 'top', `let ${key} = ${num(value)};`);
    startAt = value;
    if (helper === 'loop') {
      out = placeCode(out, 'draw', `// One of each for ${label}: i counts 0, 1, 2… up to ${key}.
for (let i = 0; i < ${key}; i++) {
  const x = (i + 0.5) * width / ${key};
  circle(x, height / 2, 10);
}`);
    } else if (helper === 'array') {
      const arr = code.includes('s.state.items') ? `${key}Items` : 'items';
      out = placeCode(out, 'setup', `s.state.${arr} = [];`);
      out = placeCode(out, 'draw', `// As many items as ${label}: add new ones, drop extras, then draw them.
while (s.state.${arr}.length < ${key}) s.state.${arr}.push({ x: random(width), y: random(height) });
s.state.${arr}.length = Math.floor(${key});
for (const it of s.state.${arr}) circle(it.x, it.y, 10);`);
    }
  } else if (c.kind === 'toggle') {
    const on = c.value === true || (typeof c.value === 'number' && c.value >= 0.5);
    entry = `${key}: { kind: 'toggle', value: ${on}, label: ${q(label)} }`;
    out = placeCode(addParamEntry(code, entry), 'top', `let ${key} = ${on};`);
    startAt = on ? 1 : 0;
    if (helper === 'if') out = placeCode(out, 'draw', `if (${key}) {\n  // while ${label} is on\n}`);
  } else {
    entry = `${key}: { kind: 'button', label: ${q(label)} }`;
    out = addParamEntry(code, entry);
    if (helper === 'if') out = placeCode(out, 'draw', `if (s.pressed('${key}')) {\n  // once, on the frame ${label} is pressed\n}`);
  }
  return { code: out, entry, startAt };
}

// ── The layer card's glimpse of the sketch ───────────────────────────────────

/**
 * The first lines of the sketch's draw function's body, dedented, for the
 * layer card: `function draw(…) {`, `draw = function / (…) => {`, or an
 * instance-mode `p.draw = …`, in the main file or any other. Without a draw,
 * the main file's first lines. `more` says whether it goes on.
 */
export function drawPreviewLines(files: ReadonlyArray<{ name: string; code: string }>, max = 8): { file: string; lines: string[]; more: boolean } {
  const re = /(?:^|[^\w$.])function\s+draw\s*\([^)]*\)\s*\{|(?:^|[^\w$])(?:[A-Za-z_$][\w$]*\.)?draw\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{/m;
  for (const f of files) {
    const m = re.exec(f.code);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    const close = matchBrace(f.code, open);
    const body = f.code.slice(open + 1, close < 0 ? undefined : close).replace(/^[ \t]*\n/, '').replace(/\s+$/, '');
    const all = body.split('\n');
    const indent = Math.min(99, ...all.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)![0].length));
    const lines = all.map(l => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length)));
    return { file: f.name, lines: lines.slice(0, max), more: lines.length > max };
  }
  const lines = (files[0]?.code ?? '').replace(/^\s*\n/, '').split('\n');
  return { file: files[0]?.name ?? 'sketch.js', lines: lines.slice(0, max), more: lines.length > max };
}
