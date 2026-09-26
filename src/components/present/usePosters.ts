import { useEffect, useRef, useState } from 'react';
import { renderPoster } from '../../present/runtimeHost';
import { usePresentation } from './presentationStore';

/** Make the stills of sources that have none, one at a time, in the background. */
export function usePosters(): void {
  const sources = usePresentation(s => s.doc?.sources);
  const setPoster = usePresentation(s => s.setPoster);
  const working = useRef(false);
  const tried = useRef(new Set<string>());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (working.current || !sources) return;
    const next = sources.find(s => !s.poster && !tried.current.has(`${s.id}:${s.capturedAt}`));
    if (!next) return;
    working.current = true;
    tried.current.add(`${next.id}:${next.capturedAt}`);
    void renderPoster(next.bundle).then(p => {
      working.current = false;
      if (p) setPoster(next.id, p);
      setTick(t => t + 1); // on to the next one
    });
  }, [sources, setPoster, tick]);
}
