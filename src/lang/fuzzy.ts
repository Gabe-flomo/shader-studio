/**
 * fuzzy.ts — the one way every text surface forgives a typo (docs/playfield-language-plan.md, D2).
 *
 * Before this the Do… bar allowed none under 4 letters, 1 under 7 and 2 above, and the recipe's
 * "did you mean" allowed max(1, len/3). Both now use the bar's budget, which is stricter and was
 * already tested on "blue" vs "blur": a short word is never guessed into another.
 */

/** Edit distance (insert, delete, substitute, swap of neighbours), stopping past `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      // Two letters swapped ("dpeth") is one slip.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How far a typed word may be from a known word: none under 4 letters, 1 under 7, else 2. */
export const fuzzBudget = (word: string) => (word.length < 4 ? 0 : word.length < 7 ? 1 : 2);

/** The known word nearest to `word` within its budget ("did you mean"), or null. Ties: the first in `among`. */
export function suggest(word: string, among: readonly string[]): string | null {
  const w = word.toLowerCase();
  const budget = fuzzBudget(w);
  if (!budget) return null;
  let best: string | null = null, bestD = budget + 1;
  for (const c of among) {
    const d = editDistance(w, c.toLowerCase(), budget);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
