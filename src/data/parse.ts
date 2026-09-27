/**
 * Turning a file's text into a dataset result. Pure functions of text, so the
 * same code reads a picked file, a dropped one, or (later) fetched text.
 *
 *  - CSV / TSV: quoted fields (with "" escapes and line breaks inside), a BOM,
 *    the delimiter sniffed (comma, tab, semicolon, pipe), the header row
 *    detected, and each column typed. A column is a number column when every
 *    non-empty value reads as a number the same way: plain (1,234.5), percent
 *    (45% → 0.45), money ($12.50 → 12.5) or a date (days since 1 Jan 1970).
 *  - JSON: an array of flat records becomes a table; anything else is kept as
 *    a value.
 *  - Text: kept as a string.
 */
import {
  DATASET_MAX_COLUMNS, DATASET_MAX_ROWS, numericRange,
  type Column, type DatasetFormat, type DatasetResult, type HeaderMode, type TableResult,
} from './types';

// ── CSV ───────────────────────────────────────────────────────────────────────

const DELIMITERS = [',', '\t', ';', '|'];

/** Split CSV text into rows of fields (RFC 4180, forgiving: a stray quote mid-field is kept as text). */
export function splitCsv(text: string, delimiter: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') {
      endRow();
      if (rows.length >= maxRows) return rows;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** The delimiter that splits the first lines into the most consistent (and widest) rows. */
export function sniffDelimiter(text: string, hint?: DatasetFormat): string {
  if (hint === 'tsv') return '\t';
  const sample = text.slice(0, 64 * 1024);
  let best = ',', bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = splitCsv(sample, d, 30).filter(r => r.some(f => f.trim() !== ''));
    if (rows.length === 0) continue;
    const widths = rows.slice(0, rows.length > 1 && !sample.endsWith('\n') ? -1 : undefined).map(r => r.length);
    if (!widths.length) continue;
    const first = widths[0];
    if (first < 2) continue;
    const same = widths.filter(w => w === first).length / widths.length;
    const score = same * 100 + Math.min(first, 50);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '—', '#n/a', 'undefined']);
export const isMissing = (s: string) => MISSING.has(s.trim().toLowerCase());

const PLAIN = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const MONEY = /^[+-]?[$€£¥]\s?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PERCENT = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s?%$/;
const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

type NumberKind = 'plain' | 'percent' | 'money' | 'date';

function readPlain(s: string): number | null {
  const t = s.trim();
  if (!t || !PLAIN.test(t) || !/\d/.test(t)) return null;
  const v = Number(t.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** A value as a number of one kind, or null when it doesn't read that way. */
export function readNumber(s: string, kind: NumberKind): number | null {
  const t = s.trim();
  switch (kind) {
    case 'plain': return readPlain(t);
    case 'percent': {
      if (!PERCENT.test(t) || !/\d/.test(t)) return null;
      const v = Number(t.replace(/[%,\s]/g, ''));
      return Number.isFinite(v) ? v / 100 : null;
    }
    case 'money': {
      if (!MONEY.test(t)) return null;
      const neg = t.includes('-');
      const v = Number(t.replace(/[$€£¥,\s+-]/g, ''));
      return Number.isFinite(v) ? (neg ? -v : v) : null;
    }
    case 'date': {
      const m = ISO_DATE.exec(t);
      if (!m) return null;
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo < 1 || mo > 12 || d < 1 || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
      const iso = `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        + (m[4] ? `T${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}${m[7] ? (m[7] === 'Z' ? 'Z' : m[7].length === 5 ? m[7] : `${m[7].slice(0, 3)}:${m[7].slice(3)}`) : 'Z'}` : 'T00:00:00Z');
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return null;
      return ms / 86_400_000;
    }
  }
}

/** Type a column of raw strings: numbers when every present value reads as one kind of number, else text (category). */
export function typeColumn(name: string, raw: ReadonlyArray<string | null | undefined>): Column {
  const present = raw.filter((v): v is string => typeof v === 'string' && !isMissing(v));
  if (present.length > 0) {
    for (const kind of ['plain', 'percent', 'money', 'date'] as NumberKind[]) {
      if (present.every(v => readNumber(v, kind) !== null)) {
        const values = raw.map(v => (typeof v === 'string' && !isMissing(v) ? readNumber(v, kind) : null));
        return { name, type: 'number', values, ...numericRange(values) };
      }
    }
  }
  return { name, type: 'category', values: raw.map(v => (typeof v === 'string' && !isMissing(v) ? v.trim() : null)) };
}

const looksNumeric = (s: string) => (['plain', 'percent', 'money', 'date'] as NumberKind[]).some(k => readNumber(s, k) !== null);

/**
 * Is the first row a header? Yes when one of its cells isn't a number while
 * the column under it mostly is, or when it has no numbers, no blanks and
 * distinct names. A first row with any number in it never is.
 */
export function detectHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const first = rows[0];
  const filled = first.filter(c => c.trim() !== '');
  if (filled.length === 0 || filled.some(c => looksNumeric(c))) return false;
  const body = rows.slice(1, 50);
  if (body.length === 0) return true;
  for (let c = 0; c < first.length; c++) {
    if (first[c].trim() === '') continue;
    const below = body.map(r => r[c]).filter((v): v is string => typeof v === 'string' && !isMissing(v));
    if (below.length && below.filter(looksNumeric).length / below.length > 0.8) return true;
  }
  const names = new Set(first.map(c => c.trim().toLowerCase()));
  return filled.length === first.length && names.size === first.length;
}

/** Column names: trimmed, blank ones filled in, duplicates numbered. */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    let n = raw.trim() || `column ${i + 1}`;
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    if (k > 0) { n = `${n} ${k + 1}`; seen.set(n, 1); }
    return n;
  });
}

export interface ParseInfo {
  delimiter?: string;
  header?: boolean;
  /** Rows dropped over DATASET_MAX_ROWS. */
  truncated?: number;
  /** Rows whose field count differed from the header (padded or cut). */
  ragged?: number;
}

export function parseCsv(text: string, opts: { format?: DatasetFormat; header?: HeaderMode } = {}): { result: TableResult; info: ParseInfo } {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = sniffDelimiter(clean, opts.format);
  const all = splitCsv(clean, delimiter).filter(r => r.some(f => f.trim() !== ''));
  const header = opts.header === 'yes' ? true : opts.header === 'no' ? false : detectHeader(all);
  const width = Math.min(DATASET_MAX_COLUMNS, Math.max(0, ...all.slice(0, 1000).map(r => r.length)));
  const names = uniqueNames(header && all.length ? all[0].slice(0, width).concat(Array(Math.max(0, width - all[0].length)).fill('')) : Array.from({ length: width }, (_, i) => `c${i + 1}`));
  let body = header ? all.slice(1) : all;
  let truncated = 0;
  if (body.length > DATASET_MAX_ROWS) { truncated = body.length - DATASET_MAX_ROWS; body = body.slice(0, DATASET_MAX_ROWS); }
  let ragged = 0;
  for (const r of body) if (r.length !== width) ragged++;
  const columns = names.map((name, c) => typeColumn(name, body.map(r => r[c] ?? null)));
  return {
    result: { kind: 'table', rows: body.length, columns },
    info: { delimiter, header, ...(truncated ? { truncated } : {}), ...(ragged ? { ragged } : {}) },
  };
}

// ── JSON ──────────────────────────────────────────────────────────────────────

const isFlatValue = (v: unknown) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** A column from JS values (not strings): numbers stay numbers, strings/booleans are categories, anything else is "other". */
export function columnFromValues(name: string, values: unknown[]): Column {
  const present = values.filter(v => v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v)));
  if (present.every(v => typeof v === 'number' && Number.isFinite(v))) {
    const nums = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
    return { name, type: 'number', values: nums, ...numericRange(nums) };
  }
  if (present.every(v => typeof v === 'string' || typeof v === 'boolean')) {
    return { name, type: 'category', values: values.map(v => (v === null || v === undefined ? null : String(v))) };
  }
  return { name, type: 'other', values: values.map(v => (v === undefined ? null : v)) };
}

/** An array of records as a table (keys in order of first appearance), or null when it isn't one. */
export function recordsToTable(value: unknown, requireFlat = true): TableResult | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(r => r && typeof r === 'object' && !Array.isArray(r))) return null;
  const records = value.slice(0, DATASET_MAX_ROWS) as Array<Record<string, unknown>>;
  if (requireFlat && !records.every(r => Object.values(r).every(isFlatValue))) return null;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  if (keys.length === 0 || keys.length > DATASET_MAX_COLUMNS) return null;
  return { kind: 'table', rows: records.length, columns: keys.map(k => columnFromValues(k, records.map(r => r[k] ?? null))) };
}

// ── Any file ─────────────────────────────────────────────────────────────────

/** Which format a file is, from its name (and a look at the text when the name doesn't say). */
export function formatFor(filename: string, text: string): DatasetFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  if (ext === 'json' || ext === 'geojson' || ext === 'jsonl' || ext === 'ndjson') return 'json';
  if (ext === 'txt' || ext === 'md') return 'text';
  const t = text.trimStart();
  if (t.startsWith('[') || t.startsWith('{')) { try { JSON.parse(t); return 'json'; } catch { /* not JSON */ } }
  const firstLines = t.split(/\r?\n/, 50).filter(l => l.trim()).slice(0, 3);
  if (firstLines.length > 1 && firstLines.every(l => l.includes('\t'))) return 'tsv';
  if (firstLines.length > 1 && firstLines.every(l => /[,;|]/.test(l))) return 'csv';
  return 'text';
}

/**
 * What a file reads as before the notebook runs: the notebook's `data`.
 * Throws with a plain message when JSON doesn't parse.
 */
export function parseSourceText(text: string, format: DatasetFormat, opts: { header?: HeaderMode } = {}): { result: DatasetResult; info: ParseInfo } {
  switch (format) {
    case 'csv':
    case 'tsv':
      return parseCsv(text, { format, header: opts.header });
    case 'json': {
      let value: unknown;
      try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
        throw new Error(`This JSON doesn't parse: ${e instanceof Error ? e.message : String(e)}`);
      }
      const table = recordsToTable(value);
      return { result: table ?? { kind: 'json', value }, info: {} };
    }
    case 'text':
      return { result: { kind: 'text', text: text.replace(/^\uFEFF/, '') }, info: {} };
  }
}
