/** Shared blur and glow code (see blur.js and docs/blur-and-glow.md). */
export const BL_SIGMA_PER_RADIUS: number;
export const BL_MAX_PAIRS: number;
export const BL_SIGMA_TARGET: number;
export const BL_MIN_SCALE: number;
export const BL_MAX_LEVELS: number;
export const BL_DOWN13_VAR: number;
export const BL_BSPLINE_VAR: number;
export const BL_BLOOM_W_GLSL: string;

export function blGaussianWeights(sigma: number, half?: number): number[];
export function blLinearTaps(sigma: number, half?: number): { offsets: number[]; weights: number[] };
export function blSize(w: number, h: number, scale: number): [number, number];
export interface BlSmoothPlan { sigma: number; downs: number; scale: number; variance: number; cubic: boolean }
export function blSmoothPlan(radius: number, srcScale?: number): BlSmoothPlan;
export interface BlBloomPlan { levels: number; scales: number[]; passes: number }
export function blBloomPlan(radius: number, srcScale?: number): BlBloomPlan;
export function blBloomReach(radius: number, srcScale?: number): number;
export function blBloomWeight(radius: number, srcScale: number, k: number): number;
export function blChainSizes(w: number, h: number, scales: number[]): Array<[number, number]>;
export function blGlsl(T?: 'texture2D' | 'texture', read?: (q: string) => string, suffix?: string): string;
export const BL_GLSL2: string;
export const BL_BASE_GLSL: string;
export const BL_PREV_GLSL: string;
export function blCubicGlsl(T?: 'texture2D' | 'texture', name?: string, read?: (q: string) => string): string;
