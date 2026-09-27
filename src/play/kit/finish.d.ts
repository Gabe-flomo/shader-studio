/** The Finish stack (see finish.js). */
export interface FnParam { key: string; label: string; min: number; max: number; step: number; value: number; hint: string; hidden: boolean }
export type FnKind = 'grade' | 'lens' | 'chroma' | 'vignette' | 'crt' | 'bloom' | 'halation' | 'grain' | 'flicker' | 'shake' | 'time';
export interface FnEffectDef { label: string; group: string; icon: string; summary: string; params: FnParam[] }
export const FN_EFFECTS: Readonly<Record<FnKind, FnEffectDef>>;
export const FN_KINDS: readonly FnKind[];
export const FN_TONE_MODES: readonly string[];
export const FN_TIME_MAPS: readonly string[];
export const FN_TIME_QUALITY: Readonly<Record<string, { frames: number; scale: number; cap: number }>>;
export const FN_CURVE_CHANNELS: readonly ['rgb', 'r', 'g', 'b'];
export const FN_HUE_CURVES: readonly ['hueSat', 'hueHue', 'lumaSat'];

export interface FnCurves { rgb: number[]; r: number[]; g: number[]; b: number[]; hueSat: number[]; hueHue: number[]; lumaSat: number[] }
/** An effect as the renderer reads it: its kind, whether it's on, and its numbers (plus a grade's curves and tone, a time effect's map). */
export interface FnEffect { id: string; kind: FnKind; enabled: boolean; [key: string]: unknown }
export interface FnFinish { on: boolean; effects: readonly FnEffect[] }

export function fnDefaultCurves(): FnCurves;
export function fnDefaultEffect(kind: FnKind, id: string): FnEffect;
export function fnActive(finish: FnFinish | null | undefined): boolean;
export function fnRunning(finish: FnFinish | null | undefined): FnEffect[];
export function fnAnimated(finish: FnFinish | null | undefined): boolean;

export function fnCurvePoints(flat: readonly number[] | undefined): Array<[number, number]>;
export function fnCurveEval(flat: readonly number[] | undefined, x: number): number;
export function fnHueCurveEval(flat: readonly number[] | undefined, x: number, wrap?: boolean): number;
export function fnCurvesNeutral(c: Partial<FnCurves> | undefined): boolean;
export function fnHueCurvesUsed(c: Partial<FnCurves> | undefined): boolean;
export function fnBakeLut(curves: Partial<FnCurves> | undefined): Uint8Array;

export function fnLuma(c: readonly number[]): number;
export function fnWheel(x: number, y: number): [number, number, number];
export function fnGradePixel(rgb: readonly number[], grade: Record<string, unknown>, lut: Uint8Array | null): number[];
export function fnEnergy(x: number, headroom: number, knee?: number): number;
export function fnSoftThreshold(v: number, thr: number, knee: number): number;
export function fnHalationTerms(E: readonly number[], thresholdStops: number): [number, number, number];

export interface FnRing { readonly size: number; readonly count: number; readonly head: number; reset(): void; slotForWrite(): number; push(): void; slotFor(back: number): number }
export function fnRing(size: number): FnRing;
export function fnRingSize(quality: string, W: number, H: number): { frames: number; w: number; h: number; bytes: number };

export function fnBuildFinal(effects: readonly FnEffect[], opts?: { tone?: string; hueCurves?: boolean; timeMap?: string }): { src: string; glow: boolean; time: boolean; lut: boolean };

export interface FnInput {
  finish: FnFinish;
  value?: (effect: FnEffect, key: string) => number;
  picture: TexImageSource | { data: Uint8Array; width: number; height: number };
  layers?: TexImageSource | null;
  layerAlpha?: (id: string) => TexImageSource | null;
  width: number;
  height: number;
  time: number;
  first?: boolean;
  compare?: number;
  pixels?: boolean;
}
export interface FnInfo { effects?: string[]; glow?: boolean; floatGlow?: boolean; ring?: { frames: number; w: number; h: number; bytes: number; count: number } | null; error: string }
export interface FnRenderer {
  ok: boolean;
  canvas: HTMLCanvasElement | null;
  draw(input: FnInput): boolean;
  reset(): void;
  info(): FnInfo | null;
  error?(): string;
  dispose(): void;
}
export function fnCreate(canvas?: HTMLCanvasElement | null): FnRenderer;
