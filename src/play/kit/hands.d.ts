import type { PlayLayer } from '../../types/play';

export type HdSide = 'left' | 'right' | 'any';

/** One tracker frame: camera frame time (ms), its size, and up to two hands with 21 landmarks each (x, y, z flattened). */
export interface HdFrame {
  t: number;
  w: number;
  h: number;
  hands: { side: 'left' | 'right'; score: number; lm: ArrayLike<number> }[];
}

export interface HdPlace { cx: number; cy: number; h: number; rot: number; mirror: boolean }

export interface HdHand {
  present: boolean;
  seen: number;
  ever: boolean;
  pts: Float64Array;
  d: { palm: number; pinchRatio: number[]; pinch: number[]; curl: number[]; thumbOut: boolean; open: number; roll: number; size: number; px: number; py: number };
  g: Record<'pinch' | 'pinchMiddle' | 'pinchRing' | 'pinchPinky' | 'fist' | 'open' | 'point', boolean>;
}

export interface HdState { live: boolean; t: number; seq: number; count: number; aspect: number; left: HdHand; right: HdHand }

export const HD_POINT_NAMES: string[];
export const HD_TIPS: number[];
export const HD_BONES: [number, number][];
export const HD_GESTURES: string[];
export const HD_HOLD_MS: number;

export function hdCreate(): HdState;
export function hdEuroStep(f: { x: number; dx: number; t: number }, v: number, t: number, minCutoff: number, beta: number): number;
export function hdEuroParams(smoothing: number): { minCutoff: number; beta: number };
export function hdPlacement(record: { layers: PlayLayer[] } | null, value: ((l: PlayLayer, k: string) => number) | null, camAspect: number, picAspect: number, mirror: boolean): HdPlace;
export function hdToPicture(u: number, v: number, place: HdPlace, camAspect: number, picAspect: number): [number, number];
export function hdUpdate(st: HdState, frame: HdFrame, o: { picAspect: number; place?: HdPlace; smoothing?: number }): void;
export function hdAge(st: HdState, now: number): void;
export function hdHandFor(st: HdState, side: string): HdHand;
export function hdRead(st: HdState, side: string, read: string, point: number, axis: string, gesture: string): number | null;
export function hdGate(st: HdState, side: string, gesture: string): boolean;
export function hdPoint(st: HdState, side: string, point: number): { x: number; y: number } | null;
export function hdDraw(ctx: CanvasRenderingContext2D, st: HdState, W: number, H: number, dpr: number, rgb?: [number, number, number]): void;
