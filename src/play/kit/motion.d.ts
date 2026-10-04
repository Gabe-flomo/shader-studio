export interface MtReads { motion: number; area: number; moveX: number; moveY: number; dirX: number; dirY: number }
export interface MtCdf { cdf: Float32Array; total: number; w: number; h: number }
export interface MtState {
  w: number; h: number; cols: number; rows: number;
  ring: Uint8ClampedArray[];
  grid: Float32Array | null;
  now: Uint8ClampedArray | null;
  then: Uint8ClampedArray | null;
  delay: number;
  vx: number; vy: number;
  cdf: MtCdf | null;
  frames: number;
  reads: MtReads;
}
export interface MtOptions { sensitivity: number; delay: number; smoothing: number; cell: number; aspect: number; dt: number }

export const MT_ROWS: number;
export const MT_MAX_COLS: number;
export const MT_DELAY_MAX: number;
export const MT_MOVING: number;
export const MT_DIR_FULL: number;
export const MT_READS: readonly ['motion', 'area', 'moveX', 'moveY', 'dirX', 'dirY'];
export function mtSampleSize(aspect: number): { w: number; h: number };
export function mtThreshold(sensitivity: number): number;
export function mtGridSize(cell: number, w: number, h: number, aspect: number): { cols: number; rows: number };
export function mtCreate(): MtState;
export function mtLuma(rgba: ArrayLike<number>, n: number, out?: Float32Array): Float32Array;
export function mtFlow(now: Float32Array, then: Float32Array, w: number, h: number, thr: number): { x: number; y: number; n: number };
export function mtReadGrid(grid: ArrayLike<number>, cols: number, rows: number, prev?: MtReads | null): { motion: number; area: number; moveX: number; moveY: number };
export function mtStep(st: MtState, rgba: ArrayLike<number>, w: number, h: number, o: MtOptions): MtState;
export function mtLook(st: MtState, out: Uint8ClampedArray, look: 'grey' | 'black' | 'neon', gain: number): Uint8ClampedArray;
export function mtHeat(v: number): [number, number, number];
export function mtBlur(a: Float32Array, cols: number, rows: number, r: number): Float32Array;
export function mtMaskAlpha(st: MtState, feather: number, cell: number): Float32Array;
