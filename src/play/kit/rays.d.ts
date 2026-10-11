/** Radial Fast Blur / Light rays, shared by the node, the builders and the Finish stack (see rays.js). */
export const RF_TAPS: number;
export const RF_PASSES: number;
export const RF_SINGLE_TAPS: number;
export const RF_MODES: readonly ['average', 'brightest', 'add'];
export const RF_DIRECTIONS: readonly ['out', 'in'];
export const RF_MAX_LENGTH: number;
export function rfEffective(passes?: number, taps?: number): number;
export function rfSpan(length: number): number;
export function rfStep(length: number, k: number, passes?: number, taps?: number): number;
export function rfOffsets(length: number, passes?: number, taps?: number): number[];
export function rfDecayRate(length: number, decay: number): number;
export function rfKnee(luma: number, threshold: number, knee: number): number;
export function rfCompositePixel(orig: number, rays: number, mode: number | 'average' | 'brightest' | 'add', amount: number): number;
export const RF_BASE_GLSL: string;
export function rfGlsl(T?: 'texture2D' | 'texture', read?: (q: string) => string): string;
export const RF_GLSL2: string;
