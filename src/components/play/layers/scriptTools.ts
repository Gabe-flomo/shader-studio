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

function paramsBlock(code: string): { start: number; open: number; close: number } | null {
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
function addParamEntry(code: string, entry: string): string {
  const block = paramsBlock(code);
  if (!block) return `const params = {\n  ${entry},\n};\n\n${code}`;
  const inner = code.slice(block.open + 1, block.close);
  const needsComma = inner.trim().length > 0 && !inner.trim().endsWith(',');
  const indent = inner.match(/\n([ \t]+)\S/)?.[1] ?? '  ';
  return `${code.slice(0, block.close).replace(/\s*$/, '')}${needsComma ? ',' : ''}\n${indent}${entry},\n${code.slice(block.close)}`;
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
