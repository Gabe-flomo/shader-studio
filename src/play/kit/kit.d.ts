import type { PlayLayer, PlayRecord, ActionKind } from '../../types/play';

export interface KitPointer { x: number; y: number; over: boolean; down: boolean }
export interface KitAudio { wave: Float32Array | null; freq: Float32Array | null; sampleRate: number }

export interface KitEnv {
  gl: HTMLCanvasElement;
  W: number; H: number; dpr: number;
  time: number; dt: number;
  value(layer: PlayLayer, key: string): number;
  pointer: KitPointer;
  markers: boolean;
  editing: boolean;
  selectedId?: string;
  hidden: boolean;
  /** Exporting with a transparent background: don't paint the backdrop. */
  transparent?: boolean;
  backdrop: [number, number, number];
  audio: KitAudio | null;
  /** An audio layer's sound: a song loaded into it, or the live input. Falls back to `audio`. */
  audioFor?: (l: PlayLayer) => KitAudio | null;
  camera: HTMLVideoElement | null;
  image(src: string): HTMLImageElement | null;
  sensor(key: string, value: number): void;
  override(layerId: string, key: string, value: number | null): void;
  /** Set when the shader has a Layers node: gets the layers' colour and distance field each frame. */
  shaderTap?: (tap: ShaderTap) => void;
}

/** What the graph's Layers node reads: colour at half resolution, and a 16-bit packed distance grid (row 0 at the top). */
export interface ShaderTap { color: HTMLCanvasElement; field: Uint8Array; gw: number; gh: number }

export interface LayerKit {
  frame(ctx: CanvasRenderingContext2D, record: PlayRecord, env: KitEnv): void;
  act(a: { do: ActionKind; layerId: string; amount: number }): void;
  shapeAt(record: PlayRecord, x: number, y: number, aspect: number, value: (layer: PlayLayer, key: string) => number): string | null;
  isAnimated(record: PlayRecord): boolean;
  reset(): void;
}

export function createLayerKit(): LayerKit;
