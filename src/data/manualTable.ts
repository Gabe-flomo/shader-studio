/**
 * Typed-in tables (docs/data-layer-plan.md, milestone 6): the spreadsheet's
 * model and every edit it makes, as pure functions of the table.
 *
 * Cells are kept as typed (strings), so a half-typed number is never lost;
 * each column's type decides how they are read when the notebook runs
 * (`manualToTable`). Every edit returns a new table and leaves the old one
 * alone, which is what the spreadsheet's undo keeps.
 */
import { columnFromValues, detectHeader, isMissing, readNumber, splitCsv, typeColumn } from './parse';
import { DATASET_MAX_COLUMNS, MANUAL_MAX_ROWS, numericRange, type Column, type ManualColumn, type ManualColumnType, type TableResult } from './types';

export interface ManualTable { columns: ManualColumn[]; rows: string[][] }

/** A new typed-in table: three columns and a few empty rows to start typing in. */
export function blankManualTable(): ManualTable {
  return {
    columns: [{ name: 'label', type: 'text' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }],
    rows: Array.from({ length: 4 }, () => ['', '', '']),
  };
}

/** A column name not in `taken`: `base`, then `base 2`, `base 3`… */
export function uniqueColumnName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const b = base.trim() || 'column';
  if (!used.has(b)) return b;
  for (let i = 2; ; i++) if (!used.has(`${b} ${i}`)) return `${b} ${i}`;
}

/** Spreadsheet-style names for new columns: a, b, c… z, aa… */
function letterName(i: number): string {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function nextColumnName(t: ManualTable): string {
  const taken = t.columns.map(c => c.name);
  for (let i = t.columns.length; ; i++) { const n = letterName(i); if (!taken.includes(n)) return n; }
}

const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n, Math.round(i)));

// ── Columns ──────────────────────────────────────────────────────────────────

/** Add a column at `at` (the end by default). */
export function addColumn(t: ManualTable, at = t.columns.length, col?: Partial<ManualColumn>): ManualTable {
  if (t.columns.length >= DATASET_MAX_COLUMNS) return t;
  const i = clampIndex(at, t.columns.length);
  const name = uniqueColumnName(col?.name ?? nextColumnName(t), t.columns.map(c => c.name));
  const columns = [...t.columns];
  columns.splice(i, 0, { name, type: col?.type ?? 'number' });
  return { columns, rows: t.rows.map(r => { const n = [...r]; n.splice(i, 0, ''); return n; }) };
}

/** Rename a column. A blank name is refused; a name another column has gets a number. */
export function renameColumn(t: ManualTable, i: number, name: string): ManualTable {
  const c = t.columns[i];
  const n = name.trim().slice(0, 200);
  if (!c || !n || n === c.name) return t;
  const unique = uniqueColumnName(n, t.columns.filter((_, j) => j !== i).map(x => x.name));
  return { ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, name: unique } : x)) };
}

/** Change a column's type. The cells stay as typed; only how they read changes. */
export function retypeColumn(t: ManualTable, i: number, type: ManualColumnType): ManualTable {
  if (!t.columns[i] || t.columns[i].type === type) return t;
  return { ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, type } : x)) };
}

export function deleteColumn(t: ManualTable, i: number): ManualTable {
  if (!t.columns[i]) return t;
  return { columns: t.columns.filter((_, j) => j !== i), rows: t.rows.map(r => r.filter((_, j) => j !== i)) };
}

/** Move column `from` to index `to`. */
export function moveColumn(t: ManualTable, from: number, to: number): ManualTable {
  const n = t.columns.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return t;
  const move = <T,>(a: T[]) => { const b = [...a]; const [x] = b.splice(from, 1); b.splice(to, 0, x); return b; };
  return { columns: move(t.columns), rows: t.rows.map(r => move(r)) };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Add `count` empty rows at `at` (the end by default). */
export function addRows(t: ManualTable, at = t.rows.length, count = 1): ManualTable {
  const room = Math.max(0, MANUAL_MAX_ROWS - t.rows.length);
  const k = Math.min(room, Math.max(0, Math.round(count)));
  if (!k) return t;
  const i = clampIndex(at, t.rows.length);
  const rows = [...t.rows];
  rows.splice(i, 0, ...Array.from({ length: k }, () => t.columns.map(() => '')));
  return { ...t, rows };
}

/** Delete rows `from`…`to` (inclusive, either order). */
export function deleteRows(t: ManualTable, from: number, to = from): ManualTable {
  const a = Math.min(from, to), b = Math.max(from, to);
  if (a < 0 || a >= t.rows.length) return t;
  return { ...t, rows: t.rows.filter((_, j) => j < a || j > b) };
}

/** Move row `from` to index `to`. */
export function moveRow(t: ManualTable, from: number, to: number): ManualTable {
  const n = t.rows.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return t;
  const rows = [...t.rows];
  const [x] = rows.splice(from, 1);
  rows.splice(to, 0, x);
  return { ...t, rows };
}

// ── Cells ────────────────────────────────────────────────────────────────────

export function setCell(t: ManualTable, r: number, c: number, value: string): ManualTable {
  if (!t.rows[r] || c < 0 || c >= t.columns.length || t.rows[r][c] === value) return t;
  const rows = [...t.rows];
  rows[r] = rows[r].map((v, j) => (j === c ? value.slice(0, 2000) : v));
  return { ...t, rows };
}

/** Empty every cell in the rectangle between two corners. */
export function clearCells(t: ManualTable, r0: number, c0: number, r1 = r0, c1 = c0): ManualTable {
  const [ra, rb] = [Math.min(r0, r1), Math.max(r0, r1)], [ca, cb] = [Math.min(c0, c1), Math.max(c0, c1)];
  let changed = false;
  const rows = t.rows.map((row, r) => (r < ra || r > rb ? row : row.map((v, c) => {
    if (c < ca || c > cb || v === '') return v;
    changed = true;
    return '';
  })));
  return changed ? { ...t, rows } : t;
}

/** Does a cell's text read as a value of its column's type? Empty cells always do. */
export function cellReads(type: ManualColumnType, raw: string): boolean {
  return type !== 'number' || isMissing(raw) || readManualNumber(raw) !== null;
}

/** A typed number: plain (1,234.5), percent, money or a date, as file columns read them. */
export function readManualNumber(raw: string): number | null {
  for (const kind of ['plain', 'percent', 'money', 'date'] as const) {
    const v = readNumber(raw, kind);
    if (v !== null) return v;
  }
  return null;
}

// ── Paste ────────────────────────────────────────────────────────────────────

/**
 * Split pasted text into a block of cells. Excel and Google Sheets copy
 * tab-separated rows (quoted when a cell holds a tab or a line break); a
 * single line with commas and no tabs is read as CSV.
 */
export function parsePasteBlock(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!clean) return [];
  const delim = clean.includes('\t') ? '\t' : (!clean.includes('\n') && clean.includes(',')) || /^[^\n]*,[^\n]*\n[^\n]*,/.test(clean) ? ',' : '\t';
  const rows = splitCsv(clean, delim);
  const width = Math.max(0, ...rows.map(r => r.length));
  return rows.map(r => [...r.map(v => v.trim()), ...Array(width - r.length).fill('')]).slice(0, MANUAL_MAX_ROWS);
}

/** The type a column of pasted values reads as: numbers when every value is one, else text (category when values repeat a lot). */
export function inferManualType(values: readonly string[]): ManualColumnType {
  const col = typeColumn('x', values);
  if (col.type === 'number') return 'number';
  const present = values.map(v => v.trim()).filter(v => v && !isMissing(v));
  const distinct = new Set(present).size;
  return present.length >= 4 && distinct <= Math.max(2, present.length / 2) ? 'category' : 'text';
}

export interface PasteResult { table: ManualTable; rows: number; columns: number; header: boolean }

/**
 * Paste a block with its top-left cell at (r, c). The table grows to fit:
 * new rows at the bottom, new columns on the right (typed from what was
 * pasted). Pasted into an empty table from its first cell, a first row that
 * reads as names becomes the column names and every column is retyped.
 */
export function pasteBlock(t: ManualTable, r: number, c: number, text: string): PasteResult {
  let block = parsePasteBlock(text);
  if (!block.length) return { table: t, rows: 0, columns: 0, header: false };
  const empty = t.rows.every(row => row.every(v => v === ''));
  let header = false;
  let table = t;
  if (empty && r === 0 && c === 0 && block.length > 1 && detectHeader(block)) {
    header = true;
    const names = block[0];
    block = block.slice(1);
    const width = Math.min(DATASET_MAX_COLUMNS, names.length);
    const columns: ManualColumn[] = [];
    for (let i = 0; i < width; i++) {
      columns.push({ name: uniqueColumnName(names[i] || letterName(i), columns.map(x => x.name)), type: inferManualType(block.map(b => b[i] ?? '')) });
    }
    table = { columns, rows: [] };
  } else if (empty && r === 0 && c === 0) {
    // No names in the block: keep the table's names, but type the columns from what came in.
    const width = Math.min(DATASET_MAX_COLUMNS, Math.max(t.columns.length, block[0].length));
    let grown = t;
    while (grown.columns.length < width) grown = addColumn(grown);
    table = { columns: grown.columns.map((col, i) => (i < block[0].length ? { ...col, type: inferManualType(block.map(b => b[i] ?? '')) } : col)), rows: [] };
  }
  const width = block[0].length;
  const startR = header || table.rows.length === 0 ? 0 : Math.max(0, Math.min(r, table.rows.length));
  const startC = header ? 0 : Math.max(0, Math.min(c, table.columns.length));
  // Grow: columns first (typed from the pasted values that land in them), then rows.
  while (table.columns.length < Math.min(DATASET_MAX_COLUMNS, startC + width)) {
    const j = table.columns.length - startC;
    table = addColumn(table, table.columns.length, { type: inferManualType(block.map(b => b[j] ?? '')) });
  }
  const needRows = startR + block.length - table.rows.length;
  if (needRows > 0) table = addRows(table, table.rows.length, needRows);
  const rows = table.rows.map((row, i) => {
    const b = block[i - startR];
    if (!b) return row;
    const next = [...row];
    for (let j = 0; j < b.length && startC + j < next.length; j++) next[startC + j] = b[j].slice(0, 2000);
    return next;
  });
  return { table: { ...table, rows }, rows: Math.min(block.length, rows.length - startR), columns: Math.min(width, table.columns.length - startC), header };
}

/** A rectangle of cells as tab-separated text (for Copy), quoting cells with tabs, quotes or line breaks. */
export function copyBlock(t: ManualTable, r0: number, c0: number, r1 = r0, c1 = c0): string {
  const [ra, rb] = [Math.min(r0, r1), Math.max(r0, r1)], [ca, cb] = [Math.min(c0, c1), Math.max(c0, c1)];
  const q = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return t.rows.slice(ra, rb + 1).map(row => row.slice(ca, cb + 1).map(q).join('\t')).join('\n');
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** The table the notebook starts from: numbers read per column, empty cells as missing. Trailing empty rows are left out. */
export function manualToTable(t: ManualTable): TableResult {
  let n = t.rows.length;
  while (n > 0 && t.rows[n - 1].every(v => v.trim() === '')) n--;
  const rows = t.rows.slice(0, n);
  const columns: Column[] = t.columns.map((c, j) => {
    const raw = rows.map(r => r[j] ?? '');
    if (c.type === 'number') {
      const values = raw.map(v => (isMissing(v) ? null : readManualNumber(v)));
      return { name: c.name, type: 'number', values, ...numericRange(values) };
    }
    return columnFromValues(c.name, raw.map(v => (v.trim() === '' ? null : v.trim())));
  });
  // An all-empty text column still reads as text.
  return { kind: 'table', rows: n, columns: columns.map((col, j) => (col.type === 'number' && t.columns[j].type !== 'number' ? { name: col.name, type: 'category', values: col.values.map(() => null) } : col)) };
}

/** A table result (a file's, a stream's window) as a typed-in table, to edit by hand. */
export function tableToManual(r: TableResult): ManualTable {
  const columns: ManualColumn[] = r.columns.map(c => ({ name: c.name, type: c.type === 'number' ? 'number' : c.type === 'category' ? inferManualType(c.values.map(v => v ?? '')) : 'text' }));
  const rows: string[][] = [];
  for (let i = 0; i < Math.min(r.rows, MANUAL_MAX_ROWS); i++) {
    rows.push(r.columns.map(c => {
      const v = c.values[i];
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }));
  }
  return { columns, rows };
}
