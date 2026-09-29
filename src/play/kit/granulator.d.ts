export interface GrParam {
  addr: number; key: string; name: string; min: number; max: number; value: number; unit: string;
  kind: 'number' | 'list' | 'toggle'; step: number; log: boolean; hint: string; values?: string[];
}
export type GrSettings = Record<string, number>;
export interface GrStats {
  count: number; maxCount: number; pos: Float32Array; amp: Float32Array; pitch: Float32Array;
  /** Where a grain is drawn (docs/granulator.md): its pill's length (grain size, 0..1 of the sample) and its stable row (0..1, pan-based when Pan random is on, else a hash of its slot). */
  size: Float32Array; row: Float32Array;
  /** Spectral: each grain's band centre (0..1 on the log axis) and its energy now (0 for other grains). */
  band: Float32Array; energy: Float32Array;
  /** Emit / Spectral: the newest voice's travelling spawn points (0..1; places in the sample, or bands), how many (0: none), on which axis (1 time, 2 band, 0 none). */
  heads: Float32Array; headCount: number; headAxis: number;
}
/** Spectral's analysis (grAnalyse): per STFT frame, up to `peaks` peaks, strongest first (fractional bins, sine amplitudes). */
export interface GrSpectrum { size: number; hop: number; frames: number; peaks: number; len: number; bins: Float32Array; amps: Float32Array; count: Uint8Array; energy: Float32Array }
export interface GrSummary { grains: number; mean: number; spread: number; level: number; pitch: number; band: number; energy: number }
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
  setSpectrum(sp: GrSpectrum | null): void;
  spectrum(): GrSpectrum | null;
  voicesOn(): number;
  reset(seed?: number): void;
  points(data: Float32Array, n: number, cutoff?: number): void;
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
  points(p: GrPoints | null): void;
  stats(): GrStats;
  spectrum(): GrSpectrum | null;
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
  pointsAt?: (t: number) => GrPoints | null;
}

export const GR_MAX_GRAINS: number;
export const GR_MAX_VOICES: number;
export const GR_MODES: readonly string[];
export const GR_DIRS: readonly string[];
export const GR_EDGES: readonly string[];
export const GR_FFT_SIZES: readonly number[];
export const GR_FILTERS: readonly string[];
export const GR_WINDOWS: readonly string[];
export const GR_PARAMS: readonly GrParam[];
export const GR_KEYS: readonly string[];
export const GR_SYNTHS: readonly string[];
export const GR_SAMPLE_SYNTHS: readonly string[];
export const GR_RETIRED_SYNTHS: readonly string[];
export const GR_SYNTH_NAMES: Record<string, string>;
export function grParam(k: string | number): GrParam | null;
export function grDefaults(): GrSettings;
export function grSettings(params: Record<string, number> | undefined, valueOf?: (address: string, base: number) => number): GrSettings;
export interface GrEngineFactory {
  (sampleRate: number, seed?: number, opts?: { autoSpectrum?: boolean }): GrEngine;
  analyse(channels: Float32Array[], size: number): GrSpectrum;
  bandHz(u: number, nyquist: number): number;
}
export function grMakeEngine(): GrEngineFactory;
export function grAnalyse(channels: Float32Array[], size?: number): GrSpectrum;
export function grBufferSpectrum(b: AudioBuffer, size: number): GrSpectrum;
export function grSpectrumImage(sp: GrSpectrum | null, cols: number, rows: number, rate: number): Float32Array;
export function grReadStats(d: unknown, st: GrStats): GrStats;
export function grNewStats(): GrStats;
export function grSummary(st: GrStats): GrSummary;
export function grIdHash(id: number): number;
export function grGrainRow(id: number, pan: number, hasPan: boolean): number;
export function grGrainSpan(pos: number, size: number): [number, number];
export function grGrainOpacity(amp: number): number;
export function grRender(o: GrRenderInput): { left: Float32Array; right: Float32Array; maxCount: number };
export function grWorkletSource(): string;
export function grLoadWorklet(ctx: BaseAudioContext): Promise<boolean>;
export function grCreate(ctx: BaseAudioContext, opts?: { seed?: number; worklet?: boolean }): GrLive;
export function grSynthData(kind: string, rate: number): Float32Array;
export function grSynthBuffer(ctx: BaseAudioContext, kind: string): AudioBuffer;
export function grPeaks(data: Float32Array, n: number): Float32Array;

export interface GrPoints { data: Float32Array; n: number; cutoff: number }
export interface GrFromLink { prop: string; target: string; on: boolean; min: number; max: number }
export interface GrFrom { source: string; boundary: string; births: boolean; links: GrFromLink[] }
export interface GrThing { id: number; x: number; y: number; vx: number; vy: number; age: number; size: number; bright: number; born: boolean }
export const GR_FROM_PROPS: readonly string[];
export const GR_FROM_PROP_NAMES: Record<string, string>;
export const GR_FROM_TARGETS: Record<string, { name: string; min: number; max: number; unit: string }>;
export const GR_FROM_LINKS_MAX: number;
export function grFromDefaults(): GrFrom;
export function grThingProps(t: GrThing, cx: number, cy: number): Record<string, number>;
export function grFromPoints(things: readonly GrThing[], cx: number, cy: number, cfg: Pick<GrFrom, 'links' | 'births'>, settings: GrSettings): GrPoints;
