/**
 * structured.ts — reading the model's JSON answer, tolerantly (docs/explain-model.md "Structured answers").
 *
 * The model is asked for a small JSON object per line: {"line", "what", "effect", "sure", "unsure_about"}, and for a
 * block a {"summary"} first. A 1.5B model streams it, wraps it in code fences, forgets a quote, or ignores the
 * format. So this reads whatever is there so far:
 *   - complete objects, and the one still being written (its fields up to the last character received),
 *   - code fences, a surrounding array, stray text between objects,
 *   - garbage: no object with a known field → `structured: false`, and the caller shows the plain text.
 * It also reports where each answer's words sit in the text, so token probabilities can be limited to them.
 * Pure.
 */

export type Sure = 'high' | 'medium' | 'low';

export interface ExplainItem {
  line?: number;
  what?: string;
  effect?: string;
  /** What the model said about itself. Undefined while it has not got there yet (or never said). */
  sure?: Sure;
  unsureAbout?: string;
  /** The closing brace arrived. */
  complete: boolean;
  /** [start, end) of the what / effect values in the raw text (for token alignment). */
  spans: Array<[number, number]>;
}

export interface ParsedExplain {
  /** At least one object with a known field was found. */
  structured: boolean;
  summary?: string;
  items: ExplainItem[];
  /** The text without code fences: what to show when `structured` is false. */
  plain: string;
}

const KNOWN = ['line', 'what', 'effect', 'sure', 'unsure_about', 'unsureAbout', 'summary'];

/** Top-level `{…}` ranges, string-aware; the last may be open. */
function objectRanges(text: string): Array<{ start: number; end: number; closed: boolean }> {
  const out: Array<{ start: number; end: number; closed: boolean }> = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0) { out.push({ start, end: i + 1, closed: true }); start = -1; } }
  }
  if (depth > 0 && start >= 0) out.push({ start, end: text.length, closed: false });
  return out;
}

const unescape = (s: string): string => {
  try { return JSON.parse(`"${s}"`) as string; } catch { return s.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\'); }
};

/** A string field's value as far as it has arrived, with its [start, end) in the text. */
function stringField(obj: string, base: number, key: string): { value: string; span: [number, number] } | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("|$)`).exec(obj);
  if (!m) return undefined;
  const start = base + m.index + m[0].indexOf('"', m[0].indexOf(':')) + 1;
  return { value: unescape(m[1]), span: [start, start + m[1].length] };
}

const SURE = /^(high|medium|low)$/i;

function readObject(text: string, r: { start: number; end: number; closed: boolean }): { item?: ExplainItem; summary?: string } {
  const obj = text.slice(r.start, r.end);
  if (!KNOWN.some(k => obj.includes(`"${k}"`))) return {};
  const summary = stringField(obj, r.start, 'summary');
  const what = stringField(obj, r.start, 'what');
  const effect = stringField(obj, r.start, 'effect');
  const unsure = stringField(obj, r.start, 'unsure_about') ?? stringField(obj, r.start, 'unsureAbout');
  const sure = /"sure"\s*:\s*"([A-Za-z]*)"/.exec(obj)?.[1];
  const line = /"line"\s*:\s*"?(\d+)/.exec(obj)?.[1];
  if (summary && !what && !effect) return { summary: summary.value.trim() };
  if (!what && !effect && !sure && !unsure && !line) return {};
  return {
    item: {
      line: line ? Number(line) : undefined,
      what: what?.value.trim(),
      effect: effect?.value.trim(),
      sure: sure && SURE.test(sure) ? (sure.toLowerCase() as Sure) : undefined,
      unsureAbout: unsure ? unsure.value.trim() : undefined,
      complete: r.closed,
      spans: [what?.span, effect?.span].filter((x): x is [number, number] => !!x),
    },
  };
}

/** Parse the answer so far. Safe on any text, including a half-written object and plain prose. */
export function parseExplain(raw: string): ParsedExplain {
  const plain = raw.replace(/```(?:json)?/gi, '').trim();
  const items: ExplainItem[] = [];
  let summary: string | undefined;
  for (const r of objectRanges(raw)) {
    const got = readObject(raw, r);
    if (got.summary !== undefined) summary = got.summary;
    if (got.item) items.push(got.item);
  }
  return { structured: items.length > 0 || summary !== undefined, summary, items, plain };
}

/** Is the answer's text the model's own plain prose rather than the format (so far)? Prose has no `{` at all. */
export const looksStructured = (raw: string): boolean => raw.includes('{') || raw.trim() === '';
