/**
 * Posters for Files items, as they arrive: the cache answers at once for
 * things drawn before (by content hash); the rest are drawn one at a time
 * in the background. The renderer is loaded on first use.
 */
import { useEffect, useState } from 'react';
import type { FileNode } from '../../files/inventory';

export type PosterMap = Record<string, string | null | undefined>;

export function useItemPosters(items: FileNode[]): PosterMap {
  const [posters, setPosters] = useState<PosterMap>({});
  const key = items.map(n => `${n.id}#${n.hash ?? ''}`).join('|');
  useEffect(() => {
    let live = true;
    (async () => {
      const { itemPoster, posterable } = await import('../../files/posters');
      for (const n of items) {
        if (!posterable(n)) continue;
        itemPoster(n).then(url => { if (live) setPosters(p => (p[n.id] === url ? p : { ...p, [n.id]: url })); }, () => { if (live) setPosters(p => ({ ...p, [n.id]: null })); });
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return posters;
}

/** Example graphs' posters (a node page's examples), by example key. */
export function useExamplePosters(keys: string[]): PosterMap {
  const [posters, setPosters] = useState<PosterMap>({});
  const k = keys.join('|');
  useEffect(() => {
    let live = true;
    (async () => {
      const { examplePoster } = await import('../../files/posters');
      for (const key of keys) examplePoster(key).then(url => { if (live) setPosters(p => ({ ...p, [key]: url })); }, () => { if (live) setPosters(p => ({ ...p, [key]: null })); });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return posters;
}
