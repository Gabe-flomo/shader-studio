/**
 * Datasets: data files brought into a graph (docs/data-layer-plan.md).
 *
 * A dataset is saved in the graph file under the top-level `datasets` key,
 * next to `play`. It keeps where it came from (`source`), the notebook that
 * transforms it (`cells`), whether numeric columns are read as 0–1
 * (`normalize`) and the notebook's **frozen result**. The Data node (and later
 * the Data layer on Play) only ever read the result; the notebook never runs
 * per frame.
 *
 * `source` is a tagged union so other ways in (typed-in tables, a URL, a live
 * stream) slot in later without changing what reads a dataset. Only `file` is
 * built so far; the others are parsed and kept, and have no editor yet.
 */

export type DatasetFormat = 'csv' | 'tsv' | 'json' | 'text';
export type HeaderMode = 'auto' | 'yes' | 'no';

export type DatasetSource =
  | { kind: 'file'; format: DatasetFormat; filename: string; text: string; header?: HeaderMode }
  | { kind: 'manual' }
  | { kind: 'url'; url: string; format: DatasetFormat; refresh?: number }
  | { kind: 'stream'; transport: 'poll' | 'websocket' | 'sse' | 'osc'; address: string; format?: DatasetFormat; window: number };

export type ColumnType = 'number' | 'category' | 'other';

export interface NumberColumn { name: string; type: 'number'; values: Array<number | null>; min: number; max: number }
export interface CategoryColumn { name: string; type: 'category'; values: Array<string | null> }
export interface OtherColumn { name: string; type: 'other'; values: unknown[] }
export type Column = NumberColumn | CategoryColumn | OtherColumn;

export interface TableResult { kind: 'table'; rows: number; columns: Column[] }
export interface TextResult { kind: 'text'; text: string }
export interface JsonResult { kind: 'json'; value: unknown }
export type DatasetResult = TableResult | TextResult | JsonResult;

export interface NotebookCell { id: string; code: string }

export interface Dataset {
  /** Stable, GLSL-safe (`[a-z][a-z0-9]*`): the shader's uniforms and helpers are named after it. */
  id: string;
  name: string;
  source: DatasetSource;
  cells: NotebookCell[];
  /** Read numeric columns as 0–1 (min…max). Off by default. */
  normalize: boolean;
  /** The notebook's output: what everything else reads. Null until the first run (or when it failed on load). */
  result: DatasetResult | null;
  /** When the result was made (ms). */
  ranAt?: number;
}

export type DatasetsRecord = Record<string, Dataset>;

// ── Limits ────────────────────────────────────────────────────────────────────

/** Above this a dataset is flagged: browser storage holds about 5 MB for everything. */
export const DATASET_WARN_BYTES = 5 * 1024 * 1024;
/** Files bigger than this are refused on import. */
export const DATASET_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Rows a table keeps (the rest are dropped on parse, and the preview says so). */
export const DATASET_MAX_ROWS = 200_000;
export const DATASET_MAX_COLUMNS = 256;
export const DATASET_MAX_CELLS = 64;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isTable(r: DatasetResult | null | undefined): r is TableResult {
  return !!r && r.kind === 'table';
}

/** Min and max of a numeric column's values (0, 0 when it has none). */
export function numericRange(values: ReadonlyArray<number | null>): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

/** A dataset id from a name: lower-case letters and digits, starting with a letter, unique among `taken`. */
export function datasetIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '').replace(/^[0-9]+/, '').slice(0, 16);
  if (!base) base = 'data';
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** How many bytes a dataset takes in the saved file (roughly: its JSON). */
export function datasetBytes(d: Dataset): number {
  try { return JSON.stringify(d).length; } catch { return 0; }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ── Validation (on load) ──────────────────────────────────────────────────────

const FORMATS: readonly DatasetFormat[] = ['csv', 'tsv', 'json', 'text'];
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const fmt = (v: unknown): DatasetFormat | null => (FORMATS.includes(v as DatasetFormat) ? v as DatasetFormat : null);

function parseSource(raw: unknown): DatasetSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case 'file': {
      const format = fmt(s.format);
      const text = typeof s.text === 'string' ? s.text : null;
      if (!format || text === null || text.length > DATASET_MAX_FILE_BYTES) return null;
      const header = s.header === 'yes' || s.header === 'no' ? s.header : undefined;
      return { kind: 'file', format, filename: str(s.filename, 200) ?? 'data', text, ...(header ? { header } : {}) };
    }
    case 'manual': return { kind: 'manual' };
    case 'url': {
      const url = str(s.url, 2000), format = fmt(s.format);
      if (!url || !format) return null;
      const refresh = typeof s.refresh === 'number' && Number.isFinite(s.refresh) && s.refresh > 0 ? s.refresh : undefined;
      return { kind: 'url', url, format, ...(refresh ? { refresh } : {}) };
    }
    case 'stream': {
      const transport = ['poll', 'websocket', 'sse', 'osc'].includes(s.transport as string) ? s.transport as 'poll' : null;
      const address = str(s.address, 2000);
      const window = typeof s.window === 'number' && Number.isFinite(s.window) ? Math.max(1, Math.min(DATASET_MAX_ROWS, Math.round(s.window))) : 1000;
      if (!transport || address === null) return null;
      const format = fmt(s.format);
      return { kind: 'stream', transport, address, window, ...(format ? { format } : {}) };
    }
    default: return null;
  }
}

function parseColumn(raw: unknown, rows: number): Column | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const name = str(c.name, 200);
  if (name === null || !Array.isArray(c.values)) return null;
  const values = c.values.slice(0, rows);
  while (values.length < rows) values.push(null);
  if (c.type === 'number') {
    const nums = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
    return { name, type: 'number', values: nums, ...numericRange(nums) };
  }
  if (c.type === 'category') return { name, type: 'category', values: values.map(v => (v === null || v === undefined ? null : String(v))) };
  return { name, type: 'other', values };
}

/** A saved result, checked: tables must be rectangular and typed. Anything else is dropped (null). */
export function parseDatasetResult(raw: unknown): DatasetResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'text') return typeof r.text === 'string' ? { kind: 'text', text: r.text } : null;
  if (r.kind === 'json') return { kind: 'json', value: r.value ?? null };
  if (r.kind !== 'table' || !Array.isArray(r.columns)) return null;
  const rows = typeof r.rows === 'number' && Number.isFinite(r.rows) ? Math.max(0, Math.min(DATASET_MAX_ROWS, Math.round(r.rows))) : 0;
  const columns: Column[] = [];
  const names = new Set<string>();
  for (const c of r.columns.slice(0, DATASET_MAX_COLUMNS)) {
    const col = parseColumn(c, rows);
    if (col && !names.has(col.name)) { names.add(col.name); columns.push(col); }
  }
  return { kind: 'table', rows, columns };
}

function parseDataset(id: string, raw: unknown): Dataset | null {
  if (!/^[a-z][a-z0-9]{0,31}$/.test(id) || !raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const source = parseSource(d.source);
  if (!source) return null;
  const cells: NotebookCell[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(d.cells) ? d.cells.slice(0, DATASET_MAX_CELLS) : []) {
    if (!c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    const cid = str(x.id, 40), code = str(x.code, 100_000);
    if (!cid || code === null || seen.has(cid)) continue;
    seen.add(cid);
    cells.push({ id: cid, code });
  }
  return {
    id,
    name: str(d.name, 120)?.trim() || id,
    source,
    cells,
    normalize: d.normalize === true,
    result: parseDatasetResult(d.result),
    ...(typeof d.ranAt === 'number' && Number.isFinite(d.ranAt) ? { ranAt: d.ranAt } : {}),
  };
}

/** The `datasets` key of a graph file, checked like parsePlayRecord: bad entries are dropped, never thrown. */
export function parseDatasetsRecord(raw: unknown): DatasetsRecord {
  const out: DatasetsRecord = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
    const d = parseDataset(id, v);
    if (d) out[id] = d;
  }
  return out;
}

export function isDatasetsEmpty(d: DatasetsRecord | undefined): boolean {
  return !d || Object.keys(d).length === 0;
}
