/**
 * docSummary.ts — the short lead of a node's description, for the node info card and the node
 * browsers (NodeInfoCard.tsx). The split is mechanical: the first sentence (two when the first is
 * very short) of the first paragraph is the summary, and everything after it, exactly as written,
 * is the rest, shown behind "More". Nothing is reworded or dropped.
 */

/** Sentences shorter than this pull in the next one, so the summary says enough on its own. */
export const SUMMARY_MIN_CHARS = 60;
/** A first paragraph this short is the summary on its own when its first sentence is very short. */
export const SUMMARY_MAX_PARAGRAPH = 200;

/** A sentence ends at . ! or ? followed by space and a capital, a digit, a quote, a bracket or a `code` chip. */
const SENTENCE_END = /[.!?…](?=\s+[A-Z0-9`"'(*“‘])/g;

export function splitSummary(text: string | undefined | null): { summary: string; rest: string } {
  const src = (text ?? '').replace(/\r\n/g, '\n');
  const lead = src.length - src.trimStart().length;
  const body = src.slice(lead);
  if (!body.trim()) return { summary: '', rest: '' };
  // A description that opens with a list has no sentence to lead with: show it whole.
  if (/^[-*•]\s+/.test(body)) return { summary: body.trimEnd(), rest: '' };
  // The first paragraph ends at a blank line or where a list starts.
  const blockEnd = (() => {
    const m = /\n\s*\n|\n\s*[-*•]\s+/.exec(body);
    return m ? m.index : body.length;
  })();
  const block = body.slice(0, blockEnd);
  let end = -1;
  let sentences = 0;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(block); m; m = SENTENCE_END.exec(block)) {
    end = m.index + 1;
    sentences++;
    if (end >= SUMMARY_MIN_CHARS || sentences >= 2) break;
  }
  // One sentence (or none), or a short lead whose paragraph is short too: the whole first paragraph.
  if (end < 0 || (end < SUMMARY_MIN_CHARS && block.trim().length <= SUMMARY_MAX_PARAGRAPH)) end = block.length;
  const summary = body.slice(0, end).trim();
  const rest = body.slice(end).replace(/^\s+/, '').trimEnd();
  return { summary, rest };
}

/** A docstring as one plain line (no `code` ticks, **bold** marks or line breaks), for truncated rows and tooltips. */
export function plainLine(text: string | undefined | null): string {
  return (text ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}
