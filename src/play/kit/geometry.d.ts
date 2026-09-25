import type { CompiledZone } from '../particle-sim';
export interface DistanceField { d: Float32Array; gw: number; gh: number }
export function geoCompile(shape: Record<string, unknown>, aspect: number): CompiledZone;
export function sdfBox(px: number, py: number, hw: number, hh: number, r: number): number;
export function sdfEllipse(px: number, py: number, a: number, b: number): number;
export function sdfCapsule(px: number, py: number, hw: number, hh: number): number;
export function sdfPolygon(px: number, py: number, pts: number[]): number;
export function sdfSegments(px: number, py: number, segs: number[]): number;
export function geoFieldFromMask(mask: Uint8Array, gw: number, gh: number): DistanceField;
export function geoFieldAt(f: DistanceField, x: number, y: number): number;
export function geoFieldFromBrightness(sample: Uint8ClampedArray, sw: number, sh: number, threshold: number): DistanceField;
export function geoFieldFromAlpha(data: Uint8ClampedArray, gw: number, gh: number): DistanceField;
