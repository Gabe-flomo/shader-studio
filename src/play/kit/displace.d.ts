/** The Displacement Map (see displace.js). */
export type DmChannel = 'red' | 'green' | 'blue' | 'alpha' | 'luminance' | 'hue' | 'lightness' | 'saturation' | 'full' | 'half' | 'off';
export type DmBehaviour = 'center' | 'stretch' | 'tile';
export type DmQuality = 'full' | 'half' | 'quarter';
export interface DmBox { x0: number; y0: number; x1: number; y1: number }
export interface DmSettings { h: DmChannel; v: DmChannel; behaviour: DmBehaviour; wrap: boolean; maxH: number; maxV: number }

export const DM_CHANNELS: readonly DmChannel[];
export const DM_CHANNEL_LABELS: Readonly<Record<DmChannel, string>>;
export const DM_BEHAVIOURS: readonly DmBehaviour[];
export const DM_BEHAVIOUR_LABELS: Readonly<Record<DmBehaviour, string>>;
export const DM_QUALITIES: readonly DmQuality[];
export const DM_QUALITY_LABELS: Readonly<Record<DmQuality, string>>;
export function dmQualityScale(q: string | undefined): number;
export const DM_REF_HEIGHT: number;
export const DM_DEFAULTS: Readonly<DmSettings>;
export const DM_HINTS: Readonly<Record<'map' | 'h' | 'v' | 'maxH' | 'maxV' | 'behaviour' | 'wrap' | 'quality' | 'channels', string>>;
export const DM_GLSL: string;

export function dmChannel(c: ArrayLike<number>, ch: string): number;
export function dmChannelIndex(ch: string): number;
export function dmChannelGlsl(ch: string, c: string): string;
export function dmOffset(hVal: number, vVal: number, maxH: number, maxV: number, aspect: number): { x: number; y: number };
export function dmMapUv(uv: { x: number; y: number }, box: DmBox | null, behaviour: string): { x: number; y: number };
export function dmSourceUv(uv: { x: number; y: number }, off: { x: number; y: number }, wrap: boolean): { x: number; y: number } | null;
export function dmBoxOf(grid: ArrayLike<number>, w: number, h: number, minAlpha?: number): DmBox | null;
export function dmSettings(s: unknown): DmSettings;
export function dmApplyAt(
  uv: { x: number; y: number },
  src: (uv: { x: number; y: number }) => number[] | null,
  map: (uv: { x: number; y: number }) => number[] | null,
  s: Partial<DmSettings>, aspect: number, box?: DmBox | null,
): number[] | null;
export interface DmDisplacer {
  apply(src: TexImageSource, map: TexImageSource | null, opts: Partial<DmSettings> & { box?: DmBox | null }, W: number, H: number): HTMLCanvasElement | OffscreenCanvas | null;
  /** The upload mode in use. */
  readonly mode: DmUploadMode;
  /** Use one upload mode from now on; null goes back to the browser's (dmUploadModeFor). */
  setMode(mode: DmUploadMode | null): void;
  dispose(): void;
}
/** How a canvas gets into a texture: the canvas itself, or its bytes (getImageData). */
export type DmUploadMode = 'canvas' | 'pixels';
export function dmUploadModeFor(userAgent: string): DmUploadMode;
export function dmCreate(): DmDisplacer;
