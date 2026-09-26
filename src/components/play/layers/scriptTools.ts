/**
 * scriptTools — text edits on a sketch the editor offers as one click.
 *
 * `sliderCandidate(code, selection)`: is the selected word a top-level
 * variable set to a number (`let speed = 2;`)? Then it can become a slider.
 * `makeSlider(code, name)`: add it to the params object (creating one if
 * there is none), keep the declaration but make it `let`, so the kit can
 * drive the variable from the slider each frame. Nothing else in the sketch
 * changes: `speed` is still `speed`.
 */

export interface SliderCandidate { name: string; value: number; declStart: number; declEnd: number; keyword: 'const' | 'let' | 'var' }

const IDENT = /^[A-Za-z_]\w*$/;

/** The declaration `const|let|var NAME = <number>;` at the top level (start of a line), if any. */
export function findNumericDeclaration(code: string, name: string): SliderCandidate | null {
  if (!IDENT.test(name)) return null;
  const re = new RegExp(`^[ \\t]*(const|let|var)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`, 'm');
  const m = re.exec(code);
  if (!m) return null;
  return { name, value: Number(m[2]), declStart: m.index, declEnd: m.index + m[0].length, keyword: m[1] as SliderCandidate['keyword'] };
}

/** What the editor's selection points at: a candidate, or null. */
export function sliderCandidate(code: string, selected: string): SliderCandidate | null {
  const name = selected.trim();
  if (!name || !IDENT.test(name)) return null;
  if (declaredParams(code).includes(name)) return null;
  return findNumericDeclaration(code, name);
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

/** The sketch with `name` as a slider: an entry in params (created if needed) and a `let` declaration. */
export function makeSlider(code: string, name: string, range = guessRange(findNumericDeclaration(code, name)?.value ?? 1)): { code: string; entry: string } | null {
  const decl = findNumericDeclaration(code, name);
  if (!decl) return null;
  const entry = `${name}: { value: ${num(decl.value)}, min: ${num(range.min)}, max: ${num(range.max)}${range.step ? `, step: ${num(range.step)}` : ''} }`;
  let out = code;
  const block = paramsBlock(out);
  if (block) {
    const inner = out.slice(block.open + 1, block.close);
    const needsComma = inner.trim().length > 0 && !inner.trim().endsWith(',');
    const indent = inner.match(/\n([ \t]+)\S/)?.[1] ?? '  ';
    out = `${out.slice(0, block.close).replace(/\s*$/, '')}${needsComma ? ',' : ''}\n${indent}${entry},\n${out.slice(block.close)}`;
  } else {
    out = `const params = {\n  ${entry},\n};\n\n${out}`;
  }
  // The declaration may have moved; find it again and make it a let so the slider can write it.
  const again = findNumericDeclaration(out, name)!;
  if (again.keyword === 'const') out = `${out.slice(0, again.declStart)}${out.slice(again.declStart, again.declEnd).replace(/^(\s*)const\b/, '$1let')}${out.slice(again.declEnd)}`;
  return { code: out, entry };
}
