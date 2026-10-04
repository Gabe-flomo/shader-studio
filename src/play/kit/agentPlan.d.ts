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
