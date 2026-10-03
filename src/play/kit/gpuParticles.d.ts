/** The Particles node's GPU engine (see gpuParticles.js and docs/gpu-particles-plan.md). */
export type GpRgb = [number, number, number];

export interface GpParams {
  count: string; emitter: string; emit: string; follow: string;
  emitSize: number; life: number; speed: number; spread: number;
  gravity: number; turbulence: number; swirl: number; attract: number; drag: number;
  size: number; brightness: number; palette: string; colorBy: string; glow: number;
  lights: string; lightColor: GpRgb; lightPower: number; lightReach: number; halo: number; lightMotion: string;
}

export const GP_TIERS: Record<string, number>;
export const GP_SHAPES: string[];
export const GP_PALETTES: Record<string, GpRgb[] | null>;
export const GP_DEFAULTS: GpParams;
export const GP_LIMITS: Record<string, [number, number]>;
export const GP_MAX_DT: number;
export const GP_SUBSTEP: number;
export const GP_PREROLL: number;
export const GP_MARK: string;

export interface GpBinding { uniform: string; params: Record<string, unknown> }
export interface GpEmitterState { head: number; carry: number; clock: number; burst: number }
export interface GpLight { x: number; y: number; reach: number; power: number; colour: GpRgb }
export interface GpPlacement { emitAt: [number, number]; attractAt: [number, number]; lights: GpLight[] }

export function gpTierSide(tier: string): number;
export function gpBindings(fragmentShader: string): GpBinding[];
export function gpParams(raw: Record<string, unknown> | null | undefined, read?: (uniform: string) => unknown): GpParams;
export function gpSubsteps(dt: number, max?: number): { n: number; h: number };
export function gpMaxSubsteps(n: number): number;
export function gpEmitterState(): GpEmitterState;
export function gpEmit(st: GpEmitterState, mode: string, n: number, life: number, lifeVar: number, h: number): { start: number; count: number };
export function gpInWindow(i: number, start: number, count: number, n: number): boolean;
export function gpHueRotate(rgb: readonly number[], turns: number): GpRgb;
export function gpPlace(p: GpParams, time: number, mouse: readonly number[] | null, aspect: number): GpPlacement;
export function gpUnitBrightness(n: number, size: number): number;
export function gpUnsupported(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): string | null;

export interface GpFrame {
  params: GpParams; width: number; height: number; dt: number; time: number;
  mouse: readonly number[] | null; reset?: boolean;
}
export interface GpEngine {
  frame(o: GpFrame): WebGLTexture | null;
  reset(): void;
  dispose(): void;
  readonly precision: 'float' | 'half';
}
export function gpCreate(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): GpEngine | null;

export interface GpHostFrame {
  width: number; height: number; dt: number; time: number;
  mouse: readonly number[] | null;
  read: (uniform: string) => unknown;
  reset?: boolean;
}
export interface GpHost {
  readonly unsupported: string | null;
  bind(fragmentShader: string): GpBinding[];
  readonly bindings: GpBinding[];
  active(): boolean;
  frame(o: GpHostFrame): { uniform: string; texture: WebGLTexture | null }[];
  reset(): void;
  dispose(): void;
}
export function gpHost(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): GpHost;
