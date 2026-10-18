/**
 * settings.ts — whether the Suggestions strip shows (localStorage `playfield:suggestions:strip`,
 * listed in App settings → Studio). Off unless turned on: the canvas right-click menu's
 * Show Next suggestions (stored as 'on'); hidden again with the strip's × or that menu.
 */
import { useSyncExternalStore } from 'react';

export const STRIP_KEY = 'playfield:suggestions:strip';

const listeners = new Set<() => void>();
let shown: boolean | null = null;

function read(): boolean {
  if (shown === null) {
    try { shown = localStorage.getItem(STRIP_KEY) === 'on'; } catch { shown = false; }
  }
  return shown;
}

export function suggestionsShown(): boolean { return read(); }

export function setSuggestionsShown(on: boolean): void {
  shown = on;
  try {
    if (on) localStorage.setItem(STRIP_KEY, 'on');
    else localStorage.removeItem(STRIP_KEY);
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
  return useSyncExternalStore(subscribe, read, () => false);
}

// ── Folded or open ───────────────────────────────────────────────────────────
// The Next strip is the one suggestion surface (docs/glossary.md). It opens with its list the first
// time, so it is found; once a move has been used (or it has been folded by hand) it starts folded
// to a small "Next" chip under the card, and a click opens it. Remembered on this device.

export const STRIP_OPEN_KEY = 'playfield:suggestions:open';
const openListeners = new Set<() => void>();
let openState: boolean | null = null;

function readOpen(): boolean {
  if (openState === null) {
    try { openState = localStorage.getItem(STRIP_OPEN_KEY) !== 'folded'; } catch { openState = true; }
  }
  return openState;
}

export function suggestionsOpen(): boolean { return readOpen(); }

export function setSuggestionsOpen(open: boolean): void {
  openState = open;
  try { localStorage.setItem(STRIP_OPEN_KEY, open ? 'open' : 'folded'); } catch { /* this session only */ }
  for (const fn of openListeners) fn();
}

const subscribeOpen = (fn: () => void) => { openListeners.add(fn); return () => { openListeners.delete(fn); }; };

export function useSuggestionsOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, readOpen, () => true);
}
