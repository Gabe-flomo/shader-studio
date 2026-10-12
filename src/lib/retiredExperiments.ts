/**
 * retiredExperiments.ts — removed experiments (docs/retired-experiments.md). Nothing reads what they stored any
 * more, so it is removed once at start-up:
 *  - 2026-10-08, taste and generation: the taste profile, its page's open sections, Deep's switch, the looks gallery;
 *  - 2026-10-11, the on-device explanation model: its settings, and its downloaded weights in the browser cache
 *    (only that model's files; the image and depth models share the cache and are kept).
 */
const KEYS = ['shader-studio:taste', 'shader-studio:taste-page:open', 'surprise:deep'];

/** The explanation model's settings (on/off, which one, downloaded flags per model). */
const EXPLAIN_MODEL_KEY = /^shader-studio:settings:(useExplainModel|explainModelDownloaded|explainModelActive)(:|$)/;
/** The explanation models' repos, as they appear in cached download URLs. */
const EXPLAIN_MODEL_FILES = /onnx-community\/(Qwen2\.5-Coder-1\.5B-Instruct|Qwen3-4B-ONNX|Olmo-3-7B-Instruct-ONNX)\//i;

/** Keys of `store` that belong to the retired explanation model. */
export function retiredExplainKeys(store: Pick<Storage, 'length' | 'key'>): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && EXPLAIN_MODEL_KEY.test(k)) out.push(k); }
  return out;
}

/** Whether a cached request URL is one of the retired explanation model's files. */
export const isRetiredModelFile = (url: string): boolean => EXPLAIN_MODEL_FILES.test(url);

export function dropRetiredExperimentData(): void {
  try { for (const k of [...KEYS, ...retiredExplainKeys(localStorage)]) localStorage.removeItem(k); } catch { /* storage unavailable */ }
  try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('shader-studio-looks'); } catch { /* none */ }
  void dropRetiredModelFiles();
}

async function dropRetiredModelFiles(): Promise<void> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has('transformers-cache'))) return;
    const cache = await caches.open('transformers-cache');
    for (const req of await cache.keys()) if (isRetiredModelFile(req.url)) await cache.delete(req);
  } catch { /* no Cache Storage here */ }
}
