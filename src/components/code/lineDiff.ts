/**
 * Which lines of `after` are new or changed since `before`, as runs of line
 * indexes [first, last]. Used to flash what an insert just put in a code
 * field. Common lines are matched by a longest-common-subsequence over the
 * part between the shared start and end, which is small for an insert.
 */
export function changedLines(before: string, after: string): Array<[number, number]> {
  const a = before.split('\n'), b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail), B = b.slice(head, b.length - tail);
  if (!B.length) return [];
  const added = new Array<boolean>(B.length).fill(true);
  if (A.length && A.length * B.length <= 250_000) {
    // LCS table from the end, then walk it: lines of B not in the common subsequence are new.
    const w = B.length + 1;
    const t = new Uint16Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) {
      t[i * w + j] = A[i] === B[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { added[j] = false; i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  const runs: Array<[number, number]> = [];
  for (let j = 0; j < B.length; j++) {
    if (!added[j]) continue;
    // Blank lines only join a run; they do not start one.
    if (!B[j].trim() && !(runs.length && runs[runs.length - 1][1] === head + j - 1)) continue;
    if (runs.length && runs[runs.length - 1][1] === head + j - 1) runs[runs.length - 1][1] = head + j;
    else runs.push([head + j, head + j]);
  }
  // Trailing blank lines off the ends of runs.
  for (const r of runs) while (r[1] > r[0] && !b[r[1]].trim()) r[1]--;
  return runs;
}
