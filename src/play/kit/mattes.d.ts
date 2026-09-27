/** Track mattes and masks (see mattes.js). */
export type KmMaskProp = 'x' | 'y' | 'w' | 'h' | 'rotation' | 'round' | 'feather' | 'expand' | 'opacity';
export const KM_MASK_PROPS: readonly KmMaskProp[];
export const KM_MASK_DEFAULTS: Readonly<Record<KmMaskProp, number>>;
export function kmMaskKey(id: string, prop: string): string;

type V = (key: string) => number;
type AnyLayer = { id: string; kind: string } & Record<string, unknown>;
interface KmMask { id: string; shape: string; points: number[]; op: string; invert: boolean }
export interface KmPlacement { x: number; y: number; w: number; h: number; rotation: number; round: number; feather: number; expand: number; opacity: number; points: number[]; turn: number }

export function kmAnchor(l: AnyLayer, v: V): { x: number; y: number; rot: number };
export function kmMaskValue(m: KmMask, v: V, prop: KmMaskProp): number;
export function kmMaskPlacement(l: AnyLayer, m: KmMask, v: V, aspect: number): KmPlacement;
export function kmMaskLocal(l: AnyLayer, v: V, aspect: number, x: number, y: number, rotation: number): { x: number; y: number; rotation: number };
export function kmMaskPath(m: KmMask, p: KmPlacement, W: number, H: number): Path2D;
export function kmMatteValue(r: number, g: number, b: number, a: number, mode: string, invert: boolean): number;
export function kmMix(acc: number, m: number, op: string): number;
export function kmMaskStart(masks: ReadonlyArray<{ op: string }>): number;
export function kmLumaToAlpha(d: Uint8ClampedArray | Uint8Array, invert: boolean): void;
type Matted = { id: string; kind: string; trackMatte?: { id: string } };
export function kmTrackOf<L extends Matted>(l: L, byId: Map<string, L>): L | null;
export function kmWouldCycle(layers: ReadonlyArray<{ id: string; trackMatte?: { id: string } }>, consumerId: string, matteId: string): boolean;
export function kmMatteSources<L extends Matted>(layers: readonly L[], drawn: (l: L) => boolean): Set<string>;
