import type { CompiledZone } from '../particle-sim';
export interface DistanceField { d: Float32Array; gw: number; gh: number }
export function geoCompile(shape: Record<string, unknown>, aspect: number): CompiledZone;
export function sdfBox(px: number, py: number, hw: number, hh: number, r: number): number;
export function sdfEllipse(px: number, py: number, a: number, b: number): number;
export function sdfCapsule(px: number, py: number, hw: number, hh: number): number;
export function sdfPolygon(px: number, py: number, pts: number[]): number;
export function sdfSegments(px: number, py: number, segs: number[]): number;
export function geoFieldFromMask(mask: Uint8Array, gw: number, gh: number): DistanceField;
export function geoFieldFromCoverage(cover: Float32Array, gw: number, gh: number, minCover: number): DistanceField;
export function geoFieldAt(f: DistanceField, x: number, y: number): number;
export function geoFieldFromBrightness(sample: Uint8ClampedArray, sw: number, sh: number, threshold: number): DistanceField;
export function geoFieldFromAlpha(data: Uint8ClampedArray, gw: number, gh: number): DistanceField;
/** A layer's centre for proximity and distance (see geometry.js). */
export function geoAnchor(
  layer: { id: string; kind: string } & Record<string, unknown>,
  value: (key: string) => number,
  aspect: number,
  reported: (key: string) => number | undefined,
  lookup: (id: string) => { layer: { id: string; kind: string } & Record<string, unknown>; value: (key: string) => number } | null,
  depth?: number,
): { x: number; y: number } | null;

/** A path shape's geometry (see geoPathBuild): outline and links in picture heights, readings raw. */
export interface GeoPath {
  style: GeoPathStyle;
  closed: boolean;
  pts: number[];
  segs: number[];
  alphas: number[];
  cx: number; cy: number;
  x0: number; y0: number; x1: number; y1: number;
  area: number; perimeter: number; spread: number;
  /** Set by the kit: how far the shape has faded in (On lost: Fade), 0..1. */
  alpha?: number;
}
export type GeoPathStyle = 'fill' | 'smooth' | 'circle' | 'lines' | 'web';
export const GEO_PATH_STYLES: GeoPathStyle[];
export const GEO_PATH_FADE_S: number;
export function geoHull(points: [number, number][]): [number, number][];
export function geoCatmullRom(points: [number, number][], steps: number): [number, number][];
export function geoPolyArea(pts: number[]): number;
export function geoPolyLength(pts: number[], closed: boolean): number;
export function geoPathNodes(nodes: { x: number; y: number; lost?: boolean }[], onLost: string): { pts: { x: number; y: number }[]; target: 0 | 1 };
export function geoPathFade(prev: number | undefined, target: number, dt: number): number;
export function geoPathBuild(points: { x: number; y: number }[], aspect: number, o: { style: string; hull?: boolean; circleMode?: string; webReach?: number; lineR?: number }): GeoPath;
export function geoPathReadings(geo: GeoPath, aspect: number): { area: number; perimeter: number; spread: number };
