/**
 * A stream's table: rows added into a rolling window, or replacing it, and
 * the window saved as CSV (so a graph opens with the last rows it saw).
 * Pure.
 */
import { appendToTable } from '../datasetStore';
import { parseCsv } from '../parse';
import type { StreamMode, TableResult } from '../types';
import type { Row } from './messages';

export const emptyTable = (): TableResult => ({ kind: 'table', rows: 0, columns: [] });

/** The table after a message's rows: appended and trimmed to the last `window` rows, or replacing it. */
export function applyRows(table: TableResult, rows: ReadonlyArray<Row>, mode: StreamMode, window: number): TableResult {
  if (mode === 'replace') return rows.length ? appendToTable(emptyTable(), rows, window) : table;
  return rows.length ? appendToTable(table, rows, window) : table;
}

/** The table's last `window` rows (after the window was made smaller). */
export function trimTable(table: TableResult, window: number): TableResult {
  const keep = Math.max(1, Math.floor(window));
  return table.rows > keep ? appendToTable(table, [], keep) : table;
}

const quote = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A table as CSV text, header first. */
export function tableToCsv(t: TableResult): string {
  const lines = [t.columns.map(c => quote(c.name)).join(',')];
  for (let i = 0; i < t.rows; i++) {
    lines.push(t.columns.map(c => {
      const v = c.values[i];
      return v === null || v === undefined ? '' : quote(typeof v === 'object' ? JSON.stringify(v) : String(v));
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

/** A saved window back as a table (empty when there is none). */
export function csvToTable(text: string | undefined): TableResult {
  if (!text || !text.trim()) return emptyTable();
  return parseCsv(text, { format: 'csv', header: 'yes' }).result;
}
