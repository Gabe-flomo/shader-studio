/**
 * The Code Explorer's indexer, off the main thread (docs/code-explorer-plan.md §4.4).
 * Messages: `{ id, req }` in (host.ts's Request), `{ id, res }` or `{ id, error }` out.
 */
import { createHost, type PrebuiltIndex, type Request } from './host';
import { idbStore, memoryStore } from './store';
import prebuiltUrl from './prebuilt/examples.json?url';

const host = createHost({
  store: async () => (await idbStore()) ?? memoryStore(),
  prebuilt: async () => {
    const r = await fetch(prebuiltUrl);
    return r.ok ? (await r.json()) as PrebuiltIndex : null;
  },
});

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  try {
    const res = await host.handle(req);
    (self as unknown as Worker).postMessage({ id, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
