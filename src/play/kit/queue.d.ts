import type { BackgroundItem, BackgroundLayer } from '../../types/playLayers';

export interface BqState { step: number; toId: string; fromId: string; at: number; started: boolean }
export interface BqPlan {
  layerId: string;
  /** The queue position showing (or fading in), -1 for an empty queue. */
  slot: number;
  /** Bottom to top: the outgoing source at 1, the incoming one at `mix`. Empty while the layer is hidden. */
  items: { item: BackgroundItem; alpha: number }[];
  mix: number;
  fading: boolean;
  transform: { x: number; y: number; scale: number; rotation: number };
  identity: boolean;
  fit: 'cover' | 'contain' | 'stretch';
  colour: [number, number, number];
  /** One graph, untransformed: the host draws it straight to the GL canvas and nothing is painted over it. */
  direct: boolean;
}
export interface BqFrame { el: CanvasImageSource; w: number; h: number; full?: boolean }

export function bqSlot(index: number, step: number, offset: number, n: number): number;
export function bqState(): BqState;
export function bqAct(st: BqState, layer: BackgroundLayer, value: (key: string) => number, a: { do: string; amount?: number }, rand: () => number): boolean;
export function bqPlan(st: BqState, layer: BackgroundLayer, value: (key: string) => number, time: number, visible: boolean, allowDirect?: boolean): BqPlan;
export function bqCompose(c: HTMLCanvasElement, plan: BqPlan, W: number, H: number, frameOf: (item: BackgroundItem) => BqFrame | null): HTMLCanvasElement;
