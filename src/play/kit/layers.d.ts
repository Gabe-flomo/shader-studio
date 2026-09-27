/** The parts of layers.js the app reads directly (the rest is used by kit.js). */
export function klParseFontUrl(input: string): { family: string; css?: string; file?: string } | null;
export function klGlyphList(chars: string): string[];
export function klFontFor(l: { font?: string; fontUrl?: string; weight?: number }): string;

export function klSeeded(seed: number, i: number, salt: number): number;
export interface ClonerPlacement { i: number; t: number; x: number; y: number; angle?: number }
export interface ClonerCopy { i: number; t: number; x: number; y: number; scale: number; rot: number; alpha: number; hue: number; hidden: boolean }
export interface ClonerEffector { x: number; y: number; rx: number; ry: number }
export function klClonerLayout(l: unknown, v: (key: string) => number, aspect: number, path?: ReadonlyArray<{ x: number; y: number }> | null, points?: ReadonlyArray<{ x: number; y: number; angle?: number }> | null): ClonerPlacement[];
export function klClonerCopies(l: unknown, v: (key: string) => number, aspect: number, layout: ReadonlyArray<ClonerPlacement>, effectors: ReadonlyArray<ClonerEffector>): ClonerCopy[];
export function klDrawCopy(ctx: CanvasRenderingContext2D, copy: ClonerCopy, srcX: number, srcY: number, W: number, H: number, scratch: CanvasImageSource, box: { x: number; y: number; w: number; h: number } | null): void;

export const KL_SKETCH_NAMES: readonly string[];
export function klSketchHelpers(get: () => { ctx: CanvasRenderingContext2D; width: number; height: number; mouse: { x: number; y: number; down: boolean }; frame: number; dt: number; time: number; random?: () => number }): Record<string, unknown>;
export function klCompileSketch(code: string, P: Record<string, unknown>): { setup: ((s: unknown) => void) | null; draw: ((s: unknown) => void) | null; params: Record<string, unknown>; has: (k: string) => boolean; set: (k: string, v: number) => void };

export interface KlSketchState { code: string; mode: '2d' | '3d'; error: string | null; params: Record<string, unknown>; frame: number; ready: boolean; pressed: Record<string, number>; s: unknown; state: Record<string, unknown>; g3: import('./sketch3d.js').K3Sketch | null }
/** `opts.mode` '3d' draws with three.js (`opts.three`, the three-slim.js set) instead of a 2D canvas. */
export function klSketchCompile(code: string, opts?: { mode?: '2d' | '3d'; three?: unknown }): KlSketchState;
export function klSketchDispose(st: KlSketchState | null | undefined): void;
export function klSketchPress(st: KlSketchState, key: string, amount?: number): void;
export function klSketchStep(st: KlSketchState, s: Record<string, unknown>, defs: ReadonlyArray<{ key: string; kind?: string }>, clear: boolean): string | null;

/** A gradient or a palette's bands (types/play.ts BackgroundFill): angle as in CSS (180 = top to bottom). */
export interface KitFill { style: 'gradient' | 'bands'; stops: ReadonlyArray<{ pos: number; color: readonly [number, number, number] | readonly number[] }>; angle?: number }
/** What stands in for the shader under the layers: an image or video (null while loading) with its fit, on a colour or a fill. */
export interface KitBackground { el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null; fit: 'cover' | 'contain' | 'stretch'; colour: [number, number, number]; fill?: KitFill | null }
export function klFillStops(fill: KitFill | null | undefined): Array<{ pos: number; color: [number, number, number] }>;
export function klFillT(angle: number | undefined, u: number, v: number, aspect: number): number;
export function klFillColourAt(fill: KitFill | null | undefined, t: number): [number, number, number];
export function klFillAt(fill: KitFill | null | undefined, u: number, v: number, aspect: number): [number, number, number];
export function klPaintFill(x: CanvasRenderingContext2D, fill: KitFill, W: number, H: number): void;
export function klFitRect(fit: string, w: number, h: number, W: number, H: number): { x: number; y: number; w: number; h: number };
export function klPaintBackground(c: HTMLCanvasElement, bg: KitBackground, W: number, H: number, cache?: boolean): HTMLCanvasElement;
