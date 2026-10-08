/**
 * thinking.ts — a thinking model (Qwen3) writes `<think> … </think>` first and then the answer. The reasoning is
 * not the answer: it is hidden behind "Show reasoning", and everything that reads the answer (the JSON parser,
 * the confidence signals) reads only what comes after `</think>`. Pure.
 */

export interface Split {
  /** The reasoning, without the tags ('' when there is none). */
  thinking: string;
  /** The answer: what follows `</think>` (the whole text for a model that does not think). */
  answer: string;
  /** Where the answer starts in the raw text (so token positions can be shifted). */
  answerStart: number;
  /** A `<think>` opened and has not closed: the model is still reasoning. */
  thinkingNow: boolean;
}

const OPEN = '<think>';
const CLOSE = '</think>';

export function splitThinking(raw: string): Split {
  const open = raw.indexOf(OPEN);
  const close = raw.indexOf(CLOSE);
  if (open < 0 && close < 0) {
    // A partial tag at the very end ("<thi") is not text yet
    const tail = /<\/?t?h?i?n?k?>?$/.exec(raw);
    const cut = tail && tail[0].length > 0 && (OPEN.startsWith(tail[0]) || CLOSE.startsWith(tail[0])) ? tail.index : raw.length;
    return { thinking: '', answer: raw.slice(0, cut), answerStart: 0, thinkingNow: false };
  }
  if (close >= 0) {
    const from = open >= 0 && open < close ? open + OPEN.length : 0;
    const start = close + CLOSE.length;
    const lead = raw.slice(start).match(/^\s*/)![0].length;
    return { thinking: raw.slice(from, close).trim(), answer: raw.slice(start + lead), answerStart: start + lead, thinkingNow: false };
  }
  // Opened, not closed
  return { thinking: raw.slice(open + OPEN.length).trim(), answer: '', answerStart: raw.length, thinkingNow: true };
}
