import { useEffect, useState } from 'react';

/** Whole seconds since `since` (a Date.now() value), ticking twice a second while it is set; 0 when it is not (or before the first tick). */
export function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [since]);
  return since === undefined || now < since ? 0 : Math.floor((now - since) / 1000);
}
