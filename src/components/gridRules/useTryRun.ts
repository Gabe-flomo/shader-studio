/**
 * useTryRun — the Grid Rules builder's try board, as state (gridRules/tryRun.ts): the frames, play
 * and pause, the try speed, drawing, a new deal, and "Use as the start".
 *
 * The board is dealt as the node's Start would deal it (a drawn start, noise, the centre seed…), on
 * a small board: 64 × 40 cells for whole-number rules (big enough cells to draw on), 96 × 60 for
 * Smooth. It is dealt again when the kind of rule, the template or the start changes (as the node's
 * signature does) and on Deal. A rule edit keeps the frame shown and drops the frames after it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cpuSeed, type CpuBoard } from '../../gridRules/cpu';
import { GRID_DEFAULTS, gridShape, stepsPerSecond } from '../../gridRules/spec';
import { makeRng } from '../../lib/surprise';
import { startCellsFromGrid, startCellsHash, type StartCells } from '../../gridRules/startCells';
import { patternBoard, type TestPattern } from '../../gridRules/explain';
import { headingOfValue } from '../../gridRules/stack';
import { clearedBoard, paintCell, tryBack, tryBoardOf, tryEdit, tryForward, tryReset, tryRewind, tryStart, type TryRun } from '../../gridRules/tryRun';
import { onRuntimeReset } from '../../lib/runtimeReset';

export type TrySpeed = 'slow' | 'medium' | 'built';
export const TRY_SPEEDS: Array<{ value: TrySpeed; label: string; hint: string }> = [
  { value: 'slow', label: 'Slow', hint: 'Three steps a second: follow every cell.' },
  { value: 'medium', label: 'Medium', hint: 'Ten steps a second.' },
  { value: 'built', label: 'As built', hint: 'As many steps a second as the node takes (its Speed).' },
];

/** The try board's size for a rule type. */
export const trySize = (smooth: boolean) => (smooth ? { w: 96, h: 60 } : { w: 64, h: 40 });

/** Steps a second the try board plays at. */
export function trySpeedRate(speed: TrySpeed, params: Record<string, unknown>): number {
  if (speed === 'slow') return 3;
  if (speed === 'medium') return 10;
  return Math.min(240, Math.max(1, stepsPerSecond(params)));
}

/** A drawing from a try board: the cells that are on (Smooth: where a value was dropped). */
export function drawingOf(params: Record<string, unknown>, B: CpuBoard): StartCells | null {
  const s = gridShape({ ...GRID_DEFAULTS, ...params });
  const grid = Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => {
    const i = (B.h - 1 - r) * B.w + x;
    if (s.type !== 'smooth') return Math.round(B.a[i]);
    return (s.template === 'reaction' ? B.b[i] : B.a[i]) > 0.5 ? 1 : 0;
  }));
  // Headings (stacked Move and Collide cards) go with the drawing.
  const heads = s.type !== 'smooth' && s.stack.length ? Array.from({ length: B.h }, (_, r) => Array.from({ length: B.w }, (_, x) => headingOfValue(B.a[(B.h - 1 - r) * B.w + x]))) : undefined;
  return startCellsFromGrid(grid, heads);
}

export interface TryControls {
  run: TryRun;
  board: CpuBoard;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: TrySpeed;
  setSpeed: (v: TrySpeed) => void;
  forward: () => void;
  back: () => void;
  rewind: () => void;
  /** ↺, a true reset: step 0's board, every later step dropped (lib/runtimeReset.ts calls it too). */
  reset: () => void;
  /** A new deal of the start (another roll of the dice for noise). */
  deal: () => void;
  clear: () => void;
  pattern: (p: TestPattern) => void;
  /** Paint (or erase with 0) cells of the frame shown, with a heading (0 none); pauses play. */
  paint: (cells: Array<[number, number]>, state: number, heading?: number) => void;
  size: { w: number; h: number };
}

export function useTryRun(nodeParams: Record<string, unknown>): TryControls {
  const params = { ...GRID_DEFAULTS, ...nodeParams };
  const s = gridShape(params);
  const size = trySize(s.type === 'smooth');
  const live = useRef(params);
  useEffect(() => { live.current = params; });
  const [dealNo, setDealNo] = useState(1);
  const dealKey = `${s.type}:${s.template}:${s.start}:${startCellsHash(s.startCells)}:${s.startCells?.rows.join('/') ?? ''}${s.startCells?.heads?.join('/') ?? ''}:${size.w}x${size.h}:${dealNo}`;
  const seed = useCallback(() => cpuSeed(live.current, size.w, size.h, makeRng(dealNo * 7919 + Number(live.current.seed ?? 1)).next), [dealNo, size.w, size.h]);
  const [run, setRun] = useState<TryRun>(() => tryStart(seed()));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<TrySpeed>(s.type === 'smooth' ? 'built' : 'medium');
  const keyRef = useRef(dealKey);
  useEffect(() => {
    if (keyRef.current === dealKey) return;
    keyRef.current = dealKey;
    setRun(tryStart(seed()));
  }, [dealKey, seed]);
  // A rule edit: the frames after the one shown no longer follow from it.
  useEffect(() => { setRun(r => (r.at < r.frames.length - 1 ? { ...r, frames: r.frames.slice(0, r.at + 1) } : r)); }, [nodeParams]);
  // Smooth rules step at the node's own pace; whole-number ones at a readable one.
  useEffect(() => { setSpeed(s.type === 'smooth' ? 'built' : 'medium'); }, [s.type]);

  // Play: as many steps a frame as the speed asks for.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), owed = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      owed += ((t - last) / 1000) * trySpeedRate(speed, live.current);
      last = t;
      const n = Math.min(8, Math.floor(owed));
      if (n < 1) return;
      owed -= n;
      setRun(r => tryForward(live.current, r, n));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  // The app's ↺ (lib/runtimeReset.ts): the try board starts over with everything else.
  useEffect(() => onRuntimeReset(() => setRun(tryReset)), []);

  const paint = useCallback((cells: Array<[number, number]>, state: number, heading = 0) => {
    setPlaying(false);
    setRun(r => {
      let b = tryBoardOf(r);
      const smooth = gridShape(live.current).type === 'smooth';
      for (const [x, y] of cells) b = paintCell(b, x, y, state, smooth, gridShape(live.current).template, heading);
      return tryEdit(r, b);
    });
  }, []);

  return {
    run, board: tryBoardOf(run), playing, setPlaying, speed, setSpeed, size,
    forward: () => { setPlaying(false); setRun(r => tryForward(live.current, r)); },
    back: () => { setPlaying(false); setRun(tryBack); },
    rewind: () => { setPlaying(false); setRun(tryRewind); },
    reset: () => setRun(tryReset),
    deal: () => { setPlaying(false); setDealNo(d => d + 1); },
    clear: () => { setPlaying(false); setRun(r => tryEdit(r, clearedBoard(tryBoardOf(r)))); },
    pattern: p => { setPlaying(false); setRun(tryStart(patternBoard(p, size.w, size.h, makeRng(dealNo).next))); },
    paint,
  };
}
