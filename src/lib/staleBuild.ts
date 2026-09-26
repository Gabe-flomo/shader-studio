/**
 * staleBuild.ts — a tab opened before a new version was deployed still asks
 * for the old version's code files (the pages, dialogs and editors that load
 * on demand), which the deploy replaced: they 404 and that part of the app
 * can't open. Say so once and offer a reload. Never reload by itself: the
 * open graph may have unsaved changes.
 */
import { toast } from '../components/ui/toastStore';

let shown = false;

/** A dynamic import or preload that failed because the file isn't there any more. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

export function reportStaleBuild(): void {
  if (shown) return;
  shown = true;
  toast.warning('Playfield was updated', {
    message: 'This tab is still running the previous version, so part of it couldn’t load. Save your graph if it has unsaved changes, then reload.',
    action: { label: 'Reload', onClick: () => location.reload() },
    sticky: true,
  });
}

/** Listen for failed chunk loads anywhere in the app. Call once at startup. */
export function watchForStaleBuild(): void {
  // Not preventDefault: that makes Vite resolve the import with nothing, and the caller then
  // crashes on it. Let the import fail; lazyWithSuspense catches it.
  window.addEventListener('vite:preloadError', () => reportStaleBuild());
  window.addEventListener('unhandledrejection', e => { if (isChunkLoadError(e.reason)) { e.preventDefault(); reportStaleBuild(); } });
}
