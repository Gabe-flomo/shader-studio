export interface PlanPass {
  slug: string;
  scale: number;
  live: boolean;
  previous: boolean;
  format: string;
  filter: string;
  wrap: string;
  afterAgents?: boolean;
  beforeParticles?: boolean;
  repeat?: number;
}
export function ppSize(w: number, h: number, scale: number): [number, number];
export function ppDrawn<T extends Pick<PlanPass, 'live'>>(passes: readonly T[]): T[];
export function ppRepeat(p: Pick<PlanPass, 'repeat'>): number;
export function ppPixel(w: number, h: number): [number, number];
export function ppTargetKey(p: Pick<PlanPass, 'scale' | 'format' | 'filter' | 'wrap' | 'previous'>, w: number, h: number): string;
export function ppStaged<T extends Pick<PlanPass, 'afterAgents' | 'beforeParticles'>>(drawn: readonly T[], stage?: 'pre' | 'post', part?: 'particles' | 'rest'): T[];
export function ppSplitsForParticles(drawn: readonly Pick<PlanPass, 'beforeParticles'>[]): boolean;
export function ppPrevBound<T extends Pick<PlanPass, 'afterAgents' | 'beforeParticles'>>(drawn: readonly T[], stage?: 'pre' | 'post', part?: 'particles' | 'rest'): T[];
export interface PlanStep { do: 'passes' | 'particles' | 'agents'; stage?: 'pre' | 'post'; part?: 'particles' | 'rest'; last?: boolean }
export function ppFrameSteps(o: { passes: boolean; split: boolean; particles: boolean; agents: boolean }): PlanStep[];
