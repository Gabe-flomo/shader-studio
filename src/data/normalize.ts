/**
 * Normalize 0–1: a dataset option (off by default). Each number column is
 * mapped from its min…max to 0…1, except columns whose values already lie
 * within 0…1, which are left as they are (a 0–1 column stays comparable to
 * the others instead of being stretched). A constant column becomes 0.
 */
import type { NumberColumn, TableResult } from './types';

export function alreadyUnit(c: NumberColumn): boolean {
  return c.min >= 0 && c.max <= 1;
}

export function normalizeColumn(c: NumberColumn): NumberColumn {
  if (alreadyUnit(c)) return c;
  const span = c.max - c.min;
  const values = c.values.map(v => (v === null ? null : span > 0 ? (v - c.min) / span : 0));
  return { ...c, values, min: 0, max: span > 0 ? 1 : 0 };
}

/** The table with every number column normalized (see above); other columns untouched. */
export function normalizeTable(t: TableResult): TableResult {
  return { ...t, columns: t.columns.map(c => (c.type === 'number' ? normalizeColumn(c) : c)) };
}

/** The names of the number columns Normalize maps, and the ones it leaves (already 0–1). */
export function normalizeSummary(t: TableResult): { mapped: string[]; kept: string[] } {
  const mapped: string[] = [], kept: string[] = [];
  for (const c of t.columns) if (c.type === 'number') (alreadyUnit(c) ? kept : mapped).push(c.name);
  return { mapped, kept };
}
