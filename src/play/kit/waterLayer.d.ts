import type { FnParam, FnWaterField } from './finish.js';

export type WlRead = 'waveHeight' | 'energy' | 'area';
export type WlRegionShape = 'all' | 'rect' | 'ellipse';
export interface WlRegion { shape: WlRegionShape; x0: number; y0: number; w: number; h: number; scale: number }
export const WL_READS: readonly ['waveHeight', 'energy', 'area'];
export const WL_REGIONS: readonly WlRegionShape[];
export const WL_FIELD_ROWS: number;
export const WL_HEIGHT_FULL: number;
export const WL_MOVING: number;
export const WL_ENERGY_GAIN: number;
export const WL_PARAMS: readonly FnParam[];
export function wlLayerKey(effectKey: string): string;
export function wlEffectKey(layerKey: string): string;
export function wlRegion(l: { region?: string } | null | undefined, v: (key: string) => number, W: number, H: number): WlRegion;
export function wlToLocal(reg: WlRegion, p: { x: number; y: number }, W: number, H: number): { x: number; y: number };
export function wlToPicture(reg: WlRegion, p: { x: number; y: number }, W: number, H: number): { x: number; y: number };
export function wlEffect(l: object | null | undefined): { id: string; kind: 'water'; enabled: true; source: string; sourceLayer: string; shape: string; layerId: string; detail: 'low' | 'medium' | 'high' };
export function wlValue(reg: WlRegion, value: (key: string) => number | undefined, W: number, H: number): (e: unknown, key: string) => number | undefined;
export function wlInside(shape: string, u: number, v: number): boolean;
export function wlEdgeAlpha(shape: string, u: number, v: number, pw: number, ph: number, H: number, soft: number): number;
export function wlSample(f: FnWaterField, u: number, v: number): number;
export function wlReadings(f: FnWaterField | null, shape: string, probe: { x: number; y: number } | null): { waveHeight: number; energy: number; area: number };
export function wlMatteAlpha(f: FnWaterField, reg: WlRegion, H: number, feather: number, soft: number): Float32Array;
