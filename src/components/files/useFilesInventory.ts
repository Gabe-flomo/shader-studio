/**
 * The Files page's inventory, rebuilt when storage changes. Built a slice at
 * a time (yielding to the browser every few milliseconds) so a big library
 * never freezes the page, and the browser's own estimate of its other
 * storage (IndexedDB, caches) alongside.
 */
import { useEffect, useRef, useState } from 'react';
import { buildInventory, type Inventory } from '../../files/inventory';
import { localMutableKV } from '../../files/mutate';
import { listExternal } from '../../files/sources';
import { LIBRARY_REFRESH_EVENTS } from '../../utils/library';
import { FILES_CHANGED } from './filesActions';
import { storageUsage, warnIfNear, type StorageUsage } from '../../files/storageLimit';

export interface StorageEstimate { usage: number; quota: number }

/** A pause that yields only once ~8 ms of work has piled up. */
function slicer(): () => Promise<void> | void {
  let last = performance.now();
  return () => {
    if (performance.now() - last < 8) return;
    return new Promise<void>(r => setTimeout(() => { last = performance.now(); r(); }, 0));
  };
}

export function useFilesInventory(): { inv: Inventory | null; building: boolean; estimate: StorageEstimate | null; usage: StorageUsage | null; refresh: () => void } {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [building, setBuilding] = useState(true);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const gen = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const my = ++gen.current;
    let cancelled = false;
    (async () => {
      const external = await listExternal();
      const next = await buildInventory(localMutableKV, { external, pause: slicer() });
      if (!cancelled && my === gen.current) { setInv(next); setBuilding(false); }
      try {
        const e = await navigator.storage?.estimate?.();
        if (!cancelled && e) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
      } catch { /* not offered */ }
      // Usage against the device's storage limit (the media library and the workspace folder included), measured afresh.
      try {
        const u = await storageUsage(true);
        if (!cancelled) { setUsage(u); warnIfNear(u.total); }
      } catch { /* a store couldn't be read */ }
    })().catch(e => { console.error('[files] building the inventory', e); if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
  }, [nonce]);

  useEffect(() => {
    const soon = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { setBuilding(true); setNonce(n => n + 1); }, 120); };
    const events = [FILES_CHANGED, 'storage', 'saved-graphs-changed', ...LIBRARY_REFRESH_EVENTS];
    for (const ev of events) window.addEventListener(ev, soon);
    return () => { for (const ev of events) window.removeEventListener(ev, soon); window.clearTimeout(timer.current); };
  }, []);

  return { inv, building, estimate, usage, refresh: () => { setBuilding(true); setNonce(n => n + 1); } };
}
