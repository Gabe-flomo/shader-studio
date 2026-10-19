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

/** A trigger's settings (atTriggerOpts): Threshold and Gate on the 0..1 level, Release a fraction of Threshold. */
export interface AtTriggerOpts { threshold: number; releaseAt: number; gate: number; minMs: number; cooldownMs: number }
export interface AtTriggerState {
  gateOpen: boolean; below: number; armed: boolean; above: number; crossAt: number; lastHit: number;
  trigger: number; signal: number; level: number; gated: number; strength: number; count: number;
}
export const AT_GATE_HOLD: number;
export const AT_TRIGGER_DEFAULTS: AtTriggerOpts;
export function atThresholdFromSensitivity(sensitivity: unknown): number;
export function atNewTriggerState(): AtTriggerState;
export function atStepTrigger(s: AtTriggerState, x: number, now: number, dt: number, o: AtTriggerOpts, g?: number): AtTriggerState;
export function atTriggerOpts(o: Partial<AtTriggerOpts> & { cooldown?: number }): AtTriggerOpts;

export const AT_SCOPE_FRAMES: number;
export interface AtScope { vals: Float32Array; lvls: Float32Array; hits: Uint8Array; at: number }
export function atNewScope(): AtScope;

/** A hit decided ahead (a file analysed ahead) for one frame: how many fired, the signal to plot, the strength. */
export interface AtExtHit { fired: number; signal: number; strength: number; level?: number }
export interface AtHitSettings extends Partial<AtTriggerOpts> { lo: number; hi: number; decay: number; delay?: number; x?: number; level?: number; character?: AtCharacter; charAt?: number; arrival?: AtArrival }
export interface AtHitState extends AtTriggerState { envelope: number; pending: number[]; cands: number[]; arr: Array<{ t: number; f: number; e: number }>; scope: AtScope }
export const AT_HIT_HISTORY: number;
export function atNewHitState(): AtHitState;
export function atHitThreshold(meanFlux: number, sensitivity: number): number;
export function atBandFlux(prev: Float32Array, cur: Float32Array, sampleRate: number, lo: number, hi: number): number;
export function atStepHit(s: AtHitState, freqDb: Float32Array, sampleRate: number, now: number, dt: number, o: AtHitSettings, ext?: AtExtHit): AtHitState;

export const AT_OFFLINE_FFT: number;
export const AT_OFFLINE_HOP_SECONDS: number;
export function atOfflineHop(sampleRate: number): number;
export function atSpectrumDbAt(mono: Float32Array, start: number, n: number, out: Float32Array): Float32Array;
export function atAnalyseLevels(mono: Float32Array, sampleRate: number, ranges: ReadonlyArray<{ lo: number; hi: number }>, hop: number, onProgress?: (f: number) => void): Float32Array[];
export interface AtEvents { times: Float64Array; strengths: Float32Array }
export function atPickTriggers(curve: Float32Array, hopSeconds: number, o: Partial<AtTriggerOpts> & { cooldown?: number }, gateCurve?: ArrayLike<number>): AtEvents;
export function atEventsIn(times: Float64Array, a: number, b: number): { count: number; last: number };
export function atEventsHeard(ev: AtEvents, from: number, to: number, win: { start: number; end: number }, loop: boolean): { count: number; strength: number };
export function atCurveAt(curve: Float32Array, hopSeconds: number, t: number): number;

export const AT_SPECTRUM_MIN_HZ: number;
export function atHzAt(x: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atXOfHz(hz: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atSpectrumMaxHz(sampleRate: number): number;
export function atSpectrumBins(freqDb: Float32Array, sampleRate: number, out: Float32Array, layout: AtLayout, minDb: number, maxDb: number, smoothing?: number): void;
export function atWriteRow(data: Uint8Array, offset: number, row: ArrayLike<number>, w: number): void;
export function atScrollRows(data: Uint8Array, w: number, h: number, row: ArrayLike<number>): void;
export function atWaveRow(wave: Float32Array, out: Float32Array, gain?: number): void;

/** The fields of a band (lib/audioTools/bands.ts AudioBandSpec) the frame reads. */
export interface AtBand { id: string; lo: number; hi: number; value: boolean; trigger: boolean; attack: number; release: number; gain: number; threshold: number; releaseAt: number; gate: number; minMs: number; cooldown: number; detect?: AtDetect; character?: AtCharacter; charAt?: number }
/** A frame's extras for a source's bands or a Hit: hold live hits back `delay` seconds; hits decided ahead. */
export interface AtStepExtras { delay?: number; ext?: AtExtHit }
export interface AtBandRun { band: AtBandState; hit: AtHitState; hitAt: number; feat: AtFeature; flat: number; arr: { hist: Float64Array[] } }

// ── Detect: what a band's Value and Trigger read ──
export type AtDetect = 'level' | 'hits' | 'transient' | 'flatness' | 'brightness' | 'drums';
export type AtCharacter = 'any' | 'noisy' | 'tonal';
export const AT_DETECTS: readonly AtDetect[];
export const AT_CHARACTERS: readonly AtCharacter[];
export const AT_CHAR_AT: number;
export function atDetectOf(d: unknown): AtDetect;
export function atCharacterOf(c: unknown): AtCharacter;
export function atDetectTakesCharacter(d: unknown): boolean;
export const AT_ONSET_TAU: number;
export const AT_ONSET_K: number;
export const AT_ONSET_FLOOR: number;
export const AT_TRANSIENT_TAU: number;
export const AT_TRANSIENT_DB: number;
export const AT_FLAT_DB: number;
export const AT_HPSS_SECONDS: number;
export const AT_HPSS_FREQ: number;
export const AT_HPSS_GROUPS: number;
export const AT_LIVE_FRAME: number;
export function atOfflineLag(hopSeconds: number): number;
export function atBandFlatness(freqDb: Float32Array, sampleRate: number, lo: number, hi: number): number;
export function atBandBrightness(freqDb: Float32Array, sampleRate: number, lo: number, hi: number): number;
export interface AtFeature { key: string; hist: Float32Array[]; mean: number; slow: number; t: number; ring: Array<{ t: number; pow: Float64Array }>; perc: Float32Array[] }
export function atNewFeature(): AtFeature;
export interface AtHpssRegion { nb: number; g: number; m: number; nBand: number; groups: number; start: number }
export function atHpssRegion(nb: number, sampleRate: number, lo: number, hi: number): AtHpssRegion;
export function atGroupPow(freqDb: Float32Array, R: AtHpssRegion, out: Float64Array): Float64Array;
export function atPercRow(cur: ArrayLike<number>, harm: ArrayLike<number>, R: AtHpssRegion): Float32Array;
export function atStepFeature(f: AtFeature, detect: AtDetect, freqDb: Float32Array, sampleRate: number, lo: number, hi: number, dt: number, lag: number, level?: number): number;
export const AT_CHAR_WINDOW: number;
export function atCharPass(character: unknown, flat: number, charAt?: number): boolean;
export function atBandCharacter(b: { detect?: unknown; character?: unknown }): AtCharacter;
export function atCharFilter(ev: AtEvents, aflat: ArrayLike<number>, arise: ArrayLike<number>, hopSeconds: number, character: unknown, charAt?: number): AtEvents;
export interface AtArrival { flat: number; energy: number }
export function atBandArrival(st: { hist: Float64Array[] }, freqDb: Float32Array, sampleRate: number, lo: number, hi: number, lag: number): AtArrival;
export function atSlidingMedian(col: ArrayLike<number>, w: number, out: Float32Array): Float32Array;
/** A range analysed ahead: what its trigger measures, its level (the Gate), its flatness, and what arrived (Only). */
export interface AtFeatureCurves { value: Float32Array; level: Float32Array; flat: Float32Array; aflat: Float32Array; arise: Float32Array }
export function atAnalyseFeatures(mono: Float32Array, sampleRate: number, reqs: ReadonlyArray<{ lo: number; hi: number; detect?: string }>, hop: number, onProgress?: (f: number) => void): AtFeatureCurves[];
export function atNewBandRun(): AtBandRun;
export function atStepBandRun(run: AtBandRun, b: AtBand, freqDb: Float32Array, sampleRate: number, now: number, dt: number, x?: AtStepExtras): AtBandRun;

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
export function atStepSource(st: AtSource, bands: readonly AtBand[], sounds: readonly AtSound[], freq: Float32Array, sampleRate: number, now: number, dt: number, write: (channel: string, v: number) => void, x?: { delay?: number; ext?: Map<string, AtExtHit> }): void;

/** A listening node's settings for a frame (lib/audioTools/engine.ts listenerSpecOf). */
export interface AtListenerSpec {
  type: string;
  lo: number; hi: number;
  attack: number; release: number; gain: number;
  threshold: number; releaseAt: number; gate: number; minMs: number; cooldown: number; decay: number;
  layout: AtLayout; minDb: number; maxDb: number; smoothing: number;
}
export interface AtListener { band: AtBandState; hit: AtHitState; row: Float32Array; data: Uint8Array | null; w: number; h: number; hitAt: number }
export function atNewListener(type: string, w: number, h: number): AtListener;
export function atStepListener(l: AtListener, spec: AtListenerSpec, freq: Float32Array, wave: Float32Array, sampleRate: number, active: boolean, nowMs: number, dt: number, write: (channel: string, v: number) => void, x?: AtStepExtras): boolean;
