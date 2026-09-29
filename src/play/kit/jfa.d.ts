/** The Layers node's GPU distance field (see jfa.js and docs/layers-node.md). */
export const JF_MAX_RES: number;
export const JF_MIN_COVER: number;
export const JF_FAR: number;

export interface JfSource {
  /** Width and height of the source in pixels. */
  width: number;
  height: number;
  /** The picture's aspect (width / height); defaults to width / height. */
  aspect?: number;
  /** A texture already on this context holding the layers (alpha is what counts), row 0 at the bottom… */
  texture?: WebGLTexture;
  /** …or a canvas to upload. */
  canvas?: TexImageSource;
}

export interface JfField { texture: WebGLTexture; width: number; height: number }

export interface JfBuilder {
  run(source: JfSource): JfField | null;
  dispose(): void;
  readonly maxRes: number;
}

export function jfGridSize(w: number, h: number, maxRes?: number): { gw: number; gh: number };
export function jfSteps(gw: number, gh: number): number[];
export function jfReference(alpha: ArrayLike<number>, gw: number, gh: number, aspect: number, minCover?: number): Float32Array;
export function jfSeedGrid(alpha: ArrayLike<number>, gw: number, gh: number, minCover?: number): Float32Array;
export function jfCreate(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined, opts?: { maxRes?: number }): JfBuilder | null;
