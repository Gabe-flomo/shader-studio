/**
 * useLamps — each rule's lamp: on while its signal is true, and a flash each
 * time it fires. One timer for the page (ten reads a second), not one per row.
 */
import { useEffect, useState } from 'react';
import { playEngine } from '../../../lib/playEngine';

export function useLamps(ids: readonly string[]): { on: Record<string, boolean>; flash: Record<string, number> } {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const key = ids.join('|');
  useEffect(() => {
    const list = key ? key.split('|') : [];
    const read = () => setOn(prev => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const id of list) { next[id] = playEngine.signalLevel(id); if (next[id] !== !!prev[id]) changed = true; }
      return changed ? next : prev;
    });
    read();
    const t = window.setInterval(read, 100);
    return () => window.clearInterval(t);
  }, [key]);
  useEffect(() => playEngine.onSignal(id => setFlash(f => ({ ...f, [id]: (f[id] ?? 0) + 1 }))), []);
  return { on, flash };
}
