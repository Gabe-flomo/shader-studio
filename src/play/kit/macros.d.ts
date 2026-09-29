export const MC_POINTS_MAX: number;
export function mcCurve(u: number, curve: string, points?: readonly number[]): number;
export function mcTargetValue(v: number, target: { min: number; max: number; curve: string; points?: readonly number[] }): number;
