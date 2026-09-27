export interface DpParam { key: string; label: string; min: number; max: number; step: number; value: number; unit: string; hint: string }
export type DpMode = 'oneshot' | 'gate';
export type DpSynth = 'kick' | 'snare' | 'hat' | 'openhat' | 'clap' | 'tom' | 'rim' | 'cowbell';

export interface DpHit {
  buffer: AudioBuffer | null;
  start?: number; end?: number; pitch?: number; volume?: number; pan?: number;
  attack?: number; decay?: number; sustain?: number; release?: number; vel?: number;
  mode?: DpMode; loop?: boolean; reverse?: boolean; choke?: number;
  /** The hit's velocity 0..1. */
  velocity?: number;
}
export interface DpSampler {
  output: GainNode;
  hit(pad: number, o: DpHit, when?: number): unknown;
  release(pad: number, when?: number): void;
  setLive(pad: number, o: Partial<DpHit>, when?: number): void;
  stopAll(when?: number): void;
  playing(pad?: number): number;
}

export const DP_PADS: number;
export const DP_COLS: number;
export const DP_PARAMS: readonly DpParam[];
export const DP_PARAM_KEYS: readonly string[];
export const DP_MODES: readonly DpMode[];
export const DP_CHOKES: number;
export const DP_SYNTHS: readonly DpSynth[];
export const DP_KEYS: readonly string[];
export const DP_BASE_NOTE: number;

export function dpKey(i: number, key: string): string;
export function dpKeyParts(k: string): { pad: number; key: string } | null;
export function dpParam(key: string): DpParam | null;
export function dpClamp(key: string, v: unknown): number;
export function dpPadOfKey(code: string): number;
export function dpPadOfNote(note: number, base: number): number;
export function dpPadOfCell(col: number, row: number): number;
export function dpRate(pitch: number): number;
export function dpVelGain(vel: number | undefined, amount: number): number;
export function dpRegion(duration: number, start: number, end: number, reverse: boolean): { offset: number; length: number };
export function dpEnvAt(t: number, attack: number, decay: number, sustain: number): number;
export function dpEnvPoints(attack: number, decay: number, sustain: number, until: number): Array<[number, number]>;
export function dpReverse(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer;
export function dpHitNumbers(get: (key: string) => number | undefined): Record<string, number>;
export function dpCreateSampler(ctx: BaseAudioContext): DpSampler;
export function dpSynthData(kind: string, rate: number): Float32Array;
export function dpSynthBuffer(ctx: BaseAudioContext, kind: string): AudioBuffer;
export function dpPeaks(data: Float32Array, n: number): Float32Array;
