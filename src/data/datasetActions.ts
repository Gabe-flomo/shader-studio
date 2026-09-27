/**
 * Making and refreshing datasets: from a file's text, a typed-in table, a
 * fetched link or a stream to a saved dataset with its first result. The
 * editor and the Data layer share these.
 */
import { runDataset } from './datasetRun';
import type { DatasetJob, DatasetJobOut } from './compute';
import { formatFor } from './parse';
import { blankManualTable, manualToTable, type ManualTable } from './manualTable';
import { streamHub } from './streams/streamHub';
import { csvToTable } from './streams/window';
import type { FetchedData } from './urlFetch';
import { DATASET_MAX_FILE_BYTES, datasetIdFor, formatBytes, type Dataset, type DatasetFormat, type StreamMode, type StreamTransport } from './types';

let cellSeq = 0;
export const newCellId = () => `c${Date.now().toString(36)}${(cellSeq++).toString(36)}`;

/** The first cell a new dataset gets: it just shows the data, so the preview has something to say. */
export function starterCell(format: DatasetFormat): { id: string; code: string } {
  return { id: newCellId(), code: format === 'csv' || format === 'tsv' ? 'df' : 'data' };
}

/** A new dataset from a file's text (not run yet: `result` is null). */
export function datasetFromText(o: { filename: string; text: string; format?: DatasetFormat; name?: string }, taken: Iterable<string>): Dataset {
  const format = o.format ?? formatFor(o.filename, o.text);
  const name = o.name ?? o.filename.replace(/\.[a-z0-9]+$/i, '');
  return {
    id: datasetIdFor(name, taken),
    name,
    source: { kind: 'file', format, filename: o.filename, text: o.text },
    cells: [starterCell(format)],
    normalize: false,
    result: null,
  };
}

/** Read a picked or dropped file as text, refusing ones over the cap. */
export async function readDataFile(file: File): Promise<{ filename: string; text: string }> {
  if (file.size > DATASET_MAX_FILE_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. Files up to ${formatBytes(DATASET_MAX_FILE_BYTES)} can be imported.`);
  }
  return { filename: file.name, text: await file.text() };
}

/** The notebook's input for any source, as a job (the text to parse, or a table already read). */
export function datasetJob(d: Dataset): DatasetJob {
  const src = d.source;
  switch (src.kind) {
    case 'file': return { text: src.text, format: src.format, header: src.header, cells: d.cells };
    case 'url': return { text: src.text, format: src.format, header: src.header, cells: d.cells };
    case 'manual': return { text: '', format: 'csv', table: manualToTable(src), cells: d.cells };
    case 'stream': {
      // The live window when the stream is connected; else the window it last kept.
      const live = streamHub.window(d.id);
      return { text: '', format: 'csv', table: live ?? csvToTable(src.text), cells: d.cells };
    }
  }
}

/** Parse the source and run the notebook. */
export function runDatasetNotebook(d: Dataset): Promise<DatasetJobOut> {
  return runDataset(datasetJob(d));
}

// ── New datasets from the other sources ──────────────────────────────────────

/** A typed-in table to start from (a few empty rows; or `table`, e.g. pasted in). */
export function datasetFromManual(taken: Iterable<string>, table: ManualTable = blankManualTable(), name = 'Typed-in table'): Dataset {
  return {
    id: datasetIdFor(name === 'Typed-in table' ? 'table' : name, taken),
    name,
    source: { kind: 'manual', columns: table.columns, rows: table.rows },
    cells: [starterCell('csv')],
    normalize: false,
    result: null,
  };
}

/** A dataset from a fetched link: its text kept like a file's, with the link. */
export function datasetFromFetched(f: FetchedData, taken: Iterable<string>, extra: { kaggle?: { slug: string; file: string }; name?: string } = {}): Dataset {
  const name = extra.name ?? f.filename.replace(/\.[a-z0-9]+$/i, '');
  return {
    id: datasetIdFor(name, taken),
    name,
    source: { kind: 'url', url: f.url, format: f.format, text: f.text, fetchedAt: Date.now(), ...(extra.kaggle ? { kaggle: extra.kaggle } : {}) },
    cells: [starterCell(f.format)],
    normalize: false,
    result: null,
  };
}

export const STREAM_DEFAULTS: Record<StreamTransport, { address: string; interval: number; mode: StreamMode; window: number }> = {
  poll: { address: '', interval: 5, mode: 'replace', window: 1000 },
  websocket: { address: '', interval: 5, mode: 'append', window: 500 },
  sse: { address: '', interval: 5, mode: 'append', window: 500 },
  osc: { address: '/*', interval: 5, mode: 'append', window: 200 },
  demo: { address: 'demo', interval: 10, mode: 'append', window: 200 },
};

/** A new live dataset (not connected yet; the demo connects when the graph opens). */
export function datasetFromStream(transport: StreamTransport, taken: Iterable<string>, o: { address?: string; name?: string } = {}): Dataset {
  const d = STREAM_DEFAULTS[transport];
  const name = o.name ?? (transport === 'demo' ? 'Demo stream' : 'Live stream');
  return {
    id: datasetIdFor(transport === 'demo' ? 'demo' : 'live', taken),
    name,
    source: { kind: 'stream', transport, address: o.address ?? d.address, window: d.window, mode: d.mode, interval: d.interval, autoConnect: transport === 'demo', onExport: 'freeze' },
    cells: [starterCell('csv')],
    normalize: false,
    result: null,
  };
}
