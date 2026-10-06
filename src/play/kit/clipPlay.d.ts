export interface CpSegment { in: number; out: number; reverse?: boolean }
export interface CpResolved { in: number; out: number; reverse: boolean }
export interface CpCrop { x: number; y: number; w: number; h: number }
export interface CpTransform { crop: CpCrop; rotate: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean }
/** A clip as saved on a node or a layer (docs/clip-editor.md). */
export interface CpSaved {
  segments: CpSegment[];
  crop: CpCrop;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  speed?: number;
  loop?: boolean;
}
export interface CpAt { time: number; k: number; reverse: boolean; done: boolean }
export interface CpCache { c?: HTMLCanvasElement; key?: string }

export const CP_MAX_SEGMENTS: number;
export const CP_MIN_SEGMENT: number;
export const CP_MIN_CROP: number;
export function cpCleanCrop(c: unknown): CpCrop;
export function cpCleanTransform(v: unknown): CpTransform;
export function cpIsIdentity(xf: CpTransform | null | undefined): boolean;
export function cpCleanSegments(raw: unknown): CpSegment[];
export function cpParse(raw: unknown): CpSaved | null;
export function cpIsPlain(c: CpSaved | null | undefined): boolean;
export function cpResolve(segs: readonly CpSegment[], duration: number): CpResolved[];
export function cpSpan(segs: readonly { in: number; out: number }[]): number;
export function cpLength(segs: readonly { in: number; out: number }[], speed: number): number;
export function cpAt(segs: readonly CpResolved[], t: number, speed: number, loop: boolean): CpAt;
export function cpFrames(segs: readonly CpResolved[], speed: number, loop: boolean, fps: number): number[];
export function cpFollow(el: HTMLVideoElement | null, at: CpAt, seg: CpResolved | undefined, rate: number, run: boolean): void;
export function cpPlaylist(c: CpSaved, duration: number, speed: number, loop: boolean): { segs: CpResolved[]; speed: number; loop: boolean };
export function cpOutputToSource(xf: CpTransform, u: number, v: number): [number, number];
export function cpSourceToOutput(xf: CpTransform, x: number, y: number): [number, number];
export function cpTextureAffine(xf: CpTransform): [number, number, number, number, number, number];
export function cpOutputSize(w: number, h: number, xf: CpTransform): [number, number];
export function cpDrawParams(xf: CpTransform, sw: number, sh: number, x: number, y: number, w: number, h: number): {
  src: [number, number, number, number]; dw: number; dh: number; matrix: [number, number, number, number, number, number];
};
export function cpDrawFrame(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, xf: CpTransform, x: number, y: number, w: number, h: number): void;
export function cpFrameOf(el: HTMLVideoElement | null, xf: CpTransform, cache: CpCache): HTMLVideoElement | HTMLCanvasElement | null;
