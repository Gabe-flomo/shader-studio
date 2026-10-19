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

/** Learn a sound's onsets: spectral flux against an adaptive threshold. */
export const AT_HIT_HISTORY: number;
export function atHitThreshold(meanFlux: number, sensitivity: number): number;
export function atBandFlux(prev: Float32Array, cur: Float32Array, sampleRate: number, lo: number, hi: number): number;

// ── The hit detector ──
export type AtPreset = 'kick' | 'snare' | 'hats' | 'notes' | 'custom';
export interface AtPresetDef {
  lo: number; hi: number; split?: [number, number]; fft: number; bpo: number; maxFilter: boolean; lambda?: number; floor?: number; stepDb?: number;
  /** ms */ preMax: number; /** ms */ preAvg: number; delta: number; /** ms */ minInterval: number; gateDb: number; character: AtCharacter; attack: number; release: number;
}
export const AT_DET_FFT: number;
export const AT_DET_HOP_SECONDS: number;
export function atDetHop(sampleRate: number): number;
export const AT_DET_LOW_HZ: number;
export const AT_DET_LAMBDA: number;
export const AT_DET_DIFF: number;
export const AT_DET_MAX_TAU: number;
export const AT_DET_MAX_FLOOR: number;
export function atDetFloor(lambda: number): number;
export const AT_DET_STEP_DB: number;
export const AT_DET_GATE_HYST: number;
export const AT_DET_GATE_HOLD: number;
export const AT_DET_VALUE_FLOOR: number;
export const AT_DET_LAG: number;
export const AT_DET_NOISE_MARGIN: number;
export const AT_DOB: { alpha: number; gamma: number; beta: number; frame: number };
export const AT_DET_PRESETS: Record<AtPreset, AtPresetDef>;
export const AT_DET_PRESET_KEYS: readonly AtPreset[];
export function atDetPresetOf(k: unknown): AtPreset;
export const AT_DET_SENSITIVITY: number;
export function atDetDelta(presetDelta: number, sensitivity: unknown): number;
export function atDetRanges(preset: unknown, lo: number, hi: number): Array<[number, number]>;
/** The part of a detector's settings that changes the analysis (a File's is analysed once per spec). */
export interface AtDetSpec { fft: number; ranges: Array<[number, number]>; bpo: number; maxFilter: boolean; lambda?: number; floor?: number; stepDb?: number }
/** A band's or Hit's detector settings, resolved (seconds, dBFS). */
export interface AtDetConfig {
  preset: AtPreset; lo: number; hi: number; spec: AtDetSpec; specKey: string;
  preMax: number; preAvg: number; delta: number; minInterval: number; gateDb: number; trackNoise: boolean; attack: number; release: number;
  /** Only, resolved: the band's, or its preset's. */
  character: AtCharacter; charAt: number;
}
/** What a detector's settings are read from: a band, or a Hit's spec. */
export interface AtDetSettings { preset?: unknown; lo?: number; hi?: number; sensitivity?: number; minInterval?: number | null; gateDb?: number | null; trackNoise?: boolean | null; attack?: number; release?: number; character?: unknown; charAt?: number }
export function atDetConfig(b: AtDetSettings, liveInput?: boolean): AtDetConfig;
export function atDetMag(samples: ArrayLike<number>, end: number, n: number, out: Float32Array): Float32Array;
export function atDetBins(sampleRate: number, n: number, ranges: ReadonlyArray<readonly [number, number] | number[]>): number[];
export function atDetFilterbank(sampleRate: number, n: number, ranges: ReadonlyArray<readonly [number, number] | number[]>, bpo: number): Array<{ bins: number[]; w: number[] }>;
export interface AtDetector { key: string; rows: Array<{ t: number; row: Float32Array; pow: Float64Array }>; max: number; t: number }
export function atNewDetector(): AtDetector;
export interface AtDetFrameOut { odf: number; raw: number; edb: number; aflat: number; arise: number; flat: number; bright: number }
export function atDetFrame(d: AtDetector, mag: Float32Array, spec: AtDetSpec, sampleRate: number, dt: number): AtDetFrameOut;
export interface AtPicker { hist: Array<{ t: number; o: number }>; last: number; open: boolean; below: number; line: number; P: number; Pp: number; N: number; noiseDb: number; gateLine: number }
export function atNewPicker(): AtPicker;
export function atDetLevel(edb: number): number;
export function atDetPick(p: AtPicker, odf: number, edb: number, t: number, dt: number, c: AtDetConfig): number;
/** A spec's curves over a whole sound, one value per AT_DET_HOP_SECONDS (frame i the window ending at i × hop). */
export interface AtDetCurves { odf: Float32Array; edb: Float32Array; aflat: Float32Array; arise: Float32Array; flat: Float32Array; bright: Float32Array }
export function atDetAnalyse(mono: Float32Array, sampleRate: number, specs: readonly AtDetSpec[], onProgress?: (f: number) => void): AtDetCurves[];
export interface AtEvents { times: Float64Array; strengths: Float32Array }
export function atDetPickAll(c: AtDetCurves, hopSeconds: number, cfg: AtDetConfig): AtEvents & { line: Float32Array; gate: Float32Array };

export type AtCharacter = 'auto' | 'any' | 'noisy' | 'tonal';
export const AT_CHARACTERS: readonly AtCharacter[];
export const AT_CHAR_AT: number;
export const AT_FLAT_DB: number;
export const AT_CHAR_WINDOW: number;
export function atCharacterOf(c: unknown): AtCharacter;
export function atCharPass(character: unknown, flat: number, charAt?: number): boolean;
export function atCharFilter(ev: AtEvents, aflat: ArrayLike<number>, arise: ArrayLike<number>, hopSeconds: number, character: unknown, charAt?: number): AtEvents;

export const AT_HEARD_WOBBLE: number;
export function atHeardSpan(prev: number | null, pos: number, win: { start: number; end: number } | null, loop: boolean): { from: number; to: number; keep: number };
export function atCurveMax(curve: ArrayLike<number>, hopSeconds: number, a: number, b: number, win?: { start: number; end: number }): number;
export function atCurveAt(curve: ArrayLike<number>, hopSeconds: number, t: number): number;

export function atSpectrumDbAt(mono: Float32Array, start: number, n: number, out: Float32Array): Float32Array;
export function atEventsIn(times: Float64Array, a: number, b: number): { count: number; last: number };
export function atEventsHeard(ev: AtEvents, from: number, to: number, win: { start: number; end: number }, loop: boolean): { count: number; strength: number };

export const AT_SPECTRUM_MIN_HZ: number;
export function atHzAt(x: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atXOfHz(hz: number, layout: AtLayout, minHz: number, maxHz: number): number;
export function atSpectrumMaxHz(sampleRate: number): number;
export function atSpectrumBins(freqDb: Float32Array, sampleRate: number, out: Float32Array, layout: AtLayout, minDb: number, maxDb: number, smoothing?: number): void;
export function atWriteRow(data: Uint8Array, offset: number, row: ArrayLike<number>, w: number): void;
export function atScrollRows(data: Uint8Array, w: number, h: number, row: ArrayLike<number>): void;
export function atWaveRow(wave: Float32Array, out: Float32Array, gain?: number): void;

// ── Hits and bands, frame by frame ──
export const AT_SCOPE_FRAMES: number;
export const AT_SCOPE_DB_FLOOR: number;
export function atScopeDb(db: number): number;
/** Per frame: the onset function, the line it had to beat, the energy, the Gate's line and the noise floor (dB as 0..1), hits. */
export interface AtScope { vals: Float32Array; line: Float32Array; db: Float32Array; gate: Float32Array; noise: Float32Array; hits: Uint8Array; at: number }
export function atNewScope(): AtScope;
/** A detector frame as a hit output reads it (live), or a frame decided ahead (`fired` hits, the File's curves there). */
export interface AtDetView { odf: number; line: number; edb: number; gate: number; noise: number; open: boolean }
export interface AtLiveFrame extends AtDetView { hit: number; subs: Array<{ t: number; hit: number; arrival: { flat: number; energy: number } }>; flat: number; bright: number }
export interface AtExtHit extends AtDetView { fired: number; strength: number }
export interface AtHitState { trigger: number; count: number; strength: number; envelope: number; lastHit: number; gateOpen: boolean; pending: number[]; cands: number[]; arr: Array<{ t: number; f: number; e: number }>; scope: AtScope; queued?: number[] }
export function atNewHitState(): AtHitState;
export function atStepHit(s: AtHitState, now: number, dt: number, f: AtLiveFrame, o: { decay: number; delay?: number; character?: unknown; charAt?: number }, ext?: AtExtHit): AtHitState;
export interface AtDetRun { det: AtDetector; pick: AtPicker; mag: Float32Array | null; pend: number; last: AtDetFrameOut | null }
export function atNewDetRun(): AtDetRun;
export function atDetStepLive(r: AtDetRun, cfg: AtDetConfig, wave: ArrayLike<number>, sampleRate: number, now: number, dt: number): AtLiveFrame;
export type AtValueFrom = 'level' | 'brightness' | 'flatness';
export const AT_VALUE_FROM: readonly AtValueFrom[];
export function atValueFromOf(v: unknown): AtValueFrom;

/** The fields of a band (lib/audioTools/bands.ts AudioBandSpec) the frame reads. */
export interface AtBand extends AtDetSettings {
  id: string; lo: number; hi: number; value: boolean; trigger: boolean; attack: number; release: number; gain: number;
  preset: AtPreset; sensitivity: number; character?: AtCharacter; charAt?: number; valueFrom?: AtValueFrom;
}
/** A frame's extras for a source's bands or a Hit: hold live hits back `delay` seconds; hits decided ahead; live input. */
export interface AtStepExtras { delay?: number; ext?: AtExtHit; liveInput?: boolean }
export interface AtBandRun { band: AtBandState; hit: AtHitState; hitAt: number; r: AtDetRun; frame: AtLiveFrame | null }
export function atNewBandRun(): AtBandRun;
export function atStepBandRun(run: AtBandRun, b: AtBand, wave: ArrayLike<number>, sampleRate: number, now: number, dt: number, x?: AtStepExtras): AtBandRun;
export function atBandDb(wave: ArrayLike<number>, sampleRate: number, lo: number, hi: number, mag?: Float32Array): number;

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
export function atStepSource(st: AtSource, bands: readonly AtBand[], sounds: readonly AtSound[], freq: Float32Array, sampleRate: number, now: number, dt: number, write: (channel: string, v: number) => void, x?: { wave?: ArrayLike<number>; delay?: number; ext?: Map<string, AtExtHit>; liveInput?: boolean }): void;

/** A listening node's settings for a frame (lib/audioTools/engine.ts listenerSpecOf). */
export interface AtListenerSpec {
  type: string;
  lo: number; hi: number;
  attack: number; release: number; gain: number;
  /** Hit: its detector (what to catch, Sensitivity, Min interval ms, Gate dBFS, Track room noise) and Envelope decay. */
  preset: AtPreset; sensitivity: number; minInterval: number | null; gateDb: number | null; trackNoise: boolean | null; decay: number;
  layout: AtLayout; minDb: number; maxDb: number; smoothing: number;
}
export interface AtListener { band: AtBandState; hit: AtHitState; r: AtDetRun; mag: Float32Array | null; row: Float32Array; data: Uint8Array | null; w: number; h: number; hitAt: number }
export function atNewListener(type: string, w: number, h: number): AtListener;
export function atStepListener(l: AtListener, spec: AtListenerSpec, freq: Float32Array, wave: Float32Array, sampleRate: number, active: boolean, nowMs: number, dt: number, write: (channel: string, v: number) => void, x?: AtStepExtras): boolean;
