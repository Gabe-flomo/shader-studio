/** Chromatic Aberration, shared by the node, the builders and the Finish stack (see chroma.js). */
export const CA_MODES: readonly ['spectral', 'split'];
export const CA_GEOMETRIES: readonly ['lateral', 'axial', 'directional'];
export const CA_MIN_TAPS: number;
export const CA_MAX_TAPS: number;
export const CA_TAPS: number;
export const CA_SUB: number;
export const CA_DIST: number;
export const CA_SPREAD: number;
export function caSpec(t: number): [number, number, number];
export function caTapCount(mode: number | 'spectral' | 'split', samples: number): number;
export function caSpectralWeights(n?: number, mode?: number | 'spectral' | 'split'): Array<{ t: number; shift: number; w: [number, number, number] }>;
export function caShiftPx(geom: number | 'lateral' | 'axial' | 'directional', amount: number, r: number, falloff: number): number;
export function caBlurPx(shiftPx: number, blur: number, axialAmount?: number, shift?: number): number;
export function caReads(mode: number | 'spectral' | 'split', samples: number, blur: number, geom: number | 'lateral' | 'axial' | 'directional'): number;
export function caRow(f: (x: number) => [number, number, number], x: number, amount: number, n?: number, mode?: 'spectral' | 'split'): [number, number, number];
export const CA_BASE_GLSL: string;
export function caGlsl(T?: 'texture2D' | 'texture', read?: (q: string) => string): string;
export const CA_GLSL2: string;
