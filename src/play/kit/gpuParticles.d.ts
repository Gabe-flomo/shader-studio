/** The Particles node's GPU engine (see gpuParticles.js and docs/gpu-particles-plan.md). */
export type GpRgb = [number, number, number];

export interface GpParams {
  count: string; emitter: string; emit: string; follow: string;
  emitSize: number; life: number; speed: number; spread: number;
  gravity: number; turbulence: number; swirl: number; attract: number; drag: number;
  size: number; brightness: number; palette: string; colorBy: string; glow: number;
  burst: number; threshold: number; release: number; wind: number; scale: number;
  look: string; paper: GpRgb; ink: GpRgb; thread: number;
  space: string; camAngle: number; camTilt: number; camDistance: number; drift: number; focus: number; blur: number;
  lights: string; lightColor: GpRgb; lightPower: number; lightReach: number; halo: number; lightMotion: string;
  soundFrom: string; sound: number; wave: number; waveSpeed: number; vibrate: number; shock: number; crunch: number; gust: number; jet: number;
  obstacleMode: string; flowForce: number; flowMode: string; sceneReach: number;
  pattern: string; modeFrom: string; symmetry: string; modes: number; modeN: number; modeM: number;
  plateFreq: number; plateWeights: number; settle: number; shake: number;
  hands: string; handX: number; handY: number; hand2X: number; hand2Y: number; handForce: number; handSwirl: number; handReach: number;
}

export interface GpPresetDef { label: string; hint: string; set: Partial<Record<keyof GpParams, unknown>> }
export const GP_PRESETS: Record<string, GpPresetDef>;
export function gpPreset(name: string): Record<string, unknown> | null;
export const GP_LEVELS: number;
export const GP_FOV: number;
export const GP_BLUR_CAP: number;
export function gpRising(st: Record<string, number>, key: string, v: number): boolean;
export interface GpLevels { levels: Float32Array; carry: number }
export function gpLevelsState(): GpLevels;
export function gpLevelsPush(st: GpLevels, level: number, dt: number): number;
export interface GpCamera { viewProj: Float32Array; eye: number[]; dist: number; focus: number; lens: number }
export function gpCamera(p: GpParams, time: number, aspect: number): GpCamera;
export function gpProject(cam: GpCamera, xyz: readonly number[], aspect: number): { x: number; y: number; depth: number };
export function gpUnitInk(n: number, size: number): number;

export const GP_TIERS: Record<string, number>;
/** The engine's GLSL chunks, unchanged (gpEngineShaders.test.ts snapshots them). */
export const GP_SHADERS: {
  GP_QUAD_VERT: string; GP_HASH: string; GP_NOISE: string; GP_SCATTER: string; GP_HOME: string; GP_COVER: string; GP_SIM: string;
  GP_DRAW_VERT: string; GP_DRAW_FRAG: string; GP_DOWN: string; GP_BLUR: string; GP_COMPOSE: string;
};
export const GP_SHAPES: string[];
export const GP_PALETTES: Record<string, GpRgb[] | null>;
export const GP_DEFAULTS: GpParams;
export const GP_LIMITS: Record<string, [number, number]>;
export const GP_MAX_DT: number;
export const GP_SUBSTEP: number;
export const GP_PREROLL: number;
export const GP_MARK: string;

export interface GpProbeSpec {
  m: string; s: string; c: string | null; f: string[]; v2: string[]; cam: boolean;
  field: { obstacle: boolean; flow: boolean; depth: boolean; scene: boolean };
}
export const GP_VOL: number;
export const GP_VOL_TILES: [number, number];
export function gpVolPoint(cell: readonly number[], centre: readonly number[], half: number): number[];
export interface GpProbeSlot { kind: 'f' | 'v2' | 'ro' | 'rd'; keys?: string[]; key?: string; dx: number; dy: number }
export const GP_SOCKET_FLOATS: string[];
export const GP_SOCKET_POINTS: string[];
export function gpProbeSpec(pr: Record<string, unknown>): GpProbeSpec;
export function gpProbeSlots(spec: GpProbeSpec | null): GpProbeSlot[];
export function gpProbeField(spec: GpProbeSpec | null): boolean;
export function gpApplyProbe(P: GpParams, spec: GpProbeSpec | null | undefined, values: ArrayLike<number> | null | undefined, aspect: number): {
  params: GpParams; cam: { ro: number[]; rays: number[][] } | null; emitAt: [number, number] | null;
};
export function gpCameraFrom(eye: number[], f: number[], r: number[], u: number[], lens: number, aspect: number, focusDist: number): GpCamera;
export function gpSceneCamera(ro: number[], rays: number[][], aspect: number, target: number[], focus: number): GpCamera | null;
export interface GpSoundInput { freq?: Float32Array; wave?: Float32Array; sampleRate?: number; level?: number }
export interface GpSound { level: number; bass: number; mid: number; treble: number; avg: number; avgBass: number; since: number; onset: number; hit: number }
export function gpSoundState(): GpSound;
export function gpSoundStep(st: GpSound, input: GpSoundInput | null, dt: number): GpSound;
export interface GpBinding { uniform: string; params: Record<string, unknown>; image: string | null; audio: string | null; audioBands: string[]; probe: GpProbeSpec | null }
export interface GpEmitterState { head: number; carry: number; clock: number; burst: number }
export interface GpLight { x: number; y: number; z: number; reach: number; power: number; colour: GpRgb }
export interface GpPlacement { emitAt: [number, number]; attractAt: [number, number]; lights: GpLight[]; hands: [number, number][] }

export function gpTierSide(tier: string): number;
export function gpBindings(fragmentShader: string): GpBinding[];
export function gpParams(raw: Record<string, unknown> | null | undefined, read?: (uniform: string) => unknown): GpParams;
export function gpSubsteps(dt: number, max?: number): { n: number; h: number };
export function gpMaxSubsteps(n: number): number;
export function gpEmitterState(): GpEmitterState;
export function gpEmit(st: GpEmitterState, mode: string, n: number, life: number, lifeVar: number, h: number): { start: number; count: number };
/** Particle i's cell on the picture (Image emitter): a one-to-one scramble of 0…2^bits − 1. */
export function gpScatter(i: number, bits: number): number;
export function gpInWindow(i: number, start: number, count: number, n: number): boolean;
export function gpHueRotate(rgb: readonly number[], turns: number): GpRgb;
export function gpPlace(p: GpParams, time: number, mouse: readonly number[] | null, aspect: number): GpPlacement;
export function gpUnitBrightness(n: number, size: number): number;
export function gpUnsupported(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): string | null;

export interface GpFrame {
  params: GpParams; width: number; height: number; dt: number; time: number;
  mouse: readonly number[] | null; reset?: boolean;
  image?: WebGLTexture | null; imageAspect?: number; level?: number; sound?: GpSoundInput | null;
  probe?: { spec: GpProbeSpec; values: ArrayLike<number> | null; field: GpField | null; volume?: GpField | null } | null;
}
/** The probe's field over the picture: rgb obstacle, flow, depth (RGBA16F, linear), and its size. */
export interface GpField { texture: WebGLTexture; w: number; h: number }
export interface GpEngine {
  frame(o: GpFrame): WebGLTexture | null;
  reset(): void;
  dispose(): void;
  readonly precision: 'float' | 'half';
}
/** The blend function and equation, clear colour and colour mask of `gl`, kept by wrapping its setters (no GPU round trips to read them). */
export interface GpStateShadow { bsrc: number; bdst: number; basrc: number; badst: number; beq: number; beqa: number; clear: number[]; mask: boolean[] }
export function gpStateShadow(gl: unknown): GpStateShadow;
export function gpCreate(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): GpEngine | null;

export interface GpHostFrame {
  width: number; height: number; dt: number; time: number;
  mouse: readonly number[] | null;
  read: (uniform: string) => unknown;
  texture?: (uniform: string) => { texture: WebGLTexture; aspect: number } | null;
  /** A node's probe this frame: the wired values read back (gpProbeSlots order) and the field. */
  probe?: (binding: GpBinding, volume: { centre: number[]; half: number }) => { values: ArrayLike<number> | null; field: GpField | null; volume?: GpField | null } | null;
  /** What Sound from hears now ('live', 'master', 'track1'…): a spectrum, a level, or null. */
  sound?: (source: string) => GpSoundInput | null;
  reset?: boolean;
}
export interface GpHost {
  readonly unsupported: string | null;
  bind(fragmentShader: string): GpBinding[];
  readonly bindings: GpBinding[];
  active(): boolean;
  frame(o: GpHostFrame): { uniform: string; texture: WebGLTexture | null; look: string }[];
  reset(): void;
  dispose(): void;
}
export function gpHost(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): GpHost;

export interface GpReadback { request(fb: WebGLFramebuffer | null, w: number, h: number): boolean; poll(): Float32Array | null; dispose(): void }
export function gpReadback(gl: WebGL2RenderingContext): GpReadback;

/** Chladni plates (Pattern). */
export interface GpPlateMode { n: number; m: number; w: number }
export interface GpPlateState { modes: GpPlateMode[]; bands: number[]; step: number; since: number; lead: number; leadSince: number }
export const GP_PLATE_HOLD: number;
export const GP_PLATE_MAX: number;
export const GP_PLATE_BANDS: number;
export const GP_BESSEL_N: number;
export const GP_BESSEL_X: number;
export const GP_BESSEL_W: number;
export function gpBessel(n: number, x: number): number;
export function gpBesselTable(): Float32Array;
export function gpBesselZero(n: number, m: number): number;
export function gpPlateWave(n: number, m: number): number;
export function gpChladniSquare(n: number, m: number, sign: number, x: number, y: number): number;
export function gpChladniCircle(n: number, m: number, x: number, y: number, turn?: number): number;
export function gpPlateTable(shape: string): { n: number; m: number; f: number }[];
export function gpPlateBands(input: GpSoundInput | null): number[];
export function gpPlateTargets(P: GpParams, shape: string, bands: number[] | null): GpPlateMode[] | null;
export function gpPlateState(): GpPlateState;
export function gpPlateSmooth(st: GpPlateState, targets: GpPlateMode[] | null, dt: number, snap?: boolean): GpPlateMode[];
export function gpPlateListen(st: GpPlateState, o: { spectrum?: GpSoundInput | null; graphBands?: number[] | null; level?: number; hit?: boolean | number; dt: number }): number[];
export function gpPlateUniforms(modes: GpPlateMode[], shape: string): { values: Float32Array; count: number };

/** Shared GLSL pieces (GP_SIM and GP_DRAW_VERT are written with them; the Agents force and draw nodes call them with their own names). */
export function gpCurlAt(p: string, scale: string, time: string): string;
export function gpCurlOctave2(q: string): string;
export function gpCurlPlane(a: string, b: string): string;
export function gpGust(a: string): string;
export function gpSwirl(s: string, d: string, r: string, r2: string): string;
export function gpAttractPull(a: string, g: string, r: string): string;
export function gpHandFall(r: string, reach: string): string;
export function gpHandPush(force: string, swirl: string, hd: string, hr: string, reach: string, fall: string): string;
export function gpFlowPush(dir: string, gl: string, force: string): string;
export function gpWavePhase(r: string, time: string, speed: string): string;
export function gpWavePush(dir: string, wave: string, lv: string, ph: string): string;
export function gpVibrate(dir: string, s: string, amount: string, lv: string, ph: string): string;
export function gpCrunch(s: string, amount: string): string;
export function gpShockRing(r: string, age: string, speed: string): string;
export function gpShockPush(d: string, r: string, strength: string, ring: string, age: string): string;
export function gpLevelGlsl(fn: string, levels: string, args?: string): string;
export function gpBesselGlsl(fn: string, table: string): string;
export function gpPlateGlsl(fn: string, o: { count: string; modes: string; shape: string; sym: string; J: string; args?: string }): string;
export function gpPlateStep(indent: string, o: { half: string; plate: string; settle: string; shake: string; dt: string; shape: string; s: string; args?: string }): string;
export function gpPaletteGlsl(fn: string, rainbow: string, pal: string): string;
export function gpFade(a: string): string;
export const GP_LIGHTS: string;
