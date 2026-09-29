import type { SpreadCurve } from '../../types/play';

export const SP_CURVES: readonly SpreadCurve[];
export const SP_POINTS: number;
export const SP_MAX_MEMBERS: number;
export function spCurve(u: number, curve: SpreadCurve, curveY: readonly number[] | undefined, invert: boolean): number;
export function spPlace(k: number, n: number): number;
export function spWeight(i: number, n: number, shift: number, curve: SpreadCurve, curveY: readonly number[] | undefined, invert: boolean): number;
export function spWeights(n: number, shift: number, curve: SpreadCurve, curveY: readonly number[] | undefined, invert: boolean): number[];
export function spValue(base: number, lo: number, hi: number, amount: number, w: number): number;
