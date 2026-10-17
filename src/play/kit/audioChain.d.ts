export type AcFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking';
export type AcScale = 'minor' | 'major' | 'pentatonic' | 'minorPentatonic' | 'minorChord' | 'majorChord' | 'fifths' | 'harmonic';
export type AcSpectralMode = 'freeze' | 'blur' | 'gate';

/** One effect's settings for a frame (lib/audioTools engine effectSpecOf): the app and an exported page read the same. */
export interface AcSpec {
  type: 'audioFilter' | 'audioResonator' | 'audioSpectral';
  filterType: AcFilterType;
  frequency: number;
  q: number;
  gain: number;
  count: number;
  root: number;
  scale: AcScale;
  decay: number;
  brightness: number;
  mix: number;
  mode: AcSpectralMode;
  freeze: boolean;
  amount: number;
  threshold: number;
}

export interface AcCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

export const AC_FFT: number;
export const AC_MAX_RESONATORS: number;
export const AC_SPECTRAL_BINS: number;
export const AC_TAU: number;
export const AC_FILTER_TYPES: AcFilterType[];
export function acBiquadCoeffs(type: string, f0: number, q: number, gainDb: number, sampleRate: number): AcCoeffs;
export function acBiquadMag(c: AcCoeffs, hz: number, sampleRate: number): number;
export function acBiquadRun(c: AcCoeffs, x: ArrayLike<number>, out?: Float32Array, st?: number[]): Float32Array;

export const AC_SCALES: Record<AcScale, number[] | 'fifths' | 'harmonic'>;
export const AC_NOTE_NAMES: string[];
export function acMidiHz(note: number): number;
export function acNoteName(note: number): string;
export function acResonatorNotes(root: number, scale: string, count: number): number[];
export function acResonatorHz(root: number, scale: string, count: number, sampleRate?: number): number[];
export function acResonatorQ(hz: number, decay: number): number;
export function acResonatorGains(hzs: number[], brightness: number): number[];
export function acResonatorMakeup(q: number): number;
export const AC_ENERGY_FLOOR_DB: number;
export const AC_ENERGY_TOP_DB: number;
export function acEnergyUnit(rms: number): number;
export function acBankOf(spec: Pick<AcSpec, 'root' | 'scale' | 'count' | 'decay' | 'brightness'>, sampleRate: number): { hz: number[]; q: number[]; gains: number[]; makeup: number };
export function acResonatorEnergies(samples: Float32Array, sampleRate: number, spec: Pick<AcSpec, 'root' | 'scale' | 'count' | 'decay' | 'brightness'>): number[];
export function acLoudest(energies: ArrayLike<number>, n: number): number;

export const AC_SPECTRAL_CORE: string;
export const AC_SPECTRAL_WORKLET: string;
export function acLoadSpectral(ctx: BaseAudioContext): Promise<boolean>;

export interface AcEffect {
  type: AcSpec['type'];
  ctx: BaseAudioContext;
  input: GainNode;
  output: GainNode;
  probe: AnalyserNode;
  taps: AnalyserNode[];
  makeup: number;
  n: number;
  /** Spectral: false until its worklet is in (the sound passes straight through until then). */
  ready: boolean;
  disposed: boolean;
  update(spec: AcSpec): void;
  dispose(): void;
}
export function acBuild(ctx: BaseAudioContext, spec: AcSpec): AcEffect;

export interface AcRun {
  level: number;
  energies: Float32Array;
  loudest: number;
  peak: number;
  row: Float32Array;
  data: Uint8Array | null;
  w: number;
  h: number;
  freq: Float32Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
  tap: Float32Array<ArrayBuffer>;
  sr: number;
}
export function acTextureSize(spec: Pick<AcSpec, 'type' | 'count'>): { w: number; h: number };
export function acNewRun(spec: Pick<AcSpec, 'type' | 'count'>): AcRun;
export const AC_ENERGY_ATTACK: number;
export const AC_ENERGY_RELEASE: number;
export function acStepEffect(run: AcRun, fx: AcEffect | null, spec: AcSpec, active: boolean, dt: number, write: (channel: string, v: number) => void): boolean;
