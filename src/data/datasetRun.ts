/**
 * Running a dataset's notebook from the page: in a worker, one job at a time
 * per call, stopped after RUN_TIMEOUT_MS (a cell stuck in a loop). Where
 * workers aren't available (tests) it runs in place.
 */
import { computeDataset, type DatasetJob, type DatasetJobOut } from './compute';

export const RUN_TIMEOUT_MS = 10_000;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (o: DatasetJobOut) => void; timer: number }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./notebookWorker.ts', import.meta.url), { type: 'module', name: 'data-notebook' });
    worker.onmessage = (e: MessageEvent<{ id: number; out: DatasetJobOut }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.delete(e.data.id);
      p.resolve(e.data.out);
    };
    worker.onerror = (e) => {
      // The worker itself broke (it failed to load): every waiting run gets the error.
      for (const [id, p] of pending) { window.clearTimeout(p.timer); p.resolve({ input: null, info: {}, parseError: `The notebook worker stopped: ${e.message || 'unknown error'}`, run: null }); pending.delete(id); }
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Parse the source and run the cells. Never rejects: problems come back in the result. */
export function runDataset(job: DatasetJob): Promise<DatasetJobOut> {
  const w = getWorker();
  if (!w) return Promise.resolve(computeDataset(job));
  const id = ++seq;
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      // Stuck: end the worker (and so the loop); a new one starts on the next run.
      pending.delete(id);
      worker?.terminate();
      worker = null;
      for (const [other, p] of pending) { window.clearTimeout(p.timer); p.resolve({ input: null, info: {}, parseError: 'Stopped with another run that took too long. Run again.', run: null }); pending.delete(other); }
      resolve({ input: null, info: {}, parseError: `Stopped after ${RUN_TIMEOUT_MS / 1000} s: a cell may be looping forever.`, run: null });
    }, RUN_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    w.postMessage({ id, job });
  });
}
