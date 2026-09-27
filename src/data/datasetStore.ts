/**
 * The datasets at runtime: what the preview (and later the Play layer and
 * mapping sources) read, with a version per dataset and a way to hear about
 * changes.
 *
 * The graph store owns the saved datasets and hands every change to `sync`.
 * On top of that a dataset's result can be replaced, or grown row by row,
 * without touching the saved file: the hook a live stream will use. Readers
 * never poll: they `subscribe(id, fn)` and re-read `effective(id)` (the
 * result with Normalize applied) when told. The Data node's texture follows
 * this way, with no shader recompile.
 */
import { normalizeTable } from './normalize';
import { columnFromValues } from './parse';
import { isTable, numericRange, type Column, type Dataset, type DatasetResult, type DatasetsRecord, type TableResult } from './types';

type Listener = (id: string) => void;

class DatasetRuntime {
  private records: DatasetsRecord = {};
  private versions = new Map<string, number>();
  private live = new Map<string, DatasetResult>();
  private listeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();
  private cache = new Map<string, { version: number; value: DatasetResult | null }>();
  private clock = 0;

  /**
   * The saved datasets changed (the store calls this). One whose result or
   * Normalize changed, or that came or went, gets a new version and drops its
   * live replacement; typing in the notebook or renaming doesn't.
   */
  sync(next: DatasetsRecord): void {
    const prev = this.records;
    this.records = next;
    const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const id of ids) {
      const a = prev[id], b = next[id];
      if (a === b || (a && b && a.result === b.result && a.normalize === b.normalize)) continue;
      this.live.delete(id);
      this.bump(id);
    }
  }

  private bump(id: string): void {
    this.versions.set(id, ++this.clock);
    this.cache.delete(id);
    for (const fn of this.listeners.get(id) ?? []) fn(id);
    for (const fn of this.anyListeners) fn(id);
  }

  get(id: string): Dataset | undefined { return this.records[id]; }
  all(): DatasetsRecord { return this.records; }

  /** Goes up every time what `effective(id)` returns may have changed. 0 for a dataset never seen. */
  version(id: string): number { return this.versions.get(id) ?? 0; }

  /** The result as saved, or its live replacement. */
  result(id: string): DatasetResult | null {
    return this.live.get(id) ?? this.records[id]?.result ?? null;
  }

  /** The result as readers see it: with Normalize 0–1 applied when the dataset has it on. */
  effective(id: string): DatasetResult | null {
    const v = this.version(id);
    const hit = this.cache.get(id);
    if (hit && hit.version === v) return hit.value;
    const r = this.result(id);
    const value = r && isTable(r) && this.records[id]?.normalize ? normalizeTable(r) : r;
    this.cache.set(id, { version: v, value });
    return value;
  }

  /** Tell `fn` whenever dataset `id` changes. Returns the unsubscribe. */
  subscribe(id: string, fn: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) { set = new Set(); this.listeners.set(id, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }
  /** Tell `fn` whenever any dataset changes. */
  subscribeAll(fn: Listener): () => void {
    this.anyListeners.add(fn);
    return () => { this.anyListeners.delete(fn); };
  }

  /** Replace a dataset's result for this session (not saved). A later edit of the saved dataset wins again. */
  replaceResult(id: string, result: DatasetResult): void {
    this.live.set(id, result);
    this.bump(id);
  }

  /**
   * Add rows to a table dataset for this session, keeping the newest `window`
   * rows. Rows are records; columns they don't have are left empty, and
   * columns the table doesn't have yet are added.
   */
  appendRows(id: string, rows: ReadonlyArray<Record<string, unknown>>, opts: { window?: number } = {}): void {
    const base = this.result(id);
    const table: TableResult = isTable(base) ? base : { kind: 'table', rows: 0, columns: [] };
    this.live.set(id, appendToTable(table, rows, opts.window));
    this.bump(id);
  }
}

/** A table with rows added at the end, trimmed from the front to `window` rows. Pure. */
export function appendToTable(t: TableResult, rows: ReadonlyArray<Record<string, unknown>>, window = Infinity): TableResult {
  const names = t.columns.map(c => c.name);
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  const total = t.rows + rows.length;
  const drop = Math.max(0, total - Math.max(0, Math.floor(window)));
  const columns: Column[] = names.map(name => {
    const old = t.columns.find(c => c.name === name);
    const values: unknown[] = [...(old ? old.values : Array(t.rows).fill(null)), ...rows.map(r => r[name] ?? null)].slice(drop);
    if (old?.type === 'number' && values.every(v => v === null || (typeof v === 'number' && Number.isFinite(v)))) {
      const nums = values as Array<number | null>;
      return { name, type: 'number', values: nums, ...numericRange(nums) };
    }
    return columnFromValues(name, values);
  });
  return { kind: 'table', rows: total - drop, columns };
}

export const datasetStore = new DatasetRuntime();
