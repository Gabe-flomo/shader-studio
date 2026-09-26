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
