/**
 * gridThumbs — pictures for the Grid Rules builder's presets strip: each preset run on the CPU
 * (gridRules/cpu.ts) for a few steps from its own start, in its own colours, drawn once and kept for
 * the session. Made one at a time between frames, so opening the builder doesn't stall.
 */
import { useEffect, useState } from 'react';
import { cpuColours, cpuSeed, cpuStep } from '../../gridRules/cpu';
import { GRID_DEFAULTS, gridShape, presetPatch, type GridPreset, type GridRuleType } from '../../gridRules/spec';
import { makeRng } from '../../lib/surprise';

const cache = new Map<string, string | null>();
const TW = 66, TH = 38;

function stepsFor(p: Record<string, unknown>): number {
  const s = gridShape(p);
  if (s.type === 'smooth') return s.template === 'reaction' ? 1400 : s.template === 'waves' ? 40 : 30;
  return s.type === 'blocks' ? 40 : 18;
}

/** A preset's picture as a data URL (null without a canvas, as in tests). */
export function gridPresetThumb(type: GridRuleType, pr: GridPreset): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  const ctx = c.getContext?.('2d');
  if (!ctx) return null;
  const p = { ...GRID_DEFAULTS, ruleType: type, ...presetPatch(pr), ...(type === 'smooth' && pr.params.template !== 'reaction' ? { start: 'noise', density: 0.6 } : {}) };
  let B = cpuSeed(p, TW, TH, makeRng(5).next);
  const n = stepsFor(p);
  for (let k = 0; k < n; k++) B = cpuStep(p, B);
  const img = ctx.createImageData(TW, TH);
  cpuColours(p, B, img.data);
  ctx.putImageData(img, 0, 0);
  try { return c.toDataURL(); } catch { return null; }
}

/** The pictures of a table of presets, filled in one by one. */
export function useGridThumbs(type: GridRuleType, table: Record<string, GridPreset>): Record<string, string | null> {
  const keyOf = (k: string) => `${type}:${k}`;
  const [thumbs, setThumbs] = useState<Record<string, string | null>>(() => Object.fromEntries(Object.keys(table).map(k => [k, cache.get(keyOf(k)) ?? null])));
  useEffect(() => {
    let cancelled = false;
    setThumbs(Object.fromEntries(Object.keys(table).map(k => [k, cache.get(keyOf(k)) ?? null])));
    const todo = Object.keys(table).filter(k => !cache.has(keyOf(k)));
    const next = () => {
      if (cancelled || !todo.length) return;
      const k = todo.shift()!;
      const src = gridPresetThumb(type, table[k]);
      cache.set(keyOf(k), src);
      setThumbs(t => ({ ...t, [k]: src }));
      window.setTimeout(next, 16);
    };
    const id = window.setTimeout(next, 60);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [type, table]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}
