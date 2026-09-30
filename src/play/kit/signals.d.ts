import type { CondCmp, ValueCondition, PairSwap } from '../../types/play';

export const SG_DEPTH: number;
export function sgGate(open: boolean, v: number | null | undefined, cmp: CondCmp, threshold: number, hysteresis: number, tolerance: number, hi?: number): boolean;
export interface SgCondState { open: boolean; known: boolean; lo: number; hi: number; fast: number; slow: number }
export function sgCondNew(): SgCondState;
export function sgCondRewind(st: SgCondState): void;
export function sgIsCrossing(cmp: CondCmp): boolean;
export function sgIsHistory(cmp: CondCmp): boolean;
export function sgIsDirection(cmp: CondCmp): boolean;
export function sgDirStep(st: SgCondState, x: number, window: number | undefined, noise: number | undefined, dt: number): number;
export function sgDirGate(open: boolean, diff: number, cmp: CondCmp, dead: number, h: number): boolean;
export function sgPct(v: number, lo: number, hi: number): number;
export function sgCondStep(st: SgCondState, v: number | null | undefined, c: Pick<ValueCondition, 'cmp' | 'threshold' | 'hysteresis' | 'tolerance' | 'hi' | 'unit' | 'window' | 'noise'>, range?: readonly [number, number] | null, dt?: number): 'open' | 'close' | 'tap' | null;
export function sgRunActions<A extends { do: string; signal?: string; trigger?: { on: string } }>(actions: readonly A[], fires: (a: A) => number, run: (a: A) => void, emit: (id: string) => void, stats?: { depth: number; tripped: boolean }): string[];
export function sgLogic(op: string, levels: readonly boolean[]): boolean;
export function sgSignalOrder(signals: ReadonlyArray<{ id: string; when?: { kind: string; inputs?: string[] } }>): { order: string[]; cyclic: Set<string> };
export interface SgSwapState { axis: 'a' | 'b'; prevA: number | null; prevB: number | null }
export function sgSwapNew(): SgSwapState;
export function sgSwapStep(st: SgSwapState, va: number | null | undefined, vb: number | null | undefined, sw: Pick<PairSwap, 'at' | 'dir' | 'backAt' | 'backDir'>): 'toA' | 'toB' | null;
export type SgValueRef =
  | { kind: 'control'; id: string }
  | { kind: 'mapping'; id: string }
  | { kind: 'mouse'; axis: 'x' | 'y' }
  | { kind: 'distance'; a: string; b: string }
  | { kind: 'prop'; layerId: string; key: string }
  | { kind: 'reading'; layerId: string; read: string }
  | { kind: 'axis'; axis: 'x' | 'y'; anchor: string }
  | { kind: 'picture'; ch: 'lum' | 'r' | 'g' | 'b'; region: string };
export function sgParseValueRef(ref: string): SgValueRef | null;
export function sgScreenPoint(ref: string): { x: number; y: number } | null;
export function sgValueKey(t: Pick<ValueCondition, 'value' | 'cmp' | 'threshold' | 'hysteresis' | 'tolerance' | 'hi' | 'unit' | 'window' | 'noise'>): string;
