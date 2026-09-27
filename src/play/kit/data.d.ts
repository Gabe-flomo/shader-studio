import type { Column, DatasetResult, TableResult } from '../../data/types';
import type { DataLayer } from '../../types/playLayers';

export const KD_MAX_MARKS: number;
export const KD_MAX_LABELS: number;
export const KD_MAX_TEXT_ALL: number;

type V = (key: string) => number;
type Layer = Pick<DataLayer, keyof DataLayer> | Record<string, unknown>;

export function kdSplit(text: string, mode: string, sep?: string, size?: number): string[];
export function kdKey(chunk: string): string;
export function kdOrder(chunks: readonly string[], order: string): { items: string[]; counts: number[] };
export function kdJoiner(split: string): string;
export function kdTextItems(result: DatasetResult | null, l: Pick<DataLayer, 'split' | 'separator' | 'chunkSize' | 'order'>): { items: string[]; counts: number[] };

export interface KdState { pos: number; key: string; from: number; cur: number; at: number; started: boolean }
export function kdWrap(k: number, n: number): number;
export function kdState(): KdState;
export function kdCurrent(st: KdState, offset: number, n: number): number;
export function kdStride(l: Pick<DataLayer, 'show' | 'stepBy'>, count: number): number;
export function kdAct(st: KdState, l: Pick<DataLayer, 'show' | 'stepBy'>, offset: number, count: number, n: number, a: { do: string; amount?: number }, rand: () => number): boolean;
export function kdShown(n: number, show: string, from: number, to: number, current: number, count: number): number[];
export interface KdPlan { current: number; sets: Array<{ current: number; rows: number[]; alpha: number }>; fading: boolean }
export function kdPlan(st: KdState, l: Pick<DataLayer, 'show' | 'transition'>, v: V, n: number, time: number): KdPlan;

export function kdColumn(table: TableResult | null, name: string): Column | null;
export function kdCategoryCodes(col: Column): { map: Map<unknown, number>; count: number };
export function kdNumber(col: Column | null, i: number): number | null;
export function kdRange(col: Column | null): { min: number; max: number };
export function kdUnit(col: Column | null, i: number): number | null;
export function kdText(col: Column | null, i: number): string;
export function kdFormat(v: number): string;

export function kdNorm(value: number, min: number, max: number, axes: string, centre: string): number;
export function kdFrac(n: number, axes: string): number;
export function kdZero(min: number, max: number, axes: string, centre: string): number;
export interface KdFrame { left: number; top: number; w: number; h: number }
export function kdFrame(l: Layer, v: V, W: number, H: number, dpr: number, labels: boolean): KdFrame;
export function kdTicks(min: number, max: number, count: number): number[];
export function kdEqualFrame(frame: KdFrame, xr: { min: number; max: number }, yr: { min: number; max: number }, axes: string, centre: string): KdFrame;

export function kdColour(l: Layer, table: TableResult, i: number, k: number, of: number): [number, number, number];
export interface KdPoint { row: number; x: number; y: number; r: number; rgb: [number, number, number]; a: number; rot: number; label: string; at?: number }
export function kdPointsLayout(table: TableResult, l: Layer, v: V, frame: KdFrame, rows: readonly number[], px: number): KdPoint[];
export function kdPathLayout(table: TableResult, l: Layer, v: V, frame: KdFrame, rows: readonly number[], px: number): { pts: KdPoint[]; length: number };
export function kdPathPoint(path: { pts: KdPoint[]; length: number }, t: number): { x: number; y: number; i: number } | null;
export interface KdBar { row: number; x: number; y: number; w: number; h: number; base: number; rgb: [number, number, number]; label: string; value: number | null }
export function kdBarsLayout(table: TableResult, l: Layer, frame: KdFrame, rows: readonly number[]): KdBar[];
export function kdPieLayout(table: TableResult, l: Layer, frame: KdFrame, rows: readonly number[]): { cx: number; cy: number; r: number; slices: Array<{ row: number; a0: number; a1: number; share: number; label: string; rgb: [number, number, number]; k: number }> };
export function kdLinesLayout(table: TableResult, l: Layer, frame: KdFrame, rows: readonly number[]): Array<{ name: string; rgb: [number, number, number]; pts: Array<{ row: number; x: number; y: number }> }>;

export function kdDrawTable(c: CanvasRenderingContext2D, l: Layer, v: V, table: TableResult, rows: readonly number[], frame: KdFrame, W: number, H: number, dpr: number, alpha: number, current: number, mark: boolean): { x: number; y: number } | null;
export function kdWrapText(c: { measureText(t: string): { width: number } }, text: string, maxW: number): string;
export function kdChunkText(l: Pick<DataLayer, 'split' | 'counts'>, items: readonly string[], counts: readonly number[], rows: readonly number[]): string;

/** What s.data(name) returns in a sketch (index and current added by the kit). */
export interface KdScriptView {
  name: string; id: string; kind: 'table' | 'text' | 'json' | 'none';
  rows: unknown[]; columns: string[]; length: number;
  text?: string; value?: unknown;
  col(name: string): unknown[];
  min(name: string): number;
  max(name: string): number;
}
export function kdScriptView(entry: { id: string; name: string; result: DatasetResult | null }, items: readonly string[] | null): KdScriptView;
