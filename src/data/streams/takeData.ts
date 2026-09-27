/**
 * Live datasets in takes: recording the rows each stream brought, and
 * feeding them back during replay and rendering (see takeDataTypes.ts for
 * the saved shape).
 *
 * Recording: rows are held until the next frame the take samples and stamped
 * with that frame's clock time, like the take's other events. A rolling
 * buffer (the last minute) folds rows older than its start into the window
 * it starts from, so memory stays bounded.
 *
 * Replay: the hub is muted (live feeds keep running out of sight) and each
 * feed's table at the take's time goes to readers: the start window, then
 * every batch up to that time. Moving forward only adds the new batches;
 * moving back starts from the window again.
 */
import { appendToTable } from '../datasetStore';
import type { TableResult } from '../types';
import type { Row } from './messages';
import { applyRows, emptyTable } from './window';
import { TAKE_DATA_MAX_ROWS, type TakeDataFeed } from './takeDataTypes';
import type { StreamSource } from './streamHub';

type OnRows = (fn: (id: string, rows: ReadonlyArray<Row>, src: StreamSource, before: TableResult) => void) => () => void;

interface RawFeed { mode: StreamSource['mode']; window: number; start: TableResult; batches: Array<{ t: number; rows: Row[] }> }

export class DataFeedCapture {
  private feeds = new Map<string, RawFeed>();
  private pending: Array<{ id: string; rows: ReadonlyArray<Row>; src: StreamSource; before: TableResult }> = [];
  private off: () => void;
  private rows = 0;

  constructor(onRows: OnRows) {
    this.off = onRows((id, rows, src, before) => this.pending.push({ id, rows, src, before }));
  }

  dispose(): void { this.off(); }
  reset(): void { this.feeds.clear(); this.pending = []; this.rows = 0; }

  /** A frame at clock `time`: rows that came since the last one are stamped with it. */
  sample(time: number): void {
    for (const p of this.pending) {
      let f = this.feeds.get(p.id);
      if (!f) { f = { mode: p.src.mode, window: p.src.window, start: p.before, batches: [] }; this.feeds.set(p.id, f); }
      f.mode = p.src.mode;
      f.window = p.src.window;
      if (this.rows + p.rows.length > TAKE_DATA_MAX_ROWS * 2) continue;
      this.rows += p.rows.length;
      f.batches.push({ t: time, rows: [...p.rows] });
    }
    this.pending = [];
  }

  /** Fold batches before `from` into each feed's starting window (the rolling buffer's trim). */
  trim(from: number): void {
    for (const f of this.feeds.values()) {
      let i = 0;
      while (i < f.batches.length && f.batches[i].t < from) {
        f.start = applyRows(f.start, f.batches[i].rows, f.mode, f.window);
        this.rows -= f.batches[i].rows.length;
        i++;
      }
      if (i) f.batches.splice(0, i);
    }
  }

  /** The feeds for a take starting at clock `from`, `length` seconds long. */
  toFeeds(from: number, length: number): TakeDataFeed[] {
    const out: TakeDataFeed[] = [];
    let budget = TAKE_DATA_MAX_ROWS;
    for (const [dataset, f] of this.feeds) {
      let start = f.start;
      const kept: Array<{ t: number; rows: Row[] }> = [];
      for (const b of f.batches) {
        if (b.t < from) start = applyRows(start, b.rows, f.mode, f.window);
        else if (b.t <= from + length) kept.push(b);
      }
      const names: string[] = start.columns.map(c => c.name);
      for (const b of kept) for (const r of b.rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
      const startRows = tableRows(start, names).slice(-Math.max(0, budget));
      budget -= startRows.length;
      const batches: TakeDataFeed['batches'] = [];
      for (const b of kept) {
        if (budget <= 0) break;
        const rows = b.rows.slice(0, budget).map(r => names.map(n => r[n] ?? null));
        budget -= rows.length;
        batches.push({ t: Math.round((b.t - from) * 1000) / 1000, rows });
      }
      out.push({ dataset, mode: f.mode, window: f.window, columns: names, start: startRows, batches });
    }
    return out;
  }
}

function tableRows(t: TableResult, names: string[]): unknown[][] {
  const cols = names.map(n => t.columns.find(c => c.name === n));
  return Array.from({ length: t.rows }, (_, i) => cols.map(c => (c ? c.values[i] ?? null : null)));
}

const toRecords = (columns: string[], rows: unknown[][]): Row[] => rows.map(r => Object.fromEntries(columns.map((c, j) => [c, r[j] ?? null])));

/** A feed's table `s` seconds into the take. Pure (the player below does the same, step by step). */
export function feedTableAt(f: TakeDataFeed, s: number): TableResult {
  let t = appendToTable(emptyTable(), toRecords(f.columns, f.start), f.window);
  for (const b of f.batches) {
    if (b.t > s) break;
    t = applyRows(t, toRecords(f.columns, b.rows), f.mode, f.window);
  }
  return t;
}

/** Feeds a take's recorded rows to readers as the clock moves. */
export class DataFeedPlayer {
  private at = new Map<string, { next: number; table: TableResult }>();
  private feeds: TakeDataFeed[];
  private put: (id: string, table: TableResult) => void;

  constructor(feeds: TakeDataFeed[], put: (id: string, table: TableResult) => void) {
    this.feeds = feeds;
    this.put = put;
  }

  get active(): boolean { return this.feeds.length > 0; }

  /** Put every feed's table at `s` seconds into the take (only the ones that changed). */
  apply(s: number): void {
    for (const f of this.feeds) {
      let cur = this.at.get(f.dataset);
      let changed = false;
      if (!cur || (cur.next > 0 && f.batches[cur.next - 1].t > s)) {
        cur = { next: 0, table: appendToTable(emptyTable(), toRecords(f.columns, f.start), f.window) };
        this.at.set(f.dataset, cur);
        changed = true;
      }
      while (cur.next < f.batches.length && f.batches[cur.next].t <= s) {
        cur.table = applyRows(cur.table, toRecords(f.columns, f.batches[cur.next].rows), f.mode, f.window);
        cur.next++;
        changed = true;
      }
      if (changed) this.put(f.dataset, cur.table);
    }
  }
}
