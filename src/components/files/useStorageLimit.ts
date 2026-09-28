/** The storage limit setting (files/storageLimit.ts) as a hook, kept current across tabs. */
import { useSyncExternalStore } from 'react';
import { readStorageLimit, STORAGE_LIMIT_CHANGED } from '../../files/storageLimit';

const subscribe = (fn: () => void) => {
  window.addEventListener(STORAGE_LIMIT_CHANGED, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(STORAGE_LIMIT_CHANGED, fn); window.removeEventListener('storage', fn); };
};

/** The limit in bytes (0: none). */
export function useStorageLimit(): number {
  return useSyncExternalStore(subscribe, readStorageLimit, readStorageLimit);
}
