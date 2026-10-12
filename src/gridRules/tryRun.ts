/**
 * tryRun.ts — the Grid Rules builder's try board (components/gridRules/TryBoard.tsx): a small board
 * you draw on and step through, one generation at a time, back and forward, before building.
 *
 * A run is the frames so far and the one shown. Forward shows the next frame (worked out with the
 * same CPU step the editor's preview always used, gridRules/cpu.ts, which matches the GPU's rule:
 * gridRulesCpuGpu.test.ts); Back shows the one before. Drawing changes the frame shown and drops
 * the frames after it (they no longer follow from it). Only the last MAX_FRAMES are kept.
 *
 * Also the try board's pictures: what each cell's neighbourhood counts, and what the next step does
 * (born, dies, changes). Pure.
 */
import { cpuBoard, cpuStep, type CpuBoard } from './cpu';
import { GRID_DEFAULTS, gridShape, neighbourWeights } from './spec';
import { patternVariants, specMatches, stencilOffset } from './stencils';
import { blockStartsAt, diceFrame } from './dice';
import { withHeading } from './stack';

/** Frames kept for stepping back. */
export const MAX_FRAMES = 400;

export interface TryRun {
  frames: CpuBoard[];
  /** The frame shown. */
  at: number;
  /** The generation of frames[0] (frames dropped off the front still count). */
  first: number;
  /** Step 0's board (as dealt, or as drawn on at step 0): what a reset goes back to, kept when step 0 drops off `frames`. */
  start: CpuBoard;
}

export const tryStart = (board: CpuBoard): TryRun => ({ frames: [board], at: 0, first: 0, start: board });
export const tryBoardOf = (run: TryRun): CpuBoard => run.frames[run.at];
/** The generation shown: 0 is the start. */
export const tryGeneration = (run: TryRun) => run.first + run.at;
export const canBack = (run: TryRun) => run.at > 0;

/** One generation on: the next kept frame, or a new step. `n` steps at once (play at speed). */
export function tryForward(params: Record<string, unknown>, run: TryRun, n = 1): TryRun {
  let { frames, at, first } = run;
  const { start } = run;
  for (let k = 0; k < n; k++) {
    if (at < frames.length - 1) { at++; continue; }
    const next = cpuStep(params, frames[at]);
    frames = [...frames, next];
    at++;
    if (frames.length > MAX_FRAMES) { const drop = frames.length - MAX_FRAMES; frames = frames.slice(drop); at -= drop; first += drop; }
  }
  return { frames, at, first, start };
}

/** One generation back (the start stays the start). */
export const tryBack = (run: TryRun): TryRun => (run.at > 0 ? { ...run, at: run.at - 1 } : run);

/** Back to the first kept frame. */
export const tryRewind = (run: TryRun): TryRun => ({ ...run, at: 0 });

/** The frame shown, changed (a drawing): the frames after it go. */
export function tryEdit(run: TryRun, board: CpuBoard): TryRun {
  return { frames: [...run.frames.slice(0, run.at), board], at: run.at, first: run.first, start: run.first + run.at === 0 ? board : run.start };
}

/**
 * A true reset (↺, lib/runtimeReset.ts): back to step 0's board with every step after it dropped, so
 * the step counter, the alive / dead shares and what plays next are a fresh open's. "Back to the first
 * kept" (tryRewind) stopped at the oldest of the last MAX_FRAMES, not at step 0, and kept the frames.
 */
export const tryReset = (run: TryRun): TryRun => tryStart(run.start);

/**
 * A copy of a board with cell (x, y up) set to `state` (Smooth: its value; a second channel cleared),
 * and `heading` (stacked Move and Collide cards: 1…8, 0 none; red's fraction, gridRules/stack.ts).
 */
export function paintCell(B: CpuBoard, x: number, y: number, state: number, smooth = false, template?: string, heading = 0): CpuBoard {
  if (x < 0 || y < 0 || x >= B.w || y >= B.h) return B;
  const i = y * B.w + x;
  const out: CpuBoard = { ...B, a: B.a.slice(), b: B.b.slice() };
  if (!smooth) { out.a[i] = withHeading(state, heading); out.b[i] = 0; return out; }
  if (template === 'reaction') { out.b[i] = state > 0 ? 1 : 0; return out; }
  out.a[i] = state > 0 ? 1 : 0;
  if (template === 'waves') out.b[i] = out.a[i];
  return out;
}

/** An empty board of the same size (Blocks keep their step count and parity). */
export const clearedBoard = (B: CpuBoard): CpuBoard => ({ ...cpuBoard(B.w, B.h), par: B.par, step: B.step });

/** The cells a board's cell counts, as board cells (wrapped, or left off past a wall), each with its weight (a custom stencil's; else 1). */
export function neighbourCells(params: Record<string, unknown>, B: CpuBoard, x: number, y: number): Array<[number, number, number]> {
  const s = gridShape({ ...GRID_DEFAULTS, ...params });
  const offs = s.type === 'count' || s.type === 'stages' ? neighbourWeights(s) : neighbourWeights({ ...s, neighbourhood: 'moore' });
  const out: Array<[number, number, number]> = [];
  for (const [dx, dy, w] of offs) {
    let nx = x + dx, ny = y + dy;
    if (s.wrap) { nx = (nx + B.w) % B.w; ny = (ny + B.h) % B.h; } else if (nx < 0 || ny < 0 || nx >= B.w || ny >= B.h) continue;
    out.push([nx, ny, w]);
  }
  return out;
}

/** Live neighbours (state 1, as the rule counts them, weights included) of a cell. */
export function liveNeighbours(params: Record<string, unknown>, B: CpuBoard, x: number, y: number): number {
  return neighbourCells(params, B, x, y).reduce((n, [nx, ny, w]) => n + (Math.round(B.a[ny * B.w + nx]) === 1 ? w : 0), 0);
}

export type CellChange = 'born' | 'dies' | 'fades' | 'changes';

/**
 * What the next step does to each cell, comparing a board and the one after it: born (empty → on),
 * dies (on → empty), fades (on → a dying stage), changes (any other new state). Index y * w + x.
 */
export function changesBetween(B: CpuBoard, next: CpuBoard): Map<number, CellChange> {
  const out = new Map<number, CellChange>();
  for (let i = 0; i < B.a.length; i++) {
    const a = Math.round(B.a[i]), b = Math.round(next.a[i]);
    if (a === b) continue;
    out.set(i, a === 0 && b === 1 ? 'born' : b === 0 ? 'dies' : a === 1 && b >= 2 ? 'fades' : 'changes');
  }
  return out;
}

/** Cells (index y * w + x) a Patterns rule matches on a board: its stencil (any orientation) and its count. */
export function patternMatches(params: Record<string, unknown>, B: CpuBoard, rule: number): Set<number> {
  const s = gridShape({ ...GRID_DEFAULTS, ...params });
  const r = s.patterns[rule];
  const out = new Set<number>();
  if (!r) return out;
  const variants = patternVariants(r);
  const at = (x: number, y: number) => {
    if (s.wrap) { x = (x + B.w) % B.w; y = (y + B.h) % B.h; } else { x = Math.max(0, Math.min(B.w - 1, x)); y = Math.max(0, Math.min(B.h - 1, y)); }
    return Math.round(B.a[y * B.w + x]);
  };
  for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
    const c = Array.from({ length: 9 }, (_, k) => { const [dx, dy] = stencilOffset(k); return at(x + dx, y + dy); });
    const hit = variants.some(v => v.every((spec, k) => specMatches(spec, c[k])));
    const n = r.count ? c.filter((v, k) => k !== 4 && v === r.count!.state).length : 0;
    if (hit && (!r.count || (n >= r.count.min && n <= r.count.max))) out.add(y * B.w + x);
  }
  return out;
}

/** The share of cells that aren't empty (Smooth: the largest value). */
export function boardLife(params: Record<string, unknown>, B: CpuBoard): { live: number; share: number } {
  const s = gridShape({ ...GRID_DEFAULTS, ...params });
  if (s.type === 'smooth') {
    let m = 0;
    for (let i = 0; i < B.a.length; i++) m = Math.max(m, s.template === 'reaction' ? B.b[i] : Math.abs(B.a[i]));
    return { live: 0, share: m };
  }
  let k = 0;
  for (let i = 0; i < B.a.length; i++) if (Math.round(B.a[i]) !== 0) k++;
  return { live: k, share: k / B.a.length };
}

/**
 * Blocks: where the 2×2 blocks of the next step sit on a board (bottom-left cell, x right, y up),
 * the same layout the CPU step uses (gridRules/cpu.ts: the step's parity, Jitter's dice).
 */
export function blockRects(params: Record<string, unknown>, B: CpuBoard): Array<[number, number]> {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const par = B.par ?? 0, frame = diceFrame(B.step ?? 0), seed = Number(P.seed) || 0;
  const jitter = Math.max(0, Math.min(1, Number(P.jitter) || 0));
  const W = Math.floor(B.w / 2) * 2, H = Math.floor(B.h / 2) * 2;
  const wrapX = (x: number) => ((x % W) + W) % W;
  const out: Array<[number, number]> = [];
  for (let ox = s.wrap ? par : -par; ox < W + par; ox += 2) {
    for (let oy = s.wrap ? 0 : -1; oy < H; oy++) if (blockStartsAt(wrapX(ox), oy, par, jitter, frame, seed, s.wrap ? H : 0)) out.push([ox, oy]);
  }
  return out;
}
