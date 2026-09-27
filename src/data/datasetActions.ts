/**
 * Making and refreshing datasets: from a file's text to a saved dataset with
 * its first result. The editor and (later) the Data layer share these.
 */
import { runDataset } from './datasetRun';
import type { DatasetJobOut } from './compute';
import { formatFor } from './parse';
import { DATASET_MAX_FILE_BYTES, datasetIdFor, formatBytes, type Dataset, type DatasetFormat } from './types';

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

/** Parse the source and run the notebook. Only file sources are built so far. */
export function runDatasetNotebook(d: Dataset): Promise<DatasetJobOut> {
  if (d.source.kind !== 'file') {
    return Promise.resolve({ input: null, info: {}, parseError: 'Only imported files can be run so far.', run: null });
  }
  return runDataset({ text: d.source.text, format: d.source.format, header: d.source.header, cells: d.cells });
}
