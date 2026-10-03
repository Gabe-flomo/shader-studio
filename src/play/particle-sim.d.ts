import type { ParticlesLayer } from '../types/play';

export interface ParticleState {
  count: number;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  age: Float32Array; life: Float32Array; r: Float32Array;
  alive: Uint8Array; cool: Float32Array; zt: Int16Array; zs: Float32Array;
  /** Multiply: seconds to the next split, the partner an annihilating particle seeks (-1 = none), where it was born. */
  split: Float32Array; mate: Int32Array; bx: Float32Array; by: Float32Array;
  seed: number;
  /** Multiply's colony state (null until the first step). splits/fulls/annihilations/cleareds are event counters (each bumped once per bud, target reached, pair death and clear-out) that the layer's signals watch. */
  mx: { phase: 'start' | 'grow' | 'full'; full: number; idle: number; respawn: number; cycles: number; reached: boolean; splits: number; fulls: number; annihilations: number; cleareds: number; wasEmpty: boolean } | null;
  /** Annihilation bursts still showing: where, how old (s), and the sparks' angle. */
  /** How many particles have been born / have died so far, cumulative, every Emit mode. The kit diffs these between frames into the Born/Died signals and the born/died-this-step readings. */
  evBorn: number; evDied: number;
  /** Where the latest birth, death and annihilation happened (NaN before the first). */
  bornX: number; bornY: number; diedX: number; diedY: number; annX: number; annY: number;
}
/** A particles layer's settings with numbers already driven (the id, label and kind are not read). */
export type ParticleParams = Omit<ParticlesLayer, 'id' | 'label' | 'kind' | 'visible' | 'toShader'> & Partial<Pick<ParticlesLayer, 'id' | 'label' | 'kind' | 'visible' | 'toShader'>>;
export interface CompiledZone {
  id: string; action: string; dist(x: number, y: number): number; normal(x: number, y: number): [number, number];
  x: number; y: number; w: number; h: number; rot: number; strength: number; reach: number; bounce: number; angle: number; tilt: number;
  targetId: string; tint: number[]; scale: number; affects: string; inside: number; total: number; area?: number;
  randomPoint(rand: () => number): [number, number];
}
export interface ParticleEnv {
  dt: number; time: number; aspect: number;
  sample: Uint8ClampedArray | null; sw: number; sh: number;
  attractorPoint: { x: number; y: number } | null;
  spawnPoint: { x: number; y: number } | null;
  /** Spawn 'motion' or 'bright': a cumulative table over a w × h grid (row 0 at the top) to pick birth cells from. */
  spawnMap?: { cdf: Float32Array; total: number; w: number; h: number } | null;
  modPoint?: { x: number; y: number } | null;
  zones?: CompiledZone[]; emitters?: CompiledZone[]; zoneById?: Map<string, CompiledZone>;
  W?: number; H?: number; dpr?: number; alpha?: number;
  sprite?: (CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }) | null;
}
export const PARTICLE_PALETTES: Array<{ name: string; a: number[]; b: number[]; c: number[]; d: number[] }>;
export function noise3(x: number, y: number, z: number): number;
export function seededRandom(seed: number): () => number;
export function stringSeed(text: string, mix?: number): number;
export function paletteColour(index: number, t: number): [number, number, number];
export function paletteCssAt(index: number, t: number): string;
export function brightnessAt(sample: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number;
export function createParticles(count: number, rand?: () => number, dead?: boolean): ParticleState;
export function resizeParticles(st: ParticleState, count: number, rand?: () => number, dead?: boolean): ParticleState;
export function stepParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, rand?: () => number): void;
/** The first index whose cumulative weight passes `r` (a binary search over a cumulative table). */
export function pickCell(cdf: ArrayLike<number>, r: number): number;
export function burstParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, amount: number, rand?: () => number): void;
export function scatterParticles(st: ParticleState, p: ParticleParams, strength: number, rand?: () => number): void;
export function resetParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, rand?: () => number): void;
export function multiplyParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, amount: number, rand?: () => number): void;
export function cullParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, amount: number, rand?: () => number): void;
export function modulator(by: ParticleParams['sizeBy'], st: ParticleState, i: number, p: ParticleParams, env: ParticleEnv): number;
export interface FieldSample { x: number; y: number; fx: number; fy: number; settle: boolean; ax: number; ay: number }
export function particleFieldGrid(p: ParticleParams, env: ParticleEnv, cols: number, rows: number, seed?: number): FieldSample[];
export function drawParticles(ctx: CanvasRenderingContext2D, st: ParticleState, p: ParticleParams, env: ParticleEnv & { W: number; H: number }): void;
export function gooAlpha(v: number, threshold: number, soft: number): number;
export function gooKernel(d: number, R: number): number;
export function gooCell(W: number, H: number, reach: number): number;
export function gooField(st: ParticleState, p: ParticleParams, env: ParticleEnv & { W: number; H: number }, gw: number, gh: number, cell: number): { v: Float32Array; rgb: Float32Array };
