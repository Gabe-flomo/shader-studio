/**
 * The notebook's worker: parses the file and runs the cells off the main
 * thread, so a big file or a slow cell never freezes the picture. The page
 * side is runDataset() in datasetRun.ts, which also stops a run that takes
 * too long by ending this worker.
 */
import { computeDataset, type DatasetJob } from './compute';

const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((e: MessageEvent) => void) | null };

scope.onmessage = (e: MessageEvent<{ id: number; job: DatasetJob }>) => {
  const { id, job } = e.data;
  scope.postMessage({ id, out: computeDataset(job) });
};
