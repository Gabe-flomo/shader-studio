import { useEffect, useState } from 'react';
import { playOverlay } from '../../play/overlay';

/** Which Background source shows now (and which fades out), polled from the layer kit while mounted. */
export function useShowing(): { toId: string; fromId: string } | null {
  const [s, setS] = useState(() => playOverlay.queueShowing());
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = playOverlay.queueShowing();
      setS(prev => (prev?.toId === n?.toId && prev?.fromId === n?.fromId ? prev : n));
    }, 150);
    return () => window.clearInterval(id);
  }, []);
  return s;
}
