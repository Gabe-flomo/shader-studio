export interface GrParam {
  addr: number; key: string; name: string; min: number; max: number; value: number; unit: string;
  kind: 'number' | 'list' | 'toggle'; step: number; log: boolean; hint: string; values?: string[];
}
export type GrSettings = Record<string, number>;
export interface GrStats { count: number; maxCount: number; pos: Float32Array; amp: Float32Array; pitch: Float32Array }
export interface GrSummary { grains: number; mean: number; spread: number; level: number; pitch: number }
export interface GrEngine {
  setBuffer(channels: Float32Array[], rate: number): void;
  set(s: Partial<GrSettings>): void;
  noteOn(note: number, vel: number, frame?: number): void;
  noteOff(note: number, frame?: number): void;
  allOff(frame?: number): void;
  bend(semis: number, frame?: number): void;
  sync(frame: number): void;
  frame(): number;
  process(left: Float32Array, right: Float32Array, n: number): void;
  stats(o: GrStats): GrStats;
  voicesOn(): number;
  reset(seed?: number): void;
}
export interface GrLive {
  output: GainNode;
  readonly kind: '' | 'worklet' | 'script';
  setBuffer(b: AudioBuffer | null): void;
  set(s: GrSettings): void;
  noteOn(note: number, vel: number, when?: number): void;
  noteOff(note: number, when?: number): void;
  allOff(when?: number): void;
  bend(semis: number, when?: number): void;
  stats(): GrStats;
  dispose(): void;
}
export interface GrRenderInput {
  channels: Float32Array[];
  bufferRate?: number;
  sampleRate?: number;
  frames: number;
  settings?: Partial<GrSettings>;
  events?: ReadonlyArray<{ t: number; note: number; vel: number }>;
  settingsAt?: (t: number) => Partial<GrSettings>;
  seed?: number;
  step?: number;
}

export const GR_MAX_GRAINS: number;
export const GR_MAX_VOICES: number;
export const GR_MODES: readonly string[];
export const GR_FILTERS: readonly string[];
export const GR_WINDOWS: readonly string[];
export const GR_PARAMS: readonly GrParam[];
export const GR_KEYS: readonly string[];
export const GR_SYNTHS: readonly string[];
export const GR_SYNTH_NAMES: Record<string, string>;
export function grParam(k: string | number): GrParam | null;
export function grDefaults(): GrSettings;
export function grSettings(params: Record<string, number> | undefined, valueOf?: (address: string, base: number) => number): GrSettings;
export function grMakeEngine(): (sampleRate: number, seed?: number) => GrEngine;
export function grNewStats(): GrStats;
export function grSummary(st: GrStats): GrSummary;
export function grRender(o: GrRenderInput): { left: Float32Array; right: Float32Array; maxCount: number };
export function grWorkletSource(): string;
export function grLoadWorklet(ctx: BaseAudioContext): Promise<boolean>;
export function grCreate(ctx: BaseAudioContext, opts?: { seed?: number; worklet?: boolean }): GrLive;
export function grSynthData(kind: string, rate: number): Float32Array;
export function grSynthBuffer(ctx: BaseAudioContext, kind: string): AudioBuffer;
export function grPeaks(data: Float32Array, n: number): Float32Array;
