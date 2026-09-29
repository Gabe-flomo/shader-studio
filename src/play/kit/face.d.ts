import type { TkFrame, TkSubject } from './tracks.js';

export const FC_BLEND_NAMES: string[];
export const FC_ANGLES: number;
export const FC_POINTS: number;
export const FC_NAMED_POINTS: [number, string][];
export const FC_OUTLINES: number[][];
export const FC_GESTURES: string[];

export interface FcUpdateOptions { picAspect: number; place?: { cx: number; cy: number; h: number; rot: number; mirror: boolean }; smoothing?: number; responsiveness?: number; appearFrames?: number }

export function fcCreate(): TkSubject;
export function fcHeadAngles(m: ArrayLike<number> | null | undefined): [number, number, number];
export function fcUpdate(st: TkSubject, frame: TkFrame, o: FcUpdateOptions): void;
export function fcBlend(st: TkSubject, name: string): number;
export function fcRead(st: TkSubject | null, read: string, point: number, axis: string, gesture: string): number | null;
export function fcGate(st: TkSubject | null, gesture: string): boolean;
export function fcPoint(st: TkSubject | null, i: number): { x: number; y: number } | null;
export function fcDraw(ctx: CanvasRenderingContext2D, st: TkSubject | null, W: number, H: number, dpr: number, rgb?: [number, number, number]): void;
