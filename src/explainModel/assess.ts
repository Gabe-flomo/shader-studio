/**
 * assess.ts — from a model's raw text to what the UI shows: the reasoning split off, the JSON read, and one
 * confidence (dot + tag) for each explained line. Pure; the signals live in confidence.ts.
 */
import { assessItem, assessNode, assessPlain, consistency, type Confidence, type GroundingContext, type TokenLp } from './confidence';
import { parseExplain, type ExplainItem } from './structured';
import { splitThinking, type Split } from './thinking';

export interface AssessedItem { item: ExplainItem; confidence: Confidence | null }

export interface AnswerView {
  split: Split;
  /** Nothing of the answer has arrived yet (still thinking, or the first token is coming). */
  empty: boolean;
  summary?: string;
  items: AssessedItem[];
  /** The answer was not in the expected format (or a node explanation): show this text. */
  plain?: { text: string; confidence: Confidence | null };
  /** The model ran out of tokens while still thinking. */
  ranOut: boolean;
}

export interface AssessOptions {
  kind: 'line' | 'block' | 'node';
  raw: string;
  tokens?: readonly TokenLp[];
  check?: GroundingContext;
  lineNo?: number;
  /** The double-check's extra answers (raw texts). */
  samples?: readonly string[];
  /** Generation finished: confidence is only given for a finished answer. */
  done: boolean;
}

/** Sample items by line number (block) or the first item (line). */
function sampleItem(sample: string, line: number | undefined): ExplainItem | undefined {
  const items = parseExplain(splitThinking(sample).answer).items;
  return line === undefined ? items[0] : items.find(i => i.line === line) ?? items[0];
}

export function viewAnswer(o: AssessOptions): AnswerView {
  const split = splitThinking(o.raw);
  const base = { split, items: [] as AssessedItem[], ranOut: o.done && split.thinkingNow };
  if (o.kind === 'node') {
    const text = split.answer.trim();
    return { ...base, empty: !text, plain: text ? { text, confidence: o.done ? assessNode({ tokens: o.tokens, raw: o.raw }) : null } : undefined };
  }
  const parsed = parseExplain(split.answer);
  if (!parsed.structured) {
    const text = parsed.plain;
    // While streaming, wait for a `{` or enough text to know it is prose
    if (!o.done && text.length < 24) return { ...base, empty: true };
    return {
      ...base, empty: !text,
      plain: text ? { text, confidence: o.done ? assessPlain(text, { tokens: o.tokens, raw: o.raw }) : null } : undefined,
    };
  }
  const items = parsed.items.map((item): AssessedItem => {
    if (!o.done) return { item, confidence: null };
    const spans = item.spans.map(([a, b]) => [a + split.answerStart, b + split.answerStart] as [number, number]);
    const asked = o.kind === 'line' ? o.lineNo : item.line;
    let cons: number | null | undefined;
    if (o.samples?.length) {
      const others = o.samples.map(s => sampleItem(s, o.kind === 'block' ? item.line : undefined)).filter((x): x is ExplainItem => !!x);
      cons = consistency([item, ...others]);
    }
    const confidence = assessItem({ ...item, spans }, { g: o.check, askedLine: asked, tokens: o.tokens, raw: o.raw, consistency: cons });
    return { item, confidence };
  });
  return { ...base, empty: false, summary: parsed.summary, items };
}
