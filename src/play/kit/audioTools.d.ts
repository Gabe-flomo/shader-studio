export type AtLayout = 'log' | 'linear';

export function atDbToUnit(db: number): number;
export const AT_DB_FLOOR: number;
export function atBinHz(sampleRate: number, bins: number): number;
export function atBandLevel(freqDb: Float32Array, sampleRate: number, lo: number, hi: number): number;
export function atRmsLevel(wave: Float32Array): number;
export function atFollow(prev: number, target: number, dt: number, attack: number, release: number): number;

export interface AtBandState { level: number; peak: number; heldFor: number }
export function atNewBandState(): AtBandState;
export const AT_PEAK_HOLD: number;
export const AT_PEAK_FALL: number;
export function atStepBand(s: AtBandState, raw: number, dt: number, attack: number, release: number, gain: number): AtBandState;

export interface AtHitSettings { lo: number; hi: number; sensitivity: number; cooldownMs: number; decay: number }
export interface AtHitState {
  prev: Float32Array | null;
  history: Float32Array;
  at: number;
  filled: number;
  lastHit: number;
  trigger: number;
  envelope: number;
  count: number;
  strength: number;
  flux: number;
  threshold: number;
}
export const AT_HIT_HISTORY: number;
export function atNewHitState(): AtHitState;
export function atHitThreshold(meanFlux: number, sensitivity: number): number;
export function atBandFlux(prev: Float32Array, cur: Float32Array, sampleRate: number, lo: number, hi: number): number;
export function atStepHit(s: AtHitState, freqDb: Float32Array, sampleRate: number, now: number, dt: number, o: AtHitSettings): AtHitState;

export const AT_SPECTRUM_MIN_HZ: number;
export function atHzAt(x: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atXOfHz(hz: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atSpectrumMaxHz(sampleRate: number): number;
export function atSpectrumBins(freqDb: Float32Array, sampleRate: number, out: Float32Array, layout: AtLayout, minDb: number, maxDb: number, smoothing?: number): void;
export function atWriteRow(data: Uint8Array, offset: number, row: ArrayLike<number>, w: number): void;
export function atScrollRows(data: Uint8Array, w: number, h: number, row: ArrayLike<number>): void;
export function atWaveRow(wave: Float32Array, out: Float32Array, gain?: number): void;

/** The fields of a band (lib/audioTools/bands.ts AudioBandSpec) the frame reads. */
export interface AtBand { id: string; lo: number; hi: number; value: boolean; trigger: boolean; attack: number; release: number; gain: number; sensitivity: number; cooldown: number }
export interface AtBandRun { band: AtBandState; hit: AtHitState; hitAt: number }
export function atNewBandRun(): AtBandRun;
export function atStepBandRun(run: AtBandRun, b: AtBand, freqDb: Float32Array, sampleRate: number, now: number, dt: number): AtBandRun;

export const AT_LEARN_BANDS: number;
export const AT_LEARN_MIN_HZ: number;
export const AT_LEARN_MAX_HZ: number;
export const AT_LEARN_WINDOW: number;
export const AT_ENV_POINTS: number;
export const AT_MATCH_FALL: number;
export const AT_LEARN_RING_SECONDS: number;
export const AT_LEARN_ONSET: { sensitivity: number; cooldownMs: number };

export interface AtLearnFrame { t: number; bands: Float32Array; flux: number }
export interface AtFingerprint { spec: number[]; env: number[] }
export interface AtOnsetState { prev: Float32Array | null; history: Float32Array; at: number; filled: number; last: number; flux: number; trigger: number }
/** The fields of a learned sound (lib/audioTools/learn.ts AudioSoundSpec) the frame reads. */
export interface AtSound { id: string; match: number; cooldown: number; trigger: boolean; matchOut: boolean; spec: readonly number[]; env: readonly number[] }
export interface AtSoundRun { trigger: number; match: number; last: number; lastFire: number; hitAt: number; count: number }
export interface AtLearnListener {
  onset: AtOnsetState;
  pending: { t0: number; frames: AtLearnFrame[] } | null;
  ring: AtLearnFrame[];
  runs: Map<string, AtSoundRun>;
  onsets: number;
}
export function atLearnBands(freqDb: Float32Array, sampleRate: number, out?: Float32Array): Float32Array;
export function atLearnFlux(prev: Float32Array, cur: Float32Array): number;
export function atNewOnsetState(): AtOnsetState;
export function atStepOnset(s: AtOnsetState, bands: Float32Array, now: number): AtOnsetState;
export function atFingerprintOf(frames: readonly AtLearnFrame[]): AtFingerprint | null;
export function atSimilarity(a: AtFingerprint, b: { spec: readonly number[]; env: readonly number[] }): number;
export function atNewLearnListener(): AtLearnListener;
export function atStepLearn(L: AtLearnListener, sounds: readonly AtSound[], freqDb: Float32Array, sampleRate: number, now: number, dt: number): void;

export const AT_CARD_BINS: number;
export interface AtSource { runs: Map<string, AtBandRun>; learn: AtLearnListener; row: Float32Array }
export function atNewSource(): AtSource;
export function atApplyGain(freq: Float32Array, wave: Float32Array, gain: number): number;
export function atStepSource(st: AtSource, bands: readonly AtBand[], sounds: readonly AtSound[], freq: Float32Array, sampleRate: number, now: number, dt: number, write: (channel: string, v: number) => void): void;

/** A listening node's settings for a frame (lib/audioTools/engine.ts listenerSpecOf). */
export interface AtListenerSpec {
  type: string;
  lo: number; hi: number;
  attack: number; release: number; gain: number;
  sensitivity: number; cooldown: number; decay: number;
  layout: AtLayout; minDb: number; maxDb: number; smoothing: number;
}
export interface AtListener { band: AtBandState; hit: AtHitState; row: Float32Array; data: Uint8Array | null; w: number; h: number; hitAt: number }
export function atNewListener(type: string, w: number, h: number): AtListener;
export function atStepListener(l: AtListener, spec: AtListenerSpec, freq: Float32Array, wave: Float32Array, sampleRate: number, active: boolean, nowMs: number, dt: number, write: (channel: string, v: number) => void): boolean;
