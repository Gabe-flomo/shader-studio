/**
 * storageLimitApp.ts — the storage limit (storageLimit.ts) wired to the app:
 * where usage comes from (localStorage, the media library, the workspace
 * folder, the browser's estimate) and how a refusal shows (a toast with a way
 * to Files → Clean up). Imported once, by main.tsx.
 */
import { toast } from '../components/ui/toastStore';
import { OPEN_FILES_PAGE } from '../components/files/filesActions';
import { isOwnedKey } from './inventory';
import { isAudioType, listImages, listVideos, BACKGROUNDS_CHANGED } from '../lib/backgroundLibrary';
import { workspaceFolderBytes } from '../workspace/workspace';
import { LIBRARY_REFRESH_EVENTS } from '../utils/library';
import { invalidateUsage, limitLabel, OPEN_CLEANUP_VIEW, setLimitReporter, setUsageSources, usedLabel } from './storageLimit';

let cleanupWanted = false;
/** Open the Files page on Clean up (read when it opens, or heard when it's open). */
export function openFilesCleanup(): void {
  cleanupWanted = true;
  window.dispatchEvent(new Event(OPEN_FILES_PAGE));
  window.dispatchEvent(new Event(OPEN_CLEANUP_VIEW));
}
export function takeCleanupRequest(): boolean { const w = cleanupWanted; cleanupWanted = false; return w; }

function localTotal(): number {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isOwnedKey(k)) continue;
      const v = localStorage.getItem(k);
      if (v != null) n += k.length + v.length;
    }
  } catch { /* storage blocked */ }
  return n;
}

export function installStorageLimit(): void {
  if (typeof window === 'undefined') return;
  setUsageSources({
    local: localTotal,
    async media() {
      const [images, videos] = await Promise.all([listImages(), listVideos()]);
      return {
        images: images.reduce((n, i) => n + i.bytes, 0),
        videos: videos.filter(v => !isAudioType(v.type)).reduce((n, v) => n + v.bytes, 0),
        sounds: videos.filter(v => isAudioType(v.type)).reduce((n, v) => n + v.bytes, 0),
      };
    },
    workspace: workspaceFolderBytes,
    async estimate() {
      try { const e = await navigator.storage?.estimate?.(); return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null; } catch { return null; }
    },
  });
  setLimitReporter({
    refused: message => toast.error('Storage limit reached', { message: message.replace(/^Storage limit reached: /, ''), action: { label: 'Open Files → Clean up', onClick: openFilesCleanup } }),
    warn: (used, limit) => toast.warning('Storage nearly full', { message: `${usedLabel(used)} of ${limitLabel(limit)} used. Free space on the Files page or raise the limit in Settings.`, action: { label: 'Open Files → Clean up', onClick: openFilesCleanup } }),
  });
  for (const ev of [BACKGROUNDS_CHANGED, ...LIBRARY_REFRESH_EVENTS, 'files-changed', 'storage']) window.addEventListener(ev, invalidateUsage);
}
