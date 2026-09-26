/**
 * nodeSlice — which lines of a generated shader belong to one node. The
 * compiler names every variable a node writes `<slug>_…` (nodeSlugMap gives
 * the slug), so a node's lines are the ones naming its slug. The code panel
 * marks these lines for the selected node; a Present code block quotes them.
 */
export function nodeSlicePrefix(slug: string): string {
  return `${slug}_`;
}

/** 0-based indices of the lines of `code` that belong to the node with this slug. */
export function nodeSliceLines(code: string, slug: string): number[] {
  const prefix = nodeSlicePrefix(slug);
  const out: number[] = [];
  code.split('\n').forEach((line, i) => { if (line.includes(prefix)) out.push(i); });
  return out;
}
