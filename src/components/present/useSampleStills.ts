import { useEffect, useState } from 'react';
import { renderPoster } from '../../present/runtimeHost';
import { snapshotExample } from '../../present/snapshot';
import type { SamplePresentation } from '../../present/samples';

/**
 * The pictures on the empty Present page's sample cards: each sample's `still` example,
 * snapshotted and drawn once, one at a time in the background. Kept for the session (in
 * memory and sessionStorage, never in localStorage, where presentations live).
 */
const KEY = 'shader-studio:present:sampleStill:';
const W = 384, H = 216;
const made = new Map<string, string | null>();
let queue: Promise<void> = Promise.resolve();

function cached(key: string): string | null | undefined {
  if (made.has(key)) return made.get(key);
  try {
    const s = sessionStorage.getItem(KEY + key);
    if (s) { made.set(key, s); return s; }
  } catch { /* storage blocked */ }
  return undefined;
}

/** A hidden tab draws nothing: a still that came out all black is a failed one, not a picture. */
async function isBlank(src: string): Promise<boolean> {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('still')); img.src = src; });
  const c = document.createElement('canvas');
  c.width = 16; c.height = 9;
  const g = c.getContext('2d');
  if (!g) return false;
  g.drawImage(img, 0, 0, 16, 9);
  const d = g.getImageData(0, 0, 16, 9).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 6 || d[i + 1] > 6 || d[i + 2] > 6) return false;
  return true;
}

const visible = () => document.visibilityState === 'visible' ? Promise.resolve() : new Promise<void>(res => {
  const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); res(); } };
  document.addEventListener('visibilitychange', on);
});

async function draw(key: string): Promise<string | null> {
  await visible();
  const r = await snapshotExample(key);
  const png = r.ok ? await renderPoster(r.source.bundle, 1.5, W, H) : null;
  // A blank one isn't kept, so the next visit tries again.
  if (png && await isBlank(png).catch(() => true)) return null;
  made.set(key, png);
  if (png) { try { sessionStorage.setItem(KEY + key, png); } catch { /* full or blocked */ } }
  return png;
}

export function useSampleStills(samples: readonly SamplePresentation[]): Record<string, string | null> {
  const [stills, setStills] = useState<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {};
    for (const s of samples) { const c = s.still ? cached(s.still) : null; if (c !== undefined) out[s.title] = c; }
    return out;
  });
  useEffect(() => {
    let live = true;
    for (const s of samples) {
      const key = s.still;
      if (!key || cached(key) !== undefined) continue;
      queue = queue.then(async () => {
        if (!live) return;
        const png = cached(key) !== undefined ? cached(key)! : await draw(key).catch(() => null);
        if (live) setStills(prev => ({ ...prev, [s.title]: png }));
      });
    }
    return () => { live = false; };
  }, [samples]);
  return stills;
}
