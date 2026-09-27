/**
 * The notebook's table helper: a small, immutable data frame shaped after
 * pandas. Every method returns a new table (or a plain value); nothing is
 * changed in place, so a cell can be run again safely.
 *
 *   df['temp']                         a column as an array (also df.col('temp'))
 *   df.where(r => r.temp > 20)         rows that pass (or a string: 'temp > 20')
 *   df.assign({ f: r => r.temp * 1.8 + 32 })
 *   df.groupby('city').mean('temp')
 *   df.sort('temp', { descending: true }).head(10)
 *   df.kmeans(['x', 'y'], 4, { seed: 1 })   adds a cluster column
 *
 * The reference panel (dataReference.ts) documents every method; keep the two
 * in step.
 */
import { columnFromValues } from './parse';
import type { TableResult } from './types';

export type Row = Record<string, unknown>;
type RowFn<T> = (row: Row, index: number) => T;
type Agg = 'mean' | 'sum' | 'count' | 'min' | 'max' | 'median' | 'std' | 'first' | 'last';

/** A seeded random generator (mulberry32): the same seed gives the same numbers. */
export function seededRandom(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nums = (vs: readonly unknown[]) => vs.filter(isNum);
const isNa = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));

function stat(values: readonly unknown[], how: Agg): unknown {
  const ns = nums(values);
  switch (how) {
    case 'count': return values.filter(v => !isNa(v)).length;
    case 'sum': return ns.reduce((a, b) => a + b, 0);
    case 'mean': return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
    case 'min': return ns.length ? Math.min(...ns) : null;
    case 'max': return ns.length ? Math.max(...ns) : null;
    case 'median': return quantile(ns, 0.5);
    case 'std': {
      if (ns.length < 2) return null;
      const m = ns.reduce((a, b) => a + b, 0) / ns.length;
      return Math.sqrt(ns.reduce((a, b) => a + (b - m) ** 2, 0) / (ns.length - 1));
    }
    case 'first': return values.find(v => !isNa(v)) ?? null;
    case 'last': return [...values].reverse().find(v => !isNa(v)) ?? null;
  }
}

function quantile(ns: number[], q: number): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function compare(a: unknown, b: unknown): number {
  const na = isNa(a), nb = isNa(b);
  if (na || nb) return na && nb ? 0 : na ? 1 : -1; // missing values last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

const exprCache = new Map<string, (r: Row) => unknown>();
/** `'temp > 20 && city == "Oslo"'` as a row predicate: column names are variables. */
function exprFn(expr: string): (r: Row) => unknown {
  let f = exprCache.get(expr);
  if (!f) {
    // Column names read as variables through `with`; sloppy mode is what allows it.
    f = new Function('__row', `with (__row) { return (${expr}); }`) as (r: Row) => unknown;
    exprCache.set(expr, f);
  }
  return f;
}

function listArg(args: ReadonlyArray<string | readonly string[]>): string[] {
  return args.flatMap(a => (Array.isArray(a) ? a : [a as string]));
}

/** Names asked of any object by the platform or tools (promises, JSON, test matchers): never an error. */
const PASS_THROUGH = new Set(['then', 'toJSON', 'constructor', 'nodeType', 'tagName', 'asymmetricMatch', 'inspect', 'length', 'size', 'prototype']);

export class Table {
  /** The column names, in order. */
  readonly columns: string[];
  /** How many rows. */
  readonly length: number;
  private readonly data: Map<string, unknown[]>;
  private recordsCache: Row[] | null = null;

  /** A table from records (`[{ x: 1 }, …]`), columns (`{ x: [1, 2] }`) or another table. */
  static from(input: unknown): Table {
    if (input instanceof Table) return input;
    if (Array.isArray(input)) {
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const r of input) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('table([...]) takes records: objects like { x: 1, y: 2 }.');
        for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
      return new Table(keys.map(k => [k, input.map(r => (r as Row)[k] ?? null)]));
    }
    if (input && typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>);
      if (entries.every(([, v]) => Array.isArray(v))) return new Table(entries as Array<[string, unknown[]]>);
    }
    throw new Error('table() takes an array of records or an object of column arrays.');
  }

  static fromResult(r: TableResult): Table {
    return new Table(r.columns.map(c => [c.name, c.values as unknown[]]));
  }

  constructor(columns: Array<[string, unknown[]]>) {
    const length = columns.length ? Math.max(...columns.map(([, v]) => v.length)) : 0;
    this.data = new Map(columns.map(([k, v]) => [k, v.length === length ? v : [...v, ...Array(length - v.length).fill(null)]]));
    this.columns = [...this.data.keys()];
    this.length = length;
    // df['name'] reads a column (unless a method has that name: then df.col('name')).
    // Any other name is a mistake worth saying so (df.tmep, a half-typed method),
    // rather than an undefined that quietly becomes the dataset.
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && !(prop in target)) {
          if (target.data.has(prop)) return [...target.data.get(prop)!];
          if (!PASS_THROUGH.has(prop) && !prop.startsWith('@@') && !prop.startsWith('_') && !prop.startsWith('$')) {
            throw new Error(`A table has no method or column "${prop}". Its columns are: ${target.columns.join(', ') || '(none)'}.`);
          }
        }
        return Reflect.get(target, prop, receiver);
      },
      has(target, prop) {
        return Reflect.has(target, prop) || (typeof prop === 'string' && target.data.has(prop));
      },
    });
  }

  /** [rows, columns], like pandas. */
  get shape(): [number, number] { return [this.length, this.columns.length]; }

  private need(name: string): unknown[] {
    const v = this.data.get(name);
    if (!v) throw new Error(`No column "${name}". The columns are: ${this.columns.join(', ') || '(none)'}.`);
    return v;
  }
  private withColumns(cols: Array<[string, unknown[]]>): Table { return new Table(cols); }
  private pick(indexes: readonly number[]): Table {
    return this.withColumns(this.columns.map(c => { const v = this.data.get(c)!; return [c, indexes.map(i => v[i])]; }));
  }

  /** A column as an array. */
  col(name: string): unknown[] { return [...this.need(name)]; }
  /** Every row as an object. */
  records(): Row[] {
    if (!this.recordsCache) {
      const cols = this.columns.map(c => [c, this.data.get(c)!] as const);
      this.recordsCache = Array.from({ length: this.length }, (_, i) => Object.fromEntries(cols.map(([c, v]) => [c, v[i]])));
    }
    return this.recordsCache.map(r => ({ ...r }));
  }
  /** One row as an object. */
  row(i: number): Row { return Object.fromEntries(this.columns.map(c => [c, this.data.get(c)![i] ?? null])); }

  /** Rows that pass: a function of the row, or an expression string with column names as variables. */
  where(test: RowFn<unknown> | string): Table {
    const f: RowFn<unknown> = typeof test === 'string' ? (r => exprFn(test)(r)) : test;
    const keep: number[] = [];
    this.records().forEach((r, i) => { if (f(r, i)) keep.push(i); });
    return this.pick(keep);
  }
  /** Same as where. */
  filter(test: RowFn<unknown> | string): Table { return this.where(test); }

  /** New or replaced columns: each a function of the row, an array, or one value for every row. Evaluated in order. */
  assign(spec: Record<string, RowFn<unknown> | readonly unknown[] | number | string | boolean | null>): Table {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the table each column is added to in turn
    let t: Table = this;
    for (const [name, v] of Object.entries(spec)) {
      let values: unknown[];
      if (typeof v === 'function') { const rs = t.records(); values = rs.map((r, i) => (v as RowFn<unknown>)(r, i)); }
      else if (Array.isArray(v)) values = (v as unknown[]).slice(0, t.length);
      else values = Array(t.length).fill(v);
      const cols = t.columns.map(c => [c, t.data.get(c)!] as [string, unknown[]]);
      const at = cols.findIndex(([c]) => c === name);
      if (at >= 0) cols[at] = [name, values]; else cols.push([name, values]);
      t = t.withColumns(cols);
    }
    return t;
  }

  /** Only these columns, in this order. */
  select(...cols: Array<string | string[]>): Table {
    return this.withColumns(listArg(cols).map(c => [c, this.need(c)]));
  }
  /** Without these columns. */
  drop(...cols: Array<string | string[]>): Table {
    const gone = new Set(listArg(cols));
    for (const c of gone) this.need(c);
    return this.withColumns(this.columns.filter(c => !gone.has(c)).map(c => [c, this.data.get(c)!]));
  }
  /** Rename columns: { old: 'new' }. */
  rename(map: Record<string, string>): Table {
    for (const c of Object.keys(map)) this.need(c);
    return this.withColumns(this.columns.map(c => [map[c] ?? c, this.data.get(c)!]));
  }

  /** Sorted by a column (or several, or a function of the row). Missing values go last. */
  sort(by: string | string[] | RowFn<unknown>, opts: { descending?: boolean } = {}): Table {
    const sign = opts.descending ? -1 : 1;
    const idx = Array.from({ length: this.length }, (_, i) => i);
    if (typeof by === 'function') {
      const rs = this.records();
      const keys = rs.map((r, i) => by(r, i));
      idx.sort((a, b) => sign * compare(keys[a], keys[b]) || a - b);
    } else {
      const cols = (Array.isArray(by) ? by : [by]).map(c => this.need(c));
      idx.sort((a, b) => {
        for (const v of cols) {
          const na = isNa(v[a]), nb = isNa(v[b]);
          if (na || nb) { if (na !== nb) return na ? 1 : -1; continue; }
          const d = compare(v[a], v[b]);
          if (d) return sign * d;
        }
        return a - b;
      });
    }
    return this.pick(idx);
  }

  /** The first n rows (5 by default). */
  head(n = 5): Table { return this.pick(Array.from({ length: Math.max(0, Math.min(n, this.length)) }, (_, i) => i)); }
  /** The last n rows (5 by default). */
  tail(n = 5): Table { const k = Math.max(0, Math.min(n, this.length)); return this.pick(Array.from({ length: k }, (_, i) => this.length - k + i)); }
  /** Rows from start up to (not including) end, like Array.slice. */
  slice(start = 0, end = this.length): Table {
    const s = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    const e = end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    return this.pick(Array.from({ length: Math.max(0, e - s) }, (_, i) => s + i));
  }

  /** Rows of groups sharing a value in `by`; follow with .mean('col'), .count(), .agg({...}). Groups are sorted by key unless { sort: false }. */
  groupby(by: string | string[], opts: { sort?: boolean } = {}): GroupBy {
    const keys = Array.isArray(by) ? by : [by];
    const cols = keys.map(k => this.need(k));
    const groups = new Map<string, { key: unknown[]; rows: number[] }>();
    for (let i = 0; i < this.length; i++) {
      const key = cols.map(c => c[i] ?? null);
      const id = JSON.stringify(key);
      let g = groups.get(id);
      if (!g) { g = { key, rows: [] }; groups.set(id, g); }
      g.rows.push(i);
    }
    let list = [...groups.values()];
    if (opts.sort !== false) list = list.sort((a, b) => { for (let k = 0; k < keys.length; k++) { const d = compare(a.key[k], b.key[k]); if (d) return d; } return 0; });
    return new GroupBy(this, keys, list);
  }

  /** count, mean, std, min, quartiles and max of each number column (or the ones named). */
  describe(...cols: Array<string | string[]>): Table {
    const names = cols.length ? listArg(cols) : this.columns.filter(c => this.data.get(c)!.some(isNum) && this.data.get(c)!.every(v => isNa(v) || isNum(v)));
    const stats = ['count', 'mean', 'std', 'min', '25%', '50%', '75%', 'max'];
    const out: Array<[string, unknown[]]> = [['stat', stats]];
    for (const c of names) {
      const ns = nums(this.need(c));
      out.push([c, [ns.length, stat(ns, 'mean'), stat(ns, 'std'), stat(ns, 'min'), quantile(ns, 0.25), quantile(ns, 0.5), quantile(ns, 0.75), stat(ns, 'max')]]);
    }
    return this.withColumns(out);
  }

  /** The distinct values of a column, in order of first appearance. */
  unique(col: string): unknown[] {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const v of this.need(col)) { const k = JSON.stringify(v ?? null); if (!seen.has(k)) { seen.add(k); out.push(v ?? null); } }
    return out;
  }
  /** How often each value of a column appears: a table of value and count, most common first. */
  valueCounts(col: string): Table {
    const counts = new Map<string, { v: unknown; n: number }>();
    for (const v of this.need(col)) { const k = JSON.stringify(v ?? null); const c = counts.get(k); if (c) c.n++; else counts.set(k, { v: v ?? null, n: 1 }); }
    const list = [...counts.values()].sort((a, b) => b.n - a.n);
    return this.withColumns([[col, list.map(x => x.v)], ['count', list.map(x => x.n)]]);
  }

  /** Number columns (all, or the ones named) mapped from their min…max to 0…1. A constant column becomes 0. */
  normalize(...cols: Array<string | string[]>): Table {
    const names = new Set(cols.length ? listArg(cols) : this.columns.filter(c => this.data.get(c)!.some(isNum)));
    return this.withColumns(this.columns.map(c => {
      const v = this.data.get(c)!;
      if (!names.has(c)) return [c, v];
      const ns = nums(v);
      const lo = ns.length ? Math.min(...ns) : 0, hi = ns.length ? Math.max(...ns) : 0;
      return [c, v.map(x => (isNum(x) ? (hi > lo ? (x - lo) / (hi - lo) : 0) : x))];
    }));
  }

  /** Without rows missing a value (in any column, or in the ones named). */
  dropna(...cols: Array<string | string[]>): Table {
    const names = cols.length ? listArg(cols) : this.columns;
    const vs = names.map(c => this.need(c));
    const keep: number[] = [];
    for (let i = 0; i < this.length; i++) if (vs.every(v => !isNa(v[i]))) keep.push(i);
    return this.pick(keep);
  }
  /** Missing values filled: one value for every column, or { col: value }. */
  fillna(value: unknown): Table {
    const per = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    return this.withColumns(this.columns.map(c => {
      const fill = per ? per[c] : value;
      const v = this.data.get(c)!;
      return [c, fill === undefined ? v : v.map(x => (isNa(x) ? fill : x))];
    }));
  }

  /** n rows picked at random without repeats; the same seed picks the same rows. */
  sample(n: number, seed = 1): Table {
    const rand = seededRandom(seed);
    const idx = Array.from({ length: this.length }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return this.pick(idx.slice(0, Math.max(0, Math.min(n, idx.length))));
  }

  /**
   * k-means clustering on number columns: adds a `cluster` column (0 … k-1).
   * Starts from k-means++ picks made with the seed, so the same seed always
   * gives the same clusters. Rows missing a value get no cluster (null).
   */
  kmeans(cols: string | string[], k: number, opts: { seed?: number; iterations?: number; column?: string } = {}): Table {
    const names = Array.isArray(cols) ? cols : [cols];
    const vs = names.map(c => this.need(c));
    const rand = seededRandom(opts.seed ?? 1);
    const pts: Array<{ i: number; p: number[] }> = [];
    for (let i = 0; i < this.length; i++) { const p = vs.map(v => v[i]); if (p.every(isNum)) pts.push({ i, p: p as number[] }); }
    const K = Math.max(1, Math.min(Math.round(k), pts.length || 1));
    const d2 = (a: number[], b: number[]) => a.reduce((s, x, j) => s + (x - b[j]) ** 2, 0);
    const centres: number[][] = [];
    if (pts.length) {
      centres.push([...pts[Math.floor(rand() * pts.length)].p]);
      while (centres.length < K) {
        const dist = pts.map(({ p }) => Math.min(...centres.map(c => d2(p, c))));
        const total = dist.reduce((a, b) => a + b, 0);
        let r = rand() * total, pick = 0;
        if (total === 0) pick = Math.floor(rand() * pts.length);
        else for (; pick < dist.length - 1; pick++) { r -= dist[pick]; if (r <= 0) break; }
        centres.push([...pts[pick].p]);
      }
    }
    const assign = new Array<number>(pts.length).fill(0);
    for (let it = 0; it < (opts.iterations ?? 50); it++) {
      let moved = false;
      pts.forEach(({ p }, n) => {
        let best = 0, bd = Infinity;
        centres.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; best = j; } });
        if (assign[n] !== best || it === 0) { moved = moved || assign[n] !== best; assign[n] = best; }
      });
      const sums = centres.map(() => new Array(names.length).fill(0)), counts = centres.map(() => 0);
      pts.forEach(({ p }, n) => { counts[assign[n]]++; p.forEach((x, j) => { sums[assign[n]][j] += x; }); });
      centres.forEach((c, j) => { if (counts[j]) sums[j].forEach((s, d) => { c[d] = s / counts[j]; }); });
      if (!moved && it > 0) break;
    }
    const cluster: unknown[] = Array(this.length).fill(null);
    pts.forEach(({ i }, n) => { cluster[i] = assign[n]; });
    return this.assign({ [opts.column ?? 'cluster']: cluster });
  }

  /** The mean of a number column. */
  mean(col: string): number | null { return stat(this.need(col), 'mean') as number | null; }
  /** The sum of a number column. */
  sum(col: string): number { return stat(this.need(col), 'sum') as number; }
  /** The smallest value of a number column. */
  min(col: string): number | null { return stat(this.need(col), 'min') as number | null; }
  /** The largest value of a number column. */
  max(col: string): number | null { return stat(this.need(col), 'max') as number | null; }
  /** The median of a number column. */
  median(col: string): number | null { return stat(this.need(col), 'median') as number | null; }
  /** The standard deviation (sample) of a number column. */
  std(col: string): number | null { return stat(this.need(col), 'std') as number | null; }

  /** A function of each row, as an array. */
  map<T>(fn: RowFn<T>): T[] { return this.records().map(fn); }
  /** This table's rows followed by another's (columns matched by name). */
  concat(other: Table | Row[]): Table {
    const o = Table.from(other);
    const names = [...this.columns, ...o.columns.filter(c => !this.data.has(c))];
    return this.withColumns(names.map(c => [c, [...(this.data.get(c) ?? Array(this.length).fill(null)), ...(o.columns.includes(c) ? o.col(c) : Array(o.length).fill(null))]]));
  }

  /** The table as a dataset result (column types worked out from the values). */
  toResult(): TableResult {
    return { kind: 'table', rows: this.length, columns: this.columns.map(c => columnFromValues(c, this.data.get(c)!)) };
  }
  toString(): string { return `Table · ${this.length} rows × ${this.columns.length} columns (${this.columns.join(', ')})`; }
  toJSON(): Row[] { return this.records(); }
}

/** What groupby returns: pick how each group is summarised. */
export class GroupBy {
  private readonly t: Table;
  private readonly keys: string[];
  private readonly groups: Array<{ key: unknown[]; rows: number[] }>;
  constructor(t: Table, keys: string[], groups: Array<{ key: unknown[]; rows: number[] }>) {
    this.t = t; this.keys = keys; this.groups = groups;
  }

  private run(how: Agg, cols: Array<string | string[]>): Table {
    const names = cols.length ? listArg(cols) : this.t.columns.filter(c => !this.keys.includes(c) && (how === 'count' || how === 'first' || how === 'last' || this.t.col(c).some(isNum)));
    return this.agg(Object.fromEntries(names.map(c => [c, how])));
  }
  /** The mean of each group, for the columns named (every number column when none are). */
  mean(...cols: Array<string | string[]>): Table { return this.run('mean', cols); }
  sum(...cols: Array<string | string[]>): Table { return this.run('sum', cols); }
  /** Non-missing values per group. */
  count(...cols: Array<string | string[]>): Table { return this.run('count', cols); }
  min(...cols: Array<string | string[]>): Table { return this.run('min', cols); }
  max(...cols: Array<string | string[]>): Table { return this.run('max', cols); }
  median(...cols: Array<string | string[]>): Table { return this.run('median', cols); }
  std(...cols: Array<string | string[]>): Table { return this.run('std', cols); }
  first(...cols: Array<string | string[]>): Table { return this.run('first', cols); }
  last(...cols: Array<string | string[]>): Table { return this.run('last', cols); }
  /** Rows per group, as a `size` column. */
  size(): Table {
    return new Table([...this.keys.map((k, j) => [k, this.groups.map(g => g.key[j])] as [string, unknown[]]), ['size', this.groups.map(g => g.rows.length)]]);
  }
  /** A summary per column: { temp: 'mean', rain: 'sum', n: rows => rows.length }. */
  agg(spec: Record<string, Agg | ((values: unknown[]) => unknown)>): Table {
    const out: Array<[string, unknown[]]> = this.keys.map((k, j) => [k, this.groups.map(g => g.key[j])]);
    for (const [c, how] of Object.entries(spec)) {
      const v = this.t.col(c);
      out.push([c, this.groups.map(g => {
        const vals = g.rows.map(i => v[i]);
        return typeof how === 'function' ? how(vals) : stat(vals, how);
      })]);
    }
    return new Table(out);
  }
}

/** Is a value a table (the helper's, possibly proxied)? */
export function isTableValue(v: unknown): v is Table {
  return v instanceof Table;
}
