/** The Finish stack (see finish.js). */
export interface FnParam { key: string; label: string; min: number; max: number; step: number; value: number; hint: string; hidden: boolean }
export type FnKind = 'grade' | 'lens' | 'chroma' | 'vignette' | 'crt' | 'bloom' | 'halation' | 'grain' | 'flicker' | 'shake' | 'time'
  | 'glitch' | 'ripple' | 'water' | 'displace' | 'mosaic' | 'mirror' | 'gradmap' | 'posterize' | 'edges' | 'feedback' | 'echo'
  | 'pixelsort' | 'halftone' | 'ascii' | 'leaks' | 'datamosh' | 'motionx';
/** A starting point for an effect: it sets numbers, and (`set`) a choice or two (Water's Source and Shape). */
export interface FnPreset { name: string; values: Readonly<Record<string, number>>; set?: Readonly<Record<string, string>> }
/** A colour kept as three hidden numbers, edited as one swatch. */
export interface FnColour { label: string; keys: readonly [string, string, string]; hint?: string }
/** An effect's declaration: its numbers, and optionally presets, colour swatches and a note for its card. */
export interface FnEffectDef { label: string; group: string; icon: string; summary: string; params: FnParam[]; presets?: readonly FnPreset[]; colours?: readonly FnColour[]; note?: string }
export const FN_EFFECTS: Readonly<Record<FnKind, FnEffectDef>>;
export const FN_KINDS: readonly FnKind[];
/** Effects that read around each point after the effects above them: each starts a pass of its own (fnSegments). */
export const FN_STAGE_KINDS: readonly FnKind[];
/** Effects that keep frames of their own between draws (Datamosh, Motion extract): each heads a pass of its own. */
export const FN_TEMPORAL_KINDS: readonly FnKind[];
/** What Feedback and Echo keep (their Source). */
export const FN_SOURCE_MAPS: readonly ['picture', 'layer', 'moving', 'bright'];
export function fnSourceOf(e: { map?: unknown; [key: string]: unknown } | null | undefined): 'picture' | 'layer' | 'moving' | 'bright';
/** Echo's copies this frame: frames back for each (index 0 = now) and the deepest frame read. */
export function fnEchoPlan(time: number, count: number, strobe: boolean, n: number, moving?: boolean): { backs: number[]; deepest: number };
/** What Datamosh's movement is measured on. */
export const FN_MOSH_MAPS: readonly ['picture', 'layer'];
export const FN_MOSH_LOW: number;
export const FN_MOSH_REACH: number;
export function fnMoshGrid(block: number, W: number, H: number): { lowW: number; lowH: number; bl: number; px: number; gw: number; gh: number };
export function fnMoshKeyframe(every: number, time: number, last: number): { idx: number; key: boolean };
export function fnMoshEncode(v: readonly [number, number]): number[];
export function fnMoshDecode(bytes: readonly number[]): [number, number];
export const FN_ECHO_MAX_DELAY: number;
export const FN_ECHO_CAP: number;
export const FN_ECHO_COPIES_CAP: number;
export function fnEchoRingSize(delay: number, W: number, H: number, have?: number, cap?: number): { frames: number; w: number; h: number; bytes: number };
export function fnEchoPixel(now: readonly number[], then: readonly number[], p?: Partial<Record<'gain' | 'colour' | 'background' | 'neon', number>>): number[];
export function fnSegments<T extends { kind: string }>(effects: readonly T[]): T[][];
/** Pixel sort's motion settings (Flow, Drip, Breathe, Wander, Turbulence, Trail, Rate). */
export const FN_SORT_MOTION: readonly string[];
/** Does this Pixel sort keep a trail (the renderer's `trailOn`, else Trail above 0)? It then ends its pass. */
export function fnSortTrails(e: { kind: string; [key: string]: unknown } | null | undefined): boolean;
/** Does this ASCII effect draw typed characters (an atlas) instead of the built-in ones? */
export function fnAsciiTyped(e: { kind: string; [key: string]: unknown } | null | undefined): boolean;
/** Look actions (a rule's Do on a Finish effect): their kinds, and the state a host keeps of them. */
export type FnLookKind = 'mosh' | 'moshreset' | 'fxpulse' | 'fxset' | 'splash';
export const FN_LOOK_ACTIONS: readonly FnLookKind[];
/** Where a Splash lands (its `key`): at Water's source, somewhere random, or at its x, y. */
export const FN_SPLASH_AT: readonly ['source', 'pointer', 'random', 'point'];
export interface FnLookState { entries: Map<string, { value: number; start: number; until: number }>; last: number; changed: boolean }
export interface FnLookAction { do: string; layerId: string; key?: string; value?: number; seconds?: number; x?: number; y?: number }
export function fnLookIs(kind: string): kind is FnLookKind;
export function fnLookNew(): FnLookState;
export function fnLookReset(st: FnLookState): void;
export function fnLookStep(st: FnLookState, time: number): void;
export function fnLookAct(st: FnLookState, a: FnLookAction, time: number): boolean;
export function fnLookValue(st: FnLookState | null | undefined, id: string, key: string): number | undefined;
/** Water: a simulated surface (see finish.js "Water"). */
export const FN_WATER: Readonly<{ rate: number; maxC: number; maxTicks: number; maxSub: number; maxDrops: number; detail: Readonly<Record<'low' | 'medium' | 'high', number>>; push: number; dropPush: number; splash: number; crest: number; visc: number; view: Readonly<Record<string, number>> }>;
export type FnWaterSource = 'pointer' | 'layer' | 'xy' | 'none';
export type FnWaterShape = 'point' | 'line' | 'ring' | 'twin' | 'layer' | 'picture';
export const FN_WATER_SOURCES: readonly FnWaterSource[];
export const FN_WATER_SHAPES: readonly FnWaterShape[];
export const FN_WATER_DETAILS: readonly ['low', 'medium', 'high'];
export function fnWaterSourceOf(e: { source?: unknown; [key: string]: unknown } | null | undefined): FnWaterSource;
export function fnWaterShapeOf(e: { shape?: unknown; [key: string]: unknown } | null | undefined): FnWaterShape;
export function fnWaterMapShape(shape: string): boolean;
export function fnWaterGrid(detail: string | undefined, W: number, H: number): { w: number; h: number };
export function fnWaterPlan(speed: number, rows: number): { sub: number; c: number; c2: number; dt: number };
export function fnWaterDecay(damping: number): number;
export function fnWaterDamp(damping: number, dt: number): number;
export function fnWaterTick(time: number): number;
export function fnWaterHash(a: number, b: number): number;
export function fnWaterRain(rate: number, tick: number): Array<[number, number]>;
export function fnWaterBob(bob: number, t: number): number;
/** How a source presses at (vx, vy) from its place: its dimple with the rim that holds what it pushed aside. */
export function fnWaterPress(shape: string, vx: number, vy: number, size: number, length: number, angle: number, rows: number, bob?: number): number;
/** A source's stamp where the water is at h: whole, unless it pushes h further its own way, when it fades out by cap. */
export function fnWaterLimit(f: number, h: number, cap: number): number;
export function fnWaterDrop(d: number, r: number): number;
/** Mur's open boundary's factor at a Courant number² (see finish.js). */
export function fnWaterMur(c2: number): number;
export interface FnWaterGridState { w: number; h: number; now: Float32Array; prev: Float32Array }
export function fnWaterStep(g: FnWaterGridState, o: { c2: number; damp: number; visc?: number; edges: number; force?: Float32Array | null }): FnWaterGridState;
export function fnWaterEnergy(g: FnWaterGridState, c2: number): number;
export interface FnWaterFrameState { valid: boolean; tick: number; lastT: number; p: { x: number; y: number } | null; splashSeen: number | undefined; pending: number[][] }
export interface FnWaterStepPlan { p0: { x: number; y: number } | null; p1: { x: number; y: number } | null; b0: number; b1: number; s0: number; s1: number; drops: number[][] }
export interface FnWaterFrameInput { time: number; first?: boolean; speed: number; rows: number; point: { x: number; y: number } | null; pointer?: { x: number; y: number } | null; bob: number; strength: number; rain: number; drop: number; splash?: { t: number; x: number; y: number; size: number } | null }
export function fnWaterState(): FnWaterFrameState;
export function fnWaterFrame(st: FnWaterFrameState, f: FnWaterFrameInput): { reset: boolean; steps: FnWaterStepPlan[]; plan: { sub: number; c: number; c2: number; dt: number }; ticks: number };
export function fnWaterCpu(w: number, h: number, aspect?: number): {
  readonly grid: FnWaterGridState;
  state: FnWaterFrameState;
  frame(f: Partial<FnWaterFrameInput> & { time: number; point?: { x: number; y: number } | null; value: (key: string) => number; shape?: string; occ?: Float32Array | null }): { reset: boolean; steps: FnWaterStepPlan[]; ticks: number };
};
/** ASCII's character bitmaps, darkest first (5 × 5, bit column + 5 × row from the bottom). */
export const FN_ASCII_GLYPHS: readonly number[];
export const FN_TONE_MODES: readonly string[];
export const FN_TIME_MAPS: readonly string[];
export const FN_WHERE: readonly ['all', 'layer', 'picture', 'motion', 'waves'];
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
export interface FnCustomParsed { params: FnCustomParam[]; colours: Array<{ name: string; label: string; keys: [string, string, string]; hint?: string }>; lines: string[]; error: string }
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
export function fnWhereOf(e: { where?: unknown; [key: string]: unknown } | null | undefined): 'all' | 'layer' | 'picture' | 'motion' | 'waves';
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
export const FN_HALATION_PRESETS: readonly FnPreset[];
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

export function fnBuildFinal(effects: readonly FnEffect[], opts?: { tone?: string; hueCurves?: boolean; timeMap?: string; curves?: boolean; segment?: number }): { src: string; glow: boolean; time: boolean; feedback: boolean; echo: boolean; mosh: boolean; mx: boolean; maps: string[]; water: boolean; lut: boolean; ascAtlas: boolean; psTrail: boolean; custom: string[]; segments: number };

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
  /** Water's Pointer source: where the pointer is (0..1, y up) and whether it is over the picture. */
  pointer?: { x: number; y: number; over?: boolean; down?: boolean } | null;
  /** Water's Layer source: where a layer is now (the kit's layerPoint), or null. */
  layerPoint?: (id: string) => { x: number; y: number } | null;
}
export interface FnInfo { effects?: string[]; glow?: boolean; passes?: number; floatGlow?: boolean; ring?: { frames: number; w: number; h: number; bytes: number; count: number } | null; error: string; custom?: Record<string, string>; mosh?: { bytes: number } | null; rings?: Record<string, { frames: number; w: number; h: number; bytes: number; count: number }>; feedback?: { bytes: number; float: boolean } | null; ascii?: { glyphs: string[]; cols: number; rows: number } | null; sortTrail?: { valid: boolean } | null; water?: { w?: number; h?: number; bytes?: number; float: boolean; substeps?: number; ticks?: number; steps?: number; c?: number } | null }
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
