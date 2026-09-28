/** The parts of layers.js the app reads directly (the rest is used by kit.js). */
export function klGlyphList(chars: string): string[];
export function klFontFor(l: { font?: string; fontUrl?: string; weight?: number }): string;
/** Fonts in linked folders (`linked:` refs): the app gives the kit a reader for their bytes. */
export function klSetLinkedFontReader(fn: ((ref: string) => Promise<ArrayBuffer | null>) | null): void;

export function klSeeded(seed: number, i: number, salt: number): number;
export interface ClonerPlacement { i: number; t: number; x: number; y: number; angle?: number }
export interface ClonerCopy { i: number; t: number; x: number; y: number; scale: number; rot: number; alpha: number; hue: number; hidden: boolean }
export interface ClonerEffector { x: number; y: number; rx: number; ry: number }
export function klClonerLayout(l: unknown, v: (key: string) => number, aspect: number, path?: ReadonlyArray<{ x: number; y: number }> | null, points?: ReadonlyArray<{ x: number; y: number; angle?: number }> | null): ClonerPlacement[];
export function klClonerCopies(l: unknown, v: (key: string) => number, aspect: number, layout: ReadonlyArray<ClonerPlacement>, effectors: ReadonlyArray<ClonerEffector>): ClonerCopy[];
export function klDrawCopy(ctx: CanvasRenderingContext2D, copy: ClonerCopy, srcX: number, srcY: number, W: number, H: number, scratch: CanvasImageSource, box: { x: number; y: number; w: number; h: number } | null): void;

export const KL_SKETCH_NAMES: readonly string[];
export function klSketchHelpers(get: () => { ctx: CanvasRenderingContext2D; width: number; height: number; mouse: { x: number; y: number; down: boolean }; frame: number; dt: number; time: number; random?: () => number }): Record<string, unknown>;
export function klCompileSketch(code: string, P: Record<string, unknown>): { setup: ((s: unknown) => void) | null; draw: ((s: unknown) => void) | null; params: Record<string, unknown>; has: (k: string) => boolean; set: (k: string, v: unknown) => void; fn: (k: string) => ((...a: unknown[]) => unknown) | null };

/** A file of a multi-file sketch: its name (a tab) and code. */
export interface KlSketchFile { name: string; code: string }
/** A file the sketch loads (loadImage, loadJSON…): data URL for images and fonts, text otherwise. */
export interface KlSketchAsset { name: string; kind: string; mime?: string; data: string }
/** Where compiled sketches say they are in stack traces. */
export const KL_SKETCH_URL: string;
/** The main file's name ('sketch.js'). */
export const KL_MAIN_FILE: string;
/** One file with import / export lines dropped (line numbers kept). */
export function klStripModules(code: string): string;
/** The files as one program, extra files first and the main file last, and each file's line range. */
export function klSketchSource(code: string, files?: ReadonlyArray<KlSketchFile> | null): { text: string; map: Array<{ name: string; from: number; to: number }> };
/** The file and line an error was thrown at, or null. */
export function klErrorAt(e: unknown, map: ReadonlyArray<{ name: string; from: number; to: number }>): { file: string; line: number } | null;
/** A declared control's value as the sketch sees it (toggle → boolean, colour → '#rrggbb' or [r, g, b], choice → the option). */
export function klParamValue(d: { kind?: string; as?: string; options?: readonly string[] } | undefined, raw: unknown): unknown;

export interface KlSketchState {
  code: string; files: KlSketchFile[]; mode: '2d' | '3d'; error: string | null; errorAt: { file: string; line: number } | null;
  params: Record<string, unknown>; frame: number; ready: boolean; pressed: Record<string, number>; s: unknown; state: Record<string, unknown>;
  g3: import('./sketch3d.js').K3Sketch | null;
  /** A p5 sketch's state (p5.js), or null for a plain sketch. */
  p5: import('./p5.js').Kp5Host | null;
  /** The sketch waits for files preload asked for. */
  waiting?: boolean;
  wantRestart: boolean;
}
export interface KlSketchOptions {
  mode?: '2d' | '3d';
  three?: unknown;
  /** Extra files, run before the code in one scope. */
  files?: ReadonlyArray<KlSketchFile> | null;
  /** Run the p5 way (a sketch that calls createCanvas or `new p5(` is one anyway). */
  p5?: boolean;
  assets?: ReadonlyArray<KlSketchAsset> | null;
  /** Console output; without it the page's console. */
  log?: ((level: string, args: unknown[]) => void) | null;
  /** Tests: make a canvas (p5 sketches draw on canvases of their own). */
  makeCanvas?: (w: number, h: number) => unknown;
}
/** `opts.mode` '3d' draws with three.js (`opts.three`, the three-slim.js set) instead of a 2D canvas. */
export function klSketchCompile(code: string, opts?: KlSketchOptions): KlSketchState;
export function klSketchDispose(st: KlSketchState | null | undefined): void;
/** A button pressed (next frame); '__restart' starts the sketch over. */
export function klSketchPress(st: KlSketchState, key: string, amount?: number): void;
/** Should the host compile again (code, files or mode changed, or a restart asked for)? */
export function klSketchStale(st: KlSketchState | null | undefined, code: string, files: ReadonlyArray<KlSketchFile> | null | undefined, mode: '2d' | '3d', three: unknown): boolean;
export function klSketchStep(st: KlSketchState, s: Record<string, unknown>, defs: ReadonlyArray<{ key: string; kind?: string; restart?: boolean; as?: string; options?: readonly string[] }>, clear: boolean): string | null;

/** A gradient or a palette's bands (types/play.ts BackgroundFill): angle as in CSS (180 = top to bottom). */
export interface KitFill { style: 'gradient' | 'bands'; stops: ReadonlyArray<{ pos: number; color: readonly [number, number, number] | readonly number[] }>; angle?: number }
/** What stands in for the shader under the layers: an image or video (null while loading) with its fit, on a colour or a fill. */
export interface KitBackground { el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null; fit: 'cover' | 'contain' | 'stretch'; colour: [number, number, number]; fill?: KitFill | null }
export function klFillStops(fill: KitFill | null | undefined): Array<{ pos: number; color: [number, number, number] }>;
export function klFillT(angle: number | undefined, u: number, v: number, aspect: number): number;
export function klFillColourAt(fill: KitFill | null | undefined, t: number): [number, number, number];
export function klFillAt(fill: KitFill | null | undefined, u: number, v: number, aspect: number): [number, number, number];
export function klPaintFill(x: CanvasRenderingContext2D, fill: KitFill, W: number, H: number): void;
/** A video layer's height before its Scale, in picture heights, for a frame of aspect `va` on a picture of aspect `pa`. */
export function klVideoFit(fit: string, va: number, pa: number): number;
export function klFitRect(fit: string, w: number, h: number, W: number, H: number): { x: number; y: number; w: number; h: number };
export function klPaintBackground(c: HTMLCanvasElement, bg: KitBackground, W: number, H: number, cache?: boolean): HTMLCanvasElement;
