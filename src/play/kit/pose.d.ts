import type { TkFrame, TkSubject } from './tracks.js';

export const PS_POINT_NAMES: string[];
export const PS_POINTS: number;
export const PS_BONES: [number, number][];
export const PS_GESTURES: string[];

export interface PsUpdateOptions { picAspect: number; place?: { cx: number; cy: number; h: number; rot: number; mirror: boolean }; smoothing?: number; responsiveness?: number; appearFrames?: number }

export function psCreate(): TkSubject;
export function psUpdate(st: TkSubject, frame: TkFrame, o: PsUpdateOptions): void;
export function psRead(st: TkSubject | null, read: string, point: number, axis: string, gesture: string): number | null;
export function psGate(st: TkSubject | null, gesture: string): boolean;
export function psPoint(st: TkSubject | null, i: number): { x: number; y: number } | null;
export function psDraw(ctx: CanvasRenderingContext2D, st: TkSubject | null, W: number, H: number, dpr: number, rgb?: [number, number, number]): void;
