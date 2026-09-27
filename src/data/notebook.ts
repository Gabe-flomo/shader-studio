/**
 * The notebook: JavaScript cells run top to bottom over the imported data.
 *
 * `data` is what the file read as (a table, a string or a JSON value) and, for
 * tables, `df` is the same table. Names a cell sets at its top level
 * (`x = …`, `const x = …`, `function f() {}`) carry on to the cells below.
 * Each cell's last value is shown under it; the dataset is `result` when a
 * cell set it, else the last value of the last cell that had one, else the
 * data unchanged.
 *
 * This is the pure part, run inside a worker by notebookWorker.ts (which also
 * stops a cell that runs too long). It never touches the page.
 */
import { recordsToTable } from './parse';
import { Table, isTableValue, seededRandom } from './table';
import type { ColumnType, DatasetResult } from './types';
import { isTable } from './types';

export interface ColumnSummary { name: string; type: ColumnType; min?: number; max?: number }

/** A cell's value, small enough to send back and show. */
export type ValuePreview =
  | { kind: 'table'; rows: number; columns: ColumnSummary[]; head: string[][] }
  | { kind: 'value'; text: string }
  | { kind: 'none' };

export type CellOutput =
  | { id: string; ok: true; preview: ValuePreview; logs: string[] }
  | { id: string; ok: false; error: string; line?: number; logs: string[] };

export interface NotebookRun {
  cells: CellOutput[];
  /** The dataset, or null when a cell failed (the previous result then stays). */
  result: DatasetResult | null;
  /** Why there's no result. */
  error?: string;
}

/** Top-level `const x =`, `let x =`, `var x =` and `function f(` at the start of a line become assignments, so the names carry to later cells. */
export function hoistTopLevel(code: string): string {
  let depth = 0;
  return code.split('\n').map(line => {
    let out = line;
    if (depth === 0) {
      out = out
        .replace(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/, '$2 =')
        .replace(/^(async\s+)?function\s*(\*?)\s*([A-Za-z_$][\w$]*)\s*\(/, (_m, a, star, name) => `${name} = ${a ?? ''}function${star} ${name}(`);
    }
    // Rough bracket depth (strings with brackets in them can fool it: then names just don't carry).
    for (const c of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '')) {
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    }
    return out;
  }).join('\n');
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(+v.toFixed(4)));
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v).slice(0, 80); } catch { return String(v); }
}

export function summarizeResult(r: DatasetResult, headRows = 5): ValuePreview {
  if (r.kind === 'table') {
    return {
      kind: 'table', rows: r.rows,
      columns: r.columns.map(c => (c.type === 'number' ? { name: c.name, type: c.type, min: c.min, max: c.max } : { name: c.name, type: c.type })),
      head: Array.from({ length: Math.min(headRows, r.rows) }, (_, i) => r.columns.map(c => cellText(c.values[i]))),
    };
  }
  if (r.kind === 'text') return { kind: 'value', text: r.text.length > 2000 ? `${r.text.slice(0, 2000)}…` : r.text };
  return { kind: 'value', text: jsonText(r.value) };
}

function jsonText(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2) ?? String(v);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch { return String(v); }
}

/** What a value becomes as a dataset: tables and arrays of records are tables, strings are text, the rest JSON. */
export function toDatasetResult(v: unknown): DatasetResult {
  if (isTableValue(v)) return v.toResult();
  if (typeof v === 'string') return { kind: 'text', text: v };
  if (typeof v === 'function') throw new Error('The last value is a function. End with a table, some text or a value.');
  if (typeof v === 'symbol' || typeof v === 'bigint') throw new Error(`The last value is a ${typeof v}. End with a table, some text or a value.`);
  const t = recordsToTable(v, false);
  if (t) return t;
  // Through JSON: drops functions and undefined, and fails loudly on cycles.
  let value: unknown;
  try { value = JSON.parse(JSON.stringify(v ?? null)); } catch (e) { throw new Error(`The last value can't be kept: ${e instanceof Error ? e.message : String(e)}`); }
  return { kind: 'json', value };
}

function previewOf(v: unknown): ValuePreview {
  if (v === undefined) return { kind: 'none' };
  if (isTableValue(v)) return summarizeResult(v.toResult());
  if (typeof v === 'string') return { kind: 'value', text: JSON.stringify(v.length > 2000 ? `${v.slice(0, 2000)}…` : v) };
  if (typeof v === 'function') return { kind: 'value', text: `function ${v.name || ''}()` };
  if (v && typeof v === 'object' && 'mean' in v && 'agg' in v) return { kind: 'value', text: 'Groups: follow with .mean(\'col\'), .count(), .agg({ … })' };
  return { kind: 'value', text: jsonText(v) };
}

function errorLine(e: unknown): number | undefined {
  const stack = e instanceof Error ? e.stack ?? '' : '';
  const m = /<anonymous>:(\d+):\d+/.exec(stack);
  return m ? Number(m[1]) : undefined;
}

// Runs a cell's code in sloppy mode inside `with (scope)`, so names read and
// written at the top level live on the scope object. `eval` is kept out of
// the scope so this stays a direct eval: its value is the cell's last value.
const runInScope = new Function('__scope', '__code', 'with (__scope) { return eval(__code); }') as (scope: object, code: string) => unknown;

export function runNotebook(input: DatasetResult, cells: ReadonlyArray<{ id: string; code: string }>): NotebookRun {
  const env: Record<string, unknown> = Object.create(null);
  const inputValue = input.kind === 'table' ? Table.fromResult(input) : input.kind === 'text' ? input.text : input.value;
  env.data = inputValue;
  if (isTable(input)) env.df = inputValue;
  env.table = (x: unknown) => Table.from(x);
  env.random = (seed = 1) => seededRandom(seed);
  let logs: string[] = [];
  const say = (...a: unknown[]) => { if (logs.length < 200) logs.push(a.map(x => (typeof x === 'string' ? x : isTableValue(x) ? String(x) : jsonText(x))).join(' ')); };
  env.console = { log: say, info: say, warn: say, error: say };
  env.print = say;
  const scope = new Proxy(env, {
    has: (_t, k) => typeof k === 'string' && k !== 'eval' && k !== '__code' && k !== '__scope',
    get: (t, k) => (k === Symbol.unscopables ? undefined : typeof k === 'string' && k in t ? t[k] : (globalThis as Record<string | symbol, unknown>)[k]),
    set: (t, k, v) => { if (typeof k === 'string') t[k] = v; return true; },
  });

  const outputs: CellOutput[] = [];
  let last: unknown = undefined;
  for (const cell of cells) {
    logs = [];
    if (!cell.code.trim()) { outputs.push({ id: cell.id, ok: true, preview: { kind: 'none' }, logs }); continue; }
    try {
      const v = runInScope(scope, hoistTopLevel(cell.code));
      if (v !== undefined) last = v;
      outputs.push({ id: cell.id, ok: true, preview: previewOf(v), logs });
    } catch (e) {
      outputs.push({ id: cell.id, ok: false, error: e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e), line: errorLine(e), logs });
      return { cells: outputs, result: null, error: 'A cell failed, so the dataset keeps its last result.' };
    }
  }
  const chosen = env.result !== undefined ? env.result : last !== undefined ? last : inputValue;
  try {
    return { cells: outputs, result: toDatasetResult(chosen) };
  } catch (e) {
    return { cells: outputs, result: null, error: e instanceof Error ? e.message : String(e) };
  }
}
