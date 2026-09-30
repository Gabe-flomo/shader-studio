import type { CondCmp, ValueCondition, PairSwap } from '../../types/play';

export const SG_DEPTH: number;
export function sgGate(open: boolean, v: number | null | undefined, cmp: CondCmp, threshold: number, hysteresis: number, tolerance: number): boolean;
export interface SgCondState { open: boolean; known: boolean }
export function sgCondNew(): SgCondState;
export function sgIsCrossing(cmp: CondCmp): boolean;
export function sgCondStep(st: SgCondState, v: number | null | undefined, c: Pick<ValueCondition, 'cmp' | 'threshold' | 'hysteresis' | 'tolerance'>): 'open' | 'close' | 'tap' | null;
export function sgRunActions<A extends { do: string; signal?: string; trigger?: { on: string } }>(actions: readonly A[], fires: (a: A) => number, run: (a: A) => void, emit: (id: string) => void, stats?: { depth: number; tripped: boolean }): string[];
export interface SgSwapState { axis: 'a' | 'b'; prevA: number | null; prevB: number | null }
export function sgSwapNew(): SgSwapState;
export function sgSwapStep(st: SgSwapState, va: number | null | undefined, vb: number | null | undefined, sw: Pick<PairSwap, 'at' | 'dir' | 'backAt' | 'backDir'>): 'toA' | 'toB' | null;
export type SgValueRef =
  | { kind: 'control'; id: string }
  | { kind: 'mapping'; id: string }
  | { kind: 'mouse'; axis: 'x' | 'y' }
  | { kind: 'distance'; a: string; b: string }
  | { kind: 'prop'; layerId: string; key: string };
export function sgParseValueRef(ref: string): SgValueRef | null;
export function sgScreenPoint(ref: string): { x: number; y: number } | null;
export function sgValueKey(t: Pick<ValueCondition, 'value' | 'cmp' | 'threshold' | 'hysteresis' | 'tolerance'>): string;
