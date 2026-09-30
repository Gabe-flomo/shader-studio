import type { PlayLayer, PlayRecord, ActionKind, BackgroundItem } from '../../types/play';
import type { BqPlan } from './queue.js';
import type { KitBackground } from './layers.js';
export type { KitBackground } from './layers.js';
import type { HdState } from './hands.js';
import type { TkSubject } from './tracks.js';

export interface KitPointer { x: number; y: number; over: boolean; down: boolean }
export interface KitAudio { wave: Float32Array | null; freq: Float32Array | null; sampleRate: number }

export interface KitEnv {
  gl: HTMLCanvasElement;
  W: number; H: number; dpr: number;
  time: number; dt: number;
  value(layer: PlayLayer, key: string): number;
  /** Null markers and the hands' skeleton go here instead (the Finish stack keeps them off the finished picture). */
  guides?: CanvasRenderingContext2D | null;
  /** Layers to also draw alone (even hidden), read back with layerCanvas(id). */
  alphaLayers?: readonly string[] | null;
  /** Each layer's step and draw time in ms, when the host is measuring (its Performance panel is open). */
  layerTime?: (id: string, ms: number) => void;
  /** Sample the picture's coarse grid even when no layer reads it (a Granulator's things read their brightness). */
  needCoarse?: boolean;
  pointer: KitPointer;
  markers: boolean;
  editing: boolean;
  selectedId?: string;
  hidden: boolean;
  /** Exporting with a transparent background: don't paint the backdrop. */
  transparent?: boolean;
  backdrop: [number, number, number];
  /** An image, a video or a colour in place of the shader: painted under the layers, and what they read as the picture (`gl` is then ignored). */
  background?: KitBackground | null;
  audio: KitAudio | null;
  /** An audio layer's sound: a song loaded into it, or the live input. Falls back to `audio`. */
  audioFor?: (l: PlayLayer) => KitAudio | null;
  camera: HTMLVideoElement | null;
  /** A Video layer's element (the host keeps it on the clock), or null while it has none. */
  layerVideo?: (layer: PlayLayer) => HTMLVideoElement | null;
  image(src: string): HTMLImageElement | null;
  sensor(key: string, value: number): void;
  override(layerId: string, key: string, value: number | null): void;
  /** A recorded place for a driven layer (a take playing back or rendering): it wins over a relationship's own. */
  placed?: (layerId: string, key: string) => number | undefined;
  /** Set when the shader has a Layers node: gets the layers' colour and distance field each frame. */
  shaderTap?: (tap: ShaderTap) => void;
  /** A Script layer compiled or ran: null clears its error, a string is the message shown under its code. */
  scriptStatus?: (layerId: string, error: string | null) => void;
  /** A Script layer's console output (see kit.js); without it the sketch logs to the page's console. */
  scriptLog?: (layerId: string, level: string, args: unknown[]) => void;
  /** Hand tracking: a landmark on the picture for a null following a hand (null while that hand is out of view). */
  hand?: (side: string, point: number) => { x: number; y: number } | null;
  /** Hand tracking is running (has seen a camera frame): a hand out of view is then "lost" for path shapes. Without it, a hand null that never saw its hand rests where it was placed. */
  handsLive?: boolean;
  /** Hand tracking: draw the hands' skeleton with the markers (null or absent: don't). */
  hands?: { state: HdState; colour: [number, number, number] } | null;
  /** Face and pose tracking: a landmark for a null following it (null while nothing is in view). */
  track?: (kind: 'face' | 'pose', point: number) => { x: number; y: number } | null;
  /** That tracker has seen a frame. */
  trackLive?: (kind: 'face' | 'pose') => boolean;
  /** Face and pose tracking: draw them with the markers (null or absent: don't). */
  tracks?: { kind: 'face' | 'pose'; state: TkSubject; colour: [number, number, number] }[] | null;
  /**
   * Background layer: a graph source's picture this frame (the host rendered it), or null.
   * For `this` graph null means `gl` holds it.
   */
  graphFrame?: (item: BackgroundItem) => CanvasImageSource | null;
  /** Background layer: a video source's element, kept on the clock by the host (null while it has none). */
  video?: (item: BackgroundItem) => HTMLVideoElement | null;
  /** Background layer: the host may draw one untransformed graph straight to the GL canvas (see BqPlan.direct). */
  allowDirect?: boolean;
  /** three.js for 3D Script layers (the three-slim.js set); without it they wait and draw nothing. */
  three?: unknown;
  /** A dataset by id or name (Data layers, s.data() in sketches): its frozen result with Normalize applied, or null. */
  data?: (ref: string) => KitDataset | null;
}

/** A dataset as the kit reads it. */
export interface KitDataset { id: string; name: string; result: import('../../data/types').DatasetResult | null }

export type { BqPlan } from './queue.js';

/** What the graph's Layers node reads: colour at half resolution, and a 16-bit packed distance grid (row 0 at the top). */
/**
 * What the Layers node reads each frame: the layers at full size (`layers`,
 * the GPU distance field's source, see jfa.js) and half size (`color`), a
 * signature that changes when they do, and the CPU fallback field (`field`,
 * computed only when read: gw × gh, 16-bit packed, row 0 at the top).
 */
export interface ShaderTap { color: HTMLCanvasElement; layers: HTMLCanvasElement; sig: number; readonly field: Uint8Array; gw: number; gh: number }

export interface LayerKit {
  frame(ctx: CanvasRenderingContext2D, record: PlayRecord, env: KitEnv): void;
  act(a: { do: ActionKind; layerId: string; amount: number }): void;
  shapeAt(record: PlayRecord, x: number, y: number, aspect: number, value: (layer: PlayLayer, key: string) => number): string | null;
  isAnimated(record: PlayRecord): boolean;
  /** A layer drawn alone on the last frame (listed in env.alphaLayers), or null. */
  layerCanvas(id: string): HTMLCanvasElement | null;
  grainThings(record: PlayRecord, sourceId: string, boundaryId: string, value: (l: PlayLayer, key: string) => number, aspect: number): { things: GrainThing[]; cx: number; cy: number; all: number };
  /**
   * The Background layer's plan for this frame (null without one): what the
   * host must render first (graphs) and keep playing (videos). Carries out
   * Change background actions queued since the last frame.
   */
  background(record: PlayRecord, env: Pick<KitEnv, 'time' | 'value' | 'allowDirect'>): BqPlan | null;
  /** Forget all state; `seed` makes the layers' random choices repeatable (a take). */
  reset(seed?: number): void;
}

export function createLayerKit(): LayerKit;

export interface GrainThing { id: number; x: number; y: number; vx: number; vy: number; age: number; size: number; bright: number; born: boolean }
