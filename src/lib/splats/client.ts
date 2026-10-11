/**
 * client.ts — talks to the splat worker (worker.ts). One worker for every Splat Scene; each node's scan is kept there
 * under its key. Where workers can't run (tests), the same work runs on this thread.
 */
import type { PackedSplats, SplatInfo } from './pack';
import { handleSplatRequest, type SplatRequest } from './workerCore';

export interface LoadResult { info: SplatInfo; packed: PackedSplats; thumb: Uint8ClampedArray; parseMs: number }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Reply = { id: number; ok: boolean; error?: string } & Record<string, unknown>;

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function onReply(m: Reply): void {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.ok) p.resolve(m); else p.reject(new Error(m.error || 'The splat worker failed.'));
}

function ensureWorker(): Worker | null {
  if (worker || failed) return worker;
  if (typeof Worker === 'undefined') { failed = true; return null; }
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'splats' });
    worker.onmessage = e => onReply(e.data as Reply);
    worker.onerror = e => {
      // A worker that can't start: everything waiting fails with the reason; later requests run here.
      const err = new Error(`The splat worker stopped: ${e.message || 'unknown error'}`);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker?.terminate(); worker = null; failed = true;
    };
  } catch { failed = true; worker = null; }
  return worker;
}

type Body<R> = R extends SplatRequest ? Omit<R, 'id'> : never;

function request<T>(body: Body<SplatRequest>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  const msg = { ...body, id } as SplatRequest;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const w = ensureWorker();
    if (w) w.postMessage(msg, transfer);
    else queueMicrotask(() => handleSplatRequest(msg, reply => onReply(reply as Reply)));
  });
}

/** Read a scan (the bytes are handed over), keep it under `key`, and lay out up to `max` splats with SH up to `sh`. */
export const loadSplats = (key: string, bytes: ArrayBuffer, name: string, max: number, sh: number) =>
  request<LoadResult>({ op: 'load', key, bytes, name, max, sh }, [bytes]);

/** Lay the kept scan out again (Max splats or SH degree changed). */
export const repackSplats = (key: string, max: number, sh: number) =>
  request<{ packed: PackedSplats }>({ op: 'pack', key, max, sh });

/** Far-to-near order along `axis` (in the scan's own space). */
export const sortKeptSplats = (key: string, axis: [number, number, number]) =>
  request<{ order: Uint32Array; ms: number }>({ op: 'sort', key, axis });

/**
 * Far-to-near order of splats a modifier moved: `depths` (one per splat, bigger is farther) were worked out on the GPU
 * from the moved centres. The buffer is handed over and back.
 */
export const sortSplatDepths = (key: string, depths: Float32Array, count: number) =>
  request<{ order: Uint32Array; depths: Float32Array; ms: number }>({ op: 'sortDepths', key, depths, count }, [depths.buffer]);

export const dropSplats =(key: string) => request<unknown>({ op: 'drop', key }).catch(() => {});
