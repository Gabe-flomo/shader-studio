/**
 * recipeRows.ts — the Recipe tab's row edits on recipe text: replace a clause (a row edited),
 * move one (drag, or ▲▼ on a touch screen), delete one. Rows are the clauses of
 * highlight.ts `splitClauses`; the result is the clauses again, one a line. Pure.
 */
import { splitClauses } from './highlight';

const join = (clauses: string[]) => clauses.filter(c => c.trim()).join('\n');

/** The text with clause `index` replaced by `text` (several clauses, or none, are fine). */
export function replaceClause(src: string, index: number, text: string): string {
  const cs = splitClauses(src).map(c => c.text);
  cs[index] = text.trim();
  return join(cs);
}

/** The text with clause `from` moved to position `to`. */
export function moveClause(src: string, from: number, to: number): string {
  const cs = splitClauses(src).map(c => c.text);
  if (from < 0 || from >= cs.length) return src;
  const [c] = cs.splice(from, 1);
  cs.splice(Math.max(0, Math.min(cs.length, to)), 0, c);
  return join(cs);
}

/** The text without clause `index`. */
export function deleteClause(src: string, index: number): string {
  const cs = splitClauses(src).map(c => c.text);
  cs.splice(index, 1);
  return join(cs);
}
