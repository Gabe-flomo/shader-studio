export type TkKind = 'hands' | 'face' | 'pose';

/** One analysed frame, before encoding: its video time (s) and what was found. */
export interface TkRawFrame { t: number; items: { meta?: ArrayLike<number>; lm: ArrayLike<number> }[] }
export interface TkRawTrack { kind: TkKind; w: number; h: number; duration: number; fps: number; frames: TkRawFrame[] }

/** A decoded track: views on the stored bytes. */
export interface TkTrack {
  kind: TkKind; items: number; ch: number; points: number; meta: number; itemSize: number; frames: number;
  w: number; h: number; duration: number; fps: number;
  times: Float32Array; counts: Uint8Array; data: Int16Array; bytes: number;
}

/** A frame for a tracker: time (ms), frame size, and each item's meta values and landmarks. */
export interface TkFrame { t: number; w: number; h: number; items: { meta: Float32Array | number[]; lm: Float32Array | number[] }[] }

export interface TkSubject {
  live: boolean; present: boolean; ever: boolean; seen: number; hits: number; t: number; seq: number; aspect: number;
  n: number; pts: Float64Array; vis: Float32Array; meta: Float64Array; zScale: number; mirror: boolean;
  euro: unknown; g: Record<string, boolean>;
}

export interface TkDriver { last: number; has: boolean }

export const TK_KINDS: TkKind[];
export const TK_LAYOUT: Record<TkKind, { items: number; points: number; ch: number; meta: number }>;
export const TK_RANGE: number;
export const TK_JUMP_S: number;
export const TK_PRIME_S: number;
export const TK_HOLD_MS: number;
export const TK_APPEAR_FRAMES: number;

export function tkEncode(track: TkRawTrack): Uint8Array;
export function tkDecode(bytes: Uint8Array | ArrayBuffer): TkTrack | null;
export function tkFrameAt(track: TkTrack, t: number): { i: number; j: number; a: number };
export function tkItem(track: TkTrack, f: number, item: number): { meta: Float32Array; lm: Float32Array };
export function tkSample(track: TkTrack, t: number): TkFrame;
export function tkHandsFrame(s: TkFrame): { t: number; w: number; h: number; hands: { side: 'left' | 'right'; score: number; lm: Float32Array | number[] }[] };
export function tkDriver(): TkDriver;
export function tkDrive(drv: TkDriver, track: TkTrack, vt: number, reset: () => void, update: (f: TkFrame) => void): boolean;
export function tkVideoTime(layer: { follow?: boolean; start?: number; speed?: number; loop?: boolean; playing?: boolean }, clock: number, duration: number, elTime?: number | null): number;
export function tkToBase64(bytes: Uint8Array): string;
export function tkFromBase64(text: string): Uint8Array;
export function tkSubjectCreate(n: number, metaN?: number): TkSubject;
export function tkSubjectUpdate(st: TkSubject, frame: TkFrame, o: { picAspect: number; place?: { cx: number; cy: number; h: number; rot: number; mirror: boolean }; smoothing?: number; responsiveness?: number; ch?: number; appearFrames?: number }): boolean;
export function tkSubjectAge(st: TkSubject, now: number): void;
export function tkSubjectPoint(st: TkSubject | null, i: number): { x: number; y: number } | null;
export function tkHyst(was: boolean | undefined, v: number, on: number, off: number): boolean;
