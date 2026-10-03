/** The Finish stack (see finish.js). */
export interface FnParam { key: string; label: string; min: number; max: number; step: number; value: number; hint: string; hidden: boolean }
export type FnKind = 'grade' | 'lens' | 'chroma' | 'vignette' | 'crt' | 'bloom' | 'halation' | 'grain' | 'flicker' | 'shake' | 'time'
  | 'glitch' | 'ripple' | 'displace' | 'mosaic' | 'mirror' | 'gradmap' | 'posterize' | 'edges' | 'feedback';
export interface FnEffectDef { label: string; group: string; icon: string; summary: string; params: FnParam[] }
export const FN_EFFECTS: Readonly<Record<FnKind, FnEffectDef>>;
export const FN_KINDS: readonly FnKind[];
export const FN_TONE_MODES: readonly string[];
export const FN_TIME_MAPS: readonly string[];
export const FN_WHERE: readonly ['all', 'layer', 'picture', 'motion'];
export const FN_DISPLACE_MAPS: readonly ['noise', 'picture', 'layer', 'motion'];
export const FN_MAP_MAX: number;
export const FN_TIME_QUALITY: Readonly<Record<string, { frames: number; scale: number; cap: number }>>;
export const FN_CURVE_CHANNELS: readonly ['rgb', 'r', 'g', 'b'];
export const FN_HUE_CURVES: readonly ['hueSat', 'hueHue', 'lumaSat'];

export interface FnCurves { rgb: number[]; r: number[]; g: number[]; b: number[]; hueSat: number[]; hueHue: number[]; lumaSat: number[] }
/** An effect as the renderer reads it: its kind, whether it's on, and its numbers (plus a grade's curves and tone, a time effect's map). */
export interface FnEffect { id: string; kind: FnKind | 'custom'; enabled: boolean; [key: string]: unknown }
/** The before/after wipe: on, where (0..1 along its direction), its angle in degrees (0 = upright, before on the left) and the blend's width. */
export interface FnCompare { on: boolean; pos: number; angle: number; softness: number }
export interface FnFinish { on: boolean; effects: readonly FnEffect[]; compare?: FnCompare }

export const FN_COMPARE_ID: 'compare';
export const FN_COMPARE_PARAMS: readonly FnParam[];
export function fnDefaultCompare(): FnCompare;
export function fnCompareOn(finish: FnFinish | null | undefined): boolean;

/** A custom effect's setting: a number (float or int), or one channel of a colour (`<name>.r`…, hidden). */
export interface FnCustomParam extends FnParam { type: 'float' | 'int' | 'colour'; colour?: string }
export interface FnCustomParsed { params: FnCustomParam[]; colours: Array<{ name: string; label: string; keys: [string, string, string] }>; lines: string[]; error: string }
export const FN_CUSTOM_RESERVED: readonly string[];
export function fnParseCustom(code: string): FnCustomParsed;
export function fnCustomDefaults(code: string): Record<string, number>;
export function fnCustomErrors(log: string, stage: number): string;
export function fnCheckCustom(code: string): string;

export function fnDefaultCurves(): FnCurves;
export function fnDefaultEffect(kind: FnKind, id: string): FnEffect;
export function fnActive(finish: FnFinish | null | undefined): boolean;
export function fnRunning(finish: FnFinish | null | undefined): FnEffect[];
export function fnAnimated(finish: FnFinish | null | undefined): boolean;
/** An effect's Where ('all' when absent or odd). */
export function fnWhereOf(e: { where?: unknown } | null | undefined): 'all' | 'layer' | 'picture' | 'motion';
/** The map textures running effects read, in order: 'layer:<id>' and 'motion'. */
export function fnMapKeys(effects: readonly FnEffect[]): string[];
/** The layers a stack reads drawn alone (env.alphaLayers). */
export function fnMapLayers(finish: FnFinish | null | undefined): string[];
/** Does the stack read the camera's motion map? */
export function fnUsesMotion(finish: FnFinish | null | undefined): boolean;

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
/** Halation's measured shape and colour, and its controls' defaults (see finish.js). */
export const FN_HAL: Readonly<{
  sigma: number; gain: number; tail: number; knee: number; recv: readonly [number, number]; greenKnee: number; blue: number;
  amount: number; reach: number; threshold: number; headroom: number; warmth: number; growth: number; conserve: number; model: number; srcMax: number; whiteMax: number;
}>;
export const FN_HALATION_PRESETS: ReadonlyArray<{ name: string; values: Readonly<Record<string, number>> }>;
export function fnMigrateHalation<T extends { kind: string; model?: unknown; [key: string]: unknown }>(e: T): T;
export function fnHalSource(rgb: readonly number[], thresholdStops: number, headroom: number): [number, number];
/** A halation source's soft ceiling: linear for small excesses, never past `max`. */
export function fnHalSat(v: number, max: number): number;
export function fnHalSpread(d: number, height?: number): number;
export function fnHalTailMix(reach: number): { strength: number; wide: number };
export function fnHalTailEdge(d: number, reach?: number, height?: number): number;
export function fnHalEdgeBleed(d: number, src: number, amount?: number, reach?: number, height?: number): number;
export function fnHalReceive(red: number): number;
export function fnHalTint(dR: number, warmth: number): [number, number, number];
export function fnHalPixel(rgb: readonly number[], bleed: number, src: number, p?: Partial<Record<'amount' | 'warmth' | 'growth' | 'conserve' | 'white', number>>): number[];

export interface FnRing { readonly size: number; readonly count: number; readonly head: number; reset(): void; slotForWrite(): number; push(): void; slotFor(back: number): number }
export function fnRing(size: number): FnRing;
export function fnRingSize(quality: string, W: number, H: number): { frames: number; w: number; h: number; bytes: number };

export function fnBuildFinal(effects: readonly FnEffect[], opts?: { tone?: string; hueCurves?: boolean; timeMap?: string; curves?: boolean }): { src: string; glow: boolean; time: boolean; feedback: boolean; maps: string[]; lut: boolean; custom: string[] };

export interface FnInput {
  finish: FnFinish;
  value?: (effect: FnEffect, key: string) => number;
  picture: TexImageSource | { data: Uint8Array; width: number; height: number };
  layers?: TexImageSource | null;
  layerAlpha?: (id: string) => TexImageSource | null;
  /** The camera's motion map (the kit's motionMap()), for a Where or Displace on motion; null reads none. */
  motion?: TexImageSource | null;
  width: number;
  height: number;
  time: number;
  first?: boolean;
  pixels?: boolean;
}
export interface FnInfo { effects?: string[]; glow?: boolean; floatGlow?: boolean; ring?: { frames: number; w: number; h: number; bytes: number; count: number } | null; error: string; custom?: Record<string, string> }
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
