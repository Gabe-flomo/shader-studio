/**
 * Where a name in an Expression Block line comes from: the block input it is, and the lines above
 * that set it (`float size = …`, `p.xy += …`). Hovering a name in a line for two seconds shows this
 * (ExprBlockModal.tsx, CodeInput's `nameInfo`).
 */

export interface OriginLine { lhs: string; op?: string; rhs: string; off?: boolean }

export type NameOrigin =
  | { kind: 'input'; name: string; type: string }
  | { kind: 'line'; index: number; text: string; declares: boolean };

const TYPED = /^\s*(?:const\s+)?(?:float|int|uint|bool|[iu]?vec[234]|bvec[234]|mat[234](?:x[234])?)\s+([A-Za-z_]\w*)/;
const PLAIN = /^\s*([A-Za-z_]\w*)/;

/** The variable a line's target sets: `float size` → size, `p.xy` → p, `col[1]` → col. */
export function lineTargetName(lhs: string): { name: string; declares: boolean } | null {
  const t = TYPED.exec(lhs);
  if (t) return { name: t[1], declares: true };
  const p = PLAIN.exec(lhs);
  return p ? { name: p[1], declares: false } : null;
}

/**
 * Where `name` was given its value before line `before` ('end': before Return): the input it is,
 * the line that declares it and the lines that change it after that (the last few). Lines switched
 * off are skipped. Empty when it is none of these (a built-in like uv or time, a function).
 */
export function nameOrigins(
  name: string, lines: readonly OriginLine[], inputs: ReadonlyArray<{ name: string; type: string }>, before: number | 'end', max = 3,
): NameOrigin[] {
  const end = before === 'end' ? lines.length : Math.min(before, lines.length);
  const sets: NameOrigin[] = [];
  for (let i = 0; i < end; i++) {
    const l = lines[i];
    if (l.off || !l.rhs.trim()) continue;
    const t = lineTargetName(l.lhs);
    if (!t || t.name !== name) continue;
    // A new declaration starts over: what came before it is a different variable
    if (t.declares) sets.length = 0;
    sets.push({ kind: 'line', index: i, text: `${l.lhs.trim()} ${l.op || '='} ${l.rhs.trim()}`, declares: t.declares });
  }
  const input = inputs.find(i => i.name === name);
  const out: NameOrigin[] = [];
  if (input && !(sets[0]?.kind === 'line' && sets[0].declares)) out.push({ kind: 'input', name: input.name, type: input.type });
  // The declaration, then the latest changes
  if (sets.length <= max) out.push(...sets);
  else out.push(sets[0], ...sets.slice(sets.length - (max - 1)));
  return out;
}

/** The identifier at character `at` of `text`, with its span; null on anything else. */
export function nameAt(text: string, at: number): { name: string; start: number; end: number } | null {
  if (at < 0 || at > text.length) return null;
  const word = /[A-Za-z_0-9]/;
  let s = at, e = at;
  while (s > 0 && word.test(text[s - 1])) s--;
  while (e < text.length && word.test(text[e])) e++;
  if (e === s) return null;
  const name = text.slice(s, e);
  // Not a number, and not a field after a dot (p.xy: xy is a swizzle, not a name)
  if (!/^[A-Za-z_]/.test(name) || (s > 0 && text[s - 1] === '.')) return null;
  return { name, start: s, end: e };
}
