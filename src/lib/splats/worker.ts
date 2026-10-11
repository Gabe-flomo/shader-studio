/** The splat worker: workerCore.ts does the work (parse, pack, sort), off the main thread. */
import { handleSplatRequest, type SplatRequest } from './workerCore';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<SplatRequest>) => void) | null; postMessage: (msg: unknown, transfer: Transferable[]) => void };
ctx.onmessage = e => handleSplatRequest(e.data, (msg, transfer) => ctx.postMessage(msg, transfer ?? []));
