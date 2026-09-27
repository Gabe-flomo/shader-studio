/**
 * dataLayer.ts — the app's side of the Data layer (types/playLayers.ts
 * DataLayer, drawn by play/kit/data.js): datasets as the kit reads them, how
 * many rows (or chunks) a layer steps through, and the data mapping source
 * ("Data · <dataset> · current · <column>").
 *
 * Everything reads the runtime dataset store (src/data/datasetStore.ts), so
 * a new notebook result, a live replacement or appended rows reach the
 * picture, the sliders and the mappings with no rebuild: the store's
 * versioned `effective()` is what they read, and a change wakes the frame
 * loop.
 */
import { datasetStore } from '../data/datasetStore';
import type { Dataset, DatasetResult, DatasetsRecord } from '../data/types';
import { DATA_ROW_COLUMN, type PlaySource } from '../types/play';
import { setDataItemCount, type DataLayer } from '../types/playLayers';
import { kdColumn, kdTextItems, kdUnit } from './kit/data.js';
import type { KitDataset } from './kit/kit.js';
import { inputBus } from '../lib/inputBus';

/** A dataset by id, else by name (what s.data('Sales') asks for). */
export function findDataset(ref: string, all: DatasetsRecord = datasetStore.all()): Dataset | undefined {
  if (!ref) return undefined;
  if (all[ref]) return all[ref];
  const want = ref.trim().toLowerCase();
  return Object.values(all).find(d => d.name.trim().toLowerCase() === want);
}

/** A dataset as the layer kit reads it (env.data): its result with Normalize applied. */
export function kitDataset(ref: string): KitDataset | null {
  const d = findDataset(ref);
  return d ? { id: d.id, name: d.name, result: datasetStore.effective(d.id) } : null;
}

/** How many rows a table has, or chunks a text splits into for this layer (0 for anything else). */
export function dataItemCount(l: Pick<DataLayer, 'dataset' | 'split' | 'separator' | 'chunkSize' | 'order'>, result: DatasetResult | null = l.dataset ? datasetStore.effective(l.dataset) : null): number {
  if (!result) return 0;
  if (result.kind === 'table') return result.rows;
  if (result.kind === 'text') return kdTextItems(result, l).items.length;
  return 0;
}

// The Offset, From and To sliders run over the dataset's rows.
setDataItemCount(l => dataItemCount(l));

// A dataset changed outside the saved file (a live result, appended rows): draw a frame, so the
// layers, the mappings and the sliders catch up even while nothing else moves.
datasetStore.subscribeAll(() => inputBus.wake());

/**
 * The data source's value for a result: `column` at row `row`, 0..1 over the
 * column's min..max (categories by their place among the values), or how far
 * through the rows it is for the `#row` column. `rows` is how many rows (or
 * text chunks) the layer steps through, when known. Null when there is
 * nothing to read.
 */
export function dataSourceValue(result: DatasetResult | null, column: string, row: number, rows?: number): number | null {
  if (!result) return null;
  const n = rows ?? (result.kind === 'table' ? result.rows : 0);
  if (column === DATA_ROW_COLUMN) return n > 1 ? Math.max(0, Math.min(1, row / (n - 1))) : 0;
  if (result.kind !== 'table' || !(result.rows > 0)) return null;
  const i = Math.max(0, Math.min(result.rows - 1, Math.round(row)));
  return kdUnit(kdColumn(result, column), i);
}

/**
 * Read a data source now. `sensor(key)` is what the layers reported: the
 * current row of the Data layer (`<layerId>::row`), or of the first Data
 * layer showing the dataset (`ds:<id>::row`). Without one, row 0.
 */
export function readDataSource(source: Extract<PlaySource, { kind: 'data' }>, sensor: (key: string) => number | undefined): number | null {
  const at = source.layerId ? source.layerId : `ds:${source.dataset}`;
  const row = sensor(`${at}::row`) ?? 0;
  const rows = sensor(`${at}::rows`);
  return dataSourceValue(datasetStore.effective(source.dataset), source.column, row, rows);
}

const ORDINAL = /^(id|index|idx|step|row|n|no|month|year|day|date|time|t)$/i;

/**
 * Columns worth starting a Data layer on when it picks up a table: x and y
 * (by name, else the first two number columns), a category (the first
 * category column) and a value (the first number column that isn't a
 * counter such as step or month). Only fields the table can't fill as they
 * are set are changed, so a layer's own choices survive a new result.
 */
export function suggestDataColumns(result: DatasetResult | null, l: Pick<DataLayer, 'xCol' | 'yCol' | 'categoryCol' | 'valueCol'>): Partial<DataLayer> {
  if (!result || result.kind !== 'table') return {};
  const has = (name: string) => !!name && result.columns.some(c => c.name === name);
  const nums = result.columns.filter(c => c.type === 'number').map(c => c.name);
  const cats = result.columns.filter(c => c.type === 'category').map(c => c.name);
  const named = (...names: string[]) => nums.find(n => names.includes(n.toLowerCase()));
  const x = named('x', 'lon', 'lng', 'longitude') ?? nums.find(n => !ORDINAL.test(n)) ?? nums[0] ?? '';
  const y = named('y', 'lat', 'latitude') ?? nums.find(n => n !== x && !ORDINAL.test(n)) ?? nums.find(n => n !== x) ?? '';
  const value = nums.find(n => !ORDINAL.test(n)) ?? nums[0] ?? '';
  const out: Partial<DataLayer> = {};
  if (!has(l.xCol)) out.xCol = x;
  if (!has(l.yCol)) out.yCol = y;
  if (!has(l.categoryCol)) out.categoryCol = cats[0] ?? '';
  if (!has(l.valueCol)) out.valueCol = value;
  return out;
}
