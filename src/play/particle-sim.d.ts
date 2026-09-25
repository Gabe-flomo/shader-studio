export interface ParticleState {
  count: number;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  age: Float32Array; life: Float32Array; r: Float32Array;
  seed: number;
}
export interface ParticleParams {
  speed: number; steer: number;
  field: 'flow' | 'climb' | 'descend' | 'noise' | 'none';
  turns: number; noiseScale: number; noiseEvolve: number; flat: 'wander' | 'settle';
  attractor: 'none' | 'mouse' | 'null'; force: 'gravitate' | 'spiral' | 'repel'; strength: number; catchRadius: number;
  spawn: 'anywhere' | 'edges' | 'center' | 'null'; spawnRadius: number;
  edges: 'wrap' | 'bounce' | 'respawn'; life: number;
  size: number; sizeJitter: number;
  shape: 'dot' | 'square' | 'triangle' | 'streak' | 'ring' | 'star' | 'image'; rotate: 'heading' | 'spin' | 'none'; crop: boolean;
  colour: 'tint' | 'picture' | 'palette'; color: [number, number, number]; palette: number; paletteBy: 'heading' | 'speed' | 'age' | 'brightness';
  sizeBy: 'none' | 'brightness' | 'speed' | 'age' | 'null'; sizeAmount: number;
  opacityBy: 'none' | 'brightness' | 'speed' | 'age' | 'null'; opacityAmount: number;
  falloff: number;
}
export interface ParticleEnv {
  dt: number; time: number; aspect: number;
  sample: Uint8ClampedArray | null; sw: number; sh: number;
  attractorPoint: { x: number; y: number } | null;
  spawnPoint: { x: number; y: number } | null;
  modPoint?: { x: number; y: number } | null;
  aspectInv?: number;
  W?: number; H?: number; dpr?: number; alpha?: number;
  sprite?: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number } | null;
}
export const PARTICLE_PALETTES: Array<{ name: string; a: number[]; b: number[]; c: number[]; d: number[] }>;
export function noise3(x: number, y: number, z: number): number;
export function paletteColour(index: number, t: number): [number, number, number];
export function brightnessAt(sample: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number;
export function createParticles(count: number, rand?: () => number): ParticleState;
export function stepParticles(st: ParticleState, p: ParticleParams, env: ParticleEnv, rand?: () => number): void;
export function modulator(by: ParticleParams['sizeBy'], st: ParticleState, i: number, p: ParticleParams, env: ParticleEnv): number;
export function drawParticles(ctx: CanvasRenderingContext2D, st: ParticleState, p: ParticleParams, env: ParticleEnv & { W: number; H: number }): void;
