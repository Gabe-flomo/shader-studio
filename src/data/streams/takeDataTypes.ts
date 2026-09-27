/**
 * A live dataset's rows as a take keeps them (takes.ts): the window when the
 * take started, then each message's rows with its time, so replay and
 * rendering feed the same rows at the same moments instead of the live feed.
 * Values are kept per row in `columns` order, which keeps the take small.
 *
 * Only types and the load-time check live here (types/play.ts reads them);
 * recording and replay are in takeData.ts.
 */
import { DATASET_MAX_COLUMNS, type StreamMode } from '../types';

export interface TakeDataBatch {
  /** Seconds into the take. */
  t: number;
  rows: unknown[][];
}

export interface TakeDataFeed {
  /** The dataset's id. */
  dataset: string;
  mode: StreamMode;
  window: number;
  columns: string[];
  /** The window when the take started. */
  start: unknown[][];
  batches: TakeDataBatch[];
}

/** Rows a take keeps for all its feeds (the window at the start plus every message). */
export const TAKE_DATA_MAX_ROWS = 60_000;

const flat = (v: unknown) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

function parseRows(raw: unknown, width: number, budget: { rows: number }): unknown[][] | null {
  if (!Array.isArray(raw)) return null;
  const out: unknown[][] = [];
  for (const r of raw) {
    if (budget.rows <= 0) break;
    if (!Array.isArray(r) || r.length > width) continue;
    out.push(r.map(v => (flat(v) ? (typeof v === 'string' ? v.slice(0, 2000) : v) : null)));
    budget.rows--;
  }
  return out;
}

/** A take's data feeds, checked on load: bad ones are dropped, never thrown. */
export function parseTakeDataFeeds(raw: unknown, length: number): TakeDataFeed[] {
  if (!Array.isArray(raw)) return [];
  const out: TakeDataFeed[] = [];
  const budget = { rows: TAKE_DATA_MAX_ROWS };
  for (const f of raw.slice(0, 16)) {
    if (!f || typeof f !== 'object') continue;
    const x = f as Record<string, unknown>;
    if (typeof x.dataset !== 'string' || !/^[a-z][a-z0-9]{0,31}$/.test(x.dataset)) continue;
    if (!Array.isArray(x.columns) || !x.columns.every(c => typeof c === 'string') || x.columns.length > DATASET_MAX_COLUMNS) continue;
    const columns = (x.columns as string[]).map(c => c.slice(0, 200));
    const window = typeof x.window === 'number' && Number.isFinite(x.window) ? Math.max(1, Math.round(x.window)) : 1000;
    const start = parseRows(x.start, columns.length, budget) ?? [];
    const batches: TakeDataBatch[] = [];
    for (const b of Array.isArray(x.batches) ? x.batches : []) {
      if (!b || typeof b !== 'object') continue;
      const y = b as Record<string, unknown>;
      if (typeof y.t !== 'number' || !Number.isFinite(y.t) || y.t < 0 || y.t > length + 1) continue;
      const rows = parseRows(y.rows, columns.length, budget);
      if (rows && rows.length) batches.push({ t: y.t, rows });
    }
    batches.sort((a, b) => a.t - b.t);
    out.push({ dataset: x.dataset, mode: x.mode === 'replace' ? 'replace' : 'append', window, columns, start, batches });
  }
  return out;
}
