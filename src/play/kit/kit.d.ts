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
  backdrop: [number, number, number];
  audio: KitAudio | null;
  camera: HTMLVideoElement | null;
  image(src: string): HTMLImageElement | null;
  sensor(key: string, value: number): void;
  override(layerId: string, key: string, value: number | null): void;
}

export interface LayerKit {
  frame(ctx: CanvasRenderingContext2D, record: PlayRecord, env: KitEnv): void;
  act(a: { do: ActionKind; layerId: string; amount: number }): void;
  shapeAt(record: PlayRecord, x: number, y: number, aspect: number, value: (layer: PlayLayer, key: string) => number): string | null;
  isAnimated(record: PlayRecord): boolean;
  reset(): void;
}

export function createLayerKit(): LayerKit;
