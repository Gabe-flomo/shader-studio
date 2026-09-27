/** The parts of p5.js (p5 compatibility for Script layers) the app reads directly. */
export const KP5_NAMES: readonly string[];
export const KP5_CALLBACKS: readonly string[];
export const KP5_STUBBED: readonly string[];
export const KP5_UNSUPPORTED: readonly string[];
export const KP5_WEBGL: readonly string[];
export const KP5_SOUND: readonly string[];
/** Is this a p5 sketch (createCanvas, `new p5(`, a preload)? */
export function kp5Detect(code: string): boolean;

/** A seeded 0–1 generator (p5's LCG). */
export function kp5Lcg(seed?: number): () => number;
export interface Kp5NoiseGen { octaves: number; falloff: number; seed(n: number): void; at(x: number, y?: number, z?: number): number }
/** p5's noise, drawing its table from `rnd` until seeded. */
export function kp5Noise(rnd: () => number): Kp5NoiseGen;

export class kp5Vector {
  constructor(x?: number, y?: number, z?: number);
  x: number; y: number; z: number;
  set(x?: number | kp5Vector | number[], y?: number, z?: number): this;
  copy(): kp5Vector;
  add(x: number | kp5Vector | number[], y?: number, z?: number): this;
  sub(x: number | kp5Vector | number[], y?: number, z?: number): this;
  mult(x: number | kp5Vector | number[], y?: number, z?: number): this;
  div(x: number | kp5Vector | number[], y?: number, z?: number): this;
  mag(): number; magSq(): number; heading(): number;
  dot(v: kp5Vector): number; cross(v: kp5Vector): kp5Vector; dist(v: kp5Vector): number;
  normalize(): this; limit(n: number): this; setMag(n: number): this; rotate(a: number): this; setHeading(a: number): this;
  angleBetween(v: kp5Vector): number; lerp(v: kp5Vector, t: number): this; array(): number[];
  static fromAngle(a: number, len?: number): kp5Vector;
  static add(a: kp5Vector, b: kp5Vector): kp5Vector;
  static sub(a: kp5Vector, b: kp5Vector): kp5Vector;
  static rnd: () => number;
}
export class kp5Color {
  constructor(levels: number[]);
  levels: number[];
  toString(): string;
}
/** Colour arguments in a colour mode ('rgb' | 'hsb' | 'hsl') with its maxes, as levels 0–255. */
export function kp5Levels(args: unknown[], mode: string, maxes?: number[]): number[];
/** The sketch's console: to `sink` when given, else the page's console. */
export function kp5Console(sink: ((level: string, args: unknown[]) => void) | null): Console & { watch(name: string, value: unknown): void };
/** A key or wheel event as the page would deliver it. */
export function kp5Event(ev: { type: 'down' | 'up' | 'wheel'; key?: string; keyCode?: number; delta?: number }): void;
export function kp5ParseTable(text: string, header?: boolean, sep?: string): { columns: string[]; getRowCount(): number; getString(r: number, c: number | string): string; getNum(r: number, c: number | string): number };

/** A p5 sketch's state on its compiled sketch. */
export interface Kp5Host {
  lw: number; lh: number; explicit: boolean;
  sf: { canvas: unknown; ctx: CanvasRenderingContext2D | null; w: number; h: number; d: number };
  view: { x: number; y: number; w: number; h: number; k: number } | null;
  frameCount: number; looping: boolean; mouseX: number; mouseY: number; pending: number;
  controls: Map<string, unknown>;
}
