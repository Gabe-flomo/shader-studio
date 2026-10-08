/**
 * retiredExperiments.ts — the taste and generation experiments were retired on 2026-10-08
 * (docs/retired-experiments.md). Nothing reads what they stored any more, so it is removed once at
 * start-up: the taste profile, its page's open sections, Deep's switch, and the looks gallery.
 */
const KEYS = ['shader-studio:taste', 'shader-studio:taste-page:open', 'surprise:deep'];

export function dropRetiredExperimentData(): void {
  try { for (const k of KEYS) localStorage.removeItem(k); } catch { /* storage unavailable */ }
  try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('shader-studio-looks'); } catch { /* none */ }
}
