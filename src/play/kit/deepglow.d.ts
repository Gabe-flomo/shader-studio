/** Deep Glow, shared by the node, the builders and the Finish stack (see deepglow.js). */
export const DG_LEVELS: number;
export const DG_MIN_SCALE: number;
export const DG_TAIL: number;
export const DG_SPREAD_LEVELS: number;
export const DG_SINGLE_TAPS: number;
export const DG_COMPOSITES: readonly ['add', 'screen'];
export function dgLevels(srcScale?: number): number;
export function dgPassCount(levels?: number): number;
export function dgScales(srcScale?: number, levels?: number): number[];
export function dgReach(radius: number, srcScale?: number): number;
export function dgWeight(k: number, reach: number, spread?: number): [number, number, number];
export function dgWeightSum(reach: number, spread?: number, levels?: number): [number, number, number];
export function dgKnee(v: number, threshold: number, knee: number): number;
export function dgCompositePixel(c: number, glow: number, mode: number | 'add' | 'screen'): number;
export const DG_BASE_GLSL: string;
export function dgGlsl(T?: 'texture2D' | 'texture', read?: (q: string) => string): string;
export const DG_GLSL2: string;
