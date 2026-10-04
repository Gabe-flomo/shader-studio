/** Character sets shared by the Glyphs layer and the Finish stack's ASCII effect (see glyphs.js). */
export interface GySet { name: string; chars: string }
export const GY_SETS: readonly GySet[];
export const GY_MAX: number;
export const GY_FONT: string;
export function gyList(chars: string): string[];
export function gyCoverage(data: ArrayLike<number>, width: number, cols: number, cell: number, n: number): number[];
export function gyOrder(coverage: readonly number[], keepOrder: boolean): number[];
export interface GyAtlas { canvas: HTMLCanvasElement; n: number; cols: number; rows: number; cell: number; glyphs: string[]; coverage: number[] }
export function gyAtlas(chars: string, keepOrder: boolean, cell?: number): GyAtlas | null;
