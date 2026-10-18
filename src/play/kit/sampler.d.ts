export interface SmParam {
  key: string; label: string; min: number; max: number; step: number; value: number; unit: string; hint: string;
  /** What a file may hold (a soft slider can be typed past min/max up to these). */
  lo: number; hi: number;
  /** min/max are physical: typing past them clamps. */
  hard: boolean;
  log?: boolean;
}
export type SmFilter = 'off' | 'lp12' | 'lp24' | 'hp12' | 'hp24' | 'bp12' | 'bp24';
export type SmLfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type SmLfoTo = 'pitch' | 'filter' | 'amp' | 'pan';
export type SmMode = 'classic' | 'oneshot' | 'slice';
export type SmSelect = 'all' | 'cycle' | 'random';

export interface SmSegment { t0: number; t1: number; v0: number; v1: number; slope: number; u0: number; u1: number }

export interface SmHit {
  buffer: AudioBuffer | null;
  [key: string]: unknown;
  mode?: 'oneshot' | 'gate';
  loop?: boolean; reverse?: boolean; choke?: number; retrigger?: boolean; legato?: boolean;
  filter?: SmFilter | string; lfoShape?: SmLfoShape | string; lfoTo?: SmLfoTo | string;
  velocity?: number; glideFrom?: number;
  region?: { start: number; end: number } | null;
}
export interface SmVoice { group: number; start: number; released: boolean; killed: boolean }
export interface SmSampler {
  output: GainNode;
  hit(group: number, o: SmHit, when?: number): SmVoice | null;
  release(group: number, when?: number): void;
  setLive(group: number, o: Record<string, unknown>, when?: number): void;
  choke(group: number, when?: number): void;
  stopAll(when?: number): void;
  playing(group?: number): number;
  setVoices(n: number): void;
}

export const SM_PADS: number;
export const SM_WINDOW: number;
export const SM_CHOKES: number;
export const SM_ZONES: number;
export const SM_DRUM_VOICES: number;
export const SM_KILL: number;
export const SM_PARAMS: readonly SmParam[];
export const SM_PARAM_KEYS: readonly string[];
export const SM_KEYS_PARAMS: readonly SmParam[];
export const SM_FILTERS: readonly SmFilter[];
export const SM_LFO_SHAPES: readonly SmLfoShape[];
export const SM_LFO_TO: readonly SmLfoTo[];
export const SM_MODES: readonly SmMode[];
export const SM_SELECT: readonly SmSelect[];
export const SM_PIANO_KEYS: readonly string[];

export function smParam(key: string): SmParam | null;
export function smKeyProp(key: string): string;
export function smPadKeyParts(k: string): { pad: number; key: string } | null;
export function smClamp(key: string, v: unknown): number;
export function smNumbers(get: (key: string) => number | undefined): Record<string, number>;
export function smNoteName(n: number): string;
export function smNoteOf(name: string): number;
export function smRootFromName(fileName: string, fallback?: number): number;
export function smNoteOfPad(pad: number, base: number): number;
export function smPadOfNote(note: number, base: number): number;
export function smPianoOffset(code: string): number;
export function smShape(u: number, slope: number): number;
export function smEnvSegments(attack: number, decay: number, sustain: number, aSlope: number, dSlope: number, until: number, fade?: number): SmSegment[];
export function smSegAt(g: SmSegment, u: number): number;
export function smEnvAt(t: number, attack: number, decay: number, sustain: number, aSlope?: number, dSlope?: number): number;
export function smReleaseAt(t: number, release: number, rSlope?: number): number;
export function smSchedule(param: AudioParam, at: number, segs: SmSegment[], scale?: number, sampleRate?: number): void;
export function smVelGain(vel: number | undefined, amount: number, curve?: number): number;
export function smZeroCrossing(data: Float32Array, i: number, reach?: number): number;
export function smSnap(data: Float32Array | null | undefined, x: number): number;
export function smTransients(data: Float32Array, sampleRate: number, sens?: number, minGap?: number): number[];
export function smLoopBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, loopStart: number, loopEnd: number, xfade: number): AudioBuffer;
export function smMinMax(data: Float32Array, from: number, to: number, n: number): Float32Array;
export function smCreateSampler(ctx: BaseAudioContext, opts?: { voices?: number }): SmSampler;
export function smZoneHas(z: { lo: number; hi: number; vlo?: number; vhi?: number }, note: number, v127: number): boolean;

export interface SmEnv {
  num(key: string): number | undefined;
  buffer(sound: unknown): AudioBuffer | null;
  state?: { hits: number; lastPitch: number | null };
  /** A pick only (before the hit is recorded): glide's memory is left alone. */
  dry?: boolean;
}
export function smHits(l: unknown, pad: number, vel: number, env: SmEnv, slot?: number): { voices: Array<{ group: number; o: SmHit }>; slot: number };
