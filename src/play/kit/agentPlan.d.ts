export const AG_STEP_HZ: number;
export const AG_MAX_STEPS: number;
export const AG_OFFLINE_CHUNK: number;
export function agStepsPerFrame(v: unknown): number;
export function agPrerollSteps(seconds: unknown): number;
export function agTargetStep(t: number, spf: unknown, preroll: unknown): number;
export function agStepTime(step: number, spf: unknown, preroll: unknown): number;
export function agWindow(mode: string, step: number, n: number, rate: unknown, born: number): { start: number; count: number; born: number };
export function agKeep(halfLife: unknown): number;
export function agTrailSize(w: number, h: number, trail: { scale: number | null; rows: number | null }): [number, number];
export interface AgLiveState { anchorTime: number; anchorStep: number; step: number; lastTime: number }
export function agLiveState(): AgLiveState;
export function agLiveSteps(st: AgLiveState, time: number, spf: unknown, preroll: unknown, cap: number): { steps: number; restart: boolean; target: number };
export interface AgGovernor { cap: number; slow: number; fast: number; base: number }
export function agGovernorState(): AgGovernor;
export function agGovern(gov: AgGovernor, frameMs: number, budgetMs: number): number;
export function agRate(history: Array<[number, number]>, ran: number, wanted: number): number;
export function agBeatLevel(t: number, bpm: unknown): number;
import type { GpLevels, GpPlateState, GpSound, GpSoundInput } from './gpuParticles.js';
type AgRead = (p: unknown, fallback: number) => number;
type AgReadColour = (p: unknown, fallback: number[]) => number[];
export interface AgListenState { sound: GpSound; levels: GpLevels; shocks: Array<{ x: number; y: number; t0: number; s: number }>; plate: GpPlateState }
export interface AgGroupState<L extends AgListenState = AgListenState> {
  step: number; born: number; live: AgLiveState; history: Array<[number, number]>; lastTarget: number;
  listen: Map<string, L>; burstEdge: Record<string, number>; burstPending: boolean;
}
export function agGroupState(): AgGroupState;
export function agRestartGroup(s: Pick<AgGroupState, 'step' | 'born' | 'history' | 'lastTarget' | 'burstPending'>): void;
export function agGroupSteps(
  s: Pick<AgGroupState, 'step' | 'live' | 'history' | 'lastTarget' | 'burstEdge' | 'burstPending'>,
  g: { emit: { burst: unknown }; params: Record<string, unknown> },
  read: AgRead,
  o: { live: boolean; time: number; cap: number; restart?: boolean },
  restartState: () => void,
): { steps: number; spf: number; preroll: number; restarted: boolean; rate: number };
export function agStepWindow(s: Pick<AgGroupState, 'step' | 'born' | 'burstPending'>, g: { emit: { mode: string; rate: unknown } }, n: number, read: AgRead): { start: number; count: number; born: number };
export function agListenState(): AgListenState;
export function agHear(
  st: AgListenState,
  l: { kind: string; soundFrom: string; shape?: string; modeFrom?: string; params: Record<string, unknown> },
  read: AgRead,
  sound: ((source: string) => GpSoundInput | null) | null | undefined,
  time: number,
  first: boolean,
): { sound: number[]; shocks?: number[]; levels?: Float32Array; modes?: Float32Array; count?: number; shake?: number };
export const AG_COLOR_BY: string[];
export interface AgDrawLook {
  ink: boolean; lines: boolean; size: number; bright: number; colorBy: number; speedRef: number; thread: number; fade: boolean;
  usePal: boolean; rainbow: boolean; pal: number[][] | null; colA: number[]; colB: number[]; glow: number; halo: number;
}
export function agDrawLook(d: { style: string; scaleBy: string; palette: string; colorBy: string; fade: boolean; params: Record<string, unknown> }, n: number, h: number, read: AgRead, readColour: AgReadColour): AgDrawLook;
export function agLights(d: { lights: number; lightMotion: string; space3d?: boolean; params: Record<string, unknown> }, read: AgRead, readColour: AgReadColour, time: number, aspect: number): Array<{ x: number; y: number; z: number; reach: number; power: number; colour: number[] }>;
export const AG_VOL_MAX_W: number;
export interface AgVolLayout { nx: number; ny: number; nz: number; tx: number; ty: number; w: number; h: number }
export function agVolLayout(rows: number, w: number, h: number): AgVolLayout;
export function agVolUniform(L: AgVolLayout): [number, number, number, number];
export interface AgCamera3 { eye: number[]; fwd: number[]; right: number[]; up: number[]; dist: number; lens: number; ortho: number; focus: number; focusShare: number; coc: number; cap: number }
export function agCamera3(d: { mirror?: boolean; params: Record<string, unknown> }, read: AgRead, time: number, h: number): AgCamera3;
export function agProject3(cam: AgCamera3, xyz: number[]): { x: number; y: number; depth: number };
export const AG_PROBE_POINTS: number[][];
export const AG_GROUP_READS: readonly ['alive', 'speed', 'spread', 'centroidX', 'centroidY', 'group1', 'group2', 'group3', 'group4'];
export type AgGroupRead = typeof AG_GROUP_READS[number];
export function agReadPlan(side: number): Array<[number, number]>;
export function agReadDecode(px: ArrayLike<number>, count: number, aspect: number): Record<AgGroupRead, number>;
