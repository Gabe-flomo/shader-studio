/**
 * A live feed's messages as rows. Pure: the stream runtime, take replay and
 * the tests all read messages the same way.
 *
 *  - JSON: an object is one row; an array of objects is several; an object
 *    holding one array of records (`{ rows: [...] }`, `{ data: [...] }`,
 *    any single such key) is those records; an array of numbers is one row
 *    (c1, c2…). Nested objects are flattened one level deep with dots
 *    (`{ pos: { x: 1 } }` → `pos.x`).
 *  - CSV / TSV: each line is a row. A first line that reads as names (not
 *    numbers) is the header; without one, columns are c1, c2…
 *  - OSC: one row per message: `address`, then `value`, `value2`… for its
 *    arguments.
 */
import { readNumber, isMissing, splitCsv } from '../parse';
import type { DatasetFormat, NotebookCell } from '../types';

export type Row = Record<string, unknown>;

/** Carried from message to message: a CSV feed's header, once seen. */
export interface LineState { header: string[] | null }
export const newLineState = (): LineState => ({ header: null });

const MAX_ROWS_PER_MESSAGE = 10_000;
const MAX_KEYS = 256;

const flat = (v: unknown) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** A record with nested objects flattened one level (`pos.x`); deeper values and arrays are kept as they are. */
export function flattenRecord(o: Record<string, unknown>): Row {
  const out: Row = {};
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (n >= MAX_KEYS) break;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) { out[`${k}.${k2}`] = v2; if (++n >= MAX_KEYS) break; }
    } else { out[k] = v; n++; }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A parsed JSON message as rows (see the module comment). */
export function jsonToRows(value: unknown): Row[] {
  if (Array.isArray(value)) {
    if (value.length && value.every(v => typeof v === 'number' || v === null)) {
      return [Object.fromEntries(value.slice(0, MAX_KEYS).map((v, i) => [`c${i + 1}`, v]))];
    }
    return value.filter(isRecord).slice(0, MAX_ROWS_PER_MESSAGE).map(flattenRecord);
  }
  if (isRecord(value)) {
    const arrays = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord));
    const preferred = arrays.find(([k]) => ['rows', 'data', 'records', 'items', 'results', 'features'].includes(k));
    const pick = preferred ?? (arrays.length === 1 ? arrays[0] : null);
    if (pick) return (pick[1] as Record<string, unknown>[]).slice(0, MAX_ROWS_PER_MESSAGE).map(r => flattenRecord(r.properties && isRecord(r.properties) && pick[0] === 'features' ? r.properties : r));
    return [flattenRecord(value)];
  }
  if (typeof value === 'number') return [{ value }];
  return [];
}

/** A CSV field as a value: a number when it reads as one, else the text (empty and NA → null). */
export function fieldValue(s: string): unknown {
  if (isMissing(s)) return null;
  const n = readNumber(s, 'plain');
  if (n !== null) return n;
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}

/** CSV lines as rows; the first line that reads as names sets the header for the rest of the feed. */
export function csvLinesToRows(text: string, state: LineState, delimiter?: string): Row[] {
  const d = delimiter ?? (text.includes('\t') ? '\t' : text.includes(';') && !text.includes(',') ? ';' : ',');
  const lines = splitCsv(text.replace(/^\uFEFF/, ''), d).filter(r => r.some(f => f.trim() !== ''));
  const rows: Row[] = [];
  for (const fields of lines.slice(0, MAX_ROWS_PER_MESSAGE)) {
    // A feed that sends its whole table each time (a polled CSV) repeats the header: skip it.
    if (state.header && fields.length === state.header.length && fields.every((f, i) => f.trim() === state.header![i])) continue;
    if (!state.header && fields.every(f => f.trim() !== '' && readNumber(f, 'plain') === null)) {
      state.header = fields.map((f, i) => f.trim() || `c${i + 1}`);
      continue;
    }
    const names = state.header ?? fields.map((_, i) => `c${i + 1}`);
    const row: Row = {};
    fields.forEach((f, i) => { row[names[i] ?? `c${i + 1}`] = fieldValue(f); });
    rows.push(row);
  }
  return rows;
}

/**
 * One message's rows. `format` is the stream's (unset: JSON when the text
 * parses as JSON, else CSV lines). Messages that don't read give no rows and
 * an error to show.
 */
export function messageToRows(data: unknown, state: LineState, format?: DatasetFormat): { rows: Row[]; error?: string } {
  if (typeof data !== 'string') return { rows: jsonToRows(data) };
  const text = data.trim();
  if (!text) return { rows: [] };
  if (format === 'csv' || format === 'tsv') return { rows: csvLinesToRows(text, state, format === 'tsv' ? '\t' : undefined) };
  if (format === 'text') return { rows: text.split(/\r?\n/).filter(Boolean).map(line => ({ text: line })) };
  if (format === 'json' || text.startsWith('{') || text.startsWith('[')) {
    try { return { rows: jsonToRows(JSON.parse(text)) }; } catch (e) {
      // Several JSON objects, one per line (ndjson).
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length > 1) {
        try { return { rows: lines.flatMap(l => jsonToRows(JSON.parse(l))) }; } catch { /* fall through */ }
      }
      if (format === 'json') return { rows: [], error: `A message wasn’t JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { rows: csvLinesToRows(text, state) };
}

/** An OSC message as a row: its address, then its arguments as value, value2… */
export function oscToRow(address: string, args: ReadonlyArray<number | string | boolean>): Row {
  const row: Row = { address };
  args.slice(0, 32).forEach((v, i) => { row[i === 0 ? 'value' : `value${i + 1}`] = v; });
  return row;
}

/** Does an OSC address match the stream's filter? Empty or `*` takes everything; a trailing `*` matches a prefix. */
export function oscMatches(filter: string, address: string): boolean {
  const f = filter.trim();
  if (!f || f === '*' || f === '/*') return true;
  if (f.endsWith('*')) return address.startsWith(f.slice(0, -1));
  return address === f || address.startsWith(f.endsWith('/') ? f : `${f}/`);
}

/** The notebook only shows the data (`df`, `data`, or nothing): a stream's window goes straight to readers. */
export function isPassThrough(cells: ReadonlyArray<NotebookCell>): boolean {
  return cells.every(c => /^\s*(?:(?:df|data|result)\s*;?\s*)?$/.test(c.code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
}

/** Keep rows' values flat (numbers, text, booleans, null); anything nested becomes its JSON text. */
export function flatRows(rows: Row[]): Row[] {
  return rows.map(r => {
    let ok = true;
    for (const v of Object.values(r)) if (!flat(v)) { ok = false; break; }
    if (ok) return r;
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = flat(v) ? v : JSON.stringify(v);
    return out;
  });
}
