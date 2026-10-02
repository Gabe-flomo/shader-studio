import type { PlayCurve, PlayMapping, PlayRecord, PlaySource, PlaySourceDef, PlayRoute, SourceOutput } from '../../types/play';

export function rtCurve(u: number, curve: PlayCurve, curveY?: number[]): number;
export function rtMap(u: number, r: Pick<PlayRoute, 'outMin' | 'outMax' | 'curve' | 'curveY'>): number;
export type RtSource = PlaySourceDef & { fromMapping?: PlayMapping };
export function rtSourcesOf(record: Pick<PlayRecord, 'mappings' | 'sources'>): RtSource[];
export interface RtState { values: Map<string, number | null>; smooth: Map<string, number>; lag: Map<string, { t: number[]; v: number[] }> }
export function rtNew(): RtState;
export function rtRewind(st: RtState): void;
export interface RtStepHost {
  has(controlId: string): boolean;
  read(source: RtSource, dt: number): number | null;
  step(source: RtSource, output: Extract<SourceOutput, { kind: 'step' }>, dt: number): number | null;
}
export interface RtWrite { route: PlayRoute; value: number }
export function rtStep(st: RtState, sources: readonly RtSource[], host: RtStepHost, dt: number, time: number): RtWrite[];
export interface RtApplyHost {
  kind(controlId: string): 'float' | 'color' | 'action';
  write(controlId: string, route: PlayRoute | null, v: number): void;
  base(controlId: string): number | number[] | undefined;
  range(controlId: string): [number, number];
}
export function rtFrame(st: RtState, sources: readonly RtSource[], read: RtStepHost, apply: RtApplyHost, dt: number, time: number): void;
export function rtTriggersOf(sources: readonly PlaySourceDef[] | undefined): import('../../types/play').TriggerSpec[];
export function rtAddSwing(min: number, max: number): { outMin: number; outMax: number };
export type { PlaySource };
