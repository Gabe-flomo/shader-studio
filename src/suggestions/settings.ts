/**
 * settings.ts — whether the Suggestions strip shows (localStorage `playfield:suggestions:strip`,
 * listed in App settings → Studio). Hidden with the strip's ×, back with the canvas toolbar's
 * Suggestions button or by resetting the setting.
 */
import { useSyncExternalStore } from 'react';

export const STRIP_KEY = 'playfield:suggestions:strip';

const listeners = new Set<() => void>();
let shown: boolean | null = null;

function read(): boolean {
  if (shown === null) {
    try { shown = localStorage.getItem(STRIP_KEY) !== 'off'; } catch { shown = true; }
  }
  return shown;
}

export function suggestionsShown(): boolean { return read(); }

export function setSuggestionsShown(on: boolean): void {
  shown = on;
  try {
    if (on) localStorage.removeItem(STRIP_KEY);
    else localStorage.setItem(STRIP_KEY, 'off');
  } catch { /* storage blocked: this session only */ }
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  // App settings' Reset removes the key: pick that up when another tab or the Files page changes it.
  const onStorage = (e: StorageEvent) => { if (e.key === STRIP_KEY || e.key === null) { shown = null; fn(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
};

export function useSuggestionsShown(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
