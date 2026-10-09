/**
 * The presets strip's thumbnails (agentBuilder/miniSim.ts): each preset's walkers run for a few
 * seconds on a small trail, rendered once (one at a time, off the click path) and kept for the
 * session.
 */
import { useEffect, useState } from 'react';
import { TrailSim, simFromRules, walkersFor } from '../../agentBuilder/miniSim';
import type { BuilderPreset } from '../../agentBuilder/presets';
import { DotSim } from '../../agentBuilder/dotSim';

const BG: [number, number, number] = [13, 13, 18];

const thumbs = new Map<string, string>();
const queued = new Set<string>();
const thumbListeners = new Set<() => void>();
let running = false;
const work: Array<() => void> = [];

function pump() {
  if (running) return;
  const job = work.shift();
  if (!job) return;
  running = true;
  setTimeout(() => { try { job(); } finally { running = false; for (const l of thumbListeners) l(); pump(); } }, 30);
}

/** One preset's picture: its walkers run for a few seconds on a 176 × 100 trail. */
export function renderPresetThumb(p: BuilderPreset, w = 176, h = 100, steps = 260): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  if (p.dots) {
    // Particles, flocks, crowds, orbiters: their dots run from the preset's cards, the last second as fading streaks.
    const set = p.set();
    // Neighbours are exact here (every pair), so the kinds that look round them get fewer dots.
    const sim = new DotSim(set, set.kind === 'particles' ? 480 : 260, p.dots, w / h, 7);
    ctx.fillStyle = `rgb(${BG.join(',')})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      sim.step();
      if (i < 180) continue;
      ctx.fillStyle = `rgba(${BG.join(',')},0.12)`;
      ctx.fillRect(0, 0, w, h);
      sim.draw(ctx, w, h, 1.4);
    }
    try { return c.toDataURL('image/png'); } catch { return null; }
  }
  const base = simFromRules(p.set(), { halfLife: 0.06, diffuse: 1 });
  const sim = new TrailSim(w, h, walkersFor(w, h), p.sim ? p.sim(base) : base, 7);
  for (let i = 0; i < steps; i++) sim.step();
  const img = ctx.createImageData(w, h);
  sim.draw(img.data, BG);
  ctx.putImageData(img, 0, 0);
  try { return c.toDataURL('image/png'); } catch { return null; }
}

/** The presets' thumbnails (rendered in turn, cached for the session): key → picture. */
export function usePresetThumbs(presets: readonly BuilderPreset[]): Record<string, string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump(v => v + 1);
    thumbListeners.add(l);
    for (const p of presets) {
      if (thumbs.has(p.key) || queued.has(p.key)) continue;
      queued.add(p.key);
      work.push(() => { const t = renderPresetThumb(p); if (t) thumbs.set(p.key, t); });
    }
    pump();
    return () => { thumbListeners.delete(l); };
  }, [presets]);
  return Object.fromEntries(presets.filter(p => thumbs.has(p.key)).map(p => [p.key, thumbs.get(p.key)!]));
}

