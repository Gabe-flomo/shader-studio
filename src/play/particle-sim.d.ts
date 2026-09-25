import type { ParticlesLayer } from '../types/play';

export interface ParticleState {
  count: number;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  age: Float32Array; life: Float32Array; r: Float32Array;
  alive: Uint8Array; cool: Float32Array; zt: Int16Array; zs: Float32Array;
  seed: number;
}
/** A particles layer's settings with numbers already driven (the id, label and kind are not read). */
export type ParticleParams = Omit<ParticlesLayer, 'id' | 'label' | 'kind' | 'visible' | 'toShader'> & Partial<Pick<ParticlesLayer, 'id' | 'label' | 'kind' | 'visible' | 'toShader'>>;
export interface CompiledZone {
  id: string; action: string; dist(x: number, y: number): number; normal(x: number, y: number): [number, number];
  x: number; y: number; w: number; h: number; rot: number; strength: number; reach: number; bounce: number; angle: number;
  targetId: string; tint: number[]; scale: number; affects: string; inside: number; total: number; area?: number;
  randomPoint(rand: () => number): [number, number];
}
export interface ParticleEnv {
  dt: number; time: number; aspect: number;
  sample: Uint8ClampedArray | null; sw: number; sh: number;
  attractorPoint: { x: number; y: number } | null;
  spawnPoint: { x: number; y: number } | null;
  modPoint?: { x: number; y: number } | null;
  zones?: CompiledZone[]; emitters?: CompiledZone[]; zoneById?: Map<string, CompiledZone>;
  W?: number; H?: number; dpr?: number; alpha?: number;
  sprite?: (CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }) | null;
}
export const PARTICLE_PALETTES: Array<{ name: string; a: number[]; b: number[]; c: number[]; d: number[] }>;
export function noise3(x: number, y: number, z: number): number;
export function seededRandom(seed: number): () => number;
export function paletteColour(index: number, t: number): [number, number, number];
export function paletteCssAt(index: number, t: number): string;
export function brightnessAt(sample: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number;
export function createParticles(count: number, rand?: () => number, dead?: boolean): ParticleState;
export function resizeParticles(st: ParticleState, count: number, rand?: () => number, dead?: boolean): ParticleState;
export function stepParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, rand?: () => number): void;
export function burstParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, amount: number, rand?: () => number): void;
export function scatterParticles(st: ParticleState, p: ParticleParams, strength: number, rand?: () => number): void;
export function resetParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, rand?: () => number): void;
export function modulator(by: ParticleParams['sizeBy'], st: ParticleState, i: number, p: ParticleParams, env: ParticleEnv): number;
export function drawParticles(ctx: CanvasRenderingContext2D, st: ParticleState, p: ParticleParams, env: ParticleEnv & { W: number; H: number }): void;
