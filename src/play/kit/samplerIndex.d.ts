import type { DpIndexMode } from './drumPads.js';
import type { GrParam } from './granulator.js';

export interface SiZone { lo: number; hi: number; root: number }

export const SI_MODES: readonly DpIndexMode[];
export const SI_MODE_NAMES: readonly string[];
export const SI_INDEX_LIMIT: number;
export const SI_PARAMS: readonly GrParam[];
export function siParam(k: string | number): GrParam | null;
export function siClamp(k: string | number, v: number): number;
export function siMode(v: number): DpIndexMode;
export function siZoneOf(zones: readonly SiZone[], note: number): number;
export function siOrder(zones: readonly SiZone[]): number[];
export function siPickNote(zones: readonly SiZone[], note: number, index: number, mode: DpIndexMode | string, spread: number, r: number): number;
export function siPick(zones: readonly SiZone[], note: number, index: number, mode: DpIndexMode | string, spread: number, seed: number, hit: number): number;
export function siHold(map: Map<number, number[]>, key: number, sent: number): void;
export function siLetGo(map: Map<number, number[]>, key: number): number | undefined;
