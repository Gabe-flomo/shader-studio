import type { PlayIncrement } from '../../types/play';

export const INC_BURST: number;
export interface IncState {
  /** The value it starts at, and returns to on a wrap-back. */
  start: number;
  /** Where it is heading (unfolded: a wrap or bounce is folded on the way out). */
  p: number;
  /** Where the glide started, and how far through it is (1 = arrived). */
  from: number;
  g: number;
  /** Steps since the last wrap-back (the growth's index), and in all. */
  n: number;
  count: number;
  /** 1, or −1 while a ping-pong walks back. */
  dir: 1 | -1;
  /** Threshold: over it (waiting to re-arm), and whether a value has been seen. */
  open: boolean;
  known: boolean;
  /** Repeat: the last clock tick seen. */
  tick: number | null;
}
export type IncEvent = 'step' | 'reset';
export type IncSpec = Pick<PlayIncrement, 'step' | 'growth' | 'factor' | 'minStep' | 'direction' | 'limit' | 'glideMs' | 'glideCurve' | 'wrapAfter' | 'wrapBack' | 'threshold' | 'hysteresis' | 'falling' | 'every' | 'unit' | 'bpm'>;
export function incNew(start: number): IncState;
export function incRange(outMin: number, outMax: number): [number, number];
export function incFold(p: number, lo: number, hi: number, limit: PlayIncrement['limit']): number;
export function incStepSize(inc: Pick<IncSpec, 'step' | 'growth' | 'factor' | 'minStep'>, n: number, current: number): number;
export function incThreshold(st: IncState, v: number | null | undefined, inc: Pick<IncSpec, 'threshold' | 'hysteresis' | 'falling'>): number;
export function incPeriod(inc: Pick<IncSpec, 'every' | 'unit' | 'bpm'>): number;
export function incRepeat(st: IncState, time: number, inc: Pick<IncSpec, 'every' | 'unit' | 'bpm'>, allowed: boolean): number;
export function incAdvance(st: IncState, inc: IncSpec, lo: number, hi: number, count: number): IncEvent[];
export function incReset(st: IncState, start: number, rearm: boolean): void;
export function incGlide(st: IncState, inc: IncSpec, lo: number, hi: number, dt: number): number;
export function incGliding(st: IncState): boolean;
