/**
 * One dataset build: read the source text, then run the notebook over it.
 * Pure: the worker runs it, and so do the tests.
 */
import { runNotebook, summarizeResult, type NotebookRun, type ValuePreview } from './notebook';
import { parseSourceText, type ParseInfo } from './parse';
import type { DatasetFormat, DatasetResult, HeaderMode, TableResult } from './types';

export interface DatasetJob {
  /** The source's text (a file, a fetched link, a stream's saved window)… */
  text: string;
  /** …or its table, already read (a typed-in table, a stream's live window): then `text` is ignored. */
  table?: TableResult;
  format: DatasetFormat;
  header?: HeaderMode;
  cells: Array<{ id: string; code: string }>;
}

export interface DatasetJobOut {
  /** What the file read as, before the notebook (null when it didn't parse). */
  input: ValuePreview | null;
  info: ParseInfo;
  /** Why the file didn't read. */
  parseError?: string;
  run: NotebookRun | null;
}

export function computeDataset(job: DatasetJob): DatasetJobOut {
  let parsed: { result: DatasetResult; info: ParseInfo };
  if (job.table) return { input: summarizeResult(job.table), info: {}, run: runNotebook(job.table, job.cells) };
  try {
    parsed = parseSourceText(job.text, job.format, { header: job.header });
  } catch (e) {
    return { input: null, info: {}, parseError: e instanceof Error ? e.message : String(e), run: null };
  }
  return { input: summarizeResult(parsed.result), info: parsed.info, run: runNotebook(parsed.result, job.cells) };
}
